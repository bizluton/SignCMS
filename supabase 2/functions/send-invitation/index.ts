import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Text, Link,
} from 'npm:@react-email/components@0.0.22'
import { getOrCreateUnsubscribeToken } from '../_shared/unsubscribeToken.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const SITE_NAME = 'SignCMS'
const SENDER_DOMAIN = 'notify.fms.bizlution.ai'
const FROM_DOMAIN = 'notify.fms.bizlution.ai'

// Invitation email template
interface InvitationEmailProps {
  siteName: string
  orgName: string
  inviterName: string
  signupUrl: string
}

const InvitationEmail = ({ siteName, orgName, inviterName, signupUrl }: InvitationEmailProps) => (
  React.createElement(Html, { lang: 'zh-TW', dir: 'ltr' },
    React.createElement(Head, null),
    React.createElement(Preview, null, `您已被邀請加入 ${orgName} - ${siteName}`),
    React.createElement(Body, { style: main },
      React.createElement(Container, { style: container },
        React.createElement(Heading, { style: h1 }, '組織邀請'),
        React.createElement(Text, { style: text },
          `${inviterName} 邀請您加入`,
          React.createElement('strong', null, ` ${orgName} `),
          `組織，使用 ${siteName} 數位看板管理系統。`
        ),
        React.createElement(Text, { style: text },
          '請點擊下方按鈕註冊帳號並加入組織：'
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

    // Check if user is admin (user may have multiple role rows; use limit instead of maybeSingle)
    const { data: roleRows } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .in('role', ['admin', 'org_admin'])
      .limit(1)

    if (!roleRows || roleRows.length === 0) {
      return new Response(JSON.stringify({ error: 'Forbidden: admin or org_admin only' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { email, org_id, resend_invitation_id } = await req.json()

    if (!email || !org_id) {
      return new Response(JSON.stringify({ error: 'email and org_id are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Verify caller belongs to this org (or is system admin)
    const isSystemAdmin = user.id === '3fbb2f97-7268-4cac-a511-7cff6654a8f7'
    if (!isSystemAdmin) {
      const { data: inOrg } = await supabase.rpc('user_in_org', {
        _user_id: user.id, _org_id: org_id,
      })
      if (!inOrg) {
        return new Response(JSON.stringify({ error: 'Not in this organization' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    // If resending, delete the old invitation first
    if (resend_invitation_id) {
      await supabase.from('invitations').delete().eq('id', resend_invitation_id)
    } else {
      // Check if invitation already exists and is pending (only for new invitations)
      const { data: existingInv } = await supabase
        .from('invitations')
        .select('id, status')
        .eq('email', email.toLowerCase().trim())
        .eq('org_id', org_id)
        .eq('status', 'pending')
        .maybeSingle()

      if (existingInv) {
        return new Response(JSON.stringify({ error: 'Invitation already sent to this email' }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    // Get org name and inviter name
    const [{ data: org }, { data: profile }] = await Promise.all([
      supabase.from('organizations').select('name').eq('id', org_id).single(),
      supabase.from('profiles').select('display_name').eq('user_id', user.id).single(),
    ])

    const orgName = org?.name || 'Organization'
    const inviterName = profile?.display_name || user.email || 'Admin'

    // Create invitation record
    const { data: invitation, error: invError } = await supabase
      .from('invitations')
      .insert({
        email: email.toLowerCase().trim(),
        org_id,
        invited_by: user.id,
      })
      .select('id, token')
      .single()

    if (invError) {
      console.error('Failed to create invitation', invError)
      return new Response(JSON.stringify({ error: invError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Build signup URL with invitation token
    const projectUrl = Deno.env.get('SITE_URL') || `https://${Deno.env.get('SUPABASE_URL')?.replace('https://', '').replace('.supabase.co', '.lovableproject.com')}` || 'https://signcms.lovable.app'
    const signupUrl = `${projectUrl}/auth?invite=${invitation.token}`

    // Render email
    const html = await renderAsync(
      React.createElement(InvitationEmail, { siteName: SITE_NAME, orgName, inviterName, signupUrl })
    )
    const textContent = `${inviterName} 邀請您加入 ${orgName} 組織。請前往 ${signupUrl} 註冊並加入。`

    // Enqueue email
    const messageId = crypto.randomUUID()
    const recipientEmail = email.toLowerCase().trim()

    const unsubscribeToken = await getOrCreateUnsubscribeToken(supabase, recipientEmail)

    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: 'invitation',
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
        subject: `${inviterName} 邀請您加入 ${orgName} - ${SITE_NAME}`,
        html,
        text: textContent,
        purpose: 'transactional',
        idempotency_key: `invitation-${invitation.id}`,
        label: 'invitation',
        unsubscribe_token: unsubscribeToken,
        queued_at: new Date().toISOString(),
      },
    })

    if (enqueueError) {
      console.error('Failed to enqueue invitation email', enqueueError)
      return new Response(JSON.stringify({ error: 'Failed to send email' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true, invitation_id: invitation.id }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('send-invitation error:', error)
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
