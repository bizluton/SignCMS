/**
 * src/lib/email.ts
 *
 * Email 發送工具
 *
 * 使用 Supabase 現有的 email_queue + process-email-queue Edge Function 架構。
 * BFF 寫入 email_send_state → Edge Function 排程撿起 → 呼叫 Resend 發送。
 *
 * 支援模板：
 *  - customer_welcome    新客戶歡迎信（含登入連結 + License Code）
 *  - license_delivery    License Code 寄送
 *  - license_expiry      到期提醒（7日/1日）
 */

import { supabaseAdmin } from './supabase.js'
import { env } from './env.js'

type EmailTemplate =
  | 'customer_welcome'
  | 'license_delivery'
  | 'license_expiry'

interface SendEmailOptions {
  to: string
  template: EmailTemplate
  variables: Record<string, string>
  orgId?: string
}

/**
 * 將 email 加入 Supabase 的 email queue
 * 實際發送由 process-email-queue Edge Function 處理
 */
export async function enqueueEmail(opts: SendEmailOptions): Promise<{ ok: boolean; error?: string }> {
  const db = supabaseAdmin()

  const { error } = await db.rpc('enqueue_email', {
    _to: opts.to,
    _template: opts.template,
    _variables: opts.variables,
    _org_id: opts.orgId ?? null,
  })

  if (error) {
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

/**
 * 建立 Magic Link 登入 URL（透過 Supabase Admin API）
 */
export async function generateMagicLink(email: string): Promise<string | null> {
  const db = supabaseAdmin()
  const siteUrl = env.FRONTEND_ORIGIN

  const { data, error } = await db.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: {
      redirectTo: `${siteUrl}/onboarding`,
    },
  })

  if (error || !data?.properties?.action_link) {
    return null
  }
  return data.properties.action_link
}

/**
 * 建立邀請連結（新用戶首次設定密碼）
 */
export async function generateInviteLink(email: string, redirectTo?: string): Promise<string | null> {
  const db = supabaseAdmin()

  const { data, error } = await db.auth.admin.generateLink({
    type: 'invite',
    email,
    options: {
      redirectTo: redirectTo ?? `${env.FRONTEND_ORIGIN}/onboarding`,
    },
  })

  if (error || !data?.properties?.action_link) {
    return null
  }
  return data.properties.action_link
}
