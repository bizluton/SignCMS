import { useEffect, useState } from "react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, Plus, Pencil, Trash2, Code2 } from "lucide-react";
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

export default function WidgetManagement() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { isSystemAdmin } = useIsSystemAdmin();

  const [rows, setRows] = useState<WidgetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<WidgetRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
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
        <div className="flex justify-end">
          <Button size="sm" onClick={openCreate} className="gap-1.5">
            <Plus className="w-4 h-4" />{t("widgetMgmtCreate")}
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">{t("widgetMgmtEmpty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("widgetMgmtName")}</TableHead>
                <TableHead>{t("widgetMgmtType")}</TableHead>
                <TableHead className="w-24">{t("widgetMgmtOrder")}</TableHead>
                <TableHead className="w-28 text-right">{t("widgetMgmtActions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {Object.entries(r.name_i18n || {}).map(([k, v]) => `${k}:${v}`).join(" · ")}
                    </div>
                  </TableCell>
                  <TableCell><Badge variant="secondary">{r.widget_type}</Badge></TableCell>
                  <TableCell>{r.sort_order}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(r)}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteId(r.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

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

            <div>
              <Label>{t("widgetMgmtOrder")}</Label>
              <Input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} />
            </div>

            <div>
              <Label>{t("widgetMgmtThumbnail")}</Label>
              <Input value={form.thumbnail} onChange={(e) => setForm({ ...form, thumbnail: e.target.value })} placeholder="https://..." />
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
