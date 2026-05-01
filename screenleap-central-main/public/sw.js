'use strict';

/**
 * SignCMS Player — Service Worker
 *
 * Intercepts fetches for Supabase Storage media files and serves them from
 * Cache Storage.  Handles HTTP Range requests (byte-range) so that <video>
 * elements can seek and load partial content from the local cache.
 *
 * Cache lifecycle:
 *   - PRECACHE message  → download listed URLs in the background
 *   - CLEANUP  message  → delete any cached URL not in the keep-set
 *   - Version bump in CACHE_NAME → old caches removed on activate
 */

const CACHE_NAME = 'signcms-media-v1';

// Match only Supabase Storage public media-bucket URLs so we never intercept
// API / Auth / Realtime traffic.
function isMediaUrl(url) {
  return /\/storage\/v1\/object\/public\/media\//.test(url);
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

self.addEventListener('install', () => {
  // Take control immediately without waiting for old tabs to close.
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    self.clients.claim(),
    // Remove caches left by older SW versions.
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith('signcms-') && k !== CACHE_NAME)
          .map(k => caches.delete(k)),
      )
    ),
  ]));
});

// ─── Fetch interception ───────────────────────────────────────────────────────

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (!isMediaUrl(event.request.url)) return;
  event.respondWith(handleMedia(event.request));
});

async function handleMedia(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request.url);
  const rangeHeader = request.headers.get('Range');

  if (cached) {
    // Serve from cache; slice the buffer for Range requests.
    return rangeHeader ? sliceCached(cached, rangeHeader) : cached;
  }

  // ── Not cached: fetch the full file, store it, then serve ──
  let response;
  try {
    // Always fetch without the Range header so we get — and cache — the
    // complete file.  Subsequent range requests are served from the cache.
    response = await fetch(new Request(request.url, { mode: 'cors' }));
  } catch {
    return new Response(null, { status: 503, statusText: 'Offline' });
  }

  if (!response.ok) return response;

  if (rangeHeader) {
    // Read into memory, cache the full copy, return the requested slice.
    const buf = await response.arrayBuffer();
    // Store with a synthetic 200 response (the Range response isn't cacheable).
    cache.put(
      request.url,
      new Response(buf.slice(0), { status: 200, headers: response.headers }),
    );
    return buildRangeResponse(buf, response.headers.get('Content-Type'), rangeHeader);
  }

  // Normal (non-range) request: cache a clone and return the original.
  cache.put(request.url, response.clone());
  return response;
}

// ─── Range-response helpers ───────────────────────────────────────────────────

async function sliceCached(cachedResponse, rangeHeader) {
  const buf = await cachedResponse.arrayBuffer();
  return buildRangeResponse(
    buf,
    cachedResponse.headers.get('Content-Type'),
    rangeHeader,
  );
}

function buildRangeResponse(buf, contentType, rangeHeader) {
  const total = buf.byteLength;
  const m = /bytes=(\d+)-(\d*)/.exec(rangeHeader);

  if (!m) {
    // Malformed Range header — return the full content.
    return new Response(buf, { status: 200 });
  }

  const start = Number(m[1]);
  const end   = m[2] ? Math.min(Number(m[2]), total - 1) : total - 1;

  if (start > end || start >= total) {
    return new Response(null, {
      status: 416, // Range Not Satisfiable
      headers: { 'Content-Range': `bytes */${total}` },
    });
  }

  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Range':  `bytes ${start}-${end}/${total}`,
      'Content-Length': String(end - start + 1),
      'Content-Type':   contentType || 'application/octet-stream',
      'Accept-Ranges':  'bytes',
    },
  });
}

// ─── Message handlers (from PlayerPage) ──────────────────────────────────────

self.addEventListener('message', event => {
  const { type, urls, keepUrls } = event.data ?? {};
  if (type === 'PRECACHE') runPrecache(urls ?? []);
  if (type === 'CLEANUP')  runCleanup(keepUrls ?? []);
});

// Download each URL not already in cache (sequential to avoid flooding the
// network on low-bandwidth connections).
async function runPrecache(urls) {
  const cache = await caches.open(CACHE_NAME);
  for (const url of urls) {
    if (!url || !isMediaUrl(url)) continue;
    try {
      if (await cache.match(url)) continue; // already cached — skip
      const res = await fetch(url, { mode: 'cors' });
      if (res.ok) await cache.put(url, res);
    } catch {
      // Ignore individual failures; the file will be fetched on first play.
    }
  }
}

// Delete any cached entry whose URL is not in keepUrls.
async function runCleanup(keepUrls) {
  const cache  = await caches.open(CACHE_NAME);
  const keep   = new Set(keepUrls);
  const cached = await cache.keys();
  await Promise.all(
    cached.filter(req => !keep.has(req.url)).map(req => cache.delete(req)),
  );
}
