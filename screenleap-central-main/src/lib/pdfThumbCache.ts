// IndexedDB-backed cache for PDF first-page thumbnails.
// Keyed by storage path + target width so small/large thumbs don't collide.
//
// Tracks per-entry hit count and last-used timestamp so we can auto-evict
// the least-valuable entries (LFU + LRU combined score) when the total
// payload exceeds the configured cap.

const DB_NAME = "knowledge-pdf-thumbs";
const STORE = "thumbs";
const DB_VERSION = 1;
// Bump when render parameters change in a way that invalidates old thumbs.
const SCHEMA_VERSION = 1;
// Evict entries older than 30 days.
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
// Soft cap for total cache size. When exceeded after a write, we evict
// down to ~90% of the cap (10% headroom) to avoid thrashing.
// Cap is configurable via localStorage; allowed values: 20 / 50 / 100 MB.
const DEFAULT_MAX_MB = 50;
const ALLOWED_MAX_MB = [20, 50, 100] as const;
export type ThumbCacheLimitMb = typeof ALLOWED_MAX_MB[number];
const STORAGE_KEY = "knowledge-pdf-thumbs:max-mb";

export function getThumbCacheLimitMb(): ThumbCacheLimitMb {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const n = raw ? Number(raw) : NaN;
    if (ALLOWED_MAX_MB.includes(n as ThumbCacheLimitMb)) return n as ThumbCacheLimitMb;
  } catch {
    // ignore
  }
  return DEFAULT_MAX_MB;
}

export function setThumbCacheLimitMb(mb: ThumbCacheLimitMb): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(mb));
  } catch {
    // ignore
  }
  // Apply new cap immediately to existing entries.
  void enforceCapacity();
}

export function getThumbCacheLimitOptions(): readonly ThumbCacheLimitMb[] {
  return ALLOWED_MAX_MB;
}

function getMaxBytes(): number {
  return getThumbCacheLimitMb() * 1024 * 1024;
}

function getTargetBytes(): number {
  // 10% headroom below the cap.
  return Math.floor(getMaxBytes() * 0.9);
}

interface ThumbRecord {
  key: string;
  dataUrl: string;
  createdAt: number;
  schemaVersion: number;
  hitCount: number;
  lastUsedAt: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        console.warn("PDF thumb IndexedDB open failed:", req.error);
        resolve(null);
      };
      req.onblocked = () => resolve(null);
    } catch (e) {
      console.warn("PDF thumb IndexedDB unavailable:", e);
      resolve(null);
    }
  });
  return dbPromise;
}

function buildKey(storagePath: string, targetWidth: number) {
  return `${storagePath}::w${targetWidth}`;
}

/**
 * Read a cached thumb. On hit, asynchronously bumps hitCount + lastUsedAt
 * (fire-and-forget; we don't block the caller on the write).
 */
export async function getCachedThumb(storagePath: string, targetWidth: number): Promise<string | null> {
  const db = await openDb();
  if (!db) return null;
  const key = buildKey(storagePath, targetWidth);
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        const rec = req.result as ThumbRecord | undefined;
        if (!rec) return resolve(null);
        if (rec.schemaVersion !== SCHEMA_VERSION) return resolve(null);
        if (Date.now() - rec.createdAt > MAX_AGE_MS) return resolve(null);
        // Bump usage stats in the background.
        void bumpHit(key);
        resolve(rec.dataUrl);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function bumpHit(key: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const req = store.get(key);
      req.onsuccess = () => {
        const rec = req.result as ThumbRecord | undefined;
        if (!rec) return;
        rec.hitCount = (rec.hitCount ?? 0) + 1;
        rec.lastUsedAt = Date.now();
        store.put(rec);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function setCachedThumb(storagePath: string, targetWidth: number, dataUrl: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const key = buildKey(storagePath, targetWidth);
  const now = Date.now();
  const record: ThumbRecord = {
    key,
    dataUrl,
    createdAt: now,
    schemaVersion: SCHEMA_VERSION,
    hitCount: 0,
    lastUsedAt: now,
  };
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  // Run eviction after write; fire-and-forget so callers don't wait.
  void enforceCapacity();
}

/**
 * Combined-score eviction. Lower score = evict first.
 *   score = hitCount + recencyBonus
 *   recencyBonus = max(0, 7 - daysSinceLastUse)  // up to +7 for "used today"
 * This keeps frequently-hit AND recently-used items, and drops items that
 * were both rarely hit and stale.
 */
function entryScore(rec: ThumbRecord, now: number): number {
  const days = Math.max(0, (now - (rec.lastUsedAt ?? rec.createdAt)) / (24 * 60 * 60 * 1000));
  const recencyBonus = Math.max(0, 7 - days);
  return (rec.hitCount ?? 0) + recencyBonus;
}

async function enforceCapacity(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const req = store.openCursor();
      const all: Array<{ key: string; bytes: number; score: number }> = [];
      let total = 0;
      const now = Date.now();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const rec = cursor.value as ThumbRecord;
          const bytes = rec?.dataUrl?.length ?? 0;
          total += bytes;
          all.push({
            key: String(cursor.key),
            bytes,
            score: entryScore(rec, now),
          });
          cursor.continue();
          return;
        }
        if (total <= getMaxBytes()) {
          resolve();
          return;
        }
        // Sort ascending by score (lowest first), tiebreak by larger bytes
        // first so we free space faster.
        all.sort((a, b) => (a.score - b.score) || (b.bytes - a.bytes));
        let remaining = total;
        for (const e of all) {
          if (remaining <= getTargetBytes()) break;
          store.delete(e.key);
          remaining -= e.bytes;
        }
        resolve();
      };
      req.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function clearThumbCache(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export interface ThumbCacheStats {
  count: number;
  bytes: number;
  maxBytes: number;
}

/**
 * Returns the number of cached thumbs and an approximate total size in bytes.
 * Size is estimated from the data URL string length (each char ≈ 1 byte for base64).
 */
export async function getThumbCacheStats(): Promise<ThumbCacheStats> {
  const db = await openDb();
  if (!db) return { count: 0, bytes: 0, maxBytes: getMaxBytes() };
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      const req = store.openCursor();
      let count = 0;
      let bytes = 0;
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve({ count, bytes, maxBytes: getMaxBytes() });
          return;
        }
        const rec = cursor.value as ThumbRecord;
        if (rec?.dataUrl) {
          count += 1;
          bytes += rec.dataUrl.length;
        }
        cursor.continue();
      };
      req.onerror = () => resolve({ count, bytes, maxBytes: getMaxBytes() });
    } catch {
      resolve({ count: 0, bytes: 0, maxBytes: getMaxBytes() });
    }
  });
}

export interface ThumbCacheEntry {
  storagePath: string;
  targetWidth: number;
  bytes: number;
  createdAt: number;
  hitCount: number;
  lastUsedAt: number;
}

/** Returns one entry per cached thumb (path + width + size + usage stats). */
export async function listThumbCacheEntries(): Promise<ThumbCacheEntry[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      const req = store.openCursor();
      const entries: ThumbCacheEntry[] = [];
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(entries);
          return;
        }
        const rec = cursor.value as ThumbRecord;
        const key = String(cursor.key);
        const sep = key.lastIndexOf("::w");
        const storagePath = sep >= 0 ? key.slice(0, sep) : key;
        const targetWidth = sep >= 0 ? Number(key.slice(sep + 3)) || 0 : 0;
        entries.push({
          storagePath,
          targetWidth,
          bytes: rec?.dataUrl?.length ?? 0,
          createdAt: rec?.createdAt ?? 0,
          hitCount: rec?.hitCount ?? 0,
          lastUsedAt: rec?.lastUsedAt ?? rec?.createdAt ?? 0,
        });
        cursor.continue();
      };
      req.onerror = () => resolve(entries);
    } catch {
      resolve([]);
    }
  });
}

/**
 * Removes all cached thumbs for a given storage path (across all target widths).
 * Call this when a file is deleted or replaced so stale thumbs don't linger.
 */
export async function invalidateThumb(storagePath: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        const key = cursor.key as string;
        if (typeof key === "string" && key.startsWith(`${storagePath}::`)) {
          cursor.delete();
        }
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}
