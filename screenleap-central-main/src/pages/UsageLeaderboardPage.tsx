import { DashboardLayout } from "@/components/DashboardLayout";
import PlanUsageLeaderboard from "@/components/admin/PlanUsageLeaderboard";
import { useLanguage } from "@/contexts/LanguageContext";
import { useNavigate } from "react-router-dom";

export default function UsageLeaderboardPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-5xl">
        <div className="animate-fade-in">
          <h1 className="text-2xl font-bold text-foreground">{t("tabUsageLeaderboard")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("planLeaderboardDesc")}</p>
        </div>
        <PlanUsageLeaderboard
          onUpgradeOrg={(orgId) => {
            // Navigate within HashRouter, passing the target org via location.state
            // so OrgManagement can open the edit dialog without a full-page reload.
            navigate("/org-management", { state: { upgradeOrgId: orgId } });
          }}
        />
      </div>
    </DashboardLayout>
  );
}
