/**
 * Media format helpers.
 *
 * Phase 3 of the media_items refactor: legacy text fields
 * (`dimensions`, `duration`, `size`) have been removed from the DB.
 * The canonical numeric fields are:
 *   - width / height (int)
 *   - duration_seconds (numeric)
 *   - size_bytes (bigint)
 */

export interface MediaFormatInput {
  width?: number | null;
  height?: number | null;
  duration_seconds?: number | null;
  size_bytes?: number | null;
}

/** Bytes → "1.2 MB" / "423.1 KB" / "12 B". Returns "" when not derivable. */
export function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

/** Compact bytes formatter (no space) used in studio chips. "1.2MB" */
export function formatBytesCompact(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

/** Resolve effective bytes from canonical numeric column. */
export function getSizeBytes(item: MediaFormatInput): number {
  return typeof item.size_bytes === "number" && item.size_bytes > 0 ? item.size_bytes : 0;
}

/** "1920×1080" derived from numeric width/height; "" if unknown. */
export function formatDimensions(item: MediaFormatInput): string {
  const w = typeof item.width === "number" && item.width > 0 ? item.width : 0;
  const h = typeof item.height === "number" && item.height > 0 ? item.height : 0;
  return w && h ? `${w}×${h}` : "";
}

/** Total seconds from canonical numeric column. */
export function getDurationSec(item: MediaFormatInput): number {
  return typeof item.duration_seconds === "number" && item.duration_seconds > 0
    ? item.duration_seconds
    : 0;
}

/** "m:ss" or "h:mm:ss" from any media row. "" if unknown. */
export function formatDuration(item: MediaFormatInput): string {
  const total = Math.round(getDurationSec(item));
  if (total <= 0) return "";
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
