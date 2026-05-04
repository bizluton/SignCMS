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

// Accent palette — cycles through queues
const ACCENTS = [
  { bar: "from-blue-500 to-cyan-400",    glow: "shadow-blue-500/20",   ring: "ring-blue-500/40",   num: "text-blue-300"   },
  { bar: "from-violet-500 to-purple-400", glow: "shadow-violet-500/20", ring: "ring-violet-500/40", num: "text-violet-300" },
  { bar: "from-emerald-500 to-teal-400", glow: "shadow-emerald-500/20", ring: "ring-emerald-500/40", num: "text-emerald-300" },
  { bar: "from-amber-500 to-orange-400", glow: "shadow-amber-500/20",   ring: "ring-amber-500/40",  num: "text-amber-300"  },
  { bar: "from-rose-500 to-pink-400",    glow: "shadow-rose-500/20",    ring: "ring-rose-500/40",   num: "text-rose-300"   },
  { bar: "from-indigo-500 to-sky-400",   glow: "shadow-indigo-500/20",  ring: "ring-indigo-500/40", num: "text-sky-300"    },
];

// ── QueueStatusCards ───────────────────────────────────────────────────────────

function QueueStatusCards({ orgId, lang }: { orgId: string; lang: string }) {
  const [cards, setCards] = useState<QueueCardData[]>([]);
  const [now, setNow] = useState(() => new Date());

  const t = (zh: string, en: string, ja: string) => ({ zh, en, ja }[lang] ?? en);

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
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-border" />
        <h2 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase px-2">
          {t("各隊列即時狀態", "Live Queue Status", "リアルタイム状態")}
        </h2>
        <div className="h-px flex-1 bg-border" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {cards.map((card, idx) => {
          const accent    = ACCENTS[idx % ACCENTS.length];
          const elapsed   = card.lastCalledAt ? now.getTime() - card.lastCalledAt.getTime() : null;
          const interval  = card.lastCalledAt && card.prevCalledAt
            ? card.lastCalledAt.getTime() - card.prevCalledAt.getTime()
            : null;
          const displayNum = card.current_number > 0
            ? `${card.prefix}${String(card.current_number).padStart(3, "0")}`
            : "—";
          const isRecent  = elapsed !== null && elapsed < 30_000;
          const hasData   = card.current_number > 0;

          return (
            <div
              key={card.id}
              className={cn(
                "relative overflow-hidden rounded-2xl bg-gray-900 flex flex-col transition-all duration-500",
                isRecent
                  ? `ring-2 shadow-xl ${accent.ring} ${accent.glow}`
                  : "ring-1 ring-white/10 shadow-md",
              )}
            >
              {/* Gradient accent bar */}
              <div className={cn("h-1.5 w-full bg-gradient-to-r shrink-0", accent.bar)} />

              {/* Body */}
              <div className="flex flex-col flex-1 px-5 pt-4 pb-5 gap-3">
                {/* Queue name + live dot */}
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-semibold tracking-wide text-white/50 uppercase leading-tight">
                    {card.queue_name}
                  </p>
                  {isRecent && (
                    <span className="relative flex h-2 w-2 shrink-0 mt-0.5">
                      <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-gradient-to-r", accent.bar)} />
                      <span className={cn("relative inline-flex h-2 w-2 rounded-full bg-gradient-to-r", accent.bar)} />
                    </span>
                  )}
                </div>

                {/* Big number */}
                <div className="flex-1 flex items-center justify-center py-2">
                  <span
                    className={cn(
                      "font-black tabular-nums tracking-tighter leading-none transition-colors duration-500",
                      hasData
                        ? isRecent ? accent.num : "text-white"
                        : "text-white/20",
                    )}
                    style={{ fontSize: "clamp(2.5rem, 8vw, 4rem)" }}
                  >
                    {displayNum}
                  </span>
                </div>

                {/* Counter name */}
                {card.counter_name && (
                  <p className="text-xs text-white/40 text-center -mt-1 truncate">
                    {card.counter_name}
                  </p>
                )}

                {/* Divider */}
                <div className="h-px bg-white/8" />

                {/* Time stats */}
                {elapsed !== null ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-white/35">{t("叫號後", "Since call", "呼出しから")}</span>
                      <span className={cn(
                        "text-[11px] font-semibold tabular-nums",
                        isRecent ? "text-white/90" : "text-white/55",
                      )}>
                        {fmtDuration(elapsed)}
                      </span>
                    </div>
                    {interval !== null && (
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-white/35">{t("與上一號間隔", "Interval", "前回との間隔")}</span>
                        <span className="text-[11px] font-semibold tabular-nums text-white/55">
                          {fmtDuration(interval)}
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-white/25 text-center">
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
        <div className="bg-card border border-border rounded-2xl p-6">
          <QueueControlPanel />
        </div>

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
