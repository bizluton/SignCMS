/**
 * AuditCatalogDialog
 * ------------------
 * Read-only browser of every event code that the app can emit into
 * `activity_logs` and `screen_logs`, together with the i18n template that
 * renders it. Lets admins quickly spot codes that are missing translations
 * for one or more supported languages (zh / en / ja).
 *
 * Data source = static i18n template files (`activityLogI18n.ts`,
 * `screenLogI18n.ts`) — pure front-end, no DB hit.
 */
import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Check, X, BookOpenText } from "lucide-react";
import { useLanguage, type Language } from "@/contexts/LanguageContext";
import { getActivityCatalog, type ActivityCatalogEntry, type ActivityDetailTplEntry } from "@/lib/activityLogI18n";
import { getScreenLogCatalog, type ScreenLogCatalogEntry } from "@/lib/screenLogI18n";

const LANGS: Language[] = ["zh", "en", "ja"];

const LABELS = {
  triggerLabel: { zh: "事件型錄", en: "Event catalog", ja: "イベントカタログ" },
  title: { zh: "Audit Log 事件總覽", en: "Audit Log Event Catalog", ja: "監査ログ イベントカタログ" },
  description: {
    zh: "列出系統中所有可寫入 activity_logs 與 screen_logs 的事件代碼，並標示是否缺少 i18n 翻譯。",
    en: "All event codes the app can write into activity_logs / screen_logs, with i18n coverage.",
    ja: "activity_logs / screen_logs に書き込み可能な全イベントコードと多言語対応状況。",
  },
  searchPlaceholder: {
    zh: "搜尋事件代碼或翻譯…",
    en: "Search code or translation…",
    ja: "コードや翻訳を検索…",
  },
  tabActivity: { zh: "活動日誌 (activity_logs)", en: "Activity logs", ja: "アクティビティログ" },
  tabScreen: { zh: "螢幕日誌 (screen_logs)", en: "Screen logs", ja: "スクリーンログ" },
  sectionCategories: { zh: "分類 (category)", en: "Categories", ja: "カテゴリ" },
  sectionActions: { zh: "動作 (action / action_code)", en: "Actions", ja: "アクション" },
  sectionDetailTpl: { zh: "詳細模板 (detail templates)", en: "Detail templates", ja: "詳細テンプレート" },
  sectionPlanTier: { zh: "方案版本 (plan_tier)", en: "Plan tiers", ja: "プラン" },
  colCode: { zh: "代碼", en: "Code", ja: "コード" },
  colParams: { zh: "參數", en: "Params", ja: "パラメータ" },
  colLinks: { zh: "對應 action_code", en: "Linked actions", ja: "関連アクション" },
  i18nComplete: { zh: "三語完整", en: "All langs", ja: "全言語OK" },
  i18nMissing: { zh: "缺翻譯", en: "Missing", ja: "未翻訳" },
  noResults: { zh: "找不到符合的事件", en: "No matching events", ja: "該当イベントなし" },
  summaryTotal: { zh: "共 {total} 項，缺翻譯 {missing} 項", en: "{total} entries · {missing} missing", ja: "{total} 件 · 未翻訳 {missing} 件" },
  noDetail: { zh: "（無 detail）", en: "(no detail)", ja: "（detail なし）" },
};

const t = (key: keyof typeof LABELS, lang: Language) => LABELS[key][lang];
const fillTpl = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));

interface AuditCatalogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Per-language filled cell — shows ✓ / value or ✕ for missing slot */
function LangCell({ value }: { value: string }) {
  if (!value) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-destructive">
        <X className="w-3 h-3" />—
      </span>
    );
  }
  return <span className="text-xs text-foreground break-all">{value}</span>;
}

function CoverageBadge({ ok, lang }: { ok: boolean; lang: Language }) {
  return ok ? (
    <Badge variant="secondary" className="gap-1 text-[10px] py-0 h-5">
      <Check className="w-3 h-3" />{t("i18nComplete", lang)}
    </Badge>
  ) : (
    <Badge variant="destructive" className="gap-1 text-[10px] py-0 h-5">
      <X className="w-3 h-3" />{t("i18nMissing", lang)}
    </Badge>
  );
}

function CatalogTable<T extends { code: string; hasAllLangs: boolean }>({
  rows,
  renderExtraHeader,
  renderExtraCell,
  langValue,
  lang,
}: {
  rows: T[];
  langValue: (row: T, lang: Language) => string;
  renderExtraHeader?: () => React.ReactNode;
  renderExtraCell?: (row: T) => React.ReactNode;
  lang: Language;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">{t("noResults", lang)}</p>;
  }
  return (
    <div className="border border-border rounded-md overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/40">
          <tr className="text-left text-xs text-muted-foreground">
            <th className="px-3 py-2 font-medium w-[28%]">{t("colCode", lang)}</th>
            {LANGS.map(l => (
              <th key={l} className="px-3 py-2 font-medium w-[18%]">{l.toUpperCase()}</th>
            ))}
            {renderExtraHeader?.()}
            <th className="px-3 py-2 font-medium w-[100px]">i18n</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.code} className="border-t border-border/60 hover:bg-muted/20 align-top">
              <td className="px-3 py-2">
                <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{row.code}</code>
              </td>
              {LANGS.map(l => (
                <td key={l} className="px-3 py-2"><LangCell value={langValue(row, l)} /></td>
              ))}
              {renderExtraCell?.(row)}
              <td className="px-3 py-2"><CoverageBadge ok={row.hasAllLangs} lang={lang} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AuditCatalogDialog({ open, onOpenChange }: AuditCatalogDialogProps) {
  const { language } = useLanguage();
  const lang: Language = language;
  const [search, setSearch] = useState("");

  const activity = useMemo(() => getActivityCatalog(), []);
  const screenLogs = useMemo(() => getScreenLogCatalog(), []);

  const matches = (haystacks: string[]) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return haystacks.some(h => h.toLowerCase().includes(q));
  };

  const filterEntry = (e: ActivityCatalogEntry) =>
    matches([e.code, e.labels.zh, e.labels.en, e.labels.ja]);

  const filterTpl = (e: ActivityDetailTplEntry) =>
    matches([e.code, e.labels.zh, e.labels.en, e.labels.ja, ...e.params, ...e.linkedActionCodes]);

  const filterScreen = (e: ScreenLogCatalogEntry) =>
    matches([
      e.code, e.title.zh, e.title.en, e.title.ja,
      e.detail.zh, e.detail.en, e.detail.ja,
      ...e.params,
    ]);

  const filteredActions = activity.actions.filter(filterEntry);
  const filteredCategories = activity.categories.filter(filterEntry);
  const filteredTiers = activity.planTiers.filter(filterEntry);
  const filteredTpl = activity.detailTemplates.filter(filterTpl);
  const filteredScreens = screenLogs.filter(filterScreen);

  const summary = (total: number, missing: number) =>
    fillTpl(t("summaryTotal", lang), { total, missing });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpenText className="w-5 h-5" />
            {t("title", lang)}
          </DialogTitle>
          <DialogDescription>{t("description", lang)}</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t("searchPlaceholder", lang)}
            className="pl-9"
          />
        </div>

        <Tabs defaultValue="activity" className="flex-1 flex flex-col min-h-0">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="activity">{t("tabActivity", lang)}</TabsTrigger>
            <TabsTrigger value="screen">{t("tabScreen", lang)}</TabsTrigger>
          </TabsList>

          <TabsContent value="activity" className="flex-1 min-h-0 mt-3">
            <ScrollArea className="h-[60vh] pr-3">
              <div className="space-y-6">
                <section className="space-y-2">
                  <header className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground">{t("sectionActions", lang)}</h3>
                    <span className="text-xs text-muted-foreground">
                      {summary(filteredActions.length, filteredActions.filter(r => !r.hasAllLangs).length)}
                    </span>
                  </header>
                  <CatalogTable rows={filteredActions} lang={lang} langValue={(r, l) => r.labels[l === "zh" ? "zh" : l === "en" ? "en" : "ja"]} />
                </section>

                <section className="space-y-2">
                  <header className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground">{t("sectionDetailTpl", lang)}</h3>
                    <span className="text-xs text-muted-foreground">
                      {summary(filteredTpl.length, filteredTpl.filter(r => !r.hasAllLangs).length)}
                    </span>
                  </header>
                  <CatalogTable
                    rows={filteredTpl}
                    lang={lang}
                    langValue={(r, l) => r.labels[l === "zh" ? "zh" : l === "en" ? "en" : "ja"]}
                    renderExtraHeader={() => (
                      <>
                        <th className="px-3 py-2 font-medium text-xs text-muted-foreground">{t("colParams", lang)}</th>
                        <th className="px-3 py-2 font-medium text-xs text-muted-foreground">{t("colLinks", lang)}</th>
                      </>
                    )}
                    renderExtraCell={(row) => (
                      <>
                        <td className="px-3 py-2">
                          {row.params.length === 0 ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {row.params.map(p => (
                                <code key={p} className="text-[10px] font-mono bg-muted px-1 py-0.5 rounded">{`{${p}}`}</code>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {row.linkedActionCodes.length === 0 ? (
                            <span className="text-xs text-muted-foreground">{row.code}</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {row.linkedActionCodes.map(a => (
                                <code key={a} className="text-[10px] font-mono bg-muted px-1 py-0.5 rounded">{a}</code>
                              ))}
                            </div>
                          )}
                        </td>
                      </>
                    )}
                  />
                </section>

                <section className="space-y-2">
                  <header className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground">{t("sectionCategories", lang)}</h3>
                    <span className="text-xs text-muted-foreground">
                      {summary(filteredCategories.length, filteredCategories.filter(r => !r.hasAllLangs).length)}
                    </span>
                  </header>
                  <CatalogTable rows={filteredCategories} lang={lang} langValue={(r, l) => r.labels[l === "zh" ? "zh" : l === "en" ? "en" : "ja"]} />
                </section>

                <section className="space-y-2">
                  <header className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground">{t("sectionPlanTier", lang)}</h3>
                    <span className="text-xs text-muted-foreground">
                      {summary(filteredTiers.length, filteredTiers.filter(r => !r.hasAllLangs).length)}
                    </span>
                  </header>
                  <CatalogTable rows={filteredTiers} lang={lang} langValue={(r, l) => r.labels[l === "zh" ? "zh" : l === "en" ? "en" : "ja"]} />
                </section>
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="screen" className="flex-1 min-h-0 mt-3">
            <ScrollArea className="h-[60vh] pr-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">{t("tabScreen", lang)}</h3>
                  <span className="text-xs text-muted-foreground">
                    {summary(filteredScreens.length, filteredScreens.filter(r => !r.hasAllLangs).length)}
                  </span>
                </div>
                <div className="border border-border rounded-md overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="px-3 py-2 font-medium w-[22%]">{t("colCode", lang)}</th>
                        {LANGS.map(l => (
                          <th key={l} className="px-3 py-2 font-medium">{l.toUpperCase()}</th>
                        ))}
                        <th className="px-3 py-2 font-medium w-[16%]">{t("colParams", lang)}</th>
                        <th className="px-3 py-2 font-medium w-[100px]">i18n</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredScreens.length === 0 ? (
                        <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-muted-foreground">{t("noResults", lang)}</td></tr>
                      ) : filteredScreens.map(row => (
                        <tr key={row.code} className="border-t border-border/60 hover:bg-muted/20 align-top">
                          <td className="px-3 py-2">
                            <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{row.code}</code>
                          </td>
                          {LANGS.map(l => (
                            <td key={l} className="px-3 py-2 space-y-1">
                              <LangCell value={row.title[l]} />
                              {row.hasDetail ? (
                                <div className="text-[11px] text-muted-foreground break-all">
                                  {row.detail[l] || <span className="text-destructive">—</span>}
                                </div>
                              ) : (
                                <div className="text-[10px] text-muted-foreground italic">{t("noDetail", lang)}</div>
                              )}
                            </td>
                          ))}
                          <td className="px-3 py-2">
                            {row.params.length === 0 ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {row.params.map(p => (
                                  <code key={p} className="text-[10px] font-mono bg-muted px-1 py-0.5 rounded">{`{${p}}`}</code>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2"><CoverageBadge ok={row.hasAllLangs} lang={lang} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/** Convenience: trigger button label for opening the dialog. */
export const auditCatalogTriggerLabel = (lang: Language) => LABELS.triggerLabel[lang];
