/**
 * Translates Postgres trigger plan-limit exceptions (SQLSTATE 23514)
 * into user-friendly i18n messages.
 *
 * Recognized markers (raised by enforce_screen_limit / enforce_media_capacity):
 *  - "screen_limit_exceeded"
 *  - "media_capacity_exceeded"
 */
export type PlanLimitKind = "screens" | "media" | null;

export function detectPlanLimitKind(err: unknown): PlanLimitKind {
  if (!err) return null;
  const e = err as { message?: string; code?: string; details?: string };
  const haystack = `${e.message ?? ""} ${e.details ?? ""}`.toLowerCase();
  if (haystack.includes("screen_limit_exceeded")) return "screens";
  if (haystack.includes("media_capacity_exceeded")) return "media";
  return null;
}

/**
 * Returns a translated message for known plan-limit errors,
 * or the fallback (raw error message) for everything else.
 *
 * `t` should be the page's translation function.
 */
export function translatePlanLimitError(
  err: unknown,
  t: (key: string) => string,
  fallback?: string
): string {
  const kind = detectPlanLimitKind(err);
  if (kind === "screens") return t("planLimitScreens");
  if (kind === "media") return t("planLimitMedia");
  const e = err as { message?: string };
  return fallback ?? e?.message ?? "Unknown error";
}
