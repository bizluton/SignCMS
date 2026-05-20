/**
 * formatUserError — convert an arbitrary thrown value into a localized,
 * user-friendly error string.
 *
 * Why this exists:
 *   Several dozen call sites do `toast.error(error.message)`, which leaks raw
 *   Postgres / Supabase / Resend error text to the UI:
 *     - "duplicate key value violates unique constraint ..."
 *     - "new row violates row-level security policy for table ..."
 *     - "JSON object requested, multiple (or no) rows returned"
 *   These are unhelpful at best and reveal schema details at worst.
 *
 * Usage:
 *   import { formatUserError } from "@/lib/formatUserError";
 *   const { t } = useLanguage();
 *
 *   try { ... } catch (e) { toast.error(formatUserError(e, t)); }
 *
 *   // Optional fallback string when no SQLSTATE / known shape matches:
 *   toast.error(formatUserError(e, t, "Failed to save"));
 *
 * If the caller doesn't have `t` handy (e.g. inside a non-React util),
 * pass null and English fallbacks are used.
 */

import type { TranslationKey } from "@/contexts/translations";

type Translator = (key: TranslationKey) => string;

// Lower-cased substrings → translation key. First match wins.
// Keep ordered: most specific first.
const MESSAGE_PATTERNS: Array<[string, TranslationKey]> = [
  // Auth / session
  ["jwt expired",                  "errSessionExpired"],
  ["invalid jwt",                  "errSessionExpired"],
  ["invalid login credentials",    "authErrInvalidCredentials"],
  ["email not confirmed",          "authErrEmailNotConfirmed"],
  ["user not found",               "errUserNotFound"],

  // Permissions
  ["row-level security",           "errPermissionDenied"],
  ["permission denied",            "errPermissionDenied"],
  ["not authorized",               "errPermissionDenied"],
  ["forbidden",                    "errPermissionDenied"],
  ["unauthorized",                 "errPermissionDenied"],

  // Uniqueness / conflict
  ["duplicate key value",          "errDuplicate"],
  ["already exists",               "errDuplicate"],
  ["conflict",                     "errConflict"],

  // Not found
  ["no rows",                      "errNotFound"],
  ["not found",                    "errNotFound"],

  // Network / timeout
  ["network request failed",       "errNetwork"],
  ["failed to fetch",              "errNetwork"],
  ["timeout",                      "errTimeout"],

  // Foreign key / constraint
  ["foreign key constraint",       "errConstraint"],
  ["violates check constraint",    "errConstraint"],
  ["not-null constraint",          "errConstraint"],
];

// SQLSTATE-prefixed Postgres codes (when surfaced).
const SQLSTATE_MAP: Record<string, TranslationKey> = {
  "23505": "errDuplicate",       // unique_violation
  "23503": "errConstraint",      // foreign_key_violation
  "23502": "errConstraint",      // not_null_violation
  "23514": "errConstraint",      // check_violation
  "42501": "errPermissionDenied", // insufficient_privilege
  "PGRST301": "errPermissionDenied",
};

const FALLBACK_TEXT: Record<TranslationKey | "errGeneric", string> = {
  errGeneric:          "Something went wrong.",
  errSessionExpired:   "Your session expired. Please sign in again.",
  errPermissionDenied: "You don't have permission to do this.",
  errDuplicate:        "Already exists.",
  errConflict:         "Conflict with current state.",
  errNotFound:         "Not found.",
  errNetwork:          "Network error. Please try again.",
  errTimeout:          "Request timed out. Please try again.",
  errConstraint:       "The value is invalid for this field.",
  errUserNotFound:     "User not found.",
  authErrInvalidCredentials:  "Invalid email or password.",
  authErrEmailNotConfirmed:   "Please confirm your email address before signing in.",
} as Partial<Record<TranslationKey | "errGeneric", string>> as Record<TranslationKey | "errGeneric", string>;

function extractMessage(err: unknown): { message: string; sqlstate: string | null } {
  if (!err) return { message: "", sqlstate: null };
  if (typeof err === "string") return { message: err, sqlstate: null };
  if (err instanceof Error) {
    // Supabase puts PG code on `.code`.
    const sqlstate = (err as unknown as { code?: string }).code ?? null;
    return { message: err.message, sqlstate };
  }
  if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    const message =
      typeof obj.message === "string" ? obj.message :
      typeof obj.error   === "string" ? obj.error   :
      JSON.stringify(obj);
    const sqlstate = typeof obj.code === "string" ? obj.code : null;
    return { message, sqlstate };
  }
  return { message: String(err), sqlstate: null };
}

export function formatUserError(
  err: unknown,
  t: Translator | null,
  fallback?: string,
): string {
  const { message, sqlstate } = extractMessage(err);

  const resolve = (key: TranslationKey): string =>
    t ? t(key) : (FALLBACK_TEXT[key] ?? FALLBACK_TEXT.errGeneric);

  // 1. SQLSTATE mapping (most reliable)
  if (sqlstate && SQLSTATE_MAP[sqlstate]) {
    return resolve(SQLSTATE_MAP[sqlstate]);
  }

  // 2. Substring match on message
  const lower = message.toLowerCase();
  for (const [needle, key] of MESSAGE_PATTERNS) {
    if (lower.includes(needle)) return resolve(key);
  }

  // 3. Fallback — prefer the caller's provided fallback, then a generic
  // translation, then the literal message (last resort).
  if (fallback) return fallback;
  if (t) return t("errGeneric");
  return message || FALLBACK_TEXT.errGeneric;
}
