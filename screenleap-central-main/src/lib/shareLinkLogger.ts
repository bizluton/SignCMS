// Lightweight client-side logger for trigger-test share-link diagnostics.
// Emits structured console logs (grouped by correlation id) so users can
// copy the output when reporting issues with unsigned / invalid / oversized
// / transient share links. Also keeps a small in-memory ring buffer that
// can be inspected from the devtools as `window.__shareLinkLog`.

export type ShareLinkLogKind =
  | "load_start"
  | "decode_failed"
  | "unsigned"
  | "invalid_signature"
  | "verify_transient"
  | "verify_retry"
  | "verify_failed_after_retry"
  | "payload_too_large"
  | "expired"
  | "valid"
  | "sign_failed";

export interface ShareLinkLogEntry {
  ts: string;
  correlationId: string;
  kind: ShareLinkLogKind;
  message: string;
  data?: Record<string, unknown>;
}

const RING_MAX = 50;
const ring: ShareLinkLogEntry[] = [];

if (typeof window !== "undefined") {
  (window as any).__shareLinkLog = ring;
}

/** Generate a short correlation id like `slk_8f2a1b` for one share-link interaction. */
export function newCorrelationId(): string {
  const rnd =
    (crypto as any)?.randomUUID?.()?.replace(/-/g, "").slice(0, 8) ??
    Math.random().toString(36).slice(2, 10);
  return `slk_${rnd}`;
}

function emit(entry: ShareLinkLogEntry) {
  ring.push(entry);
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
  // Tag every line with the correlation id so users can grep one flow.
  const prefix = `[ShareLink ${entry.correlationId}] ${entry.kind}`;
  // Use console.warn for failure-class events so they stand out in the
  // browser console, info for neutral states, error for hard failures.
  const level: "info" | "warn" | "error" =
    entry.kind === "valid" || entry.kind === "load_start" || entry.kind === "verify_retry"
      ? "info"
      : entry.kind === "invalid_signature" ||
        entry.kind === "verify_failed_after_retry" ||
        entry.kind === "decode_failed" ||
        entry.kind === "sign_failed"
      ? "error"
      : "warn";
  // eslint-disable-next-line no-console
  console[level](prefix, entry.message, entry.data ?? {});
}

/** Bind a correlation id once, then log multiple events under it. */
export function createShareLinkLogger(correlationId: string = newCorrelationId()) {
  const log = (
    kind: ShareLinkLogKind,
    message: string,
    data?: Record<string, unknown>,
  ): ShareLinkLogEntry => {
    const entry: ShareLinkLogEntry = {
      ts: new Date().toISOString(),
      correlationId,
      kind,
      message,
      data,
    };
    emit(entry);
    return entry;
  };
  return { correlationId, log };
}

/** Read recent log entries (newest last). Useful for debug exports. */
export function getShareLinkLogEntries(): ShareLinkLogEntry[] {
  return ring.slice();
}
