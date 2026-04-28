import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { HardDrive, Monitor, Package, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";
import { useOrgPlan, PLAN_LABELS, formatBytes } from "@/hooks/useOrgPlan";
import { useInstalledApps } from "@/contexts/InstalledAppsContext";

interface QuotaRowProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  used: number;
  limit: number;
  formatValue?: (v: number) => string;
  onClick?: () => void;
}

function QuotaRow({ icon: Icon, label, used, limit, formatValue, onClick }: QuotaRowProps) {
  const fmt = formatValue ?? ((v: number) => String(v));
  const unlimited = limit < 0;
  const pct = unlimited ? 0 : Math.min((used / Math.max(limit, 1)) * 100, 100);
  const overLimit = !unlimited && used >= limit;
  const warn = !unlimited && pct > 80 && !overLimit;

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left space-y-1.5 rounded-lg p-2 -m-2 transition-colors hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 font-medium text-foreground">
          <Icon className="w-4 h-4 text-muted-foreground" />
          {label}
        </span>
        <span
          className={`text-xs tabular-nums ${
            overLimit ? "text-destructive font-bold" : "text-muted-foreground"
          }`}
        >
          {fmt(used)} / {unlimited ? "∞" : fmt(limit)}
        </span>
      </div>
      <Progress
        value={unlimited ? 100 : pct}
        className={`h-2 ${
          overLimit
            ? "[&>div]:bg-destructive"
            : warn
              ? "[&>div]:bg-orange-500"
              : unlimited
                ? "[&>div]:bg-success"
                : ""
        }`}
      />
    </button>
  );
}

export function PlanQuotaWidget() {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const { tier, limits, usage, loading } = useOrgPlan();
  const { installedApps } = useInstalledApps();

  const titles = {
    title: { zh: "方案用量", en: "Plan Usage", ja: "プラン使用量" },
    plan: { zh: "目前方案", en: "Current Plan", ja: "現在のプラン" },
    upgrade: { zh: "升級方案", en: "Upgrade", ja: "アップグレード" },
    media: { zh: "媒體櫃容量", en: "Media Storage", ja: "メディア容量" },
    screens: { zh: "螢幕數", en: "Screens", ja: "画面数" },
    apps: { zh: "應用商店模組", en: "App Modules", ja: "アプリモジュール" },
  };
  const t = (k: keyof typeof titles) => titles[k][language];

  return (
    <Card className="p-5 space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground leading-tight">{t("title")}</h3>
            <p className="text-xs text-muted-foreground leading-tight mt-0.5">
              {t("plan")}:{" "}
              <span className="font-medium text-foreground">
                {tier ? PLAN_LABELS[tier][language] : "—"}
              </span>
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          <div className="h-8 rounded bg-muted/50 animate-pulse" />
          <div className="h-8 rounded bg-muted/50 animate-pulse" />
          <div className="h-8 rounded bg-muted/50 animate-pulse" />
        </div>
      ) : (
        <div className="space-y-3">
          <QuotaRow
            icon={HardDrive}
            label={t("media")}
            used={usage.mediaBytes}
            limit={limits.mediaBytes}
            formatValue={formatBytes}
            onClick={() => navigate("/media")}
          />
          <QuotaRow
            icon={Monitor}
            label={t("screens")}
            used={usage.screens}
            limit={limits.maxScreens}
            onClick={() => navigate("/screens")}
          />
          <QuotaRow
            icon={Package}
            label={t("apps")}
            used={installedApps.size}
            limit={limits.maxApps}
            onClick={() => navigate("/apps")}
          />
        </div>
      )}
    </Card>
  );
}
