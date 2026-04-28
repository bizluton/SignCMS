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
    | { source: "screen_channel_switch_triggers"; rowId: string };
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

/**
 * Check whether a design project is referenced anywhere that should block deletion:
 * channel default project, channel allowed list, channel scheduled blocks,
 * schedule items, and media items linked via `design_project_id`.
 */
export async function checkDesignProjectReferences(
  projectId: string,
  limitPerSource = 10,
): Promise<ReferenceReport> {
  const [mediaRes, defaultChRes, allowedChRes, blockChRes] = await Promise.all([
    (supabase as any)
      .from("media_items")
      .select("id, name")
      .eq("design_project_id", projectId)
      .limit(limitPerSource),
    (supabase as any)
      .from("channels")
      .select("id, name")
      .eq("default_design_project_id", projectId)
      .limit(limitPerSource),
    (supabase as any)
      .from("channel_allowed_projects")
      .select("id, channel_id, channels(name)")
      .eq("design_project_id", projectId)
      .limit(limitPerSource),
    (supabase as any)
      .from("channel_blocks")
      .select("id, channel_id, channels(name)")
      .eq("design_project_id", projectId)
      .limit(limitPerSource),
  ]);

  const channelItems: ReferenceItem[] = [];
  for (const c of (defaultChRes?.data ?? []) as any[]) {
    if (c?.name) channelItems.push({ name: `${c.name} (default)`, unassign: { source: "channel_default", channelId: c.id } });
  }
  for (const r of (allowedChRes?.data ?? []) as any[]) {
    const name = r?.channels?.name;
    if (name) channelItems.push({ name: `${name} (allowed)`, unassign: { source: "channel_allowed_projects", rowId: r.id } });
  }
  for (const r of (blockChRes?.data ?? []) as any[]) {
    const name = r?.channels?.name;
    if (name) channelItems.push({ name: `${name} (block)`, unassign: { source: "channel_blocks", rowId: r.id } });
  }

  const mediaItems: ReferenceItem[] = ((mediaRes?.data ?? []) as any[])
    .filter((m) => m?.name)
    .map((m) => ({ name: m.name, unassign: { source: "media_items", mediaId: m.id } as const }));

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
    const { error } = await (supabase as any)
      .from("channels")
      .update({ default_design_project_id: null })
      .eq("id", u.channelId);
    if (error) throw error;
  } else if (u.source === "channel_allowed_projects") {
    const { error } = await (supabase as any)
      .from("channel_allowed_projects")
      .delete()
      .eq("id", u.rowId);
    if (error) throw error;
  } else if (u.source === "channel_blocks") {
    const { error } = await (supabase as any)
      .from("channel_blocks")
      .delete()
      .eq("id", u.rowId);
    if (error) throw error;
  } else if (u.source === "media_items") {
    const { error } = await (supabase as any)
      .from("media_items")
      .update({ design_project_id: null })
      .eq("id", u.mediaId);
    if (error) throw error;
  } else if (u.source === "screen_channel_subscriptions") {
    const { error } = await (supabase as any)
      .from("screen_channel_subscriptions")
      .delete()
      .eq("id", u.rowId);
    if (error) throw error;
  } else if (u.source === "channel_bgm_items") {
    const { error } = await (supabase as any)
      .from("channel_bgm_items")
      .delete()
      .eq("id", u.rowId);
    if (error) throw error;
  } else if (u.source === "screen_channel_switch_triggers") {
    const { error } = await (supabase as any)
      .from("screen_channel_switch_triggers")
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
  const { data, error } = await (supabase as any)
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
  return { id: (data as any).id };
}

export async function cancelDesignProjectDelete(projectId: string): Promise<void> {
  await (supabase as any)
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
  const { data } = await (supabase as any)
    .from("design_project_delete_requests")
    .select("design_project_id")
    .in("design_project_id", projectIds)
    .eq("status", "pending");
  for (const row of (data ?? []) as any[]) {
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
  const { data: scheduleItems } = await (supabase as any)
    .from("schedule_items")
    .select("schedule_id, schedules:schedule_id(name)")
    .eq("media_id", mediaId);

  const schedules = dedupe(((scheduleItems ?? []) as any[]).map((si) => si?.schedules?.name));
  const projects = dedupe(projectRefs.map((p) => p?.name));

  return buildReport([
    { kind: "project", labelKey: "mediaUsedInProjects", names: projects },
    { kind: "schedule", labelKey: "mediaUsedInSchedules", names: schedules },
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

  const { data: scheduleHits } = await (supabase as any)
    .from("schedule_items")
    .select("media_id, schedules:schedule_id(name)")
    .in("media_id", mediaIds);

  const schedulesByMedia = new Map<string, string[]>();
  for (const row of (scheduleHits ?? []) as any[]) {
    const mid = row?.media_id;
    const name = row?.schedules?.name;
    if (!mid || !name) continue;
    const arr = schedulesByMedia.get(mid) ?? [];
    if (!arr.includes(name)) arr.push(name);
    schedulesByMedia.set(mid, arr);
  }

  for (const id of mediaIds) {
    const projects = dedupe((projectRefsByMedia.get(id) ?? []).map((p) => p.name));
    const schedules = schedulesByMedia.get(id) ?? [];
    result.set(
      id,
      buildReport([
        { kind: "project", labelKey: "mediaUsedInProjects", names: projects },
        { kind: "schedule", labelKey: "mediaUsedInSchedules", names: schedules },
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
  t: (key: any) => string,
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
    (supabase as any)
      .from("screen_channel_subscriptions")
      .select("id, screen_id, screens:screen_id(name)")
      .eq("channel_id", channelId)
      .limit(limitPerSource),
    (supabase as any)
      .from("publish_records")
      .select("id, screen_name, created_at")
      .eq("channel_id", channelId)
      .order("created_at", { ascending: false })
      .limit(limitPerSource),
    (supabase as any)
      .from("channel_bgm_items")
      .select("id, media_id, media_items:media_id(name)")
      .eq("channel_id", channelId)
      .limit(limitPerSource),
    (supabase as any)
      .from("channel_allowed_projects")
      .select("id, design_projects:design_project_id(name)")
      .eq("channel_id", channelId)
      .limit(limitPerSource),
    (supabase as any)
      .from("channel_blocks")
      .select("id, name")
      .eq("channel_id", channelId)
      .limit(limitPerSource),
    (supabase as any)
      .from("screen_channel_switch_triggers")
      .select("id, screen_id, trigger_type, screens:screen_id(name)")
      .eq("target_channel_id", channelId)
      .limit(limitPerSource),
  ]);

  const subItems: ReferenceItem[] = ((subRes?.data ?? []) as any[])
    .filter((r) => r?.screens?.name)
    .map((r) => ({
      name: r.screens.name as string,
      link: `/screens?focus=${r.screen_id}`,
      unassign: { source: "screen_channel_subscriptions", rowId: r.id } as const,
    }));
  const pubItems: ReferenceItem[] = ((pubRes?.data ?? []) as any[])
    .filter((r) => r?.screen_name)
    .map((r) => ({ name: r.screen_name as string, link: `/publishing` }));
  const bgmItems: ReferenceItem[] = ((bgmRes?.data ?? []) as any[])
    .filter((r) => r?.media_items?.name)
    .map((r) => ({
      name: r.media_items.name as string,
      link: `/media?focus=${r.media_id}`,
      unassign: { source: "channel_bgm_items", rowId: r.id } as const,
    }));
  const allowedItems: ReferenceItem[] = ((allowedRes?.data ?? []) as any[])
    .filter((r) => r?.design_projects?.name)
    .map((r) => ({
      name: r.design_projects.name as string,
      link: `/studio`,
      unassign: { source: "channel_allowed_projects", rowId: r.id } as const,
    }));
  const blockItems: ReferenceItem[] = ((blockRes?.data ?? []) as any[])
    .filter((r) => r?.name && (r.name as string).length > 0)
    .map((r) => ({ name: r.name as string, unassign: { source: "channel_blocks", rowId: r.id } as const }));
  const trgItems: ReferenceItem[] = ((trgRes?.data ?? []) as any[]).map((r) => {
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
  const { data, error } = await (supabase as any)
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
  return { id: (data as any).id };
}

export async function cancelChannelDelete(channelId: string): Promise<void> {
  await (supabase as any)
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
  const { data } = await (supabase as any)
    .from("channel_delete_requests")
    .select("channel_id")
    .in("channel_id", channelIds)
    .eq("status", "pending");
  for (const row of (data ?? []) as any[]) {
    if (row?.channel_id) out.add(row.channel_id);
  }
  return out;
}