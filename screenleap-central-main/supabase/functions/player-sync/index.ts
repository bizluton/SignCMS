// player-sync — SignCMS Player API
// Authenticates via device_token, returns screen content + handles heartbeat + log batch
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

interface LogEntry {
  media_id?:         string;
  // media_name is intentionally absent: name is resolved server-side from media_items
  duration_seconds?: number;
}

interface AssetEntry {
  url:    string;
  sha256: string | null;  // null for legacy items uploaded before CAS Phase 1
  size:   number | null;  // size_bytes
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST")    return json({ ok: false, error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const deviceToken = req.headers.get("x-device-token") ?? "";
  if (!deviceToken) return json({ ok: false, error: "missing_token" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── Validate device token ───────────────────────────────────────────────
  const { data: auth } = await admin.rpc("get_screen_by_device_token", { _token: deviceToken });
  if (!auth?.ok) return json({ ok: false, error: auth?.error ?? "invalid_token" }, 401);

  const screenId = auth.screen_id as string;
  const orgId    = auth.org_id    as string;
  const now      = new Date();

  // ── Parse body ─────────────────────────────────────────────────────────────
  let logBatch: LogEntry[] = [];
  let shadowReported: Record<string, unknown> | null = null;
  let projectEtag: string | null = null;
  // disk_status: CAS sync-engine telemetry from Android DownloadService
  let diskStatus: Record<string, unknown> | null = null;
  try {
    const body = await req.json();
    if (Array.isArray(body?.log_batch))                      logBatch       = body.log_batch.slice(0, 200);
    if (body?.reported && typeof body.reported === "object") shadowReported = body.reported;
    if (typeof body?.project_etag === "string")              projectEtag    = body.project_etag;
    if (body?.disk_status && typeof body.disk_status === "object") diskStatus = body.disk_status;
  } catch { /* empty body ok */ }

  // ── Heartbeat + optional disk_status telemetry ─────────────────────────
  await admin.from("screens").update({
    last_ping_at:    now.toISOString(),
    online:          true,
    status:          "online",
    updated_at:      now.toISOString(),
    // Include disk_status only when the player sent it (avoids nulling existing data)
    ...(diskStatus !== null ? {
      disk_status:    diskStatus,
      disk_status_at: now.toISOString(),
    } : {}),
  }).eq("id", screenId);

  // ── Playback log batch ──────────────────────────────────────────────────
  // media_name is resolved server-side from media_items so renderer-supplied
  // strings cannot appear in the log. Unresolvable IDs fall back to "".
  if (logBatch.length > 0) {
    const mediaIds = [...new Set(
      logBatch.map((l) => l.media_id).filter((id): id is string => !!id)
    )];
    const nameMap = new Map<string, string>();
    if (mediaIds.length > 0) {
      const { data: items } = await admin
        .from("media_items")
        .select("id, name")
        .in("id", mediaIds);
      for (const item of items ?? []) nameMap.set(item.id, item.name ?? "");
    }
    await admin.from("playback_logs").insert(
      logBatch.map((l) => ({
        screen_id:        screenId,
        org_id:           orgId,
        media_id:         l.media_id         ?? null,
        media_name:       l.media_id ? (nameMap.get(l.media_id) ?? "") : "",
        duration_seconds: l.duration_seconds  ?? 0,
        played_at:        now.toISOString(),
      }))
    );
  }

  // ── Resolve active channel ──────────────────────────────────────────────
  const { data: screen } = await admin.from("screens")
    .select("name, current_channel_id, channel_override_until, default_playback, default_media_id, default_project_id")
    .eq("id", screenId).maybeSingle();

  let channelId: string | null = null;

  // Override channel (time-limited)
  if (screen?.current_channel_id && screen?.channel_override_until) {
    if (new Date(screen.channel_override_until) > now) {
      channelId = screen.current_channel_id;
    }
  }
  // Default subscription
  if (!channelId) {
    const { data: sub } = await admin.from("screen_channel_subscriptions")
      .select("channel_id").eq("screen_id", screenId).eq("is_default", true).maybeSingle();
    channelId = sub?.channel_id ?? null;
  }
  // Any subscription fallback
  if (!channelId) {
    const { data: sub } = await admin.from("screen_channel_subscriptions")
      .select("channel_id").eq("screen_id", screenId).limit(1).maybeSingle();
    channelId = sub?.channel_id ?? null;
  }

  // ── Fetch channel + active project ─────────────────────────────────────
  let channelOut = null;
  let projectOut = null;
  // layoutsOut: all design projects linked via channel_allowed_projects
  // (only populated when there are ≥2 options so the player can show a switcher).
  let layoutsOut: Array<{ id: string; name: string; zones: unknown; updated_at: string }> | null = null;

  if (channelId) {
    const { data: ch } = await admin.from("channels")
      .select("id, name, default_design_project_id, bgm_volume, aspect")
      .eq("id", channelId).maybeSingle();

    if (ch) {
      channelOut = { id: ch.id, name: ch.name, aspect: ch.aspect, bgm_volume: ch.bgm_volume };

      // Check scheduled channel blocks
      const nowTime = now.toTimeString().substring(0, 8);   // HH:MM:SS
      const nowDate = now.toISOString().substring(0, 10);   // YYYY-MM-DD
      const nowDay  = now.getDay();                          // 0 = Sunday

      const { data: blocks } = await admin.from("channel_blocks")
        .select("design_project_id, priority, weekdays, start_time, end_time, effective_from, effective_to")
        .eq("channel_id", channelId).eq("enabled", true)
        .order("priority", { ascending: false });

      let activeProjectId = ch.default_design_project_id;

      const activeBlock = (blocks ?? []).find((b) => {
        if (b.weekdays?.length > 0 && !b.weekdays.includes(nowDay)) return false;
        if (b.start_time && nowTime < b.start_time) return false;
        if (b.end_time   && nowTime > b.end_time)   return false;
        if (b.effective_from && nowDate < b.effective_from) return false;
        if (b.effective_to   && nowDate > b.effective_to)   return false;
        return true;
      });
      if (activeBlock?.design_project_id) activeProjectId = activeBlock.design_project_id;

      // ── Allowed layouts (channel_allowed_projects) ─────────────────────────
      // Fetch in parallel with the active-project query below so it costs no
      // extra latency.  We only return zones when ≥2 layouts exist so the
      // player can show a manual switcher in the HUD.
      const allowedReq = admin
        .from("channel_allowed_projects")
        .select("sort_order, design_project_id")
        .eq("channel_id", channelId)
        .order("sort_order");

      if (activeProjectId) {
        // ── ETag check + asset manifest — run in parallel ─────────────────
        // asset_manifest: all non-deleted media items for this project,
        // including sha256 (null for legacy rows) so the player can do
        // hash-based delta sync (CAS Phase 3+).
        // Always returned regardless of zones_changed so the player can
        // warm its cache even when layout content hasn't changed.
        const [projMetaRes, assetsRes, allowedRes] = await Promise.all([
          admin.from("design_projects")
            .select("id, name, aspect, updated_at")
            .eq("id", activeProjectId).maybeSingle(),
          admin.from("media_items")
            .select("url, sha256, size_bytes")
            .eq("design_project_id", activeProjectId)
            .is("deleted_at", null)
            .limit(500),
          allowedReq,
        ]);

        const projMeta      = projMetaRes.data;
        const assetManifest: AssetEntry[] = (assetsRes.data ?? []).map((a) => ({
          url:    a.url,
          sha256: a.sha256    ?? null,
          size:   a.size_bytes ?? null,
        }));

        if (projMeta) {
          const unchanged = projectEtag && projectEtag === projMeta.updated_at;

          if (unchanged) {
            // Layout unchanged — skip zones blob to save bandwidth
            projectOut = { ...projMeta, zones_changed: false, asset_manifest: assetManifest };
          } else {
            // Layout changed (or first sync) — return full zones
            const { data: proj } = await admin.from("design_projects")
              .select("id, name, aspect, zones, updated_at")
              .eq("id", activeProjectId).maybeSingle();
            projectOut = proj ? { ...proj, zones_changed: true, asset_manifest: assetManifest } : null;
          }
        }

        // ── Populate layoutsOut when channel has ≥2 allowed projects ─────────
        // Fetch full zones for every layout so the player can switch without
        // another round-trip.  Skip if allowedRes has ≤1 row.
        const allowed = allowedRes.data ?? [];
        if (allowed.length >= 2) {
          const ids = allowed.map((a) => a.design_project_id);
          const { data: layoutProjects } = await admin
            .from("design_projects")
            .select("id, name, zones, updated_at")
            .in("id", ids);

          if (layoutProjects?.length) {
            layoutsOut = allowed
              .map((a) => layoutProjects.find((p) => p.id === a.design_project_id))
              .filter((p): p is NonNullable<typeof p> => p != null);
          }
        }
      }
    }
  }

  // ── Default content (when no channel project is active) ──────────────────
  // Respects the screen's default_playback setting:
  //   sleep   → nothing returned; renderer shows black screen
  //   project → fetch default_project_id and return as project
  //   media   → fetch default_media_id and return as default_media
  let defaultMediaOut: { id: string; url: string; sha256: string | null; size: number | null; type: string | null } | null = null;

  if (!projectOut && screen) {
    if (screen.default_playback === "project" && screen.default_project_id) {
      const [projMetaRes, assetsRes] = await Promise.all([
        admin.from("design_projects")
          .select("id, name, aspect, updated_at")
          .eq("id", screen.default_project_id).maybeSingle(),
        admin.from("media_items")
          .select("url, sha256, size_bytes")
          .eq("design_project_id", screen.default_project_id)
          .is("deleted_at", null).limit(500),
      ]);
      const projMeta      = projMetaRes.data;
      const assetManifest: AssetEntry[] = (assetsRes.data ?? []).map((a) => ({
        url: a.url, sha256: a.sha256 ?? null, size: a.size_bytes ?? null,
      }));
      if (projMeta) {
        const unchanged = projectEtag && projectEtag === projMeta.updated_at;
        if (unchanged) {
          projectOut = { ...projMeta, zones_changed: false, asset_manifest: assetManifest };
        } else {
          const { data: proj } = await admin.from("design_projects")
            .select("id, name, aspect, zones, updated_at")
            .eq("id", screen.default_project_id).maybeSingle();
          projectOut = proj ? { ...proj, zones_changed: true, asset_manifest: assetManifest } : null;
        }
      }
    } else if (screen.default_playback === "media" && screen.default_media_id) {
      const { data: mi } = await admin.from("media_items")
        .select("id, url, sha256, size_bytes, type")
        .eq("id", screen.default_media_id)
        .is("deleted_at", null)
        .maybeSingle();
      if (mi) {
        defaultMediaOut = {
          id:     mi.id,
          url:    mi.url,
          sha256: mi.sha256     ?? null,
          size:   mi.size_bytes ?? null,
          type:   mi.type       ?? null,
        };
      }
    }
  }

  // ── Active announcements ────────────────────────────────────────────────
  const { data: announcements } = await admin.from("announcements")
    .select("id, subject, content, pinned, dwell_seconds, start_at, end_at")
    .eq("org_id", orgId)
    .lte("start_at", now.toISOString())
    .gte("end_at",   now.toISOString())
    .order("pinned",   { ascending: false })
    .order("start_at", { ascending: false })
    .limit(10);

  // ── Device Shadow ────────────────────────────────────────────────────────
  // Read the current shadow (desired + delta) for this screen.
  // If the player piggybacked a reported state in the request body, update it.
  let shadowOut: { desired: Record<string, unknown>; delta: Record<string, unknown> } | null = null;

  if (shadowReported !== null) {
    // Player sent its current reported state → upsert + let DB compute delta
    const { data: sh } = await admin
      .from("screen_shadows")
      .upsert({ screen_id: screenId, reported: shadowReported }, { onConflict: "screen_id" })
      .select("desired, delta")
      .maybeSingle();
    shadowOut = sh ? { desired: sh.desired ?? {}, delta: sh.delta ?? {} } : null;
  } else {
    // Just read the current shadow
    const { data: sh } = await admin
      .from("screen_shadows")
      .select("desired, delta")
      .eq("screen_id", screenId)
      .maybeSingle();
    shadowOut = sh ? { desired: sh.desired ?? {}, delta: sh.delta ?? {} } : null;
  }

  // ── Supabase Realtime channel info ─────────────────────────────────────────
  // Devices subscribe to "screen:{screenId}" to receive real-time commands.
  // supabase_url is the direct project URL (not the Worker proxy) so the player
  // can open a WebSocket directly to Supabase — Workers cannot proxy WebSocket.
  const ANON_KEY    = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const realtimeOut = {
    channel:      `screen:${screenId}`,
    apikey:       ANON_KEY,
    supabase_url: SUPABASE_URL,
  };

  return json({
    ok:            true,
    server_time:   now.toISOString(),
    screen:        { id: screenId, name: screen?.name ?? auth.screen_name, org_id: orgId },
    channel:       channelOut,
    project:       projectOut,
    layouts:       layoutsOut,   // null | [{id,name,zones,updated_at}] — only when ≥2 exist
    default_media: defaultMediaOut,
    announcements: announcements ?? [],
    shadow:        shadowOut,
    realtime:      realtimeOut,
  });
});
