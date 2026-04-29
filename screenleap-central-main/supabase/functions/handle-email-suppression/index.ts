import { createClient } from 'npm:@supabase/supabase-js@2'

// Resend uses Svix for webhook delivery. Signature verification algorithm:
// 1. signed_content = "${svix-id}.${svix-timestamp}.${rawBody}"
// 2. sig = HMAC-SHA256(base64decode(secret after "whsec_"), signed_content)
// 3. match against signatures in svix-signature header (format: "v1,<b64sig>")
async function verifyResendWebhook(req: Request, secret: string): Promise<unknown> {
  const svixId = req.headers.get('svix-id')
  const svixTimestamp = req.headers.get('svix-timestamp')
  const svixSignature = req.headers.get('svix-signature')

  if (!svixId || !svixTimestamp || !svixSignature) {
    throw new Error('Missing svix headers')
  }

  const tsSeconds = parseInt(svixTimestamp, 10)
  const nowSeconds = Math.floor(Date.now() / 1000)
  if (Math.abs(nowSeconds - tsSeconds) > 300) {
    throw new Error('Stale timestamp')
  }

  const rawBody = await req.text()
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`

  // secret is "whsec_<base64>" — decode the base64 portion
  const secretBase64 = secret.replace(/^whsec_/, '')
  const secretBytes = Uint8Array.from(atob(secretBase64), (c) => c.charCodeAt(0))

  const key = await crypto.subtle.importKey(
    'raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent))
  const computedSig = btoa(String.fromCharCode(...new Uint8Array(sigBytes)))

  // svix-signature may contain multiple sigs: "v1,<sig1> v1,<sig2>"
  const signatures = svixSignature.split(' ').map((s) => s.replace(/^v1,/, ''))
  if (!signatures.includes(computedSig)) {
    throw new Error('Invalid signature')
  }

  return JSON.parse(rawBody)
}

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const webhookSecret = Deno.env.get('RESEND_WEBHOOK_SECRET')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!webhookSecret || !supabaseUrl || !supabaseServiceKey) {
    console.error('Missing required environment variables')
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  let event: any
  try {
    event = await verifyResendWebhook(req, webhookSecret)
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Verification failed'
    console.error('Webhook verification failed', { error: msg })
    const status = msg.includes('Stale') ? 401 : msg.includes('signature') ? 401 : 400
    return jsonResponse({ error: msg }, status)
  }

  // Only handle bounce and complaint events
  const reason = mapEventToReason(event.type)
  if (!reason) {
    // Acknowledge other events (delivered, opened, etc.) without processing
    return jsonResponse({ success: true, ignored: event.type })
  }

  // Resend sends `to` as an array; use the first recipient
  const toField = event.data?.to
  const recipientEmail = (Array.isArray(toField) ? toField[0] : toField)?.toLowerCase?.()
  if (!recipientEmail) {
    console.error('No recipient email in Resend webhook', { event })
    return jsonResponse({ error: 'No recipient email' }, 400)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const { error: suppressError } = await supabase
    .from('suppressed_emails')
    .upsert(
      { email: recipientEmail, reason, metadata: event.data ?? null },
      { onConflict: 'email' },
    )

  if (suppressError) {
    console.error('Failed to upsert suppressed email', {
      error: suppressError,
      email_redacted: recipientEmail[0] + '***@' + recipientEmail.split('@')[1],
    })
    return jsonResponse({ error: 'Failed to write suppression' }, 500)
  }

  const { error: insertError } = await supabase.from('email_send_log').insert({
    message_id: event.data?.email_id ?? null,
    template_name: 'system',
    recipient_email: recipientEmail,
    status: mapReasonToStatus(reason),
    error_message: mapReasonToMessage(reason),
    metadata: event.data ?? null,
  })

  if (insertError) {
    console.warn('Failed to insert email_send_log', { error: insertError })
  }

  console.log('Suppression processed', {
    email_redacted: recipientEmail[0] + '***@' + recipientEmail.split('@')[1],
    reason,
    event_type: event.type,
  })

  return jsonResponse({ success: true })
})

function mapEventToReason(eventType: string): 'bounce' | 'complaint' | null {
  if (eventType === 'email.bounced') return 'bounce'
  if (eventType === 'email.complained') return 'complaint'
  return null
}

function mapReasonToStatus(reason: string): 'bounced' | 'complained' | 'suppressed' {
  if (reason === 'bounce') return 'bounced'
  if (reason === 'complaint') return 'complained'
  return 'suppressed'
}

function mapReasonToMessage(reason: string): string {
  if (reason === 'bounce') return 'Permanent bounce — email address is invalid or rejected'
  if (reason === 'complaint') return 'Spam complaint — recipient marked email as spam'
  return 'Email suppressed'
}
