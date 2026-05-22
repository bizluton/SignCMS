import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { useIsSystemAdmin } from "@/hooks/useIsSystemAdmin";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription, DialogClose } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Cpu, Copy, Trash2, Ban, RotateCcw, Settings, Pencil, GripVertical, KeyRound, Check } from "lucide-react";
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
import { formatUserError } from "@/lib/formatUserError";

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

// ── Device capability metadata (Phase 1 of project↔device matching) ──
//   port.type ∈ PORT_TYPES; "Other" carries a free-form customLabel.
//   supported_output_modes is a subset of OUTPUT_MODE_KEYS.
type PortType = "HDMI" | "DP" | "Type-C" | "Browser" | "Other";
const PORT_TYPES: PortType[] = ["HDMI", "DP", "Type-C", "Browser", "Other"];

interface OutputPort {
  id:           string;
  label:        string;
  type:         PortType;
  customLabel?: string;   // only when type === "Other"
}

type OutputMode = "mirror" | "independent" | "extend" | "matrix";
const OUTPUT_MODE_OPTIONS: { key: OutputMode; label: string }[] = [
  { key: "mirror",      label: "鏡像 Mirror" },
  { key: "independent", label: "獨立 Independent" },
  { key: "extend",      label: "延伸 Extend" },
  { key: "matrix",      label: "矩陣 Matrix" },
];

interface DeviceBrand { id: string; name: string; sort_order: number }
interface DeviceModel {
  id:                     string;
  name:                   string;
  sort_order:             number;
  brand_id:               string | null;
  output_ports:           OutputPort[];
  supported_output_modes: OutputMode[];
  is_system:              boolean;
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


export default function DeviceLicenseManagement() {
  const { t } = useLanguage();
  const { isCsAgent } = useUserRole();
  const { isSystemAdmin } = useIsSystemAdmin();
  const canManage = isSystemAdmin || isCsAgent;

  const [rows, setRows]     = useState<DeviceLicense[]>([]);
  const [orgs, setOrgs]     = useState<OrgRow[]>([]);
  const [models, setModels] = useState<DeviceModel[]>([]);
  const [brands, setBrands] = useState<DeviceBrand[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen]       = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [saving, setSaving]   = useState(false);

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

  const fetchData = async () => {
    setLoading(true);
    const [
      { data: list },
      { data: orgsData },
      { data: modelsData },
      { data: brandsData },
    ] = await Promise.all([
      supabase.from("device_licenses").select("*").order("created_at", { ascending: false }),
      supabase.from("organizations").select("id, name").order("name"),
      supabase.from("device_models").select("*").order("sort_order").order("name"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).from("device_brands").select("id, name, sort_order").order("sort_order").order("name"),
    ]);
    setRows((list as DeviceLicense[]) || []);
    setOrgs((orgsData as OrgRow[]) || []);
    setModels((modelsData as DeviceModel[]) || []);
    setBrands((brandsData as DeviceBrand[]) || []);
    setLoading(false);
  };

  useEffect(() => { if (canManage) fetchData(); }, [canManage]);

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
    if (error) toast.error(formatUserError(error, t));
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
    if (error) toast.error(formatUserError(error, t));
    else if (data?.success === false) toast.error(ERROR_MAP[data.error] || data.error);
    else { toast.success("已撤銷"); fetchData(); }
  };

  const restore = async (id: string) => {
    const { data, error } = await supabase.rpc("restore_device_license", { _id: id });
    if (error) toast.error(formatUserError(error, t));
    else if (data?.success === false) toast.error(ERROR_MAP[data.error] || data.error);
    else { toast.success("已恢復為啟用"); fetchData(); }
  };

  const remove = async (id: string, label: string) => {
    if (!confirm(`確定要刪除設備授權 ${label} 嗎？此動作無法復原。`)) return;
    const { data, error } = await supabase.rpc("delete_device_license", { _id: id });
    if (error) toast.error(formatUserError(error, t));
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
          brands={brands}
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

    </div>
  );
}

// ── Helpers for default capability values ─────────────────────────────────
function defaultPorts(): OutputPort[] {
  return [{ id: `out_${Math.random().toString(36).slice(2, 8)}`, label: "Output 1", type: "HDMI" }];
}
function defaultModes(): OutputMode[] { return ["mirror"]; }
function newPortId(): string { return `out_${Math.random().toString(36).slice(2, 8)}`; }

// ── Sub-component: brand picker with inline "+ new brand" ────────────────
function BrandSelector({
  value, onChange, brands, onAddNew,
}: {
  value: string;
  onChange: (v: string) => void;
  brands: DeviceBrand[];
  onAddNew: () => void;
}) {
  return (
    <div className="space-y-1">
      <Select value={value || "_none"} onValueChange={(v) => onChange(v === "_none" ? "" : v)}>
        <SelectTrigger><SelectValue placeholder="產牌" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="_none">— 未指定 —</SelectItem>
          {brands.map((b) => (
            <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <button
        type="button"
        onClick={onAddNew}
        className="text-[11px] text-primary hover:underline ml-1"
      >+ 新增品牌</button>
    </div>
  );
}

// ── Sub-component: output ports editor (dynamic list) ──────────────────────
function PortsEditor({
  ports, onChange,
}: {
  ports: OutputPort[];
  onChange: (next: OutputPort[]) => void;
}) {
  const updateAt = (idx: number, patch: Partial<OutputPort>) => {
    const next = ports.slice();
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };
  const removeAt = (idx: number) => onChange(ports.filter((_, i) => i !== idx));
  const addOne   = () =>
    onChange([...ports, { id: newPortId(), label: `Output ${ports.length + 1}`, type: "HDMI" }]);

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">輸出埠</Label>
      <div className="space-y-1.5">
        {ports.map((p, i) => (
          <div key={p.id} className="flex gap-1.5 items-center">
            <Input
              value={p.label}
              onChange={(e) => updateAt(i, { label: e.target.value })}
              placeholder={`Output ${i + 1}`}
              className="flex-1 h-8 text-xs"
              maxLength={40}
            />
            <Select value={p.type} onValueChange={(v) => updateAt(i, { type: v as PortType })}>
              <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PORT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            {p.type === "Other" && (
              <Input
                value={p.customLabel ?? ""}
                onChange={(e) => updateAt(i, { customLabel: e.target.value })}
                placeholder="自訂類型"
                className="w-32 h-8 text-xs"
                maxLength={20}
              />
            )}
            <Button
              variant="ghost" size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive"
              onClick={() => removeAt(i)}
              disabled={ports.length <= 1}
              title={ports.length <= 1 ? "至少需保留 1 個輸出埠" : "刪除"}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        ))}
      </div>
      <Button variant="outline" size="sm" onClick={addOne} className="h-7 text-xs">
        <Plus className="w-3 h-3 mr-1" /> 新增輸出埠
      </Button>
    </div>
  );
}

// ── Sub-component: supported modes checkbox group ──────────────────────────
function ModesEditor({
  modes, onChange,
}: {
  modes: OutputMode[];
  onChange: (next: OutputMode[]) => void;
}) {
  const toggle = (k: OutputMode) =>
    onChange(modes.includes(k) ? modes.filter((m) => m !== k) : [...modes, k]);
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">支援的輸出模式（複選）</Label>
      <div className="flex flex-wrap gap-2">
        {OUTPUT_MODE_OPTIONS.map((o) => {
          const checked = modes.includes(o.key);
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => toggle(o.key)}
              className={`px-2.5 py-1 rounded border text-xs transition-colors ${
                checked
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-input hover:bg-muted"
              }`}
            >
              {checked ? <Check className="inline w-3 h-3 mr-1" /> : null}
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DeviceModelsDialog({
  open, onOpenChange, models, brands, onChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  models: DeviceModel[];
  brands: DeviceBrand[];
  onChanged: () => void;
}) {
  // ── "新增型號" form state (Phase 1: brand + ports + modes) ──
  const [newBrandId, setNewBrandId] = useState<string>("");
  const [newName,    setNewName]    = useState("");
  const [newSort,    setNewSort]    = useState("0");
  const [newPorts,   setNewPorts]   = useState<OutputPort[]>(defaultPorts());
  const [newModes,   setNewModes]   = useState<OutputMode[]>(defaultModes());

  // ── Edit-in-place state ──
  const [editingId,   setEditingId]   = useState<string | null>(null);
  const [editBrandId, setEditBrandId] = useState<string>("");
  const [editName,    setEditName]    = useState("");
  const [editSort,    setEditSort]    = useState("0");
  const [editPorts,   setEditPorts]   = useState<OutputPort[]>([]);
  const [editModes,   setEditModes]   = useState<OutputMode[]>([]);

  // ── Inline brand creator state ──
  const [addBrandOpen, setAddBrandOpen] = useState(false);
  const [addBrandName, setAddBrandName] = useState("");

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

  const startEdit  = (m: DeviceModel) => {
    setEditingId(m.id);
    setEditBrandId(m.brand_id ?? "");
    setEditName(m.name);
    setEditSort(String(m.sort_order));
    setEditPorts(Array.isArray(m.output_ports) && m.output_ports.length > 0 ? m.output_ports : defaultPorts());
    setEditModes(Array.isArray(m.supported_output_modes) && m.supported_output_modes.length > 0 ? m.supported_output_modes : defaultModes());
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditBrandId(""); setEditName(""); setEditSort("0");
    setEditPorts([]);   setEditModes([]);
  };

  const validateCapability = (ports: OutputPort[], modes: OutputMode[]): string | null => {
    if (ports.length === 0) return "至少需要 1 個輸出埠";
    if (modes.length === 0) return "至少需要 1 個支援的輸出模式";
    return null;
  };

  const add = async () => {
    const name = newName.trim();
    const nErr = validateName(name);
    if (nErr) { toast.error(nErr); return; }
    const cErr = validateCapability(newPorts, newModes);
    if (cErr) { toast.error(cErr); return; }
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("device_models").insert({
      name,
      sort_order:             parseInt(newSort) || 0,
      brand_id:               newBrandId || null,
      output_ports:           newPorts,
      supported_output_modes: newModes,
    });
    setBusy(false);
    if (error) {
      if (error.code === "23505") toast.error("此型號已存在");
      else toast.error(formatUserError(error, t));
    } else {
      toast.success("已新增型號");
      setNewBrandId(""); setNewName(""); setNewSort("0");
      setNewPorts(defaultPorts()); setNewModes(defaultModes());
      onChanged();
    }
  };

  const save = async (id: string) => {
    const name = editName.trim();
    const nErr = validateName(name, id);
    if (nErr) { toast.error(nErr); return; }
    const cErr = validateCapability(editPorts, editModes);
    if (cErr) { toast.error(cErr); return; }
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("device_models").update({
      name,
      sort_order:             parseInt(editSort) || 0,
      brand_id:               editBrandId || null,
      output_ports:           editPorts,
      supported_output_modes: editModes,
    }).eq("id", id);
    setBusy(false);
    if (error) {
      if (error.code === "23505") toast.error("此型號已存在");
      else toast.error(formatUserError(error, t));
    } else {
      toast.success("已更新");
      cancelEdit();
      onChanged();
    }
  };

  // Inline brand creator
  const submitNewBrand = async () => {
    const n = addBrandName.trim();
    if (!n) { toast.error("品牌名稱不可為空"); return; }
    if (n.length > 100) { toast.error("品牌名稱最多 100 字"); return; }
    if (brands.some((b) => b.name.toLowerCase() === n.toLowerCase())) {
      toast.error("此品牌已存在");
      return;
    }
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("device_brands")
      .insert({ name: n, sort_order: (brands[brands.length - 1]?.sort_order ?? 0) + 10 })
      .select("id, name, sort_order")
      .single();
    setBusy(false);
    if (error) {
      toast.error(formatUserError(error, t));
      return;
    }
    toast.success("已新增品牌");
    const created = data as DeviceBrand;
    if (editingId) setEditBrandId(created.id);
    else           setNewBrandId(created.id);
    setAddBrandOpen(false);
    setAddBrandName("");
    onChanged();
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
    if (error) toast.error(formatUserError(error, t));
    else { toast.success("已刪除"); onChanged(); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>管理設備型號</DialogTitle>
          <DialogDescription>
            設定設備的產牌、輸出埠與支援的輸出模式。Phase 3 之後排程／發佈中心會依此過濾相容螢幕。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* ── 新增型號 form ──────────────────────────────────────────── */}
          <div className="rounded-lg border p-4 space-y-3 bg-muted/30">
            <Label className="text-sm font-medium">新增型號</Label>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
              <div className="md:col-span-3">
                <BrandSelector
                  value={newBrandId}
                  onChange={setNewBrandId}
                  brands={brands}
                  onAddNew={() => setAddBrandOpen(true)}
                />
              </div>
              <div className="md:col-span-6 space-y-1">
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
                className="md:col-span-2"
              />
              <Button
                onClick={add}
                disabled={busy || !newName.trim() || !!newNameError}
                className="md:col-span-1"
              >
                <Plus className="w-4 h-4 mr-1" />新增
              </Button>
            </div>

            <PortsEditor ports={newPorts} onChange={setNewPorts} />
            <ModesEditor modes={newModes} onChange={setNewModes} />
          </div>

          {/* ── 型號清單 — cards layout（每張卡片可展開編輯）── */}
          <div className="space-y-2">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={orderedModels.map(m => m.id)} strategy={verticalListSortingStrategy}>
                {orderedModels.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8 rounded border bg-muted/20">尚無型號</p>
                ) : orderedModels.map(m => (
                  <SortableModelRow
                    key={m.id}
                    model={m}
                    brand={brands.find((b) => b.id === m.brand_id) ?? null}
                    brands={brands}
                    isEditing={editingId === m.id}
                    editBrandId={editBrandId}
                    editName={editName}
                    editSort={editSort}
                    editPorts={editPorts}
                    editModes={editModes}
                    editNameError={editingId === m.id ? editNameError : null}
                    setEditBrandId={setEditBrandId}
                    setEditName={setEditName}
                    setEditSort={setEditSort}
                    setEditPorts={setEditPorts}
                    setEditModes={setEditModes}
                    onStartEdit={() => startEdit(m)}
                    onCancelEdit={cancelEdit}
                    onSave={() => save(m.id)}
                    onRemove={() => remove(m)}
                    onAddBrand={() => setAddBrandOpen(true)}
                    busy={busy}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>關閉</Button>
        </DialogFooter>

        {/* ── Inline brand creator dialog ─────────────────────────────── */}
        <Dialog open={addBrandOpen} onOpenChange={setAddBrandOpen}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>新增品牌</DialogTitle>
              <DialogDescription>輸入新品牌的名稱，將立即可在「產牌」下拉中選擇。</DialogDescription>
            </DialogHeader>
            <Input
              placeholder="品牌名稱（例：Bizlution）"
              value={addBrandName}
              onChange={(e) => setAddBrandName(e.target.value)}
              maxLength={100}
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") void submitNewBrand(); }}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => { setAddBrandOpen(false); setAddBrandName(""); }}>取消</Button>
              <Button onClick={submitNewBrand} disabled={busy || !addBrandName.trim()}>
                <Plus className="w-4 h-4 mr-1" />新增
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

// Each model is now a card. Collapsed: brand badge + name + sort + capability
// summary badges (port count + supported modes). Expanded (editing): all
// fields inline including BrandSelector / PortsEditor / ModesEditor.
function SortableModelRow({
  model: m, brand, brands,
  isEditing,
  editBrandId, editName, editSort, editPorts, editModes, editNameError,
  setEditBrandId, setEditName, setEditSort, setEditPorts, setEditModes,
  onStartEdit, onCancelEdit, onSave, onRemove, onAddBrand, busy,
}: {
  model:       DeviceModel;
  brand:       DeviceBrand | null;
  brands:      DeviceBrand[];
  isEditing:   boolean;
  editBrandId: string;
  editName:    string;
  editSort:    string;
  editPorts:   OutputPort[];
  editModes:   OutputMode[];
  editNameError: string | null;
  setEditBrandId: (v: string) => void;
  setEditName:    (v: string) => void;
  setEditSort:    (v: string) => void;
  setEditPorts:   (v: OutputPort[]) => void;
  setEditModes:   (v: OutputMode[]) => void;
  onStartEdit:    () => void;
  onCancelEdit:   () => void;
  onSave:         () => void;
  onRemove:       () => void;
  onAddBrand:     () => void;
  busy:           boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: m.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const ports = Array.isArray(m.output_ports) ? m.output_ports : [];
  const modes = Array.isArray(m.supported_output_modes) ? m.supported_output_modes : [];

  return (
    <div ref={setNodeRef} style={style} className="rounded-lg border bg-card">
      {/* Collapsed header — always visible */}
      <div className="flex items-center gap-2 p-3">
        <button
          type="button"
          className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none shrink-0"
          {...attributes}
          {...listeners}
          aria-label="拖曳排序"
        >
          <GripVertical className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
          {brand && (
            <Badge variant="outline" className="text-[10px] shrink-0">{brand.name}</Badge>
          )}
          <span className="font-medium text-sm truncate">{m.name}</span>
          <span className="text-[11px] text-muted-foreground shrink-0">#{m.sort_order}</span>
          {!isEditing && (
            <>
              <span className="text-[11px] text-muted-foreground ml-1 shrink-0">
                {ports.length} 埠
              </span>
              <div className="flex gap-1 flex-wrap">
                {modes.map((mk) => (
                  <Badge key={mk} variant="secondary" className="text-[10px]">
                    {OUTPUT_MODE_OPTIONS.find((o) => o.key === mk)?.label.split(" ")[0] ?? mk}
                  </Badge>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isEditing ? (
            <>
              <Button size="sm" onClick={onSave} disabled={busy || !editName.trim() || !!editNameError}>儲存</Button>
              <Button size="sm" variant="ghost" onClick={onCancelEdit}>取消</Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onStartEdit} title="編輯">
                <Pencil className="w-3.5 h-3.5" />
              </Button>
              {!m.is_system && (
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={onRemove} title="刪除">
                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Expanded edit form */}
      {isEditing && (
        <div className="border-t p-3 space-y-3 bg-muted/20">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
            <div className="md:col-span-3">
              <BrandSelector
                value={editBrandId}
                onChange={setEditBrandId}
                brands={brands}
                onAddNew={onAddBrand}
              />
            </div>
            <div className="md:col-span-7 space-y-1">
              <Input
                value={editName}
                onChange={e => setEditName(e.target.value)}
                maxLength={100}
                aria-invalid={!!editNameError}
                className={editNameError ? "border-destructive focus-visible:ring-destructive" : ""}
              />
              {editNameError && <p className="text-xs text-destructive">{editNameError}</p>}
            </div>
            <Input
              type="number"
              value={editSort}
              onChange={e => setEditSort(e.target.value)}
              className="md:col-span-2"
            />
          </div>

          <PortsEditor ports={editPorts} onChange={setEditPorts} />
          <ModesEditor modes={editModes} onChange={setEditModes} />
        </div>
      )}
    </div>
  );
}
