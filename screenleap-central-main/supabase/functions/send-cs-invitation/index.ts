import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Text,
} from 'npm:@react-email/components@0.0.22'
import { getOrCreateUnsubscribeToken } from '../_shared/unsubscribeToken.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const SITE_NAME = 'SignCMS'
const SENDER_DOMAIN = 'signcms.net'
const FROM_DOMAIN = 'signcms.net'

interface CSInvitationEmailProps {
  siteName: string
  inviterName: string
  signupUrl: string
}

const CSInvitationEmail = ({ siteName, inviterName, signupUrl }: CSInvitationEmailProps) => (
  React.createElement(Html, { lang: 'zh-TW', dir: 'ltr' },
    React.createElement(Head, null),
    React.createElement(Preview, null, `您已被邀請加入 ${siteName} 客服團隊`),
    React.createElement(Body, { style: main },
      React.createElement(Container, { style: container },
        React.createElement(Heading, { style: h1 }, '客服人員邀請'),
        React.createElement(Text, { style: text },
          `${inviterName} 邀請您加入 ${siteName} 客服團隊。`
        ),
        React.createElement(Text, { style: text },
          '請點擊下方按鈕註冊帳號並加入客服團隊：'
        ),
        React.createElement(Button, { style: button, href: signupUrl }, '接受邀請並註冊'),
        React.createElement(Text, { style: footer },
          '如果您不認識發送此邀請的人，可以安全地忽略此郵件。'
        )
      )
    )
  )
)

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '20px 25px' }
const h1 = { fontSize: '22px', fontWeight: 'bold' as const, color: '#000000', margin: '0 0 20px' }
const text = { fontSize: '14px', color: '#55575d', lineHeight: '1.5', margin: '0 0 25px' }
const button = {
  backgroundColor: '#000000', color: '#ffffff', fontSize: '14px',
  borderRadius: '8px', padding: '12px 20px', textDecoration: 'none',
}
const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0' }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, serviceKey)

    // Verify the caller is authenticated
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Only system admin or active CS agents can send CS invitations
    const supabaseService = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { data: sysAdminRow } = await supabaseService
      .from('system_admins').select('id').eq('user_id', user.id).maybeSingle()
    let allowed = !!sysAdminRow
    if (!allowed) {
      const { data: csAgents } = await supabase
        .from('cs_agents')
        .select('id')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .limit(1)
      allowed = !!(csAgents && csAgents.length > 0)
    }
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Forbidden: admin or active CS agent only' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { email, cs_agent_id, org_name: bodyOrgName } = await req.json()

    if (!email || !cs_agent_id) {
      return new Response(JSON.stringify({ error: 'email and cs_agent_id are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Get inviter name
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('user_id', user.id)
      .single()

    const inviterName = profile?.display_name || user.email || 'System Admin'

    let orgName = bodyOrgName || ''
    if (!orgName) {
      const { data: inviterOrgs } = await supabase
        .from('team_members')
        .select('teams(org_id, organizations(name))')
        .eq('user_id', user.id)
        .limit(1)
      orgName = (inviterOrgs?.[0] as any)?.teams?.organizations?.name || ''
    }

    // Build signup URL
    const projectUrl = Deno.env.get('SITE_URL') || 'https://staging.signcms.net'
    const signupUrl = `${projectUrl}/#/auth?cs_agent=${cs_agent_id}${orgName ? `&org_name=${encodeURIComponent(orgName)}` : ''}`

    // Render email
    const html = await renderAsync(
      React.createElement(CSInvitationEmail, { siteName: SITE_NAME, inviterName, signupUrl })
    )
    const textContent = `${inviterName} 邀請您加入 ${SITE_NAME} 客服團隊。請前往 ${signupUrl} 註冊並加入。`

    // Enqueue email
    const messageId = crypto.randomUUID()
    const recipientEmail = email.toLowerCase().trim()

    const unsubscribeToken = await getOrCreateUnsubscribeToken(supabase, recipientEmail)

    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: 'cs-invitation',
      recipient_email: recipientEmail,
      status: 'pending',
    })

    const { error: enqueueError } = await supabase.rpc('enqueue_email', {
      queue_name: 'transactional_emails',
      payload: {
        message_id: messageId,
        to: recipientEmail,
        from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
        sender_domain: SENDER_DOMAIN,
        subject: `${inviterName} 邀請您加入 ${SITE_NAME} 客服團隊`,
        html,
        text: textContent,
        purpose: 'transactional',
        idempotency_key: `cs-invitation-${cs_agent_id}`,
        label: 'cs-invitation',
        unsubscribe_token: unsubscribeToken,
        queued_at: new Date().toISOString(),
      },
    })

    if (enqueueError) {
      console.error('Failed to enqueue CS invitation email', enqueueError)
      return new Response(JSON.stringify({ error: 'Failed to send email' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('send-cs-invitation error:', error)
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
