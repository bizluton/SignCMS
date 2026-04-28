/**
 * src/tests/mcp.test.ts
 *
 * MCP Server 端點測試
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import Fastify, { FastifyInstance } from 'fastify'
import jwt from 'jsonwebtoken'

const JWT_SECRET = 'test-jwt-secret'

vi.mock('../lib/env.js', () => ({
  env: {
    PORT: 3001, HOST: '0.0.0.0', NODE_ENV: 'test',
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service',
    SUPABASE_JWT_SECRET: JWT_SECRET,
    REDIS_URL: 'redis://localhost:6379',
    FRONTEND_ORIGIN: 'http://localhost:5173',
    ANTHROPIC_API_KEY: 'sk-ant-test',
  },
}))

const mockScreens = [
  { id: 'screen-001', name: '大廳螢幕', is_online: true, last_seen_at: new Date().toISOString(), location: '1F 大廳' },
  { id: 'screen-002', name: '會議室 A', is_online: false, last_seen_at: null, location: '3F' },
]

vi.mock('../lib/supabase.js', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => Promise.resolve({ data: mockScreens, error: null }),
            single: () => Promise.resolve({ data: mockScreens[0], error: null }),
          }),
          single: () => Promise.resolve({ data: { name: 'Test Org', license_plan: 'pro', license_expires_at: new Date(Date.now() + 86400000 * 30).toISOString() }, error: null }),
          order: () => Promise.resolve({ data: mockScreens, error: null }),
        }),
      }),
      insert: () => Promise.resolve({ error: null }),
    }),
    assertUserInOrg: () => true,
  }),
  assertUserInOrg: vi.fn().mockResolvedValue(true),
}))

// 產生測試用 JWT
function makeToken(userId = 'user-test-001') {
  return jwt.sign(
    { sub: userId, email: 'test@example.com', role: 'authenticated', aud: 'authenticated' },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '1h' }
  )
}

let app: FastifyInstance

beforeAll(async () => {
  app = Fastify()
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try { ;(req as any).rawBody = body; done(null, JSON.parse(body as string)) }
    catch (err) { done(err as Error, undefined) }
  })

  // 需要 jwt plugin for requireAuth
  await app.register(await import('@fastify/jwt' as any).then(m => m.default ?? m), {
    secret: JWT_SECRET,
  })

  const { default: route } = await import('../routes/mcp/index.js')
  await app.register(route, { prefix: '/api/mcp' })
  await app.ready()
})

afterAll(async () => { await app.close() })

const ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001'

describe('POST /api/mcp', () => {
  it('無 JWT → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/mcp',
      payload: { method: 'tools/list' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('tools/list → 回傳所有工具定義', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/mcp',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { method: 'tools/list' },
    })
    expect(res.statusCode).toBe(200)
    const { result } = res.json()
    expect(result.tools).toBeInstanceOf(Array)
    expect(result.tools.length).toBeGreaterThan(0)
    const names = result.tools.map((t: any) => t.name)
    expect(names).toContain('list_screens')
    expect(names).toContain('get_screen_status')
    expect(names).toContain('trigger_smart_rule')
    expect(names).toContain('push_announcement')
    expect(names).toContain('get_org_license_status')
  })

  it('tools/call list_screens → 回傳螢幕列表', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/mcp',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {
        method: 'tools/call',
        params: {
          name: 'list_screens',
          arguments: { org_id: ORG_ID },
        },
      },
    })
    expect(res.statusCode).toBe(200)
    const { result } = res.json()
    expect(result.content[0].type).toBe('text')
    const screens = JSON.parse(result.content[0].text)
    expect(Array.isArray(screens)).toBe(true)
  })

  it('tools/call 缺少 required 參數 → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/mcp',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {
        method: 'tools/call',
        params: {
          name: 'list_screens',
          arguments: {},  // 缺少 org_id
        },
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toContain('org_id')
  })

  it('tools/call 不存在的工具 → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/mcp',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {
        method: 'tools/call',
        params: { name: 'nonexistent_tool', arguments: {} },
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('不支援的 method → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/mcp',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { method: 'resources/list' },
    })
    expect(res.statusCode).toBe(400)
  })
})
