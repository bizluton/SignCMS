import { supabase } from "@/integrations/supabase/client";

/**
 * Shared in-use detection for entities that can be referenced by other tables.
 * Used by Media, Schedules and ContentStudio so the deletion blocking rules
 * and messaging stay consistent.
 */

export type ReferenceKind = "channel" | "schedule" | "media" | "project";

/** A single referencing entity with enough info to navigate to or unassign it. */
export interface ReferenceItem {
  /** Display name. */
  name: string;
  /**
   * Optional in-app link target. Lets the delete dialog provide a deep link
   * so users can jump to the affected record (screen, project, media, etc.).
   */
  link?: string;
  /**
   * Unassign target — describes how to detach this reference from the
   * design project. The shared `unassignProjectReference` helper consumes
   * this so callers don't have to know per-source SQL.
   */
  unassign?:
    | { source: "channel_default"; channelId: string }
    | { source: "channel_allowed_projects"; rowId: string }
    | { source: "channel_blocks"; rowId: string }
    | { source: "media_items"; mediaId: string }
    | { source: "screen_channel_subscriptions"; rowId: string }
    | { source: "channel_bgm_items"; rowId: string }
    | { source: "screen_channel_switch_triggers"; rowId: string }
    | { source: "project_schedules"; rowId: string };
}

export interface ReferenceGroup {
  kind: ReferenceKind;
  /** i18n key from `translations.ts` (caller resolves to a string). */
  labelKey:
    | "studioDeleteBoundChannel"
    | "studioDeleteBoundSchedule"
    | "studioDeleteBoundMedia"
    | "mediaUsedInProjects"
    | "mediaUsedInSchedules"
    | "mediaUsedInChannels"
    | "channelRefSubscriptions"
    | "channelRefPublishRecords"
    | "channelRefBgmItems"
    | "channelRefAllowedProjects"
    | "channelRefBlocks"
    | "channelRefSwitchTriggers";
  /** Human-readable names of the referencing entities (deduped, legacy). */
  names: string[];
  /** Detailed referencing entities (with optional unassign target). */
  items?: ReferenceItem[];
}

export interface ReferenceReport {
  groups: ReferenceGroup[];
  /** Sum of names across all groups. */
  total: number;
  hasAny: boolean;
}

// ---------------------------------------------------------------------------
// Internal row-shape interfaces for joined query results
// ---------------------------------------------------------------------------

/** Shape of a `channels` row when selected with `.select("id, name")`. */
interface ChannelNameRow {
  id: string;
  name: string | null;
}

/**
 * Shape of a `channel_allowed_projects` row selected with
 * `.select("id, channel_id, channels(name)")`.
 */
interface ChannelAllowedProjectRow {
  id: string;
  channel_id: string;
  channels: { name: string | null } | null;
}

/**
 * Shape of a `channel_blocks` row selected with
 * `.select("id, channel_id, channels(name)")`.
 */
interface ChannelBlockJoinRow {
  id: string;
  channel_id: string;
  channels: { name: string | null } | null;
}

/** Shape of a `media_items` row selected with `.select("id, name")`. */
interface MediaNameRow {
  id: string;
  name: string | null;
}

/**
 * Shape of a `schedule_items` row selected with
 * `.select("schedule_id, schedules:schedule_id(name)")`.
 * `schedule_items` is not in the generated types, so this is used with
 * `(supabase as unknown as SupabaseAny)`.
 */
interface ScheduleItemRow {
  schedule_id: string;
  schedules: { name: string | null } | null;
}

/** Shape returned by `design_project_delete_requests` upsert `.select("id").single()`. */
interface DeleteRequestIdRow {
  id: string;
}

/** Shape returned by `design_project_delete_requests` `.select("design_project_id")`. */
interface DesignProjectDeletePendingRow {
  design_project_id: string;
}

/** Shape returned by `channel_delete_requests` `.select("channel_id")`. */
interface ChannelDeletePendingRow {
  channel_id: string;
}

/**
 * Shape of a `screen_channel_subscriptions` row selected with
 * `.select("id, screen_id, screens:screen_id(name)")`.
 */
interface ScreenChannelSubRow {
  id: string;
  screen_id: string;
  screens: { name: string | null } | null;
}

/** Shape of a `publish_records` row selected with `.select("id, screen_name, created_at")`. */
interface PublishRecordRow {
  id: string;
  screen_name: string | null;
  created_at: string;
}

/**
 * Shape of a `channel_bgm_items` row selected with
 * `.select("id, media_id, media_items:media_id(name)")`.
 */
interface ChannelBgmItemRow {
  id: string;
  media_id: string;
  media_items: { name: string | null } | null;
}

/**
 * Shape of a `channel_allowed_projects` row selected with
 * `.select("id, design_projects:design_project_id(name)")`.
 */
interface ChannelAllowedProjectNameRow {
  id: string;
  design_projects: { name: string | null } | null;
}

/** Shape of a `channel_blocks` row selected with `.select("id, name")`. */
interface ChannelBlockNameRow {
  id: string;
  name: string | null;
}

/**
 * Shape of a `screen_channel_switch_triggers` row selected with
 * `.select("id, screen_id, trigger_type, screens:screen_id(name)")`.
 */
interface ScreenChannelSwitchTriggerRow {
  id: string;
  screen_id: string | null;
  trigger_type: string | null;
  screens: { name: string | null } | null;
}

/** Shape of a `project_schedules` row selected with `.select("id, name")`. */
interface ProjectScheduleNameRow {
  id: string;
  name: string | null;
}

/**
 * Shape of a `channel_bgm_items` row when queried by `media_id`, to find which
 * channels use a given media asset as BGM.
 * `.select("id, channel_id, channels:channel_id(name)")`
 */
interface ChannelBgmByMediaRow {
  id: string;
  channel_id: string;
  channels: { name: string | null } | null;
}

/**
 * Minimal Supabase client interface used only for tables absent from the
 * generated types (e.g. `schedule_items`, `schedules`).
 */
interface SupabaseAny {
  from: (table: string) => ReturnType<typeof supabase.from>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const dedupe = (arr: (string | null | undefined)[]): string[] => {
  const out: string[] = [];
  for (const v of arr) {
    if (!v) continue;
    if (!out.includes(v)) out.push(v);
  }
  return out;
};

const buildReport = (groups: ReferenceGroup[]): ReferenceReport => {
  const filtered = groups.filter((g) => g.names.length > 0);
  const total = filtered.reduce((sum, g) => sum + g.names.length, 0);
  return { groups: filtered, total, hasAny: total > 0 };
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether a design project is referenced anywhere that should block deletion:
 * channel default project, channel allowed list, channel scheduled blocks,
 * schedule items, and media items linked via `design_project_id`.
 */
export async function checkDesignProjectReferences(
  projectId: string,
  limitPerSource = 10,
): Promise<ReferenceReport> {
  const [mediaRes, defaultChRes, allowedChRes, blockChRes, projSchedRes] = await Promise.all([
    supabase
      .from("media_items")
      .select("id, name")
      .eq("design_project_id", projectId)
      .is("deleted_at", null)
      .limit(limitPerSource),
    supabase
      .from("channels")
      .select("id, name")
      .eq("default_design_project_id", projectId)
      .limit(limitPerSource),
    supabase
      .from("channel_allowed_projects")
      .select("id, channel_id, channels(name)")
      .eq("design_project_id", projectId)
      .limit(limitPerSource),
    supabase
      .from("channel_blocks")
      .select("id, channel_id, channels(name)")
      .eq("design_project_id", projectId)
      .limit(limitPerSource),
    // Project schedules that bind this design project
    supabase
      .from("project_schedules")
      .select("id, name")
      .eq("design_project_id", projectId)
      .limit(limitPerSource),
  ]);

  const channelItems: ReferenceItem[] = [];
  for (const c of (defaultChRes?.data ?? []) as ChannelNameRow[]) {
    if (c?.name) channelItems.push({ name: `${c.name} (default)`, unassign: { source: "channel_default", channelId: c.id } });
  }
  for (const r of (allowedChRes?.data ?? []) as ChannelAllowedProjectRow[]) {
    const name = r?.channels?.name;
    if (name) channelItems.push({ name: `${name} (allowed)`, unassign: { source: "channel_allowed_projects", rowId: r.id } });
  }
  for (const r of (blockChRes?.data ?? []) as ChannelBlockJoinRow[]) {
    const name = r?.channels?.name;
    if (name) channelItems.push({ name: `${name} (block)`, unassign: { source: "channel_blocks", rowId: r.id } });
  }

  const mediaItems: ReferenceItem[] = ((mediaRes?.data ?? []) as MediaNameRow[])
    .filter((m) => m?.name)
    .map((m) => ({ name: m.name as string, unassign: { source: "media_items", mediaId: m.id } as const }));

  const scheduleItems: ReferenceItem[] = ((projSchedRes?.data ?? []) as ProjectScheduleNameRow[])
    .filter((s) => s?.name)
    .map((s) => ({ name: s.name as string, unassign: { source: "project_schedules", rowId: s.id } as const }));

  return buildReport([
    {
      kind: "channel",
      labelKey: "studioDeleteBoundChannel",
      names: dedupe(channelItems.map((i) => i.name)),
      items: channelItems,
    },
    {
      kind: "media",
      labelKey: "studioDeleteBoundMedia",
      names: dedupe(mediaItems.map((i) => i.name)),
      items: mediaItems,
    },
    {
      kind: "schedule",
      labelKey: "studioDeleteBoundSchedule",
      names: dedupe(scheduleItems.map((i) => i.name)),
      items: scheduleItems,
    },
  ]);
}

/**
 * Unassign a single reference (detach it from its design project) so the
 * pending delete trigger can fire automatically.
 */
export async function unassignProjectReference(item: ReferenceItem): Promise<void> {
  const u = item.unassign;
  if (!u) throw new Error("Reference has no unassign target");
  if (u.source === "channel_default") {
    const { error } = await supabase
      .from("channels")
      .update({ default_design_project_id: null })
      .eq("id", u.channelId);
    if (error) throw error;
  } else if (u.source === "channel_allowed_projects") {
    const { error } = await supabase
      .from("channel_allowed_projects")
      .delete()
      .eq("id", u.rowId);
    if (error) throw error;
  } else if (u.source === "channel_blocks") {
    const { error } = await supabase
      .from("channel_blocks")
      .delete()
      .eq("id", u.rowId);
    if (error) throw error;
  } else if (u.source === "media_items") {
    const { error } = await supabase
      .from("media_items")
      .update({ design_project_id: null })
      .eq("id", u.mediaId);
    if (error) throw error;
  } else if (u.source === "screen_channel_subscriptions") {
    const { error } = await supabase
      .from("screen_channel_subscriptions")
      .delete()
      .eq("id", u.rowId);
    if (error) throw error;
  } else if (u.source === "channel_bgm_items") {
    const { error } = await supabase
      .from("channel_bgm_items")
      .delete()
      .eq("id", u.rowId);
    if (error) throw error;
  } else if (u.source === "screen_channel_switch_triggers") {
    const { error } = await supabase
      .from("screen_channel_switch_triggers")
      .delete()
      .eq("id", u.rowId);
    if (error) throw error;
  } else if (u.source === "project_schedules") {
    // The schedule exists specifically for this project — deleting the schedule
    // is the only way to "unassign" it.
    const { error } = await supabase
      .from("project_schedules")
      .delete()
      .eq("id", u.rowId);
    if (error) throw error;
  }
}

/**
 * Queue a "delete when free" request. Returns the request id.
 * Server-side trigger will execute the delete once references reach zero.
 */
export async function queueDesignProjectDelete(args: {
  projectId: string;
  orgId: string | null;
  userId: string;
  reason?: string;
}): Promise<{ id: string } | { error: string }> {
  const { data, error } = await supabase
    .from("design_project_delete_requests")
    .upsert(
      {
        design_project_id: args.projectId,
        org_id: args.orgId,
        requested_by: args.userId,
        reason: args.reason ?? "",
        status: "pending",
      },
      { onConflict: "design_project_id" },
    )
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { id: (data as DeleteRequestIdRow).id };
}

export async function cancelDesignProjectDelete(projectId: string): Promise<void> {
  await supabase
    .from("design_project_delete_requests")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("design_project_id", projectId)
    .eq("status", "pending");
}

export async function fetchPendingDeleteRequests(
  projectIds: string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  if (projectIds.length === 0) return out;
  const { data } = await supabase
    .from("design_project_delete_requests")
    .select("design_project_id")
    .in("design_project_id", projectIds)
    .eq("status", "pending");
  for (const row of (data ?? []) as DesignProjectDeletePendingRow[]) {
    if (row?.design_project_id) out.add(row.design_project_id);
  }
  return out;
}

export interface MediaProjectRef { id: string; name: string }

/**
 * Check whether a media asset is referenced by schedules or design projects.
 * Design-project references must be pre-computed (the caller scans zones in memory)
 * and passed in via `projectRefs` to avoid duplicating that scan logic here.
 */
export async function checkMediaReferences(
  mediaId: string,
  projectRefs: MediaProjectRef[],
): Promise<ReferenceReport> {
  // `schedule_items` is not in the generated DB types; use the escape hatch.
  const [scheduleItemsRes, bgmRes] = await Promise.all([
    (supabase as unknown as SupabaseAny)
      .from("schedule_items")
      .select("schedule_id, schedules:schedule_id(name)")
      .eq("media_id", mediaId),
    supabase
      .from("channel_bgm_items")
      .select("id, channel_id, channels:channel_id(name)")
      .eq("media_id", mediaId),
  ]);

  const schedules = dedupe(((scheduleItemsRes?.data ?? []) as ScheduleItemRow[]).map((si) => si?.schedules?.name));
  const projects = dedupe(projectRefs.map((p) => p?.name));
  const channels = dedupe(
    ((bgmRes?.data ?? []) as ChannelBgmByMediaRow[])
      .map((r) => r?.channels?.name)
      .filter((n): n is string => !!n),
  );

  return buildReport([
    { kind: "project", labelKey: "mediaUsedInProjects", names: projects },
    { kind: "schedule", labelKey: "mediaUsedInSchedules", names: schedules },
    { kind: "channel", labelKey: "mediaUsedInChannels", names: channels },
  ]);
}

/**
 * Batch variant for bulk-delete: returns a per-id report so the caller can
 * filter out blocked items and surface a unified message.
 */
export async function checkMediaReferencesBatch(
  mediaIds: string[],
  projectRefsByMedia: Map<string, MediaProjectRef[]>,
): Promise<Map<string, ReferenceReport>> {
  const result = new Map<string, ReferenceReport>();
  if (mediaIds.length === 0) return result;

  // `schedule_items` is not in the generated DB types; use the escape hatch.
  const [scheduleHitsRes, bgmHitsRes] = await Promise.all([
    (supabase as unknown as SupabaseAny)
      .from("schedule_items")
      .select("media_id, schedules:schedule_id(name)")
      .in("media_id", mediaIds),
    supabase
      .from("channel_bgm_items")
      .select("media_id, channels:channel_id(name)")
      .in("media_id", mediaIds),
  ]);

  const schedulesByMedia = new Map<string, string[]>();
  for (const row of (scheduleHitsRes?.data ?? []) as (ScheduleItemRow & { media_id: string })[]) {
    const mid = row?.media_id;
    const name = row?.schedules?.name;
    if (!mid || !name) continue;
    const arr = schedulesByMedia.get(mid) ?? [];
    if (!arr.includes(name)) arr.push(name);
    schedulesByMedia.set(mid, arr);
  }

  const channelsByMedia = new Map<string, string[]>();
  for (const row of (bgmHitsRes?.data ?? []) as (ChannelBgmByMediaRow & { media_id: string })[]) {
    const mid = row?.media_id;
    const name = row?.channels?.name;
    if (!mid || !name) continue;
    const arr = channelsByMedia.get(mid) ?? [];
    if (!arr.includes(name)) arr.push(name);
    channelsByMedia.set(mid, arr);
  }

  for (const id of mediaIds) {
    const projects = dedupe((projectRefsByMedia.get(id) ?? []).map((p) => p.name));
    const schedules = schedulesByMedia.get(id) ?? [];
    const channels = channelsByMedia.get(id) ?? [];
    result.set(
      id,
      buildReport([
        { kind: "project", labelKey: "mediaUsedInProjects", names: projects },
        { kind: "schedule", labelKey: "mediaUsedInSchedules", names: schedules },
        { kind: "channel", labelKey: "mediaUsedInChannels", names: channels },
      ]),
    );
  }
  return result;
}

/**
 * Format a `ReferenceReport` into a multi-line description suitable for a toast.
 * `t` is the i18n resolver from LanguageContext.
 */
export function formatReferenceReport(
  report: ReferenceReport,
  t: (key: ReferenceGroup["labelKey"]) => string,
): string {
  return report.groups.map((g) => `${t(g.labelKey)}: ${g.names.join(", ")}`).join("\n");
}

/**
 * Check whether a channel is referenced by other tables that would be removed
 * (or orphaned) if the channel is deleted. The channel deletion itself uses
 * ON DELETE CASCADE for several of these, but users still want to see a
 * detailed impact summary before confirming.
 *
 * Sources scanned:
 * - screen_channel_subscriptions      → screens that subscribe to this channel
 * - publish_records                   → historical publish entries (channel_name kept)
 * - channel_bgm_items                 → BGM playlist items
 * - channel_allowed_projects          → allowed design projects
 * - channel_blocks                    → scheduled blocks
 * - screen_channel_switch_triggers    → triggers that switch TO this channel
 */
export async function checkChannelReferences(
  channelId: string,
  limitPerSource = 25,
): Promise<ReferenceReport> {
  const [subRes, pubRes, bgmRes, allowedRes, blockRes, trgRes] = await Promise.all([
    supabase
      .from("screen_channel_subscriptions")
      .select("id, screen_id, screens:screen_id(name)")
      .eq("channel_id", channelId)
      .limit(limitPerSource),
    supabase
      .from("publish_records")
      .select("id, screen_name, created_at")
      .eq("channel_id", channelId)
      .order("created_at", { ascending: false })
      .limit(limitPerSource),
    supabase
      .from("channel_bgm_items")
      .select("id, media_id, media_items:media_id(name)")
      .eq("channel_id", channelId)
      .limit(limitPerSource),
    supabase
      .from("channel_allowed_projects")
      .select("id, design_projects:design_project_id(name)")
      .eq("channel_id", channelId)
      .limit(limitPerSource),
    supabase
      .from("channel_blocks")
      .select("id, name")
      .eq("channel_id", channelId)
      .limit(limitPerSource),
    supabase
      .from("screen_channel_switch_triggers")
      .select("id, screen_id, trigger_type, screens:screen_id(name)")
      .eq("target_channel_id", channelId)
      .limit(limitPerSource),
  ]);

  const subItems: ReferenceItem[] = ((subRes?.data ?? []) as ScreenChannelSubRow[])
    .filter((r) => r?.screens?.name)
    .map((r) => ({
      name: r.screens!.name as string,
      link: `/screens?focus=${r.screen_id}`,
      unassign: { source: "screen_channel_subscriptions", rowId: r.id } as const,
    }));
  const pubItems: ReferenceItem[] = ((pubRes?.data ?? []) as PublishRecordRow[])
    .filter((r) => r?.screen_name)
    .map((r) => ({ name: r.screen_name as string, link: `/publishing` }));
  const bgmItems: ReferenceItem[] = ((bgmRes?.data ?? []) as ChannelBgmItemRow[])
    .filter((r) => r?.media_items?.name)
    .map((r) => ({
      name: r.media_items!.name as string,
      link: `/media?focus=${r.media_id}`,
      unassign: { source: "channel_bgm_items", rowId: r.id } as const,
    }));
  const allowedItems: ReferenceItem[] = ((allowedRes?.data ?? []) as ChannelAllowedProjectNameRow[])
    .filter((r) => r?.design_projects?.name)
    .map((r) => ({
      name: r.design_projects!.name as string,
      link: `/studio`,
      unassign: { source: "channel_allowed_projects", rowId: r.id } as const,
    }));
  const blockItems: ReferenceItem[] = ((blockRes?.data ?? []) as ChannelBlockNameRow[])
    .filter((r) => r?.name && (r.name as string).length > 0)
    .map((r) => ({ name: r.name as string, unassign: { source: "channel_blocks", rowId: r.id } as const }));
  const trgItems: ReferenceItem[] = ((trgRes?.data ?? []) as ScreenChannelSwitchTriggerRow[]).map((r) => {
    const screen = r?.screens?.name ?? "—";
    return {
      name: `${screen} (${r?.trigger_type ?? "?"})`,
      link: r?.screen_id ? `/screens?focus=${r.screen_id}` : undefined,
      unassign: { source: "screen_channel_switch_triggers", rowId: r.id } as const,
    };
  });

  return buildReport([
    { kind: "channel", labelKey: "channelRefSubscriptions", names: dedupe(subItems.map((i) => i.name)), items: subItems },
    { kind: "channel", labelKey: "channelRefPublishRecords", names: dedupe(pubItems.map((i) => i.name)), items: pubItems },
    { kind: "media", labelKey: "channelRefBgmItems", names: dedupe(bgmItems.map((i) => i.name)), items: bgmItems },
    { kind: "project", labelKey: "channelRefAllowedProjects", names: dedupe(allowedItems.map((i) => i.name)), items: allowedItems },
    { kind: "schedule", labelKey: "channelRefBlocks", names: dedupe(blockItems.map((i) => i.name)), items: blockItems },
    { kind: "channel", labelKey: "channelRefSwitchTriggers", names: dedupe(trgItems.map((i) => i.name)), items: trgItems },
  ]);
}

/**
 * Whether a channel reference group is "blocking" — i.e. would prevent
 * an auto-execute delete. Publish records are historical and don't block.
 */
export function isBlockingChannelGroup(labelKey: ReferenceGroup["labelKey"]): boolean {
  return labelKey !== "channelRefPublishRecords";
}

/** Queue a "delete channel when free" request. */
export async function queueChannelDelete(args: {
  channelId: string;
  orgId: string | null;
  userId: string;
  reason?: string;
}): Promise<{ id: string } | { error: string }> {
  const { data, error } = await supabase
    .from("channel_delete_requests")
    .upsert(
      {
        channel_id: args.channelId,
        org_id: args.orgId,
        requested_by: args.userId,
        reason: args.reason ?? "",
        status: "pending",
      },
      { onConflict: "channel_id" },
    )
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { id: (data as DeleteRequestIdRow).id };
}

export async function cancelChannelDelete(channelId: string): Promise<void> {
  await supabase
    .from("channel_delete_requests")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("channel_id", channelId)
    .eq("status", "pending");
}

export async function fetchPendingChannelDeleteRequests(
  channelIds: string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  if (channelIds.length === 0) return out;
  const { data } = await supabase
    .from("channel_delete_requests")
    .select("channel_id")
    .in("channel_id", channelIds)
    .eq("status", "pending");
  for (const row of (data ?? []) as ChannelDeletePendingRow[]) {
    if (row?.channel_id) out.add(row.channel_id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Idle asset detection
// ---------------------------------------------------------------------------

export interface IdleAssets {
  media: { id: string; name: string | null; created_at: string; type: string }[];
  projects: { id: string; name: string | null; updated_at: string }[];
}

/**
 * Find media items and design projects that haven't been used for `idleDays`
 * days and are no longer referenced by any channel / schedule.
 *
 * "Not in use" for media means:
 *   - design_project_id IS NULL
 *   - not referenced in schedule_items
 *   - not referenced in channel_bgm_items
 *   - created more than `idleDays` days ago
 *
 * "Not in use" for projects means:
 *   - not the default_design_project_id of any channel
 *   - not in channel_allowed_projects
 *   - not in channel_blocks
 *   - not in project_schedules
 *   - updated more than `idleDays` days ago
 */
export async function checkIdleAssets(
  orgId: string,
  idleDays = 90,
): Promise<IdleAssets> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - idleDays);
  const cutoffIso = cutoff.toISOString();

  // ── Idle media ────────────────────────────────────────────────────────────
  const { data: candMedia } = await supabase
    .from("media_items")
    .select("id, name, created_at, type")
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .is("design_project_id", null)
    .lt("created_at", cutoffIso)
    .order("created_at", { ascending: true })
    .limit(200);

  const mediaIds = (candMedia ?? []).map((m: { id: string }) => m.id);

  const usedMediaIds = new Set<string>();
  if (mediaIds.length > 0) {
    const [schedHits, bgmHits] = await Promise.all([
      (supabase as unknown as SupabaseAny)
        .from("schedule_items")
        .select("media_id")
        .in("media_id", mediaIds),
      supabase
        .from("channel_bgm_items")
        .select("media_id")
        .in("media_id", mediaIds),
    ]);
    for (const r of (schedHits?.data ?? []) as { media_id: string }[]) usedMediaIds.add(r.media_id);
    for (const r of (bgmHits?.data ?? []) as { media_id: string }[]) usedMediaIds.add(r.media_id);
  }

  const idleMedia = (candMedia ?? []).filter(
    (m: { id: string }) => !usedMediaIds.has(m.id),
  ) as { id: string; name: string | null; created_at: string; type: string }[];

  // ── Idle projects ─────────────────────────────────────────────────────────
  const { data: candProjects } = await supabase
    .from("design_projects")
    .select("id, name, updated_at")
    .eq("org_id", orgId)
    .lt("updated_at", cutoffIso)
    .order("updated_at", { ascending: true })
    .limit(200);

  const projectIds = (candProjects ?? []).map((p: { id: string }) => p.id);

  let idleProjects: { id: string; name: string | null; updated_at: string }[] = [];
  if (projectIds.length > 0) {
    const [defChRes, allowedRes, blockRes, schedRes] = await Promise.all([
      supabase
        .from("channels")
        .select("default_design_project_id")
        .in("default_design_project_id", projectIds),
      supabase
        .from("channel_allowed_projects")
        .select("design_project_id")
        .in("design_project_id", projectIds),
      supabase
        .from("channel_blocks")
        .select("design_project_id")
        .in("design_project_id", projectIds),
      supabase
        .from("project_schedules")
        .select("design_project_id")
        .in("design_project_id", projectIds),
    ]);

    const usedProjectIds = new Set<string>();
    for (const r of (defChRes?.data ?? []) as { default_design_project_id: string }[]) {
      if (r.default_design_project_id) usedProjectIds.add(r.default_design_project_id);
    }
    for (const r of (allowedRes?.data ?? []) as { design_project_id: string }[]) usedProjectIds.add(r.design_project_id);
    for (const r of (blockRes?.data ?? []) as { design_project_id: string }[]) usedProjectIds.add(r.design_project_id);
    for (const r of (schedRes?.data ?? []) as { design_project_id: string }[]) usedProjectIds.add(r.design_project_id);

    idleProjects = (candProjects ?? []).filter(
      (p: { id: string }) => !usedProjectIds.has(p.id),
    ) as { id: string; name: string | null; updated_at: string }[];
  }

  return { media: idleMedia, projects: idleProjects };
}
