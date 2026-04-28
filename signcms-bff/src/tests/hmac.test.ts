/**
 * src/tests/hmac.test.ts
 *
 * HMAC 簽名工具測試
 * 驗證 BFF 的 signHmac / verifyHmac 與 worker 的邏輯完全對齊
 *
 * Run: npm test
 */

import { describe, it, expect } from 'vitest'
import { signHmac, verifyHmac, buildWorkerHeaders } from '../lib/hmac.js'

const SECRET = 'test-secret-at-least-32-chars!!'

describe('signHmac', () => {
  it('相同參數產生相同簽名', () => {
    const sig1 = signHmac(SECRET, '1234567890', '{"hello":"world"}')
    const sig2 = signHmac(SECRET, '1234567890', '{"hello":"world"}')
    expect(sig1).toBe(sig2)
  })

  it('body 不同 → 簽名不同', () => {
    const sig1 = signHmac(SECRET, '1234567890', '{"a":1}')
    const sig2 = signHmac(SECRET, '1234567890', '{"a":2}')
    expect(sig1).not.toBe(sig2)
  })

  it('timestamp 不同 → 簽名不同', () => {
    const sig1 = signHmac(SECRET, '1000000000', '{}')
    const sig2 = signHmac(SECRET, '1000000001', '{}')
    expect(sig1).not.toBe(sig2)
  })

  it('簽名格式：64 位元 hex', () => {
    const sig = signHmac(SECRET, '1234567890', '{}')
    expect(sig).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('verifyHmac', () => {
  it('正確簽名 → ok: true', () => {
    const timestamp = String(Date.now())
    const body = '{"job_id":"abc","status":"done"}'
    const signature = signHmac(SECRET, timestamp, body)

    const result = verifyHmac(SECRET, timestamp, body, signature)
    expect(result.ok).toBe(true)
  })

  it('簽名錯誤 → ok: false, signature_mismatch', () => {
    const timestamp = String(Date.now())
    const body = '{}'
    const result = verifyHmac(SECRET, timestamp, body, 'deadbeef'.repeat(8))
    expect(result.ok).toBe(false)
    expect(result.error).toBe('signature_mismatch')
  })

  it('timestamp 超過 5 分鐘 → ok: false, timestamp_skew', () => {
    const oldTs = String(Date.now() - 6 * 60 * 1000)
    const body = '{}'
    const sig = signHmac(SECRET, oldTs, body)
    const result = verifyHmac(SECRET, oldTs, body, sig)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('timestamp_skew')
  })

  it('invalid timestamp → ok: false, invalid_timestamp', () => {
    const result = verifyHmac(SECRET, 'not-a-number', '{}', 'abc')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('invalid_timestamp')
  })
})

describe('buildWorkerHeaders', () => {
  it('產生正確的 Content-Type / X-Signature / X-Timestamp', () => {
    const rawBody = JSON.stringify({ job_id: 'test', input_url: 'https://example.com' })
    const headers = buildWorkerHeaders(SECRET, rawBody)

    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['X-Signature']).toMatch(/^[0-9a-f]{64}$/)
    expect(headers['X-Timestamp']).toMatch(/^\d+$/)
  })

  it('buildWorkerHeaders 產生的簽名可被 verifyHmac 驗證', () => {
    const rawBody = JSON.stringify({ job_id: 'test' })
    const headers = buildWorkerHeaders(SECRET, rawBody)

    const result = verifyHmac(
      SECRET,
      headers['X-Timestamp'],
      rawBody,
      headers['X-Signature']
    )
    expect(result.ok).toBe(true)
  })

  it('模擬 worker 側驗章（與 docs/transcode-worker/src/hmac.js 對齊）', () => {
    // Worker 驗章邏輯：
    //   message = `${timestamp}.${rawBody}`
    //   expected = HMAC-SHA256(secret, message)
    const rawBody = '{"job_id":"media-123","status":"done","output_url":"https://cdn.example.com/out.mp4"}'
    const headers = buildWorkerHeaders(SECRET, rawBody)

    // 模擬 worker 端手動計算
    const { createHmac } = require('crypto')
    const workerExpected = createHmac('sha256', SECRET)
      .update(`${headers['X-Timestamp']}.${rawBody}`)
      .digest('hex')

    expect(headers['X-Signature']).toBe(workerExpected)
  })
})
