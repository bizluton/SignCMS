import { useOrgLicense } from "@/hooks/useOrgLicense";
import { useLanguage } from "@/contexts/LanguageContext";
import { AlertTriangle, ShieldAlert } from "lucide-react";

/**
 * Renders a warning/error banner when the org license is expiring soon or expired.
 * Place at the top of DashboardLayout's main content area.
 */
export function LicenseBanner() {
  const { license } = useOrgLicense();
  const { t } = useLanguage();

  if (!license) return null;

  if (license.expired) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-2.5 text-sm text-destructive mb-4">
        <ShieldAlert className="w-5 h-5 shrink-0" />
        <div>
          <span className="font-semibold">{t("licenseExpiredBanner")}</span>
          <span className="ml-1">{t("licenseExpiredBannerDesc")}</span>
        </div>
      </div>
    );
  }

  if (license.expiringSoon) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-orange-400/50 bg-orange-50 dark:bg-orange-950/20 px-4 py-2.5 text-sm text-orange-700 dark:text-orange-400 mb-4">
        <AlertTriangle className="w-5 h-5 shrink-0" />
        <div>
          <span className="font-semibold">{t("licenseExpiringBanner")}</span>
          <span className="ml-1">
            {license.daysLeft} {t("licenseExpiringBannerDays")}
          </span>
        </div>
      </div>
    );
  }

  return null;
}
