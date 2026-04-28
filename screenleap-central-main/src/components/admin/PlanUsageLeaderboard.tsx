import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, TrendingUp, Monitor, HardDrive, Info, ArrowUpCircle, AlertTriangle } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { PLAN_LIMITS, PLAN_LABELS, formatBytes, type PlanTier } from "@/hooks/useOrgPlan";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer } from "recharts";

const PLAN_TIER_ORDER: PlanTier[] = ["evaluation", "starter", "business", "professional", "enterprise"];
const PLAN_TIER_COLORS: Record<PlanTier, string> = {
  evaluation: "hsl(var(--muted-foreground))",
  starter: "hsl(217 91% 60%)",
  business: "hsl(142 71% 45%)",
  professional: "hsl(38 92% 50%)",
  enterprise: "hsl(var(--primary))",
};

interface PlanUsageLeaderboardProps {
  onUpgradeOrg?: (orgId: string) => void;
}

interface OrgUsageRow {
  orgId: string;
  orgName: string;
  tier: PlanTier;
  screens: number;
  maxScreens: number;
  screenPct: number; // 0-100, or 0 when unlimited
  mediaBytes: number;
  maxMediaBytes: number;
  mediaPct: number;
  appsCount: number; // best-effort from localStorage of current admin
  maxApps: number;
  appsPct: number;
  topPct: number; // max of the three (used for sort)
}

const STORAGE_PREFIX = "signboard-installed-apps";

function appCountForOrg(orgId: string): number {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}:${orgId}`);
    if (!raw) return 0;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}

function pct(used: number, max: number): number {
  if (max < 0) return 0; // unlimited
  if (max === 0) return used > 0 ? 100 : 0;
  return Math.min(100, Math.round((used / max) * 100));
}

function severityClass(p: number, unlimited: boolean): string {
  if (unlimited) return "bg-muted text-muted-foreground";
  if (p >= 100) return "bg-destructive text-destructive-foreground";
  if (p >= 80) return "bg-orange-500 text-white";
  if (p >= 50) return "bg-yellow-500 text-white";
  return "bg-emerald-500 text-white";
}

function barColor(p: number, unlimited: boolean): string {
  if (unlimited) return "bg-muted-foreground/40";
  if (p >= 100) return "bg-destructive";
  if (p >= 80) return "bg-orange-500";
  if (p >= 50) return "bg-yellow-500";
  return "bg-emerald-500";
}

export default function PlanUsageLeaderboard({ onUpgradeOrg }: PlanUsageLeaderboardProps = {}) {
  const { t, language } = useLanguage();
  const [rows, setRows] = useState<OrgUsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [nearLimitOnly, setNearLimitOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [orgsRes, screensRes, mediaRes] = await Promise.all([
        supabase.from("organizations").select("id, name, plan_tier"),
        supabase.from("screens").select("org_id"),
        (supabase as any).from("media_items").select("org_id, size_bytes").is("deleted_at", null),
      ]);

      if (cancelled) return;

      const orgs = orgsRes.data ?? [];
      const screensCount = new Map<string, number>();
      (screensRes.data ?? []).forEach((s: any) => {
        screensCount.set(s.org_id, (screensCount.get(s.org_id) ?? 0) + 1);
      });
      const mediaBytesByOrg = new Map<string, number>();
      (mediaRes.data ?? []).forEach((m: any) => {
        mediaBytesByOrg.set(
          m.org_id,
          (mediaBytesByOrg.get(m.org_id) ?? 0) + (Number(m.size_bytes) || 0)
        );
      });

      const computed: OrgUsageRow[] = orgs.map((o: any) => {
        const tier = (o.plan_tier as PlanTier) ?? "evaluation";
        const limits = PLAN_LIMITS[tier];
        const screens = screensCount.get(o.id) ?? 0;
        const mediaBytes = mediaBytesByOrg.get(o.id) ?? 0;
        const apps = appCountForOrg(o.id);
        const screenPct = pct(screens, limits.maxScreens);
        const mediaPct = pct(mediaBytes, limits.mediaBytes);
        const appsPct = pct(apps, limits.maxApps);
        return {
          orgId: o.id,
          orgName: o.name,
          tier,
          screens,
          maxScreens: limits.maxScreens,
          screenPct,
          mediaBytes,
          maxMediaBytes: limits.mediaBytes,
          mediaPct,
          appsCount: apps,
          maxApps: limits.maxApps,
          appsPct,
          topPct: Math.max(screenPct, mediaPct, appsPct),
        };
      });

      computed.sort((a, b) => b.topPct - a.topPct);
      setRows(computed);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => {
    const critical = rows.filter((r) => r.topPct >= 100).length;
    const warning = rows.filter((r) => r.topPct >= 80 && r.topPct < 100).length;
    return { critical, warning, total: rows.length };
  }, [rows]);

  const filteredRows = useMemo(
    () => (nearLimitOnly ? rows.filter((r) => r.topPct >= 80) : rows),
    [rows, nearLimitOnly]
  );
  const nearLimitCount = stats.critical + stats.warning;

  const tierDistribution = useMemo(() => {
    const counts = new Map<PlanTier, number>();
    rows.forEach((r) => counts.set(r.tier, (counts.get(r.tier) ?? 0) + 1));
    return PLAN_TIER_ORDER
      .filter((tier) => (counts.get(tier) ?? 0) > 0)
      .map((tier) => ({
        tier,
        name: PLAN_LABELS[tier][language],
        value: counts.get(tier) ?? 0,
        color: PLAN_TIER_COLORS[tier],
      }));
  }, [rows, language]);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <TooltipProvider>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-primary" />
                {t("planLeaderboardTitle")}
              </CardTitle>
              <CardDescription className="mt-1">
                {t("planLeaderboardDesc")}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="gap-1.5">
                <span className="w-2 h-2 rounded-full bg-destructive" />
                {t("planLeaderboardCritical")}: {stats.critical}
              </Badge>
              <Badge variant="outline" className="gap-1.5">
                <span className="w-2 h-2 rounded-full bg-orange-500" />
                {t("planLeaderboardWarning")}: {stats.warning}
              </Badge>
              <Badge variant="outline">
                {t("planLeaderboardTotal")}: {stats.total}
              </Badge>
              <Button
                size="sm"
                variant={nearLimitOnly ? "default" : "outline"}
                className="h-7 gap-1.5"
                onClick={() => setNearLimitOnly((v) => !v)}
                disabled={!nearLimitOnly && nearLimitCount === 0}
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                {nearLimitOnly ? t("planLeaderboardShowAll") : `${t("planLeaderboardNearLimitOnly")} (${nearLimitCount})`}
              </Button>
            </div>
          </div>
          {tierDistribution.length > 0 && (
            <div className="mt-4 flex items-center gap-4 rounded-lg border bg-muted/30 p-3">
              <div className="w-24 h-24 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={tierDistribution}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={22}
                      outerRadius={42}
                      paddingAngle={2}
                      stroke="hsl(var(--background))"
                      strokeWidth={2}
                    >
                      {tierDistribution.map((entry) => (
                        <Cell key={entry.tier} fill={entry.color} />
                      ))}
                    </Pie>
                    <RechartsTooltip
                      contentStyle={{
                        background: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                        color: "hsl(var(--popover-foreground))",
                      }}
                      formatter={(value: number, name: string) => [`${value}`, name]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-muted-foreground mb-1.5">
                  {t("planLeaderboardDistribution")}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                  {tierDistribution.map((entry) => (
                    <div key={entry.tier} className="flex items-center gap-1.5 text-xs">
                      <span
                        className="w-2.5 h-2.5 rounded-sm shrink-0"
                        style={{ backgroundColor: entry.color }}
                      />
                      <span className="text-foreground">{entry.name}</span>
                      <span className="font-mono text-muted-foreground">{entry.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {filteredRows.length === 0 && (
            <div className="text-center text-muted-foreground py-8 text-sm">
              {nearLimitOnly ? t("planLeaderboardNearLimitEmpty") : t("planLeaderboardEmpty")}
            </div>
          )}
          {filteredRows.map((r, idx) => (
            <div
              key={r.orgId}
              className="rounded-lg border bg-card hover:bg-accent/30 transition-colors p-4"
            >
              <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs font-mono text-muted-foreground w-6 text-right">
                    #{idx + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="font-medium truncate">{r.orgName}</div>
                    <div className="text-xs text-muted-foreground">
                      {PLAN_LABELS[r.tier][language]}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={severityClass(r.topPct, false)}>
                    {t("planLeaderboardPeak")}: {r.topPct}%
                  </Badge>
                  {onUpgradeOrg && r.tier !== "enterprise" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1.5"
                      onClick={() => onUpgradeOrg(r.orgId)}
                    >
                      <ArrowUpCircle className="w-3.5 h-3.5" />
                      {t("planLeaderboardUpgrade")}
                    </Button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <UsageCell
                  icon={<Monitor className="w-3.5 h-3.5" />}
                  label={t("planUsageScreens")}
                  used={`${r.screens}`}
                  limit={r.maxScreens < 0 ? "∞" : `${r.maxScreens}`}
                  pct={r.screenPct}
                  unlimited={r.maxScreens < 0}
                />
                <UsageCell
                  icon={<HardDrive className="w-3.5 h-3.5" />}
                  label={t("planUsageMedia")}
                  used={formatBytes(r.mediaBytes)}
                  limit={r.maxMediaBytes < 0 ? "∞" : formatBytes(r.maxMediaBytes)}
                  pct={r.mediaPct}
                  unlimited={r.maxMediaBytes < 0}
                />
                <UsageCell
                  icon={
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="w-3.5 h-3.5" />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        {t("planLeaderboardAppsNote")}
                      </TooltipContent>
                    </Tooltip>
                  }
                  label={t("planUsageApps")}
                  used={`${r.appsCount}`}
                  limit={r.maxApps < 0 ? "∞" : `${r.maxApps}`}
                  pct={r.appsPct}
                  unlimited={r.maxApps < 0}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}

function UsageCell({
  icon,
  label,
  used,
  limit,
  pct,
  unlimited,
}: {
  icon: React.ReactNode;
  label: string;
  used: string;
  limit: string;
  pct: number;
  unlimited: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1.5">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          {icon}
          {label}
        </span>
        <span className="font-mono">
          {used} / {limit}
          {!unlimited && <span className="ml-1.5 text-muted-foreground">({pct}%)</span>}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full transition-all ${barColor(pct, unlimited)}`}
          style={{ width: unlimited ? "8%" : `${Math.max(2, pct)}%` }}
        />
      </div>
    </div>
  );
}
