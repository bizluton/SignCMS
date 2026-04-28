import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Check, RotateCcw, Download, Languages, AlertCircle } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "sonner";
import {
  scanCandidates,
  loadOverrides,
  saveOverrides,
  clearOverrides,
  setOverride,
  removeOverride,
  type AuditCandidate,
  type I18nOverrides,
  type Locale,
} from "@/lib/i18nOverrides";
import type { TranslationKey } from "@/contexts/translations";

type Filter = "all" | "pending" | "approved";

const localeBadgeColor: Record<Locale, string> = {
  zh: "bg-rose-500/10 text-rose-600 border-rose-500/20",
  en: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  ja: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
};

const interpolate = (s: string, params: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ""));

export default function TerminologyAuditPage() {
  const { t } = useLanguage();
  const [overrides, setOverrides] = useState<I18nOverrides>(() => loadOverrides());
  const [filter, setFilter] = useState<Filter>("pending");
  // Per-row drafts so admins can tweak the suggested text before approving.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  // Re-scan whenever overrides change so the "Current" column updates.
  const candidates = useMemo(() => scanCandidates(overrides), [overrides]);

  // Approved = a key+locale that already has an override matching its current
  // text (i.e., the rewrite has been applied). We surface them under their
  // own filter so admins can audit + revert.
  const approvedRows = useMemo<AuditCandidate[]>(() => {
    const rows: AuditCandidate[] = [];
    for (const [key, perLocale] of Object.entries(overrides)) {
      if (!perLocale) continue;
      for (const [locale, value] of Object.entries(perLocale) as [Locale, string][]) {
        rows.push({
          key: key as TranslationKey,
          locale,
          current: value,
          suggested: value,
          original: "",
        });
      }
    }
    return rows.sort((a, b) =>
      a.key === b.key ? a.locale.localeCompare(b.locale) : a.key.localeCompare(b.key),
    );
  }, [overrides]);

  const visibleRows = filter === "approved" ? approvedRows : candidates;

  const totals = {
    all: candidates.length + approvedRows.length,
    pending: candidates.length,
    approved: approvedRows.length,
  };

  useEffect(() => {
    document.title = "Terminology Audit · SignCMS";
  }, []);

  const rowId = (c: { key: TranslationKey; locale: Locale }) => `${c.key}::${c.locale}`;

  const draftFor = (c: AuditCandidate) => drafts[rowId(c)] ?? c.suggested;

  const approve = (c: AuditCandidate, value?: string) => {
    const next = setOverride(overrides, c.key, c.locale, value ?? draftFor(c));
    setOverrides(next);
    saveOverrides(next);
  };

  const revert = (c: { key: TranslationKey; locale: Locale }) => {
    const next = removeOverride(overrides, c.key, c.locale);
    setOverrides(next);
    saveOverrides(next);
  };

  const approveAll = () => {
    let next = overrides;
    for (const c of candidates) {
      next = setOverride(next, c.key, c.locale, draftFor(c));
    }
    const count = candidates.length;
    setOverrides(next);
    saveOverrides(next);
    setDrafts({});
    toast.success(interpolate(t("termAuditApplied"), { count }));
  };

  const revertAll = () => {
    if (!window.confirm(t("termAuditRevertAllConfirm"))) return;
    const count = approvedRows.length;
    clearOverrides();
    setOverrides({});
    toast.success(interpolate(t("termAuditReverted"), { count }));
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(overrides, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `i18n-overrides-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Languages className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">{t("termAuditTitle")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("termAuditSubtitle")}</p>
        </div>
      </div>

      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="py-3 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{t("termAuditOverridesNotice")}</span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base">{t("termAuditTitle")}</CardTitle>
            <CardDescription className="mt-1">
              {interpolate(t("termAuditCountAll"), { count: totals.all })}
              {" · "}
              {interpolate(t("termAuditCountPending"), { count: totals.pending })}
              {" · "}
              {interpolate(t("termAuditCountApproved"), { count: totals.approved })}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={exportJson}
              disabled={approvedRows.length === 0}
            >
              <Download className="w-4 h-4 mr-1.5" />
              {t("termAuditExport")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={revertAll}
              disabled={approvedRows.length === 0}
            >
              <RotateCcw className="w-4 h-4 mr-1.5" />
              {t("termAuditRevertAll")}
            </Button>
            <Button size="sm" onClick={approveAll} disabled={candidates.length === 0}>
              <Check className="w-4 h-4 mr-1.5" />
              {t("termAuditApproveAll")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList>
              <TabsTrigger value="pending">
                {t("termAuditFilterPending")}{" "}
                <span className="ml-1.5 text-[10px] text-muted-foreground">
                  {totals.pending}
                </span>
              </TabsTrigger>
              <TabsTrigger value="approved">
                {t("termAuditFilterApproved")}{" "}
                <span className="ml-1.5 text-[10px] text-muted-foreground">
                  {totals.approved}
                </span>
              </TabsTrigger>
              <TabsTrigger value="all">
                {t("termAuditFilterAll")}{" "}
                <span className="ml-1.5 text-[10px] text-muted-foreground">
                  {totals.all}
                </span>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {visibleRows.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {t("termAuditEmpty")}
            </div>
          ) : (
            <div className="rounded-lg border divide-y">
              {/* Header */}
              <div className="hidden md:grid grid-cols-[180px_60px_1fr_1fr_140px] gap-3 px-4 py-2 text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/40">
                <div>{t("termAuditColKey")}</div>
                <div>{t("termAuditColLocale")}</div>
                <div>{t("termAuditColCurrent")}</div>
                <div>{t("termAuditColSuggested")}</div>
                <div className="text-right">{t("termAuditColAction")}</div>
              </div>

              {filter === "all"
                ? [...candidates, ...approvedRows].map((c) => (
                    <Row
                      key={`${rowId(c)}-${c === approvedRows[approvedRows.indexOf(c)] ? "a" : "p"}`}
                      c={c}
                      isApproved={approvedRows.includes(c)}
                      draft={draftFor(c)}
                      onDraftChange={(v) => setDrafts((d) => ({ ...d, [rowId(c)]: v }))}
                      onApprove={() => approve(c)}
                      onRevert={() => revert(c)}
                      labelApprove={t("termAuditApprove")}
                      labelApproved={t("termAuditApproved")}
                      labelRevert={t("termAuditRevert")}
                      editHint={t("termAuditEditHint")}
                    />
                  ))
                : visibleRows.map((c) => (
                    <Row
                      key={rowId(c)}
                      c={c}
                      isApproved={filter === "approved"}
                      draft={draftFor(c)}
                      onDraftChange={(v) => setDrafts((d) => ({ ...d, [rowId(c)]: v }))}
                      onApprove={() => approve(c)}
                      onRevert={() => revert(c)}
                      labelApprove={t("termAuditApprove")}
                      labelApproved={t("termAuditApproved")}
                      labelRevert={t("termAuditRevert")}
                      editHint={t("termAuditEditHint")}
                    />
                  ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({
  c,
  isApproved,
  draft,
  onDraftChange,
  onApprove,
  onRevert,
  labelApprove,
  labelApproved,
  labelRevert,
  editHint,
}: {
  c: AuditCandidate;
  isApproved: boolean;
  draft: string;
  onDraftChange: (v: string) => void;
  onApprove: () => void;
  onRevert: () => void;
  labelApprove: string;
  labelApproved: string;
  labelRevert: string;
  editHint: string;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[180px_60px_1fr_1fr_140px] gap-3 px-4 py-3 items-start hover:bg-muted/30">
      <div className="font-mono text-xs break-all text-foreground">{c.key}</div>
      <div>
        <Badge variant="outline" className={`text-[10px] ${localeBadgeColor[c.locale]}`}>
          {c.locale.toUpperCase()}
        </Badge>
      </div>
      <div className="text-sm text-foreground break-all whitespace-pre-wrap">{c.current}</div>
      <div className="space-y-1">
        {isApproved ? (
          <div className="text-sm text-foreground break-all whitespace-pre-wrap">{c.current}</div>
        ) : (
          <>
            <Input
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              className="text-sm h-8"
            />
            <p className="text-[10px] text-muted-foreground">{editHint}</p>
          </>
        )}
      </div>
      <div className="flex md:justify-end gap-2">
        {isApproved ? (
          <>
            <Badge variant="secondary" className="text-[10px]">
              <Check className="w-3 h-3 mr-1" />
              {labelApproved}
            </Badge>
            <Button size="sm" variant="ghost" onClick={onRevert} className="h-7 text-xs">
              <RotateCcw className="w-3 h-3 mr-1" />
              {labelRevert}
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={onApprove} className="h-8">
            <Check className="w-4 h-4 mr-1" />
            {labelApprove}
          </Button>
        )}
      </div>
    </div>
  );
}