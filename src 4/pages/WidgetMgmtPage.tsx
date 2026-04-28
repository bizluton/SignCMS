import { DashboardLayout } from "@/components/DashboardLayout";
import WidgetManagement from "@/components/admin/WidgetManagement";
import { useLanguage } from "@/contexts/LanguageContext";

export default function WidgetMgmtPage() {
  const { t } = useLanguage();
  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-5xl">
        <div className="animate-fade-in">
          <h1 className="text-2xl font-bold text-foreground">{t("widgetMgmtTitle")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("widgetMgmtDesc")}</p>
        </div>
        <WidgetManagement />
      </div>
    </DashboardLayout>
  );
}
