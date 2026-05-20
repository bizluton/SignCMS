/**
 * SignCMS API Proxy + Media CDN — Cloudflare Worker
 *
 * Two responsibilities:
 *   1. URL rewrite: clients hit a clean signcms-owned hostname instead of
 *      the raw Supabase project URL.
 *   2. CDN for media: long-TTL cache on /storage/v1/object/public/media/* and
 *      /storage/v1/object/public/system-widgets/* so player downloads don't
 *      keep hitting Supabase Storage origin (egress is $0.09/GB).
 *
 * Routing rules:
 *   GET   /storage/v1/object/public/media/...        → cache 1 yr (immutable CAS)
 *   GET   /storage/v1/object/public/system-widgets/.../...  → cache 1 hr (mutable)
 *   any   /realtime/v1/websocket                     → WebSocket upgrade, no cache
 *   POST/PUT/PATCH/DELETE                            → pass through, no cache
 *   GET   /rest/v1/...  /auth/v1/...  /functions/v1/... → pass through, no cache
 *   anything else                                    → pass through, no cache
 *
 * Custom domains: configure cdn.signcms.net (or whatever) → this worker
 * via Cloudflare dashboard → Workers Routes / Custom Domains.
 *
 * Deploy:
 *   wrangler deploy
 */

const SUPABASE_HOST = "narhbpojjtnalyfiwxue.supabase.co";

// Paths that are safe to cache aggressively. Order matters: more-specific
// rules first. Each entry: { test, ttl, cacheTag }.
const CACHE_RULES = [
  {
    // CAS media (immutable; same sha256 → same content forever).
    test:     (path) => path.startsWith("/storage/v1/object/public/media/assets/"),
    ttl:      60 * 60 * 24 * 365,  // 1 year
    cacheTag: "media-cas",
  },
  {
    // Legacy per-org media (md5 layout; still immutable per filename).
    test:     (path) => path.startsWith("/storage/v1/object/public/media/"),
    ttl:      60 * 60 * 24 * 365,  // 1 year
    cacheTag: "media-legacy",
  },
  {
    // System widgets (slugs like /system-widgets/taiwan_weather/index.html).
    // Files can be updated under same name → moderate TTL + we strip 5xx.
    test:     (path) => path.startsWith("/storage/v1/object/public/system-widgets/"),
    ttl:      60 * 60,             // 1 hour
    cacheTag: "system-widgets",
  },
];

function matchCacheRule(path) {
  for (const rule of CACHE_RULES) if (rule.test(path)) return rule;
  return null;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    url.hostname = SUPABASE_HOST;

    // ── WebSocket upgrade (Supabase Realtime) — pass through untouched ────
    if (request.headers.get("Upgrade") === "websocket") {
      url.protocol = "wss:";
      return fetch(new Request(url.toString(), request));
    }

    url.protocol = "https:";

    // ── Cacheable media paths ──────────────────────────────────────────────
    // Only cache idempotent reads. Anything else falls through to passthrough.
    const cacheRule = matchCacheRule(url.pathname);
    const isCacheable =
      cacheRule !== null &&
      (request.method === "GET" || request.method === "HEAD");

    if (isCacheable) {
      // Build a stable cache key: URL only (drop Authorization / cookies so a
      // single asset is shared across all callers). Public bucket needs no auth.
      const cacheKeyUrl = new URL(url.toString());
      // Strip query params that are auth / signed-url tokens but not part of
      // content addressing. (Public CAS URLs typically have no query string.)
      cacheKeyUrl.search = "";

      const upstreamHeaders = new Headers(request.headers);
      upstreamHeaders.delete("Authorization");
      upstreamHeaders.delete("Cookie");
      // Preserve Range so origin can produce 206 partial content the first
      // time; Cloudflare handles further range slices from cache.
      // Range header is intentionally NOT deleted.

      const cfOptions = {
        cacheEverything: true,
        cacheKey:        cacheKeyUrl.toString(),
        cacheTtl:        cacheRule.ttl,
        // Cache 200/206 fully; cache 404 briefly to avoid hammering Storage
        // when a player is configured with a stale URL; never cache 5xx.
        cacheTtlByStatus: {
          "200-299": cacheRule.ttl,
          "404":      60,
          "500-599": 0,
        },
        cacheTags: [cacheRule.cacheTag],
      };

      const upstreamReq = new Request(url.toString(), {
        method:   request.method,
        headers:  upstreamHeaders,
        redirect: "follow",
        // @ts-ignore — `cf` is a Cloudflare-specific extension
        cf:       cfOptions,
      });

      const res = await fetch(upstreamReq);

      // Surface a public Cache-Control on the response so browsers / players
      // also keep the file locally instead of re-hitting the edge.
      const respHeaders = new Headers(res.headers);
      if (cacheRule.cacheTag === "media-cas") {
        respHeaders.set("Cache-Control", "public, max-age=31536000, immutable");
      } else if (cacheRule.cacheTag === "media-legacy") {
        respHeaders.set("Cache-Control", "public, max-age=31536000");
      } else {
        respHeaders.set("Cache-Control", "public, max-age=3600");
      }
      // Add a debug header so it's easy to confirm caching in production.
      respHeaders.set("X-SignCMS-Cache", cacheRule.cacheTag);

      return new Response(res.body, {
        status:     res.status,
        statusText: res.statusText,
        headers:    respHeaders,
      });
    }

    // ── Passthrough (auth / realtime / rest / functions / mutations) ──────
    return fetch(new Request(url.toString(), {
      method:   request.method,
      headers:  request.headers,
      body:     request.method !== "GET" && request.method !== "HEAD"
                  ? request.body
                  : undefined,
      redirect: "follow",
    }));
  },
};
