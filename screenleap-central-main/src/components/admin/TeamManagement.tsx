import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Users as UsersIcon, Plus, Pencil, Trash2, UserPlus, UserMinus, Loader2, ChevronDown, ChevronUp, Building2 } from "lucide-react";
import { toast } from "sonner";
import { logActivity } from "@/lib/activityLogger";

interface Team {
  id: string; name: string; description: string; org_id: string; org_name: string;
  permissions: string[]; members: TeamMember[];
}
interface TeamMember {
  id: string; user_id: string; role: string; display_name: string | null; avatar_url: string | null;
}
interface Profile { user_id: string; display_name: string | null; avatar_url: string | null; }
interface Org { id: string; name: string; }

import { useIsSystemAdmin } from "@/hooks/useIsSystemAdmin";
import { formatUserError } from "@/lib/formatUserError";
const PERMISSION_KEYS = ["screens", "media", "schedules", "publish", "studio"] as const;

export default function TeamManagement() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { activeOrgId } = useActiveOrg();
  const { isSystemAdmin } = useIsSystemAdmin();
  const [teams, setTeams] = useState<Team[]>([]);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTeam, setEditTeam] = useState<Team | null>(null);
  const [name, setName] = useState("");
  const [orgId, setOrgId] = useState("");
  const [perms, setPerms] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<Team | null>(null);
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);
  const [addMemberDialog, setAddMemberDialog] = useState<Team | null>(null);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [memberRole, setMemberRole] = useState("member");
  const [removeMemberDialog, setRemoveMemberDialog] = useState<{ team: Team; member: TeamMember } | null>(null);

  useEffect(() => { fetchData(); }, [activeOrgId]);

  const fetchData = async () => {
    setLoading(true);
    try {
    const [{ data: orgData }, { data: teamData }, { data: memberData }, { data: profileData }] = await Promise.all([
      supabase.from("organizations").select("id, name"),
      supabase.from("teams").select("*"),
      supabase.from("team_members").select("*"),
      supabase.from("profiles").select("user_id, display_name, avatar_url"),
    ]);

    // Determine current user's org IDs for filtering
    let currentUserOrgIds: Set<string> | null = null;
    if (!isSystemAdmin && user) {
      const myOrgIds = new Set<string>();
      (memberData || []).forEach(m => {
        if (m.user_id === user.id) {
          const team = (teamData || []).find(t => t.id === m.team_id);
          if (team) myOrgIds.add(team.org_id);
        }
      });
      currentUserOrgIds = myOrgIds;
    }

    // Filter orgs: if activeOrgId is set, only show that org
    let filteredOrgs = orgData || [];
    if (activeOrgId) {
      filteredOrgs = filteredOrgs.filter(o => o.id === activeOrgId);
    } else if (currentUserOrgIds) {
      filteredOrgs = currentUserOrgIds.size > 0
        ? filteredOrgs.filter(o => currentUserOrgIds!.has(o.id))
        : [];
    }
    setOrgs(filteredOrgs);
    setProfiles(profileData || []);

    const orgMap = new Map(filteredOrgs.map(o => [o.id, o.name]));
    const profileMap = new Map((profileData || []).map(p => [p.user_id, p]));

    // Filter teams to only those in visible orgs
    const filteredTeams = (teamData || []).filter(tm => orgMap.has(tm.org_id));

    setTeams(filteredTeams.map(tm => {
      const members = (memberData || [])
        .filter(m => m.team_id === tm.id)
        .map(m => {
          const p = profileMap.get(m.user_id);
          return { id: m.id, user_id: m.user_id, role: m.role, display_name: p?.display_name || null, avatar_url: p?.avatar_url || null };
        });
      return {
        id: tm.id, name: tm.name, description: tm.description || "",
        org_id: tm.org_id, org_name: orgMap.get(tm.org_id) || "",
        permissions: Array.isArray(tm.permissions) ? (tm.permissions as string[]) : [],
        members,
      };
    }));
    } catch { /* silent — loading spinner will stop */ } finally {
      setLoading(false);
    }
  };

  const openAdd = () => { setEditTeam(null); setName(""); setOrgId(orgs[0]?.id || ""); setPerms([...PERMISSION_KEYS]); setDialogOpen(true); };
  const openEdit = (team: Team) => { setEditTeam(team); setName(team.name); setOrgId(team.org_id); setPerms(team.permissions); setDialogOpen(true); };

  const togglePerm = (p: string) => setPerms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);

  const permLabel = (key: string) => {
    const map: Record<string, string> = {
      screens: t("teamPermScreens"), media: t("teamPermMedia"), schedules: t("teamPermSchedules"),
      publish: t("teamPermPublish"), studio: t("teamPermStudio"),
    };
    return map[key] || key;
  };

  const handleSave = async () => {
    if (!name.trim() || !orgId) { toast.error(t("teamFillRequired")); return; }
    setSaving(true);
    const payload = { name: name.trim(), org_id: orgId, permissions: perms };
    if (editTeam) {
      const { error } = await supabase.from("teams").update(payload).eq("id", editTeam.id);
      if (error) toast.error(formatUserError(error, t)); else { toast.success(t("teamUpdated")); logActivity({ action: "edit_team", category: "admin", targetName: name.trim(), targetId: editTeam.id }); fetchData(); }
    } else {
      const { error } = await supabase.from("teams").insert(payload);
      if (error) toast.error(formatUserError(error, t)); else { toast.success(t("teamCreated")); logActivity({ action: "create_team", category: "admin", targetName: name.trim() }); fetchData(); }
    }
    setSaving(false); setDialogOpen(false);
  };

  const handleDelete = async () => {
    if (!deleteDialog) return;
    const { error } = await supabase.from("teams").delete().eq("id", deleteDialog.id);
    if (error) toast.error(formatUserError(error, t)); else { toast.success(t("teamDeleted")); logActivity({ action: "delete_team", category: "admin", targetName: deleteDialog.name, targetId: deleteDialog.id }); fetchData(); }
    setDeleteDialog(null);
  };

  const handleAddMember = async () => {
    if (!addMemberDialog || !selectedUserId) return;
    const exists = addMemberDialog.members.some(m => m.user_id === selectedUserId);
    if (exists) { toast.error(t("memberAlreadyInTeam")); return; }
    setSaving(true);
    const { error } = await supabase.from("team_members").insert({ team_id: addMemberDialog.id, user_id: selectedUserId, role: memberRole });
    if (error) toast.error(formatUserError(error, t)); else { toast.success(t("memberAdded")); fetchData(); }
    setSaving(false); setAddMemberDialog(null); setSelectedUserId(""); setMemberRole("member");
  };

  const handleRemoveMember = async () => {
    if (!removeMemberDialog) return;
    const { error } = await supabase.from("team_members").delete().eq("id", removeMemberDialog.member.id);
    if (error) toast.error(formatUserError(error, t)); else { toast.success(t("memberRemoved")); fetchData(); }
    setRemoveMemberDialog(null);
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">{t("teamTitle")}</h2>
        <Button onClick={openAdd} size="sm" className="gap-1.5" disabled={orgs.length === 0}>
          <Plus className="w-4 h-4" />{t("teamAdd")}
        </Button>
      </div>

      {orgs.length === 0 && (
        <Card><CardContent className="py-8 text-center text-muted-foreground">{t("orgNoOrgs")}</CardContent></Card>
      )}

      {teams.length === 0 && orgs.length > 0 && (
        <Card><CardContent className="py-8 text-center text-muted-foreground">{t("teamNoTeams")}</CardContent></Card>
      )}

      <div className="grid gap-3">
        {teams.map(team => (
          <Card key={team.id} className="hover:shadow-md transition-shadow">
            <CardContent className="pt-5 space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-accent/50 flex items-center justify-center shrink-0">
                    <UsersIcon className="w-5 h-5 text-accent-foreground" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-foreground">
                        {team.name === "Default" ? t("teamNoTeamLabel") : team.name}
                      </h3>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-xs gap-1"><Building2 className="w-3 h-3" />{team.org_name}</Badge>
                      <span className="text-xs text-muted-foreground">{team.members.length} {t("orgMemberCount")}</span>
                    </div>
                    {team.permissions.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {team.permissions.map(p => (
                          <Badge key={p} variant="secondary" className="text-xs">{permLabel(p)}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setExpandedTeam(expandedTeam === team.id ? null : team.id)} title={expandedTeam === team.id ? t("cancel") : t("orgMemberCount")}>
                    {expandedTeam === team.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(team)} title={t("edit")}><Pencil className="w-3.5 h-3.5" /></Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8 text-destructive" 
                    onClick={() => setDeleteDialog(team)} 
                    title={t("confirmDelete")}
                    disabled={team.name === "Default"}
                  >
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  </Button>
                </div>
              </div>

              {/* Expanded member list */}
              {expandedTeam === team.id && (
                <div className="border-t border-border pt-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">{t("orgMemberCount")}</span>
                    <Button variant="outline" size="sm" className="gap-1 h-7 text-xs" onClick={() => { setAddMemberDialog(team); setSelectedUserId(""); setMemberRole("member"); }}>
                      <UserPlus className="w-3 h-3" />{t("memberAdd")}
                    </Button>
                  </div>
                  {team.members.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-3">{t("memberNoMembers")}</p>
                  ) : (
                    team.members.map(m => (
                      <div key={m.id} className="flex items-center justify-between p-2 rounded-lg border border-border">
                        <div className="flex items-center gap-2">
                          <Avatar className="w-7 h-7">
                            <AvatarImage src={m.avatar_url || undefined} />
                            <AvatarFallback className="text-xs bg-primary/10 text-primary">{(m.display_name || "U").slice(0, 2).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <span className="text-sm text-foreground">{m.display_name || m.user_id.slice(0, 8)}</span>
                          <Badge variant={m.role === "leader" ? "default" : "secondary"} className="text-xs">
                            {m.role === "leader" ? t("memberRoleLeader") : t("memberRoleMember")}
                          </Badge>
                        </div>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setRemoveMemberDialog({ team, member: m })} title={t("memberRemove")}>
                          <UserMinus className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Add/Edit Team Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editTeam ? t("edit") : t("teamAdd")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("teamName")}</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder={t("teamNamePlaceholder")} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("teamOrg")}</Label>
              <Select value={orgId} onValueChange={setOrgId}>
                <SelectTrigger><SelectValue placeholder={t("teamSelectOrg")} /></SelectTrigger>
                <SelectContent>{orgs.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("teamPermissions")}</Label>
              <div className="grid grid-cols-2 gap-2">
                {PERMISSION_KEYS.map(p => (
                  <label key={p} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={perms.includes(p)} onCheckedChange={() => togglePerm(p)} />
                    {permLabel(p)}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("cancel")}</Button>
            <Button onClick={handleSave} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}{t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Team Dialog */}
      <Dialog open={!!deleteDialog} onOpenChange={() => setDeleteDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("confirmDelete")}</DialogTitle>
            <DialogDescription>{t("teamDeleteConfirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog(null)}>{t("cancel")}</Button>
            <Button variant="destructive" onClick={handleDelete}>{t("delete")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Member Dialog */}
      <Dialog open={!!addMemberDialog} onOpenChange={() => setAddMemberDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("memberAdd")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("memberSelectUser")}</Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger><SelectValue placeholder={t("memberSelectUser")} /></SelectTrigger>
                <SelectContent>
                  {profiles
                    .filter(p => !addMemberDialog?.members.some(m => m.user_id === p.user_id))
                    .map(p => <SelectItem key={p.user_id} value={p.user_id}>{p.display_name || p.user_id.slice(0, 8)}</SelectItem>)
                  }
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("memberRole")}</Label>
              <Select value={memberRole} onValueChange={setMemberRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="leader">{t("memberRoleLeader")}</SelectItem>
                  <SelectItem value="member">{t("memberRoleMember")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddMemberDialog(null)}>{t("cancel")}</Button>
            <Button onClick={handleAddMember} disabled={saving || !selectedUserId}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}{t("add")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Member Dialog */}
      <Dialog open={!!removeMemberDialog} onOpenChange={() => setRemoveMemberDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("memberRemove")}</DialogTitle>
            <DialogDescription>{t("memberRemoveConfirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveMemberDialog(null)}>{t("cancel")}</Button>
            <Button variant="destructive" onClick={handleRemoveMember}>{t("delete")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
