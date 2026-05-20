import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Mail, Plus, Trash2, Loader2, Clock, CheckCircle, Building2, RefreshCw, Filter } from "lucide-react";
import { toast } from "sonner";
import { logActivity } from "@/lib/activityLogger";
import { useIsSystemAdmin } from "@/hooks/useIsSystemAdmin";
import { formatUserError } from "@/lib/formatUserError";

interface Invitation {
  id: string;
  email: string;
  org_id: string;
  org_name: string;
  status: string;
  expires_at: string;
  created_at: string;
}

interface Org {
  id: string;
  name: string;
}

export default function InvitationManagement() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { activeOrgId } = useActiveOrg();
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [orgId, setOrgId] = useState("");
  const [sending, setSending] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "expired" | "accepted">("all");

  const { isSystemAdmin } = useIsSystemAdmin();

  useEffect(() => { fetchData(); }, [activeOrgId]);

  const fetchData = async () => {
    setLoading(true);

    const [{ data: orgData }, { data: invData }] = await Promise.all([
      supabase.from("organizations").select("id, name"),
      supabase.from("invitations").select("*").order("created_at", { ascending: false }),
    ]);

    let filteredOrgs = orgData || [];

    // Filter by activeOrgId if set
    if (activeOrgId) {
      filteredOrgs = filteredOrgs.filter(o => o.id === activeOrgId);
    } else if (!isSystemAdmin && user) {
      // Non-system admins: filter to own orgs
      const { data: myMembers } = await supabase.from("team_members").select("team_id").eq("user_id", user.id);
      if (myMembers) {
        const teamIds = myMembers.map(m => m.team_id);
        const { data: teams } = await supabase.from("teams").select("id, org_id").in("id", teamIds);
        const myOrgIds = new Set((teams || []).map(t => t.org_id));
        filteredOrgs = filteredOrgs.filter(o => myOrgIds.has(o.id));
      }
    }

    setOrgs(filteredOrgs);
    if (filteredOrgs.length > 0 && !orgId) setOrgId(filteredOrgs[0].id);

    const orgMap = new Map(filteredOrgs.map(o => [o.id, o.name]));
    const filteredInv = (invData || []).filter(inv => orgMap.has(inv.org_id));

    setInvitations(filteredInv.map(inv => ({
      ...inv,
      org_name: orgMap.get(inv.org_id) || "",
    })));

    setLoading(false);
  };

  const handleSend = async () => {
    if (!email.trim() || !orgId) {
      toast.error(t("invFillRequired"));
      return;
    }

    // Parse multiple emails (split by comma, semicolon, newline, or space)
    const emails = email
      .split(/[,;\n\s]+/)
      .map(e => e.trim().toLowerCase())
      .filter(e => e.length > 0);

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalid = emails.filter(e => !emailRegex.test(e));
    if (invalid.length > 0) {
      toast.error(`${t("invInvalidEmail")}: ${invalid.join(", ")}`);
      return;
    }

    if (emails.length === 0) {
      toast.error(t("invFillRequired"));
      return;
    }

    setSending(true);
    const orgName = orgs.find(o => o.id === orgId)?.name || "";
    let successCount = 0;
    const errors: string[] = [];

    for (const addr of emails) {
      try {
        // If a pending invitation already exists for this email+org, resend it
        // (passes resend_invitation_id so the edge function replaces it instead of 409-ing).
        const existingPending = invitations.find(
          inv => inv.email.toLowerCase() === addr && inv.org_id === orgId && getInvStatus(inv) === "pending"
        );
        const body = existingPending
          ? { email: addr, org_id: orgId, resend_invitation_id: existingPending.id }
          : { email: addr, org_id: orgId };
        const { data, error } = await supabase.functions.invoke("send-invitation", {
          body,
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        successCount++;
        logActivity({ action: "send_invitation", category: "admin", targetName: addr, actionParams: { org: orgName } });
      } catch (err: unknown) {
        errors.push(`${addr}: ${err instanceof Error ? err.message : t("invSendFailed")}`);
      }
    }

    if (successCount > 0) {
      toast.success(t("invBatchSent").replace("{count}", String(successCount)));
    }
    if (errors.length > 0) {
      toast.error(errors.join("\n"));
    }

    setEmail("");
    setDialogOpen(false);
    fetchData();
    setSending(false);
  };

  const handleDelete = async (inv: Invitation) => {
    const { error } = await supabase.from("invitations").delete().eq("id", inv.id);
    if (error) toast.error(formatUserError(error, t));
    else {
      toast.success(t("invDeleted"));
      logActivity({ action: "delete_invitation", category: "admin", targetName: inv.email });
      fetchData();
    }
  };

  const handleResend = async (inv: Invitation) => {
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-invitation", {
        body: { email: inv.email, org_id: inv.org_id, resend_invitation_id: inv.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(t("invResent"));
      logActivity({ action: "resend_invitation", category: "admin", targetName: inv.email, actionParams: { org: inv.org_name } });
      fetchData();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("invSendFailed"));
    }
    setSending(false);
  };

  const statusBadge = (status: string, expiresAt: string) => {
    const expired = new Date(expiresAt) < new Date();
    if (status === "accepted") return <Badge variant="default" className="gap-1 text-xs"><CheckCircle className="w-3 h-3" />{t("invAccepted")}</Badge>;
    if (expired) return <Badge variant="secondary" className="text-xs">{t("invExpired")}</Badge>;
    return <Badge variant="outline" className="gap-1 text-xs"><Clock className="w-3 h-3" />{t("invPending")}</Badge>;
  };

  const getInvStatus = (inv: Invitation) => {
    if (inv.status === "accepted") return "accepted";
    if (new Date(inv.expires_at) < new Date()) return "expired";
    return "pending";
  };

  const filteredInvitations = statusFilter === "all"
    ? invitations
    : invitations.filter(inv => getInvStatus(inv) === statusFilter);

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const filterOptions = [
    { value: "all", label: t("invFilterAll") },
    { value: "pending", label: t("invPending") },
    { value: "expired", label: t("invExpired") },
    { value: "accepted", label: t("invAccepted") },
  ] as const;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t("invTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("invSubtitle")}</p>
        </div>
        <Button onClick={() => setDialogOpen(true)} size="sm" className="gap-1.5" disabled={orgs.length === 0}>
          <Plus className="w-4 h-4" />{t("invSendNew")}
        </Button>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {filterOptions.map(opt => (
          <Button
            key={opt.value}
            variant={statusFilter === opt.value ? "default" : "outline"}
            size="sm"
            className="text-xs h-7"
            onClick={() => setStatusFilter(opt.value as typeof statusFilter)}
          >
            {opt.label}
            {opt.value !== "all" && (
              <span className="ml-1 text-[10px] opacity-70">
                ({invitations.filter(inv => getInvStatus(inv) === opt.value).length})
              </span>
            )}
          </Button>
        ))}
      </div>

      {filteredInvitations.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">{t("invEmpty")}</CardContent></Card>
      ) : (
        <div className="grid gap-2">
          {filteredInvitations.map(inv => (
            <Card key={inv.id} className="hover:shadow-md transition-shadow">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Mail className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{inv.email}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="outline" className="text-[10px] gap-1"><Building2 className="w-3 h-3" />{inv.org_name}</Badge>
                        {statusBadge(inv.status, inv.expires_at)}
                        <span className="text-xs text-muted-foreground">{new Date(inv.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {inv.status !== "accepted" && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={() => handleResend(inv)} disabled={sending} title={t("invResend")}>
                        <RefreshCw className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    {inv.status === "pending" && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(inv)}>
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

      {/* Send Invitation Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("invSendNew")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("invEmail")}</Label>
              <Textarea
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder={t("invBatchPlaceholder")}
                rows={4}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">{t("invBatchHint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label>{t("invOrg")}</Label>
              <Select value={orgId} onValueChange={setOrgId}>
                <SelectTrigger><SelectValue placeholder={t("teamSelectOrg")} /></SelectTrigger>
                <SelectContent>
                  {orgs.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("cancel")}</Button>
            <Button onClick={handleSend} disabled={sending}>
              {sending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t("invSendBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
