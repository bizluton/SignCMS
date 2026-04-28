import JSZip from "jszip";
import { supabase } from "@/integrations/supabase/client";
import { rememberExport } from "@/lib/recentExports";
import { toast } from "@/hooks/use-toast";
import { SYSTEM_WIDGETS, isSystemWidgetId } from "@/lib/systemWidgets";
import { isCatalogWidgetId } from "@/hooks/useWidgets";

/** Real media rows always use UUID ids. Widgets/text blocks use synthetic
 *  ids like `cat-widget-…` or `text-…` and must be skipped. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Build virtual `media` manifest entries for widget items so the Local Player
 * can render them offline. System widgets resolve from the local constants;
 * catalog widgets are fetched from the `widgets` table by stripped UUID.
 * Returned entries follow the same shape as real media rows but with
 * `mime_type: "application/x-widget"` and an embedded `widgetConfig`.
 */
async function buildWidgetMediaEntries(widgetIds: Set<string>): Promise<any[]> {
  if (widgetIds.size === 0) return [];
  const out: any[] = [];
  const catalogUuids: string[] = [];
  for (const id of widgetIds) {
    if (isSystemWidgetId(id)) {
      const w = SYSTEM_WIDGETS.find((sw) => sw.id === id);
      if (w) {
        out.push({
          id, name: w.name, original_name: w.name, type: "widget",
          mime_type: "application/x-widget", size_bytes: 0,
          width: null, height: null, duration_seconds: null,
          assetPath: null, widgetConfig: w.config,
        });
      }
    } else if (isCatalogWidgetId(id)) {
      // Strip the `cat-widget-` prefix → real DB row uuid.
      catalogUuids.push(id.replace(/^cat-widget-/, ""));
    }
  }
  if (catalogUuids.length > 0) {
    const { data } = await (supabase as any)
      .from("widgets")
      .select("id, name, name_i18n, config")
      .in("id", catalogUuids);
    for (const row of data || []) {
      out.push({
        id: `cat-widget-${row.id}`, name: row.name, original_name: row.name,
        type: "widget", mime_type: "application/x-widget", size_bytes: 0,
        width: null, height: null, duration_seconds: null,
        assetPath: null, widgetConfig: row.config,
      });
    }
  }
  return out;
}

/** True for any synthetic widget id (system or catalog). */
function isWidgetId(id: string | null | undefined): boolean {
  return isSystemWidgetId(id) || isCatalogWidgetId(id);
}

/**
 * Collect BGM tracks declared inside design-project zones (`zone.bgm.items[]`)
 * and return them in the same shape as `schedule_bgm_items` rows so they can
 * be merged into `manifest.bgm` for the Local Player.
 */
function collectDesignBgm(designRows: any[]): { media_id: string; sort_order: number }[] {
  const seen = new Set<string>();
  const out: { media_id: string; sort_order: number }[] = [];
  let order = 1000; // sort after schedule-level BGM
  for (const d of designRows || []) {
    const zones = Array.isArray(d?.zones) ? d.zones : [];
    for (const z of zones) {
      const items = z?.bgm?.items;
      if (!Array.isArray(items)) continue;
      for (const a of items) {
        const id = a?.id ? String(a.id) : "";
        if (!UUID_RE.test(id) || seen.has(id)) continue;
        seen.add(id);
        out.push({ media_id: id, sort_order: order++ });
      }
    }
  }
  return out;
}

/**
 * Shared schedule → ZIP exporter used by both Schedules page and Publishing Center.
 *
 * Bundles a `schedule.json` manifest plus an `assets/` folder containing all
 * referenced media (direct items + BGM + design project zone media). The
 * download is triggered automatically and the blob is cached in-memory so
 * users can re-download from the System Logs UI.
 */

export interface ExportScheduleInput {
  scheduleId: string;
  /** Fallback name shown if DB row can't be fetched. */
  fallbackName?: string;
  /** Org id for the activity_logs row. */
  orgId?: string | null;
  /** Current user id for the activity_logs row. */
  userId?: string | null;
  /**
   * Where the export was triggered from. Used to distinguish a normal
   * "Schedules page" export from a "USB / local download" triggered from
   * the Publishing Center, so the activity log can filter on it.
   * - "schedules" (default) → action `export_schedule`
   * - "usb"               → action `export_schedule_usb`
   */
  source?: "schedules" | "usb";
  /** Skip auto-triggering the browser download. Used by in-app preview
   *  flows that only need the in-memory blob. Defaults to false. */
  skipDownload?: boolean;
  /** Skip writing an `activity_logs` row. Use for previews. Defaults to false. */
  skipLog?: boolean;
}

export interface ExportScheduleResult {
  blob: Blob;
  url: string;
  filename: string;
  sizeBytes: number;
  itemCount: number;
  mediaCount: number;
  scheduleName: string;
}

const sanitizeName = (s: string) =>
  (s || "file").replace(/[^\w\-.]+/g, "_").slice(0, 80);

const mimeExtMap: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
  "video/mp4": "mp4", "video/webm": "webm", "audio/mpeg": "mp3", "audio/wav": "wav",
};

export interface ExportScheduleFolderResult {
  filename: string;          // root folder name written
  scheduleName: string;
  itemCount: number;
  mediaCount: number;
  sizeBytes: number;         // total bytes written
  fileCount: number;         // number of asset files written
}

export function isFolderExportSupported(): boolean {
  return typeof window !== "undefined" && typeof (window as any).showDirectoryPicker === "function";
}

export async function exportScheduleToZip(input: ExportScheduleInput): Promise<ExportScheduleResult> {
  const { scheduleId, fallbackName, orgId, userId, source = "schedules", skipDownload, skipLog } = input;

  const { data: schedRow } = await (supabase as any)
    .from("schedules").select("*").eq("id", scheduleId).single();
  const { data: itemRows } = await (supabase as any)
    .from("schedule_items")
    .select("id, media_id, design_project_id, item_type, sort_order, duration")
    .eq("schedule_id", scheduleId).order("sort_order");
  const { data: bgmRows } = await (supabase as any)
    .from("schedule_bgm_items")
    .select("id, media_id, sort_order")
    .eq("schedule_id", scheduleId).order("sort_order");

  const mediaIds = new Set<string>();
  const designIds = new Set<string>();
  const widgetIds = new Set<string>();
  for (const it of itemRows || []) {
    if (it.media_id) {
      const id = String(it.media_id);
      if (isWidgetId(id)) widgetIds.add(id);
      else mediaIds.add(id);
    }
    if (it.design_project_id) designIds.add(String(it.design_project_id));
  }
  for (const b of bgmRows || []) if (b.media_id) mediaIds.add(String(b.media_id));

  let designRows: any[] = [];
  if (designIds.size > 0) {
    const { data } = await (supabase as any)
      .from("design_projects")
      .select("id, name, aspect, zones, updated_at, created_at")
      .in("id", Array.from(designIds));
    designRows = data || [];
    const walk = (content: any) => {
      if (!content) return;
      if (Array.isArray(content.mediaItems)) {
        for (const m of content.mediaItems) {
          // Only real media rows (UUID id, image/video type) belong in the export
          // bundle. Widgets, text blocks, and other synthetic items live in the
          // same `mediaItems` array but use composite ids like `cat-widget-…`
          // or `text-…` and must not be looked up in the media_items table.
          if (!m?.id || !UUID_RE.test(String(m.id))) continue;
          if (m.type && m.type !== "image" && m.type !== "video") continue;
          mediaIds.add(String(m.id));
        }
      }
    };
    for (const d of designRows) {
      const zones = Array.isArray(d.zones) ? d.zones : [];
      for (const z of zones) {
        walk(z?.content);
        if (Array.isArray(z?.overlays)) for (const o of z.overlays) walk(o?.content);
        // Design-project-level BGM (audio looped behind all zones).
        const bgmItems = z?.bgm?.items;
        if (Array.isArray(bgmItems)) {
          for (const a of bgmItems) {
            if (!a?.id || !UUID_RE.test(String(a.id))) continue;
            mediaIds.add(String(a.id));
          }
        }
      }
    }
  }

  let mediaRows: any[] = [];
  if (mediaIds.size > 0) {
    const { data } = await (supabase as any)
      .from("media_items")
      .select("id, name, original_name, type, mime_type, url, size_bytes, width, height, duration_seconds, transcode_status")
      .in("id", Array.from(mediaIds));
    mediaRows = data || [];
  }

  const zip = new JSZip();
  const assetsFolder = zip.folder("assets")!;
  const manifestMedia: any[] = [];
  const usedNames = new Set<string>();
  const warnings: { mediaId: string; reason: string }[] = [];

  // Detect referenced media that no longer exist in DB (orphan refs from
  // deleted media items still cited by design_project zones or schedule_items).
  const fetchedIds = new Set(mediaRows.map((r) => String(r.id)));
  for (const id of mediaIds) {
    if (!fetchedIds.has(id)) {
      warnings.push({ mediaId: id, reason: "media_not_found_in_db" });
    }
  }

  for (const m of mediaRows) {
    let assetPath: string | null = null;
    let failReason: string | null = null;
    try {
      const url: string = m.url || "";
      if (!url) {
        failReason =
          m.transcode_status && m.transcode_status !== "complete" && m.transcode_status !== "none"
            ? `transcode_${m.transcode_status}`
            : "no_url";
      } else {
        let blob: Blob | null = null;
        let extFromMime = m.mime_type ? (mimeExtMap[m.mime_type] || "") : "";
        if (url.startsWith("data:")) {
          const match = url.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            const bin = atob(match[2]);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            blob = new Blob([bytes], { type: match[1] });
            if (!extFromMime) extFromMime = (match[1].split("/")[1] || "bin").split("+")[0];
          }
        } else {
          const resp = await fetch(url);
          if (resp.ok) blob = await resp.blob();
          else failReason = `fetch_${resp.status}`;
        }
        if (blob) {
          const baseName = sanitizeName(m.original_name || m.name || `media_${m.id}`);
          const hasExt = /\.[A-Za-z0-9]{2,5}$/.test(baseName);
          const fileName = hasExt ? baseName : (extFromMime ? `${baseName}.${extFromMime}` : baseName);
          let candidate = `${m.id}_${fileName}`;
          let n = 1;
          while (usedNames.has(candidate)) { candidate = `${m.id}_${n}_${fileName}`; n++; }
          usedNames.add(candidate);
          assetsFolder.file(candidate, blob);
          assetPath = `assets/${candidate}`;
        } else if (!failReason) {
          failReason = "blob_decode_failed";
        }
      }
    } catch (err) {
      console.error("Export media failed", m.id, err);
      failReason = `exception_${(err as Error)?.message || "unknown"}`.slice(0, 80);
    }
    if (!assetPath) {
      warnings.push({ mediaId: String(m.id), reason: failReason || "unknown" });
    }
    manifestMedia.push({
      id: m.id, name: m.name, original_name: m.original_name, type: m.type,
      mime_type: m.mime_type, size_bytes: m.size_bytes, width: m.width,
      height: m.height, duration_seconds: m.duration_seconds, assetPath,
    });
  }

  // Append virtual widget entries so the player can render system & catalog
  // widgets used directly as schedule items (no asset file needed).
  const widgetEntries = await buildWidgetMediaEntries(widgetIds);
  for (const w of widgetEntries) manifestMedia.push(w);

  const scheduleName = schedRow?.name ?? fallbackName ?? "schedule";
  const manifest = {
    format: "signcms.schedule",
    version: 1,
    exportedAt: new Date().toISOString(),
    warnings,
    schedule: {
      id: schedRow?.id ?? scheduleId,
      name: scheduleName,
      screen_id: schedRow?.screen_id ?? null,
      start_time: schedRow?.start_time ?? null,
      end_time: schedRow?.end_time ?? null,
      start_date: schedRow?.start_date ?? null,
      end_date: schedRow?.end_date ?? null,
      days: schedRow?.days ?? [],
      enabled: schedRow?.enabled ?? false,
      status: schedRow?.status ?? null,
      bgm_volume: schedRow?.bgm_volume ?? 50,
    },
    items: (itemRows || []).map((i: any) => ({
      media_id: i.media_id,
      design_project_id: i.design_project_id,
      item_type: i.item_type,
      duration: i.duration,
      sort_order: i.sort_order,
    })),
    bgm: [
      ...(bgmRows || []).map((b: any) => ({
        media_id: b.media_id, sort_order: b.sort_order,
      })),
      ...collectDesignBgm(designRows),
    ],
    designProjects: designRows.map((d) => ({
      id: d.id, name: d.name, aspect: d.aspect, zones: d.zones,
      updated_at: d.updated_at, created_at: d.created_at,
    })),
    media: manifestMedia,
  };
  zip.file("schedule.json", JSON.stringify(manifest, null, 2));

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const filename = `${sanitizeName(scheduleName)}.zip`;

  if (warnings.length > 0) {
    console.warn("[exportScheduleToZip] warnings", warnings);
    toast({
      title: "匯出完成,但有缺失項目",
      description: `${warnings.length} 個媒體未能打包(可能已刪除或轉檔未完成)。詳細請看 schedule.json 的 "warnings" 欄位或 console。`,
      variant: "destructive",
    });
  }

  // Auto-trigger browser download (skipped for in-app previews).
  if (!skipDownload) {
    try {
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.rel = "noopener";
      document.body.appendChild(a); a.click(); a.remove();
    } catch { /* ignore */ }
  }

  setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);

  // Activity log + in-memory cache for re-download.
  const sizeMB = (blob.size / (1024 * 1024)).toFixed(2);
  const itemCount = (itemRows || []).length;
  const mediaCount = manifestMedia.length;
  if (!skipLog) try {
    const actionKey = source === "usb" ? "export_schedule_usb" : "export_schedule";
    const { data: logRow } = await (supabase as any).from("activity_logs").insert({
      user_id: userId,
      action: actionKey,
      action_code: actionKey,
      action_params: { itemCount, mediaCount, sizeMB, filename, source },
      category: "schedule",
      target_type: "schedule",
      target_id: scheduleId,
      target_name: scheduleName,
      org_id: orgId || null,
    }).select("id").single();
    if (logRow?.id) {
      rememberExport({
        logId: logRow.id,
        kind: source === "usb" ? "schedule_usb" : "schedule",
        filename,
        blob,
        sizeBytes: blob.size,
      });
    }
  } catch (err) {
    console.error("Activity log insert failed", err);
  }

  return { blob, url, filename, sizeBytes: blob.size, itemCount, mediaCount, scheduleName };
}

/**
 * Folder variant: writes `schedule.json` + `assets/<files>` directly into a
 * user-chosen directory using the File System Access API. Ideal for writing
 * straight to a USB drive root so the player can read the unpacked layout.
 *
 * Throws if the browser doesn't support `showDirectoryPicker` or the user
 * cancels the picker. The caller should check `isFolderExportSupported()`.
 */
export async function exportScheduleToFolder(input: ExportScheduleInput): Promise<ExportScheduleFolderResult> {
  if (!isFolderExportSupported()) {
    throw new Error("FOLDER_EXPORT_UNSUPPORTED");
  }
  const { scheduleId, fallbackName, orgId, userId } = input;

  // Ask user to pick a destination directory (e.g. USB root).
  const dirHandle: any = await (window as any).showDirectoryPicker({ mode: "readwrite" });

  // Fetch the same data as the ZIP exporter.
  const { data: schedRow } = await (supabase as any)
    .from("schedules").select("*").eq("id", scheduleId).single();
  const { data: itemRows } = await (supabase as any)
    .from("schedule_items")
    .select("id, media_id, design_project_id, item_type, sort_order, duration")
    .eq("schedule_id", scheduleId).order("sort_order");
  const { data: bgmRows } = await (supabase as any)
    .from("schedule_bgm_items")
    .select("id, media_id, sort_order")
    .eq("schedule_id", scheduleId).order("sort_order");

  const mediaIds = new Set<string>();
  const designIds = new Set<string>();
  const widgetIds = new Set<string>();
  for (const it of itemRows || []) {
    if (it.media_id) {
      const id = String(it.media_id);
      if (isWidgetId(id)) widgetIds.add(id);
      else mediaIds.add(id);
    }
    if (it.design_project_id) designIds.add(String(it.design_project_id));
  }
  for (const b of bgmRows || []) if (b.media_id) mediaIds.add(String(b.media_id));

  let designRows: any[] = [];
  if (designIds.size > 0) {
    const { data } = await (supabase as any)
      .from("design_projects")
      .select("id, name, aspect, zones, updated_at, created_at")
      .in("id", Array.from(designIds));
    designRows = data || [];
    const walk = (content: any) => {
      if (!content) return;
      if (Array.isArray(content.mediaItems)) {
        for (const m of content.mediaItems) {
          if (!m?.id || !UUID_RE.test(String(m.id))) continue;
          if (m.type && m.type !== "image" && m.type !== "video") continue;
          mediaIds.add(String(m.id));
        }
      }
    };
    for (const d of designRows) {
      const zones = Array.isArray(d.zones) ? d.zones : [];
      for (const z of zones) {
        walk(z?.content);
        if (Array.isArray(z?.overlays)) for (const o of z.overlays) walk(o?.content);
        const bgmItems = z?.bgm?.items;
        if (Array.isArray(bgmItems)) {
          for (const a of bgmItems) {
            if (!a?.id || !UUID_RE.test(String(a.id))) continue;
            mediaIds.add(String(a.id));
          }
        }
      }
    }
  }

  let mediaRows: any[] = [];
  if (mediaIds.size > 0) {
    const { data } = await (supabase as any)
      .from("media_items")
      .select("id, name, original_name, type, mime_type, url, size_bytes, width, height, duration_seconds, transcode_status")
      .in("id", Array.from(mediaIds));
    mediaRows = data || [];
  }

  const scheduleName = schedRow?.name ?? fallbackName ?? "schedule";
  const rootName = sanitizeName(scheduleName);

  // Create (or reuse) a subfolder named after the schedule, then `assets/`.
  const rootDir: any = await dirHandle.getDirectoryHandle(rootName, { create: true });
  const assetsDir: any = await rootDir.getDirectoryHandle("assets", { create: true });

  const manifestMedia: any[] = [];
  const usedNames = new Set<string>();
  let totalBytes = 0;
  let fileCount = 0;
  const warnings: { mediaId: string; reason: string }[] = [];
  const fetchedIds = new Set(mediaRows.map((r) => String(r.id)));
  for (const id of mediaIds) {
    if (!fetchedIds.has(id)) warnings.push({ mediaId: id, reason: "media_not_found_in_db" });
  }

  for (const m of mediaRows) {
    let assetPath: string | null = null;
    let failReason: string | null = null;
    try {
      const url: string = m.url || "";
      if (!url) {
        failReason =
          m.transcode_status && m.transcode_status !== "complete" && m.transcode_status !== "none"
            ? `transcode_${m.transcode_status}`
            : "no_url";
      } else {
        let blob: Blob | null = null;
        let extFromMime = m.mime_type ? (mimeExtMap[m.mime_type] || "") : "";
        if (url.startsWith("data:")) {
          const match = url.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            const bin = atob(match[2]);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            blob = new Blob([bytes], { type: match[1] });
            if (!extFromMime) extFromMime = (match[1].split("/")[1] || "bin").split("+")[0];
          }
        } else {
          const resp = await fetch(url);
          if (resp.ok) blob = await resp.blob();
          else failReason = `fetch_${resp.status}`;
        }
        if (blob) {
          const baseName = sanitizeName(m.original_name || m.name || `media_${m.id}`);
          const hasExt = /\.[A-Za-z0-9]{2,5}$/.test(baseName);
          const fileName = hasExt ? baseName : (extFromMime ? `${baseName}.${extFromMime}` : baseName);
          let candidate = `${m.id}_${fileName}`;
          let n = 1;
          while (usedNames.has(candidate)) { candidate = `${m.id}_${n}_${fileName}`; n++; }
          usedNames.add(candidate);
          const fileHandle: any = await assetsDir.getFileHandle(candidate, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
          totalBytes += blob.size;
          fileCount += 1;
          assetPath = `assets/${candidate}`;
        } else if (!failReason) {
          failReason = "blob_decode_failed";
        }
      }
    } catch (err) {
      console.error("Export media failed", m.id, err);
      failReason = `exception_${(err as Error)?.message || "unknown"}`.slice(0, 80);
    }
    if (!assetPath) {
      warnings.push({ mediaId: String(m.id), reason: failReason || "unknown" });
    }
    manifestMedia.push({
      id: m.id, name: m.name, original_name: m.original_name, type: m.type,
      mime_type: m.mime_type, size_bytes: m.size_bytes, width: m.width,
      height: m.height, duration_seconds: m.duration_seconds, assetPath,
    });
  }

  // Append virtual widget entries for the folder layout too.
  const widgetEntriesFolder = await buildWidgetMediaEntries(widgetIds);
  for (const w of widgetEntriesFolder) manifestMedia.push(w);

  const manifest = {
    format: "signcms.schedule",
    version: 1,
    exportedAt: new Date().toISOString(),
    layout: "folder",
    warnings,
    schedule: {
      id: schedRow?.id ?? scheduleId,
      name: scheduleName,
      screen_id: schedRow?.screen_id ?? null,
      start_time: schedRow?.start_time ?? null,
      end_time: schedRow?.end_time ?? null,
      start_date: schedRow?.start_date ?? null,
      end_date: schedRow?.end_date ?? null,
      days: schedRow?.days ?? [],
      enabled: schedRow?.enabled ?? false,
      status: schedRow?.status ?? null,
      bgm_volume: schedRow?.bgm_volume ?? 50,
    },
    items: (itemRows || []).map((i: any) => ({
      media_id: i.media_id,
      design_project_id: i.design_project_id,
      item_type: i.item_type,
      duration: i.duration,
      sort_order: i.sort_order,
    })),
    bgm: [
      ...(bgmRows || []).map((b: any) => ({
        media_id: b.media_id, sort_order: b.sort_order,
      })),
      ...collectDesignBgm(designRows),
    ],
    designProjects: designRows.map((d) => ({
      id: d.id, name: d.name, aspect: d.aspect, zones: d.zones,
      updated_at: d.updated_at, created_at: d.created_at,
    })),
    media: manifestMedia,
  };
  const manifestText = JSON.stringify(manifest, null, 2);
  const manifestHandle: any = await rootDir.getFileHandle("schedule.json", { create: true });
  const mw = await manifestHandle.createWritable();
  await mw.write(new Blob([manifestText], { type: "application/json" }));
  await mw.close();
  totalBytes += new Blob([manifestText]).size;

  if (warnings.length > 0) {
    console.warn("[exportScheduleToFolder] warnings", warnings);
    toast({
      title: "匯出完成,但有缺失項目",
      description: `${warnings.length} 個媒體未能寫入(可能已刪除或轉檔未完成)。詳細請看 schedule.json 的 "warnings" 欄位。`,
      variant: "destructive",
    });
  }

  const itemCount = (itemRows || []).length;
  const mediaCount = manifestMedia.length;
  const sizeMB = (totalBytes / (1024 * 1024)).toFixed(2);

  // Activity log only — no in-memory blob to remember (data is on disk).
  try {
    await (supabase as any).from("activity_logs").insert({
      user_id: userId,
      action: "export_schedule_usb_folder",
      action_code: "export_schedule_usb_folder",
      action_params: { itemCount, mediaCount, sizeMB, filename: rootName, source: "usb_folder", fileCount },
      category: "schedule",
      target_type: "schedule",
      target_id: scheduleId,
      target_name: scheduleName,
      org_id: orgId || null,
    });
  } catch (err) {
    console.error("Activity log insert failed", err);
  }

  return { filename: rootName, scheduleName, itemCount, mediaCount, sizeBytes: totalBytes, fileCount };
}