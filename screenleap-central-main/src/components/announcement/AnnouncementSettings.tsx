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

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  departments: LabelItem[];
  categories: LabelItem[];
  onDepartmentsChange: (items: LabelItem[]) => void;
  onCategoriesChange: (items: LabelItem[]) => void;
}

const AnnouncementSettings = ({ open, onOpenChange, departments, categories, onDepartmentsChange, onCategoriesChange }: Props) => {
  const { language } = useLanguage();

  const [newDeptZh, setNewDeptZh] = useState("");
  const [newDeptEn, setNewDeptEn] = useState("");
  const [newDeptJa, setNewDeptJa] = useState("");

  const [newCatZh, setNewCatZh] = useState("");
  const [newCatEn, setNewCatEn] = useState("");
  const [newCatJa, setNewCatJa] = useState("");

  const texts = {
    title: { zh: "系統設定", en: "System Settings", ja: "システム設定" },
    deptTab: { zh: "發佈單位維護", en: "Departments", ja: "部署管理" },
    catTab: { zh: "公告類別維護", en: "Categories", ja: "カテゴリ管理" },
    colName: { zh: "名稱", en: "Name", ja: "名前" },
    colNameZh: { zh: "中文", en: "Chinese", ja: "中国語" },
    colNameEn: { zh: "英文", en: "English", ja: "英語" },
    colNameJa: { zh: "日文", en: "Japanese", ja: "日本語" },
    colActions: { zh: "操作", en: "Actions", ja: "操作" },
    addDept: { zh: "新增單位", en: "Add Department", ja: "部署を追加" },
    addCat: { zh: "新增類別", en: "Add Category", ja: "カテゴリを追加" },
    placeholderZh: { zh: "中文名稱", en: "Chinese name", ja: "中国語名" },
    placeholderEn: { zh: "英文名稱", en: "English name", ja: "英語名" },
    placeholderJa: { zh: "日文名稱", en: "Japanese name", ja: "日本語名" },
    added: { zh: "已新增", en: "Added", ja: "追加しました" },
    deleted: { zh: "已刪除", en: "Deleted", ja: "削除しました" },
    fillRequired: { zh: "請至少填寫中文名稱", en: "Please fill in at least the Chinese name", ja: "中国語名を入力してください" },
  };

  const t = (key: keyof typeof texts) => texts[key][language];

  const handleAddDept = () => {
    if (!newDeptZh.trim()) { toast.error(t("fillRequired")); return; }
    const value = `dept_${Date.now()}`;
    const newItem: LabelItem = {
      value,
      label: { zh: newDeptZh.trim(), en: newDeptEn.trim() || newDeptZh.trim(), ja: newDeptJa.trim() || newDeptZh.trim() },
    };
    onDepartmentsChange([...departments, newItem]);
    setNewDeptZh(""); setNewDeptEn(""); setNewDeptJa("");
    toast.success(t("added"));
  };

  const handleDeleteDept = (value: string) => {
    onDepartmentsChange(departments.filter((d) => d.value !== value));
    toast.success(t("deleted"));
  };

  const handleAddCat = () => {
    if (!newCatZh.trim()) { toast.error(t("fillRequired")); return; }
    const value = `cat_${Date.now()}`;
    const newItem: LabelItem = {
      value,
      label: { zh: newCatZh.trim(), en: newCatEn.trim() || newCatZh.trim(), ja: newCatJa.trim() || newCatZh.trim() },
    };
    onCategoriesChange([...categories, newItem]);
    setNewCatZh(""); setNewCatEn(""); setNewCatJa("");
    toast.success(t("added"));
  };

  const handleDeleteCat = (value: string) => {
    onCategoriesChange(categories.filter((c) => c.value !== value));
    toast.success(t("deleted"));
  };

  const renderTable = (
    items: LabelItem[],
    onDelete: (value: string) => void
  ) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="text-sm">{t("colNameZh")}</TableHead>
          <TableHead className="text-sm">{t("colNameEn")}</TableHead>
          <TableHead className="text-sm">{t("colNameJa")}</TableHead>
          <TableHead className="text-sm text-right w-[80px]">{t("colActions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.value}>
            <TableCell className="text-sm font-medium">{item.label.zh}</TableCell>
            <TableCell className="text-sm">{item.label.en}</TableCell>
            <TableCell className="text-sm">{item.label.ja}</TableCell>
            <TableCell className="text-right">
              <Button size="sm" variant="ghost" onClick={() => onDelete(item.value)} className="text-destructive hover:text-destructive h-8 w-8 p-0">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

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
              <Building2 className="h-4 w-4" />
              {t("deptTab")}
            </TabsTrigger>
            <TabsTrigger value="categories" className="flex-1 gap-2">
              <Tag className="h-4 w-4" />
              {t("catTab")}
            </TabsTrigger>
          </TabsList>

          {/* Departments */}
          <TabsContent value="departments" className="space-y-4 mt-4">
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              {renderTable(departments, handleDeleteDept)}
            </div>

            <div className="space-y-3 p-4 border border-dashed border-border rounded-xl">
              <Label className="text-sm font-semibold">{t("addDept")}</Label>
              <div className="grid grid-cols-3 gap-2">
                <Input value={newDeptZh} onChange={(e) => setNewDeptZh(e.target.value)} placeholder={t("placeholderZh")} className="h-10 text-sm" />
                <Input value={newDeptEn} onChange={(e) => setNewDeptEn(e.target.value)} placeholder={t("placeholderEn")} className="h-10 text-sm" />
                <Input value={newDeptJa} onChange={(e) => setNewDeptJa(e.target.value)} placeholder={t("placeholderJa")} className="h-10 text-sm" />
              </div>
              <Button onClick={handleAddDept} size="sm" className="gap-1">
                <Plus className="h-4 w-4" />
                {t("addDept")}
              </Button>
            </div>
          </TabsContent>

          {/* Categories */}
          <TabsContent value="categories" className="space-y-4 mt-4">
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              {renderTable(categories, handleDeleteCat)}
            </div>

            <div className="space-y-3 p-4 border border-dashed border-border rounded-xl">
              <Label className="text-sm font-semibold">{t("addCat")}</Label>
              <div className="grid grid-cols-3 gap-2">
                <Input value={newCatZh} onChange={(e) => setNewCatZh(e.target.value)} placeholder={t("placeholderZh")} className="h-10 text-sm" />
                <Input value={newCatEn} onChange={(e) => setNewCatEn(e.target.value)} placeholder={t("placeholderEn")} className="h-10 text-sm" />
                <Input value={newCatJa} onChange={(e) => setNewCatJa(e.target.value)} placeholder={t("placeholderJa")} className="h-10 text-sm" />
              </div>
              <Button onClick={handleAddCat} size="sm" className="gap-1">
                <Plus className="h-4 w-4" />
                {t("addCat")}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default AnnouncementSettings;
