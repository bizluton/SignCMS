import { useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clock, User, FileText, ShieldAlert, ChevronDown, ChevronRight, Download, ArrowRight } from "lucide-react";
import { localizeAction, localizeCategory, localizeActivityDetail } from "@/lib/activityLogI18n";
import type { ActivityLog } from "./types";
import { downloadRecentExport, getRecentExport } from "@/lib/recentExports";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface Props {
  logs: ActivityLog[];
}

const categoryColor = (cat: string) => {
  const map: Record<string, string> = {
    admin: "default",
    media: "secondary",
    screen: "outline",
    schedule: "secondary",
    publish: "default",
    security: "destructive",
    auth: "destructive",
    user: "default",
  };
  return (map[cat] || "outline") as "default" | "secondary" | "outline" | "destructive";
};

const formatTime = (iso: string) => new Date(iso).toLocaleString();

export default function ActivityLogList({ logs }: Props) {
  const { t, language } = useLanguage();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [drawerLog, setDrawerLog] = useState<ActivityLog | null>(null);

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (logs.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          {t("activityLogEmpty")}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
    <Card>
      <CardContent className="pt-4 space-y-1 max-h-[600px] overflow-y-auto">
        {logs.map(log => {
          const isSecurity = log.category === "security" || log.category === "auth";
          const isOpen = expanded.has(log.id);
          const isRetentionChange = (log.action_code || log.action) === "system.media_retention_days_changed";
          const clickable = isSecurity || isRetentionChange;
          const onRowClick = isSecurity
            ? () => toggle(log.id)
            : isRetentionChange
              ? () => setDrawerLog(log)
              : undefined;
          return (
            <div
              key={log.id}
              onClick={onRowClick}
              className={`flex items-start gap-3 p-3 rounded-lg transition-colors border-b border-border last:border-0 ${
                isSecurity
                  ? "bg-destructive/5 hover:bg-destructive/10 cursor-pointer"
                  : isRetentionChange
                    ? "hover:bg-muted/70 cursor-pointer"
                    : "hover:bg-muted/50"
              }`}
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${isSecurity ? "bg-destructive/15" : "bg-primary/10"}`}>
                {isSecurity ? <ShieldAlert className="w-4 h-4 text-destructive" /> : <FileText className="w-4 h-4 text-primary" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {isSecurity && (
                    isOpen ? <ChevronDown className="w-3 h-3 text-destructive" /> : <ChevronRight className="w-3 h-3 text-destructive" />
                  )}
                  <span className="text-sm font-medium text-foreground">{localizeAction(log.action, language)}</span>
                  <Badge variant={categoryColor(log.category)} className={`text-[10px] ${isSecurity ? "shadow-sm" : ""}`}>
                    {isSecurity && <ShieldAlert className="w-3 h-3 mr-1" />}
                    {localizeCategory(log.category, language)}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><User className="w-3 h-3" />{log.display_name || log.user_id.slice(0, 8)}</span>
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatTime(log.created_at)}</span>
                </div>
                {(log.target_name || log.detail || log.detail_json || (log.action_params && Object.keys(log.action_params as object).length > 0)) && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {log.target_name && <span className="font-medium">{log.target_name}</span>}
                    <span> {localizeActivityDetail(log, language)}</span>
                  </p>
                )}
                {isSecurity && !isOpen && (
                  <p className="text-[10px] text-destructive/70 mt-1 italic">{t("activityLogClickToExpand")}</p>
                )}
                {isRetentionChange && (
                  <p className="text-[10px] text-primary/80 mt-1 italic">{t("activityLogClickToView")}</p>
                )}
                {log.action === "export_schedule" && (
                  <div className="mt-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        const ok = downloadRecentExport(log.id);
                        if (!ok) toast.error(t("activityLogRedownloadExpired"));
                      }}
                      disabled={!getRecentExport(log.id)}
                    >
                      <Download className="w-3 h-3 mr-1.5" />
                      {t("activityLogRedownload")}
                    </Button>
                  </div>
                )}
                {isSecurity && isOpen && (
                  <div className="mt-2 p-3 rounded-md bg-background border border-destructive/30 text-xs space-y-1.5 font-mono">
                    <DetailRow label={t("activityLogDetailIp")} value={log.ip_address || "—"} />
                    <DetailRow label={t("activityLogDetailTarget")} value={log.target_name || "—"} />
                    <DetailRow label={t("activityLogDetailTargetType")} value={log.target_type || "—"} />
                    <DetailRow label={t("activityLogDetailTargetId")} value={log.target_id || "—"} />
                    <DetailRow label={t("activityLogDetailUserId")} value={log.user_id} />
                    <DetailRow label={t("activityLogDetailFull")} value={log.detail_json ? JSON.stringify(log.detail_json, null, 2) : (log.detail || "—")} multiline />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
    <RetentionChangeDrawer log={drawerLog} onClose={() => setDrawerLog(null)} />
    </>
  );
}

function DetailRow({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div className={multiline ? "" : "flex gap-2"}>
      <span className="text-muted-foreground shrink-0">{label}:</span>
      <span className={`text-foreground break-all ${multiline ? "block mt-1 whitespace-pre-wrap" : ""}`}>{value}</span>
    </div>
  );
}

function RetentionChangeDrawer({ log, onClose }: { log: ActivityLog | null; onClose: () => void }) {
  const { t, language } = useLanguage();
  const open = !!log;
  const params = (log?.action_params || {}) as { old_value?: number | string; new_value?: number | string };
  const oldVal = params.old_value;
  const newVal = params.new_value;
  const fmtDays = (v: number | string | undefined) =>
    v === undefined || v === null || v === ""
      ? "—"
      : t("activityLogDetailRetentionDays").replace("{value}", String(v));
  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t("activityLogDetailTitle")}</SheetTitle>
          <SheetDescription>
            {log ? localizeAction(log.action, language) : ""}
          </SheetDescription>
        </SheetHeader>
        {log && (
          <div className="mt-6 space-y-4 text-sm">
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                {t("activityLogDetailAction")}
              </div>
              <div className="flex items-center justify-center gap-3 py-2">
                <div className="flex-1 text-center">
                  <div className="text-[10px] text-muted-foreground mb-1">
                    {t("activityLogDetailOldValue")}
                  </div>
                  <div className="text-2xl font-semibold text-muted-foreground">{fmtDays(oldVal)}</div>
                </div>
                <ArrowRight className="w-5 h-5 text-primary shrink-0" />
                <div className="flex-1 text-center">
                  <div className="text-[10px] text-primary mb-1">
                    {t("activityLogDetailNewValue")}
                  </div>
                  <div className="text-2xl font-semibold text-primary">{fmtDays(newVal)}</div>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <InfoRow
                icon={<User className="w-3.5 h-3.5" />}
                label={t("activityLogDetailChangedBy")}
                value={log.display_name || log.user_id}
              />
              <InfoRow
                icon={<Clock className="w-3.5 h-3.5" />}
                label={t("activityLogDetailChangedAt")}
                value={formatTime(log.created_at)}
              />
              <InfoRow
                icon={<FileText className="w-3.5 h-3.5" />}
                label={t("activityLogDetailCategory")}
                value={localizeCategory(log.category, language)}
              />
              {log.target_name && (
                <InfoRow
                  icon={<FileText className="w-3.5 h-3.5" />}
                  label={t("activityLogDetailTarget")}
                  value={log.target_name}
                />
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-border last:border-0">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-[110px] shrink-0">
        {icon}
        {label}
      </span>
      <span className="text-sm text-foreground break-all">{value}</span>
    </div>
  );
}
