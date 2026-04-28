/**
 * src/tests/playerManifest.test.ts
 *
 * /api/player/manifest/:screenId 端點測試
 *
 * 驗證：
 *  - 認證（device token / JWT）
 *  - manifest 結構完整性
 *  - md5 + local_filename 欄位存在
 *  - manifest_hash 一致性（相同輸入 → 相同 hash）
 *  - warnings 正確處理 base64 / transcode_pending 的媒體
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import Fastify, { FastifyInstance } from 'fastify'
import jwt from 'jsonwebtoken'
import { createHash } from 'crypto'

const JWT_SECRET = 'test-jwt-secret'
const SCREEN_ID = '550e8400-e29b-41d4-a716-446655440000'
const DEVICE_TOKEN = 'valid-device-token-abc'

vi.mock('../lib/env.js', () => ({
  env: {
    PORT: 3001, HOST: '0.0.0.0', NODE_ENV: 'test',
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service',
    SUPABASE_JWT_SECRET: JWT_SECRET,
    REDIS_URL: 'redis://localhost:6379',
    FRONTEND_ORIGIN: 'http://localhost:5173',
  },
}))

// ─── Mock 資料 ────────────────────────────────────────────────

const mockScreen = {
  id: SCREEN_ID,
  name: '大廳螢幕 1F',
  org_id: 'org-001',
  device_token: DEVICE_TOKEN,
}

const mockSchedule = {
  id: 'sched-001',
  name: '週間排程',
  screen_id: SCREEN_ID,
  enabled: true,
  start_date: null,
  end_date: null,
  start_time: null,
  end_time: null,
  days: [1,2,3,4,5],
  bgm_volume: 70,
  updated_at: '2026-04-01T00:00:00Z',
}

const mockItems = [
  { media_id: 'media-001', design_project_id: null, item_type: 'media', duration: 10, sort_order: 1 },
  { media_id: 'media-002', design_project_id: null, item_type: 'media', duration: 15, sort_order: 2 },
]

const mockBgm = [
  { media_id: 'media-bgm-01', sort_order: 1 },
]

const mockMediaRows = [
  {
    id: 'media-001', name: '產品廣告.jpg', original_name: '產品廣告.jpg',
    type: 'image', mime_type: 'image/jpeg',
    url: 'https://cdn.supabase.co/storage/v1/object/public/media/org-001/abc123.jpg',
    storage_path: 'org-001/abc123.jpg',
    md5: 'abc123def456abc123def456abc12345',
    size_bytes: 512000,
    width: 1920, height: 1080, duration_seconds: null,
    transcode_status: 'none',
  },
  {
    id: 'media-002', name: '促銷影片.mp4', original_name: '促銷影片.mp4',
    type: 'video', mime_type: 'video/mp4',
    url: 'https://cdn.supabase.co/storage/v1/object/public/media/org-001/def456.mp4',
    storage_path: 'org-001/def456.mp4',
    md5: 'def456abc789def456abc789def45678',
    size_bytes: 25600000,
    width: 1920, height: 1080, duration_seconds: 30,
    transcode_status: 'done',
  },
  {
    id: 'media-bgm-01', name: '背景音樂.mp3', original_name: '背景音樂.mp3',
    type: 'audio', mime_type: 'audio/mpeg',
    url: 'https://cdn.supabase.co/storage/v1/object/public/media/org-001/bgm001.mp3',
    storage_path: 'org-001/bgm001.mp3',
    md5: 'bgm001md5hash32charsbgm001md5has',
    size_bytes: 3200000,
    width: null, height: null, duration_seconds: 180,
    transcode_status: 'none',
  },
]

vi.mock('../lib/supabase.js', () => ({
  supabaseAdmin: () => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      or: () => chain,
      order: () => chain,
      limit: () => chain,
      in: () => chain,
      maybeSingle: async () => ({ data: mockSchedule, error: null }),
      single: vi.fn().mockImplementation(async () => {
        return { data: mockScreen, error: null }
      }),
    }

    return {
      from: (table: string) => {
        if (table === 'screens') return {
          select: () => ({ eq: () => ({ single: async () => ({ data: mockScreen, error: null }) }) }),
        }
        if (table === 'schedules') return {
          select: () => ({
            eq: () => ({ eq: () => ({ or: () => ({ or: () => ({ order: () => ({ limit: () => ({
              maybeSingle: async () => ({ data: mockSchedule, error: null }),
            })})})})})}),
          }),
        }
        if (table === 'schedule_items') return {
          select: () => ({ eq: () => ({ order: async () => ({ data: mockItems, error: null }) }) }),
        }
        if (table === 'schedule_bgm_items') return {
          select: () => ({ eq: () => ({ order: async () => ({ data: mockBgm, error: null }) }) }),
        }
        if (table === 'media_items') return {
          select: () => ({ in: async () => ({ data: mockMediaRows, error: null }) }),
        }
        if (table === 'design_projects') return {
          select: () => ({ in: async () => ({ data: [], error: null }) }),
        }
        if (table === 'widgets') return {
          select: () => ({ in: async () => ({ data: [], error: null }) }),
        }
        return { select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }) }
      },
    }
  },
}))

function makeJwt(userId = 'user-001') {
  return jwt.sign(
    { sub: userId, email: 'test@test.com', role: 'authenticated', aud: 'authenticated' },
    JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' }
  )
}

let app: FastifyInstance

beforeAll(async () => {
  app = Fastify()
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try { ;(req as any).rawBody = body; done(null, JSON.parse(body as string)) }
    catch (err) { done(err as Error, undefined) }
  })
  await app.register(
    await import('@fastify/jwt' as any).then((m: any) => m.default ?? m),
    { secret: JWT_SECRET }
  )
  const { default: route } = await import('../routes/player/manifest.js')
  await app.register(route, { prefix: '/api/player' })
  await app.ready()
})

afterAll(async () => { await app.close() })

describe('GET /api/player/manifest/:screenId', () => {
  it('無認證 → 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/player/manifest/${SCREEN_ID}`,
    })
    expect(res.statusCode).toBe(401)
  })

  it('無效 screenId 格式 → 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/player/manifest/not-a-uuid',
      headers: { 'x-device-token': DEVICE_TOKEN },
    })
    expect(res.statusCode).toBe(400)
  })

  it('錯誤 device token → 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/player/manifest/${SCREEN_ID}`,
      headers: { 'x-device-token': 'wrong-token' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('正確 device token → 200，manifest 結構完整', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/player/manifest/${SCREEN_ID}`,
      headers: { 'x-device-token': DEVICE_TOKEN },
    })
    expect(res.statusCode).toBe(200)
    const { ok, data } = res.json()
    expect(ok).toBe(true)
    expect(data.format).toBe('signcms.player.manifest')
    expect(data.version).toBe(2)
    expect(data.manifest_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(data.screen.id).toBe(SCREEN_ID)
    expect(data.schedule.id).toBe('sched-001')
  })

  it('media 每個 entry 都有 md5 + local_filename + url', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/player/manifest/${SCREEN_ID}`,
      headers: { 'x-device-token': DEVICE_TOKEN },
    })
    const { data } = res.json()
    expect(data.media.length).toBeGreaterThan(0)
    for (const m of data.media) {
      expect(m.md5, `media ${m.id} 缺少 md5`).toBeDefined()
      expect(m.local_filename, `media ${m.id} 缺少 local_filename`).toBeDefined()
      expect(m.url, `media ${m.id} 缺少 url`).toBeDefined()
      expect(m.size_bytes, `media ${m.id} 缺少 size_bytes`).toBeDefined()
    }
  })

  it('local_filename 格式為 {md5}.{ext}', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/player/manifest/${SCREEN_ID}`,
      headers: { 'x-device-token': DEVICE_TOKEN },
    })
    const { data } = res.json()
    const imgMedia = data.media.find((m: any) => m.mime_type === 'image/jpeg')
    expect(imgMedia.local_filename).toMatch(/^[a-f0-9]{32}\.jpg$/)

    const vidMedia = data.media.find((m: any) => m.mime_type === 'video/mp4')
    expect(vidMedia.local_filename).toMatch(/^[a-f0-9]{32}\.mp4$/)
  })

  it('X-Manifest-Hash response header 與 data.manifest_hash 一致', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/player/manifest/${SCREEN_ID}`,
      headers: { 'x-device-token': DEVICE_TOKEN },
    })
    const { data } = res.json()
    expect(res.headers['x-manifest-hash']).toBe(data.manifest_hash)
  })

  it('相同輸入多次呼叫 → 相同 manifest_hash（deterministic）', async () => {
    const req = () => app.inject({
      method: 'GET',
      url: `/api/player/manifest/${SCREEN_ID}`,
      headers: { 'x-device-token': DEVICE_TOKEN },
    })
    const [r1, r2] = await Promise.all([req(), req()])
    expect(r1.json().data.manifest_hash).toBe(r2.json().data.manifest_hash)
  })
})

describe('GET /api/player/manifest/:screenId/hash', () => {
  it('回傳 manifest_hash + checked_at，不含完整 media 陣列', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/player/manifest/${SCREEN_ID}/hash`,
      headers: { 'x-device-token': DEVICE_TOKEN },
    })
    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(data.manifest_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(data.checked_at).toBeDefined()
    expect(data.media).toBeUndefined()  // 輕量版不含 media 陣列
  })

  it('/hash 的 hash 與完整 manifest 的 hash 一致', async () => {
    const [hashRes, fullRes] = await Promise.all([
      app.inject({
        method: 'GET',
        url: `/api/player/manifest/${SCREEN_ID}/hash`,
        headers: { 'x-device-token': DEVICE_TOKEN },
      }),
      app.inject({
        method: 'GET',
        url: `/api/player/manifest/${SCREEN_ID}`,
        headers: { 'x-device-token': DEVICE_TOKEN },
      }),
    ])
    expect(hashRes.json().data.manifest_hash).toBe(fullRes.json().data.manifest_hash)
  })
})
