import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/contexts/LanguageContext";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldAlert, ShieldCheck, AlertTriangle } from "lucide-react";

const SECURITY_ALERT_THRESHOLD = 10;

export default function SecurityStatCard() {
  const { t } = useLanguage();
  const { activeOrgId } = useActiveOrg();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const fetchCount = async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      let query = supabase
        .from("activity_logs")
        .select("id", { count: "exact", head: true })
        .in("category", ["security", "auth"])
        .gte("created_at", since);
      if (activeOrgId) query = query.eq("org_id", activeOrgId);
      const { count: c } = await query;
      setCount(c ?? 0);
    };
    fetchCount();
  }, [activeOrgId]);

  const isAlert = (count ?? 0) >= SECURITY_ALERT_THRESHOLD;
  const display = count === null ? "…" : String(count);

  return (
    <Card className={isAlert ? "border-destructive/60 bg-destructive/5" : ""}>
      <CardContent className="pt-4 pb-4 flex items-center gap-4">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${isAlert ? "bg-destructive/15" : "bg-primary/10"}`}>
          {isAlert
            ? <ShieldAlert className="w-6 h-6 text-destructive" />
            : <ShieldCheck className="w-6 h-6 text-primary" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">{t("activityLogSecurity24h")}</span>
          </div>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className={`text-2xl font-bold ${isAlert ? "text-destructive" : "text-foreground"}`}>{display}</span>
            <span className="text-xs text-muted-foreground">{t("activityLogSecurity24hSubtitle")}</span>
          </div>
          {isAlert ? (
            <p className="text-xs text-destructive mt-1 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              {t("activityLogSecurityAlert")}
            </p>
          ) : count !== null && (
            <p className="text-xs text-muted-foreground mt-1">{t("activityLogSecurityNormal")}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
