import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/contexts/LanguageContext";
import { Link } from "react-router-dom";
import { Wrench, Building2, Key, TrendingUp, Code2, ShieldCheck, ArrowRight, LucideIcon, Loader2 } from "lucide-react";
import SystemAdminManagement from "@/components/admin/SystemAdminManagement";
import { supabase } from "@/integrations/supabase/client";

interface Tool {
  to: string;
  icon: LucideIcon;
  titleKey: Parameters<ReturnType<typeof useLanguage>["t"]>[0];
  descKey: Parameters<ReturnType<typeof useLanguage>["t"]>[0];
  gradient: string;
  statKey?: keyof Stats;
  statLabelKey?: Parameters<ReturnType<typeof useLanguage>["t"]>[0];
  staticTitle?: string;
  staticDesc?: string;
  staticLabel?: string;
}

interface Stats {
  orgCount: number | null;
  activeLicenses: number | null;
  emailFailures24h: number | null;
  expiringSoon: number | null;
  widgetCount: number | null;
}

const TOOLS: Tool[] = [
  { to: "/system-settings", icon: Wrench, titleKey: "navSysSettings", descKey: "sysAdminCardSettingsDesc", gradient: "from-blue-500/20 to-cyan-500/20", statKey: "emailFailures24h", statLabelKey: "sysAdminStatEmailFailures" },
  { to: "/org-management", icon: Building2, titleKey: "navOrgMgmt", descKey: "sysAdminCardOrgsDesc", gradient: "from-purple-500/20 to-pink-500/20", statKey: "orgCount", statLabelKey: "sysAdminStatOrgs" },
  { to: "/cs-licenses", icon: Key, titleKey: "navCSLicenses", descKey: "sysAdminCardLicensesDesc", gradient: "from-amber-500/20 to-orange-500/20", statKey: "activeLicenses", statLabelKey: "sysAdminStatActiveLicenses" },
  { to: "/usage-leaderboard", icon: TrendingUp, titleKey: "tabUsageLeaderboard", descKey: "sysAdminCardLeaderboardDesc", gradient: "from-emerald-500/20 to-teal-500/20", statKey: "expiringSoon", statLabelKey: "sysAdminStatExpiringSoon" },
  { to: "/widget-mgmt", icon: Code2, titleKey: "tabWidgetMgmt", descKey: "sysAdminCardWidgetsDesc", gradient: "from-rose-500/20 to-red-500/20", statKey: "widgetCount", statLabelKey: "sysAdminStatWidgets" },
  { to: "/security-audit", icon: ShieldCheck, titleKey: "navSysAdmin", descKey: "sysAdminOverviewDesc", gradient: "from-green-500/20 to-emerald-500/20", staticTitle: "Security Audit", staticDesc: "Re-run RLS regression checks against hardened baseline", staticLabel: "Run audit" },
];

export default function SystemAdminPage() {
  const { t } = useLanguage();
  const [stats, setStats] = useState<Stats>({ orgCount: null, activeLicenses: null, emailFailures24h: null, expiringSoon: null, widgetCount: null });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const nowIso = new Date().toISOString();
      const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const [orgs, licenses, emailFails, expiring, widgets] = await Promise.all([
        supabase.from("organizations").select("id", { count: "exact", head: true }),
        supabase.from("license_codes").select("id", { count: "exact", head: true }).eq("status", "active"),
        supabase.from("email_send_log").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", last24h),
        supabase.from("organizations").select("id", { count: "exact", head: true }).gt("license_expires_at", nowIso).lte("license_expires_at", in30Days),
        supabase.from("widgets").select("id", { count: "exact", head: true }),
      ]);
      if (cancelled) return;
      setStats({
        orgCount: orgs.count ?? 0,
        activeLicenses: licenses.count ?? 0,
        emailFailures24h: emailFails.count ?? 0,
        expiringSoon: expiring.count ?? 0,
        widgetCount: widgets.count ?? 0,
      });
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-6xl">
        <div className="animate-fade-in">
          <h1 className="text-2xl font-bold text-foreground">{t("navSysAdmin")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("sysAdminOverviewDesc")}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map((tool) => {
            const Icon = tool.icon;
            const value = tool.statKey ? stats[tool.statKey] : undefined;
            const isPendingAlert = tool.statKey === "emailFailures24h" && ((value as number | null) ?? 0) > 0;
            const isExpiringAlert = tool.statKey === "expiringSoon" && ((value as number | null) ?? 0) > 0;
            return (
              <Link key={tool.to} to={tool.to} className="group">
                <Card className="h-full transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 hover:border-primary/40 cursor-pointer overflow-hidden relative">
                  <div className={`absolute inset-0 bg-gradient-to-br ${tool.gradient} opacity-0 group-hover:opacity-100 transition-opacity`} />
                  <CardHeader className="relative">
                    <div className="flex items-start justify-between">
                      <div className={`h-10 w-10 rounded-lg bg-gradient-to-br ${tool.gradient} flex items-center justify-center`}>
                        <Icon className="h-5 w-5 text-foreground" />
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                    </div>
                    <CardTitle className="mt-3 text-base">{tool.staticTitle ?? t(tool.titleKey)}</CardTitle>
                    <CardDescription className="text-xs">{tool.staticDesc ?? t(tool.descKey)}</CardDescription>
                    <div className="mt-3 flex items-center gap-2">
                      {tool.staticLabel ? (
                        <span className="text-[11px] text-muted-foreground">{tool.staticLabel}</span>
                      ) : value === null ? (
                        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                      ) : (
                        <>
                        <Badge
                          variant={isPendingAlert ? "destructive" : isExpiringAlert ? "default" : "secondary"}
                          className="text-[11px] font-semibold tabular-nums"
                        >
                          {value as number}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground">{tool.statLabelKey ? t(tool.statLabelKey) : ""}</span>
                        </>
                      )}
                    </div>
                  </CardHeader>
                </Card>
              </Link>
            );
          })}
        </div>

        <SystemAdminManagement />
      </div>
    </DashboardLayout>
  );
}
