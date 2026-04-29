import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Star, MessageCircle, Clock, TrendingUp, Users, CheckCircle, SmilePlus, BarChart3, Trophy, Award, Download, FileText, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";

interface AgentPerf {
  name: string;
  replyCount: number;
  avgResponseMinutes: number;
  sessionsHandled: number;
  avgRating: number;
  ratingCount: number;
}

interface StatsData {
  totalSessions: number;
  openSessions: number;
  closedSessions: number;
  avgRating: number;
  totalRatings: number;
  ratingDistribution: number[];
  avgResponseTimeMinutes: number;
  dailyConversations: { date: string; count: number }[];
  dailyRatings: { date: string; avg: number }[];
  agentPerformance: AgentPerf[];
}

const PERIOD_OPTIONS = [
  { value: "7", label: "最近 7 天" },
  { value: "14", label: "最近 14 天" },
  { value: "30", label: "最近 30 天" },
  { value: "90", label: "最近 90 天" },
];

const CSDashboard = () => {
  const { t } = useLanguage();
  const [period, setPeriod] = useState("30");
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [countdown, setCountdown] = useState(30);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const since = new Date();
    since.setDate(since.getDate() - parseInt(period));
    const sinceISO = since.toISOString();

    // Fetch sessions
    const { data: allSessions } = await supabase
      .from("customer_chat_sessions")
      .select("id, status, created_at")
      .gte("created_at", sinceISO)
      .order("created_at", { ascending: true });

    const sessions = allSessions || [];
    const openCount = sessions.filter((s) => s.status === "open").length;
    const closedCount = sessions.filter((s) => s.status === "closed").length;
    const sessionIds = sessions.map((s) => s.id);

    // Ratings
    const { data: allRatings } = await supabase
      .from("customer_satisfaction_ratings")
      .select("rating, created_at, session_id")
      .gte("created_at", sinceISO);

    const ratings = allRatings || [];
    const avgRating = ratings.length > 0
      ? ratings.reduce((s, r) => s + r.rating, 0) / ratings.length
      : 0;
    const ratingDistribution = [0, 0, 0, 0, 0];
    ratings.forEach((r) => {
      if (r.rating >= 1 && r.rating <= 5) ratingDistribution[r.rating - 1]++;
    });

    // Response time
    let totalResponseMs = 0;
    let responseCount = 0;

    if (sessionIds.length > 0) {
      // Get all agent messages (with sender_name for performance tracking)
      const { data: agentMsgs } = await supabase
        .from("customer_chat_messages")
        .select("session_id, created_at, sender_name")
        .in("session_id", sessionIds)
        .eq("sender_type", "agent")
        .order("created_at", { ascending: true });

      const firstReplyMap = new Map<string, string>();
      (agentMsgs || []).forEach((m) => {
        if (!firstReplyMap.has(m.session_id)) firstReplyMap.set(m.session_id, m.created_at);
      });

      sessions.forEach((s) => {
        const firstReply = firstReplyMap.get(s.id);
        if (firstReply) {
          const diff = new Date(firstReply).getTime() - new Date(s.created_at).getTime();
          if (diff > 0 && diff < 24 * 60 * 60 * 1000) {
            totalResponseMs += diff;
            responseCount++;
          }
        }
      });
    }

    // --- Agent performance ---
    const agentMap = new Map<string, { replyCount: number; sessions: Set<string>; totalResponseMs: number; responseCount: number }>();
    const allAgentMsgs = sessionIds.length > 0 ? (
      await supabase
        .from("customer_chat_messages")
        .select("session_id, created_at, sender_name")
        .in("session_id", sessionIds)
        .eq("sender_type", "agent")
        .order("created_at", { ascending: true })
    ).data || [] : [];

    const firstReplyPerAgentSession = new Map<string, Map<string, string>>();
    allAgentMsgs.forEach((m) => {
      const name = m.sender_name || t("csDashUnknownAgent");
      if (!agentMap.has(name)) agentMap.set(name, { replyCount: 0, sessions: new Set(), totalResponseMs: 0, responseCount: 0 });
      const agent = agentMap.get(name)!;
      agent.replyCount++;
      agent.sessions.add(m.session_id);
      if (!firstReplyPerAgentSession.has(name)) firstReplyPerAgentSession.set(name, new Map());
      const agentSessions = firstReplyPerAgentSession.get(name)!;
      if (!agentSessions.has(m.session_id)) {
        agentSessions.set(m.session_id, m.created_at);
        const session = sessions.find(s => s.id === m.session_id);
        if (session) {
          const diff = new Date(m.created_at).getTime() - new Date(session.created_at).getTime();
          if (diff > 0 && diff < 24 * 60 * 60 * 1000) {
            agent.totalResponseMs += diff;
            agent.responseCount++;
          }
        }
      }
    });

    const { data: ratingsWithSession } = await supabase
      .from("customer_satisfaction_ratings")
      .select("session_id, rating")
      .in("session_id", sessionIds);

    const sessionRatingMap = new Map<string, number>();
    (ratingsWithSession || []).forEach((r) => sessionRatingMap.set(r.session_id, r.rating));

    const agentPerformance: AgentPerf[] = Array.from(agentMap.entries()).map(([name, data]) => {
      let ratingSum = 0, ratingCount = 0;
      data.sessions.forEach(sid => {
        const r = sessionRatingMap.get(sid);
        if (r) { ratingSum += r; ratingCount++; }
      });
      return {
        name,
        replyCount: data.replyCount,
        avgResponseMinutes: data.responseCount > 0 ? data.totalResponseMs / data.responseCount / 60000 : 0,
        sessionsHandled: data.sessions.size,
        avgRating: ratingCount > 0 ? ratingSum / ratingCount : 0,
        ratingCount,
      };
    }).sort((a, b) => b.replyCount - a.replyCount);

    // Daily aggregation
    const dailyMap = new Map<string, number>();
    const dailyRatingMap = new Map<string, { sum: number; count: number }>();
    const days = parseInt(period);
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - (days - 1 - i));
      const key = d.toISOString().slice(0, 10);
      dailyMap.set(key, 0);
      dailyRatingMap.set(key, { sum: 0, count: 0 });
    }
    sessions.forEach((s) => {
      const day = s.created_at.slice(0, 10);
      dailyMap.set(day, (dailyMap.get(day) || 0) + 1);
    });
    ratings.forEach((r) => {
      const day = r.created_at.slice(0, 10);
      const entry = dailyRatingMap.get(day) || { sum: 0, count: 0 };
      entry.sum += r.rating;
      entry.count++;
      dailyRatingMap.set(day, entry);
    });

    setStats({
      totalSessions: sessions.length,
      openSessions: openCount,
      closedSessions: closedCount,
      avgRating,
      totalRatings: ratings.length,
      ratingDistribution,
      avgResponseTimeMinutes: responseCount > 0 ? totalResponseMs / responseCount / 60000 : 0,
      dailyConversations: Array.from(dailyMap.entries()).map(([date, count]) => ({ date, count })),
      dailyRatings: Array.from(dailyRatingMap.entries()).map(([date, v]) => ({
        date,
        avg: v.count > 0 ? v.sum / v.count : 0,
      })),
      agentPerformance,
    });
    setLoading(false);
  }, [period]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh timer
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (!autoRefresh) return;
    setCountdown(30);
    countdownRef.current = setInterval(() => setCountdown(c => c <= 1 ? 30 : c - 1), 1000);
    timerRef.current = setInterval(() => { load(true); setCountdown(30); }, 30000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [autoRefresh, load]);

  if (loading || !stats) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <BarChart3 className="h-8 w-8 animate-pulse mr-2" /> 載入統計數據中...
      </div>
    );
  }

  const maxConversations = Math.max(...stats.dailyConversations.map((d) => d.count), 1);
  const ratingMax = Math.max(...stats.ratingDistribution, 1);

  const formatResponseTime = (mins: number) => {
    if (mins < 1) return "< 1 分鐘";
    if (mins < 60) return `${Math.round(mins)} 分鐘`;
    const hrs = Math.floor(mins / 60);
    const remainMins = Math.round(mins % 60);
    return `${hrs} 小時 ${remainMins} 分鐘`;
  };

  const exportCSV = () => {
    if (!stats) return;
    const lines: string[] = [];
    const periodLabel = PERIOD_OPTIONS.find(o => o.value === period)?.label || period;
    lines.push(`客服數據報表 - ${periodLabel}`);
    lines.push("");
    lines.push("指標,數值");
    lines.push(`對話總數,${stats.totalSessions}`);
    lines.push(`進行中,${stats.openSessions}`);
    lines.push(`已結束,${stats.closedSessions}`);
    lines.push(`平均滿意度,${stats.avgRating.toFixed(1)}`);
    lines.push(`評價數,${stats.totalRatings}`);
    lines.push(`平均回應時間(分鐘),${stats.avgResponseTimeMinutes.toFixed(1)}`);
    lines.push("");
    lines.push("日期,對話數,平均滿意度");
    stats.dailyConversations.forEach((d, i) => {
      const r = stats.dailyRatings[i];
      lines.push(`${d.date},${d.count},${r?.avg ? r.avg.toFixed(1) : ""}`);
    });
    if (stats.agentPerformance.length > 0) {
      lines.push("");
      lines.push("客服人員,回覆次數,處理對話,平均回應(分鐘),滿意度,評價數");
      stats.agentPerformance.forEach(a => {
        lines.push(`${a.name},${a.replyCount},${a.sessionsHandled},${a.avgResponseMinutes.toFixed(1)},${a.avgRating > 0 ? a.avgRating.toFixed(1) : ""},${a.ratingCount}`);
      });
    }
    const bom = "\uFEFF";
    const blob = new Blob([bom + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `客服報表_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV 報表已下載");
  };

  const exportPDF = () => {
    if (!stats) return;
    const escapeHtml = (str: unknown): string =>
      String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    const periodLabel = PERIOD_OPTIONS.find(o => o.value === period)?.label || period;
    const w = window.open("", "_blank");
    if (!w) { toast.error("請允許彈出視窗"); return; }
    const agentRows = stats.agentPerformance.map(a => `
      <tr>
        <td>${escapeHtml(a.name)}</td><td>${a.replyCount}</td><td>${a.sessionsHandled}</td>
        <td>${a.avgResponseMinutes > 0 ? a.avgResponseMinutes.toFixed(1) + " 分鐘" : "—"}</td>
        <td>${a.avgRating > 0 ? a.avgRating.toFixed(1) + " ⭐" : "—"}</td>
        <td>${a.ratingCount}</td>
      </tr>`).join("");
    const dailyRows = stats.dailyConversations.map((d, i) => {
      const r = stats.dailyRatings[i];
      return `<tr><td>${escapeHtml(d.date)}</td><td>${d.count}</td><td>${r?.avg ? r.avg.toFixed(1) : "—"}</td></tr>`;
    }).join("");
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>客服報表</title>
      <style>
        body{font-family:system-ui,sans-serif;padding:40px;color:#222;max-width:800px;margin:auto}
        h1{font-size:20px;border-bottom:2px solid #333;padding-bottom:8px}
        h2{font-size:15px;margin-top:28px;color:#555}
        table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}
        th,td{border:1px solid #ddd;padding:6px 10px;text-align:left}
        th{background:#f5f5f5;font-weight:600}
        .kpi{display:flex;gap:20px;flex-wrap:wrap;margin:16px 0}
        .kpi-item{background:#f9f9f9;border-radius:8px;padding:14px 20px;min-width:140px}
        .kpi-item .label{font-size:12px;color:#888}
        .kpi-item .value{font-size:22px;font-weight:700;margin-top:4px}
        @media print{body{padding:20px}}
      </style></head><body>
      <h1>客服數據報表</h1>
      <p style="color:#888;font-size:13px">期間：${escapeHtml(periodLabel)} ｜ 匯出時間：${escapeHtml(new Date().toLocaleString("zh-TW"))}</p>
      <div class="kpi">
        <div class="kpi-item"><div class="label">對話總數</div><div class="value">${stats.totalSessions}</div></div>
        <div class="kpi-item"><div class="label">進行中</div><div class="value">${stats.openSessions}</div></div>
        <div class="kpi-item"><div class="label">已結束</div><div class="value">${stats.closedSessions}</div></div>
        <div class="kpi-item"><div class="label">平均滿意度</div><div class="value">${stats.avgRating.toFixed(1)} ⭐</div></div>
        <div class="kpi-item"><div class="label">平均回應時間</div><div class="value">${formatResponseTime(stats.avgResponseTimeMinutes)}</div></div>
      </div>
      ${stats.agentPerformance.length > 0 ? `<h2>客服人員績效</h2><table><thead><tr><th>人員</th><th>回覆次數</th><th>處理對話</th><th>平均回應</th><th>滿意度</th><th>評價數</th></tr></thead><tbody>${agentRows}</tbody></table>` : ""}
      <h2>每日趨勢</h2><table><thead><tr><th>日期</th><th>對話數</th><th>平均滿意度</th></tr></thead><tbody>${dailyRows}</tbody></table>
      <script>setTimeout(()=>window.print(),300)</script></body></html>`);
    w.document.close();
    toast.success("PDF 列印視窗已開啟");
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Period selector */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          {t("csDashOverview")}
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCSV} className="h-9 gap-1.5">
            <Download className="h-3.5 w-3.5" />
            CSV
          </Button>
          <Button variant="outline" size="sm" onClick={exportPDF} className="h-9 gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            PDF
          </Button>
          <div className="flex items-center gap-2 border rounded-md px-2.5 h-9 bg-muted/30">
            <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} className="scale-75" />
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {autoRefresh ? `${countdown}s` : "自動刷新"}
            </span>
          </div>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => { load(true); setCountdown(30); }} title="立即刷新">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-[140px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5 pb-4 px-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground font-medium">對話總數</span>
              <MessageCircle className="h-4 w-4 text-primary" />
            </div>
            <p className="text-2xl font-bold">{stats.totalSessions}</p>
            <div className="flex gap-2 mt-1.5">
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-green-500/30 text-green-500">
                {stats.openSessions} 進行中
              </Badge>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {stats.closedSessions} 已結束
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 pb-4 px-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground font-medium">平均滿意度</span>
              <Star className="h-4 w-4 text-yellow-500" />
            </div>
            <div className="flex items-baseline gap-2">
              <p className="text-2xl font-bold">{stats.avgRating > 0 ? stats.avgRating.toFixed(1) : "—"}</p>
              <span className="text-xs text-muted-foreground">/ 5</span>
            </div>
            <div className="flex items-center gap-0.5 mt-1.5">
              {[1, 2, 3, 4, 5].map((s) => (
                <Star
                  key={s}
                  className={cn(
                    "h-3 w-3",
                    s <= Math.round(stats.avgRating)
                      ? "fill-yellow-400 text-yellow-400"
                      : "text-muted-foreground/30"
                  )}
                />
              ))}
              <span className="text-[10px] text-muted-foreground ml-1">({stats.totalRatings} 則評價)</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 pb-4 px-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground font-medium">平均回應時間</span>
              <Clock className="h-4 w-4 text-blue-500" />
            </div>
            <p className="text-2xl font-bold">
              {stats.avgResponseTimeMinutes > 0
                ? stats.avgResponseTimeMinutes < 60
                  ? `${Math.round(stats.avgResponseTimeMinutes)}m`
                  : `${(stats.avgResponseTimeMinutes / 60).toFixed(1)}h`
                : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1.5">
              {stats.avgResponseTimeMinutes > 0
                ? formatResponseTime(stats.avgResponseTimeMinutes)
                : "尚無數據"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 pb-4 px-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground font-medium">結案率</span>
              <CheckCircle className="h-4 w-4 text-green-500" />
            </div>
            <p className="text-2xl font-bold">
              {stats.totalSessions > 0
                ? `${Math.round((stats.closedSessions / stats.totalSessions) * 100)}%`
                : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1.5">
              {stats.closedSessions} / {stats.totalSessions} 對話已結案
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Conversation trend */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              對話數量趨勢
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="flex items-end gap-[2px] h-32">
              {stats.dailyConversations.map((d, i) => {
                const heightPercent = (d.count / maxConversations) * 100;
                const isToday = d.date === new Date().toISOString().slice(0, 10);
                return (
                  <div
                    key={i}
                    className="flex-1 group relative"
                    title={`${d.date}: ${d.count} 筆對話`}
                  >
                    <div
                      className={cn(
                        "w-full rounded-t-sm transition-all min-h-[2px]",
                        isToday ? "bg-primary" : "bg-primary/40",
                        "group-hover:bg-primary"
                      )}
                      style={{ height: `${Math.max(heightPercent, 2)}%` }}
                    />
                    {/* Tooltip */}
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-10">
                      <div className="bg-popover text-popover-foreground text-[10px] px-2 py-1 rounded shadow-md whitespace-nowrap border border-border">
                        {d.date.slice(5)} · {d.count} 筆
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-[10px] text-muted-foreground">
                {stats.dailyConversations[0]?.date.slice(5)}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {stats.dailyConversations[stats.dailyConversations.length - 1]?.date.slice(5)}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Rating distribution */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <SmilePlus className="h-4 w-4 text-yellow-500" />
              滿意度分布
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="space-y-2.5">
              {[5, 4, 3, 2, 1].map((star) => {
                const count = stats.ratingDistribution[star - 1];
                const percent = stats.totalRatings > 0 ? (count / stats.totalRatings) * 100 : 0;
                return (
                  <div key={star} className="flex items-center gap-2">
                    <div className="flex items-center gap-0.5 w-16 shrink-0">
                      <span className="text-xs font-medium w-3">{star}</span>
                      <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                    </div>
                    <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          star >= 4 ? "bg-green-500" : star === 3 ? "bg-yellow-500" : "bg-destructive"
                        )}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground w-8 text-right">{count}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Daily satisfaction trend */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Star className="h-4 w-4 text-yellow-500" />
            每日滿意度趨勢
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <div className="flex items-end gap-[2px] h-24">
            {stats.dailyRatings.map((d, i) => {
              const heightPercent = d.avg > 0 ? (d.avg / 5) * 100 : 0;
              return (
                <div
                  key={i}
                  className="flex-1 group relative"
                  title={`${d.date}: ${d.avg > 0 ? d.avg.toFixed(1) : "—"}`}
                >
                  <div
                    className={cn(
                      "w-full rounded-t-sm transition-all",
                      d.avg >= 4
                        ? "bg-green-500/60 group-hover:bg-green-500"
                        : d.avg >= 3
                        ? "bg-yellow-500/60 group-hover:bg-yellow-500"
                        : d.avg > 0
                        ? "bg-destructive/60 group-hover:bg-destructive"
                        : "bg-muted"
                    )}
                    style={{ height: `${Math.max(heightPercent, 2)}%` }}
                  />
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-10">
                    <div className="bg-popover text-popover-foreground text-[10px] px-2 py-1 rounded shadow-md whitespace-nowrap border border-border">
                      {d.date.slice(5)} · {d.avg > 0 ? `${d.avg.toFixed(1)} ⭐` : "無評價"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-[10px] text-muted-foreground">
              {stats.dailyRatings[0]?.date.slice(5)}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {stats.dailyRatings[stats.dailyRatings.length - 1]?.date.slice(5)}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Agent Performance Leaderboard */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Trophy className="h-4 w-4 text-yellow-500" />
            {t("csDashAgentRanking")}
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          {stats.agentPerformance.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">{t("csDashNoData")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="pb-2 pl-2 font-medium text-muted-foreground text-xs w-10">#</th>
                    <th className="pb-2 font-medium text-muted-foreground text-xs">{t("csDashAgent")}</th>
                    <th className="pb-2 text-center font-medium text-muted-foreground text-xs">回覆次數</th>
                    <th className="pb-2 text-center font-medium text-muted-foreground text-xs">處理對話</th>
                    <th className="pb-2 text-center font-medium text-muted-foreground text-xs">平均回應</th>
                    <th className="pb-2 text-center font-medium text-muted-foreground text-xs">滿意度</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.agentPerformance.map((agent, i) => (
                    <tr key={agent.name} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="py-2.5 pl-2">
                        {i === 0 ? (
                          <Award className="h-4 w-4 text-yellow-500" />
                        ) : i === 1 ? (
                          <Award className="h-4 w-4 text-muted-foreground/60" />
                        ) : i === 2 ? (
                          <Award className="h-4 w-4 text-orange-400/70" />
                        ) : (
                          <span className="text-xs text-muted-foreground pl-0.5">{i + 1}</span>
                        )}
                      </td>
                      <td className="py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-7 w-7 rounded-full bg-primary/15 flex items-center justify-center text-xs font-medium text-primary">
                            {agent.name[0]?.toUpperCase()}
                          </div>
                          <span className="font-medium">{agent.name}</span>
                        </div>
                      </td>
                      <td className="py-2.5 text-center">
                        <span className="font-semibold">{agent.replyCount}</span>
                      </td>
                      <td className="py-2.5 text-center">
                        <span className="text-muted-foreground">{agent.sessionsHandled}</span>
                      </td>
                      <td className="py-2.5 text-center">
                        {agent.avgResponseMinutes > 0 ? (
                          <Badge variant="outline" className={cn(
                            "text-[10px] px-1.5 py-0",
                            agent.avgResponseMinutes < 10
                              ? "border-green-500/30 text-green-500"
                              : agent.avgResponseMinutes < 30
                              ? "border-yellow-500/30 text-yellow-500"
                              : "border-destructive/30 text-destructive"
                          )}>
                            {agent.avgResponseMinutes < 60
                              ? `${Math.round(agent.avgResponseMinutes)}m`
                              : `${(agent.avgResponseMinutes / 60).toFixed(1)}h`}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2.5 text-center">
                        {agent.ratingCount > 0 ? (
                          <div className="flex items-center justify-center gap-1">
                            <Star className={cn(
                              "h-3 w-3",
                              agent.avgRating >= 4 ? "fill-yellow-400 text-yellow-400"
                                : agent.avgRating >= 3 ? "fill-yellow-400/60 text-yellow-400/60"
                                : "fill-destructive/60 text-destructive/60"
                            )} />
                            <span className="text-xs font-medium">{agent.avgRating.toFixed(1)}</span>
                            <span className="text-[10px] text-muted-foreground">({agent.ratingCount})</span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default CSDashboard;
