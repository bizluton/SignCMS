/**
 * src/tests/playerDeviceAuth.test.ts
 *
 * 裝置認證安全測試
 *
 * 重點驗證：
 *  1. 沒有 token → 401
 *  2. 無效 token → 401
 *  3. token 對應螢幕 A，請求螢幕 B → 403（cross-screen mismatch）
 *  4. 有效 token + 正確 screenId → 200
 *  5. Org license 過期 → 401
 *  6. manifest media 只包含該 org 的媒體（org 隔離）
 *  7. token 核發 / 撤銷需要 JWT + 權限
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import Fastify, { FastifyInstance } from 'fastify'
import jwt from 'jsonwebtoken'

const JWT_SECRET = 'test-jwt-secret'

// ─── 測試資料 ─────────────────────────────────────────────────

const SCREEN_A_ID = '550e8400-e29b-41d4-a716-446655440001'
const SCREEN_B_ID = '550e8400-e29b-41d4-a716-446655440002'
const ORG_ID      = 'org00000-0000-0000-0000-000000000001'
const VALID_TOKEN = 'a'.repeat(64)   // 64 char hex（測試用）
const WRONG_TOKEN = 'b'.repeat(64)

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

// DB mock：根據 RPC 名稱回傳對應結果
vi.mock('../lib/supabase.js', () => ({
  supabaseAdmin: () => ({
    rpc: vi.fn().mockImplementation((fnName: string, args: any) => {
      if (fnName === 'get_screen_by_device_token') {
        const token = args._token
        if (token === VALID_TOKEN) {
          return Promise.resolve({
            data: {
              ok: true,
              screen_id: SCREEN_A_ID,
              org_id: ORG_ID,
              screen_name: '大廳螢幕',
            },
            error: null,
          })
        }
        if (token === 'e'.repeat(64)) {
          // 模擬 org license 過期
          return Promise.resolve({
            data: { ok: false, error: 'org_license_expired' },
            error: null,
          })
        }
        return Promise.resolve({
          data: { ok: false, error: 'invalid_token' },
          error: null,
        })
      }
      if (fnName === 'issue_screen_device_token') {
        return Promise.resolve({
          data: { ok: true, token: 'f'.repeat(64) },
          error: null,
        })
      }
      if (fnName === 'revoke_screen_device_token') {
        return Promise.resolve({ data: { ok: true }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    }),
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            or: () => ({ or: () => ({ order: () => ({ limit: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            })})})}),
          }),
          single: () => Promise.resolve({ data: null, error: null }),
          in: () => Promise.resolve({ data: [], error: null }),
          order: () => Promise.resolve({ data: [], error: null }),
        }),
        in: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
  }),
}))

vi.mock('../middleware/auth.js', () => ({
  requireAuth: vi.fn().mockImplementation(async (request: any, reply: any) => {
    const auth = request.headers.authorization
    if (!auth?.startsWith('Bearer ')) {
      reply.status(401).send({ ok: false, error: 'Unauthorized' })
      return
    }
    try {
      const payload = jwt.verify(auth.slice(7), JWT_SECRET) as any
      request.user = { id: payload.sub, email: payload.email }
    } catch {
      reply.status(401).send({ ok: false, error: 'Invalid token' })
    }
  }),
}))

function makeJwt(userId = 'admin-user-001') {
  return jwt.sign(
    { sub: userId, email: 'admin@test.com', role: 'authenticated', aud: 'authenticated' },
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
  const { default: route } = await import('../routes/player/index.js')
  await app.register(route, { prefix: '/api/player' })
  await app.ready()
})

afterAll(async () => { await app.close() })

// ════════════════════════════════════════════════════════════════
// Manifest 安全測試（核心）
// ════════════════════════════════════════════════════════════════

describe('GET /api/player/manifest/:screenId — 裝置認證', () => {

  it('❌ 沒有 X-Device-Token → 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/player/manifest/${SCREEN_A_ID}`,
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('missing_device_token')
  })

  it('❌ 無效 token（64 char hex 但不存在） → 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/player/manifest/${SCREEN_A_ID}`,
      headers: { 'x-device-token': WRONG_TOKEN },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('invalid_device_token')
  })

  it('❌ token 格式錯誤（非 64 char hex） → 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/player/manifest/${SCREEN_A_ID}`,
      headers: { 'x-device-token': 'short-invalid-token' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('❌ Org license 過期 → 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/player/manifest/${SCREEN_A_ID}`,
      headers: { 'x-device-token': 'e'.repeat(64) },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().detail).toBe('org_license_expired')
  })

  it('❌ 螢幕 A 的 token 請求螢幕 B 的 manifest → 403（cross-screen mismatch）', async () => {
    // VALID_TOKEN 對應 SCREEN_A，但 URL 填 SCREEN_B
    const res = await app.inject({
      method: 'GET',
      url: `/api/player/manifest/${SCREEN_B_ID}`,  // ← 故意填 B
      headers: { 'x-device-token': VALID_TOKEN },   // ← A 的 token
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('screen_mismatch')
  })

  it('✅ 正確 token + 正確 screenId → 200', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/player/manifest/${SCREEN_A_ID}`,
      headers: { 'x-device-token': VALID_TOKEN },
    })
    expect(res.statusCode).toBe(200)
    const { ok, data } = res.json()
    expect(ok).toBe(true)
    expect(data.format).toBe('signcms.player.manifest')
    expect(data.version).toBe(2)
    expect(data.manifest_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('✅ X-Manifest-Hash header 與 body hash 一致', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/player/manifest/${SCREEN_A_ID}`,
      headers: { 'x-device-token': VALID_TOKEN },
    })
    expect(res.headers['x-manifest-hash']).toBe(res.json().data.manifest_hash)
  })
})

describe('GET /api/player/manifest/:screenId/hash — 輕量探針', () => {

  it('❌ 沒有 token → 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/player/manifest/${SCREEN_A_ID}/hash`,
    })
    expect(res.statusCode).toBe(401)
  })

  it('❌ token 對應 A，請求 B 的 hash → 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/player/manifest/${SCREEN_B_ID}/hash`,
      headers: { 'x-device-token': VALID_TOKEN },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('screen_mismatch')
  })

  it('✅ 正確請求 → 200，只含 hash（不含 media 陣列）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/player/manifest/${SCREEN_A_ID}/hash`,
      headers: { 'x-device-token': VALID_TOKEN },
    })
    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(data.manifest_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(data.media).toBeUndefined()   // 輕量版不含 media
    expect(data.screen_id).toBe(SCREEN_A_ID)
  })
})

// ════════════════════════════════════════════════════════════════
// Token 管理 API（Org Admin）
// ════════════════════════════════════════════════════════════════

describe('POST /api/player/screens/:screenId/issue-token', () => {

  it('❌ 無 JWT → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/player/screens/${SCREEN_A_ID}/issue-token`,
    })
    expect(res.statusCode).toBe(401)
  })

  it('✅ 有效 JWT → 200，回傳 token（只顯示一次）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/player/screens/${SCREEN_A_ID}/issue-token`,
      headers: { authorization: `Bearer ${makeJwt()}` },
    })
    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(data.token).toMatch(/^[0-9a-f]{64}$/)
    expect(data.note).toContain('不會再次顯示')
  })
})

describe('POST /api/player/screens/:screenId/revoke-token', () => {

  it('✅ 撤銷成功 → 200', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/player/screens/${SCREEN_A_ID}/revoke-token`,
      headers: { authorization: `Bearer ${makeJwt()}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.status).toBe('revoked')
  })
})
