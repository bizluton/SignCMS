import { useState, useEffect, useMemo, useCallback } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole } from "@/hooks/useUserRole";
import { useOrgLicense } from "@/hooks/useOrgLicense";
import { useUserOrgs } from "@/hooks/useUserOrgs";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import {
  Send, CalendarClock, Monitor, CheckCircle2, Clock, Loader2,
  Play, Zap, Calendar as CalendarIcon, ListMusic, Building2, Repeat, Settings2,
  CheckCheck, Search, AlertTriangle, ShieldAlert, X, Layers, RotateCcw, Download,
  FileArchive, FolderDown, Eye, Tv, LayoutTemplate, Users, User as UserIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { logActivity } from "@/lib/activityLogger";
import { logScreenEvents } from "@/lib/screenLogger";
import { PageSkeleton } from "@/components/PageSkeleton";
import { exportScheduleToZip, exportDesignProjectsToZip } from "@/lib/exportSchedule";
import { exportScheduleToFolder, isFolderExportSupported } from "@/lib/exportSchedule";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import SchedulePreviewDialog from "@/components/SchedulePreviewDialog";
import { SmartTriggerPanel } from "@/components/triggers/SmartTriggerPanel";
import {
  zonedDateTimeToUtc,
  formatDateInTz,
  formatInTz,
  getBrowserTimezone,
} from "@/lib/timezone";

interface ScheduleOption {
  id: string;
  name: string;
  org_id: string | null;
  screen_name: string;
  items_count: number;
}

interface ScreenOption {
  id: string;
  name: string;
  branch: string;
  online: boolean;
  org_id: string | null;
  timezone: string | null;
}

interface ChannelOption {
  id: string;
  name: string;
  org_id: string | null;
  color: string;
  enabled: boolean;
  team_id: string | null;
  team_name: string;
  collab_scope: "creator" | "team" | "org";
}

interface DesignProjectOption {
  id: string;
  name: string;
  org_id: string | null;
  aspect: string;
  created_by: string | null;
  creator_name: string;
  team_name: string;
  collab_scope: "creator" | "team" | "org";
}

interface ProjectScheduleOption {
  id: string;
  name: string;
  design_project_id: string;
  design_project_name: string;
  block_type: "calendar" | "weekly";
  color: string;
  start_at: string | null;
  end_at: string | null;
  weekdays: string[];
  start_time: string | null;
  end_time: string | null;
  org_id: string | null;
}

type PlaylistTab = "channel" | "project";
type SelectedSource = { type: PlaylistTab; id: string } | null;

interface PlaylistTrigger {
  gpio: boolean;
  remote: boolean;
  api: boolean;
}

interface PublishRecord {
  id: string;
  schedule_name: string;
  screen_name: string;
  status: string;
  scheduled_at: string | null;
  created_at: string;
}

export default function PublishingCenterPage() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { isAdmin } = useUserRole();
  const { license } = useOrgLicense();
  const { orgs } = useUserOrgs();
  const { activeOrgId } = useActiveOrg();
  const [filterOrgId, setFilterOrgId] = useState<string>("all");

  // Data
  const [schedules, setSchedules] = useState<ScheduleOption[]>([]);
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [designProjects, setDesignProjects] = useState<DesignProjectOption[]>([]);
  const [projectScheduleOptions, setProjectScheduleOptions] = useState<ProjectScheduleOption[]>([]);
  const [screens, setScreens] = useState<ScreenOption[]>([]);
  const [records, setRecords] = useState<PublishRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Selection state
  const [playlistTab, setPlaylistTab] = useState<PlaylistTab>("project");
  const [triggerDialogOpen, setTriggerDialogOpen] = useState(false);
  const [playlistTrigger, setPlaylistTrigger] = useState<PlaylistTrigger>({ gpio: false, remote: true, api: false });
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(null);
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [previewSchedule, setPreviewSchedule] = useState<ScheduleOption | null>(null);
  const [selectedScreenIds, setSelectedScreenIds] = useState<Set<string>>(new Set());
  const [publishMode, setPublishMode] = useState<"now" | "scheduled">("now");
  const [scheduledDate, setScheduledDate] = useState<Date | undefined>(undefined);
  const [scheduledTime, setScheduledTime] = useState("10:00");
  // How to interpret the chosen date+time when targeting screens across
  // different timezones:
  //   "local"   – fire at that wall-clock time AT EACH SCREEN'S TIMEZONE
  //               (e.g. 10:00 in NY *and* 10:00 in Tokyo). DST handled per-tz.
  //   "instant" – fire at one global moment, expressed in the publisher's tz.
  const [scheduleTzMode, setScheduleTzMode] = useState<"local" | "instant">("local");
  const browserTz = useMemo(() => getBrowserTimezone(), []);
  const [publishing, setPublishing] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [searchScreen, setSearchScreen] = useState("");
  const [searchProject, setSearchProject] = useState("");

  // Emergency broadcast state
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [emergencyConfirmOpen, setEmergencyConfirmOpen] = useState(false);
  const [emergencyMessage, setEmergencyMessage] = useState("");
  const [emergencyPublishing, setEmergencyPublishing] = useState(false);
  const [showEmergencySuccess, setShowEmergencySuccess] = useState(false);

  // Restore normal state
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [showRestoreSuccess, setShowRestoreSuccess] = useState(false);

  // Download-to-local (USB sync) state
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const handleDownloadPlaylist = async (s: ScheduleOption, e: React.MouseEvent) => {
    e.stopPropagation();
    if (downloadingId) return;
    setDownloadingId(s.id);
    const tId = toast.loading(t("publishDownloading"));
    try {
      const res = await exportScheduleToZip({
        scheduleId: s.id,
        fallbackName: s.name,
        orgId: s.org_id || activeOrgId || null,
        userId: user?.id,
        source: "usb",
      });
      toast.success(t("publishDownloadSuccess").replace("{size}", (res.sizeBytes / (1024 * 1024)).toFixed(2)), { id: tId });
    } catch (err) {
      console.error("Download playlist failed", err);
      toast.error(t("publishDownloadFailed"), { id: tId });
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDownloadPlaylistFolder = async (s: ScheduleOption) => {
    if (downloadingId) return;
    if (!isFolderExportSupported()) {
      toast.error(t("publishFolderUnsupported"));
      return;
    }
    setDownloadingId(s.id);
    const tId = toast.loading(t("publishWritingFolder"));
    try {
      const res = await exportScheduleToFolder({
        scheduleId: s.id,
        fallbackName: s.name,
        orgId: s.org_id || activeOrgId || null,
        userId: user?.id,
        source: "usb",
      });
      toast.success(
        t("publishFolderSuccess")
          .replace("{name}", res.filename)
          .replace("{count}", String(res.fileCount))
          .replace("{size}", (res.sizeBytes / (1024 * 1024)).toFixed(2)),
        { id: tId }
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        toast.info(t("publishFolderCancelled"), { id: tId });
      } else {
        console.error("Folder export failed", err);
        toast.error(t("publishDownloadFailed"), { id: tId });
      }
    } finally {
      setDownloadingId(null);
    }
  };

  // Fetch data
  const fetchData = useCallback(async () => {
    type RawSched = { id: string; name: string; org_id: string | null; screens: { name: string } | null };
    type RawScreen = { id: string; name: string; branch: string; online: boolean; org_id: string | null; timezone?: string | null };
    type RawChannel = { id: string; name: string; org_id: string | null; color: string; enabled: boolean; sort_order: number; team_id: string | null; collab_scope: string };
    type RawProject = { id: string; name: string; org_id: string | null; aspect: string; created_by: string | null; team_id: string | null; collab_scope: string };
    type RawPS = { id: string; name: string; design_project_id: string; block_type: string; color: string; start_at: string | null; end_at: string | null; weekdays: unknown; start_time: string | null; end_time: string | null; org_id: string | null };
    setLoading(true);
    let schedQ = supabase.from("schedules").select("id, name, org_id, screen_id, screens:screen_id(name)").order("name");
    let screenQ = supabase.from("screens").select("id, name, branch, online, org_id").order("branch").order("name");
    let channelQ = supabase.from("channels").select("id, name, org_id, color, enabled, sort_order, team_id, collab_scope").order("sort_order", { ascending: true }).order("created_at", { ascending: true });
    let projectQ = supabase.from("design_projects").select("id, name, org_id, aspect, created_by, team_id, collab_scope").order("name");
    let psQ = supabase.from("project_schedules").select("id, name, design_project_id, block_type, color, start_at, end_at, weekdays, start_time, end_time, org_id").eq("enabled", true).order("created_at", { ascending: true });
    if (activeOrgId) {
      schedQ = schedQ.eq("org_id", activeOrgId);
      screenQ = screenQ.eq("org_id", activeOrgId);
      channelQ = channelQ.eq("org_id", activeOrgId);
      projectQ = projectQ.eq("org_id", activeOrgId);
      psQ = psQ.eq("org_id", activeOrgId);
    }
    const [schedRes, screenRes, recordRes, channelRes, projectRes, psRes] = await Promise.all([
      schedQ,
      screenQ,
      supabase.from("publish_records").select("*").order("created_at", { ascending: false }).limit(50),
      channelQ,
      projectQ,
      psQ,
    ]);

    const { data: itemCounts } = await supabase.from("schedule_items").select("schedule_id");
    const countMap = new Map<string, number>();
    (itemCounts || []).forEach((i) => {
      countMap.set(i.schedule_id, (countMap.get(i.schedule_id) || 0) + 1);
    });

    setSchedules(((schedRes.data || []) as RawSched[]).map((s) => ({
      id: s.id,
      name: s.name,
      org_id: s.org_id || null,
      screen_name: s.screens?.name || "-",
      items_count: countMap.get(s.id) || 0,
    })));
    setScreens(((screenRes.data || []) as RawScreen[]).map((s) => ({ ...s, org_id: s.org_id || null })) as ScreenOption[]);
    setRecords((recordRes.data || []) as PublishRecord[]);
    const rawChannels = (channelRes.data || []) as RawChannel[];
    const rawProjects = (projectRes.data || []) as RawProject[];
    const creatorIds = Array.from(new Set(rawProjects.map((p) => p.created_by).filter(Boolean) as string[]));
    const creatorMap = new Map<string, string>();
    const teamMap = new Map<string, string>();
    // Resolve team names from project.team_id and channel.team_id together
    const allTeamIds = Array.from(new Set([
      ...rawProjects.map((p) => p.team_id).filter(Boolean) as string[],
      ...rawChannels.map((c) => c.team_id).filter(Boolean) as string[],
    ]));
    const projectTeamNames = new Map<string, string>();
    if (allTeamIds.length > 0) {
      const { data: ptData } = await supabase
        .from("teams").select("id, name").in("id", allTeamIds);
      (ptData || []).forEach((tm) => projectTeamNames.set(tm.id, tm.name));
    }
    setChannels(rawChannels.map((c) => ({
      id: c.id,
      name: c.name,
      org_id: c.org_id || null,
      color: c.color || "#3b82f6",
      enabled: c.enabled !== false,
      team_id: c.team_id || null,
      team_name: (c.team_id && projectTeamNames.get(c.team_id)) || "",
      collab_scope: (c.collab_scope === "creator" || c.collab_scope === "team" || c.collab_scope === "org") ? c.collab_scope : "team",
    })) as ChannelOption[]);
    if (creatorIds.length > 0) {
      const [profRes, memRes] = await Promise.all([
        supabase.from("profiles").select("user_id, display_name").in("user_id", creatorIds),
        supabase.from("team_members").select("user_id, team_id").in("user_id", creatorIds),
      ]);
      (profRes.data || []).forEach((p) => {
        creatorMap.set(p.user_id, p.display_name || "");
      });
      // Fetch teams referenced by these memberships
      const teamIds = Array.from(new Set((memRes.data || []).map((m) => m.team_id).filter(Boolean)));
      const teamsById = new Map<string, { name: string; org_id: string }>();
      if (teamIds.length > 0) {
        const { data: teamsData } = await supabase
          .from("teams")
          .select("id, name, org_id")
          .in("id", teamIds);
        (teamsData || []).forEach((t) => {
          teamsById.set(t.id, { name: t.name, org_id: t.org_id });
        });
      }
      // For each user, list of teams (with org)
      const userTeams = new Map<string, Array<{ name: string; org_id: string }>>();
      (memRes.data || []).forEach((m) => {
        const team = teamsById.get(m.team_id);
        if (!team) return;
        const arr = userTeams.get(m.user_id) || [];
        arr.push(team);
        userTeams.set(m.user_id, arr);
      });
      rawProjects.forEach((p) => {
        if (!p.created_by) return;
        const teams = userTeams.get(p.created_by) || [];
        const match = teams.find((tm) => tm.org_id === p.org_id) || teams[0];
        if (match) teamMap.set(`${p.id}`, match.name);
      });
    }
    setDesignProjects(rawProjects.map((p) => ({
      id: p.id,
      name: p.name,
      org_id: p.org_id || null,
      aspect: p.aspect || "16:9",
      created_by: p.created_by || null,
      creator_name: (p.created_by && creatorMap.get(p.created_by)) || p.created_by || "-",
      team_name: (p.team_id && projectTeamNames.get(p.team_id)) || teamMap.get(p.id) || "",
      collab_scope: (p.collab_scope === "creator" || p.collab_scope === "team" || p.collab_scope === "org") ? p.collab_scope : "creator",
    })) as DesignProjectOption[]);
    const projectNameById = new Map(rawProjects.map((p) => [p.id, p.name]));
    setProjectScheduleOptions(((psRes.data || []) as RawPS[]).map((s) => ({
      id: s.id,
      name: s.name,
      design_project_id: s.design_project_id,
      design_project_name: projectNameById.get(s.design_project_id) ?? "",
      block_type: (s.block_type === "weekly" ? "weekly" : "calendar") as "calendar" | "weekly",
      color: s.color || "#3b82f6",
      start_at: s.start_at,
      end_at: s.end_at,
      weekdays: (s.weekdays as string[]) ?? [],
      start_time: s.start_time,
      end_time: s.end_time,
      org_id: s.org_id,
    })));
    setLoading(false);
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData, activeOrgId]);

  // Filter by org
  const filteredSchedules = useMemo(() => {
    if (filterOrgId === "all") return schedules;
    if (filterOrgId === "none") return schedules.filter(s => !s.org_id);
    return schedules.filter(s => s.org_id === filterOrgId);
  }, [schedules, filterOrgId]);

  const filteredChannels = useMemo(() => {
    if (filterOrgId === "all") return channels;
    if (filterOrgId === "none") return channels.filter((c) => !c.org_id);
    return channels.filter((c) => c.org_id === filterOrgId);
  }, [channels, filterOrgId]);

  const filteredDesignProjects = useMemo(() => {
    let list = projectScheduleOptions;
    if (filterOrgId === "none") list = list.filter((p) => !p.org_id);
    else if (filterOrgId !== "all") list = list.filter((p) => p.org_id === filterOrgId);
    const q = searchProject.trim().toLowerCase();
    if (q) list = list.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      p.design_project_name.toLowerCase().includes(q),
    );
    return list;
  }, [projectScheduleOptions, filterOrgId, searchProject]);

  const selectedChannelsOrdered = useMemo(
    () => selectedChannelIds.map((id) => channels.find((c) => c.id === id)).filter(Boolean) as ChannelOption[],
    [channels, selectedChannelIds],
  );
  const selectedSchedule = useMemo(
    () => schedules.find((s) => s.id === selectedScheduleId) ?? null,
    [schedules, selectedScheduleId],
  );
  const selectedDesignProject = useMemo(
    () => designProjects.find((p) => p.id === selectedScheduleId) ?? null,
    [designProjects, selectedScheduleId],
  );
  const selectedProjectsOrdered = useMemo(
    () => selectedProjectIds.map((id) => projectScheduleOptions.find((p) => p.id === id)).filter(Boolean) as ProjectScheduleOption[],
    [projectScheduleOptions, selectedProjectIds],
  );
  const selectedSourceName = playlistTab === "channel"
    ? (selectedChannelsOrdered.length > 0
        ? selectedChannelsOrdered.map((c, i) => `${i + 1}. ${c.name}`).join("，")
        : null)
    : (selectedProjectsOrdered.length > 0
        ? selectedProjectsOrdered.map((p, i) => `${i + 1}. ${p.name}`).join("，")
        : null);
  const hasSelectedSource = playlistTab === "channel" ? selectedChannelIds.length > 0 : selectedProjectIds.length > 0;

  const filteredScreens = useMemo(() => {
    if (filterOrgId === "all") return screens;
    if (filterOrgId === "none") return screens.filter(s => !s.org_id);
    return screens.filter(s => s.org_id === filterOrgId);
  }, [screens, filterOrgId]);

  // Grouped screens by group (branch field)
  const groupedScreens = useMemo(() => {
    const groups = new Map<string, ScreenOption[]>();
    const filtered = filteredScreens.filter((s) =>
      s.name.toLowerCase().includes(searchScreen.toLowerCase()) ||
      s.branch.toLowerCase().includes(searchScreen.toLowerCase())
    );
    filtered.forEach((s) => {
      const group = s.branch || t("publishUngrouped");
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(s);
    });
    return groups;
  }, [filteredScreens, searchScreen, t]);

  const allScreenIds = useMemo(() => new Set(filteredScreens.map((s) => s.id)), [filteredScreens]);
  const allSelected = selectedScreenIds.size === filteredScreens.length && filteredScreens.length > 0;

  // Check if there are active emergency records
  const hasActiveEmergency = useMemo(() => records.some((r) => r.status === "emergency"), [records]);

  const toggleScreen = (id: string) => {
    setSelectedScreenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleGroup = (groupScreens: ScreenOption[]) => {
    setSelectedScreenIds((prev) => {
      const next = new Set(prev);
      const allIn = groupScreens.every((s) => next.has(s.id));
      if (allIn) groupScreens.forEach((s) => next.delete(s.id));
      else groupScreens.forEach((s) => next.add(s.id));
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) setSelectedScreenIds(new Set());
    else setSelectedScreenIds(new Set(allScreenIds));
  };

  // Download selected source to ZIP (USB sync)
  const handleDownloadSelected = async () => {
    if (downloadingId) return;
    const activeIds = playlistTab === "channel" ? selectedChannelIds : selectedProjectIds;
    if (activeIds.length === 0) return;

    let projectIds: string[] = [];
    let bundleName = "";

    if (playlistTab === "project") {
      projectIds = [...new Set(selectedProjectsOrdered.map((s) => s.design_project_id).filter(Boolean))];
      bundleName = selectedProjectsOrdered.map((p) => p.name).join("+") || "project_schedules";
    } else {
      const { data } = await supabase
        .from("channel_allowed_projects")
        .select("design_project_id")
        .in("channel_id", selectedChannelIds);
      projectIds = (data || []).map((r) => r.design_project_id).filter(Boolean) as string[];
      if (projectIds.length === 0) {
        toast.error("所選頻道尚未關聯任何設計專案");
        return;
      }
      bundleName = selectedChannelsOrdered.map((c) => c.name).join("+") || "channels";
    }

    setDownloadingId("selected");
    const tId = toast.loading(t("publishDownloading") || "下載中…");
    try {
      const res = await exportDesignProjectsToZip({
        projectIds,
        bundleName,
        orgId: activeOrgId || null,
        userId: user?.id,
      });
      toast.success(
        (t("publishDownloadSuccess") || "下載完成 ({size} MB)").replace("{size}", (res.sizeBytes / (1024 * 1024)).toFixed(2)),
        { id: tId },
      );
    } catch (err) {
      toast.error(t("publishDownloadFailed") || "下載失敗", { id: tId });
      console.error("Download selected failed", err);
    } finally {
      setDownloadingId(null);
    }
  };

  // Publish action
  const handlePublish = async () => {
    if (license?.expired) { toast.error(t("licenseExpiredAction")); return; }
    if (!hasSelectedSource) { toast.error(t("publishSelectPlaylist")); return; }
    if (selectedScreenIds.size === 0) { toast.error(t("publishSelectScreen")); return; }
    if (publishMode === "scheduled" && !scheduledDate) { toast.error(t("publishSelectDate")); return; }

    setPublishing(true);
    const schedule = selectedSchedule;
    const projectsOrdered = selectedProjectsOrdered;
    const channelsOrdered = selectedChannelsOrdered;
    const sourceName = playlistTab === "channel"
      ? channelsOrdered.map((c, i) => `${i + 1}. ${c.name}`).join("，")
      : (projectsOrdered.length > 0
          ? projectsOrdered.map((p, i) => `${i + 1}. ${p.name}`).join("，")
          : schedule?.name ?? "");

    // Compute the per-screen UTC `scheduled_at` so that when admins schedule
    // for screens across multiple timezones, each screen plays at the right
    // local time (with DST handled correctly).
    const dateStr = scheduledDate
      ? `${scheduledDate.getFullYear()}-${String(scheduledDate.getMonth() + 1).padStart(2, "0")}-${String(scheduledDate.getDate()).padStart(2, "0")}`
      : "";
    const computeScheduledAt = (screen: ScreenOption | undefined): string | null => {
      if (publishMode !== "scheduled" || !scheduledDate) return null;
      const tz =
        scheduleTzMode === "local"
          ? screen?.timezone || browserTz
          : browserTz;
      try {
        return zonedDateTimeToUtc(dateStr, scheduledTime, tz).toISOString();
      } catch {
        // Fallback: treat as publisher-local if anything goes wrong.
        const [h, m] = scheduledTime.split(":").map(Number);
        const dt = new Date(scheduledDate);
        dt.setHours(h, m, 0, 0);
        return dt.toISOString();
      }
    };

    const inserts = Array.from(selectedScreenIds).flatMap((screenId) => {
      const screen = screens.find((s) => s.id === screenId);
      const baseStatus = publishMode === "now" ? "playing" : "scheduled";
      const scheduledAt = computeScheduledAt(screen);
      if (playlistTab === "channel") {
        return channelsOrdered.map((ch, idx) => ({
          schedule_id: null,
          channel_id: ch.id,
          screen_id: screenId,
          schedule_name: `${idx + 1}. ${ch.name}`,
          channel_name: ch.name,
          screen_name: screen?.name || "",
          status: baseStatus,
          scheduled_at: scheduledAt,
          published_by: user?.id,
        }));
      }
      return projectsOrdered.map((p, idx) => ({
        schedule_id: null,
        channel_id: null,
        screen_id: screenId,
        schedule_name: `${idx + 1}. ${p.name}`,
        channel_name: "",
        screen_name: screen?.name || "",
        status: baseStatus,
        scheduled_at: scheduledAt,
        published_by: user?.id,
      }));
    });

    const { error } = await supabase.from("publish_records").insert(inserts);
    if (error) {
      toast.error(error.message);
    } else {
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 2500);
      toast.success(publishMode === "now" ? t("publishSuccessNow") : t("publishSuccessScheduled"));
      logActivity({ action: publishMode === "now" ? "publish_now" : "publish_scheduled", category: "publish", actionParams: { count: selectedScreenIds.size } });
      // Write screen_logs per target screen, using each screen's local time
      // for the human-readable display so admins can audit accurately.
      const events = Array.from(selectedScreenIds)
        .map((sid) => {
          const sc = screens.find((s) => s.id === sid);
          if (!sc?.org_id) return null;
          const isNow = publishMode === "now";
          const utcAt = computeScheduledAt(sc);
          const screenTz = sc.timezone || browserTz;
          const display = isNow
            ? ""
            : utcAt
              ? formatInTz(new Date(utcAt), screenTz)
              : "";
          const detailSuffix = isNow
            ? "｜立即下發"
            : utcAt
              ? `｜預約：${display}`
              : "";
          return {
            screenId: sid,
            orgId: sc.org_id,
            eventType: "schedule" as const,
            eventCode: isNow ? "schedule.published_now" : "schedule.published_scheduled",
            eventParams: { scheduleName: sourceName, scheduledAt: display, timezone: screenTz },
            eventTitle: isNow ? "排程立即下發" : "排程已預約下發",
            eventDetail: `播放清單：${sourceName}${detailSuffix}`,
          };
        })
        .filter(Boolean) as Array<Parameters<typeof logScreenEvents>[0][number]>;
      logScreenEvents(events);
      setSelectedScheduleId(null);
      setSelectedProjectIds([]);
      setSelectedChannelIds([]);
      setSelectedScreenIds(new Set());
      setPublishMode("now");
      setScheduledDate(undefined);
      fetchData();
    }
    setPublishing(false);
  };

  // Emergency broadcast
  const handleEmergencyBroadcast = async () => {
    if (!emergencyMessage.trim()) { toast.error(t("emergencyFillMessage")); return; }
    setEmergencyPublishing(true);

    const inserts = screens.map((screen) => ({
      schedule_id: null,
      screen_id: screen.id,
      schedule_name: `🚨 ${t("emergencyTitle")}`,
      screen_name: screen.name,
      status: "emergency",
      scheduled_at: null,
      published_by: user?.id,
    }));

    const { error } = await supabase.from("publish_records").insert(inserts);
    if (error) {
      toast.error(error.message);
    } else {
      setShowEmergencySuccess(true);
      setTimeout(() => setShowEmergencySuccess(false), 3000);
      const events = screens
        .filter((s) => !!s.org_id)
        .map((s) => ({ screenId: s.id, orgId: s.org_id as string, eventType: "system" as const, eventCode: "system.emergency_broadcast", eventParams: { message: emergencyMessage.trim() }, eventTitle: "🚨 緊急廣播", eventDetail: emergencyMessage.trim() }));
      logScreenEvents(events);
      setEmergencyMessage("");
      setEmergencyOpen(false);
      setEmergencyConfirmOpen(false);
      fetchData();
    }
    setEmergencyPublishing(false);
  };

  // Restore normal playback
  const handleRestoreNormal = async () => {
    setRestoring(true);
    // Update all emergency records to "restored"
    const { error } = await supabase
      .from("publish_records")
      .update({ status: "restored" })
      .eq("status", "emergency");

    if (error) {
      toast.error(error.message);
    } else {
      setShowRestoreSuccess(true);
      setTimeout(() => setShowRestoreSuccess(false), 2500);
      toast.success(t("restoreNormalSuccess"));
      const events = screens
        .filter((s) => !!s.org_id)
        .map((s) => ({ screenId: s.id, orgId: s.org_id as string, eventType: "system" as const, eventCode: "system.restore_normal", eventParams: {}, eventTitle: "恢復正常播放", eventDetail: "已從緊急廣播恢復" }));
      logScreenEvents(events);
      setRestoreOpen(false);
      fetchData();
    }
    setRestoring(false);
  };

  const getStatusBadge = (status: string) => {
    if (status === "playing") return <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 gap-1"><Play className="w-3 h-3" />{t("publishStatusPlaying")}</Badge>;
    if (status === "scheduled") return <Badge variant="outline" className="gap-1 text-amber-600 border-amber-500/30 bg-amber-500/10"><Clock className="w-3 h-3" />{t("publishStatusScheduled")}</Badge>;
    if (status === "sending") return <Badge variant="outline" className="gap-1 text-blue-600 border-blue-500/30 bg-blue-500/10"><Loader2 className="w-3 h-3 animate-spin" />{t("publishStatusSending")}</Badge>;
    if (status === "emergency") return <Badge className="bg-red-500/15 text-red-600 border-red-500/30 gap-1 animate-pulse"><AlertTriangle className="w-3 h-3" />{t("publishStatusEmergency")}</Badge>;
    if (status === "restored") return <Badge variant="outline" className="gap-1 text-sky-600 border-sky-500/30 bg-sky-500/10"><RotateCcw className="w-3 h-3" />{t("restoreNormal")}</Badge>;
    return <Badge variant="secondary">{status}</Badge>;
  };

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <div className="space-y-6">
      {/* Success overlay */}
      {showSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="flex flex-col items-center gap-4 animate-in zoom-in-75 duration-500">
            <div className="w-24 h-24 rounded-full bg-emerald-500/15 flex items-center justify-center">
              <CheckCircle2 className="w-14 h-14 text-emerald-500 animate-in zoom-in-50 duration-700" />
            </div>
            <p className="text-xl font-bold text-foreground">{t("publishSuccessTitle")}</p>
            <p className="text-sm text-muted-foreground">{t("publishSuccessDesc")}</p>
          </div>
        </div>
      )}

      {/* Emergency success overlay */}
      {showEmergencySuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-red-950/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="flex flex-col items-center gap-4 animate-in zoom-in-75 duration-500">
            <div className="w-24 h-24 rounded-full bg-red-500/20 flex items-center justify-center animate-pulse">
              <ShieldAlert className="w-14 h-14 text-red-500 animate-in zoom-in-50 duration-700" />
            </div>
            <p className="text-xl font-bold text-white">{t("emergencyBroadcastSent")}</p>
            <p className="text-sm text-red-200">{t("emergencyBroadcastSentDesc")}</p>
          </div>
        </div>
      )}

      {/* Restore success overlay */}
      {showRestoreSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="flex flex-col items-center gap-4 animate-in zoom-in-75 duration-500">
            <div className="w-24 h-24 rounded-full bg-sky-500/15 flex items-center justify-center">
              <RotateCcw className="w-14 h-14 text-sky-500 animate-in zoom-in-50 duration-700" />
            </div>
            <p className="text-xl font-bold text-foreground">{t("restoreNormalSuccess")}</p>
            <p className="text-sm text-muted-foreground">{t("restoreNormalSuccessDesc")}</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
            <Send className="w-8 h-8 text-primary" />
            {t("publishTitle")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("publishSubtitle")}</p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2 flex-wrap">
            {orgs.length > 1 && (
              <Select value={filterOrgId} onValueChange={setFilterOrgId}>
                <SelectTrigger className="w-[180px] h-9">
                  <Building2 className="w-4 h-4 mr-1.5 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("orgFilterAll")}</SelectItem>
                  {orgs.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                  <SelectItem value="none">{t("publishUnassigned")}</SelectItem>
                </SelectContent>
              </Select>
            )}
            {hasActiveEmergency && (
              <Button
                variant="outline"
                className="gap-2 font-bold border-sky-500/40 text-sky-600 hover:bg-sky-500/10 hover:text-sky-700 shadow-lg shadow-sky-600/10"
                onClick={() => setRestoreOpen(true)}
              >
                <RotateCcw className="w-4 h-4" />
                {t("restoreNormal")}
              </Button>
            )}
            <Button
              variant="destructive"
              className="gap-2 shadow-lg shadow-red-600/20 font-bold"
              onClick={() => setEmergencyOpen(true)}
            >
              <AlertTriangle className="w-4 h-4" />
              {t("emergencyBroadcast")}
            </Button>
          </div>
        )}
      </div>

      {/* Main 3-column layout */}
      <Tabs defaultValue="publish" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="publish" className="gap-1.5">
            <Send className="w-3.5 h-3.5" />
            {t("publishTabPublish")}
          </TabsTrigger>
          <TabsTrigger value="triggers" className="gap-1.5">
            <Zap className="w-3.5 h-3.5" />
            {t("publishTabSmartTriggers")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="triggers" className="mt-4">
          <SmartTriggerPanel />
        </TabsContent>

        <TabsContent value="publish" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left: Playlist selection */}
        <Card className="lg:col-span-3 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <ListMusic className="w-4 h-4 text-primary" />
              {t("publishPlaylist")}
            </h2>
            <button
              type="button"
              onClick={() => setTriggerDialogOpen(true)}
              title={t("studioPageTransitionConfigure")}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border rounded-md px-2 py-1 hover:bg-muted/50 transition-colors"
            >
              <Settings2 className="w-3.5 h-3.5" />
              {t("studioPageTransitionTrigger")}
            </button>
          </div>
          <Separator />
          <Tabs value={playlistTab} onValueChange={(v) => setPlaylistTab(v as PlaylistTab)} className="w-full">
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="project" className="gap-1.5">
                <LayoutTemplate className="w-3.5 h-3.5" />
                {t("publishTabDesignProject")}
                {selectedProjectIds.length > 0 && (
                  <Badge variant="default" className="ml-1 h-4 px-1.5 text-[10px]">
                    {selectedProjectIds.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="channel" className="gap-1.5">
                <Tv className="w-3.5 h-3.5" />
                {t("publishTabChannel")}
                {selectedChannelIds.length > 0 && (
                  <Badge variant="default" className="ml-1 h-4 px-1.5 text-[10px]">
                    {selectedChannelIds.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            {/* Channels tab */}
            <TabsContent value="channel" className="space-y-1.5 max-h-[400px] overflow-y-auto mt-3">
              {filteredChannels.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">{t("publishNoChannels")}</p>
              ) : filteredChannels.map((c) => {
                const orderIdx = selectedChannelIds.indexOf(c.id);
                const isSelected = orderIdx >= 0;
                return (
                  <div
                    key={c.id}
                    onClick={() =>
                      setSelectedChannelIds((prev) =>
                        prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id],
                      )
                    }
                    className={cn(
                      "group relative w-full text-left p-3 rounded-lg border transition-all duration-200 cursor-pointer",
                      isSelected
                        ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                        : "border-border hover:border-primary/40 hover:bg-muted/50",
                      !c.enabled && "opacity-60",
                    )}
                  >
                    {isSelected && (
                      <span className="absolute -left-2 top-1/2 -translate-y-1/2 h-5 px-2 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold flex items-center justify-center shadow-sm z-10">
                        CH{orderIdx + 1}
                      </span>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                      <p className="text-sm font-medium text-foreground truncate">{c.name}</p>
                      {c.team_name && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-0.5 shrink-0">
                          <Users className="h-2.5 w-2.5" />
                          {c.team_name === "Default" ? t("teamNoTeamLabel") : c.team_name}
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-0.5 shrink-0">
                        {c.collab_scope === "team" ? <Users className="h-2.5 w-2.5" /> : c.collab_scope === "org" ? <Building2 className="h-2.5 w-2.5" /> : <UserIcon className="h-2.5 w-2.5" />}
                        {c.collab_scope === "team" ? t("channelCollabTeam") : c.collab_scope === "org" ? t("channelCollabOrg") : t("channelCollabCreator")}
                      </Badge>
                      <span className="flex-1" />
                      {!c.enabled && <Badge variant="outline" className="text-[10px] py-0">{t("offline")}</Badge>}
                    </div>
                  </div>
                );
              })}
            </TabsContent>

            {/* Design Projects tab — wraps existing schedule list */}
            <TabsContent value="project" className="mt-3">
              <div className="relative mb-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchProject}
                  onChange={(e) => setSearchProject(e.target.value)}
                  placeholder={t("publishSearchProjects")}
                  className="pl-9 h-9"
                />
              </div>
              <div className="space-y-1.5 max-h-[360px] overflow-y-auto">
              {filteredDesignProjects.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">{t("publishNoPlaylists")}</p>
              ) : filteredDesignProjects.map((s) => {
                const orderIdx = selectedProjectIds.indexOf(s.id);
                const isSelected = orderIdx >= 0;
                const timeInfo = s.block_type === "calendar"
                  ? s.start_at && s.end_at
                    ? `${new Date(s.start_at).toLocaleDateString()} – ${new Date(s.end_at).toLocaleDateString()}`
                    : null
                  : s.start_time && s.end_time
                    ? `${s.start_time.slice(0, 5)} – ${s.end_time.slice(0, 5)}`
                    : null;
                return (
                <div
                  key={s.id}
                  onClick={() =>
                    setSelectedProjectIds((prev) =>
                      prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id],
                    )
                  }
                  className={cn(
                    "group relative w-full text-left p-3 rounded-lg border transition-all duration-200 cursor-pointer",
                    isSelected
                      ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                      : "border-border hover:border-primary/40 hover:bg-muted/50",
                  )}
                >
                  {isSelected && (
                    <span className="absolute -left-2 top-1/2 -translate-y-1/2 h-5 px-2 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold flex items-center justify-center shadow-sm z-10">
                      {orderIdx + 1}
                    </span>
                  )}
                  <div className="flex items-start gap-2">
                    <div className="mt-0.5 flex-shrink-0">
                      {s.block_type === "calendar"
                        ? <CalendarIcon className="h-4 w-4" style={{ color: s.color }} />
                        : <Repeat className="h-4 w-4" style={{ color: s.color }} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{s.name}</p>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground flex-wrap">
                        {s.design_project_name && (
                          <span className="truncate">{s.design_project_name}</span>
                        )}
                        {timeInfo && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">{timeInfo}</Badge>
                        )}
                        {s.block_type === "weekly" && s.weekdays.length > 0 && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                            {s.weekdays.join("、")}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                );
              })}
              </div>
            </TabsContent>
          </Tabs>

          {/* Download button — styled like right-panel publish cards */}
          <Separator />
          <button
            onClick={handleDownloadSelected}
            disabled={!hasSelectedSource || !!downloadingId}
            className={cn(
              "relative w-full p-5 rounded-xl border-2 transition-all duration-300 text-center group",
              hasSelectedSource && !downloadingId
                ? "border-sky-500 bg-sky-500/5 ring-2 ring-sky-500/20 shadow-lg shadow-sky-500/10 cursor-pointer"
                : "border-border opacity-50 cursor-not-allowed",
            )}
          >
            <div className={cn(
              "w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center transition-all",
              hasSelectedSource && !downloadingId
                ? "bg-sky-500 text-white scale-110"
                : "bg-muted text-muted-foreground",
            )}>
              {downloadingId === "selected"
                ? <Loader2 className="w-6 h-6 animate-spin" />
                : <Download className="w-6 h-6" />
              }
            </div>
            <p className={cn("font-bold text-base", hasSelectedSource && !downloadingId ? "text-sky-600" : "text-foreground")}>
              {"下載 (USB 同步)"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {"打包媒體 ZIP，存入隨身碟供本地播放器使用"}
            </p>
          </button>
        </Card>

        {/* Middle: Target screens */}
        <Card className="lg:col-span-4 p-4 space-y-3">
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            <Monitor className="w-4 h-4 text-primary" />
            {t("publishTargetScreens")}
            {selectedScreenIds.size > 0 && (
              <Badge variant="default" className="ml-auto">{selectedScreenIds.size}</Badge>
            )}
          </h2>
          <Separator />
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchScreen}
              onChange={(e) => setSearchScreen(e.target.value)}
              placeholder={t("publishSearchScreens")}
              className="pl-9 h-9"
            />
          </div>
          {/* Select all */}
          <div className="flex items-center gap-2 px-1">
            <Checkbox
              checked={allSelected}
              onCheckedChange={toggleAll}
              id="select-all"
            />
            <label htmlFor="select-all" className="text-sm font-medium text-foreground cursor-pointer">
              {t("publishSelectAll")}
            </label>
            <span className="text-xs text-muted-foreground ml-auto">{filteredScreens.length} {t("publishScreensTotal")}</span>
          </div>
          <Separator />
          <div className="space-y-3 max-h-[340px] overflow-y-auto">
            {Array.from(groupedScreens.entries()).map(([group, groupScreens]) => {
              const groupAllSelected = groupScreens.every((s) => selectedScreenIds.has(s.id));
              const groupSomeSelected = groupScreens.some((s) => selectedScreenIds.has(s.id));
              return (
                <div key={group}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <Checkbox
                      checked={groupAllSelected}
                      onCheckedChange={() => toggleGroup(groupScreens)}
                      className={groupSomeSelected && !groupAllSelected ? "data-[state=unchecked]:bg-primary/20" : ""}
                    />
                    <Layers className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{group}</span>
                    <Badge variant="outline" className="text-[10px] ml-auto">{groupScreens.length}</Badge>
                  </div>
                  <div className="space-y-0.5 pl-6">
                    {groupScreens.map((s) => (
                      <label
                        key={s.id}
                        className={cn(
                          "flex items-center gap-2.5 p-2 rounded-md cursor-pointer transition-colors",
                          selectedScreenIds.has(s.id) ? "bg-primary/5" : "hover:bg-muted/50"
                        )}
                      >
                        <Checkbox
                          checked={selectedScreenIds.has(s.id)}
                          onCheckedChange={() => toggleScreen(s.id)}
                        />
                        <span className="text-sm text-foreground truncate flex-1">{s.name}</span>
                        <span className={cn(
                          "w-2 h-2 rounded-full shrink-0",
                          s.online ? "bg-emerald-500" : "bg-muted-foreground/30"
                        )} />
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Right: Publish actions */}
        <Card className="lg:col-span-5 p-4 space-y-4">
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            {t("publishActions")}
          </h2>
          <Separator />

          {/* Summary */}
          <div className="rounded-lg bg-muted/50 p-3 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t("publishPlaylist")}：</span>
              <span className="font-medium text-foreground truncate max-w-[60%] text-right">
                {selectedSourceName ?? <span className="text-muted-foreground italic">{t("publishNotSelected")}</span>}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t("publishTargetScreens")}：</span>
              <span className="font-medium text-foreground">
                {selectedScreenIds.size > 0 ? `${selectedScreenIds.size} ${t("publishScreensSelected")}` : <span className="text-muted-foreground italic">{t("publishNotSelected")}</span>}
              </span>
            </div>
          </div>

          {/* Mode buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setPublishMode("now")}
              className={cn(
                "relative p-5 rounded-xl border-2 transition-all duration-300 text-center group",
                publishMode === "now"
                  ? "border-emerald-500 bg-emerald-500/5 ring-2 ring-emerald-500/20 shadow-lg shadow-emerald-500/10"
                  : "border-border hover:border-emerald-500/50 hover:bg-emerald-500/5"
              )}
            >
              <div className={cn(
                "w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center transition-all",
                publishMode === "now" ? "bg-emerald-500 text-white scale-110" : "bg-muted text-muted-foreground group-hover:bg-emerald-500/20 group-hover:text-emerald-600"
              )}>
                <Zap className="w-6 h-6" />
              </div>
              <p className={cn("font-bold text-base", publishMode === "now" ? "text-emerald-600" : "text-foreground")}>
                {t("publishNow")}
              </p>
              <p className="text-xs text-muted-foreground mt-1">{t("publishNowDesc")}</p>
            </button>

            <button
              onClick={() => setPublishMode("scheduled")}
              className={cn(
                "relative p-5 rounded-xl border-2 transition-all duration-300 text-center group",
                publishMode === "scheduled"
                  ? "border-amber-500 bg-amber-500/5 ring-2 ring-amber-500/20 shadow-lg shadow-amber-500/10"
                  : "border-border hover:border-amber-500/50 hover:bg-amber-500/5"
              )}
            >
              <div className={cn(
                "w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center transition-all",
                publishMode === "scheduled" ? "bg-amber-500 text-white scale-110" : "bg-muted text-muted-foreground group-hover:bg-amber-500/20 group-hover:text-amber-600"
              )}>
                <CalendarClock className="w-6 h-6" />
              </div>
              <p className={cn("font-bold text-base", publishMode === "scheduled" ? "text-amber-600" : "text-foreground")}>
                {t("publishScheduled")}
              </p>
              <p className="text-xs text-muted-foreground mt-1">{t("publishScheduledDesc")}</p>
            </button>
          </div>

          {/* Scheduled options */}
          {publishMode === "scheduled" && (
            <div className="space-y-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 animate-in slide-in-from-top-2 duration-300">
              <Label className="text-sm font-medium">{t("publishScheduleDate")}</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !scheduledDate && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {scheduledDate ? format(scheduledDate, "yyyy/MM/dd") : t("publishPickDate")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={scheduledDate}
                    onSelect={setScheduledDate}
                    disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">{t("publishScheduleTime")}</Label>
                <Input
                  type="time"
                  value={scheduledTime}
                  onChange={(e) => setScheduledTime(e.target.value)}
                  className="w-full"
                />
              </div>
              {/* Timezone interpretation */}
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">
                  {t("publishTzModeLabel")}
                </Label>
                <Select
                  value={scheduleTzMode}
                  onValueChange={(v) => setScheduleTzMode(v as "local" | "instant")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="local">{t("publishTzModeLocal")}</SelectItem>
                    <SelectItem value="instant">
                      {t("publishTzModeInstant").replace("{tz}", browserTz)}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  {scheduleTzMode === "local"
                    ? t("publishTzModeLocalHint")
                    : t("publishTzModeInstantHint")}
                </p>
              </div>

              {/* Per-screen preview */}
              {scheduledDate && selectedScreenIds.size > 0 ? (
                <div className="space-y-1 rounded-md border border-border bg-background/40 p-2 max-h-40 overflow-y-auto">
                  <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                    {t("publishTzPreviewTitle")}
                  </div>
                  {Array.from(selectedScreenIds).slice(0, 12).map((sid) => {
                    const sc = screens.find((s) => s.id === sid);
                    if (!sc) return null;
                    const tz = scheduleTzMode === "local" ? sc.timezone || browserTz : browserTz;
                    const dateStr = `${scheduledDate.getFullYear()}-${String(
                      scheduledDate.getMonth() + 1,
                    ).padStart(2, "0")}-${String(scheduledDate.getDate()).padStart(2, "0")}`;
                    let display = "—";
                    try {
                      const utc = zonedDateTimeToUtc(dateStr, scheduledTime, tz);
                      display = formatInTz(utc, sc.timezone || tz);
                    } catch { /* ignore */ }
                    return (
                      <div key={sid} className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="truncate">{sc.name}</span>
                        <span className="text-muted-foreground tabular-nums">{display}</span>
                      </div>
                    );
                  })}
                  {selectedScreenIds.size > 12 ? (
                    <div className="text-[11px] text-muted-foreground">
                      +{selectedScreenIds.size - 12} …
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}

          {/* Publish button */}
          {isAdmin && (
            <Button
              onClick={handlePublish}
              disabled={publishing || !selectedScheduleId || selectedScreenIds.size === 0}
              className={cn(
                "w-full h-14 text-lg font-bold gap-3 transition-all duration-300",
                publishMode === "now"
                  ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/25"
                  : "bg-amber-600 hover:bg-amber-700 text-white shadow-lg shadow-amber-600/25"
              )}
            >
              {publishing ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : publishMode === "now" ? (
                <Send className="w-5 h-5" />
              ) : (
                <CalendarClock className="w-5 h-5" />
              )}
              {publishMode === "now" ? t("publishNowBtn") : t("publishScheduledBtn")}
            </Button>
          )}
        </Card>
      </div>

      {/* Publish Records */}
      <Card className="p-4 space-y-3">
        <h2 className="font-semibold text-foreground flex items-center gap-2">
          <CheckCheck className="w-4 h-4 text-primary" />
          {t("publishRecords")}
        </h2>
        <Separator />
        {records.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">{t("publishNoRecords")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-left">
                  <th className="py-2 pr-4 font-medium">{t("publishRecordPlaylist")}</th>
                  <th className="py-2 pr-4 font-medium">{t("publishRecordScreen")}</th>
                  <th className="py-2 pr-4 font-medium">{t("publishRecordStatus")}</th>
                  <th className="py-2 pr-4 font-medium">{t("publishRecordTime")}</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} className="border-b border-border/40 last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="py-2.5 pr-4">
                      <span className="flex items-center gap-2">
                        {r.status === "emergency" ? <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" /> : <ListMusic className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                        <span className={cn("font-medium", r.status === "emergency" ? "text-red-600" : "text-foreground")}>{r.schedule_name}</span>
                      </span>
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className="flex items-center gap-2">
                        <Monitor className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="text-foreground">{r.screen_name}</span>
                      </span>
                    </td>
                    <td className="py-2.5 pr-4">{getStatusBadge(r.status)}</td>
                    <td className="py-2.5 pr-4 text-muted-foreground whitespace-nowrap">
                      {r.scheduled_at
                        ? format(new Date(r.scheduled_at), "yyyy/MM/dd HH:mm")
                        : format(new Date(r.created_at), "yyyy/MM/dd HH:mm")
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
        </TabsContent>
      </Tabs>

      {/* Playlist Trigger Switching Dialog */}
      <Dialog open={triggerDialogOpen} onOpenChange={setTriggerDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("studioPageTransitionTitle")}</DialogTitle>
            <DialogDescription>{t("studioPageTransitionTriggerDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Trigger mode indicator */}
            <div className="p-3 rounded-md border border-primary bg-primary/5">
              <div className="text-sm font-medium">{t("studioPageTransitionTrigger")}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{t("studioPageTransitionTriggerDesc")}</div>
            </div>

            {/* Trigger sources */}
            <div className="space-y-2">
              <span className="text-xs font-medium">{t("studioPageTransitionTriggers")}</span>
              <div className="space-y-2 rounded-md border border-border p-3">
                {([
                  { k: "gpio" as const, label: t("studioPageTriggerGpio") },
                  { k: "remote" as const, label: t("studioPageTriggerRemote") },
                  { k: "api" as const, label: t("studioPageTriggerApi") },
                ]).map((row) => (
                  <div key={row.k} className="flex items-center justify-between">
                    <span className="text-sm">{row.label}</span>
                    <Switch
                      checked={!!playlistTrigger[row.k]}
                      onCheckedChange={(v) => setPlaylistTrigger((cur) => ({ ...cur, [row.k]: v }))}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Channel assignment */}
            {(playlistTrigger.gpio || playlistTrigger.remote) && selectedProjectsOrdered.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-xs font-medium">{t("studioPageTriggerChannels")}</span>
                <div className="rounded-md border border-border divide-y divide-border text-xs">
                  {selectedProjectsOrdered.map((s, i) => (
                    <div key={s.id} className="flex items-center justify-between px-3 py-1.5">
                      <span className="font-medium truncate max-w-[160px]">{s.name}</span>
                      <span className="text-muted-foreground tabular-nums flex gap-2 shrink-0">
                        {playlistTrigger.gpio && <span>GPIO {i}</span>}
                        {playlistTrigger.remote && <span>{t("studioPageTriggerRemoteCode")} {String(i + 1).padStart(2, "0")}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="text-[11px] text-muted-foreground border-t border-border pt-2">
              {t("studioPageTransitionFallback")}
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => { setTriggerDialogOpen(false); toast.success(t("studioPageTransitionSaved")); }}>
              {t("studioPageTransitionDone")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Emergency Broadcast Dialog */}
      <AlertDialog open={emergencyOpen} onOpenChange={setEmergencyOpen}>
        <AlertDialogContent className="border-red-500/30 sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <ShieldAlert className="w-6 h-6" />
              {t("emergencyTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("emergencyDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg border-2 border-red-500/20 bg-red-500/5 p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-red-600">
                <AlertTriangle className="w-4 h-4" />
                {t("emergencyWarning")}
              </div>
              <ul className="text-xs text-muted-foreground space-y-1 pl-6 list-disc">
                <li>{t("emergencyWarning1")}</li>
                <li>{t("emergencyWarning2")}</li>
                <li>{t("emergencyWarning3")}</li>
              </ul>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">{t("emergencyMessage")}</Label>
              <Textarea
                value={emergencyMessage}
                onChange={(e) => setEmergencyMessage(e.target.value)}
                placeholder={t("emergencyMessagePlaceholder")}
                className="min-h-[100px] border-red-500/20 focus-visible:ring-red-500/30"
              />
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("emergencyAffectedScreens")}：</span>
                <span className="font-bold text-red-600">{t("emergencyAllScreens")} ({screens.length} {t("publishScreensTotal")})</span>
              </div>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <Button
              variant="destructive"
              className="gap-2 font-bold"
              disabled={!emergencyMessage.trim()}
              onClick={() => setEmergencyConfirmOpen(true)}
            >
              <AlertTriangle className="w-4 h-4" />
              {t("emergencyConfirmBtn")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Emergency double confirm */}
      <AlertDialog open={emergencyConfirmOpen} onOpenChange={setEmergencyConfirmOpen}>
        <AlertDialogContent className="border-red-500/50">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-600 flex items-center gap-2">
              <ShieldAlert className="w-5 h-5" />
              {t("emergencyDoubleConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-red-500 font-medium">
              {t("emergencyDoubleConfirmDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleEmergencyBroadcast}
              disabled={emergencyPublishing}
              className="bg-red-600 hover:bg-red-700 text-white gap-2 font-bold"
            >
              {emergencyPublishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldAlert className="w-4 h-4" />}
              {t("emergencyExecute")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Restore Normal Dialog */}
      <AlertDialog open={restoreOpen} onOpenChange={setRestoreOpen}>
        <AlertDialogContent className="border-sky-500/30 sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-sky-600">
              <RotateCcw className="w-6 h-6" />
              {t("restoreNormalTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("restoreNormalDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-lg bg-sky-500/5 border border-sky-500/20 p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t("emergencyAffectedScreens")}：</span>
              <span className="font-bold text-sky-600">
                {records.filter((r) => r.status === "emergency").length} {t("publishScreensTotal")}
              </span>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRestoreNormal}
              disabled={restoring}
              className="bg-sky-600 hover:bg-sky-700 text-white gap-2 font-bold"
            >
              {restoring ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
              {t("restoreNormalConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SchedulePreviewDialog
        open={!!previewSchedule}
        onOpenChange={(o) => { if (!o) setPreviewSchedule(null); }}
        scheduleId={previewSchedule?.id ?? null}
        scheduleName={previewSchedule?.name ?? ""}
        orgId={previewSchedule?.org_id ?? null}
      />
    </div>
  );
}
