/**
 * SignCMS Player — Media Disk Cache
 *
 * CAS Phase 4: SHA-256 content-addressed cache keys.
 *
 * Cache key priority:
 *   sha256 provided  → use sha256 as key (CAS, cross-URL dedup + post-download verify)
 *   sha256 null      → use SHA-256(url) truncated to 20 chars (legacy, URL-based)
 *
 * Layout on disk:
 *   userData/media-cache/
 *     manifest.json          — { [key]: CacheEntry }
 *     files/
 *       <key><ext>           — binary file
 *
 * CacheEntry: { url, file, ext, size, sha256, cachedAt, lastAccessed }
 *
 * Dedup:
 *   - Within-URL:    index.has(url) → already downloaded for this URL
 *   - Cross-URL:     manifest[sha256] exists → reuse file, just update index (no re-download)
 *   - Post-download: compute SHA-256 of downloaded bytes and compare to expected hash;
 *                    corrupted/tampered files are deleted and silently skipped.
 *
 * Eviction: LRU, keeps total under MAX_CACHE_BYTES.
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");
const https  = require("https");
const http   = require("http");

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_CACHE_BYTES  = 512 * 1024 * 1024;   // 512 MB hard limit
const EVICT_TARGET     = 0.75;                  // evict down to 75 % on overflow
const MAX_CONCURRENT   = 3;                     // parallel downloads
const DOWNLOAD_TIMEOUT = 30_000;               // ms per file

// File extensions we'll put on disk; anything else is left to Chromium HTTP cache
const CACHEABLE_EXT = /\.(jpg|jpeg|png|gif|webp|avif|mp4|webm|mov|mp3|aac|wav|ogg)(\?|$)/i;

// ── State ────────────────────────────────────────────────────────────────────

let cacheDir     = "";
let filesDir     = "";
let manifestPath = "";

/**
 * @type {Record<string, {url:string, file:string, ext:string, size:number,
 *                        sha256:string|null, cachedAt:number, lastAccessed:number}>}
 */
let manifest = {};

/** Fast in-memory index: original URL → absolute local path */
const index = new Map();

let initialised = false;

// ── Init ─────────────────────────────────────────────────────────────────────

/**
 * Must be called once from app.whenReady(), passing app.getPath("userData").
 */
function init(userDataPath) {
  cacheDir     = path.join(userDataPath, "media-cache");
  filesDir     = path.join(cacheDir, "files");
  manifestPath = path.join(cacheDir, "manifest.json");

  fs.mkdirSync(filesDir, { recursive: true });

  // Load existing manifest and rebuild in-memory index
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    let dirty = false;
    for (const [, entry] of Object.entries(manifest)) {
      if (fs.existsSync(entry.file)) {
        index.set(entry.url, entry.file);
      } else {
        // Locate by key (sha256 or urlHash) — file disappeared, prune entry
        const key = entry.sha256 || _urlHash(entry.url);
        delete manifest[key];
        dirty = true;
      }
    }
    if (dirty) _saveManifest();
  } catch { manifest = {}; }

  initialised = true;
  console.log(`[Cache] init — ${index.size} files, ${_totalSize()} bytes`);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the local absolute path if the URL is cached, otherwise null.
 * (Synchronous — checks in-memory index only.)
 *
 * @param {string}      url    CDN URL
 * @param {string|null} sha256 Content hash (CAS; pass null for legacy)
 */
function getLocalPath(url, sha256 = null) {
  if (!initialised) return null;

  // CAS fast-path: if sha256 provided, check manifest directly regardless of URL
  if (sha256) {
    const entry = manifest[sha256];
    if (entry && fs.existsSync(entry.file)) {
      entry.lastAccessed = Date.now();
      return entry.file;
    }
  }

  // URL-based lookup (also serves legacy entries)
  const p = index.get(url);
  if (p) {
    const key = sha256 || _urlHash(url);
    if (manifest[key]) manifest[key].lastAccessed = Date.now();
    return p;
  }

  return null;
}

/**
 * Download a URL to disk (if not already cached) and return a file:// URL.
 * Returns null on failure.
 *
 * @param {string}      url
 * @param {string|null} sha256 Expected content hash; null for legacy items
 */
async function ensureCached(url, sha256 = null) {
  if (!initialised || !isCacheable(url)) return null;

  const existing = getLocalPath(url, sha256);
  if (existing) {
    // If sha256 match resolved to a different URL's file, wire up this URL too
    if (!index.has(url)) {
      index.set(url, existing);
    }
    return `file://${existing}`;
  }

  return _downloadAsset({ url, sha256, size: null });
}

/**
 * Pre-warm the cache for a list of assets in the background.
 * Accepts either plain URL strings (legacy) or asset objects { url, sha256, size }.
 * Returns a Map<originalUrl, file://URL> of all URLs that are (or become) cached.
 * Non-cacheable items are silently skipped.
 *
 * @param {(string | {url:string, sha256:string|null, size:number|null})[]} assets
 * @returns {Promise<Record<string, string>>}
 */
async function prewarm(assets) {
  if (!initialised) return {};

  // Normalize: plain strings → { url, sha256: null, size: null }
  const normalized = assets.map((a) =>
    typeof a === "string" ? { url: a, sha256: null, size: null } : a,
  );

  // ── Phase 1: Cross-URL dedup (CAS) ────────────────────────────────────────
  // For any asset whose sha256 is already in manifest (uploaded by another org or
  // cached under a different URL), just update the in-memory index — no download.
  for (const { url, sha256 } of normalized) {
    if (!isCacheable(url) || index.has(url)) continue;
    if (sha256) {
      const existing = manifest[sha256];
      if (existing && fs.existsSync(existing.file)) {
        index.set(url, existing.file);
        existing.lastAccessed = Date.now();
        console.log(`[Cache] cross-URL reuse ${sha256.slice(0, 16)}… → ${url.slice(-50)}`);
      }
    }
  }

  // ── Phase 2: Download missing files ───────────────────────────────────────
  const toDownload = normalized.filter(({ url, sha256 }) => {
    if (!isCacheable(url)) return false;
    if (index.has(url)) return false;                // already served (possibly just wired above)
    if (sha256 && manifest[sha256]) return false;    // hash exists but URL wasn't wired (shouldn't happen after phase 1, but safe)
    return true;
  });

  const queue = [...toDownload];
  const workers = Array.from(
    { length: Math.min(MAX_CONCURRENT, queue.length || 1) },
    async () => {
      while (queue.length > 0) {
        const asset = queue.shift();
        if (asset) {
          await _downloadAsset(asset).catch((e) =>
            console.warn("[Cache] prewarm skip:", e.message),
          );
        }
      }
    },
  );
  await Promise.all(workers);

  // ── Return URL → file:// map ───────────────────────────────────────────────
  const result = {};
  for (const { url } of normalized) {
    const p = index.get(url);
    if (p) result[url] = `file://${p}`;
  }
  return result;
}

/**
 * Returns cache stats for HUD / settings display.
 */
function getStats() {
  return {
    count:     index.size,
    totalSize: _totalSize(),
    maxSize:   MAX_CACHE_BYTES,
    cacheDir,
  };
}

/**
 * Whether a URL is eligible for disk caching.
 */
function isCacheable(url) {
  try { return CACHEABLE_EXT.test(new URL(url).pathname); }
  catch { return false; }
}

// ── Internals ─────────────────────────────────────────────────────────────────

/** Legacy URL-based key: SHA-256(url) truncated to 20 hex chars */
function _urlHash(url) {
  return crypto.createHash("sha256").update(url).digest("hex").slice(0, 20);
}

/** Content-addressed key: sha256 if provided, else _urlHash(url) */
function _contentKey(url, sha256) {
  return sha256 || _urlHash(url);
}

function _urlExt(url) {
  try {
    const m = new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i);
    return m ? `.${m[1].toLowerCase()}` : "";
  } catch { return ""; }
}

function _totalSize() {
  return Object.values(manifest).reduce((s, e) => s + (e.size || 0), 0);
}

function _saveManifest() {
  try { fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8"); }
  catch (e) { console.error("[Cache] manifest write error:", e.message); }
}

/**
 * Download an asset to disk.
 * Uses sha256 as the disk key (CAS) when provided; falls back to urlHash.
 * Verifies SHA-256 of downloaded file when expected hash is given;
 * corrupted files are deleted and null is returned.
 *
 * @param {{ url: string, sha256: string|null, size: number|null }} asset
 * @returns {Promise<string|null>}  file:// URL or null on failure
 */
async function _downloadAsset({ url, sha256, size }) {
  const key  = _contentKey(url, sha256);
  const ext  = _urlExt(url);
  const dest = path.join(filesDir, `${key}${ext}`);

  try {
    await _downloadFile(url, dest);
  } catch (e) {
    console.warn("[Cache] download failed:", url.slice(0, 80), "—", e.message);
    return null;
  }

  // ── SHA-256 verification (CAS integrity check) ────────────────────────────
  if (sha256) {
    let actual;
    try { actual = await _computeSha256(dest); }
    catch (e) {
      console.error("[Cache] hash compute error:", e.message);
      try { fs.unlinkSync(dest); } catch { /* ignore */ }
      return null;
    }
    if (actual !== sha256) {
      console.error(
        `[Cache] ✗ hash mismatch for ${url.slice(-60)}\n` +
        `  expected: ${sha256}\n  actual:   ${actual}`,
      );
      try { fs.unlinkSync(dest); } catch { /* ignore */ }
      return null;
    }
  }

  let actualSize = 0;
  try { actualSize = fs.statSync(dest).size; } catch { return null; }

  manifest[key] = {
    url,
    file:         dest,
    ext,
    size:         actualSize,
    sha256:       sha256 || null,
    cachedAt:     Date.now(),
    lastAccessed: Date.now(),
  };
  index.set(url, dest);
  _saveManifest();

  if (_totalSize() > MAX_CACHE_BYTES) setImmediate(_evict);

  console.log(
    `[Cache] ✓ cached ${url.slice(-50)} ` +
    `(${(actualSize / 1024).toFixed(0)} KB)` +
    (sha256 ? ` sha256:${sha256.slice(0, 12)}…` : ""),
  );
  return `file://${dest}`;
}

/**
 * Streaming SHA-256 computation of a file on disk.
 * @param {string} filePath
 * @returns {Promise<string>}  64-char lowercase hex
 */
function _computeSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash   = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data",  (chunk) => hash.update(chunk));
    stream.on("end",   ()      => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/**
 * Download url → dest, following up to 5 redirects, atomic rename from .part file.
 */
function _downloadFile(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error("too many redirects"));

    const parsed = new URL(url);
    const mod    = parsed.protocol === "https:" ? https : http;
    const tmp    = dest + ".part";
    const ws     = fs.createWriteStream(tmp);

    const req = mod.get(url, { timeout: DOWNLOAD_TIMEOUT }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
        ws.destroy();
        fs.unlink(tmp, () => {});
        _downloadFile(res.headers.location, dest, redirects + 1).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        ws.destroy();
        fs.unlink(tmp, () => {});
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      res.pipe(ws);
      ws.on("finish", () =>
        fs.rename(tmp, dest, (err) => (err ? reject(err) : resolve())),
      );
      ws.on("error", (e) => { fs.unlink(tmp, () => {}); reject(e); });
    });

    req.on("error",   (e) => { ws.destroy(); fs.unlink(tmp, () => {}); reject(e); });
    req.on("timeout", ()  => { req.destroy(); reject(new Error("download timeout")); });
  });
}

function _evict() {
  const target  = MAX_CACHE_BYTES * EVICT_TARGET;
  const entries = Object.entries(manifest)
    .sort(([, a], [, b]) => (a.lastAccessed || 0) - (b.lastAccessed || 0));  // oldest first

  let total = _totalSize();
  for (const [key, entry] of entries) {
    if (total <= target) break;
    try { fs.unlinkSync(entry.file); } catch { /* already gone */ }
    index.delete(entry.url);
    total -= entry.size || 0;
    delete manifest[key];
    console.log(`[Cache] evicted ${entry.url.slice(-50)}`);
  }
  _saveManifest();
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { init, getLocalPath, ensureCached, prewarm, getStats, isCacheable };
