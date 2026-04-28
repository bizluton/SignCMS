/**
 * src/tests/transcodeCallback.test.ts
 *
 * transcode-callback endpoint 整合測試
 * 使用 Fastify inject（不需要真實 HTTP server）
 *
 * Run: npm test
 *
 * 注意：這是 route-level 測試，DB 呼叫用 mock 處理。
 * 若要跑完整 E2E（含真實 Supabase），請設定 .env.test。
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import Fastify, { FastifyInstance } from 'fastify'
import { signHmac } from '../lib/hmac.js'

// ─── Mock env ────────────────────────────────────────────────
vi.mock('../lib/env.js', () => ({
  env: {
    PORT: 3001,
    HOST: '0.0.0.0',
    NODE_ENV: 'test',
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    SUPABASE_JWT_SECRET: 'test-jwt-secret',
    REDIS_URL: 'redis://localhost:6379',
    FRONTEND_ORIGIN: 'http://localhost:5173',
    TRANSCODE_HMAC_SECRET: 'test-hmac-secret-32-chars-padded!!',
  },
}))

// ─── Mock Supabase ────────────────────────────────────────────
const mockUpdate = vi.fn().mockReturnValue({
  eq: vi.fn().mockResolvedValue({ error: null }),
})
vi.mock('../lib/supabase.js', () => ({
  supabaseAdmin: () => ({
    from: (_table: string) => ({ update: mockUpdate }),
  }),
}))

// ─── Build test app ───────────────────────────────────────────
let app: FastifyInstance

beforeAll(async () => {
  app = Fastify()

  // rawBody 支援（與 server.ts 相同）
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try {
      ;(req as any).rawBody = body
      done(null, JSON.parse(body as string))
    } catch (err) {
      done(err as Error, undefined)
    }
  })

  const { default: transcodeCallbackRoute } = await import('../routes/media/transcodeCallback.js')
  await app.register(transcodeCallbackRoute, { prefix: '/api/media' })
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

const SECRET = 'test-hmac-secret-32-chars-padded!!'

function makeHeaders(rawBody: string) {
  const timestamp = String(Date.now())
  const signature = signHmac(SECRET, timestamp, rawBody)
  return {
    'content-type': 'application/json',
    'x-signature': signature,
    'x-timestamp': timestamp,
  }
}

// 合法的 job_id（包含 UUID 前綴）
const MEDIA_ID = '550e8400-e29b-41d4-a716-446655440000'
const JOB_ID = `${MEDIA_ID}-1`

describe('POST /api/media/transcode-callback', () => {
  it('缺少 HMAC headers → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/media/transcode-callback',
      payload: { job_id: JOB_ID, status: 'done', output_url: 'https://cdn.example.com/out.mp4' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('HMAC 簽名錯誤 → 401', async () => {
    const body = JSON.stringify({ job_id: JOB_ID, status: 'done', output_url: 'https://cdn.example.com/out.mp4' })
    const res = await app.inject({
      method: 'POST',
      url: '/api/media/transcode-callback',
      headers: {
        'content-type': 'application/json',
        'x-signature': 'deadbeef'.repeat(8),
        'x-timestamp': String(Date.now()),
      },
      payload: body,
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('Invalid signature')
  })

  it('status=done → 200，更新 DB', async () => {
    const body = JSON.stringify({
      job_id: JOB_ID,
      status: 'done',
      output_url: 'https://cdn.example.com/out.mp4',
      duration_seconds: 120,
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/media/transcode-callback',
      headers: makeHeaders(body),
      payload: body,
    })
    expect(res.statusCode).toBe(200)
    const json = res.json()
    expect(json.ok).toBe(true)
    expect(json.data.status).toBe('done')
    expect(json.data.media_id).toBe(MEDIA_ID)
    expect(mockUpdate).toHaveBeenCalled()
  })

  it('status=failed → 200，DB 標 failed', async () => {
    const body = JSON.stringify({
      job_id: JOB_ID,
      status: 'failed',
      error: 'ffmpeg_exit_1',
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/media/transcode-callback',
      headers: makeHeaders(body),
      payload: body,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.status).toBe('failed')
  })

  it('status=progress → 200，不更新 DB 狀態', async () => {
    const body = JSON.stringify({
      job_id: JOB_ID,
      status: 'progress',
      progress: 45,
      speed: 2.3,
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/media/transcode-callback',
      headers: makeHeaders(body),
      payload: body,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.received).toBe('progress')
  })

  it('invalid body schema → 400', async () => {
    const body = JSON.stringify({ job_id: JOB_ID, status: 'unknown' })
    const res = await app.inject({
      method: 'POST',
      url: '/api/media/transcode-callback',
      headers: makeHeaders(body),
      payload: body,
    })
    expect(res.statusCode).toBe(400)
  })
})
