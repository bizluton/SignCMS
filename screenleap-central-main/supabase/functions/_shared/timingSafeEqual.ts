/**
 * timingSafeEqual — constant-time string comparison.
 *
 * Why this exists: many edge functions verify a shared secret (HOOK_SECRET,
 * service role key, push delivery key, etc.) with `a === b`. JS string
 * comparison short-circuits on the first differing character, leaking bit
 * positions to an attacker who can measure response time at the network
 * level. With a deterministic XOR loop the comparison always touches every
 * character.
 *
 * Both inputs must have the same byte length to compare equal; this is OK
 * for fixed-format secrets (JWTs, hex tokens, base64 keys).
 *
 * For comparing Authorization headers in the canonical "Bearer <secret>"
 * form, prefer bearerEquals() which extracts and length-validates first.
 */

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) {
    r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return r === 0;
}

/**
 * bearerEquals — constant-time compare against an expected secret given a
 * full "Authorization: Bearer <token>" header value. Returns false if the
 * header is empty, missing the Bearer prefix, or doesn't match.
 */
export function bearerEquals(authHeader: string | null, expected: string): boolean {
  if (!expected) return false;
  if (!authHeader) return false;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  return timingSafeEqual(m[1], expected);
}
