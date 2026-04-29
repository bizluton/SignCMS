import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Monitor, WifiOff, Loader2, CalendarClock, AlertTriangle,
  ShieldAlert, Send, Plus, Upload, Clock, Zap, RefreshCw, ArrowRight, Mail, Users, Image as ImageIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";
import { useNavigate } from "react-router-dom";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import { format } from "date-fns";
import { useUserRole } from "@/hooks/useUserRole";
import { CSAgentCards } from "@/components/dashboard/CSAgentCards";
import { PlanQuotaWidget } from "@/components/dashboard/PlanQuotaWidget";
import { OfflineScreenAlertsPanel } from "@/components/dashboard/OfflineScreenAlertsPanel";
import { EstimatedPlaysWidget } from "@/components/dashboard/EstimatedPlaysWidget";
import { PageSkeleton } from "@/components/PageSkeleton";

const PIE_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--destructive))",
  "hsl(142 76% 36%)",
  "hsl(38 92% 50%)",
];

const TOOLTIP_STYLE = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  fontSize: 13,
};

const AUTO_REFRESH_INTERVAL = 30_000;

// Compact ring-progress component (semantic colors)
function HealthRing({ value, total, onClick, title }: { value: number; total: number; onClick?: () => void; title?: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const r = 38;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick ? (e: React.MouseEvent) => { e.stopPropagation(); onClick(); } : undefined}
      title={title}
      className={`relative w-24 h-24 shrink-0 rounded-full ${onClick ? "cursor-pointer transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" : ""}`}
    >
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="8" />
        <circle
          cx="50" cy="50" r={r} fill="none"
          stroke={pct >= 80 ? "hsl(var(--success))" : pct >= 50 ? "hsl(38 92% 50%)" : "hsl(var(--destructive))"}
          strokeWidth="8" strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-xl font-bold tracking-tight text-foreground">{pct}%</span>
        <span className="text-[10px] text-muted-foreground">{value}/{total}</span>
      </div>
    </Wrapper>
  );
}

export default function DashboardPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { activeOrgId } = useActiveOrg();
  const { isCsAgent } = useUserRole();

  type ScreenRow = { id: string; name: string; branch: string | null; online: boolean; updated_at: string; org_id: string };
  type ScheduleRow = { id: string; name: string; screen_id: string; enabled: boolean; start_time: string | null; end_time: string | null };
  type MediaRow = { id: string; name: string; type: string };
  type ScheduleItemRow = { id: string; schedule_id: string; media_id: string | null; duration: number };
  type PublishCountRow = { key: string; count: number };

  const [screens, setScreens] = useState<ScreenRow[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [mediaItems, setMediaItems] = useState<MediaRow[]>([]);
  const [scheduleItems, setScheduleItems] = useState<ScheduleItemRow[]>([]);
  const [publishRecords, setPublishRecords] = useState<PublishCountRow[]>([]);
  const [emergencyCount, setEmergencyCount] = useState(0);
  const [pendingInvitations, setPendingInvitations] = useState(0);
  const [memberCount, setMemberCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchData = useCallback(async () => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const fromTable = (table: string) => supabase.from(table as Parameters<typeof supabase.from>[0]);

    let screensQ = supabase.from("screens").select("id, name, branch, online, updated_at, org_id").order("created_at");
    let schedulesQ = fromTable("schedules").select("id, name, screen_id, enabled, start_time, end_time").order("created_at");
    let mediaQ = supabase.from("media_items").select("id, name, type").is("deleted_at", null).order("created_at", { ascending: false });
    const emergencyQ = supabase.from("publish_records").select("id").eq("status", "emergency");
    const todayPubQ = supabase.from("publish_records").select("id").gte("created_at", todayStart.toISOString());
    const scheduledQ = supabase.from("publish_records").select("id").eq("status", "scheduled");
    let invQ = supabase.from("invitations").select("id, expires_at").eq("status", "pending");
    let membersQ = supabase.from("team_members").select("id, user_id, teams!inner(org_id)");

    if (activeOrgId) {
      screensQ = screensQ.eq("org_id", activeOrgId);
      schedulesQ = schedulesQ.eq("org_id", activeOrgId);
      mediaQ = mediaQ.eq("org_id", activeOrgId);
      invQ = invQ.eq("org_id", activeOrgId);
      membersQ = membersQ.eq("teams.org_id", activeOrgId);
    }

    const scheduleItemsQ = fromTable("schedule_items").select("id, schedule_id, media_id, duration").order("sort_order");

    const [screensRes, schedulesRes, mediaRes, itemsRes, emergencyRes, todayPubRes, scheduledRes, invRes, membersRes] =
      await Promise.all([
        screensQ, schedulesQ, mediaQ,
        scheduleItemsQ,
        emergencyQ, todayPubQ, scheduledQ, invQ, membersQ,
      ]);

    const filteredScreens = (screensRes.data || []) as ScreenRow[];
    setScreens(filteredScreens);

    const filteredSchedules = (schedulesRes.data || []) as unknown as ScheduleRow[];
    setSchedules(filteredSchedules);
    setMediaItems((mediaRes.data || []) as MediaRow[]);

    const scheduleIds = new Set(filteredSchedules.map((s) => s.id));
    const allItems = (itemsRes.data || []) as unknown as ScheduleItemRow[];
    const filteredItems = activeOrgId ? allItems.filter((si) => scheduleIds.has(si.schedule_id)) : allItems;
    setScheduleItems(filteredItems);

    setEmergencyCount((emergencyRes.data || []).length);
    const invData = (invRes.data || []) as { id: string; expires_at: string }[];
    const pendingInvs = invData.filter((inv) => new Date(inv.expires_at) > new Date());
    setPendingInvitations(pendingInvs.length);

    const membersData = (membersRes.data || []) as { id: string; user_id: string }[];
    const uniqueMembers = new Set(membersData.map((m) => m.user_id));
    setMemberCount(uniqueMembers.size);

    setPublishRecords([
      { key: "today", count: (todayPubRes.data || []).length },
      { key: "scheduled", count: (scheduledRes.data || []).length },
    ]);
    setLastRefresh(new Date());
    setLoading(false);
  }, [activeOrgId]);

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, AUTO_REFRESH_INTERVAL);
    return () => clearInterval(timer);
  }, [fetchData]);

  const onlineCount = useMemo(() => screens.filter((s) => s.online).length, [screens]);
  const offlineCount = useMemo(() => screens.filter((s) => !s.online).length, [screens]);
  const enabledSchedules = useMemo(() => schedules.filter((s) => s.enabled).length, [schedules]);
  const todayPublishCount = publishRecords.find((r) => r.key === "today")?.count || 0;
  const scheduledCount = publishRecords.find((r) => r.key === "scheduled")?.count || 0;

  const imageCount = useMemo(() => mediaItems.filter((m) => m.type === "image").length, [mediaItems]);
  const videoCount = useMemo(() => mediaItems.filter((m) => m.type === "video").length, [mediaItems]);
  const widgetCount = useMemo(() => mediaItems.filter((m) => m.type === "widget").length, [mediaItems]);

  const branchData = useMemo(() => {
    const map = new Map<string, number>();
    screens.forEach((s) => {
      const g = s.branch || t("screensUngrouped");
      map.set(g, (map.get(g) || 0) + 1);
    });
    return Array.from(map.entries()).map(([name, count]) => ({ name, count }));
  }, [screens, t]);

  const mediaTypeData = useMemo(() => {
    const data = [
      { name: t("image"), value: imageCount },
      { name: t("video"), value: videoCount },
    ].filter((d) => d.value > 0);
    if (widgetCount > 0) data.push({ name: "Widget", value: widgetCount });
    return data;
  }, [imageCount, videoCount, widgetCount, t]);

  const mediaUsageData = useMemo(() => {
    const usageMap = new Map<string, number>();
    scheduleItems.forEach((si) => {
      if (si.media_id) usageMap.set(si.media_id, (usageMap.get(si.media_id) || 0) + 1);
    });
    return mediaItems
      .map((m) => ({
        name: m.name.length > 8 ? m.name.slice(0, 8) + "…" : m.name,
        fullName: m.name,
        count: usageMap.get(m.id) || 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [mediaItems, scheduleItems]);

  const scheduleOverview = useMemo(() => {
    const sMap = new Map(screens.map((s) => [s.id, s]));
    return schedules.map((s) => {
      const items = scheduleItems.filter((si) => si.schedule_id === s.id);
      const totalDuration = items.reduce((sum: number, i) => sum + (i.duration || 0), 0);
      const screen = sMap.get(s.screen_id);
      return {
        ...s,
        itemCount: items.length,
        totalDuration,
        screenName: screen ? `${screen.branch || t("screensUngrouped")} – ${screen.name}` : "–",
      };
    });
  }, [schedules, scheduleItems, screens, t]);

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <div className="space-y-8 max-w-7xl">
      {/* Header with gradient backdrop */}
      <header className="relative -mx-4 sm:-mx-6 -mt-4 sm:-mt-6 px-4 sm:px-6 pt-6 pb-8 mb-2 overflow-hidden animate-fade-in">
        <div
          className="absolute inset-0 -z-10 opacity-90"
          style={{
            background: "radial-gradient(ellipse 60% 80% at 0% 0%, hsl(var(--primary) / 0.12), transparent 60%), radial-gradient(ellipse 50% 80% at 100% 0%, hsl(var(--primary) / 0.08), transparent 55%), linear-gradient(180deg, hsl(var(--muted) / 0.3) 0%, transparent 100%)",
          }}
        />
        <div
          className="absolute inset-x-0 bottom-0 h-px -z-10"
          style={{ background: "linear-gradient(90deg, transparent, hsl(var(--border)), transparent)" }}
        />
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">{t("dashTitle")}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t("dashSubtitle")}</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="w-3 h-3 animate-spin shrink-0" style={{ animationDuration: "3s" }} />
            <span>{t("dashLastRefresh")} {format(lastRefresh, "HH:mm:ss")}</span>
          </div>
        </div>
      </header>

      {/* Alerts */}
      {emergencyCount > 0 && (
        <div className="rounded-xl border-2 border-destructive/40 bg-destructive/5 p-4 flex items-center gap-4 animate-pulse shadow-lg shadow-destructive/10">
          <div className="w-12 h-12 rounded-full bg-destructive/15 flex items-center justify-center shrink-0">
            <ShieldAlert className="w-7 h-7 text-destructive" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-bold text-destructive flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {t("dashEmergencyTitle")}
            </p>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t("dashEmergencyDesc").replace("{count}", String(emergencyCount))}
            </p>
          </div>
          <Button variant="destructive" className="shrink-0 gap-2 font-bold" onClick={() => navigate("/publishing")}>
            {t("dashEmergencyAction")}
          </Button>
        </div>
      )}

      {pendingInvitations > 0 && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 flex items-center gap-4 animate-fade-in">
          <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
            <Mail className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">{t("dashPendingInvitations")}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("dashPendingInvitationsDesc").replace("{count}", String(pendingInvitations))}
            </p>
          </div>
          <Button variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={() => navigate("/admin")}>
            {t("dashViewInvitations")}
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}

      {/* Plan quota widget */}
      <PlanQuotaWidget />

      {/* Offline screens alert panel */}
      <OfflineScreenAlertsPanel
        screens={screens.map((s) => ({ ...s, branch: s.branch ?? "" }))}
        activeOrgId={activeOrgId ?? null}
        onChanged={fetchData}
      />

      {/* Estimated plays today widget */}
      <EstimatedPlaysWidget
        schedules={schedules}
        scheduleItems={scheduleItems}
        screens={screens}
      />

      {/* HERO: 3 merged primary cards */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 animate-fade-in">
        {/* Screen Health (online + offline merged with ring) */}
        <Card
          className="p-5 hover-lift cursor-pointer group relative overflow-hidden"
          onClick={() => navigate("/screens")}
        >
          <div className="absolute -right-6 -top-6 w-32 h-32 bg-primary/5 rounded-full blur-2xl group-hover:bg-primary/10 transition-all" />
          <div className="flex items-center justify-between mb-4 relative">
            <div className="flex items-center gap-2">
              <Monitor className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("dashScreenHealth")}</h3>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className="flex items-center gap-5 relative">
            <HealthRing
              value={onlineCount}
              total={screens.length}
              onClick={offlineCount > 0 ? () => navigate("/screens?status=offline") : undefined}
              title={offlineCount > 0 ? `${offlineCount} ${t("offline")}` : undefined}
            />
            <div className="space-y-2 flex-1 min-w-0">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
                  {t("online")}
                </span>
                <span className="text-sm font-semibold text-foreground tabular-nums">{onlineCount}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <WifiOff className="w-3 h-3 text-destructive" />
                  {t("offline")}
                </span>
                <span className="text-sm font-semibold text-foreground tabular-nums">{offlineCount}</span>
              </div>
            </div>
          </div>
        </Card>

        {/* Publish Activity (today + scheduled merged) */}
        <Card
          className="p-5 hover-lift cursor-pointer group relative overflow-hidden"
          onClick={() => navigate("/publishing")}
        >
          <div className="absolute -right-6 -top-6 w-32 h-32 bg-emerald-500/5 rounded-full blur-2xl group-hover:bg-emerald-500/10 transition-all" />
          <div className="flex items-center justify-between mb-4 relative">
            <div className="flex items-center gap-2">
              <Send className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("dashPublishActivity")}</h3>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className="grid grid-cols-2 gap-4 relative">
            <div>
              <p className="text-3xl font-bold tracking-tight text-foreground tabular-nums">{todayPublishCount}</p>
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {t("dashPublishActivityToday")}
              </p>
            </div>
            <div className="border-l border-border/60 pl-4">
              <p className="text-3xl font-bold tracking-tight text-foreground tabular-nums">{scheduledCount}</p>
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <Clock className="w-3 h-3 text-amber-500" />
                {t("dashPublishActivityPending")}
              </p>
            </div>
          </div>
        </Card>

        {/* Content Assets (media + schedules + members merged) */}
        <Card className="p-5 hover-lift relative overflow-hidden">
          <div className="absolute -right-6 -top-6 w-32 h-32 bg-primary/5 rounded-full blur-2xl" />
          <div className="flex items-center justify-between mb-4 relative">
            <div className="flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("dashContentAssets")}</h3>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 relative">
            <button onClick={() => navigate("/media")} className="text-left group/item">
              <p className="text-2xl font-bold tracking-tight text-foreground tabular-nums group-hover/item:text-primary transition-colors">{mediaItems.length}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{t("dashTotalMedia")}</p>
            </button>
            <button onClick={() => navigate("/schedules")} className="text-left group/item border-l border-border/60 pl-3">
              <p className="text-2xl font-bold tracking-tight text-foreground tabular-nums group-hover/item:text-primary transition-colors">{enabledSchedules}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{t("dashTotalSchedules")}</p>
            </button>
            <button onClick={() => navigate("/admin")} className="text-left group/item border-l border-border/60 pl-3">
              <p className="text-2xl font-bold tracking-tight text-foreground tabular-nums group-hover/item:text-primary transition-colors">{memberCount}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate flex items-center gap-1">
                <Users className="w-3 h-3" />
                {t("dashOrgMembers")}
              </p>
            </button>
          </div>
        </Card>
      </section>

      {/* CS Agent specific cards */}
      {isCsAgent && <CSAgentCards />}

      {/* Quick Actions - inline strip */}
      <section className="animate-fade-in" style={{ animationDelay: "0.1s" }}>
        <div className="flex items-center gap-2 mb-3">
          <Zap className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">{t("dashQuickActions")}</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { icon: Send, label: t("dashQuickPublish"), to: "/publishing" },
            { icon: Plus, label: t("dashQuickScreen"), to: "/screens" },
            { icon: Upload, label: t("dashQuickMedia"), to: "/media" },
            { icon: CalendarClock, label: t("dashQuickSchedule"), to: "/schedules" },
          ].map(({ icon: Icon, label, to }) => (
            <Button
              key={to}
              variant="outline"
              className="h-auto py-3 flex flex-col items-center gap-1.5 hover:border-primary/50 hover:bg-primary/5 transition-all"
              onClick={() => navigate(to)}
              title={label}
            >
              <Icon className="w-5 h-5 text-primary" />
              <span className="text-xs font-medium">{label}</span>
            </Button>
          ))}
        </div>
      </section>

      {/* Insights tabs (branches / types / usage merged) */}
      <Card className="p-5 animate-fade-in" style={{ animationDelay: "0.15s" }}>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-foreground">{t("dashInsights")}</h3>
        </div>
        <Tabs defaultValue="branch">
          <TabsList className="mb-4">
            <TabsTrigger value="branch">{t("dashTabBranch")}</TabsTrigger>
            <TabsTrigger value="type">{t("dashTabType")}</TabsTrigger>
            <TabsTrigger value="usage">{t("dashTabUsage")}</TabsTrigger>
          </TabsList>

          <TabsContent value="branch" className="mt-0">
            {branchData.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={branchData} layout="vertical" margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "hsl(var(--muted) / 0.4)" }} />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 6, 6, 0]} barSize={22} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-12">{t("screensNoResult")}</p>
            )}
          </TabsContent>

          <TabsContent value="type" className="mt-0">
            {mediaTypeData.length > 0 ? (
              <div className="flex flex-col sm:flex-row items-center gap-6">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={mediaTypeData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={95} paddingAngle={4} strokeWidth={0}>
                      {mediaTypeData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-3 sm:min-w-[140px]">
                  {mediaTypeData.map((d, i) => (
                    <div key={d.name} className="flex items-center justify-between gap-4">
                      <span className="flex items-center gap-2 text-sm text-foreground">
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                        {d.name}
                      </span>
                      <span className="text-sm font-semibold text-foreground tabular-nums">{d.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-12">{t("mediaNoResult")}</p>
            )}
          </TabsContent>

          <TabsContent value="usage" className="mt-0">
            {mediaUsageData.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={mediaUsageData} margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
                    formatter={(value: number) => [`${value} ${t("dashUsedIn")}`, ""]}
                    labelFormatter={(label: string) => {
                      const item = mediaUsageData.find((d) => d.name === label);
                      return item?.fullName || label;
                    }}
                  />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} barSize={36} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-12">{t("mediaNoResult")}</p>
            )}
          </TabsContent>
        </Tabs>
      </Card>

      {/* Schedule Overview Table */}
      <Card className="p-5 animate-fade-in" style={{ animationDelay: "0.2s" }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground">{t("dashScheduleOverview")}</h3>
          <Button variant="ghost" size="sm" className="text-xs gap-1 text-muted-foreground" onClick={() => navigate("/schedules")}>
            {t("dashQuickSchedule")} <ArrowRight className="w-3 h-3" />
          </Button>
        </div>
        {scheduleOverview.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium">{t("dashScheduleName")}</th>
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium">{t("dashScreen")}</th>
                  <th className="text-center py-2 px-3 text-muted-foreground font-medium">{t("dashItems")}</th>
                  <th className="text-center py-2 px-3 text-muted-foreground font-medium">{t("dashDuration")}</th>
                  <th className="text-center py-2 px-3 text-muted-foreground font-medium">{t("dashStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {scheduleOverview.map((s) => (
                  <tr key={s.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="py-2.5 px-3 font-medium text-foreground">{s.name}</td>
                    <td className="py-2.5 px-3 text-muted-foreground text-xs">{s.screenName}</td>
                    <td className="py-2.5 px-3 text-center text-foreground tabular-nums">{s.itemCount}</td>
                    <td className="py-2.5 px-3 text-center text-foreground tabular-nums">{s.totalDuration}s</td>
                    <td className="py-2.5 px-3 text-center">
                      <Badge variant={s.enabled ? "default" : "secondary"} className="text-[10px]">
                        {s.enabled ? t("enabled") : t("disabled")}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">{t("schedNoResult")}</p>
        )}
      </Card>
    </div>
  );
}
