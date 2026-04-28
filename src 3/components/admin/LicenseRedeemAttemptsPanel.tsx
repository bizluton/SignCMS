import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProfiles } from "@/contexts/ProfilesContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, RefreshCw, ShieldAlert, Search, Unlock } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useIsSystemAdmin } from "@/hooks/useIsSystemAdmin";

interface Attempt {
  id: string;
  user_id: string;
  org_id: string | null;
  code_attempted: string;
  success: boolean;
  error_code: string | null;
  attempt_at: string;
}

interface OrgLite { id: string; name: string; }

const ERROR_LABEL: Record<string, string> = {
  rate_limited: "已被速率限制",
  permission_denied: "權限不足",
  code_not_found: "找不到代碼",
  code_already_redeemed: "已被兌換",
  code_not_for_this_org: "組織不符",
  org_not_found: "找不到組織",
  unauthenticated: "未登入",
};

export default function LicenseRedeemAttemptsPanel() {
  const { ensureProfiles, getDisplayName, profilesVersion } = useProfiles();
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [orgs, setOrgs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "success" | "failed" | "rate_limited">("all");
  const [search, setSearch] = useState("");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null));
  }, []);

  const { isSystemAdmin } = useIsSystemAdmin();

  const handleUnlock = async (userId: string, userName: string) => {
    if (!isSystemAdmin) return;
    setUnlocking(userId);
    const { data, error } = await supabase.rpc("admin_unlock_redeem_attempts", { _user_id: userId });
    setUnlocking(null);
    const result = data as { success?: boolean; error?: string; cleared?: number } | null;
    if (error || !result?.success) {
      toast({ title: "解鎖失敗", description: error?.message || result?.error || "unknown", variant: "destructive" });
      return;
    }
    toast({ title: "已解鎖", description: `已清除 ${userName} 的 ${result.cleared ?? 0} 筆失敗紀錄，並寫入稽核` });
    fetchData();
  };

  const fetchData = async () => {
    setLoading(true);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from("license_redeem_attempts")
      .select("*")
      .gte("attempt_at", since)
      .order("attempt_at", { ascending: false })
      .limit(500);
    const list = (data as Attempt[]) || [];
    setAttempts(list);

    const userIds = Array.from(new Set(list.map(a => a.user_id)));
    const orgIds = Array.from(new Set(list.map(a => a.org_id).filter(Boolean) as string[]));

    await ensureProfiles(userIds);

    if (orgIds.length) {
      const { data: orgRows } = await supabase
        .from("organizations").select("id, name").in("id", orgIds);
      const omap: Record<string, string> = {};
      (orgRows as OrgLite[] | null)?.forEach(o => { omap[o.id] = o.name; });
      setOrgs(omap);
    } else {
      setOrgs({});
    }

    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  // Aggregate suspicious users: ≥3 failures in last 15 min
  const suspicious = useMemo(() => {
    const cutoff = Date.now() - 15 * 60 * 1000;
    const counts: Record<string, number> = {};
    attempts.forEach(a => {
      if (!a.success && new Date(a.attempt_at).getTime() > cutoff) {
        counts[a.user_id] = (counts[a.user_id] || 0) + 1;
      }
    });
    return Object.entries(counts).filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]);
  }, [attempts]);

  const filtered = useMemo(() => {
    return attempts.filter(a => {
      if (filter === "success" && !a.success) return false;
      if (filter === "failed" && a.success) return false;
      if (filter === "rate_limited" && a.error_code !== "rate_limited") return false;
      if (search) {
        const s = search.toLowerCase();
        const name = getDisplayName(a.user_id, a.user_id.slice(0, 8)).toLowerCase();
        const code = a.code_attempted.toLowerCase();
        if (!name.includes(s) && !code.includes(s)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempts, filter, search, profilesVersion]);

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6">
      {suspicious.length > 0 && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-destructive">
              <ShieldAlert className="w-5 h-5" />
              可疑帳號（最近 15 分鐘 3 次以上失敗）
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {suspicious.map(([uid, count]) => {
                const name = getDisplayName(uid, uid.slice(0, 8));
                return (
                  <div key={uid} className="flex items-center gap-1">
                    <Badge variant="destructive" className="text-xs">
                      {name} · {count} 次失敗
                    </Badge>
                    {isSystemAdmin && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-xs"
                        disabled={unlocking === uid}
                        onClick={() => handleUnlock(uid, name)}
                      >
                        {unlocking === uid ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Unlock className="w-3 h-3 mr-1" />解鎖</>}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-lg">兌換嘗試紀錄</CardTitle>
            <CardDescription>最近 7 天，最多 500 筆</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={fetchData}>
            <RefreshCw className="w-4 h-4 mr-1" />
            重新整理
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜尋使用者名稱或代碼"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={filter} onValueChange={(v: "all" | "success" | "failed" | "rate_limited") => setFilter(v)}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="success">僅成功</SelectItem>
                <SelectItem value="failed">僅失敗</SelectItem>
                <SelectItem value="rate_limited">僅速率限制</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>時間</TableHead>
                  <TableHead>使用者</TableHead>
                  <TableHead>組織</TableHead>
                  <TableHead>嘗試代碼</TableHead>
                  <TableHead>結果</TableHead>
                  <TableHead>錯誤</TableHead>
                  {isSystemAdmin && <TableHead className="w-[80px]">操作</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={isSystemAdmin ? 7 : 6} className="text-center text-muted-foreground py-8">無紀錄</TableCell></TableRow>
                ) : filtered.map(a => {
                  const name = getDisplayName(a.user_id, a.user_id.slice(0, 8));
                  return (
                  <TableRow key={a.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(a.attempt_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm">{name}</TableCell>
                    <TableCell className="text-sm">{a.org_id ? (orgs[a.org_id] || a.org_id.slice(0, 8)) : "-"}</TableCell>
                    <TableCell className="font-mono text-xs">{a.code_attempted || "-"}</TableCell>
                    <TableCell>
                      {a.success ? (
                        <Badge variant="default">成功</Badge>
                      ) : a.error_code === "rate_limited" ? (
                        <Badge variant="destructive">已封鎖</Badge>
                      ) : (
                        <Badge variant="outline">失敗</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {a.error_code ? (ERROR_LABEL[a.error_code] || a.error_code) : "-"}
                    </TableCell>
                    {isSystemAdmin && (
                      <TableCell>
                        {!a.success && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            disabled={unlocking === a.user_id}
                            onClick={() => handleUnlock(a.user_id, name)}
                            title="清除此使用者最近 15 分鐘的失敗紀錄"
                          >
                            {unlocking === a.user_id ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Unlock className="w-3 h-3 mr-1" />解鎖</>}
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
