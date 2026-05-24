import { useState, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, Plus, Pencil, Trash2, Users, Loader2 } from "lucide-react";
import type { TranslationKey } from "@/contexts/translations";

type PlanTier = "evaluation" | "starter" | "business" | "professional" | "enterprise";
const PLAN_TIERS: PlanTier[] = ["evaluation", "starter", "business", "professional", "enterprise"];
import { toast } from "sonner";
import { logActivity } from "@/lib/activityLogger";
import { useIsSystemAdmin } from "@/hooks/useIsSystemAdmin";
import { formatUserError } from "@/lib/formatUserError";

interface OrgAdmin {
  user_id: string;
  display_name: string | null;
}

interface Org {
  id: string;
  name: string;
  description: string;
  created_at: string;
  plan_tier: PlanTier;
  teamCount: number;
  memberCount: number;
  orgAdmins: OrgAdmin[];
}

export default function OrgManagement() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editOrg, setEditOrg] = useState<Org | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [planTier, setPlanTier] = useState<PlanTier>("evaluation");
  const [saving, setSaving] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<Org | null>(null);
  const [highlightPlanTier, setHighlightPlanTier] = useState(false);
  const planTierTriggerRef = useRef<HTMLButtonElement>(null);
  const pendingUpgradeOrgId = useRef<string | null>(null);

  const { isSystemAdmin, loading: sysAdminLoading } = useIsSystemAdmin();
  const location = useLocation();

  useEffect(() => {
    if (sysAdminLoading) return;
    fetchOrgs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sysAdminLoading, isSystemAdmin]);

  // Receive upgradeOrgId passed via React Router location.state from UsageLeaderboardPage.
  // Using state instead of window.location.hash avoids the full-page reload that the old
  // window.location.href = "/org-management#upgrade=..." approach caused with HashRouter.
  useEffect(() => {
    const upgradeId = (location.state as { upgradeOrgId?: string } | null)?.upgradeOrgId;
    if (upgradeId) pendingUpgradeOrgId.current = upgradeId;
  }, [location.state]);

  // When orgs are loaded and a pending upgrade is queued, open the edit dialog
  useEffect(() => {
    if (!pendingUpgradeOrgId.current || orgs.length === 0) return;
    const target = orgs.find(o => o.id === pendingUpgradeOrgId.current);
    if (target) {
      pendingUpgradeOrgId.current = null;
      openEdit(target);
      setHighlightPlanTier(true);
      // Focus the plan tier select shortly after dialog mounts
      setTimeout(() => planTierTriggerRef.current?.focus(), 200);
      // Remove highlight after a few seconds
      setTimeout(() => setHighlightPlanTier(false), 3000);
    }
  }, [orgs]);

  const fetchOrgs = async () => {
    setLoading(true);
    try {
    const { data: orgData } = await supabase.from("organizations").select("*");
    const { data: teams } = await supabase.from("teams").select("id, org_id");
    const { data: members } = await supabase.from("team_members").select("id, team_id, user_id");
    const { data: orgAdminRoles } = await supabase.from("user_roles").select("user_id").eq("role", "org_admin");
    const orgAdminIds = new Set((orgAdminRoles || []).map(r => r.user_id));
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, display_name")
      .in("user_id", Array.from(orgAdminIds).length ? Array.from(orgAdminIds) : ["00000000-0000-0000-0000-000000000000"]);
    const profileMap = new Map((profiles || []).map(p => [p.user_id, p.display_name]));

    if (orgData) {
      // Determine current user's org IDs for non-system admins
      let currentUserOrgIds: Set<string> | null = null;
      if (!isSystemAdmin && user) {
        const { data: myTeamMembers } = await supabase.from("team_members").select("team_id").eq("user_id", user.id);
        if (myTeamMembers) {
          const myTeamIds = myTeamMembers.map(m => m.team_id);
          const myOrgIds = new Set<string>();
          teams?.forEach(t => { if (myTeamIds.includes(t.id)) myOrgIds.add(t.org_id); });
          currentUserOrgIds = myOrgIds;
        }
      }

      const teamsByOrg = new Map<string, string[]>();
      teams?.forEach(t => {
        const list = teamsByOrg.get(t.org_id) || [];
        list.push(t.id);
        teamsByOrg.set(t.org_id, list);
      });

      let filteredOrgs = orgData;
      if (currentUserOrgIds && currentUserOrgIds.size > 0) {
        filteredOrgs = orgData.filter(o => currentUserOrgIds!.has(o.id));
      } else if (currentUserOrgIds) {
        filteredOrgs = [];
      }

      setOrgs(filteredOrgs.map(o => {
        const orgTeamIds = teamsByOrg.get(o.id) || [];
        const orgMembers = members?.filter(m => orgTeamIds.includes(m.team_id)) || [];
        const memberCount = orgMembers.length;
        const adminUserIds = Array.from(new Set(orgMembers.filter(m => orgAdminIds.has(m.user_id)).map(m => m.user_id)));
        const orgAdmins: OrgAdmin[] = adminUserIds.map(uid => ({ user_id: uid, display_name: profileMap.get(uid) ?? null }));
        return { ...o, description: o.description || "", plan_tier: (o.plan_tier || "evaluation") as PlanTier, teamCount: orgTeamIds.length, memberCount, orgAdmins };
      }));
    }
    } catch { /* silent — loading spinner will stop */ } finally {
      setLoading(false);
    }
  };

  const openAdd = () => { setEditOrg(null); setName(""); setDescription(""); setPlanTier("evaluation"); setDialogOpen(true); };
  // Only system admin can add new orgs; org admins can only edit
  const openEdit = (org: Org) => { setEditOrg(org); setName(org.name); setDescription(org.description); setPlanTier(org.plan_tier); setDialogOpen(true); };

  const handleSave = async () => {
    if (!name.trim()) { toast.error(t("orgFillRequired")); return; }
    setSaving(true);
    if (editOrg) {
      const payload: { name: string; description: string; plan_tier?: PlanTier } = { name: name.trim(), description: description.trim() };
      if (isSystemAdmin) payload.plan_tier = planTier;
      const { error } = await supabase.from("organizations").update(payload).eq("id", editOrg.id);
      if (error) {
        toast.error(formatUserError(error, t));
      } else {
        toast.success(t("orgUpdated"));
        logActivity({ action: "edit_org", category: "admin", targetName: name.trim(), targetId: editOrg.id });
        // Audit plan_tier change separately for easy filtering
        if (isSystemAdmin && planTier !== editOrg.plan_tier) {
          logActivity({
            action: "change_org_plan_tier",
            category: "admin",
            targetName: name.trim(),
            targetId: editOrg.id,
            actionParams: { from: editOrg.plan_tier, to: planTier },
          });
        }
      }
    } else {
      const { error } = await supabase.from("organizations").insert({ name: name.trim(), description: description.trim(), plan_tier: planTier });
      if (error) toast.error(formatUserError(error, t)); else { toast.success(t("orgCreated")); logActivity({ action: "create_org", category: "admin", targetName: name.trim(), actionParams: { tier: planTier } }); fetchOrgs(); }
    }
    setSaving(false);
    setDialogOpen(false);
  };

  const handleDelete = async () => {
    if (!deleteDialog) return;
    const { error } = await supabase.from("organizations").delete().eq("id", deleteDialog.id);
    if (error) toast.error(formatUserError(error, t)); else { toast.success(t("orgDeleted")); logActivity({ action: "delete_org", category: "admin", targetName: deleteDialog.name, targetId: deleteDialog.id }); fetchOrgs(); }
    setDeleteDialog(null);
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t("orgTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("orgSubtitle")}</p>
        </div>
        {isSystemAdmin && <Button onClick={openAdd} size="sm" className="gap-1.5"><Plus className="w-4 h-4" />{t("orgAdd")}</Button>}
      </div>

      {orgs.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">{t("orgNoOrgs")}</CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {orgs.map(org => (
            <Card key={org.id} className="hover:shadow-md transition-shadow">
              <CardContent className="pt-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      <Building2 className="w-5 h-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-medium text-foreground">{org.name}</h3>
                      {org.description && <p className="text-sm text-muted-foreground mt-0.5">{org.description}</p>}
                      <p className="text-[11px] text-muted-foreground/80 mt-1 font-mono break-all">UUID: {org.id}</p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                        <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">{t(`planTier${org.plan_tier.charAt(0).toUpperCase() + org.plan_tier.slice(1)}` as TranslationKey)}</span>
                        <span>{org.teamCount} {t("orgTeamCount")}</span>
                        <span>{org.memberCount} {t("orgMemberCount")}</span>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground/80">org_admin:</span>{" "}
                        {org.orgAdmins.length === 0 ? (
                          <span className="italic">—</span>
                        ) : (
                          org.orgAdmins.map((a, i) => (
                            <span key={a.user_id}>
                              {i > 0 && ", "}
                              {a.display_name || "(no name)"} <span className="font-mono text-[10px] opacity-70">{a.user_id}</span>
                            </span>
                          ))
                        )}
                      </div>
                    </div>

                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(org)} title={t("edit")}><Pencil className="w-3.5 h-3.5" /></Button>
                    {isSystemAdmin && (
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-destructive" 
                        onClick={() => setDeleteDialog(org)} 
                        title={t("confirmDelete")}
                        disabled={org.name === "Bizlution"}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editOrg ? t("edit") : t("orgAdd")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("orgName")}</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder={t("orgNamePlaceholder")} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("orgDescription")}</Label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder={t("orgDescriptionPlaceholder")} rows={3} />
            </div>
            {isSystemAdmin && (
              <div className="space-y-1.5">
                <Label>{t("planTier")}</Label>
                <Select value={planTier} onValueChange={(v) => setPlanTier(v as PlanTier)}>
                  <SelectTrigger
                    ref={planTierTriggerRef}
                    className={highlightPlanTier ? "ring-2 ring-primary ring-offset-2 transition-shadow" : undefined}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLAN_TIERS.map(tier => (
                      <SelectItem key={tier} value={tier}>
                        {t(`planTier${tier.charAt(0).toUpperCase() + tier.slice(1)}` as TranslationKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("cancel")}</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}{t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={!!deleteDialog} onOpenChange={() => setDeleteDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("confirmDelete")}</DialogTitle>
            <DialogDescription>{t("orgDeleteConfirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog(null)}>{t("cancel")}</Button>
            <Button variant="destructive" onClick={handleDelete}>{t("delete")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
