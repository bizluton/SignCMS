import { useCallback, useEffect, useMemo, useState } from "react";
import { WifiOff, CheckCircle2, BellOff, ArrowRight, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole } from "@/hooks/useUserRole";
import { useToast } from "@/hooks/use-toast";

type ScreenRow = {
  id: string;
  name: string;
  branch: string;
  online: boolean;
  updated_at: string;
  org_id: string;
};

type AlertRow = {
  id: string;
  screen_id: string;
  status: "active" | "acknowledged" | "resolved";
  acknowledged_at: string | null;
  resolved_at: string | null;
  last_seen_at: string | null;
};

interface Props {
  screens: ScreenRow[];
  activeOrgId: string | null;
  onChanged?: () => void;
}

export function OfflineScreenAlertsPanel({ screens, activeOrgId, onChanged }: Props) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin, isOrgAdmin } = useUserRole();
  const { toast } = useToast();
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const canResolve = isAdmin || isOrgAdmin;

  const offlineScreens = useMemo(
    () => screens.filter((s) => !s.online),
    [screens]
  );

  const refreshAlerts = useCallback(async () => {
    if (offlineScreens.length === 0) {
      setAlerts([]);
      setLoading(false);
      return;
    }
    const ids = offlineScreens.map((s) => s.id);
    const { data } = await supabase
      .from("screen_alerts")
      .select("id, screen_id, status, acknowledged_at, resolved_at, last_seen_at")
      .in("screen_id", ids)
      .neq("status", "resolved");
    setAlerts((data as AlertRow[]) || []);
    setLoading(false);
  }, [offlineScreens]);

  // Auto-create active alert rows for offline screens that don't have one yet
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await refreshAlerts();
      if (cancelled) return;
      if (!user || !activeOrgId) return;

      const existing = new Set(alerts.map((a) => a.screen_id));
      const missing = offlineScreens.filter((s) => !existing.has(s.id));
      if (missing.length === 0) return;

      const rows = missing.map((s) => ({
        screen_id: s.id,
        org_id: s.org_id,
        status: "active",
        last_seen_at: s.updated_at,
        detected_at: new Date().toISOString(),
      }));
      // Best-effort: a unique index on (screen_id) prevents duplicates per
      // screen. Use upsert with ignoreDuplicates so a parallel insert from
      // another tab / quick re-fire of this effect doesn't surface as
      // 409 Conflict in the console — the duplicate row is silently skipped.
      await supabase
        .from("screen_alerts")
        .upsert(rows, { onConflict: "screen_id", ignoreDuplicates: true });
      if (!cancelled) await refreshAlerts();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offlineScreens.map((s) => s.id).join(","), activeOrgId, user?.id]);

  const handleAck = async (alert: AlertRow) => {
    if (!user) return;
    setBusyId(alert.id);
    const { error } = await supabase
      .from("screen_alerts")
      .update({
        status: "acknowledged",
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: user.id,
      })
      .eq("id", alert.id);
    setBusyId(null);
    if (error) {
      toast({ title: t("dashOfflineAlertsActionFailed"), variant: "destructive" });
      return;
    }
    toast({ title: t("dashOfflineAlertsAckSuccess") });
    await refreshAlerts();
    onChanged?.();
  };

  const handleResolve = async (alert: AlertRow) => {
    if (!user) return;
    setBusyId(alert.id);
    const { error } = await supabase
      .from("screen_alerts")
      .update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        resolved_by: user.id,
      })
      .eq("id", alert.id);
    setBusyId(null);
    if (error) {
      toast({ title: t("dashOfflineAlertsActionFailed"), variant: "destructive" });
      return;
    }
    toast({ title: t("dashOfflineAlertsResolveSuccess") });
    await refreshAlerts();
    onChanged?.();
  };

  const alertByScreen = useMemo(() => {
    const map = new Map<string, AlertRow>();
    alerts.forEach((a) => map.set(a.screen_id, a));
    return map;
  }, [alerts]);

  if (offlineScreens.length === 0) {
    return null;
  }

  return (
    <Card className="p-5 border-destructive/30 bg-destructive/[0.03] animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-full bg-destructive/15 flex items-center justify-center">
            <WifiOff className="w-4 h-4 text-destructive" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">{t("dashOfflineAlertsTitle")}</h3>
            <p className="text-xs text-muted-foreground">
              {t("dashOfflineAlertsCount").replace("{count}", String(offlineScreens.length))}
            </p>
          </div>
        </div>
        {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </div>

      <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
        {offlineScreens.map((screen) => {
          const alert = alertByScreen.get(screen.id);
          const lastSeen = alert?.last_seen_at || screen.updated_at;
          const isAcked = alert?.status === "acknowledged";
          return (
            <li
              key={screen.id}
              className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card hover:border-destructive/40 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-foreground truncate">{screen.name}</p>
                  {screen.branch && (
                    <span className="text-xs text-muted-foreground">· {screen.branch}</span>
                  )}
                  {isAcked && (
                    <Badge variant="outline" className="text-[10px] gap-1 border-amber-500/40 text-amber-600 dark:text-amber-400">
                      <BellOff className="w-3 h-3" />
                      {t("dashOfflineAlertsAcked")}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("dashOfflineAlertsLastSeen")}:{" "}
                  {lastSeen ? formatDistanceToNow(new Date(lastSeen), { addSuffix: true }) : t("dashOfflineAlertsNever")}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {alert && !isAcked && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5"
                    disabled={busyId === alert.id}
                    onClick={() => handleAck(alert)}
                  >
                    <BellOff className="w-3.5 h-3.5" />
                    {t("dashOfflineAlertsAck")}
                  </Button>
                )}
                {alert && canResolve && (
                  <Button
                    size="sm"
                    variant="default"
                    className="h-8 gap-1.5"
                    disabled={busyId === alert.id}
                    onClick={() => handleResolve(alert)}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {t("dashOfflineAlertsResolve")}
                  </Button>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  title={t("dashOfflineAlertsViewScreen")}
                  onClick={() => navigate(`/screens?focus=${screen.id}`)}
                >
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}