import { useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useIsSystemAdmin } from "@/hooks/useIsSystemAdmin";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Loader2, Plus, Trash2, Code2, Settings, Upload,
  Clock, Calendar, Globe, AlignLeft, QrCode, Timer, Play, Cloud,
} from "lucide-react";
import { logActivity } from "@/lib/activityLogger";

interface WidgetRow {
  id: string;
  scope: "system" | "app" | "user";
  name: string;
  name_i18n: Record<string, string>;
  widget_type: string;
  config: Record<string, unknown>;
  thumbnail: string;
  app_id: string | null;
  org_id: string | null;
  sort_order: number;
  created_at: string;
}

const WIDGET_TYPES = [
  "clock", "date", "webpage", "marquee",
  "qrcode", "countdown", "youtube", "weather",
];

const WIDGET_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  clock: Clock, date: Calendar, webpage: Globe, marquee: AlignLeft,
  qrcode: QrCode, countdown: Timer, youtube: Play, weather: Cloud,
};

const THUMBNAIL_MAX_BYTES = 200 * 1024; // 200 KB

const emptyForm = {
  name: "",
  name_zh: "",
  name_en: "",
  name_ja: "",
  widget_type: "clock",
  config_json: "{}",
  thumbnail: "",
  sort_order: 0,
};

// ── Widget Card ──────────────────────────────────────────────────────────────
function WidgetCard({
  row,
  onEdit,
  onDelete,
}: {
  row: WidgetRow;
  onEdit: (r: WidgetRow) => void;
  onDelete: (id: string) => void;
}) {
  const Icon = WIDGET_ICONS[row.widget_type] ?? Code2;
  return (
    <div className="group relative rounded-xl border bg-card overflow-hidden hover:shadow-md transition-all">
      {/* Thumbnail / icon area */}
      <div className="aspect-video relative overflow-hidden bg-muted">
        {row.thumbnail ? (
          <img
            src={row.thumbnail}
            alt={row.name}
            className="w-full h-full object-cover"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
            <Icon className="w-9 h-9 text-slate-400" />
          </div>
        )}
        {/* Action buttons — appear on hover */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="secondary"
            size="icon"
            className="h-7 w-7 shadow-sm"
            onClick={() => onEdit(row)}
            title="設定"
          >
            <Settings className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="destructive"
            size="icon"
            className="h-7 w-7 shadow-sm"
            onClick={() => onDelete(row.id)}
            title="刪除"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
      {/* Footer */}
      <div className="px-3 py-2.5 flex items-center justify-between gap-2">
        <span className="text-sm font-medium truncate leading-tight">{row.name}</span>
        <Badge variant="secondary" className="text-xs shrink-0">{row.widget_type}</Badge>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export default function WidgetManagement() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { isSystemAdmin } = useIsSystemAdmin();
  const zipInputRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<WidgetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<WidgetRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("widgets")
      .select("id, scope, name, name_i18n, widget_type, config, thumbnail, app_id, org_id, sort_order, created_at")
      .eq("scope", "system")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setRows((data || []) as WidgetRow[]);
    setLoading(false);
  };

  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // ── Zip import ─────────────────────────────────────────────────────────────
  const handleZipFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      toast.error("請選擇 .zip 檔案");
      return;
    }
    setImporting(true);
    try {
      const zip = await JSZip.loadAsync(file);

      // Read manifest.json
      const manifestFile = zip.file("manifest.json");
      if (!manifestFile) {
        toast.error(t("widgetMgmtZipNoManifest"));
        return;
      }
      let manifest: Record<string, unknown>;
      try {
        manifest = JSON.parse(await manifestFile.async("string")) as Record<string, unknown>;
      } catch {
        toast.error(t("widgetMgmtZipInvalidManifest"));
        return;
      }

      const name = (manifest.name as string)?.trim();
      const widgetType = (manifest.widget_type as string)?.trim();
      const config = manifest.config;

      if (!name || !widgetType || !config || typeof config !== "object") {
        toast.error(t("widgetMgmtZipInvalidManifest"));
        return;
      }
      if (!WIDGET_TYPES.includes(widgetType)) {
        toast.error(`${t("widgetMgmtZipInvalidType")}: ${widgetType}`);
        return;
      }

      // Optional thumbnail — first matching image file at root
      let thumbnail = "";
      const thumbEntry = zip.file(/^thumbnail\.(png|jpe?g|webp)$/i)[0];
      if (thumbEntry) {
        const blob = await thumbEntry.async("blob");
        if (blob.size > THUMBNAIL_MAX_BYTES) {
          toast.warning(t("widgetMgmtZipThumbnailSkipped"));
        } else {
          thumbnail = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
        }
      }

      // name_i18n — optional; fall back to name
      const rawI18n = manifest.name_i18n as Record<string, string> | undefined;
      const name_i18n = {
        zh: rawI18n?.zh?.trim() || name,
        en: rawI18n?.en?.trim() || name,
        ja: rawI18n?.ja?.trim() || name,
      };

      const payload = {
        scope: "system",
        name,
        name_i18n,
        widget_type: widgetType,
        config: config as Record<string, unknown>,
        thumbnail,
        app_id: null,
        sort_order: Number(manifest.sort_order) || 0,
        created_by: user?.id,
      };

      const { error } = await supabase.from("widgets").insert(payload);
      if (error) {
        toast.error(error.message);
      } else {
        toast.success(`${t("widgetMgmtZipImported")}：${name}`);
        logActivity({ action: "create_widget", category: "admin", targetName: name });
        reload();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
      if (zipInputRef.current) zipInputRef.current.value = "";
    }
  };

  // ── Create / Edit ──────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setDialogOpen(true);
  };

  const openEdit = (row: WidgetRow) => {
    setEditing(row);
    const i = row.name_i18n || {};
    setForm({
      name: row.name,
      name_zh: i.zh || "",
      name_en: i.en || "",
      name_ja: i.ja || "",
      widget_type: row.widget_type,
      config_json: JSON.stringify(row.config || {}, null, 2),
      thumbnail: row.thumbnail || "",
      sort_order: row.sort_order ?? 0,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error(t("widgetMgmtNameRequired")); return; }
    let config: Record<string, unknown>;
    try { config = JSON.parse(form.config_json) as Record<string, unknown>; }
    catch { toast.error(t("widgetMgmtInvalidJson")); return; }

    setSaving(true);
    const payload: Record<string, unknown> = {
      scope: "system",
      name: form.name.trim(),
      name_i18n: {
        zh: form.name_zh.trim() || form.name.trim(),
        en: form.name_en.trim() || form.name.trim(),
        ja: form.name_ja.trim() || form.name.trim(),
      },
      widget_type: form.widget_type,
      config,
      thumbnail: form.thumbnail.trim(),
      app_id: null,
      sort_order: Number(form.sort_order) || 0,
    };

    if (editing) {
      const { error } = await supabase.from("widgets").update(payload).eq("id", editing.id);
      if (error) toast.error(error.message);
      else {
        toast.success(t("widgetMgmtUpdated"));
        logActivity({ action: "update_widget", category: "admin", targetName: payload.name });
        setDialogOpen(false);
        reload();
      }
    } else {
      const { error } = await supabase.from("widgets").insert({ ...payload, created_by: user?.id });
      if (error) toast.error(error.message);
      else {
        toast.success(t("widgetMgmtCreated"));
        logActivity({ action: "create_widget", category: "admin", targetName: payload.name });
        setDialogOpen(false);
        reload();
      }
    }
    setSaving(false);
  };

  // ── Delete ─────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteId) return;
    const row = rows.find((r) => r.id === deleteId);
    const { error } = await supabase.from("widgets").delete().eq("id", deleteId);
    if (error) toast.error(error.message);
    else {
      toast.success(t("widgetMgmtDeleted"));
      logActivity({ action: "delete_widget", category: "admin", targetName: row?.name || "" });
      reload();
    }
    setDeleteId(null);
  };

  if (!isSystemAdmin) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          {t("widgetMgmtSystemAdminOnly")}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Code2 className="w-5 h-5" />
          {t("widgetMgmtTitle")}
        </CardTitle>
        <CardDescription>{t("widgetMgmtDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Toolbar */}
        <div className="flex items-center justify-end gap-2">
          {/* Hidden zip input */}
          <input
            ref={zipInputRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleZipFile(f);
            }}
          />
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={importing}
            onClick={() => zipInputRef.current?.click()}
          >
            {importing
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Upload className="w-4 h-4" />}
            {t("widgetMgmtUploadZip")}
          </Button>
          <Button size="sm" onClick={openCreate} className="gap-1.5">
            <Plus className="w-4 h-4" />{t("widgetMgmtCreate")}
          </Button>
        </div>

        {/* Card grid */}
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-14 text-muted-foreground">
            <Code2 className="w-10 h-10 opacity-30" />
            <p className="text-sm">{t("widgetMgmtEmpty")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {rows.map((r) => (
              <WidgetCard key={r.id} row={r} onEdit={openEdit} onDelete={setDeleteId} />
            ))}
          </div>
        )}
      </CardContent>

      {/* Edit / Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? t("widgetMgmtEditTitle") : t("widgetMgmtCreateTitle")}</DialogTitle>
            <DialogDescription>{t("widgetMgmtDialogDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("widgetMgmtName")} *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <Label>{t("widgetMgmtType")}</Label>
                <Select value={form.widget_type} onValueChange={(v) => setForm({ ...form, widget_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {WIDGET_TYPES.map((wt) => <SelectItem key={wt} value={wt}>{wt}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>{t("widgetMgmtNameZh")}</Label>
                <Input value={form.name_zh} onChange={(e) => setForm({ ...form, name_zh: e.target.value })} />
              </div>
              <div>
                <Label>{t("widgetMgmtNameEn")}</Label>
                <Input value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} />
              </div>
              <div>
                <Label>{t("widgetMgmtNameJa")}</Label>
                <Input value={form.name_ja} onChange={(e) => setForm({ ...form, name_ja: e.target.value })} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("widgetMgmtOrder")}</Label>
                <Input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label>{t("widgetMgmtThumbnail")}</Label>
                <Input
                  value={form.thumbnail}
                  onChange={(e) => setForm({ ...form, thumbnail: e.target.value })}
                  placeholder="https://..."
                />
              </div>
            </div>

            {/* Thumbnail preview */}
            {form.thumbnail && (
              <div className="rounded-lg overflow-hidden border w-full aspect-video bg-muted">
                <img
                  src={form.thumbnail}
                  alt="thumbnail preview"
                  className="w-full h-full object-cover"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                />
              </div>
            )}

            <div>
              <Label>{t("widgetMgmtConfig")} (JSON)</Label>
              <Textarea
                value={form.config_json}
                onChange={(e) => setForm({ ...form, config_json: e.target.value })}
                className="font-mono text-xs min-h-[200px]"
              />
              <p className="text-xs text-muted-foreground mt-1">{t("widgetMgmtConfigHint")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>{t("cancel")}</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("widgetMgmtDeleteConfirm")}</AlertDialogTitle>
            <AlertDialogDescription>{t("widgetMgmtDeleteDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
