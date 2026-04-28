import { DashboardLayout } from "@/components/DashboardLayout";
import OrgManagement from "@/components/admin/OrgManagement";
import OrgLicenseStatus from "@/components/admin/OrgLicenseStatus";
import { useLanguage } from "@/contexts/LanguageContext";

export default function OrgManagementPage() {
  const { t } = useLanguage();
  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-5xl">
        <div className="animate-fade-in">
          <h1 className="text-2xl font-bold text-foreground">{t("navOrgMgmt")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("orgSubtitle")}</p>
        </div>
        <OrgLicenseStatus />
        <OrgManagement />
      </div>
    </DashboardLayout>
  );
}
