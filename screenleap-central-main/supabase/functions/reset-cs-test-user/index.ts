import { createClient } from 'npm:@supabase/supabase-js@2'
import { getOrCreateUnsubscribeToken } from '../_shared/unsubscribeToken.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const TARGET_EMAIL = 'rainer@bizlution.com'
const SITE_NAME = 'SignCMS'
const SENDER_DOMAIN = 'notify.fms.bizlution.ai'
const FROM_DOMAIN = 'notify.fms.bizlution.ai'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !serviceKey) {
      throw new Error('Missing backend credentials')
    }

    const supabase = createClient(supabaseUrl, serviceKey)
    const body = await req.json().catch(() => ({}))
    const email = String(body?.email ?? '').trim().toLowerCase()

    if (email !== TARGET_EMAIL) {
      return new Response(JSON.stringify({ error: 'Unsupported email' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: usersPage, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
    if (listError) throw listError

    const existingUser = usersPage.users.find((user) => (user.email ?? '').toLowerCase() === email)

    if (existingUser) {
      const { data: targetSysAdmin } = await supabase
        .from('system_admins').select('id').eq('user_id', existingUser.id).maybeSingle()
      if (targetSysAdmin) {
        return new Response(JSON.stringify({ error: 'Cannot reset system administrator' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      await Promise.all([
        supabase.from('agent_status').delete().eq('user_id', existingUser.id),
        supabase.from('team_members').delete().eq('user_id', existingUser.id),
        supabase.from('user_roles').delete().eq('user_id', existingUser.id),
        supabase.from('profiles').delete().eq('user_id', existingUser.id),
        supabase.from('notifications').delete().eq('user_id', existingUser.id),
      ])

      const { error: deleteUserError } = await supabase.auth.admin.deleteUser(existingUser.id)
      if (deleteUserError) throw deleteUserError
    }

    const { error: deleteAgentError } = await supabase.from('cs_agents').delete().eq('email', email)
    if (deleteAgentError) throw deleteAgentError

    const { data: insertedAgent, error: insertAgentError } = await supabase
      .from('cs_agents')
      .insert({
        email,
        invited_by: null,
        status: 'invited',
      })
      .select('id')
      .single()

    if (insertAgentError || !insertedAgent) throw insertAgentError ?? new Error('Failed to recreate cs agent')

    const { data: orgList } = await supabase.from('organizations').select('name').order('created_at', { ascending: true }).limit(1)
    const orgName = orgList?.[0]?.name ?? ''
    const projectUrl = Deno.env.get('SITE_URL') || 'https://trial-signcms.lovable.app'
    const signupUrl = `${projectUrl}/auth?cs_agent=${insertedAgent.id}${orgName ? `&org_name=${encodeURIComponent(orgName)}` : ''}`

    const messageId = crypto.randomUUID()
    const unsubscribeToken = await getOrCreateUnsubscribeToken(supabase, email)

    const subject = `客服團隊邀請｜${SITE_NAME}`
    const html = `
      <html lang="zh-TW">
        <body style="margin:0;padding:24px;background:#f6f7fb;font-family:Arial,sans-serif;color:#111827;">
          <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px 28px;box-shadow:0 10px 30px rgba(15,23,42,0.08);">
            <h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;">重新發送客服邀請</h1>
            <p style="margin:0 0 12px;font-size:15px;line-height:1.7;">您好，這是重新發送的客服代理邀請信。</p>
            <p style="margin:0 0 24px;font-size:15px;line-height:1.7;">請點擊下方按鈕完成註冊、驗證信箱，並登入客服面板。</p>
            <a href="${signupUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-size:14px;font-weight:700;">接受邀請並註冊</a>
            <p style="margin:24px 0 0;font-size:13px;line-height:1.7;color:#6b7280;word-break:break-all;">若按鈕無法使用，可改用此連結：${signupUrl}</p>
          </div>
        </body>
      </html>
    `
    const text = `請使用以下連結完成客服代理註冊：${signupUrl}`

    const { error: logError } = await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: 'cs-invitation',
      recipient_email: email,
      status: 'pending',
    })
    if (logError) throw logError

    const { error: enqueueError } = await supabase.rpc('enqueue_email', {
      queue_name: 'transactional_emails',
      payload: {
        message_id: messageId,
        to: email,
        from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
        sender_domain: SENDER_DOMAIN,
        subject,
        html,
        text,
        purpose: 'transactional',
        idempotency_key: `cs-invitation-reset-${insertedAgent.id}`,
        label: 'cs-invitation',
        unsubscribe_token: unsubscribeToken,
        queued_at: new Date().toISOString(),
      },
    })
    if (enqueueError) throw enqueueError

    return new Response(JSON.stringify({ success: true, cs_agent_id: insertedAgent.id, signup_url: signupUrl }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('reset-cs-test-user error:', error)
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})