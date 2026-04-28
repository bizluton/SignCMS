import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Upload,
  Code2,
  FileImage,
  FileVideo,
  Sparkles,
  Clock,
  CloudSun,
  QrCode,
  Type as TypeIcon,
  X,
} from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

interface MediaEmptyStateProps {
  /** True when filters/search hide everything but library has content. */
  hasFilters: boolean;
  /** True when the user has permission to upload / add widgets. */
  canManage: boolean;
  onUploadClick: () => void;
  onAddWidgetClick: () => void;
  onClearFilters: () => void;
}

/**
 * Empty state for the media library.
 * - Filtered-empty: shows a compact message with "clear filters" action.
 * - Truly-empty: shows onboarding CTAs + 3 example sample cards (image / video / widget).
 */
export const MediaEmptyState = ({
  hasFilters,
  canManage,
  onUploadClick,
  onAddWidgetClick,
  onClearFilters,
}: MediaEmptyStateProps) => {
  const { t } = useLanguage();

  if (hasFilters) {
    return (
      <Card className="flex flex-col items-center justify-center gap-3 p-10 text-center">
        <p className="text-sm text-muted-foreground">{t("mediaNoResult")}</p>
        <Button variant="outline" size="sm" onClick={onClearFilters} className="gap-2">
          <X className="h-4 w-4" />
          {t("mediaEmptyClearFilters")}
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Hero onboarding card */}
      <Card className="relative overflow-hidden border-dashed bg-gradient-to-br from-primary/5 via-background to-background p-8 sm:p-12">
        <div className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 -left-10 h-44 w-44 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative flex flex-col items-center gap-5 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20">
            <Upload className="h-7 w-7" />
          </div>
          <div className="space-y-2 max-w-xl">
            <h3 className="text-xl font-semibold text-foreground sm:text-2xl">
              {t("mediaEmptyTitle")}
            </h3>
            <p className="text-sm text-muted-foreground sm:text-base">
              {t("mediaEmptyDesc")}
            </p>
          </div>
          {canManage && (
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              <Button onClick={onUploadClick} className="gap-2">
                <Upload className="h-4 w-4" />
                {t("uploadMedia")}
              </Button>
              <Button variant="outline" onClick={onAddWidgetClick} className="gap-2">
                <Code2 className="h-4 w-4" />
                {t("mediaAddWidget")}
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t("mediaEmptyUploadHint")}</p>
        </div>
      </Card>

      {/* Sample cards */}
      <div>
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Sparkles className="h-4 w-4 text-primary" />
          <span>{t("mediaEmptySamplesTitle")}</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {/* Image sample */}
          <Card className="overflow-hidden">
            <div className="relative flex aspect-video items-center justify-center bg-gradient-to-br from-orange-500/30 via-pink-500/20 to-purple-600/30">
              <FileImage className="h-10 w-10 text-foreground/70" />
              <span className="absolute left-2 top-2 rounded bg-background/80 px-1.5 py-0.5 text-[10px] font-medium backdrop-blur-sm">
                {t("image")}
              </span>
            </div>
            <div className="space-y-1 p-3">
              <p className="text-sm font-medium">{t("mediaEmptySampleImage")}</p>
              <p className="text-xs text-muted-foreground">{t("mediaEmptySampleImageDesc")}</p>
            </div>
          </Card>

          {/* Video sample */}
          <Card className="overflow-hidden">
            <div className="relative flex aspect-video items-center justify-center bg-gradient-to-br from-blue-500/30 via-cyan-500/20 to-teal-500/30">
              <FileVideo className="h-10 w-10 text-foreground/70" />
              <span className="absolute left-2 top-2 rounded bg-background/80 px-1.5 py-0.5 text-[10px] font-medium backdrop-blur-sm">
                {t("video")}
              </span>
              <span className="absolute bottom-2 right-2 rounded bg-foreground/80 px-1.5 py-0.5 text-[10px] text-background">
                00:30
              </span>
            </div>
            <div className="space-y-1 p-3">
              <p className="text-sm font-medium">{t("mediaEmptySampleVideo")}</p>
              <p className="text-xs text-muted-foreground">{t("mediaEmptySampleVideoDesc")}</p>
            </div>
          </Card>

          {/* Widget sample */}
          <Card className="overflow-hidden">
            <div className="relative grid aspect-video grid-cols-2 grid-rows-2 gap-1 bg-[#1a1a2e] p-2 text-white">
              <div className="flex items-center justify-center rounded bg-white/5">
                <Clock className="h-5 w-5" />
              </div>
              <div className="flex items-center justify-center rounded bg-white/5">
                <CloudSun className="h-5 w-5" />
              </div>
              <div className="flex items-center justify-center rounded bg-white/5">
                <QrCode className="h-5 w-5" />
              </div>
              <div className="flex items-center justify-center rounded bg-white/5">
                <TypeIcon className="h-5 w-5" />
              </div>
              <span className="absolute left-2 top-2 rounded bg-background/80 px-1.5 py-0.5 text-[10px] font-medium text-foreground backdrop-blur-sm">
                {t("widget")}
              </span>
            </div>
            <div className="space-y-1 p-3">
              <p className="text-sm font-medium">{t("mediaEmptySampleWidget")}</p>
              <p className="text-xs text-muted-foreground">{t("mediaEmptySampleWidgetDesc")}</p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};