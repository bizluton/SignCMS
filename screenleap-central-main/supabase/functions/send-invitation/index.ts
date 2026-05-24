import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SITE_NAME = 'SignCMS'
const SENDER_DOMAIN = 'signcms.net'
const FROM_DOMAIN = 'signcms.net'

function buildInvitationEmail(orgName: string, inviterName: string, signupUrl: string): { html: string; text: string } {
  const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:20px 25px">
    <h1 style="font-size:22px;font-weight:bold;color:#000;margin:0 0 20px">組織邀請</h1>
    <p style="font-size:14px;color:#55575d;line-height:1.5;margin:0 0 25px">
      ${inviterName} 邀請您加入 <strong>${orgName}</strong> 組織，使用 ${SITE_NAME} 數位看板管理系統。
    </p>
    <p style="font-size:14px;color:#55575d;line-height:1.5;margin:0 0 25px">
      請點擊下方按鈕註冊帳號並加入組織：
    </p>
    <a href="${signupUrl}" style="display:inline-block;background:#000;color:#fff;font-size:14px;border-radius:8px;padding:12px 20px;text-decoration:none">
      接受邀請並註冊
    </a>
    <p style="font-size:12px;color:#999;margin:30px 0 0">
      如果您不認識發送此邀請的人，可以安全地忽略此郵件。
    </p>
  </div>
</body>
</html>`

  const text = `${inviterName} 邀請您加入 ${orgName} 組織。請前往 ${signupUrl} 註冊並加入。`

  return { html, text }
}

async function getOrCreateUnsubscribeToken(supabase: ReturnType<typeof createClient>, email: string): Promise<string> {
  const { data: existing } = await supabase
    .from('email_unsubscribe_tokens')
    .select('token')
    .eq('email', email)
    .maybeSingle()

  if (existing?.token) return existing.token as string

  const token = crypto.randomUUID()
  await supabase.from('email_unsubscribe_tokens').insert({ email, token })
  return token
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
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

    // Check if user is system admin or org admin
    const { data: sysAdminRow } = await supabase
      .from('system_admins').select('id').eq('user_id', user.id).maybeSingle()
    const isSystemAdmin = !!sysAdminRow

    if (!isSystemAdmin) {
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
    }

    const { email, org_id, resend_invitation_id } = await req.json()

    if (!email || !org_id) {
      return new Response(JSON.stringify({ error: 'email and org_id are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Verify caller belongs to this org (system admins skip this check)
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

    // Check if the email already belongs to an accepted (existing) member
    const { data: acceptedInv } = await supabase
      .from('invitations')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .eq('org_id', org_id)
      .eq('status', 'accepted')
      .maybeSingle()

    if (acceptedInv) {
      return new Response(JSON.stringify({ error: '此 Email 已是該組織成員' }), {
        status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // If resending, delete the old invitation first
    if (resend_invitation_id) {
      await supabase.from('invitations').delete().eq('id', resend_invitation_id)
    } else {
      const { data: existingInv } = await supabase
        .from('invitations')
        .select('id, status')
        .eq('email', email.toLowerCase().trim())
        .eq('org_id', org_id)
        .eq('status', 'pending')
        .maybeSingle()

      if (existingInv) {
        return new Response(JSON.stringify({ error: '此 Email 已有待接受的邀請' }), {
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
    const projectUrl = Deno.env.get('SITE_URL') || 'https://staging.signcms.net'
    const signupUrl = `${projectUrl}/#/auth?invite=${invitation.token}`

    const { html, text } = buildInvitationEmail(orgName, inviterName, signupUrl)

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
        text,
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
