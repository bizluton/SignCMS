import { DashboardLayout } from "@/components/DashboardLayout";
import LicenseManagement from "@/components/admin/LicenseManagement";
import LicenseRedeemAttemptsPanel from "@/components/admin/LicenseRedeemAttemptsPanel";
import DeviceLicenseManagement from "@/components/admin/DeviceLicenseManagement";
import DeviceLicenseVerifyTester from "@/components/admin/DeviceLicenseVerifyTester";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole } from "@/hooks/useUserRole";
import { AlertTriangle, Loader2, Key, ShieldAlert, Cpu, Send } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useIsSystemAdmin } from "@/hooks/useIsSystemAdmin";

const CSLicensesPage = () => {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { loading, isCsAgent } = useUserRole();
  const { isSystemAdmin } = useIsSystemAdmin();
  const canManage = isSystemAdmin || isCsAgent;

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="flex flex-col h-full p-6 space-y-4 max-w-6xl">
        <div>
          <h1 className="text-xl font-bold text-foreground">{t("navCSLicenses")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("csLicensesSubtitle")}</p>
        </div>
        {canManage ? (
          <Tabs defaultValue="management" className="w-full">
            <TabsList>
              <TabsTrigger value="management"><Key className="w-4 h-4 mr-1" />授權管理</TabsTrigger>
              <TabsTrigger value="devices"><Cpu className="w-4 h-4 mr-1" />設備授權碼</TabsTrigger>
              <TabsTrigger value="verify"><Send className="w-4 h-4 mr-1" />設備端驗證測試</TabsTrigger>
              <TabsTrigger value="attempts"><ShieldAlert className="w-4 h-4 mr-1" />兌換嘗試紀錄</TabsTrigger>
            </TabsList>
            <TabsContent value="management" className="mt-4">
              <LicenseManagement />
            </TabsContent>
            <TabsContent value="devices" className="mt-4">
              <DeviceLicenseManagement />
            </TabsContent>
            <TabsContent value="verify" className="mt-4">
              <DeviceLicenseVerifyTester />
            </TabsContent>
            <TabsContent value="attempts" className="mt-4">
              <LicenseRedeemAttemptsPanel />
            </TabsContent>
          </Tabs>
        ) : (
          <Card>
            <CardContent className="pt-6 text-center space-y-3">
              <AlertTriangle className="w-12 h-12 text-warning mx-auto" />
              <h2 className="text-lg font-semibold text-foreground">{t("adminNoPermission")}</h2>
              <p className="text-sm text-muted-foreground">{t("csLicensesSysAdminOnly")}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
};

export default CSLicensesPage;
