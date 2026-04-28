/**
 * Mirrors the audit-logging condition in the Postgres function
 * `public.update_schedule_cleanup_settings` for `media_retention_days`:
 *
 *   IF _media_retention_days IS NOT NULL
 *      AND _media_retention_days IS DISTINCT FROM v_old_media_retention
 *   THEN INSERT INTO activity_logs ...
 *
 * Keep this predicate in lock-step with the SQL migration:
 *   supabase/migrations/20260424135724_*.sql
 *
 * Tests in `mediaRetentionAudit.test.ts` lock down all branches so a
 * future refactor cannot silently drop the "only when changed" rule.
 */
export function shouldLogMediaRetentionChange(
  oldValue: number | null | undefined,
  newValue: number | null | undefined,
): boolean {
  // Caller did not touch media retention → no log.
  if (newValue === null || newValue === undefined) return false;
  // First-time set (old was NULL) → IS DISTINCT FROM treats this as a change.
  if (oldValue === null || oldValue === undefined) return true;
  // Same value → no log.
  return oldValue !== newValue;
}