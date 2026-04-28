/**
 * Maps a raw Supabase auth error message to a translation key in our i18n system.
 * Returns null if no friendly mapping exists; caller should fall back to the raw message.
 */
export function mapSupabaseAuthError(rawMessage: string | undefined | null): string | null {
  if (!rawMessage) return null;
  const msg = rawMessage.toLowerCase();
  if (msg.includes("known to be weak") || msg.includes("pwned") || msg.includes("compromised")) return "authErrWeakPassword";
  if (msg.includes("password should be at least") || msg.includes("password is too short")) return "authErrPasswordTooShort";
  if (msg.includes("invalid login credentials") || msg.includes("invalid email or password")) return "authErrInvalidCredentials";
  if (msg.includes("email not confirmed")) return "authErrEmailNotConfirmed";
  if (msg.includes("rate limit") || msg.includes("too many requests") || msg.includes("over_email_send_rate_limit") || msg.includes("over_request_rate_limit")) return "authErrRateLimited";
  if (msg.includes("new password should be different") || msg.includes("same password")) return "authErrSamePassword";
  if (msg.includes("invalid email") || msg.includes("email address") && msg.includes("invalid")) return "authErrInvalidEmail";
  if (msg.includes("session") && (msg.includes("expired") || msg.includes("not found"))) return "authErrSessionExpired";
  return null;
}

/**
 * Front-end login lockout helpers. After too many failed sign-in attempts within
 * a short window we soft-lock the user on this device for `LOCKOUT_MS` milliseconds
 * to discourage brute force and to avoid hammering Supabase rate limits.
 */
const LOCK_KEY = "signcms_login_lock";
const FAIL_KEY = "signcms_login_fails";
export const LOGIN_MAX_FAILS = 5;
export const LOGIN_LOCKOUT_MS = 10 * 60 * 1000; // 10 minutes
const FAIL_WINDOW_MS = 15 * 60 * 1000; // failures older than this don't count

interface FailState {
  count: number;
  firstAt: number;
}

function readFails(): FailState {
  try {
    const raw = localStorage.getItem(FAIL_KEY);
    if (!raw) return { count: 0, firstAt: 0 };
    const parsed = JSON.parse(raw) as FailState;
    if (!parsed?.firstAt || Date.now() - parsed.firstAt > FAIL_WINDOW_MS) return { count: 0, firstAt: 0 };
    return parsed;
  } catch {
    return { count: 0, firstAt: 0 };
  }
}

/** Returns ms remaining until lock expires, or 0 if not locked. */
export function getLoginLockRemainingMs(): number {
  try {
    const until = parseInt(localStorage.getItem(LOCK_KEY) || "0", 10);
    if (!until) return 0;
    const remaining = until - Date.now();
    if (remaining <= 0) {
      localStorage.removeItem(LOCK_KEY);
      localStorage.removeItem(FAIL_KEY);
      return 0;
    }
    return remaining;
  } catch {
    return 0;
  }
}

/** Record a failed sign-in. If threshold reached, sets a lock. Returns lock-remaining ms (0 if no lock yet). */
export function recordLoginFailure(): number {
  const state = readFails();
  const next: FailState = {
    count: state.count + 1,
    firstAt: state.firstAt || Date.now(),
  };
  localStorage.setItem(FAIL_KEY, JSON.stringify(next));
  if (next.count >= LOGIN_MAX_FAILS) {
    const until = Date.now() + LOGIN_LOCKOUT_MS;
    localStorage.setItem(LOCK_KEY, String(until));
    return LOGIN_LOCKOUT_MS;
  }
  return 0;
}

/** Returns the current failure count within the window (for UI hints). */
export function getLoginFailureCount(): number {
  return readFails().count;
}

/** Clear lockout + failure counters (call after successful login). */
export function clearLoginLock(): void {
  localStorage.removeItem(LOCK_KEY);
  localStorage.removeItem(FAIL_KEY);
}

/** Format ms remaining as M:SS for display. */
export function formatLockCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
