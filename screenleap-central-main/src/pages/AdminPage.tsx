import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, ShieldCheck, Users, AlertTriangle, Loader2, Building2, Trash2, FileText, Mail, Info, KeyRound } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { logActivity } from "@/lib/activityLogger";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import TeamManagement from "@/components/admin/TeamManagement";
import ActivityLogPanel from "@/components/admin/ActivityLogPanel";
import InvitationManagement from "@/components/admin/InvitationManagement";
import DelegationLogPanel from "@/components/admin/DelegationLogPanel";
import { useIsSystemAdmin } from "@/hooks/useIsSystemAdmin";

interface UserWithRole {
  user_id: string; display_name: string | null; avatar_url: string | null; role: "admin" | "user"; org_names: string[];
}

export default function AdminPage() {
  const { isAdmin, isOrgAdmin, loading: roleLoading } = useUserRole();
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const { activeOrgId } = useActiveOrg();
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [systemAdminIds, setSystemAdminIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [changeDialog, setChangeDialog] = useState<{ user: UserWithRole; newRole: "admin" | "user" } | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<UserWithRole | null>(null);
  const [resetDialog, setResetDialog] = useState<UserWithRole | null>(null);
  const [resetMode, setResetMode] = useState<"email" | "password">("email");
  const [tempPassword, setTempPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const { isSystemAdmin, loading: sysAdminLoading } = useIsSystemAdmin();
  const defaultTab = isSystemAdmin ? "users" : isOrgAdmin ? "users" : "teams";
  const [activeTab, setActiveTab] = useState<string>("teams");
  // Sync activeTab once roles resolve to avoid stale initial state
  useEffect(() => {
    setActiveTab(defaultTab);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sysAdminLoading, roleLoading]);

  // Guard: if a non-system-admin somehow lands on a system-admin-only tab, redirect to default
  useEffect(() => {
    if (!isSystemAdmin && (activeTab === "activity" || activeTab === "delegation")) {
      setActiveTab(defaultTab);
    }
  }, [isSystemAdmin, activeTab, defaultTab]);
  const [highlightDelegationId, setHighlightDelegationId] = useState<string | null>(null);

  useEffect(() => {
    const parseHash = () => {
      const h = window.location.hash.replace(/^#/, "");
      const params = new URLSearchParams(h);
      const did = params.get("delegation");
      if (did) {
        setActiveTab("delegation");
        setHighlightDelegationId(did);
      }
    };
    parseHash();
    window.addEventListener("hashchange", parseHash);
    return () => window.removeEventListener("hashchange", parseHash);
  }, []);

  useEffect(() => { if (!isAdmin && !isOrgAdmin) return; fetchUsers(); }, [isAdmin, isOrgAdmin, activeOrgId]);

  const fetchUsers = async () => {
    setLoading(true);
    const [{ data: profiles }, { data: roles }, { data: teamMembers }, { data: teams }, { data: orgs }] = await Promise.all([
      supabase.from("profiles").select("user_id, display_name, avatar_url"),
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("team_members").select("user_id, team_id"),
      supabase.from("teams").select("id, org_id"),
      supabase.from("organizations").select("id, name"),
    ]);

    const userRolesMap = new Map<string, Set<string>>();
    (roles || []).forEach((r) => {
      if (!userRolesMap.has(r.user_id)) userRolesMap.set(r.user_id, new Set());
      userRolesMap.get(r.user_id)!.add(r.role);
    });
    const roleMap = new Map<string, "admin" | "user">();
    userRolesMap.forEach((set, uid) => {
      roleMap.set(uid, (set.has("admin") || set.has("org_admin")) ? "admin" : "user");
    });
    const orgMap = new Map((orgs || []).map((o) => [o.id, o.name]));
    const teamOrgMap = new Map((teams || []).map((t) => [t.id, t.org_id]));

    // Build user -> org IDs and org names mapping
    const userOrgIdMap = new Map<string, Set<string>>();
    const userOrgNameMap = new Map<string, Set<string>>();
    (teamMembers || []).forEach((tm) => {
      const orgId = teamOrgMap.get(tm.team_id);
      if (orgId) {
        if (!userOrgIdMap.has(tm.user_id)) userOrgIdMap.set(tm.user_id, new Set());
        userOrgIdMap.get(tm.user_id)!.add(orgId);
        const orgName = orgMap.get(orgId);
        if (orgName) {
          if (!userOrgNameMap.has(tm.user_id)) userOrgNameMap.set(tm.user_id, new Set());
          userOrgNameMap.get(tm.user_id)!.add(orgName);
        }
      }
    });

    // Determine filtering org IDs
    const isCurrentSystemAdmin = isSystemAdmin;

    // Load system admin user_ids set for row-level "protected" badge
    const { data: sysAdminRows } = await supabase.rpc("list_system_admins");
    const sysIds = new Set<string>(((sysAdminRows as { user_id: string }[]) || []).map((r) => r.user_id));
    setSystemAdminIds(sysIds);

    // If activeOrgId is set, filter to that org only
    let filterOrgIds: Set<string>;
    if (activeOrgId) {
      filterOrgIds = new Set([activeOrgId]);
    } else if (!isCurrentSystemAdmin && user) {
      // Fallback: current user's orgs
      const myOrgIds = new Set<string>();
      (teamMembers || []).forEach(m => {
        if (m.user_id === user.id) {
          const team = (teams || []).find(t => t.id === m.team_id);
          if (team) myOrgIds.add(team.org_id);
        }
      });
      filterOrgIds = myOrgIds;
    } else {
      // System admin with no org filter: show all
      filterOrgIds = new Set((orgs || []).map(o => o.id));
    }

    let filteredProfiles = profiles || [];

    // Filter users to only those belonging to the target org(s)
    if (filterOrgIds.size > 0) {
      filteredProfiles = filteredProfiles.filter((p) => {
        if (p.user_id === user?.id) return true;
        const targetOrgIds = userOrgIdMap.get(p.user_id);
        if (!targetOrgIds) return false;
        return [...targetOrgIds].some((id) => filterOrgIds.has(id));
      });
    } else if (!isCurrentSystemAdmin) {
      filteredProfiles = filteredProfiles.filter((p) => p.user_id === user?.id);
    }

    setUsers(filteredProfiles.map((p) => ({
      user_id: p.user_id,
      display_name: p.display_name,
      avatar_url: p.avatar_url,
      role: (roleMap.get(p.user_id) as "admin" | "user") ?? "user",
      org_names: [...(userOrgNameMap.get(p.user_id) || [])],
    })));
    setLoading(false);
  };

  const handleRoleChange = async () => {
    if (!changeDialog) return;
    setSaving(true);
    const { user: targetUser, newRole } = changeDialog;
    await supabase.from("user_roles").delete().eq("user_id", targetUser.user_id);
    const { error } = await supabase.from("user_roles").insert({ user_id: targetUser.user_id, role: newRole });
    if (error) { toast.error(`${t("adminRoleUpdateFailed")}：${error.message}`); }
    else { toast.success(t("adminRoleUpdated")); logActivity({ action: "change_role", category: "admin", targetName: targetUser.display_name || "", actionParams: { role: newRole } }); fetchUsers(); }
    setSaving(false); setChangeDialog(null);
  };

  const handleDeleteUser = async () => {
    if (!deleteDialog) return;
    if (deleteDialog.user_id === user?.id) {
      toast.error(t("adminCannotDeleteSelf"));
      setDeleteDialog(null);
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("delete-user", {
        body: { target_user_id: deleteDialog.user_id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(t("adminDeleteUserSuccess"));
      logActivity({ action: "delete_user", category: "admin", targetName: deleteDialog.display_name || "", targetId: deleteDialog.user_id });
      fetchUsers();
    } catch (error: unknown) {
      toast.error(`${t("adminDeleteUserFailed")}：${error instanceof Error ? error.message : String(error)}`);
    }
    setSaving(false);
    setDeleteDialog(null);
  };

  const handleResetPassword = async () => {
    if (!resetDialog) return;
    if (resetMode === "password" && (tempPassword.length < 8 || tempPassword.length > 72)) {
      toast.error(t("adminResetPasswordLengthError"));
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("reset-user-password", {
        body: {
          target_user_id: resetDialog.user_id,
          mode: resetMode,
          new_password: resetMode === "password" ? tempPassword : undefined,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(resetMode === "email" ? `${t("adminResetPasswordEmailSent")} ${data?.email || ""}` : t("adminResetPasswordPasswordSet"));
      logActivity({
        action: resetMode === "email" ? "reset_password_email" : "reset_password_manual",
        category: "admin",
        targetName: resetDialog.display_name || "",
        targetId: resetDialog.user_id,
        detail: resetMode === "email" ? t("adminResetPasswordLogEmail") : t("adminResetPasswordLogTemp"),
      });
      setResetDialog(null);
      setTempPassword("");
    } catch (e: unknown) {
      toast.error(`${t("adminResetPasswordFailed")}：${e instanceof Error ? e.message : String(e)}`);
    }
    setSaving(false);
  };

  if (roleLoading || sysAdminLoading) return <div className="flex items-center justify-center min-h-[400px]"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  if (!isAdmin && !isOrgAdmin) return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Card className="max-w-md w-full">
        <CardContent className="pt-6 text-center space-y-3">
          <AlertTriangle className="w-12 h-12 text-warning mx-auto" />
          <h2 className="text-lg font-semibold text-foreground">{t("adminNoPermission")}</h2>
          <p className="text-sm text-muted-foreground">{t("adminNoPermissionDesc")}</p>
        </CardContent>
      </Card>
    </div>
  );


  return (
    <div className="space-y-6 max-w-5xl">
      <div className="animate-fade-in">
        <h1 className="text-2xl font-bold text-foreground">{t("adminTitle")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("adminSubtitle")}</p>
      </div>

      {!isSystemAdmin && !isOrgAdmin && (
        <div className="flex items-start gap-3 p-4 rounded-lg border border-border bg-muted/50">
          <Info className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-foreground">
              {t("adminUserMgmtRestricted")}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("adminContactSysAdmin")}
            </p>
          </div>
        </div>
      )}

      {isOrgAdmin && !isSystemAdmin && (
        <div className="flex items-start gap-3 p-4 rounded-lg border border-border bg-muted/50">
          <Info className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-foreground">
              {t("adminOrgAdminLabel")}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("adminOrgAdminDesc")}
            </p>
          </div>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          {(isSystemAdmin || isOrgAdmin) && <TabsTrigger value="users" className="gap-1.5"><Users className="w-4 h-4" />{t("tabUsers")}</TabsTrigger>}
          <TabsTrigger value="teams" className="gap-1.5"><Users className="w-4 h-4" />{t("tabTeams")}</TabsTrigger>
          {isSystemAdmin && <TabsTrigger value="activity" className="gap-1.5"><FileText className="w-4 h-4" />{t("tabActivityLog")}</TabsTrigger>}
          {isSystemAdmin && <TabsTrigger value="delegation" className="gap-1.5"><ShieldCheck className="w-4 h-4" />{t("tabDelegationLog")}</TabsTrigger>}
          {(isSystemAdmin || isOrgAdmin) && <TabsTrigger value="invitations" className="gap-1.5"><Mail className="w-4 h-4" />{t("tabInvitations")}</TabsTrigger>}
        </TabsList>

        {/* Users Tab */}
        {(isSystemAdmin || isOrgAdmin) && <TabsContent value="users" className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card>
              <CardContent className="pt-5 flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><Users className="w-5 h-5 text-primary" /></div>
                <div><p className="text-2xl font-bold text-foreground">{users.length}</p><p className="text-sm text-muted-foreground">{t("adminTotalUsers")}</p></div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5 flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center"><ShieldCheck className="w-5 h-5 text-warning" /></div>
                <div><p className="text-2xl font-bold text-foreground">{users.filter((u) => u.role === "admin").length}</p><p className="text-sm text-muted-foreground">{t("adminAdminCount")}</p></div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t("adminUserList")}</CardTitle>
              <CardDescription>{t("adminUserListDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
              ) : (
                <div className="space-y-2">
                  {users.map((u) => {
                    const isSelf = u.user_id === user?.id;
                    const isProtected = systemAdminIds.has(u.user_id);
                    // System admin: delete anyone (except self & protected). org_admin: delete users in own org including admins.
                    const canDelete = !isSelf && !isProtected && (isSystemAdmin || isAdmin || isOrgAdmin);
                    // Admin / org_admin can reset passwords of users in scope
                    const canResetPassword = !isSelf && !isProtected && (isSystemAdmin || isAdmin || isOrgAdmin);
                    // Only system admin can change roles
                    const canChangeRole = isSystemAdmin;

                    return (
                      <div key={u.user_id} className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors">
                        <div className="flex items-center gap-3">
                          <Avatar className="w-9 h-9">
                            <AvatarImage src={u.avatar_url || undefined} />
                            <AvatarFallback className="text-xs bg-primary/10 text-primary">{(u.display_name || "U").slice(0, 2).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-foreground">{u.display_name || t("adminUnnamed")}</p>
                              {isSelf && <Badge variant="outline" className="text-[10px] py-0">You</Badge>}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              {u.org_names.length > 0 && (
                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                  <Building2 className="w-3 h-3" />
                                  {u.org_names.join(", ")}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={u.role === "admin" ? "default" : "secondary"} className="gap-1">
                            {u.role === "admin" ? <ShieldCheck className="w-3 h-3" /> : <Shield className="w-3 h-3" />}
                            {u.role === "admin" ? t("adminRole") : t("adminRegularUser")}
                          </Badge>
                          {canChangeRole ? (
                            <Select value={u.role} onValueChange={(value: "admin" | "user") => { if (value !== u.role) setChangeDialog({ user: u, newRole: value }); }}>
                              <SelectTrigger className="w-[120px] h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="admin">{t("adminRole")}</SelectItem>
                                <SelectItem value="user">{t("adminRegularUser")}</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : null}
                          {canResetPassword && (
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setResetDialog(u); setResetMode("email"); setTempPassword(""); }} title={t("adminResetPassword")}>
                              <KeyRound className="w-4 h-4" />
                            </Button>
                          )}
                          {canDelete && (
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteDialog(u)} title={t("adminDeleteUser")}>
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>}

        {/* Teams Tab */}
        <TabsContent value="teams">
          <TeamManagement />
        </TabsContent>

        {/* Activity Log Tab - system admin only */}
        {isSystemAdmin && (
          <TabsContent value="activity">
            <ActivityLogPanel />
          </TabsContent>
        )}

        {/* Delegation Log Tab - system admin only */}
        {isSystemAdmin && (
          <TabsContent value="delegation">
            <DelegationLogPanel highlightId={highlightDelegationId} />
          </TabsContent>
        )}

        {/* Invitations Tab */}
        {(isSystemAdmin || isOrgAdmin) && <TabsContent value="invitations">
          <InvitationManagement />
        </TabsContent>}

      </Tabs>

      {/* Role Change Dialog */}
      <Dialog open={!!changeDialog} onOpenChange={() => setChangeDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("adminConfirmChange")}</DialogTitle>
            <DialogDescription>
              {t("adminConfirmChangeDesc")} <strong>{changeDialog?.user.display_name || t("user")}</strong> {t("adminChangeRoleTo")} <strong>{changeDialog?.newRole === "admin" ? t("adminRole") : t("adminRegularUser")}</strong>？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangeDialog(null)}>{t("cancel")}</Button>
            <Button onClick={handleRoleChange} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t("adminConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete User Dialog */}
      <Dialog open={!!deleteDialog} onOpenChange={() => setDeleteDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("adminDeleteUser")}</DialogTitle>
            <DialogDescription>{t("adminDeleteUserConfirm")}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-3 p-3 rounded-lg border border-border">
            <Avatar className="w-9 h-9">
              <AvatarImage src={deleteDialog?.avatar_url || undefined} />
              <AvatarFallback className="text-xs bg-primary/10 text-primary">{(deleteDialog?.display_name || "U").slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div>
              <p className="text-sm font-medium text-foreground">{deleteDialog?.display_name || t("adminUnnamed")}</p>
              {deleteDialog?.org_names && deleteDialog.org_names.length > 0 && (
                <p className="text-xs text-muted-foreground">{deleteDialog.org_names.join(", ")}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog(null)}>{t("cancel")}</Button>
            <Button variant="destructive" onClick={handleDeleteUser} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={!!resetDialog} onOpenChange={(o) => { if (!o) { setResetDialog(null); setTempPassword(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("adminResetPasswordTitle")}</DialogTitle>
            <DialogDescription>
              {t("adminResetPasswordDescPrefix")} <strong>{resetDialog?.display_name || t("adminUnnamed")}</strong>{t("adminResetPasswordDescSuffix")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={resetMode} onValueChange={(v: "email" | "password") => setResetMode(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="email">{t("adminResetPasswordModeEmail")}</SelectItem>
                <SelectItem value="password">{t("adminResetPasswordModePassword")}</SelectItem>
              </SelectContent>
            </Select>
            {resetMode === "password" && (
              <div className="space-y-1.5">
                <label className="text-sm text-foreground">{t("adminResetPasswordTempLabel")}</label>
                <Input
                  type="text"
                  value={tempPassword}
                  onChange={(e) => setTempPassword(e.target.value)}
                  placeholder={t("adminResetPasswordTempPlaceholder")}
                  maxLength={72}
                />
                <p className="text-xs text-muted-foreground">{t("adminResetPasswordTempHint")}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setResetDialog(null); setTempPassword(""); }}>{t("cancel")}</Button>
            <Button onClick={handleResetPassword} disabled={saving || (resetMode === "password" && tempPassword.length < 8)}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {resetMode === "email" ? t("adminResetPasswordSendBtn") : t("adminResetPasswordSetBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
