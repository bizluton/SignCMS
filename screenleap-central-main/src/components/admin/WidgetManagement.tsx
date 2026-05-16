import { useCallback, useEffect, useRef, useState } from "react";
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
  Clock, Calendar, Globe, AlignLeft, QrCode, Timer, Play, Cloud, MapPin, Eye,
} from "lucide-react";
import { logActivity } from "@/lib/activityLogger";
import { WidgetPreviewCard } from "@/components/widgets/WidgetPreviewCard";
import type { WidgetConfig } from "@/components/widgets/WidgetPreviewCard";
import { APP_DEFINITIONS } from "@/contexts/InstalledAppsContext";

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
  "qrcode", "countdown", "youtube", "weather", "weather_tw",
];

const WIDGET_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  clock: Clock, date: Calendar, webpage: Globe, marquee: AlignLeft,
  qrcode: QrCode, countdown: Timer, youtube: Play, weather: Cloud, weather_tw: MapPin,
};

const THUMBNAIL_MAX_BYTES = 200 * 1024; // 200 KB

interface OrgOption { id: string; name: string; }

interface ExclusionRow {
  id: string;
  widget_id: string;
  org_id: string;
  widgetName: string;
  orgName: string;
}

const emptyForm = {
  name: "",
  name_zh: "",
  name_en: "",
  name_ja: "",
  widget_type: "clock",
  config_json: "{}",
  thumbnail: "",
  sort_order: 0,
  scope: "system" as "system" | "app" | "custom" | "user",
  org_id: "",
  app_id: "",
};

// ── Widget Card ──────────────────────────────────────────────────────────────
function WidgetCard({
  row,
  orgName,
  onEdit,
  onDelete,
}: {
  row: WidgetRow;
  orgName?: string;
  onEdit: (r: WidgetRow) => void;
  onDelete: (id: string) => void;
}) {
  const Icon = WIDGET_ICONS[row.widget_type] ?? Code2;
  return (
    <div className="group relative rounded-xl border bg-card overflow-hidden hover:shadow-md transition-all">
      {/* Live preview area */}
      <div className="aspect-video relative overflow-hidden bg-muted">
        <WidgetPreviewCard config={{ ...row.config, widgetType: row.widget_type } as WidgetConfig} />
        {/* Org badge on user-scope cards */}
        {row.scope === "user" && orgName && (
          <div className="absolute top-2 left-2">
            <Badge className="text-[10px] py-0 px-1.5 bg-amber-500/90 text-white border-0">{orgName}</Badge>
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
            <Trash2 className="w-3.5 h-3.5 text-destructive" />
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
  const thumbInputRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<WidgetRow[]>([]);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [exclusions, setExclusions] = useState<ExclusionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<WidgetRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const loadOrgs = useCallback(async () => {
    const { data } = await supabase.from("organizations").select("id, name").order("name");
    setOrgs((data || []) as OrgOption[]);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("widgets")
      .select("id, scope, name, name_i18n, widget_type, config, thumbnail, app_id, org_id, sort_order, created_at")
      .order("scope", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setRows((data || []) as WidgetRow[]);
    setLoading(false);
  }, []);

  const loadExclusions = useCallback(async () => {
    const { data } = await supabase
      .from("widget_org_exclusions")
      .select("id, widget_id, org_id, widgets(name), organizations(name)")
      .order("org_id");
    setExclusions(
      (data || []).map((r: Record<string, unknown>) => ({
        id: r.id as string,
        widget_id: r.widget_id as string,
        org_id: r.org_id as string,
        widgetName: (r.widgets as { name: string } | null)?.name ?? r.widget_id as string,
        orgName: (r.organizations as { name: string } | null)?.name ?? r.org_id as string,
      }))
    );
  }, []);

  const handleRemoveExclusion = async (exclusionId: string) => {
    const { error } = await supabase.from("widget_org_exclusions").delete().eq("id", exclusionId);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success(t("widgetMgmtExclRemoved"));
      loadExclusions();
    }
  };

  useEffect(() => { reload(); loadOrgs(); loadExclusions(); }, [reload, loadOrgs, loadExclusions]);

  // ── Zip import ─────────────────────────────────────────────────────────────
  const handleZipFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      toast.error("請選擇 .zip 檔案");
      return;
    }
    setImporting(true);
    try {
      const zip = await JSZip.loadAsync(file);

      // Read manifest.json (search root and one level deep)
      const manifestEntry =
        zip.file("manifest.json") ??
        zip.file(/(?:^|\/)[^/]+\/manifest\.json$/)[0] ??
        null;
      if (!manifestEntry) {
        toast.error(t("widgetMgmtZipNoManifest"));
        return;
      }
      let manifest: Record<string, unknown>;
      try {
        manifest = JSON.parse(await manifestEntry.async("string")) as Record<string, unknown>;
      } catch {
        toast.error(t("widgetMgmtZipInvalidManifest"));
        return;
      }

      const name = (manifest.name as string)?.trim();
      const htmlFilePath = (manifest.html_file as string | undefined)?.trim();
      // widget_type defaults to "webpage" when an html_file is declared
      const widgetType = ((manifest.widget_type as string)?.trim()) || (htmlFilePath ? "webpage" : "");
      let config = manifest.config as Record<string, unknown> | undefined;

      if (!name || !widgetType) {
        toast.error(t("widgetMgmtZipInvalidManifest"));
        return;
      }
      if (!WIDGET_TYPES.includes(widgetType)) {
        toast.error(`${t("widgetMgmtZipInvalidType")}: ${widgetType}`);
        return;
      }
      if (!config || typeof config !== "object") config = {};

      // ── Upload embedded HTML file to Supabase Storage ──────────────────
      let htmlPublicUrl = "";
      if (htmlFilePath) {
        const htmlEntry =
          zip.file(htmlFilePath) ??
          zip.file(new RegExp(`(^|/)${htmlFilePath.split("/").pop()}$`))[0] ??
          null;
        if (htmlEntry) {
          const htmlBytes = await htmlEntry.async("arraybuffer");
          const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
          const storagePath = `widget-assets/${slug}-${Date.now()}.html`;
          const { error: uploadErr } = await supabase.storage
            .from("media")
            .upload(storagePath, htmlBytes, {
              contentType: "text/html; charset=utf-8",
              cacheControl: "31536000",
              upsert: false,
            });
          if (uploadErr) {
            toast.error(`HTML upload failed: ${uploadErr.message}`);
            return;
          }
          const { data: pub } = supabase.storage.from("media").getPublicUrl(storagePath);
          htmlPublicUrl = pub.publicUrl;
        }
      }

      // Replace {{html_url}} placeholder anywhere in config values
      const resolveUrl = (val: unknown): unknown => {
        if (typeof val === "string") return val.replace(/\{\{html_url\}\}/g, htmlPublicUrl);
        if (Array.isArray(val)) return val.map(resolveUrl);
        if (val !== null && typeof val === "object") {
          return Object.fromEntries(
            Object.entries(val as Record<string, unknown>).map(([k, v]) => [k, resolveUrl(v)])
          );
        }
        return val;
      };
      config = resolveUrl(config) as Record<string, unknown>;

      // If html was uploaded but config.url still empty, auto-set it
      if (htmlPublicUrl && !config.url) config = { ...config, url: htmlPublicUrl };
      // Ensure widgetType inside config is populated
      if (!config.widgetType) config = { ...config, widgetType };

      // ── Params schema (configurable parameters for HTML widgets) ───────
      if (Array.isArray(manifest.params) && manifest.params.length > 0) {
        config = { ...config, paramsSchema: manifest.params };
        const defaultParams: Record<string, unknown> = {};
        for (const p of manifest.params as Array<{ key?: string; default?: unknown }>) {
          if (p.key) defaultParams[p.key] = p.default ?? "";
        }
        config = { ...config, params: defaultParams };
      }

      // ── Thumbnail ──────────────────────────────────────────────────────
      let thumbnail = "";
      const thumbEntry = zip.file(/(?:^|\/)thumbnail\.(png|jpe?g|webp)$/i)[0];
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

      // ── name_i18n ──────────────────────────────────────────────────────
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
        config,
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

  // ── Thumbnail file upload ──────────────────────────────────────────────────
  const handleThumbFile = (file: File) => {
    if (file.size > THUMBNAIL_MAX_BYTES) {
      toast.error(t("widgetMgmtThumbTooBig"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, thumbnail: reader.result as string }));
    reader.readAsDataURL(file);
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
      scope: row.scope === "user" ? "user" : "system",
      org_id: row.org_id || "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error(t("widgetMgmtNameRequired")); return; }
    if (form.scope === "user" && !form.org_id) { toast.error(t("widgetMgmtOrgRequired")); return; }
    if (form.scope === "app" && !form.app_id) { toast.error(t("widgetMgmtAppRequired")); return; }
    let config: Record<string, unknown>;
    try { config = JSON.parse(form.config_json) as Record<string, unknown>; }
    catch { toast.error(t("widgetMgmtInvalidJson")); return; }

    setSaving(true);
    const payload: Record<string, unknown> = {
      scope: form.scope,
      name: form.name.trim(),
      name_i18n: {
        zh: form.name_zh.trim() || form.name.trim(),
        en: form.name_en.trim() || form.name.trim(),
        ja: form.name_ja.trim() || form.name.trim(),
      },
      widget_type: form.widget_type,
      config,
      thumbnail: form.thumbnail.trim(),
      app_id: form.scope === "app" ? (form.app_id || null) : null,
      org_id: form.scope === "user" ? form.org_id : null,
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
              <WidgetCard
                key={r.id}
                row={r}
                orgName={r.org_id ? (orgs.find((o) => o.id === r.org_id)?.name ?? r.org_id) : undefined}
                onEdit={openEdit}
                onDelete={setDeleteId}
              />
            ))}
          </div>
        )}

        {/* Org exclusions section */}
        {exclusions.length > 0 && (
          <div className="space-y-2 pt-2 border-t">
            <div>
              <p className="text-sm font-medium">{t("widgetMgmtExclTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("widgetMgmtExclDesc")}</p>
            </div>
            <div className="divide-y rounded-md border">
              {exclusions.map((ex) => (
                <div key={ex.id} className="flex items-center justify-between px-3 py-2 gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Code2 className="w-4 h-4 shrink-0 text-muted-foreground" />
                    <span className="text-sm font-medium truncate">{ex.widgetName}</span>
                    <span className="text-xs text-muted-foreground shrink-0">→ {ex.orgName}</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 shrink-0"
                    onClick={() => handleRemoveExclusion(ex.id)}
                  >
                    <Eye className="w-3.5 h-3.5" />
                    {t("widgetMgmtExclRemove")}
                  </Button>
                </div>
              ))}
            </div>
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
            {/* Visibility (scope) */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("widgetMgmtScope")}</Label>
                <Select
                  value={form.scope}
                  onValueChange={(v) => setForm({ ...form, scope: v as "system" | "app" | "custom" | "user", org_id: "", app_id: "" })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="system">{t("widgetMgmtScopeSystem")}</SelectItem>
                    <SelectItem value="app">{t("widgetMgmtScopeApp")}</SelectItem>
                    <SelectItem value="custom">{t("widgetMgmtScopeCustom")}</SelectItem>
                    <SelectItem value="user">{t("widgetMgmtScopeOrg")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.scope === "app" && (
                <div>
                  <Label>{t("widgetMgmtAppId")} *</Label>
                  <Select value={form.app_id} onValueChange={(v) => setForm({ ...form, app_id: v })}>
                    <SelectTrigger><SelectValue placeholder={t("widgetMgmtAppRequired")} /></SelectTrigger>
                    <SelectContent>
                      {APP_DEFINITIONS.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.name.zh} ({a.id})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {form.scope === "user" && (
                <div>
                  <Label>{t("widgetMgmtOrg")} *</Label>
                  <Select value={form.org_id} onValueChange={(v) => setForm({ ...form, org_id: v })}>
                    <SelectTrigger><SelectValue placeholder={t("widgetMgmtOrgRequired")} /></SelectTrigger>
                    <SelectContent>
                      {orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

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

            <div>
              <Label>{t("widgetMgmtOrder")}</Label>
              <Input
                type="number"
                value={form.sort_order}
                onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
                className="w-32"
              />
            </div>

            {/* Thumbnail upload */}
            <div className="space-y-2">
              <Label>{t("widgetMgmtThumbnail")}</Label>
              <input
                ref={thumbInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleThumbFile(f); if (thumbInputRef.current) thumbInputRef.current.value = ""; }}
              />
              {form.thumbnail ? (
                <div className="relative rounded-lg overflow-hidden border w-full aspect-video bg-muted group">
                  <img
                    src={form.thumbnail}
                    alt="thumbnail preview"
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                    <Button size="sm" variant="secondary" onClick={() => thumbInputRef.current?.click()}>
                      <Upload className="w-3.5 h-3.5 mr-1" />{t("widgetMgmtUploadThumb")}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => setForm((f) => ({ ...f, thumbnail: "" }))}>
                      {t("widgetMgmtClearThumb")}
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => thumbInputRef.current?.click()}
                  className="w-full aspect-video rounded-lg border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center gap-2 text-muted-foreground hover:border-muted-foreground/60 hover:bg-muted/50 transition-colors"
                >
                  <Upload className="w-6 h-6" />
                  <span className="text-sm">{t("widgetMgmtUploadThumb")}</span>
                </button>
              )}
            </div>

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
