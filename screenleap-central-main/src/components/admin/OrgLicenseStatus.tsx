import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";
import { useUserRole } from "@/hooks/useUserRole";
import { useIsSystemAdmin } from "@/hooks/useIsSystemAdmin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Key, ShieldCheck, CalendarClock } from "lucide-react";
import { toast } from "sonner";

export default function OrgLicenseStatus() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { activeOrgId } = useActiveOrg();
  const { isAdmin, isOrgAdmin } = useUserRole();
  const { isSystemAdmin } = useIsSystemAdmin();
  const canView = isOrgAdmin || isAdmin || isSystemAdmin;

  const [orgData, setOrgData] = useState<{ name: string; license_plan: string; license_expires_at: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);

  useEffect(() => {
    if (!activeOrgId || !canView) { setOrgData(null); setLoading(false); return; }
    fetchOrg();
  }, [activeOrgId, canView]);

  const fetchOrg = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("organizations")
      .select("name, license_plan, license_expires_at")
      .eq("id", activeOrgId!)
      .single();
    setOrgData(data as any);
    setLoading(false);
  };

  const handleRedeem = async () => {
    if (!code.trim() || !activeOrgId) {
      toast.error(t("licenseNoOrg"));
      return;
    }
    setRedeeming(true);
    const { data, error } = await supabase.rpc("redeem_license_code", {
      _code: code.trim(),
      _org_id: activeOrgId,
    });
    const ERROR_MAP: Record<string, string> = {
      rate_limited: "嘗試次數過多，請於 15 分鐘後再試",
      code_not_found: "找不到該授權碼",
      code_already_redeemed: "授權碼已被兌換",
      code_not_for_this_org: "此授權碼不適用本組織",
      permission_denied: "權限不足",
      org_not_found: "找不到組織",
    };
    if (error) {
      toast.error(t("licenseRedeemFailed"));
    } else {
      const result = data as any;
      if (result?.success) {
        toast.success(t("licenseRedeemSuccess"));
        setCode("");
        fetchOrg();
      } else {
        toast.error(ERROR_MAP[result?.error] || result?.error || t("licenseRedeemFailed"));
      }
    }
    setRedeeming(false);
  };

  // Only org_admin (non-system-admin) should see this
  if (!canView) return null;

  if (loading) return <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  if (!orgData || !activeOrgId) return null;

  const daysLeft = Math.ceil((new Date(orgData.license_expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const expired = daysLeft <= 0;
  const expiring = daysLeft > 0 && daysLeft <= 30;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <ShieldCheck className="w-5 h-5" />
          {t("licenseStatus")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">{t("licenseOrgName")}</p>
            <p className="font-medium text-sm">{orgData.name}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("licensePlan")}</p>
            <p className="font-medium text-sm">{orgData.license_plan}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("licenseExpiresAt")}</p>
            <p className="font-medium text-sm">{new Date(orgData.license_expires_at).toLocaleDateString()}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("licenseStatus")}</p>
            {expired ? (
              <Badge variant="destructive">{t("licenseExpired")}</Badge>
            ) : expiring ? (
              <Badge variant="outline" className="border-orange-500 text-orange-500">{t("licenseExpiring")}</Badge>
            ) : (
              <Badge variant="default">{t("licenseActive")}</Badge>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <div className="flex-1 space-y-1">
            <Label className="text-xs">{t("licenseRedeemCode")}</Label>
            <Input
              placeholder="XXXX-XXXX-XXXX-XXXX-XXX"
              value={code}
              onChange={e => setCode(e.target.value)}
              className="font-mono text-sm"
            />
          </div>
          <Button className="mt-5" onClick={handleRedeem} disabled={redeeming || !code.trim()}>
            {redeeming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4 mr-1" />}
            {t("licenseRedeem")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
