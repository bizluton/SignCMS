// player-dashboard — CAS Sync Status Dashboard API
//
// GET /player-dashboard
//   Returns all screens with their latest disk_status telemetry.
//   Designed to power an ops dashboard showing per-player sync health.
//
// Authentication: service-role key in Authorization header
//   Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
//
// Optional query params:
//   ?org_id=<uuid>   — filter to a single org
//   ?failed=true     — only return players with ≥1 permanently-failed asset
//   ?stale=true      — only return players whose disk_status_at is > 5 min old
//
// Response shape:
//   {
//     ok: true,
//     generated_at: "2026-05-10T...",
//     total_players: 12,
//     players: [{
//       id, name, org_id, online, last_ping_at,
//       disk_status: {
//         casDirPath, casTotalBytes, casFileCount, freeBytesExternal,
//         manifestTotal, manifestSynced, manifestPending, manifestFailed,
//         failures: [{sha256, url, attempts, lastFailedMs, expectedHash, actualHash, lastError}]
//       },
//       disk_status_at: "2026-05-10T...",
//       // computed summary fields (null when disk_status is absent):
//       sync_pct:        95,         // manifestSynced / manifestTotal * 100
//       free_gb:         12.3,
//       has_failures:    false,
//       is_stale:        false,      // disk_status_at older than 5 min
//     }]
//   }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const STALE_THRESHOLD_MS = 5 * 60 * 1000;   // 5 min — player should sync every 30 s

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

interface DiskStatus {
  casDirPath:        string;
  casTotalBytes:     number;
  casFileCount:      number;
  freeBytesExternal: number;
  manifestTotal:     number;
  manifestSynced:    number;
  manifestPending:   number;
  manifestFailed:    number;
  failures:          FailureRecord[];
}

interface FailureRecord {
  sha256:       string;
  url:          string;
  attempts:     number;
  lastFailedMs: number;
  expectedHash: string;
  actualHash:   string | null;
  lastError:    string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "GET")    return json({ ok: false, error: "method_not_allowed" }, 405);

  // ── Auth: require service-role key ────────────────────────────────────────
  const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("authorization") ?? "";
  const callerKey  = authHeader.replace(/^Bearer\s+/i, "");
  if (!callerKey || callerKey !== SERVICE_ROLE) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── Query params ──────────────────────────────────────────────────────────
  const url       = new URL(req.url);
  const orgFilter = url.searchParams.get("org_id");
  const onlyFail  = url.searchParams.get("failed") === "true";
  const onlyStale = url.searchParams.get("stale")  === "true";

  // ── Fetch players ─────────────────────────────────────────────────────────
  let query = admin.from("screens")
    .select("id, name, org_id, online, last_ping_at, disk_status, disk_status_at")
    .order("name", { ascending: true });

  if (orgFilter) query = query.eq("org_id", orgFilter);

  const { data: rows, error } = await query;
  if (error) return json({ ok: false, error: error.message }, 500);

  const now = Date.now();

  // ── Enrich + filter ───────────────────────────────────────────────────────
  const players = (rows ?? [])
    .map((row) => {
      const ds: DiskStatus | null = row.disk_status ?? null;
      const statusAt: string | null = row.disk_status_at ?? null;

      const syncPct = ds && ds.manifestTotal > 0
        ? Math.round((ds.manifestSynced / ds.manifestTotal) * 100)
        : null;

      const freeGb = ds
        ? Math.round(ds.freeBytesExternal / 1_073_741_824 * 10) / 10
        : null;

      const hasFailures = ds ? ds.manifestFailed > 0 : false;

      const isStale = statusAt
        ? now - new Date(statusAt).getTime() > STALE_THRESHOLD_MS
        : true;  // no status yet = consider stale

      return {
        id:            row.id,
        name:          row.name,
        org_id:        row.org_id,
        online:        row.online,
        last_ping_at:  row.last_ping_at,
        disk_status:   ds,
        disk_status_at: statusAt,
        // Computed summary fields
        sync_pct:     syncPct,
        free_gb:      freeGb,
        has_failures: hasFailures,
        is_stale:     isStale,
      };
    })
    .filter((p) => {
      if (onlyFail  && !p.has_failures) return false;
      if (onlyStale && !p.is_stale)     return false;
      return true;
    });

  // ── Aggregate stats ───────────────────────────────────────────────────────
  const stats = {
    total:              players.length,
    online:             players.filter((p) => p.online).length,
    with_failures:      players.filter((p) => p.has_failures).length,
    stale:              players.filter((p) => p.is_stale).length,
    fully_synced:       players.filter((p) => p.sync_pct === 100).length,
  };

  return json({
    ok:            true,
    generated_at:  new Date().toISOString(),
    total_players: players.length,
    stats,
    players,
  });
});
