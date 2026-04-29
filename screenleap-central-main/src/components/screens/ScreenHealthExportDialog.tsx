import { useMemo, useState } from "react";
import { Download, FileText, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "sonner";

interface ScreenLike {
  id: string;
  name: string;
  branch?: string;
  online: boolean;
  ip_address?: string;
  updated_at?: string;
}

interface Props {
  screens: ScreenLike[];
  alertedScreenIds: Set<string>;
}

const PRESETS = [
  { key: "24h", hours: 24 },
  { key: "7d", hours: 24 * 7 },
  { key: "30d", hours: 24 * 30 },
  { key: "all", hours: 0 },
] as const;

function toLocalInputValue(d: Date) {
  const tz = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}

export function ScreenHealthExportDialog({ screens, alertedScreenIds }: Props) {
  const { t, language } = useLanguage();
  const [open, setOpen] = useState(false);
  const now = useMemo(() => new Date(), [open]);
  const [from, setFrom] = useState(() =>
    toLocalInputValue(new Date(Date.now() - 24 * 60 * 60 * 1000)),
  );
  const [to, setTo] = useState(() => toLocalInputValue(new Date()));
  const [allTime, setAllTime] = useState(false);

  const fromMs = allTime ? 0 : new Date(from).getTime();
  const toMs = allTime ? Number.MAX_SAFE_INTEGER : new Date(to).getTime();

  const filtered = useMemo(() => {
    return screens.filter((s) => {
      if (allTime) return true;
      if (!s.updated_at) return false;
      const ts = new Date(s.updated_at).getTime();
      return ts >= fromMs && ts <= toMs;
    });
  }, [screens, fromMs, toMs, allTime]);

  const applyPreset = (hours: number) => {
    if (hours === 0) {
      setAllTime(true);
      return;
    }
    setAllTime(false);
    const end = new Date();
    const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
    setFrom(toLocalInputValue(start));
    setTo(toLocalInputValue(end));
  };

  const rows = useMemo(() => {
    return filtered.map((s) => ({
      name: s.name,
      group: s.branch || "-",
      status: s.online ? "online" : "offline",
      ip: s.ip_address || "-",
      heartbeat: s.updated_at ? new Date(s.updated_at).toLocaleString(language) : "-",
      alert: alertedScreenIds.has(s.id) ? "!" : "",
    }));
  }, [filtered, alertedScreenIds, language]);

  const headers = [
    t("screensExportColName"),
    t("screensExportColGroup"),
    t("screensExportColStatus"),
    t("screensExportColIp"),
    t("screensExportColHeartbeat"),
    t("screensExportColAlert"),
  ];

  const filenameStem = `screen-health-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;

  const downloadCsv = () => {
    if (rows.length === 0) {
      toast.error(t("screensExportNone"));
      return;
    }
    const escape = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [headers.map(escape).join(",")];
    rows.forEach((r) =>
      lines.push([r.name, r.group, r.status, r.ip, r.heartbeat, r.alert].map(escape).join(",")),
    );
    const blob = new Blob(["\uFEFF" + lines.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filenameStem}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV ✓");
    setOpen(false);
  };

  const downloadPdf = async () => {
    if (rows.length === 0) {
      toast.error(t("screensExportNone"));
      return;
    }
    try {
      const [{ default: jsPDF }, autoTableModule] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ]);
      const autoTable = (autoTableModule as Record<string, unknown>).default ?? autoTableModule;
      const doc = new jsPDF({ orientation: "landscape" });
      doc.setFontSize(14);
      doc.text(t("screensExportTitle"), 14, 14);
      doc.setFontSize(9);
      const rangeLabel = allTime
        ? t("screensExportPresetAll")
        : `${new Date(from).toLocaleString(language)}  →  ${new Date(to).toLocaleString(language)}`;
      doc.text(`${t("screensExportRangeLabel")}: ${rangeLabel}`, 14, 21);
      doc.text(`${t("screensExportGenerated")}: ${new Date().toLocaleString(language)}`, 14, 27);
      doc.text(`${t("screensExportSummary")}: ${rows.length}`, 14, 33);
      autoTable(doc, {
        startY: 38,
        head: [headers],
        body: rows.map((r) => [r.name, r.group, r.status, r.ip, r.heartbeat, r.alert]),
        styles: { fontSize: 9 },
        headStyles: { fillColor: [30, 41, 59] },
      });
      doc.save(`${filenameStem}.pdf`);
      toast.success("PDF ✓");
      setOpen(false);
    } catch (err: unknown) {
      toast.error(`PDF failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Download className="w-4 h-4" />
          {t("screensExportHealth")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("screensExportTitle")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <Button
                key={p.key}
                variant="secondary"
                size="sm"
                onClick={() => applyPreset(p.hours)}
              >
                {t(
                  p.key === "24h"
                    ? "screensExportPreset24h"
                    : p.key === "7d"
                      ? "screensExportPreset7d"
                      : p.key === "30d"
                        ? "screensExportPreset30d"
                        : "screensExportPresetAll",
                )}
              </Button>
            ))}
          </div>

          <div className={`grid grid-cols-2 gap-3 ${allTime ? "opacity-50 pointer-events-none" : ""}`}>
            <div className="space-y-1">
              <Label className="text-xs">{t("screensExportFrom")}</Label>
              <Input
                type="datetime-local"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("screensExportTo")}</Label>
              <Input
                type="datetime-local"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>

          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            {t("screensExportSummary")}: <span className="font-medium text-foreground">{rows.length}</span>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={downloadCsv} className="gap-2">
            <FileSpreadsheet className="w-4 h-4" />
            CSV
          </Button>
          <Button onClick={downloadPdf} className="gap-2">
            <FileText className="w-4 h-4" />
            PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}