/**
 * In-memory cache of recently exported ZIP blobs (current browser session only).
 *
 * Used by the activity log UI so users can re-download an export they made
 * without re-running the export pipeline. Cleared on page reload — that's
 * intentional, since blobs can be large.
 */
export interface RecentExport {
  /** Matches activity_logs.id when available, else a generated id. */
  logId: string;
  /** Human-readable kind, e.g. "schedule". */
  kind: string;
  filename: string;
  blob: Blob;
  sizeBytes: number;
  createdAt: number;
}

const MAX_ENTRIES = 10;
const TTL_MS = 60 * 60 * 1000; // 1 hour
const store = new Map<string, RecentExport>();

function prune() {
  const now = Date.now();
  for (const [id, e] of store) if (now - e.createdAt > TTL_MS) store.delete(id);
  while (store.size > MAX_ENTRIES) {
    // Map preserves insertion order — drop oldest first.
    const firstKey = store.keys().next().value;
    if (firstKey === undefined) break;
    store.delete(firstKey);
  }
}

export function rememberExport(entry: Omit<RecentExport, "createdAt">) {
  store.set(entry.logId, { ...entry, createdAt: Date.now() });
  prune();
}

export function getRecentExport(logId: string): RecentExport | null {
  prune();
  return store.get(logId) || null;
}

export function listRecentExports(): RecentExport[] {
  prune();
  return Array.from(store.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export function downloadRecentExport(logId: string): boolean {
  const e = getRecentExport(logId);
  if (!e) return false;
  const url = URL.createObjectURL(e.blob);
  const a = document.createElement("a");
  a.href = url; a.download = e.filename; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}