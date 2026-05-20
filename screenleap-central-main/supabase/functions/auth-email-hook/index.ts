import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { SignupEmail } from '../_shared/email-templates/signup.tsx'
import { InviteEmail } from '../_shared/email-templates/invite.tsx'
import { MagicLinkEmail } from '../_shared/email-templates/magic-link.tsx'
import { RecoveryEmail } from '../_shared/email-templates/recovery.tsx'
import { EmailChangeEmail } from '../_shared/email-templates/email-change.tsx'
import { ReauthenticationEmail } from '../_shared/email-templates/reauthentication.tsx'
import { bearerEquals } from '../_shared/timingSafeEqual.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const EMAIL_SUBJECTS: Record<string, string> = {
  signup: 'Confirm your email',
  invite: "You've been invited",
  magiclink: 'Your login link',
  recovery: 'Reset your password',
  email_change: 'Confirm your new email',
  reauthentication: 'Your verification code',
}

const EMAIL_TEMPLATES: Record<string, React.ComponentType<any>> = {
  signup: SignupEmail,
  invite: InviteEmail,
  magiclink: MagicLinkEmail,
  recovery: RecoveryEmail,
  email_change: EmailChangeEmail,
  reauthentication: ReauthenticationEmail,
}

const SITE_NAME = 'SignCMS'
const SENDER_DOMAIN = 'signcms.net'
const ROOT_DOMAIN = 'signcms.net'
const FROM_DOMAIN = 'signcms.net'

// Supabase auth hook payload (Send Email hook)
interface AuthHookEmailData {
  token: string
  token_hash: string
  redirect_to: string
  email_action_type: string
  site_url: string
  token_new: string
  token_hash_new: string
}
interface AuthHookPayload {
  user: { id: string; email: string; [key: string]: unknown }
  email_data: AuthHookEmailData
}

// Build the Supabase verification URL from token_hash + action type + redirect
function buildConfirmationUrl(
  supabaseUrl: string,
  tokenHash: string,
  actionType: string,
  redirectTo: string,
): string {
  const base = `${supabaseUrl}/auth/v1/verify`
  const params = new URLSearchParams({
    token: tokenHash,
    type: actionType,
    redirect_to: redirectTo,
  })
  return `${base}?${params.toString()}`
}

// Preview endpoint — returns rendered HTML for a given email type
async function handlePreview(req: Request): Promise<Response> {
  const previewHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: previewHeaders })
  }

  const hookSecret = Deno.env.get('HOOK_SECRET')
  const authHeader = req.headers.get('Authorization')
  if (!hookSecret || authHeader !== `Bearer ${hookSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...previewHeaders, 'Content-Type': 'application/json' },
    })
  }

  let type: string
  try {
    const body = await req.json()
    type = body.type
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), {
      status: 400,
      headers: { ...previewHeaders, 'Content-Type': 'application/json' },
    })
  }

  const EmailTemplate = EMAIL_TEMPLATES[type]
  if (!EmailTemplate) {
    return new Response(JSON.stringify({ error: `Unknown email type: ${type}` }), {
      status: 400,
      headers: { ...previewHeaders, 'Content-Type': 'application/json' },
    })
  }

  const sampleUrl = `https://${ROOT_DOMAIN}`
  const sampleProps: Record<string, unknown> = {
    siteName: SITE_NAME,
    siteUrl: sampleUrl,
    recipient: 'user@example.test',
    confirmationUrl: sampleUrl,
    token: '123456',
    email: 'user@example.test',
    newEmail: 'new@example.test',
  }
  const html = await renderAsync(React.createElement(EmailTemplate, sampleProps))

  return new Response(html, {
    status: 200,
    headers: { ...previewHeaders, 'Content-Type': 'text/html; charset=utf-8' },
  })
}

// Main hook handler — receives Supabase auth hook payload and enqueues email
async function handleWebhook(req: Request): Promise<Response> {
  // Supabase auth hooks call with: Authorization: Bearer {HOOK_SECRET}
  // Configure HOOK_SECRET in Supabase Dashboard → Auth → Hooks (signing secret)
  // and as an edge function secret with the same value.
  const hookSecret = Deno.env.get('HOOK_SECRET')
  if (!hookSecret) {
    console.error('HOOK_SECRET not configured')
    return new Response(
      JSON.stringify({ error: 'Server configuration error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const authHeader = req.headers.get('Authorization')
  if (!bearerEquals(authHeader, hookSecret)) {
    console.error('Invalid hook secret')
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let payload: AuthHookPayload
  try {
    payload = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const emailType = payload.email_data?.email_action_type
  const recipientEmail = payload.user?.email

  if (!emailType || !recipientEmail) {
    console.error('Missing emailType or recipientEmail in hook payload', { payload })
    return new Response(JSON.stringify({ error: 'Invalid hook payload' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const EmailTemplate = EMAIL_TEMPLATES[emailType]
  if (!EmailTemplate) {
    console.error('Unknown email type', { emailType })
    return new Response(JSON.stringify({ error: `Unknown email type: ${emailType}` }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const ed = payload.email_data

  // Build confirmation URL from token_hash (standard Supabase verify endpoint)
  const confirmationUrl = buildConfirmationUrl(
    supabaseUrl,
    ed.token_hash || ed.token_hash_new || '',
    emailType,
    ed.redirect_to || ed.site_url || '',
  )

  const templateProps = {
    siteName: SITE_NAME,
    siteUrl: `https://${ROOT_DOMAIN}`,
    recipient: recipientEmail,
    confirmationUrl,
    token: ed.token,
    email: recipientEmail,
    newEmail: payload.user?.new_email as string | undefined,
  }

  const html = await renderAsync(React.createElement(EmailTemplate, templateProps))
  const text = await renderAsync(React.createElement(EmailTemplate, templateProps), { plainText: true })

  const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const messageId = crypto.randomUUID()

  await supabase.from('email_send_log').insert({
    message_id: messageId,
    template_name: emailType,
    recipient_email: recipientEmail,
    status: 'pending',
  })

  const { error: enqueueError } = await supabase.rpc('enqueue_email', {
    queue_name: 'auth_emails',
    payload: {
      message_id: messageId,
      to: recipientEmail,
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      sender_domain: SENDER_DOMAIN,
      subject: EMAIL_SUBJECTS[emailType] || 'Notification',
      html,
      text,
      purpose: 'transactional',
      label: emailType,
      queued_at: new Date().toISOString(),
    },
  })

  if (enqueueError) {
    console.error('Failed to enqueue auth email', { error: enqueueError, emailType })
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: emailType,
      recipient_email: recipientEmail,
      status: 'failed',
      error_message: 'Failed to enqueue email',
    })
    return new Response(JSON.stringify({ error: 'Failed to enqueue email' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  console.log('Auth email enqueued', { emailType, email: recipientEmail })
  return new Response(
    JSON.stringify({ success: true, queued: true }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const url = new URL(req.url)
  if (url.pathname.endsWith('/preview')) {
    return handlePreview(req)
  }

  try {
    return await handleWebhook(req)
  } catch (error) {
    console.error('Webhook handler error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
