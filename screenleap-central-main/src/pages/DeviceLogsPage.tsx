import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/contexts/LanguageContext";
import { useUserRole } from "@/hooks/useUserRole";
import { useUserOrgs } from "@/hooks/useUserOrgs";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";
import { useProfiles } from "@/contexts/ProfilesContext";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Loader2, Search, Wifi, Settings, CalendarClock, AlertTriangle, Monitor,
  RefreshCw, Building2, FileText, Download, User, LogIn, LogOut, Plus, Pencil,
  Trash2, Send, ShieldCheck, Image, Brush, ChevronLeft, ChevronRight, BarChart3, Play, Clock, CalendarIcon, X,
  BookOpenText,
} from "lucide-react";
import { format, startOfDay, startOfWeek, startOfMonth, isAfter, subDays } from "date-fns";
import * as XLSX from "xlsx";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { renderScreenLog } from "@/lib/screenLogI18n";
import { localizeAction, localizeCategory, localizeActivityDetail } from "@/lib/activityLogI18n";
import AuditCatalogDialog, { auditCatalogTriggerLabel } from "@/components/admin/AuditCatalogDialog";

// --- Device log types ---
interface DeviceLog {
  id: string;
  screen_id: string;
  org_id: string | null;
  event_type: string;
  event_title: string;
  event_detail: string;
  event_code: string | null;
  event_params: Record<string, unknown> | null;
  created_at: string;
  created_by: string | null;
  screen_name?: string;
  operator_name?: string;
}

const DEVICE_TYPE_CONFIG: Record<string, { icon: typeof Wifi; color: string; label: { zh: string; en: string; ja: string } }> = {
  status: { icon: Wifi, color: "bg-blue-500/10 text-blue-600 dark:text-blue-400", label: { zh: "狀態變更", en: "Status", ja: "ステータス" } },
  config: { icon: Settings, color: "bg-amber-500/10 text-amber-600 dark:text-amber-400", label: { zh: "設定變更", en: "Config", ja: "設定変更" } },
  schedule: { icon: CalendarClock, color: "bg-green-500/10 text-green-600 dark:text-green-400", label: { zh: "排程播放", en: "Schedule", ja: "スケジュール" } },
  system: { icon: AlertTriangle, color: "bg-purple-500/10 text-purple-600 dark:text-purple-400", label: { zh: "系統事件", en: "System", ja: "システム" } },
};

// --- Activity log types ---
interface ActivityLog {
  id: string;
  user_id: string;
  org_id: string | null;
  action: string;
  /** New structured i18n fields (mirrors `action`; safe to be missing on legacy rows). */
  action_code?: string | null;
  action_params?: unknown;
  category: string;
  target_type: string;
  target_id: string;
  target_name: string;
  detail: string;
  created_at: string;
  ip_address: string;
  user_name?: string;
}

// Action type determines row color: create=green, update=blue, delete=red, auth=sky, publish=emerald, admin=amber
const ACTION_COLOR_MAP: Record<string, { bg: string; text: string; dot: string }> = {
  create: { bg: "bg-green-50 dark:bg-green-950/20", text: "text-green-700 dark:text-green-400", dot: "bg-green-500" },
  update: { bg: "bg-blue-50 dark:bg-blue-950/20", text: "text-blue-700 dark:text-blue-400", dot: "bg-blue-500" },
  delete: { bg: "bg-red-50 dark:bg-red-950/20", text: "text-red-700 dark:text-red-400", dot: "bg-red-500" },
  login: { bg: "bg-sky-50 dark:bg-sky-950/20", text: "text-sky-700 dark:text-sky-400", dot: "bg-sky-500" },
  logout: { bg: "bg-slate-50 dark:bg-slate-950/20", text: "text-slate-700 dark:text-slate-400", dot: "bg-slate-400" },
  publish: { bg: "bg-emerald-50 dark:bg-emerald-950/20", text: "text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-500" },
  admin: { bg: "bg-amber-50 dark:bg-amber-950/20", text: "text-amber-700 dark:text-amber-400", dot: "bg-amber-500" },
};

function getActionColor(action: string, category: string) {
  const lower = action.toLowerCase();
  if (lower.includes("刪除") || lower.includes("delete") || lower.includes("移除")) return ACTION_COLOR_MAP.delete;
  if (lower.includes("新增") || lower.includes("create") || lower.includes("建立") || lower.includes("上傳")) return ACTION_COLOR_MAP.create;
  if (lower.includes("修改") || lower.includes("update") || lower.includes("編輯") || lower.includes("變更")) return ACTION_COLOR_MAP.update;
  if (lower.includes("發佈") || lower.includes("publish")) return ACTION_COLOR_MAP.publish;
  if (lower.includes("登出") || lower.includes("logout")) return ACTION_COLOR_MAP.logout;
  if (lower.includes("登入") || lower.includes("login")) return ACTION_COLOR_MAP.login;
  if (category === "admin") return ACTION_COLOR_MAP.admin;
  if (category === "publish") return ACTION_COLOR_MAP.publish;
  if (category === "auth") return ACTION_COLOR_MAP.login;
  return ACTION_COLOR_MAP.update;
}

const ACTIVITY_CATEGORY_CONFIG: Record<string, { icon: typeof User; color: string; label: { zh: string; en: string; ja: string } }> = {
  auth: { icon: LogIn, color: "bg-sky-500/10 text-sky-600 dark:text-sky-400", label: { zh: "登入/登出", en: "Auth", ja: "認証" } },
  screen: { icon: Monitor, color: "bg-blue-500/10 text-blue-600 dark:text-blue-400", label: { zh: "螢幕管理", en: "Screen", ja: "スクリーン" } },
  media: { icon: Image, color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", label: { zh: "素材管理", en: "Media", ja: "メディア" } },
  schedule: { icon: CalendarClock, color: "bg-amber-500/10 text-amber-600 dark:text-amber-400", label: { zh: "排程管理", en: "Schedule", ja: "スケジュール" } },
  publish: { icon: Send, color: "bg-green-500/10 text-green-600 dark:text-green-400", label: { zh: "發佈操作", en: "Publish", ja: "配信" } },
  admin: { icon: ShieldCheck, color: "bg-red-500/10 text-red-600 dark:text-red-400", label: { zh: "管理操作", en: "Admin", ja: "管理" } },
  studio: { icon: Brush, color: "bg-violet-500/10 text-violet-600 dark:text-violet-400", label: { zh: "內容設計", en: "Studio", ja: "スタジオ" } },
};

export default function SystemLogsPage() {
  const { language } = useLanguage();
  const { isAdmin } = useUserRole();
  const { orgs } = useUserOrgs();
  const { activeOrgId } = useActiveOrg();
  const { ensureProfiles, getDisplayName } = useProfiles();
  const [activeTab, setActiveTab] = useState("device");
  const [catalogOpen, setCatalogOpen] = useState(false);

  // --- Device logs state ---
  const [deviceLogs, setDeviceLogs] = useState<DeviceLog[]>([]);
  const [screens, setScreens] = useState<{ id: string; name: string }[]>([]);
  const [deviceLoading, setDeviceLoading] = useState(true);
  const [deviceSearch, setDeviceSearch] = useState("");
  const [deviceFilterType, setDeviceFilterType] = useState("all");
  const [deviceFilterScreen, setDeviceFilterScreen] = useState("all");
  const [deviceFilterOrg, setDeviceFilterOrg] = useState("all");
  const [devicePage, setDevicePage] = useState(1);
  const DEVICE_PAGE_SIZE = 50;

  // --- Activity logs state ---
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activitySearch, setActivitySearch] = useState("");
  const [activityFilterCategory, setActivityFilterCategory] = useState("all");
  const [activityFilterOrg, setActivityFilterOrg] = useState("all");
  const [activityFilterTime, setActivityFilterTime] = useState("all");
  const [activityPage, setActivityPage] = useState(1);
  const ACTIVITY_PAGE_SIZE = 50;

  // --- Playback reports state ---
  const [playbackLogs, setPlaybackLogs] = useState<{ id: string; screen_id: string | null; media_name: string; duration_seconds: number; played_at: string; org_id: string | null }[]>([]);
  const [playbackLoading, setPlaybackLoading] = useState(true);
  const [playbackFilterScreen, setPlaybackFilterScreen] = useState("all");
  const [playbackStartDate, setPlaybackStartDate] = useState<Date | undefined>(undefined);
  const [playbackEndDate, setPlaybackEndDate] = useState<Date | undefined>(undefined);

  // --- Shared profile cache lives in global ProfilesContext ---

  const fetchDeviceLogs = async () => {
    setDeviceLoading(true);
    let logsQ = supabase.from("screen_logs").select("id, screen_id, org_id, event_type, event_title, event_detail, event_code, event_params, created_at, created_by").order("created_at", { ascending: false }).limit(1000);
    let screensQ = supabase.from("screens").select("id, name");
    if (activeOrgId) {
      logsQ = logsQ.eq("org_id", activeOrgId);
      screensQ = screensQ.eq("org_id", activeOrgId);
    }
    const [logsRes, screensRes] = await Promise.all([
      logsQ,
      screensQ,
    ]);
    const sMap = new Map((screensRes.data || []).map((s) => [s.id, s.name]));
    const rows = logsRes.data || [];
    await ensureProfiles(rows.map((l) => l.created_by).filter(Boolean));
    setDeviceLogs(rows.map((l) => ({
      ...l,
      screen_name: sMap.get(l.screen_id) || "Unknown",
      operator_name: l.created_by ? (getDisplayName(l.created_by, "Unknown")) : undefined,
    })));
    setScreens(screensRes.data || []);
    setDeviceLoading(false);
  };

  const fetchActivityLogs = async () => {
    setActivityLoading(true);
    let q = supabase.from("activity_logs").select("*").order("created_at", { ascending: false }).limit(1000);
    if (activeOrgId) q = q.eq("org_id", activeOrgId);
    const { data } = await q;
    const rows = data || [];
    await ensureProfiles(rows.map((l) => l.user_id).filter(Boolean));
    setActivityLogs(rows.map((l) => ({
      ...l,
      user_name: getDisplayName(l.user_id, "Unknown"),
    })));
    setActivityLoading(false);
  };

  const fetchPlaybackLogs = async () => {
    setPlaybackLoading(true);
    let q = supabase.from("playback_logs").select("*").order("played_at", { ascending: false }).limit(1000);
    if (activeOrgId) q = q.eq("org_id", activeOrgId);
    const { data } = await q;
    setPlaybackLogs(data || []);
    setPlaybackLoading(false);
  };

  const fetchAll = async () => {
    await Promise.all([fetchDeviceLogs(), fetchActivityLogs(), fetchPlaybackLogs()]);
  };

  useEffect(() => { fetchAll(); }, [activeOrgId]);

  // --- Device filters ---
  const filteredDevice = useMemo(() => {
    return deviceLogs.filter(l => {
      if (deviceFilterType !== "all" && l.event_type !== deviceFilterType) return false;
      if (deviceFilterScreen !== "all" && l.screen_id !== deviceFilterScreen) return false;
      if (deviceFilterOrg === "none" && l.org_id) return false;
      if (deviceFilterOrg !== "all" && deviceFilterOrg !== "none" && l.org_id !== deviceFilterOrg) return false;
      if (deviceSearch) {
        const r = renderScreenLog(l, language);
        const hay = `${r.title} ${r.detail} ${l.event_title} ${l.event_detail} ${l.screen_name || ""}`;
        if (!hay.includes(deviceSearch)) return false;
      }
      return true;
    });
  }, [deviceLogs, deviceFilterType, deviceFilterScreen, deviceFilterOrg, deviceSearch, language]);

  // Reset device page when filters change
  useEffect(() => { setDevicePage(1); }, [deviceFilterType, deviceFilterScreen, deviceFilterOrg, deviceSearch]);

  const deviceTotalPages = Math.max(1, Math.ceil(filteredDevice.length / DEVICE_PAGE_SIZE));
  const paginatedDevice = filteredDevice.slice((devicePage - 1) * DEVICE_PAGE_SIZE, devicePage * DEVICE_PAGE_SIZE);

  // --- Activity filters ---
  const filteredActivity = useMemo(() => {
    let timeStart: Date | null = null;
    if (activityFilterTime === "today") timeStart = startOfDay(new Date());
    else if (activityFilterTime === "week") timeStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    else if (activityFilterTime === "month") timeStart = startOfMonth(new Date());

    return activityLogs.filter(l => {
      if (activityFilterCategory !== "all" && l.category !== activityFilterCategory) return false;
      if (activityFilterOrg === "none" && l.org_id) return false;
      if (activityFilterOrg !== "all" && activityFilterOrg !== "none" && l.org_id !== activityFilterOrg) return false;
      if (timeStart && !isAfter(new Date(l.created_at), timeStart)) return false;
      if (activitySearch && !l.action.includes(activitySearch) && !l.target_name.includes(activitySearch) && !l.detail.includes(activitySearch) && !(l.user_name || "").includes(activitySearch)) return false;
      return true;
    });
  }, [activityLogs, activityFilterCategory, activityFilterOrg, activityFilterTime, activitySearch]);

  // Reset page when filters change
  useEffect(() => { setActivityPage(1); }, [activityFilterCategory, activityFilterOrg, activityFilterTime, activitySearch]);

  const activityTotalPages = Math.max(1, Math.ceil(filteredActivity.length / ACTIVITY_PAGE_SIZE));
  const paginatedActivity = filteredActivity.slice((activityPage - 1) * ACTIVITY_PAGE_SIZE, activityPage * ACTIVITY_PAGE_SIZE);

  // --- Playback filtered data ---
  const filteredPlayback = useMemo(() => {
    return playbackLogs.filter(l => {
      if (playbackFilterScreen !== "all" && l.screen_id !== playbackFilterScreen) return false;
      if (playbackStartDate && new Date(l.played_at) < startOfDay(playbackStartDate)) return false;
      if (playbackEndDate) {
        const endOfEndDate = new Date(playbackEndDate);
        endOfEndDate.setHours(23, 59, 59, 999);
        if (new Date(l.played_at) > endOfEndDate) return false;
      }
      return true;
    });
  }, [playbackLogs, playbackFilterScreen, playbackStartDate, playbackEndDate]);

  const CHART_COLORS = ["hsl(var(--primary))", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899"];

  const playbackSummary = useMemo(() => {
    const map = new Map<string, { count: number; totalSeconds: number }>();
    filteredPlayback.forEach(l => {
      const existing = map.get(l.media_name) || { count: 0, totalSeconds: 0 };
      existing.count += 1;
      existing.totalSeconds += l.duration_seconds;
      map.set(l.media_name, existing);
    });
    return Array.from(map.entries())
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.count - a.count);
  }, [filteredPlayback]);

  // Daily trend - last 14 days (always 14 days regardless of date filter, for consistent stats overview)
  const playbackDaily14 = useMemo(() => {
    const today = new Date();
    const days: { date: string; count: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const day = subDays(today, i);
      const dayStr = format(day, "yyyy-MM-dd");
      const label = format(day, "MM/dd");
      const count = playbackLogs.filter(l => format(new Date(l.played_at), "yyyy-MM-dd") === dayStr).length;
      days.push({ date: label, count });
    }
    return days;
  }, [playbackLogs]);

  // Weekly trend - last 8 weeks
  const playbackWeekly8 = useMemo(() => {
    const today = new Date();
    const weeks: { week: string; count: number }[] = [];
    for (let i = 7; i >= 0; i--) {
      const ws = startOfWeek(subDays(today, i * 7), { weekStartsOn: 1 });
      const we = new Date(ws);
      we.setDate(we.getDate() + 6);
      we.setHours(23, 59, 59, 999);
      const label = format(ws, "MM/dd");
      const count = playbackLogs.filter(l => {
        const d = new Date(l.played_at);
        return d >= ws && d <= we;
      }).length;
      weeks.push({ week: label, count });
    }
    return weeks;
  }, [playbackLogs]);

  // Top 10 hot media (by play count)
  const top10Media = useMemo(() => {
    const map = new Map<string, { count: number; totalSeconds: number }>();
    playbackLogs.forEach(l => {
      const cur = map.get(l.media_name) || { count: 0, totalSeconds: 0 };
      cur.count += 1;
      cur.totalSeconds += l.duration_seconds;
      map.set(l.media_name, cur);
    });
    return Array.from(map.entries())
      .map(([name, s]) => ({ name: name.length > 18 ? name.slice(0, 16) + "…" : name, fullName: name, count: s.count, totalSeconds: s.totalSeconds }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [playbackLogs]);

  // Plays per screen ranking
  const screenRanking = useMemo(() => {
    const map = new Map<string, number>();
    playbackLogs.forEach(l => {
      if (!l.screen_id) return;
      map.set(l.screen_id, (map.get(l.screen_id) || 0) + 1);
    });
    const sMap = new Map(screens.map(s => [s.id, s.name]));
    return Array.from(map.entries())
      .map(([id, count]) => ({ name: sMap.get(id) || "Unknown", count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [playbackLogs, screens]);


  const labels = {
    title: { zh: "系統紀錄", en: "System Logs", ja: "システムログ" },
    subtitle: { zh: "查看設備狀態與使用者操作紀錄", en: "View device status and user activity logs", ja: "デバイスステータスとユーザー操作ログを表示" },
    tabDevice: { zh: "設備紀錄", en: "Device Logs", ja: "デバイスログ" },
    tabActivity: { zh: "操作紀錄", en: "Activity Logs", ja: "操作ログ" },
    searchPlaceholder: { zh: "搜尋紀錄...", en: "Search logs...", ja: "ログを検索..." },
    allTypes: { zh: "所有類型", en: "All Types", ja: "全タイプ" },
    allCategories: { zh: "所有分類", en: "All Categories", ja: "全カテゴリ" },
    allScreens: { zh: "所有螢幕", en: "All Screens", ja: "全スクリーン" },
    allOrgs: { zh: "所有組織", en: "All Orgs", ja: "全組織" },
    unassigned: { zh: "未分配", en: "Unassigned", ja: "未割当" },
    noLogs: { zh: "暫無紀錄", en: "No logs found", ja: "ログなし" },
    totalLogs: { zh: "共 {count} 筆紀錄", en: "{count} logs", ja: "{count} 件のログ" },
    exportExcel: { zh: "匯出 Excel", en: "Export Excel", ja: "Excelエクスポート" },
    allTime: { zh: "所有時間", en: "All Time", ja: "全期間" },
    today: { zh: "今天", en: "Today", ja: "今日" },
    thisWeek: { zh: "本週", en: "This Week", ja: "今週" },
    thisMonth: { zh: "本月", en: "This Month", ja: "今月" },
    tabPlayback: { zh: "播放日誌", en: "Playback Reports", ja: "再生レポート" },
  };

  const handleExportDeviceExcel = () => {
    const headers = { zh: ["時間", "螢幕", "操作者", "事件類型", "事件標題", "詳細"], en: ["Time", "Screen", "Operator", "Type", "Title", "Detail"], ja: ["時間", "スクリーン", "操作者", "タイプ", "タイトル", "詳細"] }[language];
    const rows = filteredDevice.map(l => {
      const r = renderScreenLog(l, language);
      return [
        format(new Date(l.created_at), "yyyy-MM-dd HH:mm:ss"),
        l.screen_name || "", l.operator_name || "-",
        (DEVICE_TYPE_CONFIG[l.event_type]?.label[language]) || l.event_type,
        r.title, r.detail,
      ];
    });
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws["!cols"] = [{ wch: 20 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 24 }, { wch: 36 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, labels.tabDevice[language]);
    XLSX.writeFile(wb, `device-logs-${format(new Date(), "yyyyMMdd-HHmm")}.xlsx`);
  };

  const handleExportActivityExcel = () => {
    const headers = { zh: ["時間", "操作人員", "操作內容", "分類", "目標", "詳細", "IP 地址"], en: ["Time", "Operator", "Action", "Category", "Target", "Detail", "IP Address"], ja: ["時間", "操作者", "操作内容", "カテゴリ", "対象", "詳細", "IPアドレス"] }[language];
    const rows = filteredActivity.map(l => [
      format(new Date(l.created_at), "yyyy-MM-dd HH:mm:ss"),
      l.user_name || "",
      localizeAction(l.action, language),
      localizeCategory(l.category, language),
      l.target_name || l.target_type,
      localizeActivityDetail(l, language),
      l.ip_address || "-",
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws["!cols"] = [{ wch: 20 }, { wch: 14 }, { wch: 24 }, { wch: 12 }, { wch: 20 }, { wch: 36 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, labels.tabActivity[language]);
    XLSX.writeFile(wb, `activity-logs-${format(new Date(), "yyyyMMdd-HHmm")}.xlsx`);
  };

  const currentFiltered = activeTab === "device" ? filteredDevice : filteredActivity;
  const handleExport = activeTab === "device" ? handleExportDeviceExcel : handleExportActivityExcel;

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{labels.title[language]}</h1>
          <p className="text-sm text-muted-foreground mt-1">{labels.subtitle[language]}</p>
        </div>
        <div className="flex gap-2 self-start">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setCatalogOpen(true)}>
            <BookOpenText className="w-4 h-4" />
            {auditCatalogTriggerLabel(language)}
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={handleExport} disabled={currentFiltered.length === 0}>
            <Download className="w-4 h-4" />
            {labels.exportExcel[language]}
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={fetchAll}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <AuditCatalogDialog open={catalogOpen} onOpenChange={setCatalogOpen} />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="device" className="gap-1.5">
            <Monitor className="w-3.5 h-3.5" />{labels.tabDevice[language]}
          </TabsTrigger>
          <TabsTrigger value="activity" className="gap-1.5">
            <User className="w-3.5 h-3.5" />{labels.tabActivity[language]}
          </TabsTrigger>
          <TabsTrigger value="playback" className="gap-1.5">
            <BarChart3 className="w-3.5 h-3.5" />{labels.tabPlayback[language]}
          </TabsTrigger>
        </TabsList>

        {/* ===== Device Logs Tab ===== */}
        <TabsContent value="device" className="space-y-4 mt-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder={labels.searchPlaceholder[language]} value={deviceSearch} onChange={e => setDeviceSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={deviceFilterType} onValueChange={setDeviceFilterType}>
              <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{labels.allTypes[language]}</SelectItem>
                {Object.entries(DEVICE_TYPE_CONFIG).map(([key, cfg]) => (
                  <SelectItem key={key} value={key}>{cfg.label[language]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={deviceFilterScreen} onValueChange={setDeviceFilterScreen}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{labels.allScreens[language]}</SelectItem>
                {screens.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {isAdmin && orgs.length > 0 && (
              <Select value={deviceFilterOrg} onValueChange={setDeviceFilterOrg}>
                <SelectTrigger className="w-[180px]">
                  <Building2 className="w-4 h-4 mr-2 text-muted-foreground" /><SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{labels.allOrgs[language]}</SelectItem>
                  <SelectItem value="none">{labels.unassigned[language]}</SelectItem>
                  {orgs.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{labels.totalLogs[language].replace("{count}", String(filteredDevice.length))}</p>
          {deviceLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
          ) : filteredDevice.length === 0 ? (
            <Card className="p-12 text-center text-muted-foreground"><FileText className="w-10 h-10 mx-auto mb-3 opacity-40" /><p>{labels.noLogs[language]}</p></Card>
          ) : (
            <div className="space-y-2">
              {paginatedDevice.map((log, i) => {
                const cfg = DEVICE_TYPE_CONFIG[log.event_type] || DEVICE_TYPE_CONFIG.system;
                const Icon = cfg.icon;
                const rendered = renderScreenLog(log, language);
                return (
                  <Card key={log.id} className={`p-3 flex items-start gap-3 shadow-sm opacity-0 animate-fade-in stagger-${Math.min(i + 1, 8)}`}>
                    <div className={`mt-0.5 p-1.5 rounded-lg ${cfg.color}`}><Icon className="w-4 h-4" /></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-foreground">{rendered.title}</span>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">{cfg.label[language]}</Badge>
                      </div>
                      {rendered.detail && <p className="text-xs text-muted-foreground mt-0.5">{rendered.detail}</p>}
                      <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground/60">
                        <span className="flex items-center gap-1"><Monitor className="w-3 h-3" />{log.screen_name}</span>
                        {log.operator_name && <span className="flex items-center gap-1"><User className="w-3 h-3" />{log.operator_name}</span>}
                        <span>{format(new Date(log.created_at), "yyyy-MM-dd HH:mm:ss")}</span>
                      </div>
                    </div>
                  </Card>
                );
              })}
              {deviceTotalPages > 1 && (
                <div className="flex items-center justify-between pt-2">
                  <p className="text-xs text-muted-foreground">
                    {{ zh: `第 ${devicePage} / ${deviceTotalPages} 頁`, en: `Page ${devicePage} of ${deviceTotalPages}`, ja: `${devicePage} / ${deviceTotalPages} ページ` }[language]}
                  </p>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon" className="h-7 w-7" disabled={devicePage <= 1} onClick={() => setDevicePage(p => p - 1)}>
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <Button variant="outline" size="icon" className="h-7 w-7" disabled={devicePage >= deviceTotalPages} onClick={() => setDevicePage(p => p + 1)}>
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        {/* ===== Activity Logs Tab ===== */}
        <TabsContent value="activity" className="space-y-4 mt-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder={labels.searchPlaceholder[language]} value={activitySearch} onChange={e => setActivitySearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={activityFilterCategory} onValueChange={setActivityFilterCategory}>
              <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{labels.allCategories[language]}</SelectItem>
                {Object.entries(ACTIVITY_CATEGORY_CONFIG).map(([key, cfg]) => (
                  <SelectItem key={key} value={key}>{cfg.label[language]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={activityFilterTime} onValueChange={setActivityFilterTime}>
              <SelectTrigger className="w-[130px]">
                <CalendarClock className="w-4 h-4 mr-2 text-muted-foreground" /><SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{labels.allTime[language]}</SelectItem>
                <SelectItem value="today">{labels.today[language]}</SelectItem>
                <SelectItem value="week">{labels.thisWeek[language]}</SelectItem>
                <SelectItem value="month">{labels.thisMonth[language]}</SelectItem>
              </SelectContent>
            </Select>
            {isAdmin && orgs.length > 0 && (
              <Select value={activityFilterOrg} onValueChange={setActivityFilterOrg}>
                <SelectTrigger className="w-[180px]">
                  <Building2 className="w-4 h-4 mr-2 text-muted-foreground" /><SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{labels.allOrgs[language]}</SelectItem>
                  <SelectItem value="none">{labels.unassigned[language]}</SelectItem>
                  {orgs.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{labels.totalLogs[language].replace("{count}", String(filteredActivity.length))}</p>
          {activityLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
          ) : filteredActivity.length === 0 ? (
            <Card className="p-12 text-center text-muted-foreground"><FileText className="w-10 h-10 mx-auto mb-3 opacity-40" /><p>{labels.noLogs[language]}</p></Card>
          ) : (
            <Card className="overflow-hidden shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-[160px]">{{ zh: "操作人員", en: "Operator", ja: "操作者" }[language]}</TableHead>
                    <TableHead>{{ zh: "操作內容", en: "Action", ja: "操作内容" }[language]}</TableHead>
                    <TableHead className="w-[120px]">{{ zh: "操作時間", en: "Time", ja: "時間" }[language]}</TableHead>
                    <TableHead className="w-[130px]">{{ zh: "IP 地址", en: "IP Address", ja: "IPアドレス" }[language]}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedActivity.map((log) => {
                    const colors = getActionColor(log.action, log.category);
                    return (
                      <TableRow key={log.id} className={`${colors.bg} border-b border-border/50 transition-colors`}>
                        <TableCell className="py-2.5">
                          <div className="flex items-center gap-2">
                            <User className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="text-sm font-medium text-foreground">{log.user_name || "-"}</span>
                          </div>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${colors.dot}`} />
                            <div className="min-w-0">
                              <span className={`text-sm font-medium ${colors.text}`}>{log.action}</span>
                              {log.target_name && <span className="text-xs text-muted-foreground ml-2">— {log.target_name}</span>}
                              {log.detail && <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-md">{log.detail}</p>}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                          {format(new Date(log.created_at), "MM-dd HH:mm:ss")}
                        </TableCell>
                        <TableCell className="py-2.5 text-xs text-muted-foreground font-mono">
                          {log.ip_address || "-"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {activityTotalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border/50">
                  <p className="text-xs text-muted-foreground">
                    {{ zh: `第 ${activityPage} / ${activityTotalPages} 頁`, en: `Page ${activityPage} of ${activityTotalPages}`, ja: `${activityPage} / ${activityTotalPages} ページ` }[language]}
                  </p>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon" className="h-7 w-7" disabled={activityPage <= 1} onClick={() => setActivityPage(p => p - 1)}>
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <Button variant="outline" size="icon" className="h-7 w-7" disabled={activityPage >= activityTotalPages} onClick={() => setActivityPage(p => p + 1)}>
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          )}
        </TabsContent>

        {/* ===== Playback Reports Tab ===== */}
        <TabsContent value="playback" className="space-y-6 mt-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-3 items-center">
            <Select value={playbackFilterScreen} onValueChange={setPlaybackFilterScreen}>
              <SelectTrigger className="w-[180px]">
                <Monitor className="w-4 h-4 mr-2 text-muted-foreground" /><SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{{ zh: "所有螢幕", en: "All Screens", ja: "全スクリーン" }[language]}</SelectItem>
                {screens.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn("w-[150px] justify-start text-left font-normal", !playbackStartDate && "text-muted-foreground")}>
                  <CalendarIcon className="w-4 h-4 mr-2" />
                  {playbackStartDate ? format(playbackStartDate, "yyyy-MM-dd") : <span>{{ zh: "起始日期", en: "Start date", ja: "開始日" }[language]}</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={playbackStartDate} onSelect={setPlaybackStartDate} initialFocus className={cn("p-3 pointer-events-auto")} />
              </PopoverContent>
            </Popover>
            <span className="text-muted-foreground text-sm">~</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn("w-[150px] justify-start text-left font-normal", !playbackEndDate && "text-muted-foreground")}>
                  <CalendarIcon className="w-4 h-4 mr-2" />
                  {playbackEndDate ? format(playbackEndDate, "yyyy-MM-dd") : <span>{{ zh: "結束日期", en: "End date", ja: "終了日" }[language]}</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={playbackEndDate} onSelect={setPlaybackEndDate} initialFocus className={cn("p-3 pointer-events-auto")} />
              </PopoverContent>
            </Popover>
            {(playbackStartDate || playbackEndDate || playbackFilterScreen !== "all") && (
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={() => { setPlaybackFilterScreen("all"); setPlaybackStartDate(undefined); setPlaybackEndDate(undefined); }}>
                <X className="w-3.5 h-3.5" />{{ zh: "清除篩選", en: "Clear", ja: "クリア" }[language]}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{{ zh: `共 ${filteredPlayback.length} 筆播放紀錄`, en: `${filteredPlayback.length} playback records`, ja: `${filteredPlayback.length} 件の再生記録` }[language]}</p>

          {playbackLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
          ) : filteredPlayback.length === 0 ? (
            <Card className="p-12 text-center text-muted-foreground"><BarChart3 className="w-10 h-10 mx-auto mb-3 opacity-40" /><p>{{ zh: "暫無播放紀錄", en: "No playback data", ja: "再生データなし" }[language]}</p></Card>
          ) : (
            <>
              {/* === Stats overview: 4 charts === */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* 1. Daily plays - last 14 days */}
                <Card className="p-5">
                  <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-primary" />
                    {{ zh: "每日播放次數（近 14 天）", en: "Daily Plays (Last 14 Days)", ja: "日別再生回数（直近14日）" }[language]}
                  </h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={playbackDaily14} barSize={16}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                      <Tooltip
                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 13 }}
                        labelStyle={{ color: "hsl(var(--foreground))" }}
                        formatter={(value: number) => [value, { zh: "播放次數", en: "Plays", ja: "再生回数" }[language]]}
                      />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]} fill="hsl(var(--primary))" />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>

                {/* 2. Weekly plays - last 8 weeks */}
                <Card className="p-5">
                  <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-emerald-500" />
                    {{ zh: "每週播放次數（近 8 週）", en: "Weekly Plays (Last 8 Weeks)", ja: "週別再生回数（直近8週）" }[language]}
                  </h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={playbackWeekly8} barSize={26}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="week" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                      <Tooltip
                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 13 }}
                        labelStyle={{ color: "hsl(var(--foreground))" }}
                        labelFormatter={(label) => `${{ zh: "週起", en: "Week of", ja: "週開始" }[language]} ${label}`}
                        formatter={(value: number) => [value, { zh: "播放次數", en: "Plays", ja: "再生回数" }[language]]}
                      />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]} fill="#22c55e" />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>

                {/* 3. Top 10 hot media (horizontal-style by using vertical layout) */}
                <Card className="p-5">
                  <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                    <Play className="w-4 h-4 text-amber-500" />
                    {{ zh: "Top 10 熱播素材", en: "Top 10 Hot Media", ja: "Top 10 人気素材" }[language]}
                  </h3>
                  {top10Media.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-12">{{ zh: "暫無資料", en: "No data", ja: "データなし" }[language]}</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={Math.max(220, top10Media.length * 26)}>
                      <BarChart data={top10Media} layout="vertical" barSize={16} margin={{ left: 8, right: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} className="fill-muted-foreground" width={110} />
                        <Tooltip
                          contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 13 }}
                          labelStyle={{ color: "hsl(var(--foreground))" }}
                          labelFormatter={(_, items) => (items?.[0]?.payload as { fullName?: string })?.fullName || ""}
                          formatter={(value: number) => [value, { zh: "播放次數", en: "Plays", ja: "再生回数" }[language]]}
                        />
                        <Bar dataKey="count" radius={[0, 4, 4, 0]} fill="#f59e0b" />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </Card>

                {/* 4. Plays per screen ranking */}
                <Card className="p-5">
                  <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                    <Monitor className="w-4 h-4 text-violet-500" />
                    {{ zh: "各螢幕播放次數排行", en: "Plays per Screen", ja: "スクリーン別再生ランキング" }[language]}
                  </h3>
                  {screenRanking.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-12">{{ zh: "暫無資料", en: "No data", ja: "データなし" }[language]}</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={Math.max(220, screenRanking.length * 26)}>
                      <BarChart data={screenRanking} layout="vertical" barSize={16} margin={{ left: 8, right: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} className="fill-muted-foreground" width={110} />
                        <Tooltip
                          contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 13 }}
                          labelStyle={{ color: "hsl(var(--foreground))" }}
                          formatter={(value: number) => [value, { zh: "播放次數", en: "Plays", ja: "再生回数" }[language]]}
                        />
                        <Bar dataKey="count" radius={[0, 4, 4, 0]} fill="#8b5cf6" />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </Card>
              </div>

              {/* Summary table */}
              <Card className="overflow-hidden shadow-sm">
                <div className="px-4 py-3 border-b border-border/50">
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Play className="w-4 h-4 text-primary" />
                    {{ zh: "媒體播放統計", en: "Media Playback Statistics", ja: "メディア再生統計" }[language]}
                  </h3>
                </div>
                  <Table>
                    <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>{{ zh: "媒體名稱", en: "Media Name", ja: "メディア名" }[language]}</TableHead>
                      <TableHead className="w-[140px] text-right">{{ zh: "總播放次數", en: "Total Plays", ja: "総再生回数" }[language]}</TableHead>
                      <TableHead className="w-[140px] text-right">{{ zh: "總播放時數", en: "Total Duration", ja: "総再生時間" }[language]}</TableHead>
                      <TableHead className="w-[120px]">{{ zh: "佔比", en: "Share", ja: "割合" }[language]}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {playbackSummary.map((item, i) => {
                      const totalPlays = playbackSummary.reduce((s, x) => s + x.count, 0);
                      const pct = totalPlays > 0 ? Math.round((item.count / totalPlays) * 100) : 0;
                      const hours = Math.floor(item.totalSeconds / 3600);
                      const mins = Math.floor((item.totalSeconds % 3600) / 60);
                      const secs = item.totalSeconds % 60;
                      const durationStr = hours > 0 ? `${hours}h ${mins}m` : mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
                      return (
                        <TableRow key={item.name} className={i === 0 ? "bg-primary/5" : ""}>
                          <TableCell className="py-2.5 text-sm font-bold text-muted-foreground">{i + 1}</TableCell>
                          <TableCell className="py-2.5">
                            <div className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                              <span className={`text-sm font-medium ${i === 0 ? "text-primary" : "text-foreground"}`}>{item.name}</span>
                              {i === 0 && <Badge className="text-[10px] px-1.5 py-0 h-4 bg-primary/10 text-primary border-0">🔥 TOP</Badge>}
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5 text-right">
                            <span className="text-sm font-semibold text-foreground">{item.count.toLocaleString()}</span>
                            <span className="text-xs text-muted-foreground ml-1">{{ zh: "次", en: "plays", ja: "回" }[language]}</span>
                          </TableCell>
                          <TableCell className="py-2.5 text-right">
                            <span className="flex items-center justify-end gap-1 text-sm text-muted-foreground">
                              <Clock className="w-3 h-3" />{durationStr}
                            </span>
                          </TableCell>
                          <TableCell className="py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                              </div>
                              <span className="text-xs text-muted-foreground w-8 text-right">{pct}%</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
