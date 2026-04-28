// Shared helper to ensure every transactional email enqueue has an unsubscribe_token.
// The Lovable Email API rejects transactional sends without one (400 missing_unsubscribe).
// Use `getOrCreateUnsubscribeToken` before calling `enqueue_email`.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

/**
 * Returns an existing unsubscribe token for the email, or creates one if missing.
 * One token per email address (shared across all transactional sends to that address).
 */
export async function getOrCreateUnsubscribeToken(
  supabase: SupabaseClient,
  email: string,
): Promise<string> {
  const recipientEmail = email.toLowerCase().trim()

  const { data: existing } = await supabase
    .from('email_unsubscribe_tokens')
    .select('token')
    .eq('email', recipientEmail)
    .maybeSingle()

  if (existing?.token) return existing.token

  const token = crypto.randomUUID()
  await supabase.from('email_unsubscribe_tokens').insert({
    email: recipientEmail,
    token,
  })
  return token
}
