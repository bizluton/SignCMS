import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Pencil, Trash2, CalendarClock, Tv, Repeat, Calendar as CalendarIcon, Users, User as UserIcon, Building2, ExternalLink } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useChannels, useChannelBlocks, type Channel, type ChannelBlock } from "@/hooks/useChannels";
import { ChannelDialog } from "@/components/channels/ChannelDialog";
import { ChannelBlockDialog } from "@/components/channels/ChannelBlockDialog";
import { ScheduleTimeline } from "@/components/channels/ScheduleTimeline";
import { PageSkeleton } from "@/components/PageSkeleton";
import { cn } from "@/lib/utils";
import {
  checkChannelReferences,
  unassignProjectReference,
  queueChannelDelete,
  cancelChannelDelete,
  fetchPendingChannelDeleteRequests,
  isBlockingChannelGroup,
  type ReferenceReport,
  type ReferenceItem,
} from "@/lib/referenceCheck";
import { useAuth } from "@/contexts/AuthContext";

interface DesignProjectLite { id: string; name: string }
interface TeamLite { id: string; name: string }

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString();
}

function weekdaysLabel(days: string[], language: string): string {
  if (!days || days.length === 0) return "—";
  const labels: Record<string, { zh: string; en: string; ja: string }> = {
    mon: { zh: "一", en: "Mon", ja: "月" }, tue: { zh: "二", en: "Tue", ja: "火" },
    wed: { zh: "三", en: "Wed", ja: "水" }, thu: { zh: "四", en: "Thu", ja: "木" },
    fri: { zh: "五", en: "Fri", ja: "金" }, sat: { zh: "六", en: "Sat", ja: "土" },
    sun: { zh: "日", en: "Sun", ja: "日" },
  };
  return days.map((d) => labels[d]?.[language as "zh" | "en" | "ja"] ?? d).join(language === "zh" ? "、" : ", ");
}

export default function SchedulesPage() {
  const { t, language } = useLanguage();
  const { activeOrgId } = useActiveOrg();
  const { user } = useAuth();
  const { channels, loading: channelsLoading, reload: reloadChannels } = useChannels(activeOrgId);

  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [channelDialogOpen, setChannelDialogOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [deletingChannel, setDeletingChannel] = useState<Channel | null>(null);
  const [channelImpact, setChannelImpact] = useState<ReferenceReport | null>(null);
  const [channelImpactLoading, setChannelImpactLoading] = useState(false);
  const [channelDeleteQueued, setChannelDeleteQueued] = useState(false);
  const [unassigningKey, setUnassigningKey] = useState<string | null>(null);
  const [pendingChannelIds, setPendingChannelIds] = useState<Set<string>>(new Set());

  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [editingBlock, setEditingBlock] = useState<ChannelBlock | null>(null);
  const [deletingBlock, setDeletingBlock] = useState<ChannelBlock | null>(null);

  const [designProjects, setDesignProjects] = useState<DesignProjectLite[]>([]);
  const [allowedProjectIds, setAllowedProjectIds] = useState<string[]>([]);
  const [teams, setTeams] = useState<TeamLite[]>([]);

  // Channel drag-reorder state
  const [dragChannelId, setDragChannelId] = useState<string | null>(null);
  const [dragOverChannelId, setDragOverChannelId] = useState<string | null>(null);

  const { blocks, loading: blocksLoading, reload: reloadBlocks } = useChannelBlocks(selectedChannelId);

  // Show expired schedules (persisted). Default: off (expired hidden).
  const [showExpired, setShowExpired] = useState<boolean>(() => {
    try { return localStorage.getItem("schedules-show-expired") === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("schedules-show-expired", showExpired ? "1" : "0"); } catch { /* ignore */ }
  }, [showExpired]);

  // Auto-disable any expired blocks on page load, then refresh.
  useEffect(() => {
    if (!activeOrgId) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.rpc("auto_disable_expired_channel_blocks");
      if (!cancelled && typeof data === "number" && data > 0) {
        reloadBlocks();
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId, selectedChannelId]);

  const isBlockExpired = (b: ChannelBlock): boolean => {
    const now = new Date();
    if (b.block_type === "calendar") {
      return !!b.end_at && new Date(b.end_at).getTime() < now.getTime();
    }
    if (b.block_type === "weekly") {
      if (!b.effective_to) return false;
      const end = new Date(b.effective_to);
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return end.getTime() < today.getTime();
    }
    return false;
  };

  const visibleBlocks = useMemo(
    () => (showExpired ? blocks : blocks.filter((b) => !isBlockExpired(b))),
    [blocks, showExpired],
  );

  // Load pending channel-delete requests so we can show the badge
  useEffect(() => {
    if (channels.length === 0) { setPendingChannelIds(new Set()); return; }
    (async () => {
      const set = await fetchPendingChannelDeleteRequests(channels.map((c) => c.id));
      setPendingChannelIds(set);
    })();
  }, [channels]);

  // Auto-select first channel
  useEffect(() => {
    if (!selectedChannelId && channels.length > 0) {
      setSelectedChannelId(channels[0].id);
    } else if (selectedChannelId && !channels.find((c) => c.id === selectedChannelId)) {
      setSelectedChannelId(channels[0]?.id ?? null);
    }
  }, [channels, selectedChannelId]);

  // Load design projects for the dialog
  useEffect(() => {
    if (!activeOrgId) return;
    (async () => {
      const { data } = await supabase
        .from("design_projects")
        .select("id, name")
        .eq("org_id", activeOrgId)
        .order("name", { ascending: true });
      setDesignProjects((data as DesignProjectLite[]) ?? []);
    })();
  }, [activeOrgId]);

  // Load teams for badges next to channel name
  useEffect(() => {
    if (!activeOrgId) { setTeams([]); return; }
    (async () => {
      const { data } = await supabase
        .from("teams")
        .select("id, name")
        .eq("org_id", activeOrgId)
        .order("name");
      setTeams((data as TeamLite[]) ?? []);
    })();
  }, [activeOrgId]);

  // Load allowed projects for the selected channel; if none configured, fall back to all org projects
  useEffect(() => {
    if (!selectedChannelId) { setAllowedProjectIds([]); return; }
    (async () => {
      const { data } = await supabase
        .from("channel_allowed_projects")
        .select("design_project_id")
        .eq("channel_id", selectedChannelId)
        .order("sort_order", { ascending: true });
      setAllowedProjectIds((data ?? []).map((r) => r.design_project_id));
    })();
  }, [selectedChannelId, blocks]);

  const selectedChannel = useMemo(
    () => channels.find((c) => c.id === selectedChannelId) ?? null,
    [channels, selectedChannelId],
  );

  const visibleProjects = useMemo(() => {
    if (allowedProjectIds.length === 0) return [] as DesignProjectLite[];
    const set = new Set(allowedProjectIds);
    // Preserve allowed list order
    return allowedProjectIds
      .map((id) => designProjects.find((p) => p.id === id))
      .filter((p): p is DesignProjectLite => !!p);
  }, [allowedProjectIds, designProjects]);

  const projectNameById = useMemo(() => {
    const map = new Map<string, string>();
    designProjects.forEach((p) => map.set(p.id, p.name));
    return map;
  }, [designProjects]);

  const requestDeleteChannel = async (channel: Channel) => {
    setDeletingChannel(channel);
    setChannelImpact(null);
    setChannelImpactLoading(true);
    setChannelDeleteQueued(false);
    try {
      const [report, pending] = await Promise.all([
        checkChannelReferences(channel.id),
        fetchPendingChannelDeleteRequests([channel.id]),
      ]);
      setChannelImpact(report);
      setChannelDeleteQueued(pending.has(channel.id));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
      setChannelImpact({ groups: [], total: 0, hasAny: false });
    } finally {
      setChannelImpactLoading(false);
    }
  };

  const refreshChannelImpact = async (channelId: string) => {
    try {
      const [report, pending] = await Promise.all([
        checkChannelReferences(channelId),
        fetchPendingChannelDeleteRequests([channelId]),
      ]);
      setChannelImpact(report);
      setChannelDeleteQueued(pending.has(channelId));
      // If queue executed (channel removed), close dialog and refresh list
      const stillExists = (await (supabase as any).from("channels").select("id").eq("id", channelId).maybeSingle()).data;
      if (!stillExists) {
        toast.success(t("channelDeleteAutoExecuted"));
        setDeletingChannel(null);
        setChannelImpact(null);
        setChannelDeleteQueued(false);
        reloadChannels();
        loadPendingChannelIds();
      }
    } catch (err: any) {
      toast.error(err?.message ?? String(err));
    }
  };

  const handleUnassignChannelRef = async (item: ReferenceItem, key: string) => {
    if (!deletingChannel) return;
    setUnassigningKey(key);
    try {
      await unassignProjectReference(item);
      toast.success(t("studioDeleteUnassignSuccess"));
      await refreshChannelImpact(deletingChannel.id);
    } catch (err: any) {
      toast.error(`${t("studioDeleteUnassignError")}: ${err?.message ?? String(err)}`);
    } finally {
      setUnassigningKey(null);
    }
  };

  const handleQueueChannelDelete = async () => {
    if (!deletingChannel || !user) return;
    const result = await queueChannelDelete({
      channelId: deletingChannel.id,
      orgId: activeOrgId,
      userId: user.id,
      reason: "user_request",
    });
    if ("error" in result) { toast.error(result.error); return; }
    toast.success(t("channelDeleteRequestedTitle"));
    setChannelDeleteQueued(true);
    loadPendingChannelIds();
  };

  const handleCancelChannelQueue = async () => {
    if (!deletingChannel) return;
    await cancelChannelDelete(deletingChannel.id);
    toast.success(t("channelDeleteCancelRequestBtn"));
    setChannelDeleteQueued(false);
    loadPendingChannelIds();
  };

  const loadPendingChannelIds = async () => {
    if (channels.length === 0) { setPendingChannelIds(new Set()); return; }
    const set = await fetchPendingChannelDeleteRequests(channels.map((c) => c.id));
    setPendingChannelIds(set);
  };

  const handleDeleteChannel = async () => {
    if (!deletingChannel) return;
    const { error } = await (supabase as any).from("channels").delete().eq("id", deletingChannel.id);
    if (error) { toast.error(error.message); return; }
    toast.success(t("channelDeleted"));
    setDeletingChannel(null);
    setChannelImpact(null);
    reloadChannels();
  };

  const handleDeleteBlock = async () => {
    if (!deletingBlock) return;
    const { error } = await (supabase as any).from("channel_blocks").delete().eq("id", deletingBlock.id);
    if (error) { toast.error(error.message); return; }
    toast.success(t("blockDeleted"));
    setDeletingBlock(null);
    reloadBlocks();
  };

  const toggleChannelEnabled = async (c: Channel, next: boolean) => {
    const { error } = await (supabase as any).from("channels").update({ enabled: next }).eq("id", c.id);
    if (error) { toast.error(error.message); return; }
    reloadChannels();
  };

  const toggleBlockEnabled = async (b: ChannelBlock, next: boolean) => {
    const { error } = await (supabase as any).from("channel_blocks").update({ enabled: next }).eq("id", b.id);
    if (error) { toast.error(error.message); return; }
    reloadBlocks();
  };

  const persistChannelOrder = async (orderedIds: string[]) => {
    // Persist sort_order for each channel
    const updates = orderedIds.map((id, idx) =>
      (supabase as any).from("channels").update({ sort_order: idx }).eq("id", id),
    );
    const results = await Promise.all(updates);
    const firstErr = results.find((r) => r.error)?.error;
    if (firstErr) { toast.error(firstErr.message); }
    reloadChannels();
  };

  const handleChannelDrop = (targetId: string) => {
    if (!dragChannelId || dragChannelId === targetId) {
      setDragChannelId(null); setDragOverChannelId(null); return;
    }
    const ids = channels.map((c) => c.id);
    const from = ids.indexOf(dragChannelId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) { setDragChannelId(null); setDragOverChannelId(null); return; }
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setDragChannelId(null);
    setDragOverChannelId(null);
    persistChannelOrder(next);
  };

  const reorderAllowedProjects = async (orderedIds: string[]) => {
    if (!selectedChannelId) return;
    // Optimistic update
    setAllowedProjectIds(orderedIds);
    // Replace rows for this channel with new order
    const { error: delErr } = await (supabase as any)
      .from("channel_allowed_projects")
      .delete()
      .eq("channel_id", selectedChannelId);
    if (delErr) { toast.error(delErr.message); return; }
    if (orderedIds.length > 0) {
      const rows = orderedIds.map((pid, idx) => ({
        channel_id: selectedChannelId,
        design_project_id: pid,
        sort_order: idx,
      }));
      const { error: insErr } = await (supabase as any)
        .from("channel_allowed_projects")
        .insert(rows);
      if (insErr) { toast.error(insErr.message); return; }
    }
  };

  if (channelsLoading && channels.length === 0) return <PageSkeleton />;
  if (!activeOrgId) return <div className="p-6 text-muted-foreground">—</div>;

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarClock className="h-6 w-6" />
            {t("channelsTitle")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t("channelsSubtitle")}</p>
        </div>
        <Button onClick={() => { setEditingChannel(null); setChannelDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" /> {t("newChannel")}
        </Button>
      </div>

      {/* Channel bar */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {channels.length === 0 && (
          <div className="text-sm text-muted-foreground py-4">{t("noChannelsYet")}</div>
        )}
        {channels.map((c) => (
          <button
            key={c.id}
            onClick={() => setSelectedChannelId(c.id)}
            draggable
            onDragStart={(e) => { setDragChannelId(c.id); e.dataTransfer.effectAllowed = "move"; }}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (dragOverChannelId !== c.id) setDragOverChannelId(c.id); }}
            onDragLeave={() => { if (dragOverChannelId === c.id) setDragOverChannelId(null); }}
            onDrop={(e) => { e.preventDefault(); handleChannelDrop(c.id); }}
            onDragEnd={() => { setDragChannelId(null); setDragOverChannelId(null); }}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg border transition-all whitespace-nowrap min-w-[160px] cursor-grab active:cursor-grabbing",
              selectedChannelId === c.id
                ? "border-primary bg-primary/5 shadow-sm"
                : "border-border hover:bg-accent",
              !c.enabled && "opacity-60",
              dragChannelId === c.id && "opacity-40",
              dragOverChannelId === c.id && dragChannelId && dragChannelId !== c.id && "ring-2 ring-primary",
            )}
            title={t("dragToReorder")}
          >
            <span className="h-3 w-3 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
            <span className="font-medium text-sm truncate flex-1 text-left">{c.name}</span>
            {!c.enabled && <Badge variant="outline" className="text-[10px] py-0">{t("offline")}</Badge>}
            {pendingChannelIds.has(c.id) && (
              <Badge variant="destructive" className="text-[10px] py-0">{t("channelDeleteQueuedBadge")}</Badge>
            )}
          </button>
        ))}
      </div>

      {/* Channel actions */}
      {selectedChannel && (
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="h-4 w-4 rounded-full" style={{ backgroundColor: selectedChannel.color }} />
            <h2 className="text-lg font-semibold">{selectedChannel.name}</h2>
            {(() => {
              const teamName = selectedChannel.team_id
                ? teams.find((tm) => tm.id === selectedChannel.team_id)?.name
                : null;
              const displayTeam = teamName === "Default" ? t("teamNoTeamLabel") : teamName;
              const scope = selectedChannel.collab_scope;
              const scopeLabel =
                scope === "team" ? t("channelCollabTeam") :
                scope === "org" ? t("channelCollabOrg") : t("channelCollabCreator");
              const ScopeIcon = scope === "team" ? Users : scope === "org" ? Building2 : UserIcon;
              return (
                <>
                  {displayTeam && (
                    <Badge variant="secondary" className="text-[10px] gap-1">
                      <Users className="h-3 w-3" />{displayTeam}
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-[10px] gap-1">
                    <ScopeIcon className="h-3 w-3" />{scopeLabel}
                  </Badge>
                </>
              );
            })()}
            {selectedChannel.description && (
              <span className="text-sm text-muted-foreground">— {selectedChannel.description}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => { setEditingChannel(selectedChannel); setChannelDialogOpen(true); }}>
              <Pencil className="h-4 w-4 mr-1" /> {t("edit")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => requestDeleteChannel(selectedChannel)}>
              <Trash2 className="h-4 w-4 mr-1" /> {t("delete")}
            </Button>
            <Button size="sm" onClick={() => { setEditingBlock(null); setBlockDialogOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" /> {t("newBlock")}
            </Button>
          </div>
        </div>
      )}

      {/* Calendar timeline */}
      {selectedChannel && (
        <ScheduleTimeline
          channelId={selectedChannel.id}
          blocks={blocks}
          designProjects={visibleProjects}
          channelColor={selectedChannel.color}
          onBlockClick={(b) => { setEditingBlock(b); setBlockDialogOpen(true); }}
          onReorderProjects={reorderAllowedProjects}
        />
      )}

      {/* Block list */}
      {selectedChannel && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between gap-3">
            <h3 className="font-semibold text-sm">{t("channelBlocks")}</h3>
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
              <Switch
                checked={showExpired}
                onCheckedChange={setShowExpired}
                aria-label={t("blockShowExpired")}
              />
              <span>{t("blockShowExpired")}</span>
            </label>
          </div>
          {blocksLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">…</div>
          ) : visibleBlocks.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">{t("noBlocksYet")}</div>
          ) : (
            <div className="divide-y">
              {visibleBlocks.map((b) => (
                <div key={b.id} className={cn("px-4 py-3 flex items-center gap-3 hover:bg-accent/30 transition-colors", !b.enabled && "opacity-60")}>
                  <div className="flex-shrink-0">
                    {b.block_type === "calendar"
                      ? <CalendarIcon className="h-5 w-5 text-primary" />
                      : <Repeat className="h-5 w-5 text-primary" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{b.name || t("blockName")}</span>
                      <Badge variant="secondary" className="text-[10px]">
                        {b.block_type === "calendar" ? t("blockTypeCalendar") : t("blockTypeWeekly")}
                      </Badge>
                      {b.design_project_id && (
                        <Badge variant="outline" className="text-[10px]">
                          {projectNameById.get(b.design_project_id) ?? "—"}
                        </Badge>
                      )}
                      {isBlockExpired(b) && (
                        <Badge variant="destructive" className="text-[10px]">{t("blockExpiredBadge")}</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {b.block_type === "calendar"
                        ? `${formatDateTime(b.start_at)} → ${formatDateTime(b.end_at)}`
                        : `${weekdaysLabel(b.weekdays, language)}  ${b.start_time?.slice(0, 5)} – ${b.end_time?.slice(0, 5)}`}
                    </div>
                  </div>
                  <Switch
                    checked={b.enabled}
                    onCheckedChange={(v) => toggleBlockEnabled(b, v)}
                    aria-label={t("blockEnabled")}
                  />
                  <Button variant="ghost" size="icon" onClick={() => { setEditingBlock(b); setBlockDialogOpen(true); }}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setDeletingBlock(b)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Dialogs */}
      {activeOrgId && (
        <ChannelDialog
          open={channelDialogOpen}
          onOpenChange={setChannelDialogOpen}
          orgId={activeOrgId}
          channel={editingChannel}
          designProjects={designProjects}
          onSaved={async () => {
            await reloadChannels();
            // Refresh allowed projects for the currently selected channel
            if (selectedChannelId) {
              const { data } = await (supabase as any)
                .from("channel_allowed_projects")
                .select("design_project_id")
                .eq("channel_id", selectedChannelId)
                .order("sort_order", { ascending: true });
              setAllowedProjectIds((data ?? []).map((r: any) => r.design_project_id));
            }
          }}
        />
      )}
      {selectedChannel && activeOrgId && (
        <ChannelBlockDialog
          open={blockDialogOpen}
          onOpenChange={setBlockDialogOpen}
          channelId={selectedChannel.id}
          orgId={activeOrgId}
          block={editingBlock}
          channel={selectedChannel}
          designProjects={designProjects}
          onSaved={reloadBlocks}
        />
      )}

      <AlertDialog open={!!deletingChannel} onOpenChange={(o) => { if (!o) { setDeletingChannel(null); setChannelImpact(null); setChannelDeleteQueued(false); } }}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {channelDeleteQueued
                ? t("channelDeleteRequestedTitle")
                : channelImpact && channelImpact.groups.some((g) => isBlockingChannelGroup(g.labelKey) && g.names.length > 0)
                  ? t("channelDeleteBlockedTitle")
                  : t("channelDeleteImpactTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {deletingChannel && (
                  <div className="text-sm font-medium text-foreground">{deletingChannel.name}</div>
                )}
                {channelImpactLoading ? (
                  <div className="text-sm text-muted-foreground">…</div>
                ) : channelImpact && channelImpact.hasAny ? (
                  <>
                    <div className="text-sm">
                      {channelDeleteQueued ? t("channelDeleteRequestedDesc") : t("channelDeleteImpactDesc")}
                    </div>
                    <ul className="space-y-3 text-sm max-h-80 overflow-auto pr-1">
                      {channelImpact.groups.map((g) => (
                        <li key={g.labelKey} className="border border-border rounded-md p-2">
                          <div className="font-medium text-foreground mb-1.5">
                            {t(g.labelKey)} ({g.names.length})
                            {!isBlockingChannelGroup(g.labelKey) && (
                              <span className="ml-2 text-xs text-muted-foreground">(history)</span>
                            )}
                          </div>
                          {g.items && g.items.length > 0 ? (
                            <ul className="space-y-1">
                              {g.items.map((it, idx) => {
                                const key = `${g.labelKey}:${idx}`;
                                return (
                                  <li key={key} className="flex items-center justify-between gap-2">
                                    {it.link ? (
                                      <Link
                                        to={it.link}
                                        onClick={() => { setDeletingChannel(null); setChannelImpact(null); setChannelDeleteQueued(false); }}
                                        className="text-muted-foreground hover:text-foreground hover:underline truncate inline-flex items-center gap-1 min-w-0"
                                      >
                                        <span className="truncate">{it.name}</span>
                                        <ExternalLink className="h-3 w-3 flex-shrink-0 opacity-60" />
                                      </Link>
                                    ) : (
                                      <span className="text-muted-foreground truncate">{it.name}</span>
                                    )}
                                    {it.unassign && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 px-2 text-xs flex-shrink-0"
                                        disabled={unassigningKey === key}
                                        onClick={() => handleUnassignChannelRef(it, key)}
                                      >
                                        {t("studioDeleteUnassignBtn")}
                                      </Button>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          ) : (
                            <div className="text-muted-foreground break-words">{g.names.join(", ")}</div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground">{t("channelDeleteImpactNone")}</div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            {(() => {
              const hasBlocking = !!channelImpact && channelImpact.groups.some(
                (g) => isBlockingChannelGroup(g.labelKey) && g.names.length > 0,
              );
              if (channelDeleteQueued) {
                return (
                  <Button variant="outline" onClick={handleCancelChannelQueue} disabled={channelImpactLoading}>
                    {t("channelDeleteCancelRequestBtn")}
                  </Button>
                );
              }
              if (hasBlocking) {
                return (
                  <Button onClick={handleQueueChannelDelete} disabled={channelImpactLoading}>
                    {t("channelDeleteRequestBtn")}
                  </Button>
                );
              }
              return (
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={handleDeleteChannel}
                  disabled={channelImpactLoading}
                >
                  {t("delete")}
                </AlertDialogAction>
              );
            })()}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deletingBlock} onOpenChange={(o) => !o && setDeletingBlock(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteBlock")}</AlertDialogTitle>
            <AlertDialogDescription>{t("blockDeleteConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteBlock}>{t("delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}