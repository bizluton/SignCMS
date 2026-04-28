/**
 * src/middleware/auth.ts
 *
 * Supabase JWT 驗證 middleware
 *
 * Supabase 的 JWT 使用 HS256 + SUPABASE_JWT_SECRET 簽名。
 * 驗證通過後將 user context 掛在 request.user，供 route handler 使用。
 *
 * 使用方式：
 *   // 保護單一 route
 *   fastify.get('/protected', { preHandler: [requireAuth] }, handler)
 *
 *   // 保護整個 plugin
 *   fastify.addHook('preHandler', requireAuth)
 */

import { FastifyRequest, FastifyReply } from 'fastify'
import jwt from 'jsonwebtoken'
import { env } from '../lib/env.js'
import type { SupabaseJwtPayload, RequestUser } from '../types/api.js'

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization

  if (!authHeader?.startsWith('Bearer ')) {
    reply.status(401).send({ ok: false, error: 'Missing authorization header' })
    return
  }

  const token = authHeader.slice(7)

  try {
    const payload = jwt.verify(token, env.SUPABASE_JWT_SECRET) as SupabaseJwtPayload

    if (payload.role === 'anon') {
      reply.status(401).send({ ok: false, error: 'Anonymous access not allowed' })
      return
    }

    request.user = {
      id: payload.sub,
      email: payload.email,
      orgId: payload.org_id,
      role: payload.user_role,
    }
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      reply.status(401).send({ ok: false, error: 'Token expired', code: 'TOKEN_EXPIRED' })
    } else {
      reply.status(401).send({ ok: false, error: 'Invalid token' })
    }
  }
}

// ─── 角色守衛 ──────────────────────────────────────────────────

/**
 * 要求 system admin（system_admins 資料表）
 * 使用前必須先掛 requireAuth
 */
export function requireSystemAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  done: () => void
): void {
  if (!request.user) {
    reply.status(401).send({ ok: false, error: 'Unauthorized' })
    return
  }
  // system admin 的判斷在 route handler 內用 isSystemAdmin() helper
  // 這裡只確保有 user context
  done()
}

/**
 * 要求使用者屬於指定 org（從 request params 取 orgId）
 */
export async function requireOrgMember(
  request: FastifyRequest<{ Params: { orgId: string } }>,
  reply: FastifyReply
): Promise<void> {
  if (!request.user) {
    reply.status(401).send({ ok: false, error: 'Unauthorized' })
    return
  }

  const { assertUserInOrg } = await import('../lib/supabase.js')
  const ok = await assertUserInOrg(request.user.id, request.params.orgId)
  if (!ok) {
    reply.status(403).send({ ok: false, error: 'Forbidden: not a member of this org' })
  }
}
