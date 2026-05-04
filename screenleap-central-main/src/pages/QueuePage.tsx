import { useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";
import { Monitor, Smartphone, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import QueueControlPanel from "@/components/widgets/QueueControlPanel";
import QueueDisplayWidget from "@/components/widgets/QueueDisplayWidget";

const QueuePage = () => {
  const { language } = useLanguage();
  const { activeOrgId } = useActiveOrg();
  const [previewMode, setPreviewMode] = useState<"landscape" | "portrait">("landscape");

  const t = (zh: string, en: string, ja: string) => ({ zh, en, ja }[language] ?? en);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-lg">
          <Users className="h-5 w-5 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-foreground">
          {t("排隊叫號管理", "Queue Management", "順番呼出し管理")}
        </h1>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Left: Operator control panel */}
        <div className="bg-card border border-border rounded-2xl p-6">
          <QueueControlPanel />
        </div>

        {/* Right: Live display preview */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Monitor className="h-5 w-5" />
              {t("即時模擬預覽", "Live Preview", "リアルタイムプレビュー")}
            </h2>
            <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
              <Button
                size="sm"
                variant={previewMode === "landscape" ? "default" : "ghost"}
                onClick={() => setPreviewMode("landscape")}
                className="text-xs h-8 gap-1"
              >
                <Monitor className="h-3.5 w-3.5" />
                {t("橫式螢幕", "Landscape", "横型")}
              </Button>
              <Button
                size="sm"
                variant={previewMode === "portrait" ? "default" : "ghost"}
                onClick={() => setPreviewMode("portrait")}
                className="text-xs h-8 gap-1"
              >
                <Smartphone className="h-3.5 w-3.5" />
                {t("直式螢幕", "Portrait", "縦型")}
              </Button>
            </div>
          </div>

          <div className="flex justify-center">
            <div
              className={cn(
                "relative rounded-xl border-4 border-gray-700 shadow-2xl overflow-hidden transition-all duration-300",
                previewMode === "landscape" ? "w-full aspect-video" : "w-[280px] aspect-[9/16]",
              )}
            >
              {activeOrgId ? (
                <QueueDisplayWidget config={{ orgId: activeOrgId }} />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gray-950 text-white/40 text-sm">
                  {t("請先選擇組織", "Select an org first", "組織を選択してください")}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QueuePage;
