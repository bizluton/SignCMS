import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

// 驗章規則(雙向相同)：
//   message = `${timestamp}.${rawBody}`
//   signature = hex(hmacSHA256(secret, message))
// timestamp 為 unix 毫秒字串，容許 ±5 分鐘
export function verifyHmac({ secret, timestamp, body, signature }) {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) throw new Error("invalid_timestamp");
  if (Math.abs(Date.now() - ts) > config.hmacToleranceMs) throw new Error("timestamp_skew");

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${body ?? ""}`)
    .digest("hex");

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("signature_mismatch");
  }
}

export function signHmac({ secret, timestamp, body }) {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${body ?? ""}`)
    .digest("hex");
}
