/**
 * src/routes/license/index.ts
 *
 * License 管理 API
 *
 * POST /api/license/generate   - System Admin 產生 License Code
 * POST /api/license/redeem     - Org Admin 兌換 License Code
 * GET  /api/license/org/:orgId - 查詢 Org 授權狀態
 * POST /api/license/device/verify - 裝置 License 驗證（取代 Edge Fn）
 */

import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../middleware/auth.js'
import { supabaseAdmin, isSystemAdmin, assertUserHasRole } from '../../lib/supabase.js'
import { randomInt } from 'crypto'

// ─── 產生 6 位 License Code ────────────────────────────────────
function generateLicenseCode(): string {
  return String(randomInt(100000, 999999))
}

const licenseRoutes: FastifyPluginAsync = async (fastify) => {

  // ── POST /api/license/generate（System Admin only）───────────
  fastify.post(
    '/generate',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = request.user!

      // 只有 System Admin 可以產生
      const isAdmin = await isSystemAdmin(user.id)
      if (!isAdmin) {
        return reply.status(403).send({ ok: false, error: 'System admin only' })
      }

      const schema = z.object({
        plan_name: z.string().min(1),
        extend_days: z.number().int().min(1).max(3650),
        count: z.number().int().min(1).max(100).default(1),
        note: z.string().optional(),
      })

      const parsed = schema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: 'Invalid request', details: parsed.error.flatten() })
      }
      const { plan_name, extend_days, count, note } = parsed.data

      const db = supabaseAdmin()
      const codes: string[] = []

      for (let i = 0; i < count; i++) {
        // 確保不重複
        let code: string
        let exists = true
        while (exists) {
          code = generateLicenseCode()
          const { data } = await db.from('license_codes').select('id').eq('code', code).single()
          exists = !!data
        }
        codes.push(code!)
      }

      const inserts = codes.map(code => ({
        code,
        plan_name,
        extend_days,
        status: 'pending' as const,
      }))

      const { data, error } = await db
        .from('license_codes')
        .insert(inserts)
        .select('id, code, plan_name, extend_days, status')

      if (error) {
        return reply.status(500).send({ ok: false, error: 'Failed to create license codes' })
      }

      request.log.info({ count, plan_name, by: user.id }, 'License codes generated')
      return { ok: true, data }
    }
  )

  // ── POST /api/license/redeem（Org Admin）─────────────────────
  fastify.post(
    '/redeem',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = request.user!

      const schema = z.object({
        org_id: z.string().uuid(),
        code: z.string().regex(/^\d{6}$/),
      })

      const parsed = schema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: 'Invalid request', details: parsed.error.flatten() })
      }
      const { org_id, code } = parsed.data

      // 驗證 org_admin 角色
      const isOrgAdmin = await assertUserHasRole(user.id, 'org_admin')
      const isAdmin = await isSystemAdmin(user.id)
      if (!isOrgAdmin && !isAdmin) {
        return reply.status(403).send({ ok: false, error: 'Org admin required' })
      }

      // 呼叫現有的 RPC（保持 DB 邏輯在 Supabase）
      const db = supabaseAdmin()
      const { data, error } = await db.rpc('redeem_license_code', {
        _org_id: org_id,
        _code: code,
        _user_id: user.id,
      })

      if (error) {
        request.log.warn({ error, org_id, code }, 'License redeem failed')
        return reply.status(400).send({ ok: false, error: error.message, code: 'REDEEM_FAILED' })
      }

      request.log.info({ org_id, by: user.id }, 'License code redeemed')
      return { ok: true, data }
    }
  )

  // ── GET /api/license/org/:orgId ───────────────────────────────
  fastify.get<{ Params: { orgId: string } }>(
    '/org/:orgId',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { orgId } = request.params
      const user = request.user!
      const db = supabaseAdmin()

      // System Admin 或該 Org 成員可查
      const isAdmin = await isSystemAdmin(user.id)
      if (!isAdmin) {
        const { data: memberData } = await db.rpc('user_in_org', {
          _user_id: user.id,
          _org_id: orgId,
        })
        if (!memberData) {
          return reply.status(403).send({ ok: false, error: 'Forbidden' })
        }
      }

      const { data, error } = await db
        .from('organizations')
        .select('id, name, license_plan, license_expires_at')
        .eq('id', orgId)
        .single()

      if (error || !data) {
        return reply.status(404).send({ ok: false, error: 'Org not found' })
      }

      const now = new Date()
      const expiresAt = data.license_expires_at ? new Date(data.license_expires_at) : null
      const daysRemaining = expiresAt
        ? Math.ceil((expiresAt.getTime() - now.getTime()) / 86400000)
        : null

      return {
        ok: true,
        data: {
          ...data,
          days_remaining: daysRemaining,
          is_expired: expiresAt ? expiresAt < now : false,
        },
      }
    }
  )

  // ── POST /api/license/device/verify（取代 Edge Fn）──────────
  fastify.post(
    '/device/verify',
    // 裝置端不帶 user JWT，改用 org webhook token 或 open
    async (request, reply) => {
      const schema = z.object({
        device_model: z.string().min(1),
        device_serial: z.string().min(1),
        code: z.string().regex(/^\d{6}$/),
      })

      const parsed = schema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({ valid: false, error: 'invalid_arguments' })
      }
      const { device_model, device_serial, code } = parsed.data

      const db = supabaseAdmin()
      const { data, error } = await db.rpc('verify_device_license', {
        _device_model: device_model,
        _device_serial: device_serial,
        _code: code,
      })

      if (error) {
        return reply.status(500).send({ valid: false, error: error.message })
      }

      const result = data as Record<string, unknown>
      const valid = !!result?.valid
      return reply.status(valid ? 200 : 403).send(result)
    }
  )
}

export default licenseRoutes
