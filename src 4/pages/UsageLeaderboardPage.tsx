import { DashboardLayout } from "@/components/DashboardLayout";
import PlanUsageLeaderboard from "@/components/admin/PlanUsageLeaderboard";
import { useLanguage } from "@/contexts/LanguageContext";

export default function UsageLeaderboardPage() {
  const { t } = useLanguage();
  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-5xl">
        <div className="animate-fade-in">
          <h1 className="text-2xl font-bold text-foreground">{t("tabUsageLeaderboard")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("planLeaderboardDesc")}</p>
        </div>
        <PlanUsageLeaderboard
          onUpgradeOrg={(orgId) => {
            window.location.href = `/org-management#upgrade=${orgId}`;
          }}
        />
      </div>
    </DashboardLayout>
  );
}
