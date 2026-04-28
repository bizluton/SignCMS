// IndexedDB-backed cache for video first-frame posters.
// Keyed by video src (URL). Stores a small JPEG data URL so we can avoid
// re-fetching metadata + decoding the first frame every time the user reopens
// a project / scrolls the timeline.

const DB_NAME = "video-poster-cache";
const STORE = "posters";
const DB_VERSION = 1;
const SCHEMA_VERSION = 2; // bumped: seek to 0 instead of 0.1 for true first frame
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB cap
const TARGET_BYTES = Math.floor(MAX_BYTES * 0.9);

// Default capture dimensions — small but readable in timeline cards.
const DEFAULT_TARGET_WIDTH = 320;
const JPEG_QUALITY = 0.7;

interface PosterRecord {
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
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

// Strip volatile query params (e.g. signed-URL `token`) so the same underlying
// asset gets a stable cache key across signed-URL refreshes.
function normalizeKey(src: string): string {
  try {
    const u = new URL(src, window.location.href);
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return src;
  }
}

export async function getCachedPoster(src: string): Promise<string | null> {
  if (!src) return null;
  const db = await openDb();
  if (!db) return null;
  const key = normalizeKey(src);
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        const rec = req.result as PosterRecord | undefined;
        if (!rec) return resolve(null);
        if (rec.schemaVersion !== SCHEMA_VERSION) return resolve(null);
        if (Date.now() - rec.createdAt > MAX_AGE_MS) return resolve(null);
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
        const rec = req.result as PosterRecord | undefined;
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

async function setCachedPoster(src: string, dataUrl: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const key = normalizeKey(src);
  const now = Date.now();
  const rec: PosterRecord = {
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
      tx.objectStore(STORE).put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  void enforceCapacity();
}

function entryScore(rec: PosterRecord, now: number): number {
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
          const rec = cursor.value as PosterRecord;
          const bytes = rec?.dataUrl?.length ?? 0;
          total += bytes;
          all.push({ key: String(cursor.key), bytes, score: entryScore(rec, now) });
          cursor.continue();
          return;
        }
        if (total <= MAX_BYTES) return resolve();
        all.sort((a, b) => (a.score - b.score) || (b.bytes - a.bytes));
        let remaining = total;
        for (const e of all) {
          if (remaining <= TARGET_BYTES) break;
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

// In-flight de-dupe so simultaneous mounts of the same video don't all
// spin up their own capture pipeline.
const inflight = new Map<string, Promise<string | null>>();

/**
 * Capture the first frame of a video src and persist it as a JPEG data URL.
 * Returns the data URL (or null on failure). Safe to call repeatedly — the
 * cache is checked first and concurrent calls are de-duped.
 */
export async function captureAndCachePoster(src: string, targetWidth = DEFAULT_TARGET_WIDTH): Promise<string | null> {
  if (!src || typeof document === "undefined") return null;
  const key = normalizeKey(src);

  const cached = await getCachedPoster(src);
  if (cached) return cached;

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = new Promise<string | null>((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.crossOrigin = "anonymous";

    let settled = false;
    const cleanup = () => {
      try { video.removeAttribute("src"); video.load(); } catch { /* noop */ }
    };
    const finish = (val: string | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(val);
    };

    const timeout = window.setTimeout(() => finish(null), 8000);

    video.onloadedmetadata = () => {
      // Seek to 0 to capture the true first frame. Some browsers need a tiny
      // nudge to fire `seeked`, so fall back to a micro-seek if 0 doesn't trigger.
      try { video.currentTime = 0; } catch { /* noop */ }
      window.setTimeout(() => {
        if (settled) return;
        try { if (video.currentTime === 0) video.currentTime = 0.001; } catch { /* noop */ }
      }, 200);
    };
    video.onseeked = () => {
      try {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (!vw || !vh) return finish(null);
        const w = Math.min(targetWidth, vw);
        const h = Math.round((w / vw) * vh);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return finish(null);
        ctx.drawImage(video, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
        window.clearTimeout(timeout);
        void setCachedPoster(src, dataUrl);
        finish(dataUrl);
      } catch {
        window.clearTimeout(timeout);
        finish(null);
      }
    };
    video.onerror = () => {
      window.clearTimeout(timeout);
      finish(null);
    };

    try {
      video.src = src;
    } catch {
      window.clearTimeout(timeout);
      finish(null);
    }
  }).finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, promise);
  return promise;
}

export async function clearPosterCache(): Promise<void> {
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
