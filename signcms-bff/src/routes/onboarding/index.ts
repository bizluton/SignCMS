/**
 * src/routes/onboarding/index.ts
 *
 * 客戶 Onboarding 自動化 API（System Admin only）
 *
 * POST /api/onboarding/provision
 *   完整的客戶開通流程（一鍵）：
 *   1. 建立 Supabase Auth 使用者
 *   2. 建立 Organization
 *   3. 設定 org_admin 角色
 *   4. 產生 License Code 並兌換（直接套用，不需客戶手動兌換）
 *   5. 寄送歡迎 Email（含登入連結）
 *   6. 回傳完整的開通資訊
 *
 * POST /api/onboarding/resend-welcome
 *   重新寄送歡迎信（客戶說沒收到時用）
 *
 * GET /api/onboarding/status/:orgId
 *   查詢 Org 的開通狀態
 */

import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../middleware/auth.js'
import { supabaseAdmin, isSystemAdmin } from '../../lib/supabase.js'
import { generateInviteLink, enqueueEmail } from '../../lib/email.js'
import { randomInt } from 'crypto'

function generateLicenseCode(): string {
  return String(randomInt(100000, 999999))
}

// ─── Provision Schema ─────────────────────────────────────────

const provisionSchema = z.object({
  // 客戶基本資料
  org_name: z.string().min(2).max(100),
  admin_email: z.string().email(),
  admin_display_name: z.string().min(1).max(60).optional(),

  // 授權方案
  plan_name: z.string().default('standard'),
  license_days: z.number().int().min(1).max(3650).default(365),

  // 可選設定
  locale: z.enum(['zh', 'en', 'ja']).default('zh'),
  note: z.string().max(500).optional(),  // 內部備註，不會送給客戶
})

// ─── Route ────────────────────────────────────────────────────

const onboardingRoutes: FastifyPluginAsync = async (fastify) => {

  // ── POST /api/onboarding/provision ────────────────────────
  fastify.post(
    '/provision',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = request.user!

      // System Admin only
      if (!(await isSystemAdmin(user.id))) {
        return reply.status(403).send({ ok: false, error: 'System admin only' })
      }

      const parsed = provisionSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({
          ok: false, error: 'Invalid input', details: parsed.error.flatten(),
        })
      }
      const input = parsed.data
      const db = supabaseAdmin()

      // ── Step 1: 建立 Supabase Auth 使用者 ──────────────────
      request.log.info({ email: input.admin_email }, '[onboarding] creating user')

      const { data: newUser, error: userErr } = await db.auth.admin.createUser({
        email: input.admin_email,
        email_confirm: true,  // 直接確認，不需要客戶點驗證信
        user_metadata: {
          display_name: input.admin_display_name ?? input.admin_email.split('@')[0],
        },
      })

      if (userErr) {
        // 若使用者已存在，取得現有 user
        if (userErr.message.includes('already registered')) {
          const { data: existing } = await db.auth.admin.listUsers()
          const existingUser = existing?.users?.find(u => u.email === input.admin_email)
          if (!existingUser) {
            return reply.status(400).send({ ok: false, error: '用戶已存在但無法取得' })
          }
          // 繼續使用現有 user
          request.log.info({ userId: existingUser.id }, '[onboarding] using existing user')
        } else {
          return reply.status(500).send({ ok: false, error: `建立使用者失敗：${userErr.message}` })
        }
      }

      const adminUserId = newUser?.user?.id ?? (
        await db.auth.admin.listUsers()
          .then(r => r.data?.users?.find(u => u.email === input.admin_email)?.id)
      )

      if (!adminUserId) {
        return reply.status(500).send({ ok: false, error: '無法取得使用者 ID' })
      }

      // ── Step 2: 建立 Organization ──────────────────────────
      request.log.info({ orgName: input.org_name }, '[onboarding] creating org')

      const { data: orgData, error: orgErr } = await db.rpc('bootstrap_user_organization', {
        _user_id: adminUserId,
        _org_name: input.org_name,
      })

      if (orgErr) {
        return reply.status(500).send({ ok: false, error: `建立組織失敗：${orgErr.message}` })
      }

      const orgId: string = (orgData as any)?.org_id ?? orgData

      // ── Step 3: 確保 org_admin 角色 ────────────────────────
      await db.from('user_roles').upsert({
        user_id: adminUserId,
        org_id: orgId,
        role: 'org_admin',
      }, { onConflict: 'user_id,org_id' })

      // ── Step 4: 產生 License Code 並直接兌換 ───────────────
      request.log.info({ orgId, days: input.license_days }, '[onboarding] applying license')

      // 確保 code 不重複
      let licenseCode: string
      let codeExists = true
      while (codeExists) {
        licenseCode = generateLicenseCode()
        const { data } = await db.from('license_codes').select('id').eq('code', licenseCode).single()
        codeExists = !!data
      }

      // 寫入 license_codes
      await db.from('license_codes').insert({
        code: licenseCode!,
        plan_name: input.plan_name,
        extend_days: input.license_days,
        status: 'pending',
      })

      // 直接兌換（不需要客戶手動輸入）
      const { error: redeemErr } = await db.rpc('redeem_license_code', {
        _org_id: orgId,
        _code: licenseCode!,
        _user_id: adminUserId,
      })

      if (redeemErr) {
        request.log.warn({ err: redeemErr, orgId }, '[onboarding] license redeem failed, continuing...')
        // 不阻止流程，手動補處理
      }

      // ── Step 5: 產生邀請連結 + 寄送歡迎信 ─────────────────
      request.log.info({ email: input.admin_email }, '[onboarding] sending welcome email')

      const inviteLink = await generateInviteLink(input.admin_email)

      if (inviteLink) {
        await enqueueEmail({
          to: input.admin_email,
          template: 'customer_welcome',
          orgId,
          variables: {
            org_name: input.org_name,
            admin_name: input.admin_display_name ?? input.admin_email,
            login_url: inviteLink,
            plan_name: input.plan_name,
            license_days: String(input.license_days),
            expires_date: new Date(Date.now() + input.license_days * 86400000)
              .toLocaleDateString('zh-TW'),
          },
        })
      }

      // ── 記錄 Activity Log ───────────────────────────────────
      await db.from('activity_logs').insert({
        user_id: user.id,
        org_id: orgId,
        action: 'provision_org',
        action_code: 'admin.provision_org',
        action_params: {
          org_name: input.org_name,
          admin_email: input.admin_email,
          plan_name: input.plan_name,
          license_days: input.license_days,
        },
        category: 'admin',
        target_id: orgId,
        target_type: 'organization',
        target_name: input.org_name,
      })

      request.log.info({ orgId, adminUserId }, '[onboarding] provision complete ✅')

      return {
        ok: true,
        data: {
          org_id: orgId,
          org_name: input.org_name,
          admin_user_id: adminUserId,
          admin_email: input.admin_email,
          license_code: licenseCode!,
          plan_name: input.plan_name,
          license_days: input.license_days,
          invite_link: inviteLink,  // System Admin 可複製備用
          welcome_email_sent: !!inviteLink,
          provisioned_at: new Date().toISOString(),
        },
      }
    }
  )

  // ── POST /api/onboarding/resend-welcome ────────────────────
  fastify.post(
    '/resend-welcome',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = request.user!
      if (!(await isSystemAdmin(user.id))) {
        return reply.status(403).send({ ok: false, error: 'System admin only' })
      }

      const schema = z.object({ org_id: z.string().uuid() })
      const parsed = schema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: 'Invalid org_id' })
      }

      const db = supabaseAdmin()
      const { data: org } = await db
        .from('organizations')
        .select('id, name')
        .eq('id', parsed.data.org_id)
        .single()

      if (!org) return reply.status(404).send({ ok: false, error: 'Org not found' })

      // 找到 org_admin 的 email
      const { data: adminRole } = await db
        .from('user_roles')
        .select('user_id')
        .eq('org_id', parsed.data.org_id)
        .eq('role', 'org_admin')
        .limit(1)
        .single()

      if (!adminRole) return reply.status(404).send({ ok: false, error: 'Org admin not found' })

      const { data: adminUser } = await db.auth.admin.getUserById(adminRole.user_id)
      if (!adminUser?.user?.email) {
        return reply.status(404).send({ ok: false, error: 'Admin email not found' })
      }

      const magicLink = await generateInviteLink(adminUser.user.email)

      await enqueueEmail({
        to: adminUser.user.email,
        template: 'customer_welcome',
        orgId: org.id,
        variables: {
          org_name: org.name,
          admin_name: adminUser.user.email,
          login_url: magicLink ?? `${process.env.FRONTEND_ORIGIN}/auth`,
          plan_name: '（請洽管理員）',
          license_days: '',
          expires_date: '',
        },
      })

      return { ok: true, data: { email_sent_to: adminUser.user.email } }
    }
  )

  // ── GET /api/onboarding/status/:orgId ──────────────────────
  fastify.get<{ Params: { orgId: string } }>(
    '/status/:orgId',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = request.user!
      if (!(await isSystemAdmin(user.id))) {
        return reply.status(403).send({ ok: false, error: 'System admin only' })
      }

      const db = supabaseAdmin()
      const { orgId } = request.params

      const { data: org } = await db
        .from('organizations')
        .select('id, name, license_plan, license_expires_at, created_at, webhook_token')
        .eq('id', orgId)
        .single()

      if (!org) return reply.status(404).send({ ok: false, error: 'Org not found' })

      // 統計：螢幕數、使用者數、媒體數
      const [screensRes, membersRes] = await Promise.all([
        db.from('screens').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
        db.from('team_members').select('user_id', { count: 'exact', head: true })
          .in('team_id',
            await db.from('teams').select('id').eq('org_id', orgId)
              .then(r => (r.data ?? []).map((t: any) => t.id))
          ),
      ])

      const expiresAt = org.license_expires_at ? new Date(org.license_expires_at) : null
      const daysRemaining = expiresAt
        ? Math.ceil((expiresAt.getTime() - Date.now()) / 86400000)
        : null

      return {
        ok: true,
        data: {
          org_id: org.id,
          org_name: org.name,
          license_plan: org.license_plan,
          license_expires_at: org.license_expires_at,
          days_remaining: daysRemaining,
          is_expired: expiresAt ? expiresAt < new Date() : false,
          webhook_token: org.webhook_token,
          screen_count: screensRes.count ?? 0,
          member_count: membersRes.count ?? 0,
          created_at: org.created_at,
        },
      }
    }
  )
}

export default onboardingRoutes
