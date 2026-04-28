/**
 * Invite token utilities — shared between OnboardingPage and tests.
 *
 * Accepts either a bare UUID or any URL containing `?invite=<uuid>`,
 * and provides shape validation for inline form errors.
 */

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Extract a usable token from raw input.
 * - Plain UUID → returned as-is (trimmed)
 * - URL containing `invite=` → returns the `invite` query param value
 * - Anything else → returned trimmed
 */
export function extractToken(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.includes("invite=")) {
    try {
      // Use a safe base so relative-ish strings still parse.
      const base =
        typeof window !== "undefined" && window.location?.origin
          ? window.location.origin
          : "http://localhost";
      const u = new URL(trimmed, base);
      return (u.searchParams.get("invite") || trimmed).trim();
    } catch {
      // fall through
    }
  }
  return trimmed;
}

export type TokenErrorKey =
  | "onboardingTokenRequired"
  | "onboardingTokenTooShort"
  | "onboardingTokenBadFormat";

/**
 * Validate token shape. Returns a translation key when invalid, or null when OK.
 * Caller resolves the key via its i18n `t()` function.
 */
export function validateTokenShape(raw: string): TokenErrorKey | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "onboardingTokenRequired";
  const candidate = extractToken(trimmed);
  if (candidate.length < 20) return "onboardingTokenTooShort";
  if (!UUID_RE.test(candidate)) return "onboardingTokenBadFormat";
  return null;
}
