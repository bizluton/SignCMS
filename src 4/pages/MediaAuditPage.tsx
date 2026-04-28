import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { useProfiles } from "@/contexts/ProfilesContext";
import { useUserOrgs } from "@/hooks/useUserOrgs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, RotateCcw, Trash2, Undo2, FlameKindling, History } from "lucide-react";

/**
 * Audit log page that aggregates the three lifecycle events of the media trash:
 *   - soft_delete_media               (client-side, performed by user / org admin)
 *   - media.restore_soft_deleted      (RPC, on restore from trash)
 *   - media.purge_soft_deleted_item   (RPC, on permanent delete from trash)
 *
 * All three are logged to `activity_logs`. We surface who performed the action,
 * which media item was affected, the org context, and the success/failure result.
 */

const ACTION_CODES = {
  soft: "soft_delete_media",
  restore: "media.restore_soft_deleted",
  purge: "media.purge_soft_deleted_item",
} as const;

type ActionFilter = "__all__" | "soft" | "restore" | "purge";

type AuditRow = {
  id: string;
  created_at: string;
  user_id: string;
  org_id: string | null;
  action_code: string | null;
  action: string;
  target_id: string | null;
  target_name: string | null;
  detail: string | null;
  action_params: Record<string, unknown> | null;
};

const PAGE_SIZE = 50;

export default function MediaAuditPage() {
  const { t } = useLanguage();
  const { ensureProfiles, getProfile } = useProfiles();
  const { orgs } = useUserOrgs();

  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const [actionFilter, setActionFilter] = useState<ActionFilter>("__all__");
  const [orgFilter, setOrgFilter] = useState<string>("__all__");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [search, setSearch] = useState<string>("");

  const orgNameById = useMemo(() => {
    const m = new Map<string, string>();
    orgs.forEach((o) => m.set(o.id, o.name));
    return m;
  }, [orgs]);

  const fetchRows = useCallback(
    async (limit: number = PAGE_SIZE) => {
      setLoading(true);
      setError(null);
      const codes =
        actionFilter === "__all__"
          ? [ACTION_CODES.soft, ACTION_CODES.restore, ACTION_CODES.purge]
          : [ACTION_CODES[actionFilter]];
      let q = (supabase as any)
        .from("activity_logs")
        .select(
          "id, created_at, user_id, org_id, action_code, action, target_id, target_name, detail, action_params",
        )
        .in("action_code", codes)
        .order("created_at", { ascending: false })
        .limit(limit + 1);

      if (orgFilter !== "__all__") q = q.eq("org_id", orgFilter);
      if (dateFrom) q = q.gte("created_at", new Date(dateFrom + "T00:00:00").toISOString());
      if (dateTo) q = q.lte("created_at", new Date(dateTo + "T23:59:59.999").toISOString());

      const { data, error: err } = await q;
      if (err) {
        setError(err.message);
        setRows([]);
        setHasMore(false);
      } else {
        const all = (data || []) as AuditRow[];
        const trimmed = all.slice(0, limit);
        setRows(trimmed);
        setHasMore(all.length > limit);
        const ids = Array.from(new Set(trimmed.map((r) => r.user_id).filter(Boolean)));
        if (ids.length > 0) void ensureProfiles(ids);
      }
      setLoading(false);
    },
    [actionFilter, orgFilter, dateFrom, dateTo, ensureProfiles],
  );

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  // Apply free-text search client-side over the materialized rows.
  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const userLabel = getProfile(r.user_id)?.display_name?.toLowerCase() || "";
      const itemName = (r.target_name || r.target_id || "").toLowerCase();
      return userLabel.includes(q) || itemName.includes(q);
    });
  }, [rows, search, getProfile]);

  const clearFilters = () => {
    setActionFilter("__all__");
    setOrgFilter("__all__");
    setDateFrom("");
    setDateTo("");
    setSearch("");
  };

  const renderAction = (row: AuditRow) => {
    if (row.action_code === ACTION_CODES.soft) {
      return (
        <Badge variant="outline" className="gap-1">
          <Trash2 className="w-3 h-3" />
          {t("mediaAuditActionSoftDelete")}
        </Badge>
      );
    }
    if (row.action_code === ACTION_CODES.restore) {
      return (
        <Badge variant="secondary" className="gap-1">
          <Undo2 className="w-3 h-3" />
          {t("mediaAuditActionRestore")}
        </Badge>
      );
    }
    return (
      <Badge variant="destructive" className="gap-1">
        <FlameKindling className="w-3 h-3" />
        {t("mediaAuditActionPurge")}
      </Badge>
    );
  };

  const renderStatus = (row: AuditRow) => {
    // Soft-delete is logged only on success path in the client; assume success
    // unless action_params explicitly says otherwise.
    const params = (row.action_params || {}) as Record<string, unknown>;
    const status = (params.status as string) || "success";
    const errReason = (params.error as string) || null;
    if (status === "success") {
      return (
        <span className="text-emerald-600 dark:text-emerald-400 text-xs font-medium">
          {t("mediaAuditStatusSuccess")}
        </span>
      );
    }
    return (
      <span className="text-destructive text-xs font-medium">
        {t("mediaAuditStatusFailed")}
        {errReason ? ` (${errReason})` : ""}
      </span>
    );
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-6xl">
        <div className="animate-fade-in">
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <History className="w-6 h-6 text-muted-foreground" />
            {t("mediaAuditTitle")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t("mediaAuditDesc")}</p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("mediaAuditTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Filters */}
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">
                  {t("mediaAuditFilterAction")}
                </label>
                <Select
                  value={actionFilter}
                  onValueChange={(v) => setActionFilter(v as ActionFilter)}
                >
                  <SelectTrigger className="h-9 w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">{t("mediaAuditFilterAll")}</SelectItem>
                    <SelectItem value="soft">{t("mediaAuditActionSoftDelete")}</SelectItem>
                    <SelectItem value="restore">{t("mediaAuditActionRestore")}</SelectItem>
                    <SelectItem value="purge">{t("mediaAuditActionPurge")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">
                  {t("mediaAuditFilterOrg")}
                </label>
                <Select value={orgFilter} onValueChange={setOrgFilter}>
                  <SelectTrigger className="h-9 w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">{t("mediaAuditOrgAll")}</SelectItem>
                    {orgs.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">
                  {t("mediaAuditFilterFrom")}
                </label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-9 w-[160px]"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">
                  {t("mediaAuditFilterTo")}
                </label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="h-9 w-[160px]"
                />
              </div>

              <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
                <label className="text-xs text-muted-foreground">
                  {t("mediaAuditSearch")}
                </label>
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("mediaAuditSearch")}
                  className="h-9"
                />
              </div>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 gap-1.5"
                onClick={() => void fetchRows()}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RotateCcw className="w-4 h-4" />
                )}
                {t("mediaAuditRefresh")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9"
                onClick={clearFilters}
              >
                {t("mediaAuditClearFilters")}
              </Button>
            </div>

            {/* Table */}
            {error ? (
              <div className="py-6 text-center text-sm text-destructive">
                {t("mediaAuditError").replace("{err}", error)}
              </div>
            ) : loading && rows.length === 0 ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : visibleRows.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                {t("mediaAuditEmpty")}
              </div>
            ) : (
              <>
                <div className="text-xs text-muted-foreground">
                  {t("mediaAuditTotalCount").replace("{n}", String(visibleRows.length))}
                </div>
                <div className="border rounded-md overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-xs text-muted-foreground">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium w-[170px]">
                          {t("mediaAuditColTime")}
                        </th>
                        <th className="text-left px-3 py-2 font-medium w-[140px]">
                          {t("mediaAuditColAction")}
                        </th>
                        <th className="text-left px-3 py-2 font-medium w-[160px]">
                          {t("mediaAuditColUser")}
                        </th>
                        <th className="text-left px-3 py-2 font-medium w-[160px]">
                          {t("mediaAuditColOrg")}
                        </th>
                        <th className="text-left px-3 py-2 font-medium">
                          {t("mediaAuditColItem")}
                        </th>
                        <th className="text-left px-3 py-2 font-medium w-[120px]">
                          {t("mediaAuditColStatus")}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {visibleRows.map((row) => {
                        const userLabel =
                          getProfile(row.user_id)?.display_name ||
                          t("mediaAuditUnknownUser");
                        const orgName = row.org_id
                          ? orgNameById.get(row.org_id) || row.org_id.slice(0, 8)
                          : t("mediaAuditUnknownOrg");
                        const itemName =
                          row.target_name ||
                          (row.target_id ? row.target_id.slice(0, 8) : "—");
                        return (
                          <tr key={row.id} className="hover:bg-muted/20">
                            <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                              {new Date(row.created_at).toLocaleString()}
                            </td>
                            <td className="px-3 py-2">{renderAction(row)}</td>
                            <td className="px-3 py-2 text-foreground truncate max-w-[160px]">
                              {userLabel}
                            </td>
                            <td className="px-3 py-2 text-foreground truncate max-w-[160px]">
                              {orgName}
                            </td>
                            <td className="px-3 py-2 text-foreground">
                              <div className="flex flex-col">
                                <span className="truncate max-w-[320px]">{itemName}</span>
                                {row.target_id && (
                                  <span className="text-[10px] text-muted-foreground font-mono">
                                    {row.target_id}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2">{renderStatus(row)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {hasMore && (
                  <div className="flex justify-center pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void fetchRows(rows.length + PAGE_SIZE)}
                      disabled={loading}
                    >
                      {loading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        t("mediaAuditLoadMore")
                      )}
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}