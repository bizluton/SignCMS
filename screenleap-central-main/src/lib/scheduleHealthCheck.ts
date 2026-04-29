import { supabase } from "@/integrations/supabase/client";

/**
 * Pre-export health check for a schedule. Mirrors what `exportScheduleToZip`
 * would do — gathers all referenced media (direct + BGM + design-project zone
 * media), then reports per-media status without actually downloading or
 * packaging any binary. Cheap to run and safe to call from a list view.
 */

export type HealthIssueReason =
  | "media_not_found_in_db"        // referenced id no longer exists in media_items
  | "no_url"                        // row exists but url column empty
  | "transcode_pending"             // transcode_status indicates job still running
  | "transcode_failed"              // transcode_status = error/failed
  | "design_project_not_found";     // referenced design_project missing

export interface HealthIssue {
  reason: HealthIssueReason;
  mediaId?: string;
  designProjectId?: string;
  /** Human-readable name when known, for display in the report. */
  name?: string;
  /** Where this id was referenced from. */
  referencedFrom: "schedule_item" | "schedule_bgm" | "design_zone";
  /** Extra detail e.g. transcode_status value. */
  detail?: string;
}

export interface HealthCheckResult {
  scheduleId: string;
  scheduleName: string;
  totalReferenced: number;       // total unique media ids referenced
  totalDesignProjects: number;
  okCount: number;               // media with usable url + complete transcode
  issues: HealthIssue[];
  ranAt: string;                 // ISO timestamp
}

const TRANSCODE_PENDING = new Set(["queued", "pending", "processing", "running"]);
const TRANSCODE_OK = new Set(["complete", "completed", "ready", "done", "none", ""]);

/** Real media rows always use UUIDs. Widget/text blocks share the same
 *  `mediaItems` array but use synthetic ids (`cat-widget-…`, `text-…`) and
 *  must be skipped — they aren't stored in the media_items table. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ScheduleItemRow {
  id: string;
  media_id: string | null;
  design_project_id: string | null;
  item_type: string | null;
  sort_order: number | null;
}

interface BgmItemRow {
  id: string;
  media_id: string | null;
  sort_order: number | null;
}

interface DesignProjectRow {
  id: string;
  name: string | null;
  zones: unknown[] | null;
}

interface ZoneContent {
  mediaItems?: Array<{ id?: unknown; type?: string }>;
}

interface Zone {
  content?: ZoneContent;
  overlays?: Array<{ content?: ZoneContent }>;
  bgm?: { items?: Array<{ id?: unknown }> };
}

interface MediaItemRow {
  id: string;
  name: string | null;
  original_name: string | null;
  url: string | null;
  transcode_status: string | null;
  mime_type: string | null;
}

export async function runScheduleHealthCheck(scheduleId: string): Promise<HealthCheckResult> {
  const { data: schedRow } = await supabase
    .from("schedules").select("id, name").eq("id", scheduleId).maybeSingle();

  const [{ data: itemRows }, { data: bgmRows }] = await Promise.all([
    supabase
      .from("schedule_items")
      .select("id, media_id, design_project_id, item_type, sort_order")
      .eq("schedule_id", scheduleId).order("sort_order"),
    supabase
      .from("schedule_bgm_items")
      .select("id, media_id, sort_order")
      .eq("schedule_id", scheduleId).order("sort_order"),
  ]);

  // Track where each id came from so the report is actionable.
  const mediaRefs = new Map<string, HealthIssue["referencedFrom"]>();
  const designIds = new Set<string>();

  for (const it of (itemRows as ScheduleItemRow[] | null) || []) {
    if (it.media_id) mediaRefs.set(String(it.media_id), "schedule_item");
    if (it.design_project_id) designIds.add(String(it.design_project_id));
  }
  for (const b of (bgmRows as BgmItemRow[] | null) || []) {
    if (b.media_id && !mediaRefs.has(String(b.media_id))) {
      mediaRefs.set(String(b.media_id), "schedule_bgm");
    }
  }

  // Resolve design projects → may pull in extra media ids referenced by zones.
  const issues: HealthIssue[] = [];
  let designRows: DesignProjectRow[] = [];
  if (designIds.size > 0) {
    const { data } = await supabase
      .from("design_projects")
      .select("id, name, zones")
      .in("id", Array.from(designIds));
    designRows = (data as DesignProjectRow[] | null) || [];
    const fetchedDesignIds = new Set(designRows.map((d) => String(d.id)));
    for (const id of designIds) {
      if (!fetchedDesignIds.has(id)) {
        issues.push({
          reason: "design_project_not_found",
          designProjectId: id,
          referencedFrom: "schedule_item",
        });
      }
    }
    const walk = (content: ZoneContent | null | undefined) => {
      if (!content) return;
      if (Array.isArray(content.mediaItems)) {
        for (const m of content.mediaItems) {
          if (!m?.id) continue;
          const id = String(m.id);
          if (!UUID_RE.test(id)) continue;
          if (m.type && m.type !== "image" && m.type !== "video") continue;
          if (!mediaRefs.has(id)) mediaRefs.set(id, "design_zone");
        }
      }
    };
    for (const d of designRows) {
      const zones = Array.isArray(d.zones) ? (d.zones as Zone[]) : [];
      for (const z of zones) {
        walk(z?.content);
        if (Array.isArray(z?.overlays)) for (const o of z.overlays) walk(o?.content);
        // Design-project-level BGM (audio) lives on the meta zone
        // (`_meta: true`) as `zone.bgm.items[]` — also packaged on export.
        const bgmItems = z?.bgm?.items;
        if (Array.isArray(bgmItems)) {
          for (const a of bgmItems) {
            if (!a?.id) continue;
            const id = String(a.id);
            if (!UUID_RE.test(id)) continue;
            if (!mediaRefs.has(id)) mediaRefs.set(id, "design_zone");
          }
        }
      }
    }
  }

  // Resolve media rows.
  let mediaRows: MediaItemRow[] = [];
  if (mediaRefs.size > 0) {
    const { data } = await supabase
      .from("media_items")
      .select("id, name, original_name, url, transcode_status, mime_type")
      .in("id", Array.from(mediaRefs.keys()));
    mediaRows = (data as MediaItemRow[] | null) || [];
  }
  const fetchedMediaIds = new Set(mediaRows.map((r) => String(r.id)));

  for (const [id, ref] of mediaRefs) {
    if (!fetchedMediaIds.has(id)) {
      issues.push({ reason: "media_not_found_in_db", mediaId: id, referencedFrom: ref });
    }
  }

  let okCount = 0;
  for (const m of mediaRows) {
    const ref = mediaRefs.get(String(m.id)) || "schedule_item";
    const status: string = (m.transcode_status || "").toLowerCase();
    const name = m.original_name || m.name || undefined;
    if (TRANSCODE_PENDING.has(status)) {
      issues.push({
        reason: "transcode_pending", mediaId: String(m.id), name,
        referencedFrom: ref, detail: status,
      });
      continue;
    }
    if (status === "error" || status === "failed") {
      issues.push({
        reason: "transcode_failed", mediaId: String(m.id), name,
        referencedFrom: ref, detail: status,
      });
      continue;
    }
    if (!m.url) {
      issues.push({
        reason: "no_url", mediaId: String(m.id), name, referencedFrom: ref,
        detail: status,
      });
      continue;
    }
    if (!TRANSCODE_OK.has(status)) {
      // Unknown status — treat as pending so the user sees it.
      issues.push({
        reason: "transcode_pending", mediaId: String(m.id), name,
        referencedFrom: ref, detail: status,
      });
      continue;
    }
    okCount += 1;
  }

  return {
    scheduleId,
    scheduleName: (schedRow as { name?: string } | null)?.name ?? "(unknown)",
    totalReferenced: mediaRefs.size,
    totalDesignProjects: designIds.size,
    okCount,
    issues,
    ranAt: new Date().toISOString(),
  };
}
