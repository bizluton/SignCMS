/**
 * src/tests/onboarding.test.ts
 *
 * Onboarding provision 端點測試
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import Fastify, { FastifyInstance } from 'fastify'
import jwt from 'jsonwebtoken'

const JWT_SECRET = 'test-jwt-secret'
const SYS_ADMIN_ID = 'sysadmin-0000-0000-0000-000000000001'
const REGULAR_USER_ID = 'regular-0000-0000-0000-000000000001'

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

vi.mock('../lib/supabase.js', () => ({
  supabaseAdmin: () => ({
    auth: {
      admin: {
        createUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'new-user-id' } }, error: null,
        }),
        generateLink: vi.fn().mockResolvedValue({
          data: { properties: { action_link: 'https://test.example.com/login?token=abc' } },
          error: null,
        }),
        getUserById: vi.fn().mockResolvedValue({
          data: { user: { email: 'admin@test.com' } }, error: null,
        }),
        listUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: null }),
      },
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            limit: () => ({ single: () => Promise.resolve({ data: null, error: null }) }),
            single: () => Promise.resolve({ data: null, error: null }),
          }),
          single: () => Promise.resolve({ data: null, error: null }),
          limit: () => ({ single: () => Promise.resolve({ data: null, error: null }) }),
        }),
      }),
      insert: vi.fn().mockResolvedValue({ error: null }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
    }),
    rpc: (fn: string) => {
      if (fn === 'bootstrap_user_organization')
        return Promise.resolve({ data: { org_id: 'new-org-id' }, error: null })
      if (fn === 'redeem_license_code')
        return Promise.resolve({ data: true, error: null })
      return Promise.resolve({ data: null, error: null })
    },
  }),
  isSystemAdmin: vi.fn().mockImplementation(
    (userId: string) => Promise.resolve(userId === SYS_ADMIN_ID)
  ),
}))

vi.mock('../lib/email.js', () => ({
  generateInviteLink: vi.fn().mockResolvedValue('https://test.example.com/invite'),
  enqueueEmail: vi.fn().mockResolvedValue({ ok: true }),
}))

function makeToken(userId: string) {
  return jwt.sign(
    { sub: userId, email: 'test@example.com', role: 'authenticated', aud: 'authenticated' },
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
  const { default: route } = await import('../routes/onboarding/index.js')
  await app.register(route, { prefix: '/api/onboarding' })
  await app.ready()
})

afterAll(async () => { await app.close() })

describe('POST /api/onboarding/provision', () => {
  it('非 System Admin → 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/onboarding/provision',
      headers: { authorization: `Bearer ${makeToken(REGULAR_USER_ID)}` },
      payload: { org_name: '測試公司', admin_email: 'admin@test.com' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('缺少必填欄位 → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/onboarding/provision',
      headers: { authorization: `Bearer ${makeToken(SYS_ADMIN_ID)}` },
      payload: { org_name: '測試公司' },  // 缺少 admin_email
    })
    expect(res.statusCode).toBe(400)
  })

  it('完整輸入 → 200，回傳 org_id + invite_link', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/onboarding/provision',
      headers: { authorization: `Bearer ${makeToken(SYS_ADMIN_ID)}` },
      payload: {
        org_name: '台灣好公司',
        admin_email: 'admin@goodcompany.tw',
        plan_name: 'standard',
        license_days: 365,
      },
    })
    expect(res.statusCode).toBe(200)
    const { ok, data } = res.json()
    expect(ok).toBe(true)
    expect(data.org_id).toBeDefined()
    expect(data.invite_link).toBeDefined()
    expect(data.welcome_email_sent).toBe(true)
    expect(data.license_days).toBe(365)
  })

  it('無需 JWT → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/onboarding/provision',
      payload: { org_name: '測試', admin_email: 'x@x.com' },
    })
    expect(res.statusCode).toBe(401)
  })
})
