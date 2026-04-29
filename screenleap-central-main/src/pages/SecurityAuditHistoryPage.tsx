import { useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, ShieldCheck, ShieldAlert, Download, RefreshCw, ExternalLink, History, ChevronDown, ChevronRight, Pin, PinOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Link } from "react-router-dom";

interface Finding { id: string; policy?: string }
interface AuditRow {
  id: string;
  run_at: string;
  ok: boolean;
  findings_count: number;
  findings: Finding[];
  triggered_by: string;
  pinned: boolean;
}

const FINDING_META: Record<string, { title: string; link?: { to: string; label: string } }> = {
  KNOWLEDGE_TAGS_UPDATE_PERMISSIVE: { title: "knowledge_tags UPDATE policy too permissive", link: { to: "/admin?tab=activity-log", label: "Activity log" } },
  SCREEN_LOGS_NULL_ORG_LEAK: { title: "screen_logs leaks rows where org_id IS NULL", link: { to: "/admin?tab=activity-log", label: "Activity log" } },
  REALTIME_WILDCARD_TOPIC: { title: "realtime.messages contains realtime:% wildcard" },
  REALTIME_SELECT_TRUE: { title: "realtime.messages SELECT policy is `true`" },
  REALTIME_SELECT_NOT_USER_SCOPED: { title: "realtime.messages SELECT not user-scoped" },
  REALTIME_BROADCAST_TRUE: { title: "realtime.messages broadcast policy is `true`" },
  GET_PLAN_LIMITS_NO_SEARCH_PATH: { title: "get_plan_limits() missing search_path" },
};

function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export default function SecurityAuditHistoryPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [from, setFrom] = useState(todayISO(-30));
  const [to, setTo] = useState(todayISO(0));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    try {
      const fromTs = new Date(from + "T00:00:00").toISOString();
      const toTs = new Date(to + "T23:59:59").toISOString();
      const { data, error } = await (supabase as any)
        .from("security_audit_findings")
        .select("id, run_at, ok, findings_count, findings, triggered_by, pinned")
        .gte("run_at", fromTs)
        .lte("run_at", toTs)
        .order("run_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      setRows((data ?? []) as AuditRow[]);
    } catch (e: any) {
      toast.error(`Failed to load: ${e.message ?? String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line

  const stats = useMemo(() => {
    const total = rows.length;
    const failing = rows.filter((r) => !r.ok).length;
    const totalFindings = rows.reduce((s, r) => s + (r.findings_count || 0), 0);
    return { total, failing, totalFindings };
  }, [rows]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const togglePin = async (row: AuditRow, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !row.pinned;
    // optimistic
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, pinned: next } : r)));
    const { error } = await (supabase as any)
      .from("security_audit_findings")
      .update({ pinned: next })
      .eq("id", row.id);
    if (error) {
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, pinned: !next } : r)));
      toast.error(`Failed to ${next ? "pin" : "unpin"}: ${error.message}`);
    } else {
      toast.success(next ? "Pinned (kept beyond 90 days)" : "Unpinned");
    }
  };

  const exportCsv = () => {
    if (rows.length === 0) {
      toast.info("No rows to export");
      return;
    }
    const header = ["run_at", "ok", "findings_count", "triggered_by", "finding_id", "policy"];
    const lines: string[] = [header.join(",")];
    for (const r of rows) {
      if (!r.findings || r.findings.length === 0) {
        lines.push([r.run_at, r.ok, r.findings_count, r.triggered_by, "", ""].map(csvCell).join(","));
      } else {
        for (const f of r.findings) {
          lines.push([r.run_at, r.ok, r.findings_count, r.triggered_by, f.id, f.policy ?? ""].map(csvCell).join(","));
        }
      }
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `security-audit-${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} run(s)`);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-6xl">
        <div className="animate-fade-in flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <History className="h-6 w-6 text-primary" />
              Security Audit Findings
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              History of scheduled and on-demand RLS regression audits.{" "}
              <Link to="/security-audit" className="underline hover:text-primary">Run a new audit →</Link>
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Filter</CardTitle>
            <CardDescription>Showing {stats.total} run(s) · {stats.failing} with regressions · {stats.totalFindings} total findings</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="from">From</Label>
                <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="to">To</Label>
                <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-44" />
              </div>
              <Button onClick={load} disabled={loading} className="gap-2">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Apply
              </Button>
              <Button onClick={exportCsv} variant="outline" className="gap-2" disabled={rows.length === 0}>
                <Download className="h-4 w-4" />
                Export CSV
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Audit Runs</CardTitle>
            <CardDescription>
              Unpinned runs are auto-deleted after 90 days. Click <Pin className="h-3 w-3 inline" /> to keep a run forever.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Loading…
              </div>
            ) : rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No audit runs in the selected range.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead className="w-10" />
                    <TableHead className="w-[200px]">Run At</TableHead>
                    <TableHead className="w-[120px]">Status</TableHead>
                    <TableHead className="w-[100px]">Findings</TableHead>
                    <TableHead className="w-[140px]">Trigger</TableHead>
                    <TableHead>Summary</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const isOpen = expanded.has(r.id);
                    return (
                      <>
                        <TableRow key={r.id} className="cursor-pointer" onClick={() => toggle(r.id)}>
                          <TableCell>
                            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={(e) => togglePin(r, e)}
                              title={r.pinned ? "Unpin (allow pruning)" : "Pin (keep forever)"}
                            >
                              {r.pinned ? (
                                <Pin className="h-4 w-4 text-primary fill-primary" />
                              ) : (
                                <PinOff className="h-4 w-4 text-muted-foreground" />
                              )}
                            </Button>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{new Date(r.run_at).toLocaleString()}</TableCell>
                          <TableCell>
                            {r.ok ? (
                              <Badge variant="default" className="gap-1"><ShieldCheck className="h-3 w-3" />OK</Badge>
                            ) : (
                              <Badge variant="destructive" className="gap-1"><ShieldAlert className="h-3 w-3" />FAIL</Badge>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-sm">{r.findings_count}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{r.triggered_by}</TableCell>
                          <TableCell className="text-xs text-muted-foreground truncate max-w-[280px]">
                            {r.findings?.slice(0, 2).map((f) => f.id).join(", ") || "—"}
                            {r.findings && r.findings.length > 2 ? `, +${r.findings.length - 2}` : ""}
                          </TableCell>
                        </TableRow>
                        {isOpen && r.findings && r.findings.length > 0 && (
                          <TableRow key={r.id + "-detail"}>
                            <TableCell colSpan={7} className="bg-muted/30">
                              <div className="space-y-2 py-2">
                                {r.findings.map((f, i) => {
                                  const meta = FINDING_META[f.id];
                                  return (
                                    <div key={i} className="flex items-start justify-between gap-3 rounded border bg-background px-3 py-2">
                                      <div className="min-w-0">
                                        <div className="font-mono text-xs text-muted-foreground">{f.id}</div>
                                        <div className="text-sm">{meta?.title ?? f.id}</div>
                                        {f.policy && <div className="font-mono text-xs text-muted-foreground mt-0.5">policy: {f.policy}</div>}
                                      </div>
                                      {meta?.link && (
                                        <Button asChild variant="outline" size="sm" className="gap-1 shrink-0">
                                          <Link to={meta.link.to}>
                                            {meta.link.label}
                                            <ExternalLink className="h-3 w-3" />
                                          </Link>
                                        </Button>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
