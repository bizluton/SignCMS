import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Monitor, Plus, Pencil, Trash2, Search, MapPin, Loader2, FolderPlus, Layers, MoreHorizontal, Settings, RotateCw, Power, RefreshCw, Eye, Moon, Play, Brush, FileText, Radio, Wifi, Cable, ArrowUpDown, SlidersHorizontal, X, WifiOff, Zap, TerminalSquare, ShieldOff, LayoutGrid, Copy, Check } from "lucide-react";
import { Tv } from "lucide-react";
import type { ScreenDetailScreen } from "@/components/screens/ScreenDetailDrawer";
import { ScreenChannelDialog } from "@/components/screens/ScreenChannelDialog";
import { ConnectionInfo } from "@/components/screens/ConnectionInfo";
import { isScreenUnlicensed } from "@/lib/screenConnectionVisibility";
import { ScreenSmartTriggerDialog } from "@/components/screens/ScreenSmartTriggerDialog";
import { TriggerTestConsoleDialog } from "@/components/screens/TriggerTestConsoleDialog";
import { ScreenDetailDrawer } from "@/components/screens/ScreenDetailDrawer";
import { ScreenHealthExportDialog } from "@/components/screens/ScreenHealthExportDialog";
import { ScreenHealthScheduleDialog } from "@/components/screens/ScreenHealthScheduleDialog";
import { useOrgPlan, PLAN_LABELS } from "@/hooks/useOrgPlan";
import { PlanUsageBar } from "@/components/PlanUsageBar";
import { useUserRole } from "@/hooks/useUserRole";
import { useUserOrgs } from "@/hooks/useUserOrgs";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";
import { supabase } from "@/integrations/supabase/client";
import { translatePlanLimitError } from "@/lib/planLimitError";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { logActivity } from "@/lib/activityLogger";
import { logScreenEvent, logScreenEvents } from "@/lib/screenLogger";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScreenLogPanel } from "@/components/ScreenLogPanel";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PageSkeleton } from "@/components/PageSkeleton";

const UNGROUPED = "__ungrouped__";

interface Screen {
  id: string;
  name: string;
  branch: string;
  location: string;
  resolution: string;
  online: boolean;
  org_id?: string | null;
  team_id?: string | null;
  serial_number?: string;
  ip_address?: string;
  connection_type?: string;
  avg_upload_speed?: string;
  avg_download_speed?: string;
  firmware_version?: string;
  updated_at?: string;
}

const emptyForm = { name: "", branch: "", location: "", resolution: "1920×1080", org_id: "", team_id: "", serial_number: "", ip_address: "", connection_type: "wired", avg_upload_speed: "", avg_download_speed: "", firmware_version: "" };

export default function ScreensPage() {
  const { isAdmin: isSysAdmin, isOrgAdmin } = useUserRole();
  const isAdmin = isSysAdmin || isOrgAdmin;
  const { t, language } = useLanguage();
  const { tier, limits } = useOrgPlan();
  const { user } = useAuth();
  const { orgs, defaultOrgId } = useUserOrgs();
  const { activeOrgId } = useActiveOrg();
  const [screens, setScreens] = useState<Screen[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const statusFilter = searchParams.get("status"); // "offline" | "online" | "alerts" | null
  const setStatusFilter = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === "all") next.delete("status");
    else next.set("status", value);
    setSearchParams(next, { replace: true });
  };
  const [alertedScreenIds, setAlertedScreenIds] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  // ── Web Player self-setup ──────────────────────────────────────────────
  const [wpDialogOpen, setWpDialogOpen] = useState(false);
  const [wpName, setWpName]             = useState("");
  const [wpOrgId, setWpOrgId]           = useState("");
  const [wpSaving, setWpSaving]         = useState(false);
  const [wpCode, setWpCode]             = useState<string | null>(null);
  const [wpCodeId, setWpCodeId]         = useState<string | null>(null);
  const [wpActivated, setWpActivated]   = useState(false);
  const [wpCopied, setWpCopied]         = useState(false);

  // ── Guard: warn before reload when add/edit dialog has unsaved changes ────
  const dialogOpenRef = useRef(false);
  const formRef = useRef(emptyForm);
  const licenseInfoRef = useRef<typeof licenseInfo | null>(null);
  useEffect(() => { dialogOpenRef.current = dialogOpen; }, [dialogOpen]);
  useEffect(() => { formRef.current = form; }, [form]);
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dialogOpenRef.current) return;
      const f = formRef.current;
      const hasData = f.name.trim() || f.location.trim() || f.branch.trim() || licenseInfoRef.current;
      if (!hasData) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // Device license verification (only used when adding a new screen)
  const [licenseCode, setLicenseCode] = useState("");
  const [licenseChecking, setLicenseChecking] = useState(false);
  const [licenseError, setLicenseError] = useState<string | null>(null);
  const [licenseInfo, setLicenseInfo] = useState<
    | null
    | { device_model: string; device_serial: string; org_id: string; org_name?: string }
  >(null);
  useEffect(() => { licenseInfoRef.current = licenseInfo; }, [licenseInfo]);

  // Dynamic groups
  const [groups, setGroups] = useState<string[]>([]);
  const [newGroupDialogOpen, setNewGroupDialogOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [isCreatingInForm, setIsCreatingInForm] = useState(false);
  const [inlineNewGroup, setInlineNewGroup] = useState("");

  // Teams (scoped to selected org in form)
  const [teams, setTeams] = useState<{ id: string; name: string; org_id: string }[]>([]);

  // Group rename
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState("");
  const [renameValue, setRenameValue] = useState("");

  // Screen settings
  const [settingsScreen, setSettingsScreen] = useState<Screen | null>(null);
  const [settingsForm, setSettingsForm] = useState({
    ipMode: "dhcp",
    ipAddress: "",
    subnet: "255.255.255.0",
    gateway: "",
    dns: "8.8.8.8",
    ntpServer: "pool.ntp.org",
    rotation: "0",
    scheduleEnabled: false,
    scheduleOn: "08:00",
    scheduleOff: "22:00",
    defaultPlayback: "sleep" as "sleep" | "media" | "design",
    defaultMediaId: "",
    defaultDesignId: "",
  });
  const [rebootConfirmOpen, setRebootConfirmOpen] = useState(false);
  const [mediaOptions, setMediaOptions] = useState<{ id: string; name: string; type: string }[]>([]);
  const [designOptions, setDesignOptions] = useState<{ id: string; name: string }[]>([]);

  // Network speed thresholds (persisted in localStorage)
  const [uploadThreshold, setUploadThreshold] = useState(() => {
    const saved = localStorage.getItem("screen_upload_threshold");
    return saved ? parseFloat(saved) : 10;
  });
  const [downloadThreshold, setDownloadThreshold] = useState(() => {
    const saved = localStorage.getItem("screen_download_threshold");
    return saved ? parseFloat(saved) : 20;
  });

  const saveThresholds = (up: number, down: number) => {
    setUploadThreshold(up);
    setDownloadThreshold(down);
    localStorage.setItem("screen_upload_threshold", String(up));
    localStorage.setItem("screen_download_threshold", String(down));
    toast.success(t("screensThresholdUpdated"));
  };

  // IoT extension
  const [iotScreen, setIotScreen] = useState<Screen | null>(null);
  const [iotDevices, setIotDevices] = useState<{ id: string; name: string; device_type: string; status: string }[]>([]);
  const [iotLoading, setIotLoading] = useState(false);
  const [addIotOpen, setAddIotOpen] = useState(false);
  const [newIotDevice, setNewIotDevice] = useState({ name: "", type: "air_quality" });
  const [iotSaving, setIotSaving] = useState(false);

  // Channel subscription & triggers dialog
  const [channelDialogScreen, setChannelDialogScreen] = useState<Screen | null>(null);

  // Smart Triggers dialog (per-screen)
  const [smartTriggerScreen, setSmartTriggerScreen] = useState<Screen | null>(null);

  // Detail drawer (click-to-open from card)
  const [detailScreen, setDetailScreen] = useState<Screen | null>(null);

  // Trigger test console (page-level)
  const [testConsoleOpen, setTestConsoleOpen] = useState(false);

  // Auto-open trigger test console if URL hash contains a shared link
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash.includes("trigger-test=")) {
      setTestConsoleOpen(true);
    }
  }, []);

  // Fetch IoT devices when a screen is selected
  useEffect(() => {
    if (!iotScreen) return;
    const fetchIotDevices = async () => {
      setIotLoading(true);
      const { data, error } = await supabase.from("iot_devices").select("*").eq("screen_id", iotScreen.id).order("created_at", { ascending: true });
      if (error) toast.error(error.message);
      else setIotDevices(data || []);
      setIotLoading(false);
    };
    fetchIotDevices();
  }, [iotScreen]);

  // Fetch media & design projects for default playback selector,
  // and load the screen's current default_playback settings from DB
  useEffect(() => {
    if (!settingsScreen) return;
    const fetchOptions = async () => {
      const [mediaRes, designRes, screenRes] = await Promise.all([
        supabase.from("media_items").select("id, name, type").in("type", ["image", "video"]).is("deleted_at", null).order("created_at", { ascending: false }),
        supabase.from("design_projects").select("id, name").order("created_at", { ascending: false }),
        supabase.from("screens").select("default_playback, default_media_id, default_project_id, ntp_server, rotation").eq("id", settingsScreen.id).maybeSingle(),
      ]);
      setMediaOptions(mediaRes.data || []);
      setDesignOptions(designRes.data || []);
      // Populate form with current DB values
      if (screenRes.data) {
        const s = screenRes.data;
        const dbPlayback = s.default_playback ?? "sleep";
        // DB uses "project"; UI uses "design" — map accordingly
        const uiPlayback = dbPlayback === "project" ? "design" : dbPlayback as "sleep" | "media" | "design";
        setSettingsForm((prev) => ({
          ...prev,
          ntpServer:      s.ntp_server      ?? "pool.ntp.org",
          rotation:       String(s.rotation ?? 0),
          defaultPlayback: uiPlayback,
          defaultMediaId:  s.default_media_id  ?? "",
          defaultDesignId: s.default_project_id ?? "",
        }));
      }
    };
    fetchOptions();
  }, [settingsScreen]);

  // Save settings dialog → persists to screens table
  const handleSaveSettings = async () => {
    if (!settingsScreen) return;
    // Map UI "design" back to DB "project"
    const dbPlayback = settingsForm.defaultPlayback === "design" ? "project" : settingsForm.defaultPlayback;
    const { error } = await supabase.from("screens").update({
      ntp_server:         settingsForm.ntpServer || "pool.ntp.org",
      rotation:           parseInt(settingsForm.rotation) || 0,
      default_playback:   dbPlayback,
      default_media_id:   dbPlayback === "media"   ? settingsForm.defaultMediaId   || null : null,
      default_project_id: dbPlayback === "project" ? settingsForm.defaultDesignId  || null : null,
      updated_at:         new Date().toISOString(),
    }).eq("id", settingsScreen.id);
    if (error) { toast.error(error.message); return; }
    toast.success(t("screenSettingsSaved"));
    setSettingsScreen(null);
  };

  const [deleteGroupTarget, setDeleteGroupTarget] = useState<string | null>(null);

  const fetchScreens = async () => {
    setLoading(true);
    let query = supabase.from("screens").select("id, name, branch, location, resolution, online, org_id, team_id, serial_number, ip_address, connection_type, avg_upload_speed, avg_download_speed, firmware_version, updated_at").order("created_at", { ascending: true });
    if (activeOrgId) query = query.eq("org_id", activeOrgId);
    const { data, error } = await query;
    if (error) { toast.error(error.message); }
    else {
      setScreens(data || []);
      const uniqueGroups = Array.from(new Set((data || []).map((s: Screen) => s.branch).filter(Boolean))) as string[];
      setGroups((prev) => {
        const merged = new Set([...prev, ...uniqueGroups]);
        return Array.from(merged).sort();
      });
    }
    setLoading(false);
  };

  useEffect(() => { fetchScreens(); }, [activeOrgId]);

  // Fetch active alert screen ids (for "Alerts" filter chip)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let query = supabase
        .from("screen_alerts")
        .select("screen_id")
        .eq("status", "active");
      if (activeOrgId) query = query.eq("org_id", activeOrgId);
      const { data } = await query;
      if (cancelled) return;
      setAlertedScreenIds(new Set((data || []).map((r) => r.screen_id)));
    })();
    return () => { cancelled = true; };
  }, [activeOrgId, screens.length]);

  // Live status: subscribe to realtime updates on screens (online + updated_at)
  // Filter at the channel level to org_id so Supabase only delivers rows this
  // admin can see — avoids O(all_screens × all_admins) RLS fan-out.
  useEffect(() => {
    if (!activeOrgId) return;
    const channel = supabase
      .channel(`screens-live-status-${activeOrgId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "screens",
          filter: `org_id=eq.${activeOrgId}`,
        },
        (payload: { new: Record<string, unknown> }) => {
          const next = payload.new as Screen;
          if (!next?.id) return;
          setScreens((prev) =>
            prev.map((s) => (s.id === next.id ? { ...s, ...next } : s))
          );
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeOrgId]);

  // License status per screen (active | revoked | no_license)
  // Uses a single batch RPC instead of one call per screen to avoid N+1 overhead.
  const [licenseStatusByScreen, setLicenseStatusByScreen] = useState<Record<string, { licensed: boolean; status: string }>>({});
  const refreshLicenseStatuses = useCallback(async (ids: string[]) => {
    if (ids.length === 0) { setLicenseStatusByScreen({}); return; }
    const { data } = await supabase.rpc("check_screen_license_status_batch", {
      _screen_ids: ids,
    });
    const map: Record<string, { licensed: boolean; status: string }> = {};
    (data as Array<{ screen_id: string; licensed: boolean; status: string }> | null)?.forEach((row) => {
      map[row.screen_id] = { licensed: row.licensed, status: row.status || "unknown" };
    });
    setLicenseStatusByScreen(map);
  }, []);
  useEffect(() => {
    refreshLicenseStatuses(screens.map((s) => s.id));
  }, [screens.map((s) => s.id).join(","), refreshLicenseStatuses]);
  // Realtime: any device_license change → refresh statuses for currently shown screens.
  useEffect(() => {
    const channel = supabase
      .channel("screens-license-watch")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "device_licenses" },
        () => {
          refreshLicenseStatuses(screens.map((s) => s.id));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [screens.map((s) => s.id).join(","), refreshLicenseStatuses]);

  // Watch for device activating a web player setup code
  useEffect(() => {
    if (!wpCodeId) return;
    const ch = supabase
      .channel(`wp-code-${wpCodeId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "screen_activation_codes", filter: `id=eq.${wpCodeId}` },
        (payload: { new: Record<string, unknown> }) => {
          if (payload.new.status === "used") {
            setWpActivated(true);
            fetchScreens();
          }
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [wpCodeId]); // eslint-disable-line

  // Connected player (default channel + active project) per screen
  interface PlayerInfo { channel: string; project: string | null; }
  const [playerByScreen, setPlayerByScreen] = useState<Record<string, PlayerInfo>>({});
  useEffect(() => {
    if (screens.length === 0) { setPlayerByScreen({}); return; }
    let cancelled = false;
    (async () => {
      const ids = screens.map((s) => s.id);
      const { data } = await supabase
        .from("screen_channel_subscriptions")
        .select("screen_id, is_default, channels:channel_id(name, project:default_design_project_id(name))")
        .in("screen_id", ids);
      if (cancelled || !data) return;
      const map: Record<string, PlayerInfo> = {};
      // Prefer default subscription; otherwise first available
      data.forEach((row) => {
        const ch = row.channels as { name: string; project: { name: string } | null } | null;
        if (!ch?.name) return;
        if (row.is_default || !map[row.screen_id]) {
          map[row.screen_id] = {
            channel: ch.name,
            project: ch.project?.name ?? null,
          };
        }
      });
      setPlayerByScreen(map);
    })();
    return () => { cancelled = true; };
  }, [screens.map((s) => s.id).join(",")]);  // eslint-disable-line

  // Fetch teams (all visible) for team selector
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("teams").select("id, name, org_id");
      setTeams(data || []);
    })();
  }, [activeOrgId]);

  const ungroupedCount = screens.filter((s) => !s.branch).length;

  const filtered = screens.filter((s) => {
    const matchSearch = s.name.includes(search) || (s.branch || "").includes(search) || s.location.includes(search);
    if (statusFilter === "offline" && s.online) return false;
    if (statusFilter === "online" && !s.online) return false;
    if (statusFilter === "alerts" && !alertedScreenIds.has(s.id)) return false;
    if (groupFilter === "all") return matchSearch;
    if (groupFilter === UNGROUPED) return matchSearch && !s.branch;
    return matchSearch && s.branch === groupFilter;
  });

  const clearStatusFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("status");
    setSearchParams(next, { replace: true });
  };

  const openAdd = () => {
    setEditingId(null);
    setForm({ ...emptyForm, org_id: defaultOrgId || "" });
    setIsCreatingInForm(false);
    setInlineNewGroup("");
    setLicenseCode("");
    setLicenseError(null);
    setLicenseInfo(null);
    setDialogOpen(true);
  };
  const openEdit = (screen: Screen) => {
    setEditingId(screen.id);
    setForm({
      name: screen.name, branch: screen.branch || "", location: screen.location, resolution: screen.resolution, org_id: screen.org_id || "", team_id: screen.team_id || "",
      serial_number: screen.serial_number || "", ip_address: screen.ip_address || "", connection_type: screen.connection_type || "wired",
      avg_upload_speed: screen.avg_upload_speed || "", avg_download_speed: screen.avg_download_speed || "",
      firmware_version: screen.firmware_version || "",
    });
    setIsCreatingInForm(false);
    setInlineNewGroup("");
    setLicenseCode("");
    setLicenseError(null);
    setLicenseInfo(null);
    setDialogOpen(true);
  };

  const verifyLicenseCode = async () => {
    const code = licenseCode.trim();
    setLicenseError(null);
    if (!/^[0-9]{6}$/.test(code)) {
      setLicenseError({ zh: "請輸入 6 位數設備授權碼", en: "Enter a 6-digit device license code", ja: "6桁のデバイスライセンスコードを入力してください" }[language]);
      return;
    }
    setLicenseChecking(true);
    const { data, error } = await supabase.rpc("lookup_device_license_by_code", { _code: code });
    setLicenseChecking(false);
    if (error) {
      setLicenseError(error.message);
      return;
    }
    const result = data as Record<string, unknown> | null;
    if (!result?.valid) {
      const errMap: Record<string, { zh: string; en: string; ja: string }> = {
        not_found: { zh: "找不到此授權碼或不屬於您的組織", en: "License code not found or not in your organization", ja: "このライセンスコードは見つからないか、あなたの組織に属していません" },
        not_authorized: { zh: "找不到此授權碼或不屬於您的組織", en: "License code not found or not in your organization", ja: "このライセンスコードは見つからないか、あなたの組織に属していません" },
        revoked: { zh: "此授權碼已被撤銷", en: "This license code has been revoked", ja: "このライセンスコードは取り消されました" },
        invalid_code_format: { zh: "授權碼格式錯誤（須為 6 位數字）", en: "Invalid code format (must be 6 digits)", ja: "コード形式が無効です（6桁の数字）" },
        unauthenticated: { zh: "請先登入", en: "Please sign in", ja: "サインインしてください" },
      };
      const errKey = typeof result?.error === "string" ? result.error : "";
      const m = errMap[errKey] || { zh: errKey || "驗證失敗", en: errKey || "Verification failed", ja: errKey || "検証に失敗しました" };
      setLicenseError(m[language]);
      return;
    }
    const deviceModel = typeof result.device_model === "string" ? result.device_model : "";
    const deviceSerial = typeof result.device_serial === "string" ? result.device_serial : "";
    const orgId = typeof result.org_id === "string" ? result.org_id : "";
    const orgName = typeof result.org_name === "string" ? result.org_name : undefined;
    setLicenseInfo({
      device_model: deviceModel,
      device_serial: deviceSerial,
      org_id: orgId,
      org_name: orgName,
    });
    setForm((prev) => ({
      ...prev,
      serial_number: deviceSerial || "",
      org_id: orgId || prev.org_id,
    }));
    toast.success({ zh: "授權碼驗證成功", en: "License verified", ja: "ライセンス認証成功" }[language]);
  };

  const handleSave = async () => {
    const finalBranch = isCreatingInForm ? inlineNewGroup.trim() : form.branch;
    if (!form.name.trim()) { toast.error(t("screensFillRequired")); return; }
    // Block duplicate screen names within the same org (case-insensitive)
    const targetOrgForDup = (!editingId && licenseInfo?.org_id) || form.org_id || activeOrgId || defaultOrgId;
    const dupName = screens.some(
      (s) =>
        s.id !== editingId &&
        (s.org_id || "") === (targetOrgForDup || "") &&
        (s.name || "").trim().toLowerCase() === form.name.trim().toLowerCase(),
    );
    if (dupName) {
      toast.error({ zh: "螢幕名稱已存在", en: "Screen name already exists", ja: "スクリーン名は既に存在します" }[language]);
      return;
    }
    if (!editingId && !form.team_id) {
      toast.error({ zh: "請選擇所屬團隊", en: "Please select a team", ja: "チームを選択してください" }[language]);
      return;
    }
    // When adding a new screen, require a verified device license
    if (!editingId && !licenseInfo) {
      toast.error({ zh: "請先輸入並驗證設備授權碼", en: "Please enter and verify the device license code", ja: "デバイスライセンスコードを入力して確認してください" }[language]);
      return;
    }
    const resolvedOrgId = (!editingId && licenseInfo?.org_id) || form.org_id || activeOrgId || defaultOrgId;
    if (!resolvedOrgId) { toast.error(t("teamSelectOrg")); return; }
    setSaving(true);
    if (editingId) {
      const { error } = await supabase.from("screens").update({ name: form.name, branch: finalBranch || "", location: form.location, resolution: form.resolution, org_id: resolvedOrgId, team_id: form.team_id || null, serial_number: form.serial_number, ip_address: form.ip_address, connection_type: form.connection_type, avg_upload_speed: form.avg_upload_speed, avg_download_speed: form.avg_download_speed, firmware_version: form.firmware_version, updated_at: new Date().toISOString() }).eq("id", editingId);
      if (error) toast.error(error.message);
      else {
        toast.success(t("screensUpdated"));
        logActivity({ action: "edit_screen", category: "screen", targetName: form.name, targetId: editingId, orgId: resolvedOrgId });
        logScreenEvent({ screenId: editingId, orgId: resolvedOrgId, eventType: "config", eventCode: "screen.config_updated", eventParams: { name: form.name, branch: finalBranch || "(未分組)", location: form.location || "-", resolution: form.resolution || "-" }, eventTitle: "設定更新", eventDetail: `名稱：${form.name}｜分組：${finalBranch || "(未分組)"}｜位置：${form.location || "-"}｜解析度：${form.resolution || "-"}` });
      }
    } else {
      const { data: inserted, error } = await supabase.from("screens").insert({ name: form.name, branch: finalBranch || "", location: form.location, resolution: form.resolution, org_id: resolvedOrgId, team_id: form.team_id || null, uploaded_by: user?.id, serial_number: form.serial_number, ip_address: form.ip_address, connection_type: form.connection_type, avg_upload_speed: form.avg_upload_speed, avg_download_speed: form.avg_download_speed, firmware_version: form.firmware_version }).select("id").single();
      if (error) {
        toast.error(translatePlanLimitError(error, t));
        setSaving(false);
        return;
      }
      toast.success(t("screensAdded"));
      logActivity({ action: "create_screen", category: "screen", targetName: form.name, orgId: resolvedOrgId });
      if (inserted?.id) {
        logScreenEvent({ screenId: inserted.id, orgId: resolvedOrgId, eventType: "system", eventCode: "screen.created", eventParams: { name: form.name, branch: finalBranch || "(未分組)" }, eventTitle: "螢幕已建立", eventDetail: `名稱：${form.name}｜分組：${finalBranch || "(未分組)"}` });
      }
    }
    if (isCreatingInForm && inlineNewGroup.trim()) {
      setGroups((prev) => Array.from(new Set([...prev, inlineNewGroup.trim()])).sort());
    }
    setSaving(false);
    setDialogOpen(false);
    setIsCreatingInForm(false);
    setInlineNewGroup("");
    fetchScreens();
  };

  const handleDelete = async () => {
    if (deleteId) {
      const deleted = screens.find(s => s.id === deleteId);
      if (deleted?.org_id) {
        // Log BEFORE delete (FK constraint will cascade or block - log first)
        await logScreenEvent({ screenId: deleteId, orgId: deleted.org_id, eventType: "system", eventCode: "screen.deleted", eventParams: { name: deleted.name }, eventTitle: "螢幕已刪除", eventDetail: `名稱：${deleted.name}` });
      }
      const { error } = await supabase.from("screens").delete().eq("id", deleteId);
      if (error) toast.error(error.message);
      else {
        toast.success(t("screensDeleted"));
        logActivity({ action: "delete_screen", category: "screen", targetName: deleted?.name || "", targetId: deleteId });
        fetchScreens();
      }
      setDeleteId(null);
    }
  };

  const handleAddGroup = () => {
    const name = newGroupName.trim();
    if (!name) return;
    if (groups.includes(name)) { toast.error(t("screensGroupExists")); return; }
    setGroups((prev) => [...prev, name].sort());
    toast.success(t("screensGroupCreated"));
    setNewGroupName("");
    setNewGroupDialogOpen(false);
  };

  const handleRenameGroup = async () => {
    const newName = renameValue.trim();
    if (!newName || !renameTarget) return;
    if (newName === renameTarget) { setRenameDialogOpen(false); return; }
    if (groups.includes(newName)) { toast.error(t("screensGroupExists")); return; }
    // Update all screens with old group name
    const affected = screens.filter((s) => s.branch === renameTarget);
    const { error } = await supabase.from("screens").update({ branch: newName, updated_at: new Date().toISOString() }).eq("branch", renameTarget);
    if (error) { toast.error(error.message); return; }
    setGroups((prev) => prev.map((g) => g === renameTarget ? newName : g).sort());
    if (groupFilter === renameTarget) setGroupFilter(newName);
    toast.success(t("screensGroupRenamed"));
    setRenameDialogOpen(false);
    await logScreenEvents(
      affected
        .filter((s) => !!s.org_id)
        .map((s) => ({ screenId: s.id, orgId: s.org_id as string, eventType: "config" as const, eventCode: "screen.group_renamed", eventParams: { oldName: renameTarget, newName }, eventTitle: "分組已重新命名", eventDetail: `${renameTarget} → ${newName}` }))
    );
    fetchScreens();
  };

  const handleDeleteGroup = async () => {
    if (!deleteGroupTarget) return;
    const affected = screens.filter((s) => s.branch === deleteGroupTarget);
    // Set screens in this group to empty (ungrouped)
    const { error } = await supabase.from("screens").update({ branch: "", updated_at: new Date().toISOString() }).eq("branch", deleteGroupTarget);
    if (error) { toast.error(error.message); return; }
    setGroups((prev) => prev.filter((g) => g !== deleteGroupTarget));
    if (groupFilter === deleteGroupTarget) setGroupFilter("all");
    toast.success(t("screensGroupDeleted"));
    setDeleteGroupTarget(null);
    await logScreenEvents(
      affected
        .filter((s) => !!s.org_id)
        .map((s) => ({ screenId: s.id, orgId: s.org_id as string, eventType: "config" as const, eventCode: "screen.group_deleted", eventParams: { oldName: deleteGroupTarget }, eventTitle: "分組已刪除", eventDetail: `原分組：${deleteGroupTarget}（已改為未分組）` }))
    );
    fetchScreens();
  };

  // ── Web Player setup handlers ─────────────────────────────────────────
  const openWebPlayerSetup = () => {
    setWpName("");
    setWpOrgId(activeOrgId || defaultOrgId || orgs[0]?.id || "");
    setWpCode(null);
    setWpCodeId(null);
    setWpActivated(false);
    setWpCopied(false);
    setWpDialogOpen(true);
  };

  const handleWebPlayerCreate = async () => {
    if (!wpName.trim() || !wpOrgId) return;
    setWpSaving(true);
    try {
      for (let attempt = 0; attempt < 10; attempt++) {
        const code = String(Math.floor(100000 + Math.random() * 900000));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
          .from("screen_activation_codes")
          .insert({ name: wpName.trim(), org_id: wpOrgId, code })
          .select("id")
          .single();
        if (!error && data) {
          setWpCode(code);
          setWpCodeId((data as { id: string }).id);
          break;
        }
        if (error?.code !== "23505") {
          toast.error(`產生授權碼失敗：${error?.message}`);
          return;
        }
        // unique_violation → retry with new code
      }
    } finally {
      setWpSaving(false);
    }
  };

  const openRename = (group: string) => {
    setRenameTarget(group);
    setRenameValue(group);
    setRenameDialogOpen(true);
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 animate-fade-in">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">{t("screensTitle")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("screensSubtitle")}</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2 self-start">
            <Button variant="outline" onClick={() => setTestConsoleOpen(true)} className="gap-2" title="觸發測試控制台">
              <TerminalSquare className="w-4 h-4" />
              {{ zh: "觸發測試", en: "Trigger Test", ja: "トリガーテスト" }[language]}
            </Button>
            <Button variant="outline" onClick={() => setNewGroupDialogOpen(true)} className="gap-2" title={t("tipAddScreenGroup")}>
              <FolderPlus className="w-4 h-4" />
              {t("screensNewGroup")}
            </Button>
            <Button variant="outline" onClick={openWebPlayerSetup} className="gap-2" title="新增 Web Player 螢幕">
              <Monitor className="w-4 h-4" />
              Web Player
            </Button>
            <Button onClick={openAdd} className="gap-2" title={t("tipAddScreen")}>
              <Plus className="w-4 h-4" />
              {t("screensAdd")}
            </Button>
          </div>
        )}
      </div>

      {/* Plan usage */}
      <PlanUsageBar
        icon={Monitor}
        label={t("planUsageScreens")}
        used={screens.length}
        limit={limits.maxScreens}
        planLabel={tier ? PLAN_LABELS[tier][language] : undefined}
        usedSuffix={{ zh: "已使用", en: "used", ja: "使用済み" }[language]}
      />

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder={t("screensSearchPlaceholder")} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter || "all"} onValueChange={setStatusFilter}>
          <SelectTrigger
            className={`w-full sm:w-[160px] ${
              statusFilter === "offline"
                ? "border-destructive/40 text-destructive"
                : statusFilter === "online"
                ? "border-success/40 text-success"
                : statusFilter === "alerts"
                ? "border-warning/40 text-warning"
                : ""
            }`}
          >
            <SelectValue placeholder={t("screensStatusFilterPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("screensStatusFilterAll")}</SelectItem>
            <SelectItem value="online">
              <span className="inline-flex items-center gap-2">
                <Wifi className="w-3.5 h-3.5 text-success" />
                {t("screensStatusFilterOnline")}
              </span>
            </SelectItem>
            <SelectItem value="offline">
              <span className="inline-flex items-center gap-2">
                <WifiOff className="w-3.5 h-3.5 text-destructive" />
                {t("screensStatusFilterOffline")}
              </span>
            </SelectItem>
            <SelectItem value="alerts">
              <span className="inline-flex items-center gap-2">
                <Zap className="w-3.5 h-3.5 text-warning" />
                {t("screensStatusFilterAlerts")}
                {alertedScreenIds.size > 0 && (
                  <span className="ml-1 text-xs text-muted-foreground">({alertedScreenIds.size})</span>
                )}
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
        <Select value={groupFilter} onValueChange={setGroupFilter}>
          <SelectTrigger className="w-full sm:w-[180px]"><SelectValue placeholder={t("allGroups")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allGroups")}</SelectItem>
            <SelectItem value={UNGROUPED}>{t("screensUngrouped")}</SelectItem>
            {groups.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
          </SelectContent>
        </Select>
        <ScreenHealthExportDialog screens={screens} alertedScreenIds={alertedScreenIds} />
        {isAdmin && <ScreenHealthScheduleDialog />}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="icon" title={t("tipSpeedThreshold")}>
              <SlidersHorizontal className="w-4 h-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72" align="end">
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-foreground mb-1">{t("screensThresholdTitle")}</h4>
                <p className="text-xs text-muted-foreground">{t("screensThresholdDesc")}</p>
              </div>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("screensUploadThreshold")}</Label>
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    value={uploadThreshold}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value) || 0;
                      saveThresholds(v, downloadThreshold);
                    }}
                    className="h-8"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("screensDownloadThreshold")}</Label>
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    value={downloadThreshold}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value) || 0;
                      saveThresholds(uploadThreshold, v);
                    }}
                    className="h-8"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground pt-1 border-t border-border">
                <span className="w-2 h-2 rounded-full bg-success" /> {t("screensThresholdNormal")}
                <span className="w-2 h-2 rounded-full bg-destructive ml-2" /> {t("screensThresholdLow")}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Group chips */}
      <div className="flex flex-wrap gap-2 animate-fade-in">
        {/* Ungrouped chip */}
        <button
          onClick={() => setGroupFilter(groupFilter === UNGROUPED ? "all" : UNGROUPED)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
            groupFilter === UNGROUPED
              ? "bg-muted-foreground text-background"
              : "bg-muted text-muted-foreground hover:bg-accent"
          }`}
        >
          <Layers className="w-3 h-3" />
          {t("screensUngrouped")}
          <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] ${
            groupFilter === UNGROUPED ? "bg-background/20" : "bg-background"
          }`}>{ungroupedCount}</span>
        </button>

        {groups.map((g) => {
          const count = screens.filter((s) => s.branch === g).length;
          return (
            <div key={g} className="inline-flex items-center group relative">
              <button
                onClick={() => setGroupFilter(groupFilter === g ? "all" : g)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  groupFilter === g
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent"
                } ${isAdmin ? "pr-7" : ""}`}
              >
                <Layers className="w-3 h-3" />
                {g}
                <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] ${
                  groupFilter === g ? "bg-primary-foreground/20" : "bg-background"
                }`}>{count}</span>
              </button>
              {isAdmin && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-foreground/10">
                      <MoreHorizontal className="w-3.5 h-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[140px]">
                    <DropdownMenuItem onClick={() => openRename(g)} className="gap-2 text-xs">
                      <Pencil className="w-3.5 h-3.5" />
                      {t("screensRenameGroup")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setDeleteGroupTarget(g)} className="gap-2 text-xs text-destructive focus:text-destructive">
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      {t("screensDeleteGroup")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          );
        })}
      </div>

      {loading ? (
        <PageSkeleton />
      ) : (
        <div className="grid gap-3">
          {filtered.length === 0 && (
            <Card className="p-12 text-center text-muted-foreground">
              <Monitor className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>{t("screensNoResult")}</p>
            </Card>
          )}
          {filtered.map((screen, i) => (
            (() => {
              const ls = licenseStatusByScreen[screen.id];
              const unlicensed = isScreenUnlicensed(ls);
              const playerInfo = playerByScreen[screen.id];
              const hasPlayer = !!playerInfo;
              // Status: unlicensed (gray) > offline (red) > playing (green) > sleeping (orange)
              const cardState: "unlicensed" | "offline" | "playing" | "sleeping" = unlicensed
                ? "unlicensed"
                : !screen.online
                  ? "offline"
                  : hasPlayer
                    ? "playing"
                    : "sleeping";
              const cardCls =
                cardState === "unlicensed"
                  ? "border-l-muted-foreground/30 bg-muted/40 ring-1 ring-muted-foreground/10"
                  : cardState === "offline"
                    ? "border-l-destructive bg-destructive/[0.04] ring-1 ring-destructive/15"
                    : cardState === "playing"
                      ? "border-l-success bg-success/[0.06] ring-1 ring-success/15"
                      : "border-l-warning bg-warning/[0.08] ring-1 ring-warning/20";
              const iconWrapCls =
                cardState === "unlicensed"
                  ? "bg-muted"
                  : cardState === "offline"
                    ? "bg-destructive/10"
                    : cardState === "playing"
                      ? "bg-success/15"
                      : "bg-warning/15";
              const iconCls =
                cardState === "unlicensed"
                  ? "text-muted-foreground/60"
                  : cardState === "offline"
                    ? "text-destructive"
                    : cardState === "playing"
                      ? "text-success"
                      : "text-warning";
              return (
            <Card
              key={screen.id}
              role="button"
              tabIndex={0}
              onClick={() => setDetailScreen(screen)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setDetailScreen(screen);
                }
              }}
              className={`relative p-4 pl-5 flex items-center gap-4 hover-lift shadow-sm opacity-0 animate-fade-in stagger-${Math.min(i + 1, 8)} border-l-4 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${cardCls}`}
            >
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${iconWrapCls}`} title={t("tipScreen")}>
                <Monitor className={`w-6 h-6 ${iconCls}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className={`text-sm font-medium truncate ${unlicensed ? "text-muted-foreground" : "text-foreground"}`}>{screen.name}</h3>
                  <ConnectionInfo license={ls}>
                  <TooltipProvider delayDuration={150}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold shadow-sm cursor-help ${
                            screen.online
                              ? "bg-success text-success-foreground"
                              : "bg-destructive text-destructive-foreground"
                          }`}
                        >
                          <span className="relative flex w-2 h-2">
                            {screen.online && (
                              <span className="absolute inline-flex h-full w-full rounded-full bg-success-foreground/70 opacity-75 animate-ping" />
                            )}
                            <span className={`relative inline-flex w-2 h-2 rounded-full ${
                              screen.online ? "bg-success-foreground" : "bg-destructive-foreground animate-pulse"
                            }`} />
                          </span>
                          {screen.online ? t("online") : t("offline")}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" align="start" className="max-w-xs">
                        <div className="space-y-1.5 text-xs">
                          <div className="flex items-center gap-2">
                            <Wifi className="w-3 h-3 text-muted-foreground shrink-0" />
                            <span className="text-muted-foreground">{t("screenStatusIp")}:</span>
                            <span className="font-mono">{screen.ip_address || "—"}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <RefreshCw className="w-3 h-3 text-muted-foreground shrink-0" />
                            <span className="text-muted-foreground">{t("screenStatusHeartbeat")}:</span>
                            <span>
                              {screen.updated_at
                                ? new Date(screen.updated_at).toLocaleString()
                                : t("screenStatusNeverSeen")}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Tv className="w-3 h-3 text-muted-foreground shrink-0" />
                            <span className="text-muted-foreground">{t("screenStatusPlayer")}:</span>
                            <span className="truncate">
                              {playerByScreen[screen.id]?.channel || t("screenStatusNoPlayer")}
                            </span>
                          </div>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  </ConnectionInfo>
                  {unlicensed && (() => {
                    const ls2 = licenseStatusByScreen[screen.id];
                    if (!ls2) return null;
                    const label = ls2.status === "revoked"
                      ? { zh: "授權已撤銷", en: "License Revoked", ja: "ライセンス取消" }[language]
                      : { zh: "未授權", en: "Unlicensed", ja: "未承認" }[language];
                    const tip = ls2.status === "revoked"
                      ? { zh: "此螢幕的設備授權已被撤銷，已停止連線與播放，且無法編輯。", en: "This screen's device license is revoked. Connections and playback are blocked, editing disabled.", ja: "このスクリーンのデバイスライセンスは取り消されています。接続と再生はブロックされ、編集も無効です。" }[language]
                      : { zh: "找不到對應的有效設備授權。", en: "No active device license bound.", ja: "有効なデバイスライセンスがありません。" }[language];
                    return (
                      <TooltipProvider delayDuration={150}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-destructive/15 text-destructive border border-destructive/30 cursor-help">
                              <ShieldOff className="w-3 h-3" />
                              {label}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-xs text-xs">{tip}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    );
                  })()}
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                  <span className={`flex items-center gap-1 ${!screen.branch ? "italic opacity-60" : ""}`} title={t("tipGroup")}>
                    <Layers className="w-3 h-3" />{screen.branch || t("screensUngrouped")}
                  </span>
                  {screen.location && <span className="flex items-center gap-1" title={t("tipLocation")}><MapPin className="w-3 h-3" />{screen.location}</span>}
                  <span title={t("tipResolution")}>{screen.resolution}</span>
                  <span className="flex items-center gap-1 font-mono text-[11px]" title={t("tipSerialNumber")}>SN: {screen.serial_number || "—"}</span>
                  <ConnectionInfo license={ls}>
                    <span className="flex items-center gap-1 font-mono text-[11px]" title={t("tipIpAddress")}>IP: {screen.ip_address || "—"}</span>
                  </ConnectionInfo>
                  <span className="flex items-center gap-1 font-mono text-[11px]" title={t("tipFirmwareVersion")}>FW: {screen.firmware_version || "—"}</span>
                  <ConnectionInfo license={ls}>
                    {screen.connection_type && (
                      <span className="flex items-center gap-1" title={t("tipConnectionType")}>
                        {screen.connection_type === "wired" ? <Cable className="w-3 h-3" /> : <Wifi className="w-3 h-3" />}
                        {screen.connection_type === "wired" ? t("tipWired") : t("tipWireless")}
                      </span>
                    )}
                  </ConnectionInfo>
                  <ConnectionInfo license={ls}>
                  {(() => {
                    const parseSpeed = (s?: string) => {
                      if (!s) return null;
                      const match = s.match(/([\d.]+)/);
                      return match ? parseFloat(match[1]) : null;
                    };
                    const up = parseSpeed(screen.avg_upload_speed);
                    const down = parseSpeed(screen.avg_download_speed);
                    const hasData = up !== null || down !== null;
                    const isUpLow = up !== null && up < uploadThreshold;
                    const isDownLow = down !== null && down < downloadThreshold;
                    const isWarning = hasData && (isUpLow || isDownLow);

                    return (
                      <span title={t("tipNetworkSpeedHealth").replace("{up}", String(uploadThreshold)).replace("{down}", String(downloadThreshold))} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-medium ${
                        !hasData
                          ? "bg-muted text-muted-foreground"
                          : isWarning
                            ? "bg-destructive/10 text-destructive"
                            : "bg-success/10 text-success"
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          !hasData ? "bg-muted-foreground/40" : isWarning ? "bg-destructive animate-pulse" : "bg-success"
                        }`} />
                        <ArrowUpDown className="w-3 h-3" />
                        {!hasData ? (
                          <span>{t("tipSpeedNotSet")}</span>
                        ) : (
                          <>
                            {up !== null && <span className={isUpLow ? "font-bold" : ""}>↑{screen.avg_upload_speed}</span>}
                            {up !== null && down !== null && <span>/</span>}
                            {down !== null && <span className={isDownLow ? "font-bold" : ""}>↓{screen.avg_download_speed}</span>}
                            {isWarning && <span className="text-[10px]">⚠</span>}
                          </>
                        )}
                      </span>
                    );
                  })()}
                  </ConnectionInfo>
                </div>

                {/* ── Now-playing row ── */}
                {playerInfo && screen.online && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-xs flex-wrap">
                    <span className="inline-flex items-center gap-1 text-success font-medium">
                      <Play className="w-3 h-3" />
                      {playerInfo.channel}
                    </span>
                    {playerInfo.project && (
                      <>
                        <span className="text-muted-foreground/40 select-none">›</span>
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <LayoutGrid className="w-3 h-3" />
                          {playerInfo.project}
                        </span>
                      </>
                    )}
                  </div>
                )}
              </div>
              {isAdmin && (() => {
                const ls = licenseStatusByScreen[screen.id];
                const locked = !!ls && !ls.licensed;
                const lockedTitle = { zh: "此螢幕未授權，已禁用此操作", en: "Screen unlicensed — action disabled", ja: "このスクリーンは未承認のため無効" }[language];
                return (
                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" disabled={locked} onClick={() => navigate(`/player/${screen.id}`)} title={locked ? lockedTitle : t("screensOpenPlayer")}><Play className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" disabled={locked} onClick={() => toast.info(t("screenLiveViewPlaceholder"))} title={locked ? lockedTitle : t("screenLiveView")}><Eye className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" disabled={locked} onClick={() => setIotScreen(screen)} title={locked ? lockedTitle : t("tipIotDevices")}><Radio className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" disabled={locked} onClick={() => setChannelDialogScreen(screen)} title={locked ? lockedTitle : { zh: "頻道訂閱與觸發", en: "Channels & Triggers", ja: "チャンネル & トリガー" }[language]}><Tv className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" disabled={locked} onClick={() => setSmartTriggerScreen(screen)} title={locked ? lockedTitle : { zh: "智能觸發", en: "Smart Triggers", ja: "スマートトリガー" }[language]}><Zap className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" disabled={locked} onClick={() => setSettingsScreen(screen)} title={locked ? lockedTitle : t("screenSettings")}><Settings className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" disabled={locked} onClick={() => openEdit(screen)} title={locked ? lockedTitle : t("tipEditScreen")}><Pencil className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeleteId(screen.id)} title={t("tipDeleteScreen")}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                  </div>
                );
              })()}
            </Card>
              );
            })()
          ))}
        </div>
      )}

      {/* Add/Edit Screen Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? t("screensEditTitle") : t("screensAddTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {!editingId && (
              <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
                <Label className="text-sm font-semibold">
                  {{ zh: "設備授權碼", en: "Device License Code", ja: "デバイスライセンスコード" }[language]} *
                </Label>
                <p className="text-xs text-muted-foreground">
                  {{ zh: "輸入 6 位數授權碼後驗證，系統將自動帶入設備型號、序號與所屬組織。", en: "Enter the 6-digit code and verify; device model, serial and org will auto-fill.", ja: "6桁のコードを入力して確認すると、機種・シリアル・組織が自動入力されます。" }[language]}
                </p>
                <div className="flex gap-2">
                  <Input
                    inputMode="numeric"
                    maxLength={6}
                    value={licenseCode}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                      setLicenseCode(v);
                      if (licenseInfo) {
                        // Editing the code invalidates the previous lookup
                        setLicenseInfo(null);
                        setForm((prev) => ({ ...prev, serial_number: "", org_id: defaultOrgId || "" }));
                      }
                      setLicenseError(null);
                    }}
                    placeholder="000000"
                    className="font-mono tracking-widest text-center"
                    disabled={!!licenseInfo}
                  />
                  {licenseInfo ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setLicenseInfo(null);
                        setLicenseCode("");
                        setLicenseError(null);
                        setForm((prev) => ({ ...prev, serial_number: "", org_id: defaultOrgId || "" }));
                      }}
                    >
                      {{ zh: "重新輸入", en: "Reset", ja: "再入力" }[language]}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      onClick={verifyLicenseCode}
                      disabled={licenseChecking || licenseCode.length !== 6}
                    >
                      {licenseChecking && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      {{ zh: "驗證", en: "Verify", ja: "確認" }[language]}
                    </Button>
                  )}
                </div>
                {licenseError && (
                  <p className="text-xs text-destructive">{licenseError}</p>
                )}
                {licenseInfo && (
                  <div className="rounded-sm bg-success/10 border border-success/30 p-2 text-xs space-y-1">
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{{ zh: "型號", en: "Model", ja: "機種" }[language]}</span>
                      <span className="font-medium text-foreground">{licenseInfo.device_model}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{{ zh: "序號", en: "Serial", ja: "シリアル" }[language]}</span>
                      <span className="font-mono text-foreground">{licenseInfo.device_serial}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{{ zh: "組織", en: "Organization", ja: "組織" }[language]}</span>
                      <span className="font-medium text-foreground">{licenseInfo.org_name || licenseInfo.org_id}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
            {(editingId || licenseInfo) && (
            <>
            {/* Inline validation for name + team */}
            <div className="space-y-2">
              <Label>{t("screensName")} *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={t("screensNamePlaceholder")}
                aria-invalid={(() => {
                  const n = form.name.trim();
                  if (!n) return true;
                  const targetOrg = (!editingId && licenseInfo?.org_id) || form.org_id || activeOrgId || defaultOrgId;
                  return screens.some(
                    (s) => s.id !== editingId && (s.org_id || "") === (targetOrg || "") && (s.name || "").trim().toLowerCase() === n.toLowerCase(),
                  );
                })()}
                className={(() => {
                  const n = form.name.trim();
                  const targetOrg = (!editingId && licenseInfo?.org_id) || form.org_id || activeOrgId || defaultOrgId;
                  const dup = !!n && screens.some((s) => s.id !== editingId && (s.org_id || "") === (targetOrg || "") && (s.name || "").trim().toLowerCase() === n.toLowerCase());
                  return (!n || dup) ? "border-destructive focus-visible:ring-destructive" : "";
                })()}
              />
              {(() => {
                const n = form.name.trim();
                if (!n) return <p className="text-xs text-destructive">{{ zh: "螢幕名稱為必填", en: "Screen name is required", ja: "スクリーン名は必須です" }[language]}</p>;
                const targetOrg = (!editingId && licenseInfo?.org_id) || form.org_id || activeOrgId || defaultOrgId;
                const dup = screens.some((s) => s.id !== editingId && (s.org_id || "") === (targetOrg || "") && (s.name || "").trim().toLowerCase() === n.toLowerCase());
                if (dup) return <p className="text-xs text-destructive">{{ zh: "此名稱在此組織中已存在", en: "This name already exists in this organization", ja: "この名前は既に存在します" }[language]}</p>;
                return null;
              })()}
            </div>
            <div className="space-y-2">
              <Label>{t("screensTeam")}{!editingId ? " *" : ""}</Label>
              <Select
                value={form.team_id || "none"}
                onValueChange={(v) => setForm({ ...form, team_id: v === "none" ? "" : v })}
              >
                <SelectTrigger className={!editingId && !form.team_id ? "border-destructive focus-visible:ring-destructive" : ""}><SelectValue placeholder={t("screensSelectTeam")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("teamNoTeamLabel")}</SelectItem>
                  {teams
                    .filter((tm) => !form.org_id || tm.org_id === form.org_id)
                    .map((tm) => (
                      <SelectItem key={tm.id} value={tm.id}>
                        {tm.name === "Default" ? t("teamNoTeamLabel") : tm.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {!editingId && !form.team_id && (
                <p className="text-xs text-destructive">{{ zh: "請選擇所屬團隊", en: "Please select a team", ja: "チームを選択してください" }[language]}</p>
              )}
            </div>
            {!editingId && (
              <p className="text-xs text-muted-foreground">
                {{ zh: "其他欄位（分組、位置、解析度、網路等）可於建立後在「編輯螢幕」中設定。", en: "Other fields (group, location, resolution, network, etc.) can be configured later in Edit Screen.", ja: "その他の項目（グループ・位置・解像度・ネットワークなど）は作成後の「編集」で設定できます。" }[language]}
              </p>
            )}
            </>
            )}
            {editingId && (
            <>
            <div className="space-y-2">
              <Label>{t("screensBranch")}</Label>
              {isCreatingInForm ? (
                <div className="flex gap-2">
                  <Input
                    value={inlineNewGroup}
                    onChange={(e) => setInlineNewGroup(e.target.value)}
                    placeholder={t("screensNewGroupPlaceholder")}
                    className="flex-1"
                    autoFocus
                  />
                  <Button variant="outline" size="sm" onClick={() => { setIsCreatingInForm(false); setInlineNewGroup(""); }}>
                    {t("cancel")}
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Select value={form.branch || UNGROUPED} onValueChange={(v) => setForm({ ...form, branch: v === UNGROUPED ? "" : v })}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder={t("screensSelectBranch")} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNGROUPED}>{t("screensUngrouped")}</SelectItem>
                      {groups.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="icon" className="shrink-0" onClick={() => setIsCreatingInForm(true)} title={t("screensNewGroup")}>
                    <FolderPlus className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>{t("screensLocation")}</Label>
              <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder={t("screensLocationPlaceholder")} />
            </div>
            <div className="space-y-2">
              <Label>{t("screensResolution")}</Label>
              <Select value={form.resolution} onValueChange={(v) => setForm({ ...form, resolution: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1920×1080">1920×1080 (FHD)</SelectItem>
                  <SelectItem value="3840×2160">3840×2160 (4K)</SelectItem>
                  <SelectItem value="1080×1920">1080×1920 (Portrait FHD)</SelectItem>
                  <SelectItem value="2160×3840">2160×3840 (Portrait 4K)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("screensSerialNumber")}</Label>
              <Input
                value={form.serial_number}
                onChange={(e) => setForm({ ...form, serial_number: e.target.value })}
                placeholder={t("screensSerialNumberPlaceholder")}
                readOnly={!editingId}
                className={!editingId ? "bg-muted/40" : ""}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("screensFirmwareVersion")}</Label>
              <Input value={form.firmware_version} onChange={(e) => setForm({ ...form, firmware_version: e.target.value })} placeholder={t("screensFirmwareVersionPlaceholder")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t("screensIpAddress")}</Label>
                <Input value={form.ip_address} onChange={(e) => setForm({ ...form, ip_address: e.target.value })} placeholder="192.168.1.100" />
              </div>
              <div className="space-y-2">
                <Label>{t("screensConnectionType")}</Label>
                <Select value={form.connection_type} onValueChange={(v) => setForm({ ...form, connection_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="wired">{t("screensConnWired")}</SelectItem>
                    <SelectItem value="wireless">{t("screensConnWireless")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t("screensAvgUpload")}</Label>
                <Input value={form.avg_upload_speed} onChange={(e) => setForm({ ...form, avg_upload_speed: e.target.value })} placeholder={t("screensUploadPlaceholder")} />
              </div>
              <div className="space-y-2">
                <Label>{t("screensAvgDownload")}</Label>
                <Input value={form.avg_download_speed} onChange={(e) => setForm({ ...form, avg_download_speed: e.target.value })} placeholder={t("screensDownloadPlaceholder")} />
              </div>
            </div>
            {orgs.length > 0 && (
              <div className="space-y-2">
                <Label>{t("teamOrg")}</Label>
                <Select
                  value={form.org_id || "none"}
                  onValueChange={(v) => setForm({ ...form, org_id: v === "none" ? "" : v })}
                  disabled={!editingId && !!licenseInfo}
                >
                  <SelectTrigger><SelectValue placeholder={t("teamSelectOrg")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("screensUngrouped")}</SelectItem>
                    {orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {!editingId && licenseInfo && (
                  <p className="text-xs text-muted-foreground">
                    {{ zh: "組織由授權碼自動指定", en: "Organization is set by the license", ja: "組織はライセンスにより指定されます" }[language]}
                  </p>
                )}
              </div>
            )}
            </>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">{t("cancel")}</Button></DialogClose>
            <Button
              onClick={handleSave}
              disabled={(() => {
                if (saving) return true;
                if (!editingId && !licenseInfo) return true;
                const n = form.name.trim();
                if (!n) return true;
                if (!editingId && !form.team_id) return true;
                const targetOrg = (!editingId && licenseInfo?.org_id) || form.org_id || activeOrgId || defaultOrgId;
                const dup = screens.some((s) => s.id !== editingId && (s.org_id || "") === (targetOrg || "") && (s.name || "").trim().toLowerCase() === n.toLowerCase());
                return dup;
              })()}
            >
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editingId ? t("screensSaveChanges") : t("screensAdd")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Group Dialog */}
      <Dialog open={newGroupDialogOpen} onOpenChange={setNewGroupDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FolderPlus className="w-5 h-5 text-primary" />{t("screensNewGroup")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>{t("screensNewGroup")} *</Label>
              <Input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder={t("screensNewGroupPlaceholder")}
                onKeyDown={(e) => e.key === "Enter" && handleAddGroup()}
              />
            </div>
            {groups.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">{t("screensManageGroups")}</Label>
                <div className="flex flex-wrap gap-1.5">
                  {groups.map((g) => (
                    <span key={g} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted text-xs text-muted-foreground">
                      <Layers className="w-3 h-3" />
                      {g}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">{t("cancel")}</Button></DialogClose>
            <Button onClick={handleAddGroup} disabled={!newGroupName.trim()} className="gap-2">
              <Plus className="w-4 h-4" />
              {t("screensNewGroup")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Group Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Pencil className="w-5 h-5 text-primary" />{t("screensRenameGroup")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>{t("screensRenameGroup")}</Label>
              <Input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                placeholder={t("screensRenameGroupPlaceholder")}
                onKeyDown={(e) => e.key === "Enter" && handleRenameGroup()}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">{t("cancel")}</Button></DialogClose>
            <Button onClick={handleRenameGroup} disabled={!renameValue.trim()} className="gap-2">
              {t("screensSaveChanges")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Screen Confirm */}
      <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("screensDeleteConfirm")}</AlertDialogTitle>
            <AlertDialogDescription>{t("screensDeleteDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{t("confirmDelete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Group Confirm */}
      <AlertDialog open={deleteGroupTarget !== null} onOpenChange={(open) => !open && setDeleteGroupTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("screensDeleteGroup")}：{deleteGroupTarget}</AlertDialogTitle>
            <AlertDialogDescription>{t("screensDeleteGroupDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteGroup} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{t("confirmDelete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Screen Settings Dialog */}
      <Dialog open={settingsScreen !== null} onOpenChange={(open) => { if (!open) setSettingsScreen(null); }}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-primary" />
              {t("screenSettings")} — {settingsScreen?.name}
            </DialogTitle>
          </DialogHeader>
          <Tabs defaultValue="settings">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="settings" className="gap-1.5"><Settings className="w-3.5 h-3.5" />{t("screenSettings")}</TabsTrigger>
              <TabsTrigger value="logs" className="gap-1.5"><FileText className="w-3.5 h-3.5" />{t("navDeviceLogs")}</TabsTrigger>
            </TabsList>
            <TabsContent value="settings">
          <div className="space-y-5 py-2">
            {/* Network Settings */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Monitor className="w-4 h-4 text-primary" />
                {t("screenSettingsNetwork")}
              </h3>
              <div className="space-y-3 pl-6">
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("screenSettingsIpMode")}</Label>
                  <Select value={settingsForm.ipMode} onValueChange={(v) => setSettingsForm({ ...settingsForm, ipMode: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dhcp">{t("screenSettingsDhcp")}</SelectItem>
                      <SelectItem value="static">{t("screenSettingsStatic")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {settingsForm.ipMode === "static" && (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-xs">{t("screenSettingsIpAddress")}</Label>
                      <Input value={settingsForm.ipAddress} onChange={(e) => setSettingsForm({ ...settingsForm, ipAddress: e.target.value })} placeholder="192.168.1.100" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">{t("screenSettingsSubnet")}</Label>
                      <Input value={settingsForm.subnet} onChange={(e) => setSettingsForm({ ...settingsForm, subnet: e.target.value })} placeholder="255.255.255.0" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">{t("screenSettingsGateway")}</Label>
                      <Input value={settingsForm.gateway} onChange={(e) => setSettingsForm({ ...settingsForm, gateway: e.target.value })} placeholder="192.168.1.1" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">{t("screenSettingsDns")}</Label>
                      <Input value={settingsForm.dns} onChange={(e) => setSettingsForm({ ...settingsForm, dns: e.target.value })} placeholder="8.8.8.8" />
                    </div>
                  </>
                )}
              </div>
            </div>

            <Separator />

            {/* NTP Server */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-primary" />
                {t("screenSettingsNtp")}
              </h3>
              <div className="pl-6">
                <Input value={settingsForm.ntpServer} onChange={(e) => setSettingsForm({ ...settingsForm, ntpServer: e.target.value })} placeholder="pool.ntp.org" />
              </div>
            </div>

            <Separator />

            {/* Screen Rotation */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <RotateCw className="w-4 h-4 text-primary" />
                {t("screenSettingsRotation")}
              </h3>
              <div className="pl-6">
                <Select value={settingsForm.rotation} onValueChange={(v) => setSettingsForm({ ...settingsForm, rotation: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">{t("screenSettingsRotation0")}</SelectItem>
                    <SelectItem value="90">{t("screenSettingsRotation90")}</SelectItem>
                    <SelectItem value="180">{t("screenSettingsRotation180")}</SelectItem>
                    <SelectItem value="270">{t("screenSettingsRotation270")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            {/* Schedule On/Off */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Power className="w-4 h-4 text-primary" />
                {t("screenSettingsScheduleOnOff")}
              </h3>
              <div className="space-y-3 pl-6">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">{t("enabled")}</Label>
                  <Switch checked={settingsForm.scheduleEnabled} onCheckedChange={(v) => setSettingsForm({ ...settingsForm, scheduleEnabled: v })} />
                </div>
                {settingsForm.scheduleEnabled && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">{t("screenSettingsScheduleOn")}</Label>
                      <Input type="time" value={settingsForm.scheduleOn} onChange={(e) => setSettingsForm({ ...settingsForm, scheduleOn: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">{t("screenSettingsScheduleOff")}</Label>
                      <Input type="time" value={settingsForm.scheduleOff} onChange={(e) => setSettingsForm({ ...settingsForm, scheduleOff: e.target.value })} />
                    </div>
                  </div>
                )}
              </div>
            </div>

            <Separator />

            {/* Default Playback */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Play className="w-4 h-4 text-primary" />
                {t("screenDefaultPlayback")}
              </h3>
              <p className="text-xs text-muted-foreground pl-6">{t("screenDefaultPlaybackDesc")}</p>
              <div className="space-y-3 pl-6">
                <div className="space-y-1.5">
                  <Select value={settingsForm.defaultPlayback} onValueChange={(v: "sleep" | "media" | "design") => setSettingsForm({ ...settingsForm, defaultPlayback: v, defaultMediaId: "", defaultDesignId: "" })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sleep">
                        <span className="flex items-center gap-2"><Moon className="w-3.5 h-3.5" />{t("screenDefaultSleep")}</span>
                      </SelectItem>
                      <SelectItem value="media">
                        <span className="flex items-center gap-2"><Play className="w-3.5 h-3.5" />{t("screenDefaultMedia")}</span>
                      </SelectItem>
                      <SelectItem value="design">
                        <span className="flex items-center gap-2"><Brush className="w-3.5 h-3.5" />{t("screenDefaultDesign")}</span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {settingsForm.defaultPlayback === "media" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t("screenDefaultSelectMedia")}</Label>
                    <Select value={settingsForm.defaultMediaId} onValueChange={(v) => setSettingsForm({ ...settingsForm, defaultMediaId: v })}>
                      <SelectTrigger><SelectValue placeholder={t("screenDefaultSelectMedia")} /></SelectTrigger>
                      <SelectContent>
                        {mediaOptions.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            <span className="flex items-center gap-2">
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase">{m.type}</span>
                              {m.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {settingsForm.defaultPlayback === "design" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t("screenDefaultSelectProject")}</Label>
                    <Select value={settingsForm.defaultDesignId} onValueChange={(v) => setSettingsForm({ ...settingsForm, defaultDesignId: v })}>
                      <SelectTrigger><SelectValue placeholder={t("screenDefaultSelectProject")} /></SelectTrigger>
                      <SelectContent>
                        {designOptions.map((d) => (
                          <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </div>

            <Separator />
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-destructive" />
                {t("screenSettingsReboot")}
              </h3>
              <div className="pl-6">
                <Button variant="destructive" size="sm" className="gap-2" onClick={() => setRebootConfirmOpen(true)}>
                  <RefreshCw className="w-4 h-4" />
                  {t("screenSettingsReboot")}
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">{t("cancel")}</Button></DialogClose>
            <Button onClick={handleSaveSettings}>
              {t("save")}
            </Button>
          </DialogFooter>
            </TabsContent>
            <TabsContent value="logs">
              {settingsScreen && <ScreenLogPanel screenId={settingsScreen.id} />}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Reboot Confirm */}
      <AlertDialog open={rebootConfirmOpen} onOpenChange={setRebootConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("screenSettingsRebootConfirm")}</AlertDialogTitle>
            <AlertDialogDescription>{t("screenSettingsRebootDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { toast.success(t("screenSettingsRebooting")); setRebootConfirmOpen(false); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t("screenSettingsReboot")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* IoT Extension Dialog */}
      <Dialog open={!!iotScreen} onOpenChange={(open) => { if (!open) setIotScreen(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Radio className="w-5 h-5 text-primary" />
              {t("iotTitle")}
            </DialogTitle>
          </DialogHeader>
          {iotScreen && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("iotDescription").replace("{name}", iotScreen.name)}
              </p>

              {/* Connected devices */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-foreground">{t("iotConnectedDevices")}</h4>
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAddIotOpen(true)}>
                    <Plus className="w-3.5 h-3.5" /> {t("iotAddDevice")}
                  </Button>
                </div>
                {iotLoading ? (
                  <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
                ) : iotDevices.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground border border-dashed border-border rounded-lg">
                    <Radio className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">{t("iotNoDevices")}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {iotDevices.map((device) => {
                      const typeConfig: Record<string, { label: string; icon: string; color: string }> = {
                        air_quality: { label: t("iotTypeAirQuality"), icon: "🌬️", color: "border-blue-500/30 bg-blue-500/5" },
                        earthquake: { label: t("iotTypeEarthquake"), icon: "🔔", color: "border-orange-500/30 bg-orange-500/5" },
                        fire: { label: t("iotTypeFire"), icon: "🔥", color: "border-red-500/30 bg-red-500/5" },
                        temperature: { label: t("iotTypeTemperature"), icon: "🌡️", color: "border-emerald-500/30 bg-emerald-500/5" },
                        noise: { label: t("iotTypeNoise"), icon: "🔊", color: "border-purple-500/30 bg-purple-500/5" },
                      };
                      const cfg = typeConfig[device.device_type] || { label: device.device_type, icon: "📡", color: "border-border bg-muted/30" };
                      return (
                        <div key={device.id} className={`flex items-center gap-3 p-3 rounded-lg border ${cfg.color}`}>
                          <span className="text-xl">{cfg.icon}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{device.name}</p>
                            <p className="text-xs text-muted-foreground">{cfg.label}</p>
                          </div>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                            device.status === "online" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${device.status === "online" ? "bg-success" : "bg-destructive"}`} />
                            {device.status === "online" ? t("iotOnline") : t("iotOffline")}
                          </span>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={async () => {
                            const { error } = await supabase.from("iot_devices").delete().eq("id", device.id);
                            if (error) { toast.error(error.message); return; }
                            setIotDevices((prev) => prev.filter((d) => d.id !== device.id));
                            toast.success(t("iotDeviceRemoved"));
                          }}>
                            <Trash2 className="w-3.5 h-3.5 text-destructive" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <Separator />

              {/* Supported device types */}
              <div>
                <h4 className="text-sm font-semibold text-foreground mb-2">{t("iotSupportedTypes")}</h4>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { icon: "🌬️", label: t("iotTypeAirQualityFull"), desc: t("iotTypeAirQualityDesc") },
                    { icon: "🔔", label: t("iotTypeEarthquake"), desc: t("iotTypeEarthquakeDesc") },
                    { icon: "🔥", label: t("iotTypeFire"), desc: t("iotTypeFireDesc") },
                    { icon: "🌡️", label: t("iotTypeTemperatureFull"), desc: t("iotTypeTemperatureDesc") },
                  ].map((item) => (
                    <div key={item.label} className="flex items-start gap-2 p-2.5 rounded-lg bg-muted/50 text-xs">
                      <span className="text-base">{item.icon}</span>
                      <div>
                        <p className="font-medium text-foreground">{item.label}</p>
                        <p className="text-muted-foreground">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add IoT Device Dialog */}
      <Dialog open={addIotOpen} onOpenChange={setAddIotOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("iotAddDialogTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("iotDeviceName")}</Label>
              <Input
                value={newIotDevice.name}
                onChange={(e) => setNewIotDevice((p) => ({ ...p, name: e.target.value }))}
                placeholder={t("iotDeviceNamePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("iotDeviceType")}</Label>
              <Select value={newIotDevice.type} onValueChange={(v) => setNewIotDevice((p) => ({ ...p, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="air_quality">🌬️ {t("iotTypeAirQualityFull")}</SelectItem>
                  <SelectItem value="earthquake">🔔 {t("iotTypeEarthquake")}</SelectItem>
                  <SelectItem value="fire">🔥 {t("iotTypeFire")}</SelectItem>
                  <SelectItem value="temperature">🌡️ {t("iotTypeTemperatureFull")}</SelectItem>
                  <SelectItem value="noise">🔊 {t("iotTypeNoiseFull")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddIotOpen(false)}>{t("cancel")}</Button>
            <Button
              disabled={!newIotDevice.name.trim() || iotSaving}
              onClick={async () => {
                if (!iotScreen) return;
                setIotSaving(true);
                const { data, error } = await supabase.from("iot_devices").insert({
                  screen_id: iotScreen.id,
                  org_id: iotScreen.org_id || null,
                  name: newIotDevice.name.trim(),
                  device_type: newIotDevice.type,
                  status: "online",
                  created_by: user?.id,
                }).select().single();
                setIotSaving(false);
                if (error) { toast.error(error.message); return; }
                setIotDevices((prev) => [...prev, data]);
                toast.success(t("iotDeviceAdded"));
                setNewIotDevice({ name: "", type: "air_quality" });
                setAddIotOpen(false);
              }}
            >
              {iotSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("iotAdd")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Web Player Setup Dialog ───────────────────────────────────── */}
      <Dialog
        open={wpDialogOpen}
        onOpenChange={(v) => {
          if (!v) { setWpCode(null); setWpCodeId(null); setWpActivated(false); }
          setWpDialogOpen(v);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Monitor className="w-5 h-5 text-primary" />
              新增 Web Player 螢幕
            </DialogTitle>
            <DialogDescription>
              輸入螢幕名稱後產生 6 位數代碼，在設備瀏覽器中開啟播放器並輸入代碼即可完成設定。
            </DialogDescription>
          </DialogHeader>

          {!wpCode ? (
            /* Step 1: enter name + org */
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>螢幕名稱 <span className="text-destructive">*</span></Label>
                <input
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={wpName}
                  onChange={(e) => setWpName(e.target.value)}
                  placeholder="例如：大廳螢幕 A"
                  maxLength={100}
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") handleWebPlayerCreate(); }}
                />
              </div>
              {orgs.length > 1 && (
                <div className="space-y-2">
                  <Label>所屬組織 <span className="text-destructive">*</span></Label>
                  <Select value={wpOrgId} onValueChange={setWpOrgId}>
                    <SelectTrigger><SelectValue placeholder="請選擇組織" /></SelectTrigger>
                    <SelectContent>
                      {orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          ) : (
            /* Step 2: show code, wait for device */
            <div className="space-y-4 py-2">
              {wpActivated ? (
                <div className="rounded-lg border border-success/30 bg-success/10 p-5 text-center space-y-2">
                  <div className="text-4xl">✅</div>
                  <p className="font-semibold text-success text-sm">裝置已成功連線！</p>
                  <p className="text-xs text-muted-foreground">螢幕「{wpName}」已出現在螢幕列表中。</p>
                </div>
              ) : (
                <>
                  <div className="text-center space-y-3">
                    <p className="text-sm text-muted-foreground">在設備瀏覽器中開啟播放器後，輸入以下代碼：</p>
                    <div className="text-5xl font-mono font-bold tracking-widest text-primary py-4 px-6 rounded-xl bg-muted border select-all">
                      {wpCode}
                    </div>
                    <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      等待裝置連線中…
                    </p>
                  </div>
                  <div className="rounded border bg-muted/40 p-3 space-y-2">
                    <p className="text-xs font-medium">操作步驟</p>
                    <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                      <li>在設備上開啟瀏覽器</li>
                      <li>
                        前往{" "}
                        <code className="bg-muted px-1 rounded text-[11px]">
                          {window.location.origin}/web-player.html
                        </code>
                      </li>
                      <li>輸入上方 6 位數代碼</li>
                    </ol>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => {
                        navigator.clipboard.writeText(wpCode!);
                        setWpCopied(true);
                        setTimeout(() => setWpCopied(false), 2000);
                      }}
                    >
                      {wpCopied
                        ? <Check className="w-4 h-4 mr-1.5 text-success" />
                        : <Copy className="w-4 h-4 mr-1.5" />}
                      複製代碼
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}/web-player.html`);
                        toast.success("已複製播放器網址");
                      }}
                    >
                      <Copy className="w-4 h-4 mr-1.5" />
                      複製網址
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          <DialogFooter>
            {!wpCode ? (
              <>
                <DialogClose asChild><Button variant="outline">取消</Button></DialogClose>
                <Button
                  onClick={handleWebPlayerCreate}
                  disabled={wpSaving || !wpName.trim() || !wpOrgId}
                >
                  {wpSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  產生授權碼
                </Button>
              </>
            ) : (
              <DialogClose asChild>
                <Button className="w-full" variant={wpActivated ? "default" : "outline"}>
                  {wpActivated ? "完成" : "關閉"}
                </Button>
              </DialogClose>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ScreenChannelDialog
        open={channelDialogScreen !== null}
        onOpenChange={(o) => { if (!o) setChannelDialogScreen(null); }}
        screenId={channelDialogScreen?.id ?? null}
        screenName={channelDialogScreen?.name ?? ""}
        orgId={channelDialogScreen?.org_id ?? activeOrgId ?? null}
      />

      <ScreenSmartTriggerDialog
        open={smartTriggerScreen !== null}
        onOpenChange={(o) => { if (!o) setSmartTriggerScreen(null); }}
        screenId={smartTriggerScreen?.id ?? null}
        screenName={smartTriggerScreen?.name ?? ""}
        orgId={smartTriggerScreen?.org_id ?? activeOrgId ?? null}
      />

      <TriggerTestConsoleDialog
        open={testConsoleOpen}
        onOpenChange={setTestConsoleOpen}
        defaultOrgId={activeOrgId ?? defaultOrgId ?? null}
      />

      <ScreenDetailDrawer
        screen={detailScreen}
        open={detailScreen !== null}
        onOpenChange={(o) => { if (!o) setDetailScreen(null); }}
        connectedPlayer={detailScreen ? (() => { const pi = playerByScreen[detailScreen.id]; if (!pi) return undefined; return [pi.channel, pi.project].filter(Boolean).join(" › "); })() : undefined}
        onEdit={(s) => openEdit(s as Screen)}
        onChanged={fetchScreens}
      />
    </div>
  );
}
