/**
 * src/routes/admin/portal.ts
 *
 * 客戶管理 Portal API（System Admin only）
 *
 * GET  /api/admin/orgs              — 列出所有 Org（含授權狀態、健康度）
 * GET  /api/admin/orgs/:orgId       — 單一 Org 詳細資訊
 * POST /api/admin/orgs/:orgId/extend-license  — 延長授權
 * POST /api/admin/orgs/:orgId/suspend         — 暫停（標記到期）
 * GET  /api/admin/stats             — 平台整體統計
 * GET  /api/admin/license-codes     — 列出所有 License Code
 */

import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../middleware/auth.js'
import { supabaseAdmin, isSystemAdmin } from '../../lib/supabase.js'

// ─── System Admin guard（作為 preHandler 陣列成員）────────────

async function requireSysAdmin(request: any, reply: any): Promise<void> {
  if (!request.user) { reply.status(401).send({ ok: false, error: 'Unauthorized' }); return }
  const ok = await isSystemAdmin(request.user.id)
  if (!ok) reply.status(403).send({ ok: false, error: 'System admin only' })
}

// ─── Route ────────────────────────────────────────────────────

const adminPortalRoute: FastifyPluginAsync = async (fastify) => {

  // ── GET /api/admin/stats ───────────────────────────────────
  fastify.get('/stats', { preHandler: [requireAuth, requireSysAdmin] }, async () => {
    const db = supabaseAdmin()

    const now = new Date()
    const sevenDaysLater = new Date(now.getTime() + 7 * 86400000)

    const [orgsRes, screensRes, activeOrgsRes, expiringRes, expiredRes] = await Promise.all([
      db.from('organizations').select('id', { count: 'exact', head: true }),
      db.from('screens').select('id', { count: 'exact', head: true }),
      db.from('organizations')
        .select('id', { count: 'exact', head: true })
        .gt('license_expires_at', now.toISOString()),
      db.from('organizations')
        .select('id', { count: 'exact', head: true })
        .gt('license_expires_at', now.toISOString())
        .lt('license_expires_at', sevenDaysLater.toISOString()),
      db.from('organizations')
        .select('id', { count: 'exact', head: true })
        .lt('license_expires_at', now.toISOString()),
    ])

    return {
      ok: true,
      data: {
        total_orgs: orgsRes.count ?? 0,
        active_orgs: activeOrgsRes.count ?? 0,
        expiring_soon: expiringRes.count ?? 0,   // 7 天內到期
        expired_orgs: expiredRes.count ?? 0,
        total_screens: screensRes.count ?? 0,
        generated_at: now.toISOString(),
      },
    }
  })

  // ── GET /api/admin/orgs ────────────────────────────────────
  fastify.get<{
    Querystring: { page?: string; per_page?: string; status?: string; search?: string }
  }>(
    '/orgs',
    { preHandler: [requireAuth, requireSysAdmin] },
    async (request) => {
      const db = supabaseAdmin()
      const page = Math.max(1, parseInt(request.query.page ?? '1'))
      const perPage = Math.min(100, parseInt(request.query.per_page ?? '20'))
      const from = (page - 1) * perPage
      const now = new Date().toISOString()

      let query = db
        .from('organizations')
        .select('id, name, license_plan, license_expires_at, created_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, from + perPage - 1)

      if (request.query.search) {
        query = query.ilike('name', `%${request.query.search}%`)
      }
      if (request.query.status === 'active') {
        query = query.gt('license_expires_at', now)
      } else if (request.query.status === 'expired') {
        query = query.lt('license_expires_at', now)
      } else if (request.query.status === 'expiring') {
        const soon = new Date(Date.now() + 7 * 86400000).toISOString()
        query = query.gt('license_expires_at', now).lt('license_expires_at', soon)
      }

      const { data, count, error } = await query
      if (error) return { ok: false, error: error.message }

      const enriched = (data ?? []).map((org: any) => {
        const expiresAt = org.license_expires_at ? new Date(org.license_expires_at) : null
        const daysRemaining = expiresAt
          ? Math.ceil((expiresAt.getTime() - Date.now()) / 86400000)
          : null
        return {
          ...org,
          days_remaining: daysRemaining,
          status: !expiresAt ? 'unknown'
            : expiresAt < new Date() ? 'expired'
            : daysRemaining! <= 7 ? 'expiring'
            : 'active',
        }
      })

      return {
        ok: true,
        data: enriched,
        pagination: {
          page, per_page: perPage,
          total: count ?? 0,
          total_pages: Math.ceil((count ?? 0) / perPage),
        },
      }
    }
  )

  // ── GET /api/admin/orgs/:orgId ─────────────────────────────
  fastify.get<{ Params: { orgId: string } }>(
    '/orgs/:orgId',
    { preHandler: [requireAuth, requireSysAdmin] },
    async (request, reply) => {
      const db = supabaseAdmin()
      const { orgId } = request.params

      const { data: org, error } = await db
        .from('organizations')
        .select('*')
        .eq('id', orgId)
        .single()

      if (error || !org) return reply.status(404).send({ ok: false, error: 'Org not found' })

      // 取得 org admin email
      const { data: adminRole } = await db
        .from('user_roles')
        .select('user_id')
        .eq('org_id', orgId)
        .eq('role', 'org_admin')
        .limit(1)
        .single()

      let adminEmail: string | null = null
      if (adminRole) {
        const { data: adminUser } = await db.auth.admin.getUserById(adminRole.user_id)
        adminEmail = adminUser?.user?.email ?? null
      }

      // 統計
      const [screensRes, redeemRes] = await Promise.all([
        db.from('screens').select('id, name, is_online').eq('org_id', orgId),
        db.from('license_redeem_attempts')
          .select('id, created_at, success')
          .eq('org_id', orgId)
          .order('created_at', { ascending: false })
          .limit(5),
      ])

      const expiresAt = org.license_expires_at ? new Date(org.license_expires_at) : null
      const daysRemaining = expiresAt
        ? Math.ceil((expiresAt.getTime() - Date.now()) / 86400000)
        : null

      return {
        ok: true,
        data: {
          ...org,
          admin_email: adminEmail,
          days_remaining: daysRemaining,
          status: !expiresAt ? 'unknown'
            : expiresAt < new Date() ? 'expired'
            : daysRemaining! <= 7 ? 'expiring'
            : 'active',
          screens: screensRes.data ?? [],
          screen_count: screensRes.data?.length ?? 0,
          online_count: screensRes.data?.filter((s: any) => s.is_online).length ?? 0,
          recent_license_attempts: redeemRes.data ?? [],
        },
      }
    }
  )

  // ── POST /api/admin/orgs/:orgId/extend-license ─────────────
  fastify.post<{ Params: { orgId: string } }>(
    '/orgs/:orgId/extend-license',
    { preHandler: [requireAuth, requireSysAdmin] },
    async (request, reply) => {
      const schema = z.object({
        extend_days: z.number().int().min(1).max(3650),
        note: z.string().optional(),
      })
      const parsed = schema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: 'Invalid input' })
      }
      const { extend_days } = parsed.data
      const { orgId } = request.params
      const user = request.user!
      const db = supabaseAdmin()

      // 產生並直接兌換一個 License Code
      let code: string
      let exists = true
      while (exists) {
        code = String(Math.floor(100000 + Math.random() * 900000))
        const { data } = await db.from('license_codes').select('id').eq('code', code).single()
        exists = !!data
      }

      await db.from('license_codes').insert({
        code: code!,
        plan_name: 'extension',
        extend_days,
        status: 'pending',
      })

      const { error } = await db.rpc('redeem_license_code', {
        _org_id: orgId,
        _code: code!,
        _user_id: user.id,
      })

      if (error) {
        return reply.status(500).send({ ok: false, error: `延長失敗：${error.message}` })
      }

      // 取得更新後的到期日
      const { data: updatedOrg } = await db
        .from('organizations')
        .select('license_expires_at')
        .eq('id', orgId)
        .single()

      await db.from('activity_logs').insert({
        user_id: user.id,
        org_id: orgId,
        action: 'extend_license',
        action_code: 'admin.extend_license',
        action_params: { extend_days, note: parsed.data.note },
        category: 'admin',
        target_id: orgId,
        target_type: 'organization',
      })

      return {
        ok: true,
        data: {
          org_id: orgId,
          extended_days: extend_days,
          new_expires_at: updatedOrg?.license_expires_at,
        },
      }
    }
  )

  // ── POST /api/admin/orgs/:orgId/suspend ────────────────────
  fastify.post<{ Params: { orgId: string } }>(
    '/orgs/:orgId/suspend',
    { preHandler: [requireAuth, requireSysAdmin] },
    async (request, reply) => {
      const schema = z.object({ reason: z.string().min(1) })
      const parsed = schema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: 'reason is required' })
      }

      const db = supabaseAdmin()
      const { orgId } = request.params
      const user = request.user!

      // 將 license_expires_at 設為過去，立即停用
      const { error } = await db.from('organizations')
        .update({ license_expires_at: new Date(0).toISOString() })
        .eq('id', orgId)

      if (error) {
        return reply.status(500).send({ ok: false, error: error.message })
      }

      await db.from('activity_logs').insert({
        user_id: user.id,
        org_id: orgId,
        action: 'suspend_org',
        action_code: 'admin.suspend_org',
        action_params: { reason: parsed.data.reason },
        category: 'admin',
        target_id: orgId,
        target_type: 'organization',
      })

      return { ok: true, data: { org_id: orgId, status: 'suspended' } }
    }
  )

  // ── GET /api/admin/license-codes ──────────────────────────
  fastify.get<{
    Querystring: { status?: string; page?: string }
  }>(
    '/license-codes',
    { preHandler: [requireAuth, requireSysAdmin] },
    async (request) => {
      const db = supabaseAdmin()
      const page = Math.max(1, parseInt(request.query.page ?? '1'))
      const perPage = 50
      const from = (page - 1) * perPage

      let query = db
        .from('license_codes')
        .select('id, code, plan_name, extend_days, status, redeemed_by, redeemed_at, created_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, from + perPage - 1)

      if (request.query.status) {
        query = query.eq('status', request.query.status)
      }

      const { data, count, error } = await query
      if (error) return { ok: false, error: error.message }

      return {
        ok: true,
        data: data ?? [],
        pagination: {
          page, per_page: perPage,
          total: count ?? 0,
          total_pages: Math.ceil((count ?? 0) / perPage),
        },
      }
    }
  )
}

export default adminPortalRoute
