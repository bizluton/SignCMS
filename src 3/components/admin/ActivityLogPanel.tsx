import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";
import { useProfiles } from "@/contexts/ProfilesContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Download, FileSpreadsheet, AlertTriangle, ArrowUpDown, BookOpenText, FileArchive } from "lucide-react";
import { format } from "date-fns";
import * as XLSX from "xlsx";
import { localizeAction, localizeCategory, localizeDetail, localizeActivityDetail } from "@/lib/activityLogI18n";
import ActivityLogFilters from "./activity-log/ActivityLogFilters";
import ActivityLogList from "./activity-log/ActivityLogList";
import SecurityStatCard from "./activity-log/SecurityStatCard";
import AuditCatalogDialog, { auditCatalogTriggerLabel } from "./AuditCatalogDialog";
import { ActivityLog, ACTIVITY_LOG_PAGE_SIZE } from "./activity-log/types";
import { useIsSystemAdmin } from "@/hooks/useIsSystemAdmin";

export default function ActivityLogPanel() {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const { activeOrgId } = useActiveOrg();
  const { ensureProfiles, getDisplayName, profilesVersion } = useProfiles();
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [catalogOpen, setCatalogOpen] = useState(false);
  const { isSystemAdmin } = useIsSystemAdmin();

  useEffect(() => { fetchLogs(true); }, [activeOrgId]);

  const fetchLogs = async (reset: boolean) => {
    if (reset) setLoading(true); else setLoadingMore(true);

    const offset = reset ? 0 : logs.length;
    let logQuery = supabase
      .from("activity_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .range(offset, offset + ACTIVITY_LOG_PAGE_SIZE - 1);
    if (activeOrgId) {
      logQuery = logQuery.eq("org_id", activeOrgId);
    }

    const { data: logData } = await logQuery;
    let filtered = logData || [];

    if (!activeOrgId && !isSystemAdmin && user) {
      const { data: myMembers } = await supabase.from("team_members").select("team_id").eq("user_id", user.id);
      if (myMembers) {
        const teamIds = myMembers.map(m => m.team_id);
        const { data: teams } = await supabase.from("teams").select("id, org_id").in("id", teamIds);
        const myOrgIds = new Set((teams || []).map(t => t.org_id));
        filtered = filtered.filter(l =>
          l.user_id === user.id || (l.org_id && myOrgIds.has(l.org_id))
        );
      }
    }

    // Batch-load any uploader profiles we don't already have cached
    await ensureProfiles(filtered.map(l => l.user_id));

    const mapped = filtered.map(l => ({ ...l, display_name: getDisplayName(l.user_id) || undefined }));
    setHasMore((logData?.length || 0) === ACTIVITY_LOG_PAGE_SIZE);
    setLogs(prev => reset ? mapped : [...prev, ...mapped]);
    if (reset) setLoading(false); else setLoadingMore(false);
  };

  const categories = useMemo(() => {
    const set = new Set(logs.map(l => l.category).filter(Boolean));
    return Array.from(set).sort();
  }, [logs]);

  const actions = useMemo(() => {
    const set = new Set(
      logs
        .filter(l => categoryFilter === "all" || l.category === categoryFilter)
        .map(l => l.action)
        .filter(Boolean)
    );
    return Array.from(set).sort();
  }, [logs, categoryFilter]);

  useEffect(() => {
    if (actionFilter !== "all" && !actions.includes(actionFilter)) {
      setActionFilter("all");
    }
  }, [actions, actionFilter]);

  const visibleLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fromTs = dateFrom ? new Date(dateFrom.getFullYear(), dateFrom.getMonth(), dateFrom.getDate()).getTime() : null;
    const toTs = dateTo ? new Date(dateTo.getFullYear(), dateTo.getMonth(), dateTo.getDate(), 23, 59, 59, 999).getTime() : null;
    return logs.filter(l => {
      if (categoryFilter !== "all" && l.category !== categoryFilter) return false;
      if (actionFilter !== "all") {
        const allowed = actionFilter.split(",");
        if (!allowed.includes(l.action)) return false;
      }
      if (fromTs || toTs) {
        const ts = new Date(l.created_at).getTime();
        if (fromTs && ts < fromTs) return false;
        if (toTs && ts > toTs) return false;
      }
      if (q) {
        const hay = `${l.target_name ?? ""} ${localizeActivityDetail(l, language)} ${localizeDetail(l.detail, language)} ${l.display_name ?? ""} ${l.user_id}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [logs, categoryFilter, actionFilter, search, dateFrom, dateTo, language]);

  const escapeCsv = (val: string) => {
    if (val == null) return "";
    const s = String(val);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  /**
   * Build the rows used by both CSV and Excel exports so the two formats stay
   * in lockstep. `detail` is rendered via the new `localizeActivityDetail`
   * helper so structured (action_code + action_params) rows respect the
   * current UI language, falling back to legacy plain-text detail.
   */
  const buildExportRows = () => {
    const headers = {
      zh: ["時間", "分類", "操作", "操作人員", "User ID", "目標", "詳細", "IP 地址"],
      en: ["Timestamp", "Category", "Action", "Operator", "User ID", "Target", "Detail", "IP Address"],
      ja: ["時刻", "カテゴリ", "操作", "操作者", "ユーザー ID", "対象", "詳細", "IP アドレス"],
    }[language];
    const rows = visibleLogs.map(l => [
      format(new Date(l.created_at), "yyyy-MM-dd HH:mm:ss"),
      localizeCategory(l.category, language),
      localizeAction(l.action, language),
      l.display_name || "",
      l.user_id,
      l.target_name || "",
      localizeActivityDetail(l, language) || "",
      l.ip_address || "",
    ]);
    return { headers, rows };
  };

  const handleExportCSV = () => {
    const { headers, rows } = buildExportRows();
    const csvRows = rows.map(r => r.map(escapeCsv).join(","));
    const csv = "\uFEFF" + [headers.join(","), ...csvRows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `activity-logs-${format(new Date(), "yyyyMMdd-HHmmss")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportExcel = () => {
    const { headers, rows } = buildExportRows();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws["!cols"] = [
      { wch: 20 }, { wch: 14 }, { wch: 24 }, { wch: 16 }, { wch: 36 },
      { wch: 24 }, { wch: 48 }, { wch: 16 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "activity-logs");
    XLSX.writeFile(wb, `activity-logs-${format(new Date(), "yyyyMMdd-HHmmss")}.xlsx`);
  };

  const clearDates = () => { setDateFrom(undefined); setDateTo(undefined); };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t("activityLogTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("activityLogSubtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setCatalogOpen(true)}>
            <BookOpenText className="w-4 h-4 mr-2" />
            {auditCatalogTriggerLabel(language)}
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={visibleLogs.length === 0}>
            <Download className="w-4 h-4 mr-2" />
            {t("activityLogExportCSV")}
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={visibleLogs.length === 0}>
            <FileSpreadsheet className="w-4 h-4 mr-2" />
            {t("activityLogExportExcel")}
          </Button>
        </div>
      </div>

      <AuditCatalogDialog open={catalogOpen} onOpenChange={setCatalogOpen} />

      <SecurityStatCard />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{language === "zh" ? "快速篩選：" : language === "ja" ? "クイックフィルター:" : "Quick filter:"}</span>
        <Badge
          variant={categoryFilter === "system" && actionFilter === "client_error_boundary" ? "default" : "outline"}
          className="cursor-pointer hover:bg-accent gap-1"
          onClick={() => {
            const active = categoryFilter === "system" && actionFilter === "client_error_boundary";
            setCategoryFilter(active ? "all" : "system");
            setActionFilter(active ? "all" : "client_error_boundary");
          }}
        >
          <AlertTriangle className="w-3 h-3" />
          {language === "zh" ? "前端崩潰" : language === "ja" ? "フロントエンドクラッシュ" : "Frontend crashes"}
        </Badge>
        <Badge
          variant={categoryFilter === "system" && actionFilter === "all" ? "default" : "outline"}
          className="cursor-pointer hover:bg-accent"
          onClick={() => {
            const active = categoryFilter === "system" && actionFilter === "all";
            setCategoryFilter(active ? "all" : "system");
            setActionFilter("all");
          }}
        >
          {language === "zh" ? "系統事件" : language === "ja" ? "システムイベント" : "System events"}
        </Badge>
        <Badge
          variant={categoryFilter === "admin" && actionFilter === "change_org_plan_tier" ? "default" : "outline"}
          className="cursor-pointer hover:bg-accent gap-1"
          onClick={() => {
            const active = categoryFilter === "admin" && actionFilter === "change_org_plan_tier";
            setCategoryFilter(active ? "all" : "admin");
            setActionFilter(active ? "all" : "change_org_plan_tier");
          }}
        >
          <ArrowUpDown className="w-3 h-3" />
          {language === "zh" ? "方案變更" : language === "ja" ? "プラン変更" : "Plan changes"}
        </Badge>
        <Badge
          variant={categoryFilter === "schedule" && actionFilter === "export_schedule" ? "default" : "outline"}
          className="cursor-pointer hover:bg-accent gap-1"
          onClick={() => {
            const active = categoryFilter === "schedule" && actionFilter === "export_schedule";
            setCategoryFilter(active ? "all" : "schedule");
            setActionFilter(active ? "all" : "export_schedule");
          }}
        >
          <FileArchive className="w-3 h-3" />
          {language === "zh" ? "排程匯出" : language === "ja" ? "スケジュールエクスポート" : "Schedule exports"}
        </Badge>
        <Badge
          variant={categoryFilter === "schedule" && actionFilter === "export_schedule_usb,export_schedule_usb_folder" ? "default" : "outline"}
          className="cursor-pointer hover:bg-accent gap-1"
          onClick={() => {
            const active = categoryFilter === "schedule" && actionFilter === "export_schedule_usb,export_schedule_usb_folder";
            setCategoryFilter(active ? "all" : "schedule");
            setActionFilter(active ? "all" : "export_schedule_usb,export_schedule_usb_folder");
          }}
        >
          <FileArchive className="w-3 h-3" />
          {language === "zh" ? "USB 匯出" : language === "ja" ? "USB エクスポート" : "USB exports"}
        </Badge>
        <Badge
          variant={categoryFilter === "schedule" && actionFilter === "import_schedule" ? "default" : "outline"}
          className="cursor-pointer hover:bg-accent gap-1"
          onClick={() => {
            const active = categoryFilter === "schedule" && actionFilter === "import_schedule";
            setCategoryFilter(active ? "all" : "schedule");
            setActionFilter(active ? "all" : "import_schedule");
          }}
        >
          <FileArchive className="w-3 h-3" />
          {language === "zh" ? "排程匯入" : language === "ja" ? "スケジュールインポート" : "Schedule imports"}
        </Badge>
      </div>

      <ActivityLogFilters
        search={search}
        onSearchChange={setSearch}
        categoryFilter={categoryFilter}
        onCategoryChange={setCategoryFilter}
        actionFilter={actionFilter}
        onActionChange={setActionFilter}
        categories={categories}
        actions={actions}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onClearDates={clearDates}
      />

      <p className="text-xs text-muted-foreground">
        {t("activityLogLoadedCount")
          .replace("{loaded}", String(logs.length))
          .replace("{count}", String(visibleLogs.length))}
      </p>

      <ActivityLogList logs={visibleLogs} />

      <div className="flex justify-center pt-2">
        {hasMore ? (
          <Button variant="outline" size="sm" onClick={() => fetchLogs(false)} disabled={loadingMore}>
            {loadingMore ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t("activityLogLoading")}</>
            ) : (
              t("activityLogLoadMore")
            )}
          </Button>
        ) : (
          logs.length > 0 && <span className="text-xs text-muted-foreground">{t("activityLogNoMore")}</span>
        )}
      </div>
    </div>
  );
}
