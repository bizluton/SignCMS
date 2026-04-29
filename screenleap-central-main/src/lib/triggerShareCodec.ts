// Codec for encoding/decoding trigger-test share payloads in URL hashes.
// Supports two formats for backwards compatibility:
//   "g:<base64url>"  -> gzip-compressed JSON (CompressionStream)
//   "b:<base64>"     -> plain base64 JSON (legacy with explicit prefix)
//   "<base64>"       -> legacy unprefixed base64 JSON
import { supabase } from "@/integrations/supabase/client";

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function gzip(data: Uint8Array): Promise<Uint8Array> {
  // @ts-expect-error - CompressionStream is supported in modern browsers but not in older TS lib typings
  const cs = new CompressionStream("gzip");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(cs);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  // @ts-expect-error - DecompressionStream is supported in modern browsers but not in older TS lib typings
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

export interface ShareEncodeResult {
  encoded: string;        // ready to drop after `#trigger-test=`
  compressed: boolean;
  rawBytes: number;       // size of raw JSON
  encodedBytes: number;   // size of encoded string
}

/** Encode any JSON-serializable payload. Uses gzip when supported & smaller. */
export async function encodeSharePayload(value: unknown): Promise<ShareEncodeResult> {
  const json = JSON.stringify(value);
  const utf8 = new TextEncoder().encode(json);
  // Always try the legacy plain base64 as a baseline.
  const plain = btoa(unescape(encodeURIComponent(json)));

  // Try gzip if the browser supports CompressionStream.
  if (typeof (globalThis as Record<string, unknown>).CompressionStream === "function") {
    try {
      const gz = await gzip(utf8);
      const gzB64 = toBase64Url(gz);
      const gzToken = `g:${gzB64}`;
      // Choose whichever is shorter after URL-encoding.
      const gzEnc = encodeURIComponent(gzToken);
      const plainEnc = encodeURIComponent(plain);
      if (gzEnc.length < plainEnc.length) {
        return { encoded: gzEnc, compressed: true, rawBytes: utf8.length, encodedBytes: gzEnc.length };
      }
      return { encoded: plainEnc, compressed: false, rawBytes: utf8.length, encodedBytes: plainEnc.length };
    } catch {
      // fall through to plain
    }
  }
  const plainEnc = encodeURIComponent(plain);
  return { encoded: plainEnc, compressed: false, rawBytes: utf8.length, encodedBytes: plainEnc.length };
}

/** Decode a token from the URL hash (already URL-decoded). */
export async function decodeSharePayload(token: string): Promise<unknown> {
  if (token.startsWith("g:")) {
    const bytes = fromBase64Url(token.slice(2));
    const out = await gunzip(bytes);
    const json = new TextDecoder().decode(out);
    return JSON.parse(json);
  }
  const raw = token.startsWith("b:") ? token.slice(2) : token;
  const json = decodeURIComponent(escape(atob(raw)));
  return JSON.parse(json);
}

/**
 * Thrown when the server rejects a payload as too large (HTTP 413).
 * Contains the limit and the size the server measured so the UI can show
 * an actionable error.
 */
export class PayloadTooLargeError extends Error {
  constructor(message: string, public maxBytes?: number, public receivedBytes?: number) {
    super(message);
    this.name = "PayloadTooLargeError";
  }
}

interface HttpErrorLike {
  context?: { status?: number; body?: { code?: string; maxBytes?: number; receivedBytes?: number } };
  status?: number;
}

interface TooLargeResponseData {
  code?: string;
  maxBytes?: number;
  receivedBytes?: number;
}

function extractTooLarge(err: HttpErrorLike, data: TooLargeResponseData | null): PayloadTooLargeError | null {
  const status = err?.context?.status ?? err?.status;
  const code = data?.code ?? err?.context?.body?.code;
  if (status === 413 || code === "payload_too_large") {
    const maxBytes = data?.maxBytes ?? err?.context?.body?.maxBytes;
    const receivedBytes = data?.receivedBytes ?? err?.context?.body?.receivedBytes;
    return new PayloadTooLargeError(
      `Share payload too large${
        receivedBytes && maxBytes ? ` (${receivedBytes} > ${maxBytes} bytes)` : ""
      }`,
      maxBytes,
      receivedBytes,
    );
  }
  return null;
}

/**
 * Ask the backend to HMAC-sign a payload. The signing key never leaves the server.
 * Returns the base64url signature; embed it alongside the payload in the share link.
 */
export async function signSharePayload(payload: unknown): Promise<string> {
  const { data, error } = await supabase.functions.invoke("trigger-share-sign/sign", {
    body: { payload },
  });
  if (error) {
    const tooLarge = extractTooLarge(error, data);
    if (tooLarge) throw tooLarge;
    throw error;
  }
  if (!data?.sig) throw new Error("Sign failed: no signature returned");
  return data.sig as string;
}

/**
 * Marker error used by `verifySharePayload` to indicate the call could not
 * reach the verification service (network down, 5xx, timeout, etc.) — i.e.
 * the result is unknown rather than definitively invalid. Callers can catch
 * this and retry.
 */
export class VerifyTransientError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "VerifyTransientError";
  }
}

function isTransientError(err: unknown): boolean {
  if (!err) return false;
  const anyErr = err as { context?: { status?: number }; status?: number; name?: string; message?: string };
  // FunctionsHttpError carries a status; treat 5xx / 0 / undefined as transient.
  const status = anyErr?.context?.status ?? anyErr?.status;
  if (typeof status === "number") {
    if (status === 0) return true;
    if (status >= 500 && status < 600) return true;
    if (status === 408 || status === 425 || status === 429) return true;
    return false;
  }
  const name = String(anyErr?.name ?? "");
  const msg = String(anyErr?.message ?? err);
  if (name === "FunctionsFetchError" || name === "TypeError" || name === "AbortError") return true;
  return /network|fetch|timeout|failed to fetch|load failed/i.test(msg);
}

/**
 * Ask the backend to verify a payload+signature pair.
 * - Returns `true` only on a valid HMAC.
 * - Returns `false` for a definitive mismatch (server reachable, sig invalid).
 * - Throws `VerifyTransientError` when the verification service was unreachable
 *   so the caller can decide whether to retry.
 */
export async function verifySharePayload(payload: unknown, sig: string): Promise<boolean> {
  let resp;
  try {
    resp = await supabase.functions.invoke("trigger-share-sign/verify", {
      body: { payload, sig },
    });
  } catch (err) {
    throw new VerifyTransientError("Verification service unreachable", err);
  }
  const { data, error } = resp;
  if (error) {
    const tooLarge = extractTooLarge(error, data);
    if (tooLarge) throw tooLarge;
    if (isTransientError(error)) {
      throw new VerifyTransientError(
        `Verification service error: ${(error as Error)?.message ?? "unknown"}`,
        error,
      );
    }
    return false;
  }
  return Boolean(data?.ok);
}