// 上傳檔案到 S3 相容物件儲存（AWS S3 / Cloudflare R2 / MinIO 等）
// 自架 worker 直接用 AWS SigV4
//
// 行為：
//   - 檔案 < MULTIPART_THRESHOLD：單一 PUT
//   - 檔案 ≥ MULTIPART_THRESHOLD：S3 Multipart Upload，每片 PART_SIZE，可重試單片
import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";
import { logger } from "./logger.js";

const MULTIPART_THRESHOLD = 100 * 1024 * 1024; // 100MB 以上才啟用 multipart
const PART_SIZE = 16 * 1024 * 1024;             // 每片 16MB（S3 最低 5MB，最後一片可更小）
const PART_MAX_RETRIES = 3;

const enc = (s) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

const encKey = (key) => key.split("/").map(enc).join("/");

function hmac(key, data) {
  return createHmac("sha256", key).update(data).digest();
}

function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

async function fileSha256Hex(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const s = createReadStream(filePath);
    s.on("data", (c) => hash.update(c));
    s.on("end", resolve);
    s.on("error", reject);
  });
  return hash.digest("hex");
}

function signingKey(secret, dateStamp, region, service) {
  const kDate = hmac("AWS4" + secret, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

function getEndpointHostPath(key) {
  const url = new URL(config.s3Endpoint);
  let host;
  let basePath;
  if (config.s3ForcePathStyle) {
    host = url.host;
    basePath = `/${config.s3Bucket}/${encKey(key)}`;
  } else {
    host = `${config.s3Bucket}.${url.host}`;
    basePath = `/${encKey(key)}`;
  }
  return { protocol: url.protocol, host, basePath };
}

/**
 * 通用 SigV4 簽章請求。
 * @param method PUT / POST / DELETE
 * @param key    object key
 * @param query  ?key=value 物件，會排序後 canonicalize
 * @param payloadHash  hex sha256 of body（GET/DELETE 用 e3b0...，即 sha256("")）
 * @param extraHeaders 追加的 headers（例如 content-type、x-amz-mp-parts）
 * @param body   fetch body（Buffer / Stream / string / undefined）
 * @param contentLength 可選；若是 stream 必須帶
 */
async function signedFetch({ method, key, query = {}, payloadHash, extraHeaders = {}, body, contentLength }) {
  const { protocol, host, basePath } = getEndpointHostPath(key);

  // canonical query string：keys 排序，value 也要 URL-encode
  const queryKeys = Object.keys(query).sort();
  const canonicalQuery = queryKeys.map((k) => `${enc(k)}=${enc(String(query[k]))}`).join("&");

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const service = "s3";

  const headers = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...Object.fromEntries(Object.entries(extraHeaders).map(([k, v]) => [k.toLowerCase(), String(v)])),
  };
  if (contentLength != null) headers["content-length"] = String(contentLength);

  const signedHeaderKeys = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderKeys.map((k) => `${k}:${headers[k]}\n`).join("");
  const signedHeaders = signedHeaderKeys.join(";");

  const canonicalRequest = [
    method,
    basePath,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${config.s3Region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const sigKey = signingKey(config.s3SecretAccessKey, dateStamp, config.s3Region, service);
  const signature = createHmac("sha256", sigKey).update(stringToSign).digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${config.s3AccessKeyId}/${credentialScope},` +
    ` SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const targetUrl =
    `${protocol}//${host}${basePath}` + (canonicalQuery ? `?${canonicalQuery}` : "");

  return fetch(targetUrl, {
    method,
    headers: { ...headers, Authorization: authorization },
    body,
    duplex: body && typeof body !== "string" && !Buffer.isBuffer(body) ? "half" : undefined,
  });
}

// ─── 單一 PUT（小檔走這裡） ──────────────────────────
async function singlePutUpload({ filePath, key, contentType, size }) {
  const payloadHash = await fileSha256Hex(filePath);
  const stream = createReadStream(filePath);
  const res = await signedFetch({
    method: "PUT",
    key,
    payloadHash,
    extraHeaders: { "content-type": contentType },
    body: stream,
    contentLength: size,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`s3_upload_failed_${res.status}: ${text.slice(0, 500)}`);
  }
}

// ─── Multipart：Initiate ─────────────────────────────
async function initiateMultipart({ key, contentType }) {
  const res = await signedFetch({
    method: "POST",
    key,
    query: { uploads: "" },
    payloadHash: sha256Hex(""),
    extraHeaders: { "content-type": contentType },
    contentLength: 0,
  });
  const xml = await res.text();
  if (!res.ok) throw new Error(`multipart_init_failed_${res.status}: ${xml.slice(0, 500)}`);
  const m = xml.match(/<UploadId>([^<]+)<\/UploadId>/);
  if (!m) throw new Error(`multipart_init_no_upload_id: ${xml.slice(0, 200)}`);
  return m[1];
}

// ─── Multipart：UploadPart（含重試） ─────────────────
async function uploadPart({ filePath, key, uploadId, partNumber, start, length }) {
  let lastErr;
  for (let attempt = 1; attempt <= PART_MAX_RETRIES; attempt++) {
    let fh;
    try {
      // 直接讀整片進記憶體：避免串流 + sha256 預先計算的雙重讀檔成本
      fh = await open(filePath, "r");
      const buf = Buffer.alloc(length);
      await fh.read(buf, 0, length, start);
      const payloadHash = sha256Hex(buf);
      const res = await signedFetch({
        method: "PUT",
        key,
        query: { partNumber: String(partNumber), uploadId },
        payloadHash,
        body: buf,
        contentLength: length,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`upload_part_${partNumber}_failed_${res.status}: ${text.slice(0, 300)}`);
      }
      const etag = res.headers.get("etag");
      if (!etag) throw new Error(`upload_part_${partNumber}_no_etag`);
      return { PartNumber: partNumber, ETag: etag };
    } catch (err) {
      lastErr = err;
      logger.warn(
        { partNumber, attempt, err: err.message },
        "upload part failed, retrying",
      );
      // 指數退避：1s / 3s / 9s
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(3, attempt - 1)));
    } finally {
      await fh?.close().catch(() => {});
    }
  }
  throw lastErr ?? new Error(`upload_part_${partNumber}_failed`);
}

// ─── Multipart：Complete ─────────────────────────────
async function completeMultipart({ key, uploadId, parts }) {
  // parts 必須按 PartNumber 升冪排序
  parts.sort((a, b) => a.PartNumber - b.PartNumber);
  const body =
    `<CompleteMultipartUpload>` +
    parts
      .map((p) => `<Part><PartNumber>${p.PartNumber}</PartNumber><ETag>${p.ETag}</ETag></Part>`)
      .join("") +
    `</CompleteMultipartUpload>`;
  const payloadHash = sha256Hex(body);
  const res = await signedFetch({
    method: "POST",
    key,
    query: { uploadId },
    payloadHash,
    extraHeaders: { "content-type": "application/xml" },
    body,
    contentLength: Buffer.byteLength(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`multipart_complete_failed_${res.status}: ${text.slice(0, 500)}`);
  // S3 即使 200 也可能回 <Error>（罕見），做基本檢查
  if (/<Error>/.test(text)) throw new Error(`multipart_complete_error: ${text.slice(0, 500)}`);
}

// ─── Multipart：Abort（清掉未完成的分片，避免被收費） ─
async function abortMultipart({ key, uploadId }) {
  try {
    await signedFetch({
      method: "DELETE",
      key,
      query: { uploadId },
      payloadHash: sha256Hex(""),
      contentLength: 0,
    });
  } catch (err) {
    logger.warn({ err: err.message, key, uploadId }, "multipart abort failed");
  }
}

async function multipartUpload({ filePath, key, contentType, size }) {
  const uploadId = await initiateMultipart({ key, contentType });
  logger.info({ key, uploadId, size, partSize: PART_SIZE }, "multipart upload started");

  try {
    const parts = [];
    const totalParts = Math.ceil(size / PART_SIZE);
    for (let i = 0; i < totalParts; i++) {
      const start = i * PART_SIZE;
      const length = Math.min(PART_SIZE, size - start);
      const partNumber = i + 1;
      const result = await uploadPart({ filePath, key, uploadId, partNumber, start, length });
      parts.push(result);
      logger.debug(
        { partNumber, totalParts, uploaded: start + length, size },
        "part uploaded",
      );
    }
    await completeMultipart({ key, uploadId, parts });
    logger.info({ key, uploadId, parts: parts.length }, "multipart upload completed");
  } catch (err) {
    await abortMultipart({ key, uploadId });
    throw err;
  }
}

/**
 * 上傳檔案到 S3 相容端點。自動依檔案大小選擇單一 PUT 或 multipart。
 * 回傳公開 URL（若桶為 public 或設定 S3_PUBLIC_BASE_URL）或 signing endpoint URL。
 */
export async function uploadFile({ filePath, key, contentType }) {
  const size = (await stat(filePath)).size;

  if (size >= MULTIPART_THRESHOLD) {
    await multipartUpload({ filePath, key, contentType, size });
  } else {
    await singlePutUpload({ filePath, key, contentType, size });
  }

  if (config.s3PublicBaseUrl) {
    return `${config.s3PublicBaseUrl.replace(/\/$/, "")}/${encKey(key)}`;
  }
  const { protocol, host, basePath } = getEndpointHostPath(key);
  return `${protocol}//${host}${basePath}`;
}
