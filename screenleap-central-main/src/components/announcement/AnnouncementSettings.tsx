import { useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Settings, Plus, Trash2, Building2, Tag } from "lucide-react";
import { toast } from "sonner";

export interface LabelItem {
  value: string;
  label: { zh: string; en: string; ja: string };
}

export interface DbCategory {
  id: string;
  name: string;
  color: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  departments: LabelItem[];
  onDepartmentsChange: (items: LabelItem[]) => void;
  categories: DbCategory[];
  onAddCategory: (name: string, color: string) => Promise<void>;
  onDeleteCategory: (id: string) => Promise<void>;
}

const AnnouncementSettings = ({
  open, onOpenChange,
  departments, onDepartmentsChange,
  categories, onAddCategory, onDeleteCategory,
}: Props) => {
  const { language } = useLanguage();

  const [newDeptZh, setNewDeptZh] = useState("");
  const [newDeptEn, setNewDeptEn] = useState("");
  const [newDeptJa, setNewDeptJa] = useState("");

  const [newCatName, setNewCatName] = useState("");
  const [newCatColor, setNewCatColor] = useState("#6b7280");
  const [catSaving, setCatSaving] = useState(false);

  const texts = {
    title:          { zh: "系統設定",        en: "Settings",          ja: "設定" },
    deptTab:        { zh: "發佈單位維護",     en: "Departments",       ja: "部署管理" },
    catTab:         { zh: "公告類別維護",     en: "Categories",        ja: "カテゴリ管理" },
    colNameZh:      { zh: "中文",            en: "Chinese",           ja: "中国語" },
    colNameEn:      { zh: "英文",            en: "English",           ja: "英語" },
    colNameJa:      { zh: "日文",            en: "Japanese",          ja: "日本語" },
    colName:        { zh: "名稱",            en: "Name",              ja: "名前" },
    colColor:       { zh: "顏色",            en: "Color",             ja: "カラー" },
    colActions:     { zh: "操作",            en: "Actions",           ja: "操作" },
    addDept:        { zh: "新增單位",         en: "Add Department",    ja: "部署を追加" },
    addCat:         { zh: "新增類別",         en: "Add Category",      ja: "カテゴリを追加" },
    placeholderZh:  { zh: "中文名稱",         en: "Chinese name",      ja: "中国語名" },
    placeholderEn:  { zh: "英文名稱",         en: "English name",      ja: "英語名" },
    placeholderJa:  { zh: "日文名稱",         en: "Japanese name",     ja: "日本語名" },
    catNamePh:      { zh: "類別名稱",         en: "Category name",     ja: "カテゴリ名" },
    added:          { zh: "已新增",           en: "Added",             ja: "追加しました" },
    deleted:        { zh: "已刪除",           en: "Deleted",           ja: "削除しました" },
    fillRequired:   { zh: "請至少填寫中文名稱", en: "Chinese name required", ja: "中国語名を入力してください" },
    catFillRequired:{ zh: "請填寫類別名稱",   en: "Category name required", ja: "カテゴリ名を入力してください" },
  };

  const t = (key: keyof typeof texts) => texts[key][language];

  const handleAddDept = () => {
    if (!newDeptZh.trim()) { toast.error(t("fillRequired")); return; }
    const value = `dept_${Date.now()}`;
    onDepartmentsChange([...departments, {
      value,
      label: { zh: newDeptZh.trim(), en: newDeptEn.trim() || newDeptZh.trim(), ja: newDeptJa.trim() || newDeptZh.trim() },
    }]);
    setNewDeptZh(""); setNewDeptEn(""); setNewDeptJa("");
    toast.success(t("added"));
  };

  const handleDeleteDept = (value: string) => {
    onDepartmentsChange(departments.filter((d) => d.value !== value));
    toast.success(t("deleted"));
  };

  const handleAddCat = async () => {
    if (!newCatName.trim()) { toast.error(t("catFillRequired")); return; }
    setCatSaving(true);
    try {
      await onAddCategory(newCatName.trim(), newCatColor);
      setNewCatName(""); setNewCatColor("#6b7280");
      toast.success(t("added"));
    } finally {
      setCatSaving(false);
    }
  };

  const handleDeleteCat = async (id: string) => {
    await onDeleteCategory(id);
    toast.success(t("deleted"));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl flex items-center gap-2">
            <Settings className="h-5 w-5" />
            {t("title")}
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="departments" className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="departments" className="flex-1 gap-2">
              <Building2 className="h-4 w-4" />{t("deptTab")}
            </TabsTrigger>
            <TabsTrigger value="categories" className="flex-1 gap-2">
              <Tag className="h-4 w-4" />{t("catTab")}
            </TabsTrigger>
          </TabsList>

          {/* ── Departments (localStorage) ── */}
          <TabsContent value="departments" className="space-y-4 mt-4">
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-sm">{t("colNameZh")}</TableHead>
                    <TableHead className="text-sm">{t("colNameEn")}</TableHead>
                    <TableHead className="text-sm">{t("colNameJa")}</TableHead>
                    <TableHead className="text-sm text-right w-[72px]">{t("colActions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {departments.map((d) => (
                    <TableRow key={d.value}>
                      <TableCell className="text-sm font-medium">{d.label.zh}</TableCell>
                      <TableCell className="text-sm">{d.label.en}</TableCell>
                      <TableCell className="text-sm">{d.label.ja}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => handleDeleteDept(d.value)}
                          className="text-destructive hover:text-destructive h-8 w-8 p-0">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="space-y-3 p-4 border border-dashed border-border rounded-xl">
              <Label className="text-sm font-semibold">{t("addDept")}</Label>
              <div className="grid grid-cols-3 gap-2">
                <Input value={newDeptZh} onChange={(e) => setNewDeptZh(e.target.value)} placeholder={t("placeholderZh")} className="h-10 text-sm" />
                <Input value={newDeptEn} onChange={(e) => setNewDeptEn(e.target.value)} placeholder={t("placeholderEn")} className="h-10 text-sm" />
                <Input value={newDeptJa} onChange={(e) => setNewDeptJa(e.target.value)} placeholder={t("placeholderJa")} className="h-10 text-sm" />
              </div>
              <Button onClick={handleAddDept} size="sm" className="gap-1">
                <Plus className="h-4 w-4" />{t("addDept")}
              </Button>
            </div>
          </TabsContent>

          {/* ── Categories (Supabase DB) ── */}
          <TabsContent value="categories" className="space-y-4 mt-4">
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-sm w-[52px]">{t("colColor")}</TableHead>
                    <TableHead className="text-sm">{t("colName")}</TableHead>
                    <TableHead className="text-sm text-right w-[72px]">{t("colActions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categories.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-6">—</TableCell>
                    </TableRow>
                  )}
                  {categories.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div className="w-6 h-6 rounded-full border border-border" style={{ background: c.color }} />
                      </TableCell>
                      <TableCell className="text-sm font-medium">{c.name}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => handleDeleteCat(c.id)}
                          className="text-destructive hover:text-destructive h-8 w-8 p-0">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="space-y-3 p-4 border border-dashed border-border rounded-xl">
              <Label className="text-sm font-semibold">{t("addCat")}</Label>
              <div className="flex gap-2">
                <Input
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  placeholder={t("catNamePh")}
                  className="h-10 text-sm flex-1"
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddCat(); }}
                />
                <label className="relative h-10 w-10 shrink-0 cursor-pointer">
                  <div className="absolute inset-0 rounded-lg border border-input" style={{ background: newCatColor }} />
                  <input type="color" value={newCatColor} onChange={(e) => setNewCatColor(e.target.value)}
                    className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
                </label>
              </div>
              <Button onClick={handleAddCat} size="sm" className="gap-1" disabled={catSaving}>
                <Plus className="h-4 w-4" />{t("addCat")}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default AnnouncementSettings;
