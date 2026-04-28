import os from "node:os";
import path from "node:path";

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  hmacSecret: required("HMAC_SECRET"),
  concurrency: Number(process.env.MAX_CONCURRENT_JOBS ?? Math.max(1, os.cpus().length - 1)),
  tmpDir: process.env.TMP_DIR ?? path.join(os.tmpdir(), "signcms-transcode"),
  ffmpegBin: process.env.FFMPEG_BIN ?? "ffmpeg",

  // ─── S3 / R2 / MinIO 物件儲存 ───
  // S3:    https://s3.<region>.amazonaws.com
  // R2:    https://<account_id>.r2.cloudflarestorage.com
  // MinIO: https://minio.your-domain.com
  s3Endpoint: required("S3_ENDPOINT"),
  s3Region: process.env.S3_REGION ?? "auto",
  s3Bucket: required("S3_BUCKET"),
  s3AccessKeyId: required("S3_ACCESS_KEY_ID"),
  s3SecretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  // R2 / MinIO 通常需要 path-style；AWS S3 預設 false
  s3ForcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "false").toLowerCase() === "true",
  // 物件 key 前綴，例：transcoded/
  s3KeyPrefix: process.env.S3_KEY_PREFIX ?? "transcoded/",
  // 公開存取的 base URL（CDN / R2 公開網域 / S3 website endpoint）
  // 若未設定，回傳簽章用 endpoint URL（多半 private，CMS 無法直接下載）
  s3PublicBaseUrl: process.env.S3_PUBLIC_BASE_URL ?? "",

  // 上傳完是否刪除本地輸出檔（建議 true）
  deleteAfterUpload: (process.env.DELETE_AFTER_UPLOAD ?? "true").toLowerCase() !== "false",

  // 回呼重試
  callbackRetries: Number(process.env.CALLBACK_RETRIES ?? 3),
  callbackBackoffMs: [5_000, 30_000, 120_000],
  // 容許 timestamp 偏差
  hmacToleranceMs: 5 * 60 * 1000,
};
