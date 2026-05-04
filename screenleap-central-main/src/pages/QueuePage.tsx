import { useState, useEffect, useCallback } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";
import { Monitor, Smartphone, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import QueueControlPanel from "@/components/widgets/QueueControlPanel";
import QueueDisplayWidget from "@/components/widgets/QueueDisplayWidget";

// ── Types ──────────────────────────────────────────────────────────────────────

interface QueueCardData {
  id: string;
  queue_name: string;
  prefix: string;
  current_number: number;
  lastCalledAt: Date | null;
  prevCalledAt: Date | null;
  counter_name: string;
}

// ── QueueStatusCards ───────────────────────────────────────────────────────────

function QueueStatusCards({ orgId, lang }: { orgId: string; lang: string }) {
  const [cards, setCards] = useState<QueueCardData[]>([]);
  const [now, setNow] = useState(() => new Date());

  const t = (zh: string, en: string, ja: string) => ({ zh, en, ja }[lang] ?? en);

  // Tick every second for live elapsed times
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const loadData = useCallback(async () => {
    const { data: queues } = await supabase
      .from("queue_system_queues")
      .select("id, queue_name, prefix, current_number")
      .eq("org_id", orgId)
      .order("created_at");

    if (!queues?.length) { setCards([]); return; }

    const cardData: QueueCardData[] = await Promise.all(
      queues.map(async (q) => {
        const { data: tickets } = await supabase
          .from("queue_system_tickets")
          .select("called_at, counter_name")
          .eq("queue_id", q.id)
          .not("called_at", "is", null)
          .order("called_at", { ascending: false })
          .limit(2);

        return {
          ...(q as { id: string; queue_name: string; prefix: string; current_number: number }),
          lastCalledAt: tickets?.[0]?.called_at ? new Date(tickets[0].called_at as string) : null,
          prevCalledAt: tickets?.[1]?.called_at ? new Date(tickets[1].called_at as string) : null,
          counter_name: (tickets?.[0] as { counter_name?: string } | undefined)?.counter_name ?? "",
        };
      }),
    );
    setCards(cardData);
  }, [orgId]);

  useEffect(() => { void loadData(); }, [loadData]);

  // Realtime — refresh cards on any queue or ticket change
  useEffect(() => {
    const channel = supabase
      .channel("qs-status-cards")
      .on("postgres_changes", { event: "*", schema: "public", table: "queue_system_queues" }, () => void loadData())
      .on("postgres_changes", { event: "*", schema: "public", table: "queue_system_tickets" }, () => void loadData())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadData]);

  const fmtDuration = (ms: number) => {
    if (ms < 0) return "—";
    const secs = Math.floor(ms / 1000);
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    if (mins === 0) return `${s}${t("秒", "s", "秒")}`;
    return `${mins}${t("分", "m", "分")}${s > 0 ? `${s}${t("秒", "s", "秒")}` : ""}`;
  };

  if (cards.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
        <Users className="h-4 w-4" />
        {t("各隊列即時狀態", "Live Queue Status", "リアルタイム状態")}
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {cards.map((card) => {
          const elapsed  = card.lastCalledAt ? now.getTime() - card.lastCalledAt.getTime() : null;
          const interval = card.lastCalledAt && card.prevCalledAt
            ? card.lastCalledAt.getTime() - card.prevCalledAt.getTime()
            : null;
          const displayNum = card.current_number > 0
            ? `${card.prefix}${String(card.current_number).padStart(3, "0")}`
            : "—";
          const isRecent = elapsed !== null && elapsed < 30_000;

          return (
            <div
              key={card.id}
              className={cn(
                "relative rounded-2xl border p-5 space-y-2 transition-all duration-500",
                isRecent
                  ? "border-blue-400 bg-blue-50/50 dark:bg-blue-950/20 shadow-md shadow-blue-100 dark:shadow-blue-950/30"
                  : "border-border bg-card",
              )}
            >
              {/* Live pulse dot */}
              {isRecent && (
                <span className="absolute top-3 right-3 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                </span>
              )}

              {/* Queue name */}
              <p className="text-sm font-medium text-muted-foreground truncate pr-4">{card.queue_name}</p>

              {/* Big ticket number */}
              <div className={cn(
                "text-5xl font-black tabular-nums tracking-tight leading-none",
                isRecent ? "text-blue-600 dark:text-blue-400" : "text-foreground",
              )}>
                {displayNum}
              </div>

              {/* Counter label */}
              {card.counter_name && (
                <p className="text-xs text-muted-foreground">{card.counter_name}</p>
              )}

              {/* Time stats */}
              <div className="pt-2 border-t border-border/50 space-y-1">
                {elapsed !== null ? (
                  <>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{t("叫號後經過", "Since call", "呼出しから")}</span>
                      <span className="font-medium tabular-nums text-foreground">{fmtDuration(elapsed)}</span>
                    </div>
                    {interval !== null && (
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{t("與上一號間隔", "Call interval", "前回との間隔")}</span>
                        <span className="font-medium tabular-nums">{fmtDuration(interval)}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground/60 text-center py-1">
                    {t("尚未叫號", "No calls yet", "まだ呼出しなし")}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── QueuePage ──────────────────────────────────────────────────────────────────

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

      {/* Operator panel + live preview */}
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

      {/* Per-queue status cards */}
      {activeOrgId && (
        <QueueStatusCards orgId={activeOrgId} lang={language} />
      )}
    </div>
  );
};

export default QueuePage;
