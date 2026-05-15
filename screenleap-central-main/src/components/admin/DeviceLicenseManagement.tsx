import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { useIsSystemAdmin } from "@/hooks/useIsSystemAdmin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription, DialogClose } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Cpu, Copy, Trash2, Ban, RotateCcw, Settings, Pencil, GripVertical, KeyRound, Check,
         MonitorSmartphone, Link, UserCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface DeviceLicense {
  id: string;
  device_model: string;
  device_serial: string;
  code: string;
  org_id: string;
  status: "active" | "revoked";
  note: string | null;
  created_at: string;
  revoked_at: string | null;
}

interface OrgRow { id: string; name: string }
interface DeviceModel { id: string; name: string; sort_order: number }

// Pending self-registration from web-player / Tizen devices
interface DeviceRegistration {
  id:            string;
  org_id:        string;
  status:        "pending" | "approved" | "rejected";
  device_serial: string | null;
  device_model:  string | null;
  user_agent:    string;
  fingerprint:   string;
  created_at:    string;
}

const ERROR_MAP: Record<string, string> = {
  permission_denied: "權限不足",
  unauthenticated: "請先登入",
  invalid_device_model: "請輸入有效的設備型號（最多 100 字）",
  invalid_device_serial: "請輸入有效的設備序號（最多 100 字）",
  org_required: "請選擇授權組織",
  org_not_found: "找不到指定組織",
  device_already_registered: "此設備（型號＋序號）已存在授權碼",
  not_found: "找不到該授權",
};

/** Compact relative-time label (Chinese) */
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return "剛剛";
  if (mins < 60) return `${mins} 分鐘前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs} 小時前`;
  return `${Math.floor(hrs / 24)} 天前`;
}

/** Guess a short platform name from User-Agent */
function parsePlatform(ua: string): string {
  if (/Tizen/i.test(ua))        return "Samsung Tizen";
  if (/Samsung/i.test(ua))      return "Samsung Browser";
  if (/iPhone|iPad/i.test(ua))  return "iOS";
  if (/Android/i.test(ua))      return "Android";
  if (/Macintosh/i.test(ua))    return "macOS";
  if (/Windows/i.test(ua))      return "Windows";
  if (/Linux/i.test(ua))        return "Linux";
  return "Web Browser";
}

export default function DeviceLicenseManagement() {
  const { isCsAgent } = useUserRole();
  const { isSystemAdmin } = useIsSystemAdmin();
  const canManage = isSystemAdmin || isCsAgent;

  const [rows, setRows]     = useState<DeviceLicense[]>([]);
  const [orgs, setOrgs]     = useState<OrgRow[]>([]);
  const [models, setModels] = useState<DeviceModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen]       = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [saving, setSaving]   = useState(false);

  // ── Pending registrations ─────────────────────────────────────────────
  const [pendingRegs, setPendingRegs]       = useState<DeviceRegistration[]>([]);
  const [approveDialog, setApproveDialog]   = useState<DeviceRegistration | null>(null);
  const [approveName, setApproveName]       = useState("");
  const [approving, setApproving]           = useState(false);
  const [joinCodeMap, setJoinCodeMap]       = useState<Record<string, string>>({});
  const [joinUrlDialog, setJoinUrlDialog]   = useState(false);
  const [copiedJoin, setCopiedJoin]         = useState<string | null>(null);

  // ── Device Token generation (system admin only) ───────────────────────
  type TokenDialog = {
    deviceSerial: string;
    orgId: string;
    deviceModel: string;
    screenName?: string;
    screenId?: string;
  };
  const [tokenDialog, setTokenDialog]         = useState<TokenDialog | null>(null);
  const [tokenStep, setTokenStep]             = useState<"confirm" | "noscreen" | "show">("confirm");
  const [generatedToken, setGeneratedToken]   = useState("");
  const [tokenGenerating, setTokenGenerating] = useState(false);
  const [tokenCopied, setTokenCopied]         = useState(false);

  const openTokenDialog = async (r: DeviceLicense) => {
    const { data: scr } = await supabase
      .from("screens")
      .select("id, name")
      .eq("serial_number", r.device_serial)
      .eq("org_id", r.org_id)
      .maybeSingle();
    setTokenDialog({
      deviceSerial: r.device_serial,
      orgId:        r.org_id,
      deviceModel:  r.device_model,
      screenName:   scr?.name,
      screenId:     scr?.id,
    });
    setTokenStep(scr?.id ? "confirm" : "noscreen");
    setGeneratedToken("");
    setTokenCopied(false);
  };

  const handleGenerateToken = async () => {
    if (!tokenDialog?.screenId) return;
    setTokenGenerating(true);
    try {
      const { data, error } = await supabase.rpc("issue_screen_device_token", {
        _screen_id: tokenDialog.screenId,
      });
      if (error || !data?.ok) {
        toast.error(`產生失敗：${error?.message ?? data?.error ?? "未知錯誤"}`);
        return;
      }
      setGeneratedToken(data.token as string);
      setTokenStep("show");
    } finally {
      setTokenGenerating(false);
    }
  };

  const handleCopyToken = () => {
    navigator.clipboard.writeText(generatedToken);
    setTokenCopied(true);
    setTimeout(() => setTokenCopied(false), 2000);
  };

  const [model, setModel] = useState("");
  const [serial, setSerial] = useState("");
  const [orgId, setOrgId] = useState("");
  const [note, setNote] = useState("");

  // ── Fetch helpers ──────────────────────────────────────────────────────

  const fetchPendingRegs = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from("device_registrations")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    setPendingRegs((data as DeviceRegistration[]) || []);
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const [
      { data: list },
      { data: orgsData },
      { data: modelsData },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { data: pendingData },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { data: joinData },
    ] = await Promise.all([
      supabase.from("device_licenses").select("*").order("created_at", { ascending: false }),
      supabase.from("organizations").select("id, name").order("name"),
      supabase.from("device_models").select("*").order("sort_order").order("name"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from("device_registrations")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).from("organizations").select("id, join_code"),
    ]);
    setRows((list as DeviceLicense[]) || []);
    setOrgs((orgsData as OrgRow[]) || []);
    setModels((modelsData as DeviceModel[]) || []);
    setPendingRegs((pendingData as DeviceRegistration[]) || []);
    const jm: Record<string, string> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of ((joinData as any[]) || [])) {
      if (r.join_code) jm[r.id] = r.join_code;
    }
    setJoinCodeMap(jm);
    setLoading(false);
  };

  useEffect(() => { if (canManage) fetchData(); }, [canManage]);

  // ── Realtime: watch for new device registration requests ──────────────
  useEffect(() => {
    if (!canManage) return;
    const ch = supabase
      .channel("admin-device-reg-watch")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "device_registrations" },
        () => fetchPendingRegs(),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "device_registrations" },
        () => fetchPendingRegs(),
      )
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [canManage, fetchPendingRegs]);

  // ── Approve pending registration ──────────────────────────────────────
  const handleApprove = async () => {
    if (!approveDialog || !approveName.trim()) return;
    setApproving(true);
    try {
      const { data, error } = await supabase.functions.invoke("approve-device", {
        body: { registrationId: approveDialog.id, screenName: approveName.trim() },
      });
      if (error || !data?.ok) {
        toast.error(`授權失敗：${error?.message ?? data?.error ?? "未知錯誤"}`);
        return;
      }
      toast.success("螢幕已建立，Device Token 已自動發送至裝置");
      setApproveDialog(null);
      setApproveName("");
      await fetchData();
    } finally {
      setApproving(false);
    }
  };

  const rejectReg = async (id: string) => {
    if (!confirm("確定要拒絕此裝置的授權申請？")) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from("device_registrations")
      .update({ status: "rejected", updated_at: new Date().toISOString() })
      .eq("id", id);
    await fetchPendingRegs();
    toast.success("已拒絕");
  };

  // ── Join URL helpers ───────────────────────────────────────────────────
  const joinUrl = (token: string) =>
    `${window.location.origin}/web-player.html?join=${token}`;

  const copyJoinUrl = (orgId: string) => {
    const code = joinCodeMap[orgId];
    if (!code) return;
    navigator.clipboard.writeText(joinUrl(code));
    setCopiedJoin(orgId);
    setTimeout(() => setCopiedJoin(null), 2000);
    toast.success("已複製加入網址");
  };

  // ── License CRUD ───────────────────────────────────────────────────────
  const submit = async () => {
    if (!model.trim() || !serial.trim()) { toast.error("請填寫設備型號與序號"); return; }
    if (!orgId) { toast.error("請選擇授權組織"); return; }
    setSaving(true);
    const { data, error } = await supabase.rpc("generate_device_license", {
      _device_model: model.trim(),
      _device_serial: serial.trim(),
      _org_id: orgId,
      _note: note.trim(),
    });
    if (error) toast.error(error.message);
    else if (data?.success === false) toast.error(ERROR_MAP[data.error] || data.error);
    else {
      toast.success(`已產生設備授權碼：${data.code}`);
      setModel(""); setSerial(""); setOrgId(""); setNote("");
      setOpen(false);
      fetchData();
    }
    setSaving(false);
  };

  const revoke = async (id: string) => {
    if (!confirm("確定要撤銷此設備授權？撤銷後該設備將無法通過驗證。")) return;
    const { data, error } = await supabase.rpc("revoke_device_license", { _id: id });
    if (error) toast.error(error.message);
    else if (data?.success === false) toast.error(ERROR_MAP[data.error] || data.error);
    else { toast.success("已撤銷"); fetchData(); }
  };

  const restore = async (id: string) => {
    const { data, error } = await supabase.rpc("restore_device_license", { _id: id });
    if (error) toast.error(error.message);
    else if (data?.success === false) toast.error(ERROR_MAP[data.error] || data.error);
    else { toast.success("已恢復為啟用"); fetchData(); }
  };

  const remove = async (id: string, label: string) => {
    if (!confirm(`確定要刪除設備授權 ${label} 嗎？此動作無法復原。`)) return;
    const { data, error } = await supabase.rpc("delete_device_license", { _id: id });
    if (error) toast.error(error.message);
    else if (data?.success === false) toast.error(ERROR_MAP[data.error] || data.error);
    else { toast.success("已刪除"); fetchData(); }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success("已複製授權碼");
  };

  const orgName = (id: string) => orgs.find(o => o.id === id)?.name || id;

  if (!canManage) return null;
  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      {/* ── Pending Device Registrations ─────────────────────────────── */}
      <Card className={pendingRegs.length > 0 ? "border-amber-500/40 bg-amber-500/5" : ""}>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <MonitorSmartphone className="w-4 h-4" />
              待授權裝置
              {pendingRegs.length > 0 && (
                <Badge className="bg-amber-500 text-white hover:bg-amber-600 text-xs px-1.5 py-0.5 rounded-full">
                  {pendingRegs.length}
                </Badge>
              )}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              裝置透過加入網址自助申請授權後，會在此處顯示，等待管理員核准。
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setJoinUrlDialog(true)}>
            <Link className="w-3.5 h-3.5 mr-1" />
            加入網址
          </Button>
        </CardHeader>
        <CardContent>
          {pendingRegs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">目前沒有待授權裝置</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>裝置型號</TableHead>
                    <TableHead>序號 / 識別碼</TableHead>
                    <TableHead>平台</TableHead>
                    <TableHead>所屬組織</TableHead>
                    <TableHead>申請時間</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingRegs.map(reg => (
                    <TableRow key={reg.id}>
                      <TableCell className="font-medium">
                        {reg.device_model || <span className="text-muted-foreground text-xs">未知</span>}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {reg.device_serial || reg.fingerprint.slice(0, 16).toUpperCase() || "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {parsePlatform(reg.user_agent)}
                      </TableCell>
                      <TableCell className="text-sm">{orgName(reg.org_id)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {timeAgo(reg.created_at)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                            onClick={() => {
                              setApproveDialog(reg);
                              setApproveName(reg.device_model || "");
                            }}
                          >
                            <UserCheck className="w-3.5 h-3.5 mr-1" />
                            授權
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-destructive hover:text-destructive"
                            onClick={() => rejectReg(reg.id)}
                            title="拒絕"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Device Licenses ───────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Cpu className="w-5 h-5" />
              設備授權碼
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              針對特定設備（型號＋序號）產生 6 位數授權碼，並綁定至指定組織。
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isSystemAdmin && (
              <Button size="sm" variant="outline" onClick={() => setModelsOpen(true)}>
                <Settings className="w-4 h-4 mr-1" />
                管理型號
              </Button>
            )}
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="w-4 h-4 mr-1" />
              新增設備授權
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>設備型號</TableHead>
                  <TableHead>設備序號</TableHead>
                  <TableHead>授權碼</TableHead>
                  <TableHead>授權組織</TableHead>
                  <TableHead>狀態</TableHead>
                  <TableHead>備註</TableHead>
                  <TableHead>建立日期</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">尚無設備授權</TableCell></TableRow>
                ) : rows.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.device_model}</TableCell>
                    <TableCell className="font-mono text-xs">{r.device_serial}</TableCell>
                    <TableCell className="font-mono font-bold tracking-widest">{r.code}</TableCell>
                    <TableCell className="text-sm">{orgName(r.org_id)}</TableCell>
                    <TableCell>
                      {r.status === "active"
                        ? <Badge variant="default">啟用中</Badge>
                        : <Badge variant="destructive">已撤銷</Badge>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{r.note || "-"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyCode(r.code)} title="複製授權碼">
                          <Copy className="w-3.5 h-3.5" />
                        </Button>
                        {isSystemAdmin && r.status === "active" && (
                          <Button
                            variant="ghost" size="icon"
                            className="h-7 w-7 text-amber-500 hover:text-amber-400"
                            onClick={() => openTokenDialog(r)}
                            title="產生播放器 Device Token（僅系統管理員）"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {r.status === "active" ? (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => revoke(r.id)} title="撤銷">
                            <Ban className="w-3.5 h-3.5" />
                          </Button>
                        ) : (
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => restore(r.id)} title="恢復啟用">
                            <RotateCcw className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => remove(r.id, `${r.device_model}/${r.device_serial}`)} title="刪除">
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>

        {/* Add License Dialog */}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>新增設備授權</DialogTitle>
              <DialogDescription>輸入設備型號與序號後將自動產生 6 位數驗證碼，並綁定到指定組織。</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>設備型號 <span className="text-destructive">*</span></Label>
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger><SelectValue placeholder="請選擇設備型號" /></SelectTrigger>
                  <SelectContent>
                    {models.length === 0 ? (
                      <div className="px-2 py-1.5 text-sm text-muted-foreground">尚無型號，請先由系統管理員新增</div>
                    ) : models.map(m => (
                      <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>設備序號 <span className="text-destructive">*</span></Label>
                <Input value={serial} onChange={e => setSerial(e.target.value)} maxLength={100} placeholder="例如：SN-2026-00001" />
              </div>
              <div className="space-y-2">
                <Label>授權組織 <span className="text-destructive">*</span></Label>
                <Select value={orgId} onValueChange={setOrgId}>
                  <SelectTrigger><SelectValue placeholder="請選擇組織" /></SelectTrigger>
                  <SelectContent>
                    {orgs.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>備註（選填）</Label>
                <Input value={note} onChange={e => setNote(e.target.value)} maxLength={200} placeholder="例如：客戶 / 出貨單號" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
              <Button onClick={submit} disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                產生授權碼
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <DeviceModelsDialog
          open={modelsOpen}
          onOpenChange={setModelsOpen}
          models={models}
          onChanged={fetchData}
        />

        {/* ── Device Token Dialog (system admin only) ──────────────────── */}
        <Dialog open={!!tokenDialog} onOpenChange={v => { if (!v) setTokenDialog(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-amber-500" />
                產生播放器 Device Token
              </DialogTitle>
            </DialogHeader>

            {tokenStep === "noscreen" && (
              <>
                <div className="text-sm space-y-2 py-1">
                  <p>找不到對應的螢幕記錄。</p>
                  <p className="text-muted-foreground">
                    Device Token 綁定在「螢幕」上。請先在<strong>螢幕管理</strong>中建立序號為
                    <code className="mx-1 px-1 py-0.5 bg-muted rounded text-xs font-mono">
                      {tokenDialog?.deviceSerial}
                    </code>
                    的螢幕，再回此處產生 Token。
                  </p>
                </div>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">關閉</Button>
                  </DialogClose>
                </DialogFooter>
              </>
            )}

            {tokenStep === "confirm" && (
              <>
                <div className="space-y-3 text-sm py-1">
                  <p>即將為下列螢幕產生（或重新產生）Device Token：</p>
                  <div className="rounded border bg-muted/40 px-4 py-3 space-y-1.5 text-sm">
                    <div className="flex gap-2">
                      <span className="text-muted-foreground w-20 shrink-0">螢幕名稱</span>
                      <span className="font-medium">{tokenDialog?.screenName}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-muted-foreground w-20 shrink-0">設備序號</span>
                      <code className="font-mono text-xs">{tokenDialog?.deviceSerial}</code>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-muted-foreground w-20 shrink-0">設備型號</span>
                      <span>{tokenDialog?.deviceModel}</span>
                    </div>
                  </div>
                  <p className="text-amber-600 dark:text-amber-400 text-xs rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                    ⚠️ 產生新 Token 會使舊 Token 立即失效，播放器需重新設定。Token 僅顯示一次，請立即複製保存。
                  </p>
                </div>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">取消</Button>
                  </DialogClose>
                  <Button onClick={handleGenerateToken} disabled={tokenGenerating} className="bg-amber-500 hover:bg-amber-600 text-white">
                    {tokenGenerating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    確認產生
                  </Button>
                </DialogFooter>
              </>
            )}

            {tokenStep === "show" && (
              <>
                <div className="space-y-3 text-sm py-1">
                  <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400">
                    ✅ Token 產生成功！請立即複製，此視窗關閉後將無法再次查看。
                  </div>
                  <div className="relative">
                    <code className="block w-full rounded border bg-muted px-3 py-2 font-mono text-xs break-all pr-10 select-all">
                      {generatedToken}
                    </code>
                    <Button
                      variant="ghost" size="icon"
                      className="absolute right-1 top-1 h-7 w-7"
                      onClick={handleCopyToken}
                      title="複製 Token"
                    >
                      {tokenCopied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                  <div className="rounded border px-3 py-2 text-xs text-muted-foreground space-y-1">
                    <p className="font-medium">填入 Electron 播放器設定</p>
                    <div className="mt-1 space-y-0.5 font-mono text-[11px]">
                      <p><span className="text-muted-foreground">URL: </span>https://narhbpojjtnalyfiwxue.supabase.co</p>
                      <p className="break-all"><span className="text-muted-foreground">Token: </span>{generatedToken.substring(0, 16)}…</p>
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button className="w-full">已複製，關閉</Button>
                  </DialogClose>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </Card>

      {/* ── Approve Device Dialog ─────────────────────────────────────── */}
      <Dialog open={!!approveDialog} onOpenChange={v => { if (!v) { setApproveDialog(null); setApproveName(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCheck className="w-5 h-5 text-emerald-500" />
              授權裝置
            </DialogTitle>
            <DialogDescription>
              確認裝置資訊，並為此螢幕命名後完成授權。裝置將自動收到 Device Token 並開始播放。
            </DialogDescription>
          </DialogHeader>

          {approveDialog && (
            <div className="space-y-4">
              <div className="rounded border bg-muted/40 px-4 py-3 space-y-1.5 text-sm">
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-20 shrink-0">裝置型號</span>
                  <span className="font-medium">{approveDialog.device_model || "未知"}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-20 shrink-0">序號</span>
                  <code className="font-mono text-xs break-all">
                    {approveDialog.device_serial || approveDialog.fingerprint.slice(0, 16).toUpperCase()}
                  </code>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-20 shrink-0">平台</span>
                  <span className="text-xs">{parsePlatform(approveDialog.user_agent)}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-20 shrink-0">組織</span>
                  <span className="text-xs">{orgName(approveDialog.org_id)}</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label>螢幕名稱 <span className="text-destructive">*</span></Label>
                <Input
                  value={approveName}
                  onChange={e => setApproveName(e.target.value)}
                  placeholder="例如：大廳螢幕 A"
                  maxLength={100}
                  autoFocus
                  onKeyDown={e => { if (e.key === "Enter") handleApprove(); }}
                />
                <p className="text-xs text-muted-foreground">此名稱會出現在「螢幕管理」頁面</p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setApproveDialog(null); setApproveName(""); }}>
              取消
            </Button>
            <Button
              onClick={handleApprove}
              disabled={approving || !approveName.trim()}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {approving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              確認授權
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Join URL Dialog ───────────────────────────────────────────── */}
      <Dialog open={joinUrlDialog} onOpenChange={setJoinUrlDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link className="w-5 h-5" />
              裝置加入網址
            </DialogTitle>
            <DialogDescription>
              將此網址提供給設備操作人員。裝置在瀏覽器開啟後，會自動出現在「待授權裝置」清單中。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {orgs.length === 0 ? (
              <p className="text-sm text-muted-foreground">尚無組織資料</p>
            ) : orgs.map(o => {
              const code = joinCodeMap[o.id];
              const url  = code ? joinUrl(code) : null;
              return (
                <div key={o.id} className="rounded border p-3 space-y-2">
                  {url ? (
                    <>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-sm font-mono bg-muted rounded px-3 py-2 select-all">
                          {url}
                        </code>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 shrink-0"
                          onClick={() => copyJoinUrl(o.id)}
                          title="複製"
                        >
                          {copiedJoin === o.id
                            ? <Check className="w-4 h-4 text-emerald-500" />
                            : <Copy className="w-4 h-4" />}
                        </Button>
                      </div>
                      {orgs.length > 1 && (
                        <p className="text-xs text-muted-foreground pl-1">{o.name}</p>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">尚未產生加入代碼</p>
                  )}
                </div>
              );
            })}
            <p className="text-xs text-muted-foreground rounded border border-muted px-3 py-2">
              💡 Samsung SSSP / Tizen：在 URL Launcher 中輸入上述網址，裝置會自動讀取型號與 DUID 序號。
            </p>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">關閉</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DeviceModelsDialog({
  open, onOpenChange, models, onChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  models: DeviceModel[];
  onChanged: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [newSort, setNewSort] = useState("0");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editSort, setEditSort] = useState("0");
  const [busy, setBusy] = useState(false);
  const [orderedModels, setOrderedModels] = useState<DeviceModel[]>(models);

  useEffect(() => { setOrderedModels(models); }, [models]);

  const validateName = (raw: string, ignoreId?: string): string | null => {
    const name = raw.trim();
    if (!name) return "型號名稱不可為空";
    if (name.length > 100) return "型號名稱最多 100 字";
    const dup = models.some(
      m => m.id !== ignoreId && m.name.trim().toLowerCase() === name.toLowerCase()
    );
    if (dup) return "此型號名稱已存在";
    return null;
  };

  const newNameError  = newName.length  > 0 ? validateName(newName) : null;
  const editNameError = editingId && editName.length > 0 ? validateName(editName, editingId) : null;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = orderedModels.findIndex(m => m.id === active.id);
    const newIndex = orderedModels.findIndex(m => m.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(orderedModels, oldIndex, newIndex).map((m, i) => ({ ...m, sort_order: i + 1 }));
    setOrderedModels(next);
    setBusy(true);
    const updates = await Promise.all(
      next.map(m => supabase.from("device_models").update({ sort_order: m.sort_order }).eq("id", m.id))
    );
    setBusy(false);
    const failed = updates.find((r) => r.error);
    if (failed) {
      toast.error("排序更新失敗");
      setOrderedModels(models);
    } else {
      toast.success("已更新排序");
      onChanged();
    }
  };

  const startEdit  = (m: DeviceModel) => { setEditingId(m.id); setEditName(m.name); setEditSort(String(m.sort_order)); };
  const cancelEdit = () => { setEditingId(null); setEditName(""); setEditSort("0"); };

  const add = async () => {
    const name = newName.trim();
    const err = validateName(name);
    if (err) { toast.error(err); return; }
    setBusy(true);
    const { error } = await supabase.from("device_models").insert({
      name, sort_order: parseInt(newSort) || 0,
    });
    setBusy(false);
    if (error) {
      if (error.code === "23505") toast.error("此型號已存在");
      else toast.error(error.message);
    } else {
      toast.success("已新增型號");
      setNewName(""); setNewSort("0");
      onChanged();
    }
  };

  const save = async (id: string) => {
    const name = editName.trim();
    const err = validateName(name, id);
    if (err) { toast.error(err); return; }
    setBusy(true);
    const { error } = await supabase.from("device_models").update({
      name, sort_order: parseInt(editSort) || 0,
    }).eq("id", id);
    setBusy(false);
    if (error) {
      if (error.code === "23505") toast.error("此型號已存在");
      else toast.error(error.message);
    } else {
      toast.success("已更新");
      cancelEdit();
      onChanged();
    }
  };

  const remove = async (m: DeviceModel) => {
    setBusy(true);
    const { count, error: countError } = await supabase
      .from("device_licenses")
      .select("id", { count: "exact", head: true })
      .eq("device_model", m.name);
    if (countError) {
      setBusy(false);
      toast.error(`無法檢查使用情形：${countError.message}`);
      return;
    }
    const used = count ?? 0;
    const message = used > 0
      ? `型號「${m.name}」目前已被 ${used} 筆設備授權資料使用。\n\n刪除此型號不會刪除既有授權資料，但日後無法在下拉選單中選擇此型號。\n\n確定要刪除嗎？`
      : `確定要刪除型號「${m.name}」？目前沒有任何設備授權使用此型號。`;
    if (!confirm(message)) { setBusy(false); return; }
    const { error } = await supabase.from("device_models").delete().eq("id", m.id);
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success("已刪除"); onChanged(); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>管理設備型號</DialogTitle>
          <DialogDescription>新增、修改或刪除可在「新增設備授權」中選擇的型號。</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded border p-3 space-y-3 bg-muted/30">
            <Label className="text-sm font-medium">新增型號</Label>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1 space-y-1">
                <Input
                  placeholder="型號名稱（例：Qbic BXP-300）"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  maxLength={100}
                  aria-invalid={!!newNameError}
                  className={newNameError ? "border-destructive focus-visible:ring-destructive" : ""}
                />
                {newNameError && (
                  <p className="text-xs text-destructive">{newNameError}</p>
                )}
              </div>
              <Input
                type="number"
                placeholder="排序"
                value={newSort}
                onChange={e => setNewSort(e.target.value)}
                className="sm:w-24"
              />
              <Button onClick={add} disabled={busy || !newName.trim() || !!newNameError}>
                <Plus className="w-4 h-4 mr-1" />新增
              </Button>
            </div>
          </div>

          <div className="rounded border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>型號名稱</TableHead>
                  <TableHead className="w-24">排序</TableHead>
                  <TableHead className="w-32 text-right">動作</TableHead>
                </TableRow>
              </TableHeader>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={orderedModels.map(m => m.id)} strategy={verticalListSortingStrategy}>
                  <TableBody>
                    {orderedModels.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">尚無型號</TableCell></TableRow>
                    ) : orderedModels.map(m => (
                      <SortableModelRow
                        key={m.id}
                        model={m}
                        isEditing={editingId === m.id}
                        editName={editName}
                        editSort={editSort}
                        editNameError={editingId === m.id ? editNameError : null}
                        setEditName={setEditName}
                        setEditSort={setEditSort}
                        onStartEdit={() => startEdit(m)}
                        onCancelEdit={cancelEdit}
                        onSave={() => save(m.id)}
                        onRemove={() => remove(m)}
                        busy={busy}
                      />
                    ))}
                  </TableBody>
                </SortableContext>
              </DndContext>
            </Table>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>關閉</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SortableModelRow({
  model: m, isEditing, editName, editSort, editNameError, setEditName, setEditSort,
  onStartEdit, onCancelEdit, onSave, onRemove, busy,
}: {
  model: DeviceModel;
  isEditing: boolean;
  editName: string;
  editSort: string;
  editNameError: string | null;
  setEditName: (v: string) => void;
  setEditSort: (v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onRemove: () => void;
  busy: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: m.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <TableRow ref={setNodeRef} style={style}>
      <TableCell className="w-8">
        <button
          type="button"
          className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none"
          {...attributes}
          {...listeners}
          aria-label="拖曳排序"
        >
          <GripVertical className="w-4 h-4" />
        </button>
      </TableCell>
      <TableCell>
        {isEditing ? (
          <div className="space-y-1">
            <Input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              maxLength={100}
              aria-invalid={!!editNameError}
              className={editNameError ? "border-destructive focus-visible:ring-destructive" : ""}
            />
            {editNameError && (
              <p className="text-xs text-destructive">{editNameError}</p>
            )}
          </div>
        ) : (
          <span className="font-medium">{m.name}</span>
        )}
      </TableCell>
      <TableCell>
        {isEditing ? (
          <Input type="number" value={editSort} onChange={e => setEditSort(e.target.value)} />
        ) : (
          <span className="text-muted-foreground">{m.sort_order}</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        {isEditing ? (
          <div className="flex items-center justify-end gap-1">
            <Button size="sm" onClick={onSave} disabled={busy || !editName.trim() || !!editNameError}>儲存</Button>
            <Button size="sm" variant="ghost" onClick={onCancelEdit}>取消</Button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onStartEdit} title="編輯">
              <Pencil className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={onRemove} title="刪除">
              <Trash2 className="w-3.5 h-3.5 text-destructive" />
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}
