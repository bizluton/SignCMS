/**
 * SignCMS Player — Media Disk Cache
 *
 * Caches image and video files to disk so they survive Electron restarts.
 * Widget HTML and static assets use Chromium's built-in HTTP cache instead
 * (handled via onHeadersReceived Cache-Control headers in main.js).
 *
 * Layout on disk:
 *   userData/media-cache/
 *     manifest.json          — { [urlHash]: CacheEntry }
 *     files/
 *       <hash><ext>          — binary file
 *
 * CacheEntry: { url, file, ext, size, cachedAt, lastAccessed }
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

/** @type {Record<string, {url:string, file:string, ext:string, size:number, cachedAt:number, lastAccessed:number}>} */
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
    for (const [hash, entry] of Object.entries(manifest)) {
      if (fs.existsSync(entry.file)) {
        index.set(entry.url, entry.file);
      } else {
        delete manifest[hash];   // file disappeared → prune entry
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
 */
function getLocalPath(url) {
  if (!initialised) return null;
  const p = index.get(url);
  if (p) {
    const hash = _urlHash(url);
    if (manifest[hash]) manifest[hash].lastAccessed = Date.now();
  }
  return p ?? null;
}

/**
 * Download a URL to disk (if not already cached) and return a file:// URL.
 * Returns null on failure.
 */
async function ensureCached(url) {
  if (!initialised || !isCacheable(url)) return null;

  const existing = getLocalPath(url);
  if (existing) return `file://${existing}`;

  return _download(url);
}

/**
 * Pre-warm the cache for a list of URLs in the background.
 * Returns a Map<originalUrl, file:// URL> of all URLs that are (or become) cached.
 * Non-cacheable URLs are silently skipped.
 */
async function prewarm(urls) {
  if (!initialised) return {};

  const toDownload = urls.filter((u) => isCacheable(u) && !index.has(u));

  // Bounded concurrency pool
  const queue = [...toDownload];
  const workers = Array.from(
    { length: Math.min(MAX_CONCURRENT, queue.length || 1) },
    async () => {
      while (queue.length > 0) {
        const u = queue.shift();
        if (u) await _download(u).catch((e) => console.warn("[Cache] prewarm skip:", e.message));
      }
    },
  );
  await Promise.all(workers);

  // Return mapping for all cacheable URLs (including ones already cached)
  const result = {};
  for (const u of urls) {
    const p = index.get(u);
    if (p) result[u] = `file://${p}`;
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

function _urlHash(url) {
  return crypto.createHash("sha256").update(url).digest("hex").slice(0, 20);
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
 * Download url → disk and return file:// URL. Handles redirects.
 */
async function _download(url) {
  const hash = _urlHash(url);
  const ext  = _urlExt(url);
  const dest = path.join(filesDir, `${hash}${ext}`);

  try {
    await _downloadFile(url, dest);
  } catch (e) {
    console.warn("[Cache] download failed:", url.slice(0, 80), "—", e.message);
    return null;
  }

  let size = 0;
  try { size = fs.statSync(dest).size; } catch { return null; }

  manifest[hash] = { url, file: dest, ext, size, cachedAt: Date.now(), lastAccessed: Date.now() };
  index.set(url, dest);
  _saveManifest();

  // Evict if over limit (async, non-blocking)
  if (_totalSize() > MAX_CACHE_BYTES) setImmediate(_evict);

  console.log(`[Cache] cached ${url.slice(-50)} (${(size / 1024).toFixed(0)} KB)`);
  return `file://${dest}`;
}

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

    req.on("error", (e) => { ws.destroy(); fs.unlink(tmp, () => {}); reject(e); });
    req.on("timeout", () => { req.destroy(); reject(new Error("download timeout")); });
  });
}

function _evict() {
  const target = MAX_CACHE_BYTES * EVICT_TARGET;
  const entries = Object.entries(manifest)
    .sort(([, a], [, b]) => (a.lastAccessed || 0) - (b.lastAccessed || 0));  // oldest first

  let total = _totalSize();
  for (const [hash, entry] of entries) {
    if (total <= target) break;
    try { fs.unlinkSync(entry.file); } catch { /* already gone */ }
    index.delete(entry.url);
    total -= entry.size || 0;
    delete manifest[hash];
    console.log(`[Cache] evicted ${entry.url.slice(-50)}`);
  }
  _saveManifest();
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { init, getLocalPath, ensureCached, prewarm, getStats, isCacheable };
