import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useProfiles } from "@/contexts/ProfilesContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Plus, Trash2, Loader2, Mail, UserCheck, UserX, Users, Info, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { logActivity } from "@/lib/activityLogger";
import { useUserRole } from "@/hooks/useUserRole";
import { useIsSystemAdmin } from "@/hooks/useIsSystemAdmin";
const ALLOWED_DOMAINS = ["bizlution.com", "signcms.net"];

interface CSAgent {
  id: string;
  user_id: string | null;
  email: string;
  status: string;
  created_at: string;
}

export default function CSAgentManagement() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const { ensureProfiles, getDisplayName, profilesVersion } = useProfiles();
  const { isCsAgent } = useUserRole();
  const [agents, setAgents] = useState<CSAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CSAgent | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const { isSystemAdmin } = useIsSystemAdmin();
  const canManage = isSystemAdmin || isCsAgent;

  const t = (key: string) => {
    const map: Record<string, Record<string, string>> = {
      title: { zh: "客服人員管理", en: "CS Agent Management", ja: "CSエージェント管理" },
      subtitle: { zh: "管理客服人員，透過 Email 邀請新客服人員加入", en: "Manage CS agents and invite new ones via email", ja: "CSエージェントを管理し、メールで新しいエージェントを招待" },
      invite: { zh: "邀請客服人員", en: "Invite Agent", ja: "エージェントを招待" },
      email: { zh: "Email 地址", en: "Email Address", ja: "メールアドレス" },
      emailHint: { zh: "僅限 @bizlution.com 或 @signcms.net 的 Email", en: "Only @bizlution.com or @signcms.net emails allowed", ja: "@bizlution.com または @signcms.net のメールのみ" },
      send: { zh: "發送邀請", en: "Send Invitation", ja: "招待を送信" },
      cancel: { zh: "取消", en: "Cancel", ja: "キャンセル" },
      invited: { zh: "已邀請", en: "Invited", ja: "招待済み" },
      active: { zh: "啟用中", en: "Active", ja: "有効" },
      inactive: { zh: "已停用", en: "Inactive", ja: "無効" },
      total: { zh: "客服人員總數", en: "Total Agents", ja: "エージェント総数" },
      activeCount: { zh: "啟用中人數", en: "Active Agents", ja: "有効エージェント" },
      deleteTitle: { zh: "移除客服人員", en: "Remove Agent", ja: "エージェントを削除" },
      deleteConfirm: { zh: "確定要移除此客服人員嗎？", en: "Are you sure you want to remove this agent?", ja: "このエージェントを削除しますか？" },
      delete: { zh: "移除", en: "Remove", ja: "削除" },
      success: { zh: "邀請已發送", en: "Invitation sent", ja: "招待を送信しました" },
      deleted: { zh: "客服人員已移除", en: "Agent removed", ja: "エージェントを削除しました" },
      invalidDomain: { zh: "僅限 @bizlution.com 或 @signcms.net 的 Email 帳號", en: "Only @bizlution.com or @signcms.net emails are allowed", ja: "@bizlution.com または @signcms.net のメールのみ許可" },
      invalidEmail: { zh: "請輸入有效的 Email 地址", en: "Please enter a valid email", ja: "有効なメールアドレスを入力してください" },
      duplicate: { zh: "此 Email 已存在", en: "This email already exists", ja: "このメールは既に存在します" },
      noPermission: { zh: "僅系統管理員可管理客服人員", en: "Only the system admin can manage CS agents", ja: "システム管理者のみがCSエージェントを管理できます" },
      contactAdmin: { zh: "如需新增或移除客服人員，請聯繫系統管理員 (service@bizlution.com)。", en: "To add or remove agents, contact the system admin (service@bizlution.com).", ja: "エージェントの追加・削除は、システム管理者 (service@bizlution.com) にお問い合わせください。" },
      empty: { zh: "尚無客服人員", en: "No agents yet", ja: "エージェントはまだいません" },
      resend: { zh: "重新發送邀請", en: "Resend Invitation", ja: "招待を再送信" },
      resendSuccess: { zh: "邀請信已重新發送", en: "Invitation resent", ja: "招待を再送信しました" },
      resendFail: { zh: "重新發送失敗，請稍後重試", en: "Resend failed, please try again later", ja: "再送信に失敗しました。後でもう一度お試しください" },
    };
    return map[key]?.[language] || map[key]?.["en"] || key;
  };

  useEffect(() => { fetchAgents(); }, []);

  const fetchAgents = async () => {
    setLoading(true);
    const { data: agentsData } = await supabase
      .from("cs_agents")
      .select("*")
      .order("created_at", { ascending: true });

    if (agentsData && agentsData.length > 0) {
      const userIds = agentsData.filter(a => a.user_id).map(a => a.user_id!);
      if (userIds.length > 0) await ensureProfiles(userIds);
      setAgents(agentsData);
    } else {
      setAgents([]);
    }
    setLoading(false);
  };

  const handleInvite = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) {
      toast.error(t("invalidEmail"));
      return;
    }

    const domain = trimmed.split("@")[1];
    if (!ALLOWED_DOMAINS.includes(domain)) {
      toast.error(t("invalidDomain"));
      return;
    }

    const existingAgent = agents.find((a) => a.email === trimmed);

    setSending(true);
    let csAgentId = existingAgent?.id;

    if (existingAgent) {
      const { error: resetError } = await supabase
        .from("cs_agents")
        .update({ status: "invited", user_id: null })
        .eq("id", existingAgent.id);

      if (resetError) {
        toast.error(resetError.message);
        setSending(false);
        return;
      }
    } else {
      const { data: inserted, error } = await supabase.from("cs_agents").insert({
        email: trimmed,
        invited_by: user!.id,
        status: "invited",
      }).select("id").single();

      if (error) {
        toast.error(error.message);
        setSending(false);
        return;
      }

      csAgentId = inserted.id;
    }

    // Fetch first org name to pass along
    const { data: orgList } = await supabase.from("organizations").select("name").limit(1);
    const firstOrgName = orgList?.[0]?.name || "";
    // Send invitation email via edge function
    const { error: emailError } = await supabase.functions.invoke("send-cs-invitation", {
      body: { email: trimmed, cs_agent_id: csAgentId, org_name: firstOrgName },
    });
    if (emailError) {
      console.error("Failed to send CS invitation email:", emailError);
      toast.warning(language === "zh" ? "已更新邀請狀態，但邀請信發送失敗，請稍後重試" : "Invitation reset, but email failed to send");
    } else {
      toast.success(t("success"));
    }
    logActivity({ action: existingAgent ? "resend_cs_invitation" : "invite_cs_agent", category: "customer-service", targetName: trimmed });
    setEmail("");
    setDialogOpen(false);
    fetchAgents();
    setSending(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from("cs_agents").delete().eq("id", deleteTarget.id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success(t("deleted"));
      logActivity({ action: "remove_cs_agent", category: "customer-service", targetName: deleteTarget.email });
      fetchAgents();
    }
    setDeleting(false);
    setDeleteTarget(null);
  };

  const handleResend = async (agent: CSAgent) => {
    setResendingId(agent.id);
    try {
      const { data: orgList } = await supabase.from("organizations").select("name").limit(1);
      const firstOrgName = orgList?.[0]?.name || "";
      const { error } = await supabase.functions.invoke("send-cs-invitation", {
        body: { email: agent.email, cs_agent_id: agent.id, org_name: firstOrgName },
      });
      if (error) {
        toast.error(t("resendFail"));
      } else {
        toast.success(t("resendSuccess"));
        logActivity({ action: "resend_cs_invitation", category: "customer-service", targetName: agent.email });
      }
    } catch {
      toast.error(t("resendFail"));
    }
    setResendingId(null);
  };

  const statusBadge = (status: string) => {
    if (status === "active") return <Badge variant="default" className="gap-1 text-xs"><UserCheck className="w-3 h-3" />{t("active")}</Badge>;
    if (status === "inactive") return <Badge variant="secondary" className="text-xs"><UserX className="w-3 h-3" />{t("inactive")}</Badge>;
    return <Badge variant="outline" className="gap-1 text-xs"><Mail className="w-3 h-3" />{t("invited")}</Badge>;
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const activeCount = agents.filter(a => a.status === "active").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {canManage && (
          <Button onClick={() => setDialogOpen(true)} size="sm" className="gap-1.5">
            <Plus className="w-4 h-4" />{t("invite")}
          </Button>
        )}
      </div>

      {!canManage && (
        <div className="flex items-start gap-3 p-4 rounded-lg border border-border bg-muted/50">
          <Info className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-foreground">{t("noPermission")}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{t("contactAdmin")}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Users className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{agents.length}</p>
              <p className="text-sm text-muted-foreground">{t("total")}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center">
              <UserCheck className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{activeCount}</p>
              <p className="text-sm text-muted-foreground">{t("activeCount")}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {agents.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">{t("empty")}</CardContent></Card>
      ) : (
        <div className="grid gap-2">
          {agents.map(agent => {
            const displayName = agent.user_id ? getDisplayName(agent.user_id, "") : "";
            return (
            <Card key={`${agent.id}-${profilesVersion}`} className="hover:shadow-md transition-shadow">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar className="w-9 h-9">
                      <AvatarFallback className="text-xs bg-primary/10 text-primary">
                        {(displayName || agent.email).slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {displayName || agent.email.split("@")[0]}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground">{agent.email}</span>
                        {statusBadge(agent.status)}
                      </div>
                    </div>
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-1">
                      {agent.status === "invited" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1 text-xs text-muted-foreground hover:text-primary"
                          disabled={resendingId === agent.id}
                          onClick={() => handleResend(agent)}
                        >
                          {resendingId === agent.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                          {t("resend")}
                        </Button>
                      )}
                      {agent.user_id !== user?.id && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteTarget(agent)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
            );
          })}
        </div>
      )}

      {/* Invite Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("invite")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("email")}</Label>
              <Input
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="agent@bizlution.com"
                type="email"
              />
              <p className="text-xs text-muted-foreground">{t("emailHint")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("cancel")}</Button>
            <Button onClick={handleInvite} disabled={sending}>
              {sending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t("send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("deleteConfirm")}</p>
          <div className="flex items-center gap-3 p-3 rounded-lg border border-border">
            <Avatar className="w-9 h-9">
              <AvatarFallback className="text-xs bg-primary/10 text-primary">
                {((deleteTarget?.user_id ? getDisplayName(deleteTarget.user_id, "") : "") || deleteTarget?.email || "").slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="text-sm font-medium text-foreground">{(deleteTarget?.user_id ? getDisplayName(deleteTarget.user_id, "") : "") || deleteTarget?.email?.split("@")[0]}</p>
              <p className="text-xs text-muted-foreground">{deleteTarget?.email}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>{t("cancel")}</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
