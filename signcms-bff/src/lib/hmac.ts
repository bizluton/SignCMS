/**
 * src/lib/hmac.ts
 *
 * HMAC-SHA256 簽名工具
 * 與 docs/transcode-worker/src/hmac.js 完全對齊
 *
 * 簽名規則（雙向相同）：
 *   message   = `${timestamp}.${rawBody}`
 *   signature = hex(HMAC-SHA256(secret, message))
 *   timestamp = unix 毫秒字串
 *
 * Headers（worker 期待）：
 *   X-Signature: <hex>
 *   X-Timestamp: <ms>
 *
 * 容許時間偏差：±5 分鐘
 */

import { createHmac, timingSafeEqual } from 'crypto'

const HMAC_TOLERANCE_MS = 5 * 60 * 1000

// ─── 簽名（BFF → Worker 呼叫時用）───────────────────────────────

export function signHmac(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex')
}

// ─── 驗章（Worker → BFF callback 時用）──────────────────────────

export function verifyHmac(
  secret: string,
  timestamp: string,
  rawBody: string,
  signature: string
): { ok: boolean; error?: string } {
  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return { ok: false, error: 'invalid_timestamp' }
  if (Math.abs(Date.now() - ts) > HMAC_TOLERANCE_MS) return { ok: false, error: 'timestamp_skew' }

  const expected = signHmac(secret, timestamp, rawBody)
  try {
    const a = Buffer.from(expected, 'hex')
    const b = Buffer.from(signature, 'hex')
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, error: 'signature_mismatch' }
    }
  } catch {
    return { ok: false, error: 'signature_mismatch' }
  }
  return { ok: true }
}

// ─── 建立送往 Worker 的 headers ──────────────────────────────────

export function buildWorkerHeaders(
  secret: string,
  rawBody: string   // 先 JSON.stringify(body) 再傳入，確保簽名的 body 與送出的一致
): Record<string, string> {
  const timestamp = String(Date.now())
  const signature = signHmac(secret, timestamp, rawBody)
  return {
    'Content-Type': 'application/json',
    'X-Signature': signature,
    'X-Timestamp': timestamp,
  }
}
