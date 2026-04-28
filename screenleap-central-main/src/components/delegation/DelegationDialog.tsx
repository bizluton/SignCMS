import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useActiveDelegations } from "@/hooks/useActiveDelegations";
import { logActivity } from "@/lib/activityLogger";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Loader2, Trash2, ShieldCheck, Clock } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

interface Candidate {
  user_id: string;
  display_name: string | null;
  email?: string | null;
}

import { useIsSystemAdmin } from "@/hooks/useIsSystemAdmin";

function defaultExpiresLocal(): string {
  // default = now + 4h, in datetime-local format
  const d = new Date(Date.now() + 4 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function DelegationDialog({ open, onOpenChange }: Props) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { granted, refresh } = useActiveDelegations();

  const [scope, setScope] = useState<"org_admin" | "cs_agent">("cs_agent");
  const [granteeId, setGranteeId] = useState<string>("");
  const [expiresAt, setExpiresAt] = useState<string>(defaultExpiresLocal());
  const [reason, setReason] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loadingCands, setLoadingCands] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Load candidates when scope or open changes
  useEffect(() => {
    if (!open || !user) return;
    setGranteeId("");
    setLoadingCands(true);
    (async () => {
      let list: Candidate[] = [];
      if (scope === "cs_agent") {
        const { data } = await supabase
          .from("cs_agents")
          .select("user_id, email")
          .eq("status", "active")
          .not("user_id", "is", null);
        const ids = (data || []).map((d) => d.user_id).filter(Boolean) as string[];
        if (ids.length) {
          const { data: profs } = await supabase
            .from("profiles")
            .select("user_id, display_name")
            .in("user_id", ids);
          const map = new Map((profs || []).map((p) => [p.user_id, p.display_name]));
          list = (data || [])
            .filter((d) => d.user_id && d.user_id !== user.id)
            .map((d) => ({
              user_id: d.user_id as string,
              display_name: map.get(d.user_id as string) || null,
              email: d.email,
            }));
        }
      } else {
        // org_admin in same org as current user
        const { data: myMembers } = await supabase
          .from("team_members")
          .select("team_id")
          .eq("user_id", user.id);
        const teamIds = (myMembers || []).map((m) => m.team_id);
        if (teamIds.length) {
          const { data: myTeams } = await supabase
            .from("teams")
            .select("id, org_id")
            .in("id", teamIds);
          const orgIds = Array.from(new Set((myTeams || []).map((t) => t.org_id)));
          if (orgIds.length) {
            const { data: sameOrgTeams } = await supabase
              .from("teams")
              .select("id")
              .in("org_id", orgIds);
            const sameOrgTeamIds = (sameOrgTeams || []).map((t) => t.id);
            const { data: members } = await supabase
              .from("team_members")
              .select("user_id")
              .in("team_id", sameOrgTeamIds);
            const memberIds = Array.from(
              new Set((members || []).map((m) => m.user_id).filter((id) => id !== user.id))
            );
            if (memberIds.length) {
              const { data: roles } = await supabase
                .from("user_roles")
                .select("user_id")
                .eq("role", "org_admin")
                .in("user_id", memberIds);
              const orgAdminIds = (roles || []).map((r) => r.user_id);
              if (orgAdminIds.length) {
                const { data: profs } = await supabase
                  .from("profiles")
                  .select("user_id, display_name")
                  .in("user_id", orgAdminIds);
                list = (profs || []).map((p) => ({
                  user_id: p.user_id,
                  display_name: p.display_name,
                }));
              }
            }
          }
        }
      }
      setCandidates(list);
      setLoadingCands(false);
    })();
  }, [scope, open, user]);

  const handleGrant = async () => {
    if (!user || !granteeId) return;
    const expiry = new Date(expiresAt);
    if (isNaN(expiry.getTime()) || expiry.getTime() <= Date.now()) {
      toast.error(t("delegationGrantFailed"));
      return;
    }
    setSubmitting(true);
    const { error } = await (supabase as any).from("delegation_grants").insert({
      grantor_id: user.id,
      grantee_id: granteeId,
      grantee_scope: scope,
      reason: reason.trim().slice(0, 500),
      expires_at: expiry.toISOString(),
    });
    if (error) {
      toast.error(error.message || t("delegationGrantFailed"));
      setSubmitting(false);
      return;
    }
    const cand = candidates.find((c) => c.user_id === granteeId);
    await logActivity({
      action: "delegation.grant",
      category: "admin",
      targetType: "delegation",
      targetId: granteeId,
      targetName: cand?.display_name || cand?.email || granteeId.slice(0, 8),
      actionParams: { scope, expires_at: expiry.toISOString() },
    });
    toast.success(t("delegationGranted"));
    setReason("");
    setSubmitting(false);
    refresh();
  };

  const handleRevoke = async (id: string, granteeName?: string) => {
    const { error } = await (supabase as any)
      .from("delegation_grants")
      .update({ status: "revoked", revoked_by: user?.id, revoked_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await logActivity({
      action: "delegation.revoke",
      category: "admin",
      targetType: "delegation",
      targetId: id,
      targetName: granteeName,
    });
    toast.success(t("delegationRevoked"));
    refresh();
  };

  const formatRemain = (iso: string) => {
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return "0m";
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const { isSystemAdmin: isSystemAdminUser } = useIsSystemAdmin();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            {t("delegationTitle")}
          </DialogTitle>
          <DialogDescription>{t("delegationDesc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("delegationScope")}</Label>
            <Select value={scope} onValueChange={(v: "org_admin" | "cs_agent") => setScope(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cs_agent">{t("delegationScopeCsAgent")}</SelectItem>
                {!isSystemAdminUser && (
                  <SelectItem value="org_admin">{t("delegationScopeOrgAdmin")}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t("delegationGrantee")}</Label>
            <Select value={granteeId} onValueChange={setGranteeId} disabled={loadingCands || candidates.length === 0}>
              <SelectTrigger>
                <SelectValue placeholder={loadingCands ? "…" : (candidates.length === 0 ? t("delegationNoEligible") : t("delegationGranteePlaceholder"))} />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((c) => (
                  <SelectItem key={c.user_id} value={c.user_id}>
                    {c.display_name || c.email || c.user_id.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t("delegationExpiresAt")}</Label>
            <div className="flex flex-wrap gap-1.5">
              {[
                { key: "delegationPreset1h", hours: 1 },
                { key: "delegationPreset4h", hours: 4 },
                { key: "delegationPreset24h", hours: 24 },
                { key: "delegationPreset7d", hours: 24 * 7 },
              ].map((p) => (
                <Button
                  key={p.key}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    const d = new Date(Date.now() + p.hours * 3600 * 1000);
                    const pad = (n: number) => String(n).padStart(2, "0");
                    setExpiresAt(
                      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
                    );
                  }}
                >
                  {t(p.key as any)}
                </Button>
              ))}
            </div>
            <Input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              min={defaultExpiresLocal().slice(0, 10) + "T00:00"}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("delegationReason")}</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("delegationReasonPlaceholder")}
              rows={2}
              maxLength={500}
            />
          </div>

          <Button onClick={handleGrant} disabled={!granteeId || submitting} className="w-full">
            {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {t("delegationGrant")}
          </Button>

          {/* Active list */}
          <div className="pt-2 border-t border-border">
            <h3 className="text-sm font-semibold mb-2">{t("delegationActiveTitle")}</h3>
            {granted.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">{t("delegationActiveEmpty")}</p>
            ) : (
              <div className="space-y-2">
                {granted.map((g) => (
                  <Card key={g.id} className="p-3 flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {g.grantee_name || g.grantee_id.slice(0, 8)}
                        <span className="ml-2 text-xs text-muted-foreground">
                          ({g.grantee_scope === "cs_agent" ? t("delegationScopeCsAgent") : t("delegationScopeOrgAdmin")})
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Clock className="w-3 h-3" />
                        {t("delegationExpiresIn").replace("{time}", formatRemain(g.expires_at))}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => handleRevoke(g.id, g.grantee_name)}>
                      <Trash2 className="w-4 h-4 mr-1" />
                      {t("delegationRevoke")}
                    </Button>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
