import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole } from "@/hooks/useUserRole";
import { useIsSystemAdmin } from "@/hooks/useIsSystemAdmin";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ShieldCheck, Download, Search, ShieldOff } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface DelegationRow {
  id: string;
  grantor_id: string;
  grantee_id: string;
  grantee_scope: string;
  reason: string | null;
  expires_at: string;
  status: string;
  created_at: string;
  revoked_at: string | null;
  grantor_name?: string;
  grantee_name?: string;
}

type StatusFilter = "all" | "active" | "revoked" | "ended" | "expired";
type ScopeFilter = "mine" | "granted" | "received" | "all";

export default function DelegationLogPanel({ highlightId }: { highlightId?: string | null } = {}) {
  const { user } = useAuth();
  const { isAdmin, isOrgAdmin } = useUserRole();
  const { t, language } = useLanguage();
  const [rows, setRows] = useState<DelegationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [keyword, setKeyword] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("mine");

  const refresh = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("delegation_grants")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    const list = (data || []) as DelegationRow[];
    const ids = Array.from(new Set(list.flatMap((r) => [r.grantor_id, r.grantee_id])));
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", ids);
      const map = new Map((profs || []).map((p) => [p.user_id, p.display_name]));
      list.forEach((r) => {
        r.grantor_name = map.get(r.grantor_id) || undefined;
        r.grantee_name = map.get(r.grantee_id) || undefined;
      });
    }
    setRows(list);
  };

  const handleEndAccess = async (grantId: string) => {
    setRevokingId(grantId);
    const { data, error } = await supabase.functions.invoke("revoke-delegation-grant", {
      body: { grant_id: grantId },
    });
    setRevokingId(null);
    const dataErr = (data as Record<string, unknown> | null)?.error;
    if (error || dataErr) {
      toast.error(t("delegationLogEndAccessFailed") + (error?.message || String(dataErr ?? "")));
      return;
    }
    toast.success(t("delegationLogEndAccessSuccess"));
    refresh();
  };

  const { isSystemAdmin } = useIsSystemAdmin();

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      await refresh();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const locale = language === "zh" ? "zh-TW" : language === "ja" ? "ja-JP" : "en-US";
  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(locale, { hour12: false }) : "—";

  const effectiveStatus = (r: DelegationRow): StatusFilter => {
    if (r.status === "active" && new Date(r.expires_at).getTime() <= Date.now()) {
      return "expired";
    }
    return (r.status as StatusFilter) || "active";
  };

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const fromMs = dateFrom ? new Date(dateFrom + "T00:00:00").getTime() : null;
    const toMs = dateTo ? new Date(dateTo + "T23:59:59").getTime() : null;
    const uid = user?.id;
    return rows.filter((r) => {
      if (uid) {
        if (scopeFilter === "granted" && r.grantor_id !== uid) return false;
        if (scopeFilter === "received" && r.grantee_id !== uid) return false;
        if (scopeFilter === "mine" && r.grantor_id !== uid && r.grantee_id !== uid) return false;
      }
      if (statusFilter !== "all" && effectiveStatus(r) !== statusFilter) return false;
      const created = new Date(r.created_at).getTime();
      if (fromMs !== null && created < fromMs) return false;
      if (toMs !== null && created > toMs) return false;
      if (kw) {
        const hay = `${r.grantor_name || ""} ${r.grantee_name || ""} ${r.grantor_id} ${r.grantee_id}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [rows, statusFilter, keyword, dateFrom, dateTo, scopeFilter, user?.id]);

  const statusBadge = (s: StatusFilter) => {
    const map: Record<StatusFilter, { label: string; cls: string }> = {
      all: { label: "", cls: "" },
      active: { label: t("delegationLogStatusActive"), cls: "bg-success/10 text-success border-success/30" },
      revoked: { label: t("delegationLogStatusRevoked"), cls: "bg-destructive/10 text-destructive border-destructive/30" },
      ended: { label: t("delegationLogStatusEnded"), cls: "bg-muted text-muted-foreground border-border" },
      expired: { label: t("delegationLogStatusExpired"), cls: "bg-warning/10 text-warning border-warning/30" },
    };
    const m = map[s];
    return <Badge variant="outline" className={m.cls}>{m.label}</Badge>;
  };

  const exportCsv = () => {
    const headers = [
      t("delegationLogColGrantor"),
      t("delegationLogColGrantee"),
      t("delegationLogColScope"),
      t("delegationLogColCreated"),
      t("delegationLogColExpires"),
      t("delegationLogColEndedAt"),
      t("delegationLogColStatus"),
      t("delegationLogColReason"),
    ];
    const escape = (v: string) => {
      const s = (v ?? "").toString().replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };
    const lines = [headers.join(",")];
    filtered.forEach((r) => {
      const scope =
        r.grantee_scope === "cs_agent"
          ? t("delegationScopeCsAgent")
          : t("delegationScopeOrgAdmin");
      const status = (() => {
        const s = effectiveStatus(r);
        return s === "active"
          ? t("delegationLogStatusActive")
          : s === "revoked"
          ? t("delegationLogStatusRevoked")
          : s === "ended"
          ? t("delegationLogStatusEnded")
          : t("delegationLogStatusExpired");
      })();
      lines.push(
        [
          r.grantor_name || r.grantor_id,
          r.grantee_name || r.grantee_id,
          scope,
          fmt(r.created_at),
          fmt(r.expires_at),
          fmt(r.revoked_at),
          status,
          r.reason || "",
        ]
          .map(escape)
          .join(",")
      );
    });
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `delegation-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!isSystemAdmin && !isAdmin && !isOrgAdmin) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-primary" />
          {t("delegationLogTitle")}
        </CardTitle>
        <CardDescription>{t("delegationLogSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={scopeFilter} onValueChange={(v) => setScopeFilter(v as ScopeFilter)} className="mb-4">
          <TabsList className="h-9">
            <TabsTrigger value="mine" className="text-xs">{t("delegationLogScopeMine")}</TabsTrigger>
            <TabsTrigger value="granted" className="text-xs">{t("delegationLogScopeGranted")}</TabsTrigger>
            <TabsTrigger value="received" className="text-xs">{t("delegationLogScopeReceived")}</TabsTrigger>
            <TabsTrigger value="all" className="text-xs">{t("delegationLogScopeAll")}</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t("delegationLogFilterStatus")}</span>
            <Select value={statusFilter} onValueChange={(v: StatusFilter) => setStatusFilter(v)}>
              <SelectTrigger className="w-[140px] h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("delegationLogStatusAll")}</SelectItem>
                <SelectItem value="active">{t("delegationLogStatusActive")}</SelectItem>
                <SelectItem value="revoked">{t("delegationLogStatusRevoked")}</SelectItem>
                <SelectItem value="ended">{t("delegationLogStatusEnded")}</SelectItem>
                <SelectItem value="expired">{t("delegationLogStatusExpired")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t("delegationLogFilterFrom")}</span>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-9 w-[150px] text-xs"
            />
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t("delegationLogFilterTo")}</span>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-9 w-[150px] text-xs"
            />
          </div>

          <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <span className="text-xs text-muted-foreground">{t("delegationLogFilterKeyword")}</span>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder={t("delegationLogFilterKeywordPlaceholder")}
                className="h-9 pl-7 text-xs"
              />
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="h-9"
          >
            <Download className="w-4 h-4 mr-1.5" />
            {t("delegationLogExportCsv")}
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">{t("delegationLogEmpty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("delegationLogColGrantor")}</TableHead>
                  <TableHead>{t("delegationLogColGrantee")}</TableHead>
                  <TableHead>{t("delegationLogColScope")}</TableHead>
                  <TableHead>{t("delegationLogColCreated")}</TableHead>
                  <TableHead>{t("delegationLogColExpires")}</TableHead>
                  <TableHead>{t("delegationLogColEndedAt")}</TableHead>
                  <TableHead>{t("delegationLogColStatus")}</TableHead>
                  <TableHead>{t("delegationLogColReason")}</TableHead>
                  <TableHead className="text-right">{t("delegationLogColAction")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => {
                  const isHl = highlightId === r.id;
                  const eff = effectiveStatus(r);
                  const isGrantee = r.grantee_id === user?.id;
                  const isGrantor = r.grantor_id === user?.id;
                  const canEnd = eff === "active" && (isGrantee || isGrantor);
                  const endLabel = isGrantee ? t("delegationLogEndAccess") : t("delegationLogRevokeAccess");
                  const endConfirm = isGrantee ? t("delegationLogEndAccessConfirm") : t("delegationLogRevokeAccessConfirm");
                  const isRevoking = revokingId === r.id;
                  return (
                  <TableRow
                    key={r.id}
                    ref={isHl ? (el) => { if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); } : undefined}
                    className={isHl ? "bg-primary/10 ring-2 ring-primary/40 transition-colors" : ""}
                  >
                    <TableCell className="text-sm">
                      {r.grantor_name || r.grantor_id.slice(0, 8)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.grantee_name || r.grantee_id.slice(0, 8)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.grantee_scope === "cs_agent"
                        ? t("delegationScopeCsAgent")
                        : t("delegationScopeOrgAdmin")}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{fmt(r.created_at)}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{fmt(r.expires_at)}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{fmt(r.revoked_at)}</TableCell>
                    <TableCell>{statusBadge(eff)}</TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate" title={r.reason || ""}>
                      {r.reason || "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {canEnd ? (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                              disabled={isRevoking}
                            >
                              {isRevoking ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <ShieldOff className="w-3 h-3 mr-1" />
                              )}
                              {endLabel}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{endLabel}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {endConfirm}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleEndAccess(r.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                {endLabel}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
