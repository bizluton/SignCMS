import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useIsSystemAdmin } from "@/hooks/useIsSystemAdmin";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2, Building2, Search, X, UserCog } from "lucide-react";

interface UserSearchResult {
  user_id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface Org { id: string; name: string }

interface AgentRow {
  user_id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  org_ids: string[];
  org_names: string[];
}

export default function AgentManagement() {
  const { user } = useAuth();
  const { isSystemAdmin } = useIsSystemAdmin();
  const { language } = useLanguage();

  const labels = {
    zh: {
      title: "代理商管理",
      subtitle: "指派使用者為代理商，並設定其可檢視的多個組織（read-only 跨組織）",
      addAgent: "新增代理商",
      pickUser: "選擇使用者",
      searchPlaceholder: "輸入 Email 或姓名…",
      noResults: "找不到使用者",
      noAgents: "尚無代理商",
      assignedOrgs: "授權組織",
      addOrg: "加入組織",
      pickOrg: "選擇組織",
      removeAgent: "撤銷代理商身份",
      removeConfirm: "撤銷代理商身份",
      removeConfirmDesc: "將同時刪除此使用者的所有組織授權。確定要繼續嗎？",
      cancel: "取消",
      confirm: "確認",
      removeOrgConfirm: "移除組織授權",
      assigned: "已授權",
      error: "錯誤",
      noPermission: "僅系統管理員可使用此功能",
    },
    en: {
      title: "Agent Management",
      subtitle: "Assign users as agents with view-only access across multiple orgs",
      addAgent: "Add Agent",
      pickUser: "Pick User",
      searchPlaceholder: "Email or name…",
      noResults: "No users found",
      noAgents: "No agents yet",
      assignedOrgs: "Assigned Orgs",
      addOrg: "Add Org",
      pickOrg: "Select Org",
      removeAgent: "Revoke Agent",
      removeConfirm: "Revoke agent role",
      removeConfirmDesc: "All org assignments for this user will be deleted. Continue?",
      cancel: "Cancel",
      confirm: "Confirm",
      removeOrgConfirm: "Remove org access",
      assigned: "Assigned",
      error: "Error",
      noPermission: "Only system administrators can use this feature",
    },
    ja: {
      title: "代理店管理",
      subtitle: "ユーザーを代理店として割り当て、複数組織の閲覧専用アクセスを設定",
      addAgent: "代理店追加",
      pickUser: "ユーザー選択",
      searchPlaceholder: "メールまたは名前…",
      noResults: "ユーザーが見つかりません",
      noAgents: "代理店がまだいません",
      assignedOrgs: "割当組織",
      addOrg: "組織を追加",
      pickOrg: "組織を選択",
      removeAgent: "代理店権限取消",
      removeConfirm: "代理店権限を取り消す",
      removeConfirmDesc: "このユーザーのすべての組織割当も削除されます。続行しますか？",
      cancel: "キャンセル",
      confirm: "確認",
      removeOrgConfirm: "組織アクセスを削除",
      assigned: "割当済",
      error: "エラー",
      noPermission: "システム管理者のみ利用可能",
    },
  } as const;
  const t = labels[language] || labels.en;

  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<AgentRow | null>(null);

  // user-picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<UserSearchResult | null>(null);
  const debounceRef = useRef<number | null>(null);

  // org-picker state (per-agent dialog)
  const [orgPickerFor, setOrgPickerFor] = useState<string | null>(null);
  const [orgPickerSelectedIds, setOrgPickerSelectedIds] = useState<Set<string>>(new Set());

  const existingAgentIds = useMemo(() => new Set(agents.map((a) => a.user_id)), [agents]);

  const load = async () => {
    setLoading(true);
    try {
      // 1. All users with agent role
      const { data: agentRoles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "agent");
      const agentUserIds = (agentRoles || []).map((r) => r.user_id as string);

      // 2. Profiles + emails (via auth.admin would need service role; use profiles table)
      const [{ data: profiles }, { data: assignments }, { data: orgRows }] = await Promise.all([
        agentUserIds.length > 0
          ? supabase.from("profiles").select("user_id, display_name, avatar_url").in("user_id", agentUserIds)
          : Promise.resolve({ data: [] }),
        agentUserIds.length > 0
          ? supabase.from("agent_org_assignments").select("agent_user_id, org_id").in("agent_user_id", agentUserIds)
          : Promise.resolve({ data: [] }),
        supabase.from("organizations").select("id, name").order("name"),
      ]);

      const profileMap = new Map(((profiles as Array<{ user_id: string; display_name: string | null; avatar_url: string | null }>) || []).map((p) => [p.user_id, p]));
      const orgList = (orgRows as Org[]) || [];
      const orgMap = new Map(orgList.map((o) => [o.id, o.name]));
      setOrgs(orgList);

      const assignmentsByAgent = new Map<string, string[]>();
      ((assignments as Array<{ agent_user_id: string; org_id: string }>) || []).forEach((a) => {
        const arr = assignmentsByAgent.get(a.agent_user_id) || [];
        arr.push(a.org_id);
        assignmentsByAgent.set(a.agent_user_id, arr);
      });

      // Look up emails via the search-users RPC (one call per agent is wasteful; skip and
      // show user_id when email isn't available from profiles)
      const emailMap = new Map<string, string>();
      try {
        for (const uid of agentUserIds) {
          const { data: u } = await (supabase as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }> }).rpc("get_user_email_by_id", { _user_id: uid });
          if (typeof u === "string") emailMap.set(uid, u);
        }
      } catch { /* RPC may not exist; ignore */ }

      const rows: AgentRow[] = agentUserIds.map((uid) => {
        const p = profileMap.get(uid);
        const orgIds = assignmentsByAgent.get(uid) || [];
        return {
          user_id: uid,
          email: emailMap.get(uid) || "",
          display_name: p?.display_name ?? null,
          avatar_url: p?.avatar_url ?? null,
          org_ids: orgIds,
          org_names: orgIds.map((id) => orgMap.get(id) || id),
        };
      });
      setAgents(rows);
    } catch (err) {
      toast({ title: t.error, description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (isSystemAdmin) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [isSystemAdmin]);

  // Debounced user search
  useEffect(() => {
    if (!pickerOpen) return;
    const term = searchTerm.trim();
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (term.length < 2) { setSearchResults([]); setSearching(false); return; }
    setSearching(true);
    debounceRef.current = window.setTimeout(async () => {
      try {
        const { data, error } = await (supabase as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> }).rpc("search_users_for_admin", { _query: term });
        if (error) throw new Error(error.message);
        setSearchResults((data as UserSearchResult[]) || []);
      } catch (e) {
        toast({ title: t.error, description: e instanceof Error ? e.message : String(e), variant: "destructive" });
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
  }, [searchTerm, pickerOpen, t.error]);

  const promoteToAgent = async () => {
    if (!selected) return;
    setSubmitting(true);
    try {
      // Insert agent role (system admin policy allows this)
      const { error } = await supabase.from("user_roles").insert({ user_id: selected.user_id, role: "agent" });
      if (error && !error.message.includes("duplicate")) throw new Error(error.message);
      setSelected(null);
      setPickerOpen(false);
      setSearchTerm("");
      await load();
    } catch (e) {
      toast({ title: t.error, description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const revokeAgent = async () => {
    if (!revokeTarget || !user) return;
    setSubmitting(true);
    try {
      // Delete all org assignments first, then the role row
      await supabase.from("agent_org_assignments").delete().eq("agent_user_id", revokeTarget.user_id);
      const { error } = await supabase.from("user_roles").delete().eq("user_id", revokeTarget.user_id).eq("role", "agent");
      if (error) throw new Error(error.message);
      setRevokeTarget(null);
      await load();
    } catch (e) {
      toast({ title: t.error, description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const openOrgPicker = (agentId: string, currentOrgIds: string[]) => {
    setOrgPickerFor(agentId);
    setOrgPickerSelectedIds(new Set(currentOrgIds));
  };

  const saveOrgAssignments = async () => {
    if (!orgPickerFor || !user) return;
    setSubmitting(true);
    try {
      const agent = agents.find((a) => a.user_id === orgPickerFor);
      if (!agent) return;
      const current = new Set(agent.org_ids);
      const next = orgPickerSelectedIds;
      const toAdd = [...next].filter((id) => !current.has(id));
      const toRemove = [...current].filter((id) => !next.has(id));

      if (toAdd.length > 0) {
        const rows = toAdd.map((org_id) => ({ agent_user_id: orgPickerFor, org_id, assigned_by: user.id }));
        const { error } = await supabase.from("agent_org_assignments").insert(rows);
        if (error) throw new Error(error.message);
      }
      if (toRemove.length > 0) {
        const { error } = await supabase.from("agent_org_assignments").delete().eq("agent_user_id", orgPickerFor).in("org_id", toRemove);
        if (error) throw new Error(error.message);
      }
      setOrgPickerFor(null);
      await load();
    } catch (e) {
      toast({ title: t.error, description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (!isSystemAdmin) {
    return <Card><CardContent className="py-12 text-center text-muted-foreground">{t.noPermission}</CardContent></Card>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2"><UserCog className="w-5 h-5" />{t.title}</CardTitle>
        <CardDescription>{t.subtitle}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add agent picker */}
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" className="gap-1.5"><Plus className="w-4 h-4" />{t.addAgent}</Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="start">
            <div className="p-2 border-b border-border">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder={t.searchPlaceholder}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="h-8 pl-8 text-xs"
                  autoFocus
                />
              </div>
            </div>
            <ScrollArea className="max-h-64">
              <div className="p-1">
                {searching && <div className="p-3 text-center"><Loader2 className="w-4 h-4 animate-spin mx-auto" /></div>}
                {!searching && searchTerm.trim().length >= 2 && searchResults.length === 0 && (
                  <div className="p-3 text-center text-xs text-muted-foreground">{t.noResults}</div>
                )}
                {!searching && searchResults.map((u) => {
                  const isAlready = existingAgentIds.has(u.user_id);
                  return (
                    <button
                      key={u.user_id}
                      disabled={isAlready}
                      className={`w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-xs transition-colors ${isAlready ? "opacity-50 cursor-not-allowed" : "hover:bg-accent"}`}
                      onClick={() => { setSelected(u); }}
                    >
                      <Avatar className="w-6 h-6"><AvatarImage src={u.avatar_url || undefined} /><AvatarFallback className="text-[10px]">{(u.display_name || u.email).slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>
                      <div className="flex flex-col items-start min-w-0 flex-1">
                        <span className="truncate w-full text-left">{u.display_name || u.email}</span>
                        <span className="text-[10px] text-muted-foreground truncate w-full text-left">{u.email}</span>
                      </div>
                      {isAlready && <Badge variant="secondary" className="text-[9px] h-4 px-1.5">{t.assigned}</Badge>}
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
            {selected && (
              <div className="p-2 border-t border-border flex items-center gap-2">
                <div className="flex-1 text-xs truncate">{selected.display_name || selected.email}</div>
                <Button size="sm" onClick={() => void promoteToAgent()} disabled={submitting}>
                  {submitting && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                  {t.confirm}
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setSelected(null)}><X className="w-3 h-3" /></Button>
              </div>
            )}
          </PopoverContent>
        </Popover>

        {/* Agents list */}
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : agents.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground text-sm">{t.noAgents}</CardContent></Card>
        ) : (
          <div className="space-y-2">
            {agents.map((a) => (
              <Card key={a.user_id}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar className="w-9 h-9"><AvatarImage src={a.avatar_url || undefined} /><AvatarFallback className="text-xs bg-primary/10 text-primary">{(a.display_name || a.email || "A").slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{a.display_name || a.email || a.user_id}</p>
                        {a.email && <p className="text-xs text-muted-foreground truncate">{a.email}</p>}
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {a.org_names.length === 0 ? (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">—</Badge>
                          ) : a.org_names.map((n, i) => (
                            <Badge key={a.org_ids[i]} variant="outline" className="text-[10px] gap-1"><Building2 className="w-3 h-3" />{n}</Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="outline" size="sm" className="gap-1" onClick={() => openOrgPicker(a.user_id, a.org_ids)}>
                        <Building2 className="w-3.5 h-3.5" />{t.addOrg}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setRevokeTarget(a)} title={t.removeAgent}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Org-picker dialog */}
        <AlertDialog open={orgPickerFor !== null} onOpenChange={(o) => !o && setOrgPickerFor(null)}>
          <AlertDialogContent className="max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle>{t.pickOrg}</AlertDialogTitle>
              <AlertDialogDescription className="text-xs">{t.assignedOrgs}</AlertDialogDescription>
            </AlertDialogHeader>
            <ScrollArea className="max-h-72">
              <div className="space-y-1 pr-3">
                {orgs.map((o) => (
                  <label key={o.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent cursor-pointer">
                    <Checkbox
                      checked={orgPickerSelectedIds.has(o.id)}
                      onCheckedChange={(c) => {
                        const next = new Set(orgPickerSelectedIds);
                        if (c) next.add(o.id); else next.delete(o.id);
                        setOrgPickerSelectedIds(next);
                      }}
                    />
                    <span className="text-sm">{o.name}</span>
                  </label>
                ))}
              </div>
            </ScrollArea>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={submitting}>{t.cancel}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void saveOrgAssignments()} disabled={submitting}>
                {submitting && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                {t.confirm}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Revoke agent dialog */}
        <AlertDialog open={revokeTarget !== null} onOpenChange={(o) => !o && setRevokeTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t.removeConfirm}</AlertDialogTitle>
              <AlertDialogDescription>{t.removeConfirmDesc}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={submitting}>{t.cancel}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void revokeAgent()} disabled={submitting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                {submitting && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                {t.confirm}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
