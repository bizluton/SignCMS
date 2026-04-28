import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, ShieldCheck, ShieldAlert, RefreshCw, ExternalLink, History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Link } from "react-router-dom";

interface Finding {
  id: string;
  policy?: string;
}

interface AuditResult {
  checked_at: string;
  ok: boolean;
  findings: Finding[];
}

// Map finding ids → human description + deep link
const FINDING_META: Record<string, { title: string; description: string; link?: { to: string; label: string } }> = {
  KNOWLEDGE_TAGS_UPDATE_PERMISSIVE: {
    title: "knowledge_tags UPDATE policy is too permissive",
    description: "The UPDATE policy on public.knowledge_tags doesn't reference any privilege or ownership check (has_role / is_org_admin / is_active_cs_agent / created_by). Any authenticated user could modify tags.",
    link: { to: "/admin?tab=activity-log", label: "Review activity log" },
  },
  SCREEN_LOGS_NULL_ORG_LEAK: {
    title: "screen_logs SELECT leaks rows where org_id IS NULL",
    description: "A SELECT policy on public.screen_logs allows reading rows whose org_id is null without an admin check. Tighten the policy so only system admins can read unscoped logs.",
    link: { to: "/admin?tab=activity-log", label: "Review activity log" },
  },
  REALTIME_WILDCARD_TOPIC: {
    title: "realtime.messages SELECT contains the realtime:% wildcard",
    description: "Any authenticated user can subscribe to any postgres_changes topic, including other users' chat sessions and delegation events.",
  },
  REALTIME_SELECT_TRUE: {
    title: "realtime.messages SELECT policy is `true`",
    description: "The subscription policy is wide open. Replace with a per-user topic check.",
  },
  REALTIME_SELECT_NOT_USER_SCOPED: {
    title: "realtime.messages SELECT policy is not user-scoped",
    description: "No SELECT policy references both auth.uid() and realtime.topic(). Subscribers can listen to other users' channels.",
  },
  REALTIME_BROADCAST_TRUE: {
    title: "realtime.messages INSERT (broadcast) policy is `true`",
    description: "Any authenticated user can broadcast to any topic. Restrict broadcasts to the topic owner or privileged roles.",
  },
  GET_PLAN_LIMITS_NO_SEARCH_PATH: {
    title: "get_plan_limits() has no explicit search_path",
    description: "Function is vulnerable to search-path hijacking. Add `SET search_path TO public` to the function definition.",
  },
};

export default function SecurityAuditPage() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AuditResult | null>(null);

  const runAudit = async () => {
    setRunning(true);
    try {
      const { data, error } = await (supabase as any).rpc("audit_rls_security_regressions");
      if (error) throw error;
      if (data?.error) {
        toast.error(`Audit denied: ${data.error}`);
        return;
      }
      setResult(data as AuditResult);
      const count = (data as AuditResult).findings?.length ?? 0;
      if (count === 0) {
        toast.success("All security regression checks passed");
      } else {
        toast.warning(`Found ${count} regression${count === 1 ? "" : "s"}`);
      }
    } catch (e: any) {
      toast.error(`Audit failed: ${e.message ?? String(e)}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-5xl">
        <div className="animate-fade-in flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <ShieldCheck className="h-6 w-6 text-primary" />
              Security Regression Audit
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Re-checks the hardened RLS policies (knowledge_tags, screen_logs, realtime.messages) and the
              <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">get_plan_limits</code> search_path
              to ensure no fixed vulnerability has been reintroduced.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button asChild variant="outline" className="gap-2">
              <Link to="/security-audit/history">
                <History className="h-4 w-4" />
                History
              </Link>
            </Button>
            <Button onClick={runAudit} disabled={running} className="gap-2">
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {running ? "Running…" : result ? "Re-run audit" : "Run audit"}
            </Button>
          </div>
        </div>

        {result && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    {result.ok ? (
                      <>
                        <ShieldCheck className="h-5 w-5 text-success" />
                        All checks passed
                      </>
                    ) : (
                      <>
                        <ShieldAlert className="h-5 w-5 text-destructive" />
                        {result.findings.length} regression{result.findings.length === 1 ? "" : "s"} detected
                      </>
                    )}
                  </CardTitle>
                  <CardDescription>
                    Last run: {new Date(result.checked_at).toLocaleString()}
                  </CardDescription>
                </div>
                <Badge variant={result.ok ? "default" : "destructive"}>
                  {result.ok ? "OK" : "ACTION REQUIRED"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {result.findings.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No regressions detected. The audit is also recorded in the activity log under
                  <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">security_audit</code>.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[180px]">Check ID</TableHead>
                      <TableHead>Issue</TableHead>
                      <TableHead className="w-[180px]">Policy</TableHead>
                      <TableHead className="w-[160px] text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.findings.map((f, i) => {
                      const meta = FINDING_META[f.id];
                      return (
                        <TableRow key={`${f.id}-${i}`}>
                          <TableCell className="font-mono text-xs">{f.id}</TableCell>
                          <TableCell>
                            <div className="font-medium text-sm">{meta?.title ?? f.id}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {meta?.description ?? "Unknown finding — see activity log."}
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {f.policy ?? "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {meta?.link ? (
                              <Button asChild variant="outline" size="sm" className="gap-1">
                                <Link to={meta.link.to}>
                                  {meta.link.label}
                                  <ExternalLink className="h-3 w-3" />
                                </Link>
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}

        {!result && !running && (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Click <strong>Run audit</strong> to evaluate the live database against the hardened security baseline.
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
