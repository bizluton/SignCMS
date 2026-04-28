import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Loader2, RefreshCw, Database, Activity, AlertTriangle, Wrench, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";

type Action = "vacuum" | "analyze" | "reindex";

interface TableStat {
  table_name: string;
  total_size_bytes: number;
  table_size_bytes: number;
  index_size_bytes: number;
  row_estimate: number;
  dead_tuples: number;
  live_tuples: number;
  last_vacuum: string | null;
  last_autovacuum: string | null;
  last_analyze: string | null;
}

interface IndexStat {
  table_name: string;
  index_name: string;
  index_size_bytes: number;
  index_scans: number;
  is_unique: boolean;
  is_primary: boolean;
}

interface SlowQuery {
  query: string;
  calls: number;
  total_exec_ms: number;
  mean_exec_ms: number;
  max_exec_ms: number;
  rows_returned: number;
}

interface Overview {
  database_size_bytes: number;
  active_connections: number;
  idle_connections: number;
  cache_hit_ratio: number;
}

const formatBytes = (n: number | null | undefined): string => {
  if (!n || n < 0) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 2 : 1)} ${u[i]}`;
};

const formatDate = (d: string | null) => {
  if (!d) return "—";
  return new Date(d).toLocaleString();
};

const labels = {
  title: { zh: "資料庫健康監控", en: "Database Health", ja: "データベース健全性" },
  desc: {
    zh: "監控資料表大小、未使用索引與慢查詢，並提供維護動作（VACUUM / ANALYZE / REINDEX）。僅系統管理員可見。",
    en: "Monitor table sizes, unused indexes and slow queries, and run maintenance actions. System admin only.",
    ja: "テーブルサイズ、未使用インデックス、低速クエリを監視し、メンテナンスを実行できます。システム管理者専用。",
  },
  refresh: { zh: "重新整理", en: "Refresh", ja: "更新" },
  dbSize: { zh: "資料庫大小", en: "DB size", ja: "DB サイズ" },
  activeConn: { zh: "活躍連線", en: "Active conn.", ja: "アクティブ接続" },
  idleConn: { zh: "閒置連線", en: "Idle conn.", ja: "アイドル接続" },
  cacheHit: { zh: "快取命中率", en: "Cache hit", ja: "キャッシュヒット率" },
  tabTables: { zh: "資料表", en: "Tables", ja: "テーブル" },
  tabIndexes: { zh: "索引使用", en: "Indexes", ja: "インデックス" },
  tabSlow: { zh: "慢查詢", en: "Slow queries", ja: "低速クエリ" },
  colTable: { zh: "資料表", en: "Table", ja: "テーブル" },
  colTotal: { zh: "總大小", en: "Total", ja: "合計" },
  colData: { zh: "資料", en: "Data", ja: "データ" },
  colIndex: { zh: "索引", en: "Index", ja: "インデックス" },
  colRows: { zh: "行數(估)", en: "Rows (est)", ja: "行数(推定)" },
  colDead: { zh: "死亡 tuples", en: "Dead tuples", ja: "デッドタプル" },
  colLastVac: { zh: "上次 VACUUM", en: "Last vacuum", ja: "最終 VACUUM" },
  colActions: { zh: "動作", en: "Actions", ja: "操作" },
  colIndexName: { zh: "索引", en: "Index", ja: "インデックス" },
  colSize: { zh: "大小", en: "Size", ja: "サイズ" },
  colScans: { zh: "使用次數", en: "Scans", ja: "使用回数" },
  colKind: { zh: "類型", en: "Kind", ja: "種類" },
  colQuery: { zh: "查詢", en: "Query", ja: "クエリ" },
  colCalls: { zh: "呼叫", en: "Calls", ja: "呼び出し" },
  colMean: { zh: "平均(ms)", en: "Mean (ms)", ja: "平均 (ms)" },
  colMax: { zh: "最大(ms)", en: "Max (ms)", ja: "最大 (ms)" },
  colTotalMs: { zh: "累計(ms)", en: "Total (ms)", ja: "合計 (ms)" },
  unused: { zh: "未使用", en: "Unused", ja: "未使用" },
  primary: { zh: "主鍵", en: "PK", ja: "主キー" },
  unique: { zh: "唯一", en: "UNIQUE", ja: "ユニーク" },
  noSlow: {
    zh: "尚無慢查詢資料（pg_stat_statements 可能未啟用或統計尚未累積）。",
    en: "No slow query data (pg_stat_statements may be unavailable or stats not yet collected).",
    ja: "低速クエリデータはありません（pg_stat_statements が無効か、統計がまだ蓄積されていません）。",
  },
  vacuum: { zh: "VACUUM ANALYZE", en: "VACUUM ANALYZE", ja: "VACUUM ANALYZE" },
  analyze: { zh: "ANALYZE", en: "ANALYZE", ja: "ANALYZE" },
  reindex: { zh: "REINDEX", en: "REINDEX", ja: "REINDEX" },
  confirmTitle: { zh: "確認執行維護動作", en: "Confirm maintenance action", ja: "メンテナンス操作の確認" },
  confirmBody: {
    zh: "此操作會在資料庫上立即執行，可能短暫鎖定資料表。確定要繼續嗎？",
    en: "This will run immediately on the live database and may briefly lock the table. Continue?",
    ja: "本番 DB で即時実行されます。テーブルが一時的にロックされる可能性があります。続行しますか？",
  },
  confirmOk: { zh: "確定執行", en: "Run", ja: "実行" },
  cancel: { zh: "取消", en: "Cancel", ja: "キャンセル" },
  doneOk: { zh: "完成", en: "Done", ja: "完了" },
  doneFail: { zh: "失敗", en: "Failed", ja: "失敗" },
  permDenied: { zh: "權限不足（僅系統管理員）", en: "Permission denied (system admin only)", ja: "権限がありません" },
};

export default function DbHealthPanel() {
  const { language } = useLanguage();
  const L = (k: keyof typeof labels) => labels[k][language];

  const [overview, setOverview] = useState<Overview | null>(null);
  const [tables, setTables] = useState<TableStat[]>([]);
  const [indexes, setIndexes] = useState<IndexStat[]>([]);
  const [slow, setSlow] = useState<SlowQuery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{ table: string; action: Action } | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [ov, tb, ix, sq] = await Promise.all([
      supabase.rpc("db_health_overview"),
      supabase.rpc("db_health_table_stats"),
      supabase.rpc("db_health_unused_indexes"),
      supabase.rpc("db_health_slow_queries"),
    ]);
    if (ov.error) {
      setError(ov.error.message.includes("permission") ? L("permDenied") : ov.error.message);
      setLoading(false);
      return;
    }
    setOverview((ov.data as unknown as Overview) ?? null);
    setTables((tb.data as TableStat[]) ?? []);
    setIndexes((ix.data as IndexStat[]) ?? []);
    setSlow((sq.data as SlowQuery[]) ?? []);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  useEffect(() => {
    void load();
  }, [load]);

  const runMaintenance = async () => {
    if (!pendingAction) return;
    setRunning(true);
    const { data, error } = await supabase.rpc("db_health_run_maintenance", {
      _table_name: pendingAction.table,
      _action: pendingAction.action,
    });
    setRunning(false);
    setPendingAction(null);
    const result = data as { success?: boolean; error?: string; duration_ms?: number } | null;
    if (error || !result?.success) {
      toast.error(`${L("doneFail")}: ${result?.error || error?.message || ""}`);
    } else {
      toast.success(`${L("doneOk")} (${Math.round(result.duration_ms || 0)} ms)`);
      void load();
    }
  };

  const unusedIndexes = useMemo(
    () => indexes.filter((i) => i.index_scans === 0 && !i.is_primary && !i.is_unique),
    [indexes],
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="h-4 w-4" />
              {L("title")}
            </CardTitle>
            <CardDescription className="mt-1">{L("desc")}</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-1.5">{L("refresh")}</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </div>
        ) : null}

        {/* Overview cards */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <OverviewCell label={L("dbSize")} value={overview ? formatBytes(overview.database_size_bytes) : "—"} icon={<Database className="h-3.5 w-3.5" />} />
          <OverviewCell label={L("activeConn")} value={overview?.active_connections ?? "—"} icon={<Activity className="h-3.5 w-3.5" />} />
          <OverviewCell label={L("idleConn")} value={overview?.idle_connections ?? "—"} icon={<Activity className="h-3.5 w-3.5" />} />
          <OverviewCell
            label={L("cacheHit")}
            value={overview ? `${overview.cache_hit_ratio}%` : "—"}
            icon={<Activity className="h-3.5 w-3.5" />}
            tone={overview && overview.cache_hit_ratio < 95 ? "warn" : "ok"}
          />
        </div>

        <Tabs defaultValue="tables">
          <TabsList>
            <TabsTrigger value="tables">{L("tabTables")} ({tables.length})</TabsTrigger>
            <TabsTrigger value="indexes">
              {L("tabIndexes")} <span className="ml-1 text-muted-foreground">({unusedIndexes.length}/{indexes.length})</span>
            </TabsTrigger>
            <TabsTrigger value="slow">{L("tabSlow")} ({slow.length})</TabsTrigger>
          </TabsList>

          {/* Tables */}
          <TabsContent value="tables" className="mt-3">
            <div className="rounded-md border max-h-[480px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead>{L("colTable")}</TableHead>
                    <TableHead className="text-right">{L("colTotal")}</TableHead>
                    <TableHead className="text-right">{L("colData")}</TableHead>
                    <TableHead className="text-right">{L("colIndex")}</TableHead>
                    <TableHead className="text-right">{L("colRows")}</TableHead>
                    <TableHead className="text-right">{L("colDead")}</TableHead>
                    <TableHead>{L("colLastVac")}</TableHead>
                    <TableHead className="text-right">{L("colActions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tables.map((t) => {
                    const lastVac = t.last_vacuum || t.last_autovacuum;
                    const deadHigh = t.dead_tuples > 1000 && t.live_tuples > 0 && t.dead_tuples / Math.max(t.live_tuples, 1) > 0.1;
                    return (
                      <TableRow key={t.table_name}>
                        <TableCell className="font-mono text-xs">{t.table_name}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatBytes(t.total_size_bytes)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{formatBytes(t.table_size_bytes)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{formatBytes(t.index_size_bytes)}</TableCell>
                        <TableCell className="text-right tabular-nums">{t.row_estimate.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {deadHigh ? (
                            <Badge variant="destructive" className="font-mono">{t.dead_tuples.toLocaleString()}</Badge>
                          ) : (
                            <span className={t.dead_tuples > 0 ? "" : "text-muted-foreground"}>{t.dead_tuples.toLocaleString()}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(lastVac)}</TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="sm" variant="ghost" className="h-7">
                                <Wrench className="h-3.5 w-3.5" />
                                <ChevronDown className="h-3 w-3 ml-0.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setPendingAction({ table: t.table_name, action: "vacuum" })}>
                                {L("vacuum")}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setPendingAction({ table: t.table_name, action: "analyze" })}>
                                {L("analyze")}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setPendingAction({ table: t.table_name, action: "reindex" })}>
                                {L("reindex")}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* Indexes */}
          <TabsContent value="indexes" className="mt-3">
            <div className="rounded-md border max-h-[480px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead>{L("colTable")}</TableHead>
                    <TableHead>{L("colIndexName")}</TableHead>
                    <TableHead className="text-right">{L("colSize")}</TableHead>
                    <TableHead className="text-right">{L("colScans")}</TableHead>
                    <TableHead>{L("colKind")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {indexes.map((i) => (
                    <TableRow key={`${i.table_name}.${i.index_name}`}>
                      <TableCell className="font-mono text-xs text-muted-foreground">{i.table_name}</TableCell>
                      <TableCell className="font-mono text-xs">{i.index_name}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatBytes(i.index_size_bytes)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {i.index_scans === 0 && !i.is_primary && !i.is_unique ? (
                          <Badge variant="destructive">{L("unused")}</Badge>
                        ) : (
                          i.index_scans.toLocaleString()
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {i.is_primary && <Badge variant="secondary" className="text-[10px]">{L("primary")}</Badge>}
                          {i.is_unique && !i.is_primary && <Badge variant="outline" className="text-[10px]">{L("unique")}</Badge>}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* Slow queries */}
          <TabsContent value="slow" className="mt-3">
            {slow.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{L("noSlow")}</div>
            ) : (
              <div className="rounded-md border max-h-[480px] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-card z-10">
                    <TableRow>
                      <TableHead className="min-w-[400px]">{L("colQuery")}</TableHead>
                      <TableHead className="text-right">{L("colCalls")}</TableHead>
                      <TableHead className="text-right">{L("colMean")}</TableHead>
                      <TableHead className="text-right">{L("colMax")}</TableHead>
                      <TableHead className="text-right">{L("colTotalMs")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {slow.map((q, idx) => (
                      <TableRow key={idx}>
                        <TableCell>
                          <pre className="font-mono text-[11px] whitespace-pre-wrap break-all max-w-[600px] text-muted-foreground">{q.query}</pre>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{q.calls.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          <Badge variant={q.mean_exec_ms > 100 ? "destructive" : "secondary"} className="font-mono">
                            {q.mean_exec_ms.toFixed(2)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{q.max_exec_ms.toFixed(2)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{q.total_exec_ms.toFixed(0)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>

      <AlertDialog open={!!pendingAction} onOpenChange={(o) => !o && setPendingAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{L("confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {L("confirmBody")}
              <div className="mt-3 rounded-md bg-muted p-3 font-mono text-xs">
                {pendingAction?.action === "vacuum" && `VACUUM ANALYZE public.${pendingAction.table}`}
                {pendingAction?.action === "analyze" && `ANALYZE public.${pendingAction.table}`}
                {pendingAction?.action === "reindex" && `REINDEX TABLE public.${pendingAction.table}`}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={running}>{L("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={runMaintenance} disabled={running}>
              {running && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
              {L("confirmOk")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function OverviewCell({
  label,
  value,
  icon,
  tone = "ok",
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  tone?: "ok" | "warn";
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${tone === "warn" ? "text-destructive" : "text-foreground"}`}>{value}</div>
    </div>
  );
}
