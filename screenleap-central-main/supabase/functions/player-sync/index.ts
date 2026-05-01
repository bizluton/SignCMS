/**
 * player-sync
 *
 * Native Android player API.  Called by the Management Software on each device
 * to obtain the current schedule, media manifest, and smart-trigger rule list.
 *
 * GET /functions/v1/player-sync?screen_id={uuid}
 *
 * Authentication:
 *   Pass the Supabase publishable (anon) key as:
 *     Authorization: Bearer {SUPABASE_ANON_KEY}
 *   or as the apikey query parameter.
 *   No user session is required; the screen_id UUID + license check gate access.
 *
 * Response shape: see PlayerSyncResponse type below.
 *
 * The APK should:
 *   1. Store the returned sync_token locally.
 *   2. On the next poll, if sync_token is unchanged, skip re-processing.
 *   3. Download any media entry whose local_path file does not yet exist, or
 *      whose md5 differs from the stored value.
 *   4. Delete local files whose md5 no longer appears in any schedule's media list.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Derive a file extension from a MIME type. */
function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/aac": "aac",
    "audio/wav": "wav",
    "audio/ogg": "ogg",
  };
  return map[mime] ?? mime.split("/")[1]?.split(";")[0] ?? "bin";
}

/**
 * Local storage path for a media file.
 * The APK stores files at {filesDir}/media/{md5}.{ext}.
 */
function localPath(md5: string, mimeType: string): string {
  return `media/${md5}.${mimeToExt(mimeType)}`;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ─── Types ────────────────────────────────────────────────────────────────────

interface MediaEntry {
  id: string;
  name: string;
  url: string;
  /** Relative path where the APK should store the file. e.g. "media/abc123.mp4" */
  local_path: string;
  md5: string;
  size_bytes: number;
  mime_type: string;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
}

interface PlaylistItem {
  id: string;
  /** "image" | "video" | "audio" | "design_project" */
  type: string;
  /**
   * Display duration in seconds.
   * null for video items → play to natural end, then advance.
   */
  duration: number | null;
  /** Present when type !== "design_project". */
  media?: MediaEntry;
  /** Present when type === "design_project". */
  design_id?: string;
  design_name?: string;
}

interface BgmTrack extends MediaEntry {
  /** Track display name. */
  track_name: string;
}

interface Schedule {
  id: string;
  name: string;
  enabled: boolean;
  time_rules: {
    start: string;  // "HH:MM"
    end: string;    // "HH:MM"
    days: string[]; // ["Mon","Tue",...]
  };
  updated_at: string;
  playlist: PlaylistItem[];
  bgm: {
    volume: number;
    tracks: BgmTrack[];
  };
}

interface SmartTriggerRule {
  rule_id: string;
  name: string;
  enabled: boolean;
  scope: string;
  design_id: string | null;
  duration_seconds: number;
}

// ─── DB row types ─────────────────────────────────────────────────────────────

interface RawMediaItem {
  id: string;
  name: string;
  type: string;
  url: string;
  md5: string | null;
  size_bytes: number | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  transcode_status: string | null;
}

interface RawScheduleItem {
  id: string;
  media_id: string | null;
  design_project_id: string | null;
  duration: number;
  item_type: string;
  sort_order: number;
  media_items: RawMediaItem | null;
  design_projects: { id: string; name: string } | null;
}

interface RawBgmItem {
  id: string;
  media_id: string;
  sort_order: number;
  media_items: RawMediaItem | null;
}

interface RawSchedule {
  id: string;
  name: string;
  enabled: boolean;
  start_time: string;
  end_time: string;
  days: string[];
  bgm_volume: number | null;
  updated_at: string;
  schedule_items: RawScheduleItem[];
  schedule_bgm_items: RawBgmItem[];
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  try {
    const url = new URL(req.url);
    const screenId = url.searchParams.get("screen_id");
    if (!screenId) return json({ error: "screen_id is required" }, 400);

    // Use the service-role key so we can bypass RLS; the license check gates access.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── 1. License check ──────────────────────────────────────────────────────
    const { data: licenseData, error: licenseError } = await supabase
      .rpc("check_screen_license_status", { _screen_id: screenId });

    if (licenseError) {
      console.error("License check error:", licenseError);
      return json({ error: "license_check_failed" }, 500);
    }

    const license = licenseData as {
      licensed: boolean;
      status: string;
      revoked_at?: string;
    };

    if (!license.licensed) {
      return json({
        licensed: false,
        license_status: license.status,
        revoked_at: license.revoked_at ?? null,
        screen: null,
        schedules: [],
        smart_triggers: [],
        sync_token: new Date().toISOString(),
      });
    }

    // ── 2. Screen info ────────────────────────────────────────────────────────
    const { data: screen, error: screenError } = await supabase
      .from("screens")
      .select("id, name, org_id, resolution")
      .eq("id", screenId)
      .maybeSingle();

    if (screenError || !screen) return json({ error: "screen_not_found" }, 404);

    // ── 3. Schedules with full media metadata ─────────────────────────────────
    const { data: schedRows, error: schedError } = await supabase
      .from("schedules" as never)
      .select(
        "id, name, enabled, start_time, end_time, days, bgm_volume, updated_at," +
        "schedule_items(" +
        "  id, media_id, design_project_id, duration, item_type, sort_order," +
        "  media_items(id, name, type, url, md5, size_bytes, mime_type, width, height, duration_seconds, transcode_status)," +
        "  design_projects(id, name)" +
        ")," +
        "schedule_bgm_items(" +
        "  id, media_id, sort_order," +
        "  media_items(id, name, type, url, md5, size_bytes, mime_type, width, height, duration_seconds, transcode_status)" +
        ")",
      )
      .eq("screen_id", screenId)
      .order("created_at");

    if (schedError) {
      console.error("Schedule fetch error:", schedError);
      return json({ error: "schedule_fetch_failed" }, 500);
    }

    // ── 4. Smart-trigger rules for this org ───────────────────────────────────
    const { data: triggerRows } = await supabase
      .from("smart_trigger_rules")
      .select("id, name, enabled, scope, target_design_project_id, duration_seconds")
      .eq("org_id", screen.org_id)
      .eq("enabled", true);

    // ── 5. Build response ─────────────────────────────────────────────────────

    const schedules: Schedule[] = ((schedRows as unknown as RawSchedule[]) ?? []).map(s => {

      const playlist: PlaylistItem[] = (s.schedule_items ?? [])
        .sort((a, b) => a.sort_order - b.sort_order)
        .flatMap((item): PlaylistItem[] => {

          if (item.item_type === "design_project" && item.design_projects) {
            return [{
              id: item.id,
              type: "design_project",
              duration: item.duration || 15,
              design_id: item.design_project_id ?? undefined,
              design_name: item.design_projects.name,
            }];
          }

          const m = item.media_items;
          // Skip items with no media or media not yet transcoded
          if (!m?.url || !m.md5) return [];
          if (m.transcode_status === "pending_transcode" || m.transcode_status === "failed") {
            return [];
          }

          const mime = m.mime_type || "application/octet-stream";
          const mediaEntry: MediaEntry = {
            id: m.id,
            name: m.name,
            url: m.url,
            local_path: localPath(m.md5, mime),
            md5: m.md5,
            size_bytes: m.size_bytes ?? 0,
            mime_type: mime,
            width: m.width ?? null,
            height: m.height ?? null,
            duration_seconds: m.duration_seconds ?? null,
          };

          return [{
            id: item.id,
            // For video items, null duration tells the APK to play to natural end.
            type: m.type || "image",
            duration: m.type === "video" ? null : (item.duration || 10),
            media: mediaEntry,
          }];
        });

      const bgmTracks: BgmTrack[] = (s.schedule_bgm_items ?? [])
        .sort((a, b) => a.sort_order - b.sort_order)
        .flatMap((b): BgmTrack[] => {
          const m = b.media_items;
          if (!m?.url || !m.md5) return [];
          const mime = m.mime_type || "audio/mpeg";
          return [{
            id: m.id,
            track_name: m.name,
            name: m.name,
            url: m.url,
            local_path: localPath(m.md5, mime),
            md5: m.md5,
            size_bytes: m.size_bytes ?? 0,
            mime_type: mime,
            width: null,
            height: null,
            duration_seconds: m.duration_seconds ?? null,
          }];
        });

      return {
        id: s.id,
        name: s.name,
        enabled: s.enabled,
        time_rules: {
          start: s.start_time || "00:00",
          end: s.end_time || "23:59",
          days: s.days ?? [],
        },
        updated_at: s.updated_at,
        playlist,
        bgm: {
          volume: typeof s.bgm_volume === "number" ? s.bgm_volume : 30,
          tracks: bgmTracks,
        },
      };
    });

    // sync_token = latest updated_at across all schedules.
    // APK stores this and skips re-processing when it hasn't changed.
    const syncToken = schedules.reduce(
      (latest, s) => (s.updated_at > latest ? s.updated_at : latest),
      new Date(0).toISOString(),
    );

    const smartTriggers: SmartTriggerRule[] = (triggerRows ?? []).map(r => ({
      rule_id: r.id,
      name: r.name,
      enabled: r.enabled,
      scope: r.scope,
      design_id: r.target_design_project_id ?? null,
      duration_seconds: r.duration_seconds ?? 30,
    }));

    return json({
      licensed: true,
      license_status: license.status,
      sync_token: syncToken,
      screen: {
        id: screen.id,
        name: screen.name,
        org_id: screen.org_id,
        resolution: screen.resolution,
      },
      schedules,
      smart_triggers: smartTriggers,
    });

  } catch (err) {
    console.error("player-sync error:", err);
    return json({ error: "internal_error" }, 500);
  }
});
