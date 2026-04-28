import { DashboardLayout } from "@/components/DashboardLayout";
import CSDashboard from "@/components/customer-service/CSDashboard";
import { useLanguage } from "@/contexts/LanguageContext";

const CSDashboardPage = () => {
  const { t } = useLanguage();
  return (
    <DashboardLayout>
      <div className="flex flex-col h-full p-6 space-y-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-foreground">{t("navCSDashboard")}</h1>
        </div>
        <CSDashboard />
      </div>
    </DashboardLayout>
  );
};

export default CSDashboardPage;
