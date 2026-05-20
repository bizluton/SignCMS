import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useUserRole } from "@/hooks/useUserRole";
import { useIsSystemAdmin } from "@/hooks/useIsSystemAdmin";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Key, Copy, CalendarClock, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PlanTier, PLAN_LABELS } from "@/hooks/useOrgPlan";
import { formatUserError } from "@/lib/formatUserError";

interface LicenseCode {
  id: string;
  code: string;
  extend_days: number;
  plan_name: string;
  plan_tier: PlanTier | null;
  status: string;
  redeemed_by_org: string | null;
  redeemed_at: string | null;
  assigned_org_id: string | null;
  created_at: string;
}

interface OrgLicense {
  id: string;
  name: string;
  license_plan: string;
  license_expires_at: string;
  plan_tier: PlanTier;
}

const PLAN_TIERS: PlanTier[] = ["evaluation", "starter", "business", "professional", "enterprise"];

export default function LicenseManagement() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { isCsAgent } = useUserRole();
  const { isSystemAdmin } = useIsSystemAdmin();
  const canManage = isSystemAdmin || isCsAgent;

  const [codes, setCodes] = useState<LicenseCode[]>([]);
  const [orgs, setOrgs] = useState<OrgLicense[]>([]);
  const [loading, setLoading] = useState(true);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [expiryDialog, setExpiryDialog] = useState<OrgLicense | null>(null);
  const [newExpiry, setNewExpiry] = useState("");
  const [saving, setSaving] = useState(false);

  // Generate form
  const PLAN_PRESETS = [
    { name: "三十天試用", days: 30 },
    { name: "標準季度授權", days: 90 },
    { name: "標準半年授權", days: 180 },
    { name: "標準年度授權", days: 365 },
    { name: "三年授權", days: 365 * 3 },
    { name: "五年授權", days: 365 * 5 },
    { name: "永久授權", days: 365 * 100 },
  ];
  const [genExtendDays, setGenExtendDays] = useState("365");
  const [genPlanName, setGenPlanName] = useState("標準年度授權");
  const [genCount, setGenCount] = useState("1");
  const [genPreset, setGenPreset] = useState("標準年度授權");
  const [genOrgId, setGenOrgId] = useState<string>("");
  const [genPlanTier, setGenPlanTier] = useState<PlanTier | "none">("none");

  const applyPreset = (name: string) => {
    setGenPreset(name);
    const p = PLAN_PRESETS.find(x => x.name === name);
    if (p) {
      setGenPlanName(p.name);
      setGenExtendDays(String(p.days));
    }
  };

  useEffect(() => {
    if (!canManage) return;
    fetchData();
  }, [canManage]);

  const fetchData = async () => {
    setLoading(true);
    const [{ data: codesData }, { data: orgsData }] = await Promise.all([
      supabase.from("license_codes").select("*").order("created_at", { ascending: false }),
      supabase.from("organizations").select("id, name, license_plan, license_expires_at, plan_tier").order("name"),
    ]);
    setCodes((codesData as LicenseCode[]) || []);
    setOrgs((orgsData as OrgLicense[]) || []);
    setLoading(false);
  };

  const ERROR_MAP: Record<string, string> = {
    permission_denied: "權限不足",
    unauthenticated: "請先登入",
    invalid_plan_name: "方案名稱不在允許清單中",
    invalid_extend_days: "延長天數須介於 1〜36500 天",
    invalid_count: "數量須介於 1〜50",
    org_required: "請選擇授權組織",
    org_not_found: "找不到指定組織",
    not_found: "找不到該授權碼",
    not_pending: "僅未使用的授權碼可刪除",
    code_not_found: "找不到該授權碼",
    code_already_redeemed: "授權碼已被兌換",
    code_not_for_this_org: "此授權碼不適用本組織",
  };

  const generateCodes = async () => {
    if (!genOrgId) { toast.error("請選擇授權組織"); return; }
    setSaving(true);
    const count = Math.min(parseInt(genCount) || 1, 50);
    const { data, error } = await (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>)("generate_license_codes", {
      _plan_name: genPlanName,
      _extend_days: parseInt(genExtendDays) || 365,
      _assigned_org_id: genOrgId,
      _count: count,
      _plan_tier: genPlanTier === "none" ? null : genPlanTier,
    });
    if (error) {
      toast.error(formatUserError(error, t));
    } else if (data && data.success === false) {
      toast.error(ERROR_MAP[data.error as string] || data.error as string);
    } else {
      toast.success(`已產生 ${count} 組授權碼`);
      fetchData();
      setGenerateOpen(false);
    }
    setSaving(false);
  };

  const updateOrgExpiry = async () => {
    if (!expiryDialog || !newExpiry) return;
    setSaving(true);
    const { error } = await supabase.from("organizations")
      .update({ license_expires_at: new Date(newExpiry).toISOString(), license_reminder_sent: [] })
      .eq("id", expiryDialog.id);
    if (error) toast.error(t("licenseUpdateFailed"));
    else { toast.success(t("licenseUpdateSuccess")); fetchData(); }
    setSaving(false);
    setExpiryDialog(null);
  };

  const updateOrgPlanTier = async (orgId: string, tier: PlanTier) => {
    const { error } = await supabase.from("organizations")
      .update({ plan_tier: tier })
      .eq("id", orgId);
    if (error) toast.error(t("planChangeFailed"));
    else { toast.success(t("planChangeSuccess")); fetchData(); }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success("已複製授權碼");
  };

  const deleteCode = async (id: string, code: string) => {
    if (!confirm(`確定要刪除授權碼 ${code} 嗎？`)) return;
    const { data, error } = await (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>)("delete_license_code", { _id: id });
    if (error) toast.error(formatUserError(error, t));
    else if (data && data.success === false) toast.error(ERROR_MAP[data.error as string] || data.error as string);
    else { toast.success("已刪除授權碼"); fetchData(); }
  };

  const getOrgName = (orgId: string | null) => {
    if (!orgId) return "-";
    return orgs.find(o => o.id === orgId)?.name || orgId;
  };

  const getDaysLeft = (expiresAt: string) => {
    const diff = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return diff;
  };

  if (!canManage) return null;
  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6">
      {/* Org License Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <CalendarClock className="w-5 h-5" />
            {t("licenseStatus")}
          </CardTitle>
          <CardDescription>所有組織的授權狀態一覽</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("licenseOrgName")}</TableHead>
                  <TableHead>{t("planTier")}</TableHead>
                  <TableHead>{t("licensePlan")}</TableHead>
                  <TableHead>{t("licenseExpiresAt")}</TableHead>
                  <TableHead>{t("licenseDaysLeft")}</TableHead>
                  <TableHead>{t("licenseStatus")}</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orgs.map(org => {
                  const days = getDaysLeft(org.license_expires_at);
                  const expired = days <= 0;
                  const expiring = days > 0 && days <= 30;
                  return (
                    <TableRow key={org.id}>
                      <TableCell className="font-medium">{org.name}</TableCell>
                      <TableCell>
                        <Select value={org.plan_tier} onValueChange={(v) => updateOrgPlanTier(org.id, v as PlanTier)}>
                          <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {PLAN_TIERS.map(pt => (
                              <SelectItem key={pt} value={pt}>{PLAN_LABELS[pt].zh}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>{org.license_plan}</TableCell>
                      <TableCell className="text-sm">{new Date(org.license_expires_at).toLocaleDateString()}</TableCell>
                      <TableCell className={expired ? "text-destructive font-bold" : expiring ? "text-orange-500 font-semibold" : ""}>
                        {days} 天
                      </TableCell>
                      <TableCell>
                        {expired ? (
                          <Badge variant="destructive">{t("licenseExpired")}</Badge>
                        ) : expiring ? (
                          <Badge variant="outline" className="border-orange-500 text-orange-500">{t("licenseExpiring")}</Badge>
                        ) : (
                          <Badge variant="default">{t("licenseActive")}</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => { setExpiryDialog(org); setNewExpiry(org.license_expires_at.slice(0, 10)); }}>
                          {t("licenseChangeExpiry")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* License Codes */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Key className="w-5 h-5" />
              {t("licenseCodeManagement")}
            </CardTitle>
          </div>
          <Button size="sm" onClick={() => setGenerateOpen(true)}>
            <Plus className="w-4 h-4 mr-1" />
            {t("licenseGenerateCode")}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("licenseCode")}</TableHead>
                  <TableHead>{t("licensePlanName")}</TableHead>
                  <TableHead>{t("planTier")}</TableHead>
                  <TableHead>{t("licenseExtendDays")}</TableHead>
                  <TableHead>授權組織</TableHead>
                  <TableHead>{t("licenseCodeStatus")}</TableHead>
                  <TableHead>{t("licenseRedeemedBy")}</TableHead>
                  <TableHead>使用日期</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {codes.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">尚無授權碼</TableCell></TableRow>
                ) : codes.map(c => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">{c.code}</TableCell>
                    <TableCell>{c.plan_name}</TableCell>
                    <TableCell className="text-sm">
                      {c.plan_tier ? <Badge variant="outline">{PLAN_LABELS[c.plan_tier].zh}</Badge> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>{c.extend_days} 天</TableCell>
                    <TableCell className="text-sm">{getOrgName(c.assigned_org_id)}</TableCell>
                    <TableCell>
                      {c.status === "pending" ? (
                        <Badge variant="outline">{t("licenseCodePending")}</Badge>
                      ) : (
                        <Badge variant="secondary">{t("licenseCodeRedeemed")}</Badge>
                      )}
                    </TableCell>
                    <TableCell>{getOrgName(c.redeemed_by_org)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {c.redeemed_at ? new Date(c.redeemed_at).toLocaleString() : "-"}
                    </TableCell>
                    <TableCell>
                      {c.status === "pending" && (
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyCode(c.code)} title="複製">
                            <Copy className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteCode(c.id, c.code)} title="刪除">
                            <Trash2 className="w-3.5 h-3.5 text-destructive" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Generate Dialog */}
      <Dialog open={generateOpen} onOpenChange={setGenerateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("licenseGenerateCode")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>授權組織 <span className="text-destructive">*</span></Label>
              <Select value={genOrgId} onValueChange={setGenOrgId}>
                <SelectTrigger><SelectValue placeholder="請選擇組織" /></SelectTrigger>
                <SelectContent>
                  {orgs.map(o => (
                    <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">此授權碼僅該組織可兌換</p>
            </div>
            <div className="space-y-2">
              <Label>方案快選</Label>
              <Select value={genPreset} onValueChange={applyPreset}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PLAN_PRESETS.map(p => (
                    <SelectItem key={p.name} value={p.name}>{p.name}（{p.days} 天）</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("licensePlanName")}</Label>
              <Input value={genPlanName} onChange={e => setGenPlanName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>升級方案版本（選填）</Label>
              <Select value={genPlanTier} onValueChange={(v) => setGenPlanTier(v as PlanTier | "none")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不變更（僅延長到期日）</SelectItem>
                  {PLAN_TIERS.map(pt => (
                    <SelectItem key={pt} value={pt}>{PLAN_LABELS[pt].zh}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">兌換時會同步把組織方案升級到此版本</p>
            </div>
            <div className="space-y-2">
              <Label>{t("licenseExtendDays")}</Label>
              <Input type="number" value={genExtendDays} onChange={e => setGenExtendDays(e.target.value)} min={1} />
            </div>
            <div className="space-y-2">
              <Label>數量</Label>
              <Input type="number" value={genCount} onChange={e => setGenCount(e.target.value)} min={1} max={50} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenerateOpen(false)}>{t("cancel")}</Button>
            <Button onClick={generateCodes} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t("licenseGenerateCode")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Expiry Dialog */}
      <Dialog open={!!expiryDialog} onOpenChange={() => setExpiryDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("licenseChangeExpiry")} - {expiryDialog?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("licenseNewExpiry")}</Label>
              <Input type="date" value={newExpiry} onChange={e => setNewExpiry(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExpiryDialog(null)}>{t("cancel")}</Button>
            <Button onClick={updateOrgExpiry} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
