import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/contexts/LanguageContext";
import { Loader2, Wifi, WifiOff, Settings, CalendarClock, AlertTriangle, RefreshCw, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { renderScreenLog } from "@/lib/screenLogI18n";

interface ScreenLog {
  id: string;
  event_type: string;
  event_title: string;
  event_detail: string;
  event_code: string | null;
  event_params: Record<string, unknown> | null;
  created_at: string;
  created_by: string | null;
  operator_name?: string;
}

const EVENT_TYPE_CONFIG: Record<string, { icon: typeof Wifi; color: string; label: { zh: string; en: string; ja: string } }> = {
  status: { icon: Wifi, color: "bg-blue-500/10 text-blue-600 dark:text-blue-400", label: { zh: "狀態", en: "Status", ja: "ステータス" } },
  config: { icon: Settings, color: "bg-amber-500/10 text-amber-600 dark:text-amber-400", label: { zh: "設定", en: "Config", ja: "設定" } },
  schedule: { icon: CalendarClock, color: "bg-green-500/10 text-green-600 dark:text-green-400", label: { zh: "排程", en: "Schedule", ja: "スケジュール" } },
  system: { icon: AlertTriangle, color: "bg-purple-500/10 text-purple-600 dark:text-purple-400", label: { zh: "系統", en: "System", ja: "システム" } },
};

interface ScreenLogPanelProps {
  screenId: string;
}

export function ScreenLogPanel({ screenId }: ScreenLogPanelProps) {
  const { language } = useLanguage();
  const [logs, setLogs] = useState<ScreenLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState("all");

  const fetchLogs = async () => {
    setLoading(true);
    const [logsRes, profilesRes] = await Promise.all([
      (supabase as any)
        .from("screen_logs")
        .select("id, event_type, event_title, event_detail, event_code, event_params, created_at, created_by")
        .eq("screen_id", screenId)
        .order("created_at", { ascending: false })
        .limit(50),
      (supabase as any).from("profiles").select("user_id, display_name"),
    ]);
    const profileMap = new Map((profilesRes.data || []).map((p: any) => [p.user_id, p.display_name]));
    setLogs((logsRes.data || []).map((l: any) => ({
      ...l,
      operator_name: l.created_by ? (profileMap.get(l.created_by) || "Unknown") : undefined,
    })));
    setLoading(false);
  };

  useEffect(() => { fetchLogs(); }, [screenId]);

  const filtered = filterType === "all" ? logs : logs.filter(l => l.event_type === filterType);

  const labels = {
    title: { zh: "狀態紀錄", en: "Status Logs", ja: "ステータスログ" },
    allTypes: { zh: "所有類型", en: "All Types", ja: "全タイプ" },
    noLogs: { zh: "暫無紀錄", en: "No logs yet", ja: "ログなし" },
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[140px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{labels.allTypes[language]}</SelectItem>
            {Object.entries(EVENT_TYPE_CONFIG).map(([key, cfg]) => (
              <SelectItem key={key} value={key}>{cfg.label[language]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={fetchLogs} title={labels.title[language]}>
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-xs text-muted-foreground py-8">{labels.noLogs[language]}</p>
      ) : (
        <div className="space-y-1 max-h-[340px] overflow-y-auto pr-1">
          {filtered.map((log) => {
            const cfg = EVENT_TYPE_CONFIG[log.event_type] || EVENT_TYPE_CONFIG.system;
            const Icon = cfg.icon;
            const rendered = renderScreenLog(log, language);
            return (
              <div key={log.id} className="flex items-start gap-2.5 py-2 px-2 rounded-md hover:bg-muted/50 transition-colors">
                <div className={`mt-0.5 p-1 rounded ${cfg.color}`}>
                  <Icon className="w-3 h-3" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-foreground">{rendered.title}</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">{cfg.label[language]}</Badge>
                  </div>
                  {rendered.detail && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">{rendered.detail}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5 flex items-center gap-2">
                    {log.operator_name && (
                      <span className="flex items-center gap-0.5"><User className="w-2.5 h-2.5" />{log.operator_name}</span>
                    )}
                    <span>{format(new Date(log.created_at), "yyyy-MM-dd HH:mm:ss")}</span>
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
