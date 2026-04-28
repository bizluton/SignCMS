import { useEffect, useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BookOpen, Plus, Search, Upload, Brain, MonitorCog, Server,
  FileText, Trash2, Edit2, FolderOpen, ChevronRight, Sparkles, CheckCircle2,
  Tag as TagIcon, Eraser, Database, RefreshCw,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  clearThumbCache,
  getThumbCacheStats,
  listThumbCacheEntries,
  getThumbCacheLimitMb,
  setThumbCacheLimitMb,
  getThumbCacheLimitOptions,
  type ThumbCacheEntry,
  type ThumbCacheLimitMb,
} from "@/lib/pdfThumbCache";
import { clearPdfChipThumbMemCache } from "@/components/knowledge/PdfChipThumb";
import { clearFileChipPreviewMemCache } from "@/components/knowledge/FileChipPreview";
import { cn } from "@/lib/utils";
import { useKnowledgeItems, KnowledgeItem } from "@/hooks/useKnowledgeItems";
import { useKnowledgeFilePreviews } from "@/hooks/useKnowledgeFilePreviews";
import { KnowledgeFilePanel } from "@/components/knowledge/KnowledgeFilePanel";
import { FileChipThumb } from "@/components/knowledge/FileChipThumb";
import { PdfChipThumb } from "@/components/knowledge/PdfChipThumb";
import { FileChipPreview } from "@/components/knowledge/FileChipPreview";
import { FileText as FileIcon, Image as ImageIcon, File as GenericFileIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { openKnowledgeFileInNewTab } from "@/lib/openKnowledgeFile";

const openFileInNewTab = (storagePath: string, fileName?: string, fileType?: string) =>
  openKnowledgeFileInNewTab(storagePath, fileName, fileType);

const fileTypeIcon = (type: string) => {
  if (type?.startsWith("image/")) return ImageIcon;
  if (type === "application/pdf") return FileIcon;
  return GenericFileIcon;
};
import { CategoryManagementDialog } from "@/components/knowledge/CategoryManagementDialog";
import { TagManagementDialog } from "@/components/knowledge/TagManagementDialog";
import { useUserRole } from "@/hooks/useUserRole";
import { useKnowledgeCategories } from "@/hooks/useKnowledgeCategories";
import { useKnowledgeTags } from "@/hooks/useKnowledgeTags";

const KnowledgeBasePage = () => {
  const { t, language } = useLanguage();
  const { items, loading, addItem, updateItem, deleteItem, syncAll, refetch } = useKnowledgeItems();
  const { categories: dbCategories } = useKnowledgeCategories();
  const { tags: dbTags } = useKnowledgeTags();
  const { isAdmin, isCsAgent } = useUserRole();
  const canManageTaxonomy = isAdmin || isCsAgent;
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [activeTagIds, setActiveTagIds] = useState<string[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [categoryMgmtOpen, setCategoryMgmtOpen] = useState(false);
  const [tagMgmtOpen, setTagMgmtOpen] = useState(false);
  const [fileItem, setFileItem] = useState<KnowledgeItem | null>(null);
  const [editItem, setEditItem] = useState<KnowledgeItem | null>(null);
  const emptyForm = { title: "", description: "", category: "", subCategory: "", categoryId: "", tagIds: [] as string[] };
  const [newItem, setNewItem] = useState(emptyForm);
  const [editForm, setEditForm] = useState(emptyForm);
  const [thumbStats, setThumbStats] = useState<{ count: number; bytes: number; maxBytes: number }>({ count: 0, bytes: 0, maxBytes: 0 });
  const [thumbEntries, setThumbEntries] = useState<ThumbCacheEntry[]>([]);
  const [thumbPopoverOpen, setThumbPopoverOpen] = useState(false);
  const [thumbLimitMb, setThumbLimitMb] = useState<ThumbCacheLimitMb>(() => getThumbCacheLimitMb());
  const limitOptions = getThumbCacheLimitOptions();

  const refreshThumbStats = async () => {
    const [s, list] = await Promise.all([getThumbCacheStats(), listThumbCacheEntries()]);
    setThumbStats(s);
    // Show by largest first; users mostly care about which big entries
    // are sitting in cache. Hit count is shown alongside.
    setThumbEntries(list.sort((a, b) => b.bytes - a.bytes));
  };

  useEffect(() => {
    if (canManageTaxonomy) void refreshThumbStats();
  }, [canManageTaxonomy]);

  useEffect(() => {
    if (thumbPopoverOpen) void refreshThumbStats();
  }, [thumbPopoverOpen]);

  const formatBytes = (b: number) => {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  };

  const openEdit = (item: KnowledgeItem) => {
    setEditItem(item);
    setEditForm({
      title: item.title,
      description: item.description ?? "",
      category: item.category,
      subCategory: item.sub_category ?? "",
      categoryId: (item as any).category_id ?? "",
      tagIds: (item.tags ?? []).map((t) => t.id),
    });
  };

  const handleEditSave = async () => {
    if (!editItem || !editForm.title || !editForm.category) return;
    await updateItem(editItem.id, editForm);
    setEditItem(null);
  };

  const CATEGORIES = [
    {
      id: "hq",
      name: t("kbCatProduct"),
      icon: MonitorCog,
      color: "from-foreground to-foreground/70 text-background",
      subCategories: [
        { zh: "品牌視覺規範", en: "Brand Visual Guidelines", ja: "ブランドビジュアル規範" },
        { zh: "發佈流程 SOP", en: "Publishing SOP", ja: "配信フローSOP" },
        { zh: "行銷策略", en: "Marketing Strategy", ja: "マーケティング戦略" },
        { zh: "人事制度", en: "HR Policies", ja: "人事制度" },
      ],
    },
    {
      id: "store",
      name: t("kbCatStore"),
      icon: Server,
      color: "from-foreground to-foreground/70 text-background",
      subCategories: [
        { zh: t("kbSubScreenRepair"), en: "Screen Repair Process", ja: "スクリーン修理フロー" },
        { zh: t("kbSubStoreCleaning"), en: "Team Cleaning Standards", ja: "チーム清掃基準" },
        { zh: t("kbSubCustomerReception"), en: "Customer Reception", ja: "顧客対応フロー" },
        { zh: t("kbSubInventory"), en: "Inventory Management", ja: "在庫管理" },
      ],
    },
  ];

  const getSubCatLabel = (sub: { zh: string; en: string; ja: string }) => sub[language] || sub.en;

  const filtered = items.filter((item) => {
    const matchSearch = item.title.includes(search) || item.description.includes(search);
    const matchCat = activeCategory === "all" || item.category === activeCategory;
    const matchSubCat = !activeCategoryId || (item as any).category_id === activeCategoryId;
    const matchTags =
      activeTagIds.length === 0 ||
      activeTagIds.every((tid) => (item.tags ?? []).some((t) => t.id === tid));
    return matchSearch && matchCat && matchSubCat && matchTags;
  });

  const filePreviews = useKnowledgeFilePreviews(
    filtered.filter((i) => (i.file_count ?? 0) > 0).map((i) => i.id)
  );

  const toggleTagFilter = (id: string) =>
    setActiveTagIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));

  const handleAdd = async () => {
    if (!newItem.title || !newItem.category) return;
    await addItem(newItem);
    setNewItem({ title: "", description: "", category: "", subCategory: "", categoryId: "", tagIds: [] });
    setAddOpen(false);
  };

  

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-foreground to-foreground/70 flex items-center justify-center">
              <FileText className="h-5 w-5 text-background" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">{t("kbTitle")}</h1>
              <p className="text-sm text-muted-foreground">{t("kbSubtitle")}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canManageTaxonomy && (
              <>
                <Button variant="outline" onClick={() => setCategoryMgmtOpen(true)} className="gap-2">
                  <FolderOpen className="h-4 w-4" />
                  分類管理
                </Button>
                <Button variant="outline" onClick={() => setTagMgmtOpen(true)} className="gap-2">
                  <TagIcon className="h-4 w-4" />
                  標籤管理
                </Button>
                <Popover open={thumbPopoverOpen} onOpenChange={setThumbPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="gap-2" title={t("kbThumbCacheStatsTip")}>
                      <Database className="h-4 w-4" />
                      {t("kbThumbCacheStats")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-[380px] p-0">
                    <div className="flex items-center justify-between px-3 py-2 border-b">
                      <div className="text-sm font-medium">{t("kbThumbCacheStats")}</div>
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => void refreshThumbStats()}
                          title={t("refresh")}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive"
                          onClick={async () => {
                            clearPdfChipThumbMemCache();
                            clearFileChipPreviewMemCache();
                            await clearThumbCache();
                            await refreshThumbStats();
                            toast.success(t("kbClearThumbCacheDone"));
                          }}
                          title={t("kbClearThumbCacheTip")}
                        >
                          <Eraser className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="px-3 py-2 border-b space-y-2">
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {thumbStats.count} {t("kbThumbCacheItems")} · {formatBytes(thumbStats.bytes)}
                        {thumbStats.maxBytes ? ` / ${formatBytes(thumbStats.maxBytes)}` : ""}
                      </div>
                      {isAdmin && (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-muted-foreground">{t("kbThumbCacheLimit")}</span>
                          <Select
                            value={String(thumbLimitMb)}
                            onValueChange={async (v) => {
                              const mb = Number(v) as ThumbCacheLimitMb;
                              setThumbLimitMb(mb);
                              setThumbCacheLimitMb(mb);
                              // Eviction runs in background; refresh stats shortly after.
                              setTimeout(() => void refreshThumbStats(), 200);
                              toast.success(t("kbThumbCacheLimitUpdated"));
                            }}
                          >
                            <SelectTrigger className="h-7 w-[110px] text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {limitOptions.map((mb) => (
                                <SelectItem key={mb} value={String(mb)} className="text-xs">
                                  {mb} MB
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                    {thumbEntries.length === 0 ? (
                      <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                        {t("kbThumbCacheEmpty")}
                      </div>
                    ) : (
                      <ScrollArea className="max-h-[320px]">
                        <ul className="divide-y">
                          {thumbEntries.map((e, i) => {
                            const fileName = e.storagePath.split("/").pop() || e.storagePath;
                            return (
                              <li key={`${e.storagePath}-${e.targetWidth}-${i}`} className="px-3 py-2 flex items-center gap-2">
                                <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs font-medium text-foreground truncate" title={e.storagePath}>
                                    {fileName}
                                  </div>
                                  <div className="text-[10px] text-muted-foreground tabular-nums">
                                    w{e.targetWidth} · {t("kbThumbHits")} {e.hitCount}
                                  </div>
                                </div>
                                <div className="text-xs text-muted-foreground tabular-nums shrink-0">
                                  {formatBytes(e.bytes)}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </ScrollArea>
                    )}
                  </PopoverContent>
                </Popover>
              </>
            )}
            <Button variant="outline" onClick={syncAll} className="gap-2">
              <Brain className="h-4 w-4" />
              <Sparkles className="h-3 w-3" />
              {t("kbSyncAI")}
            </Button>
            <Button onClick={() => setAddOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              {t("kbAddItem")}
            </Button>
          </div>
        </div>

        {/* Category cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {CATEGORIES.map((cat) => {
            const catItems = items.filter((i) => i.category === cat.id);
            const syncedCount = catItems.filter((i) => i.synced).length;
            return (
              <Card
                key={cat.id}
                className={cn(
                  "cursor-pointer hover-lift border-border/50",
                  activeCategory === cat.id && "ring-2 ring-primary"
                )}
                onClick={() => setActiveCategory(activeCategory === cat.id ? "all" : cat.id)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div className={cn("h-10 w-10 rounded-lg bg-gradient-to-br flex items-center justify-center", cat.color)}>
                      <cat.icon className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{cat.name}</CardTitle>
                      <CardDescription>{catItems.length} {t("kbItems")}</CardDescription>
                    </div>
                    <Badge variant="outline" className="ml-auto">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      {syncedCount}/{catItems.length} {t("kbSynced")}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex flex-wrap gap-1.5">
                    {(() => {
                      const scoped = dbCategories.filter(
                        (dc: any) => (dc.parent_key ?? "store") === cat.id
                      );
                      if (scoped.length > 0) {
                        return scoped.map((dc) => {
                          const count = catItems.filter((i) => (i as any).category_id === dc.id).length;
                          const selected = activeCategoryId === dc.id;
                          return (
                            <Badge
                              key={dc.id}
                              variant={selected ? "default" : "secondary"}
                              className={cn(
                                "text-xs cursor-pointer transition-colors",
                                !selected && "hover:bg-muted"
                              )}
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveCategoryId(selected ? null : dc.id);
                                setActiveCategory(cat.id);
                              }}
                            >
                              <FolderOpen className="h-3 w-3 mr-1" />
                              {dc.name}
                              {count > 0 && <span className="ml-1 opacity-70">({count})</span>}
                            </Badge>
                          );
                        });
                      }
                      return cat.subCategories.map((sub) => (
                        <Badge key={sub.en} variant="secondary" className="text-xs">
                          <FolderOpen className="h-3 w-3 mr-1" />
                          {getSubCatLabel(sub)}
                        </Badge>
                      ));
                    })()}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Search + list */}
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("kbSearchPlaceholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Tabs value={activeCategory} onValueChange={(v) => { setActiveCategory(v); setActiveCategoryId(null); }}>
              <TabsList>
                <TabsTrigger value="all">{t("kbAll")}</TabsTrigger>
                {CATEGORIES.map((c) => (
                  <TabsTrigger key={c.id} value={c.id}>{c.name}</TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            {activeCategoryId && (
              <Badge
                variant="outline"
                className="cursor-pointer gap-1"
                onClick={() => setActiveCategoryId(null)}
              >
                {dbCategories.find((c) => c.id === activeCategoryId)?.name ?? "細分類"}
                <span className="ml-1 opacity-60">✕</span>
              </Badge>
            )}
          </div>

          {dbTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground mr-1">標籤篩選：</span>
              {dbTags.map((tag) => {
                const selected = activeTagIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTagFilter(tag.id)}
                    className={cn(
                      "px-2 py-0.5 rounded-full text-xs font-medium border transition-all",
                      selected
                        ? "border-transparent text-primary-foreground"
                        : "border-border bg-background text-foreground hover:bg-muted"
                    )}
                    style={selected ? { backgroundColor: tag.color } : undefined}
                  >
                    {tag.name}
                  </button>
                );
              })}
              {activeTagIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveTagIds([])}
                  className="text-xs text-muted-foreground underline ml-1"
                >
                  清除
                </button>
              )}
            </div>
          )}

          {loading ? (
            <div className="grid gap-3">
              {[1, 2, 3].map((i) => (
                <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
              ))}
            </div>
          ) : (
            <div className="grid gap-3">
              {filtered.map((item) => {
                const cat = CATEGORIES.find((c) => c.id === item.category);
                const fileCount = item.file_count ?? 0;
                const hasFiles = fileCount > 0;
                return (
                  <Card
                    key={item.id}
                    className={cn(
                      "hover-lift transition-colors cursor-pointer",
                      hasFiles ? "border-primary/30" : "border-dashed border-border/60"
                    )}
                    onClick={() => setFileItem(item)}
                  >
                    <CardContent className="p-4 flex items-center gap-4">
                      <div className={cn("h-10 w-10 rounded-lg bg-gradient-to-br flex items-center justify-center shrink-0", cat?.color || "from-muted to-muted/60 text-muted-foreground")}>
                        <FileText className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold text-foreground truncate">{item.title}</h3>
                          {item.synced ? (
                            <Badge variant="outline" className="text-[10px] border-success/30 text-success shrink-0">
                              <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" /> {t("kbSynced")}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] border-warning/30 text-warning shrink-0">
                              {t("kbPendingSync")}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.description}</p>
                        {item.tags && item.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {item.tags.map((tag) => (
                              <span
                                key={tag.id}
                                className="px-1.5 py-0.5 rounded-full text-[10px] font-medium text-primary-foreground"
                                style={{ backgroundColor: tag.color }}
                              >
                                {tag.name}
                              </span>
                            ))}
                          </div>
                        )}
                        {hasFiles && (filePreviews[item.id]?.length ?? 0) > 0 && (
                          <div className="flex flex-wrap items-center gap-1 mt-1.5">
                            {filePreviews[item.id]!.map((f) => {
                              const isImage = f.file_type?.startsWith("image/");
                              const isPdf = f.file_type === "application/pdf" || f.file_name?.toLowerCase().endsWith(".pdf");
                              const Icon = fileTypeIcon(f.file_type);
                              return (
                                <FileChipPreview
                                  key={f.id}
                                  storagePath={f.storage_path}
                                  fileName={f.file_name}
                                  fileType={f.file_type}
                                  isImage={!!isImage}
                                  isPdf={!!isPdf}
                                >
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openFileInNewTab(f.storage_path, f.file_name, f.file_type);
                                    }}
                                    className="inline-flex items-center gap-1 max-w-[180px] pl-0.5 pr-1.5 py-0.5 rounded-md bg-primary/10 border border-primary/20 text-[10px] text-primary hover:bg-primary/20 transition-colors cursor-pointer"
                                  >
                                    {isImage ? (
                                      <FileChipThumb storagePath={f.storage_path} alt={f.file_name} />
                                    ) : isPdf ? (
                                      <PdfChipThumb storagePath={f.storage_path} alt={f.file_name} />
                                    ) : (
                                      <Icon className="h-3 w-3 shrink-0 ml-1" />
                                    )}
                                    <span className="truncate">{f.file_name}</span>
                                  </button>
                                </FileChipPreview>
                              );
                            })}
                            {fileCount > (filePreviews[item.id]?.length ?? 0) && (
                              <span className="text-[10px] text-muted-foreground">
                                +{fileCount - (filePreviews[item.id]?.length ?? 0)}
                              </span>
                            )}
                          </div>
                        )}
                        <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                          <span>{cat?.name}</span>
                          <ChevronRight className="h-3 w-3" />
                          <span>
                            {dbCategories.find((c) => c.id === (item as any).category_id)?.name
                              ?? item.sub_category
                              ?? "-"}
                          </span>
                          <span>{t("kbUpdatedAt")} {item.updated_at?.slice(0, 10)}</span>
                        </div>
                      </div>

                      {/* File count highlight */}
                      <div
                        className={cn(
                          "shrink-0 flex flex-col items-center justify-center min-w-[68px] px-3 py-2 rounded-lg border transition-colors",
                          hasFiles
                            ? "bg-primary/10 border-primary/30 text-primary"
                            : "bg-muted/40 border-dashed border-border text-muted-foreground"
                        )}
                        title={hasFiles ? `${fileCount} ${t("kbFiles")}` : "尚未上傳"}
                      >
                        <FolderOpen className="h-4 w-4 mb-0.5" />
                        <span className="text-base font-bold leading-none">{fileCount}</span>
                        <span className="text-[10px] mt-0.5 leading-none">{t("kbFiles")}</span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-8 w-8" title={t("tipUploadFile")} onClick={() => setFileItem(item)}>
                          <Upload className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" title={t("edit")} onClick={() => openEdit(item)}>
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title={t("delete")} onClick={() => deleteItem(item.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
              {filtered.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <BookOpen className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p>{t("kbEmpty")}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Add dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("kbAddTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">{t("kbFieldTitle")}</label>
              <Input value={newItem.title} onChange={(e) => setNewItem((p) => ({ ...p, title: e.target.value }))} placeholder={t("kbFieldTitlePlaceholder")} />
            </div>
            <div>
              <label className="text-sm font-medium">{t("kbFieldDesc")}</label>
              <Textarea value={newItem.description} onChange={(e) => setNewItem((p) => ({ ...p, description: e.target.value }))} placeholder={t("kbFieldDescPlaceholder")} />
            </div>
            <div>
              <label className="text-sm font-medium">{t("kbFieldCategory")}</label>
              <Select value={newItem.category} onValueChange={(v) => setNewItem((p) => ({ ...p, category: v, subCategory: "", categoryId: "" }))}>
                <SelectTrigger><SelectValue placeholder={t("kbSelectCategory")} /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">細分類（系統分類）</label>
              {(() => {
                const scoped = dbCategories.filter((c) => !newItem.category || c.parent_key === newItem.category);
                return (
                  <Select
                    value={newItem.categoryId}
                    onValueChange={(v) => {
                      const found = dbCategories.find((c) => c.id === v);
                      setNewItem((p) => ({ ...p, categoryId: v, subCategory: found?.name ?? "" }));
                    }}
                    disabled={!newItem.category}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          !newItem.category
                            ? "請先選擇主分類"
                            : scoped.length
                              ? "選擇系統分類"
                              : "此主分類下尚無細分類"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {scoped.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                );
              })()}
            </div>
            <div>
              <label className="text-sm font-medium">標籤</label>
              {dbTags.length === 0 ? (
                <p className="text-xs text-muted-foreground mt-1">尚未建立任何標籤</p>
              ) : (
                <div className="flex flex-wrap gap-1.5 mt-1.5 max-h-32 overflow-y-auto">
                  {dbTags.map((tag) => {
                    const selected = newItem.tagIds.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() =>
                          setNewItem((p) => ({
                            ...p,
                            tagIds: selected
                              ? p.tagIds.filter((id) => id !== tag.id)
                              : [...p.tagIds, tag.id],
                          }))
                        }
                        className={cn(
                          "px-2 py-0.5 rounded-full text-xs font-medium border transition-all",
                          selected ? "border-transparent text-white" : "border-border bg-background text-foreground hover:bg-muted"
                        )}
                        style={selected ? { backgroundColor: tag.color } : undefined}
                      >
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              )}
              {newItem.tagIds.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1.5">已選 {newItem.tagIds.length} 個標籤</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>{t("cancel")}</Button>
            <Button onClick={handleAdd} disabled={!newItem.title || !newItem.category}>{t("add")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editItem} onOpenChange={(open) => { if (!open) setEditItem(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>編輯知識點</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">{t("kbFieldTitle")}</label>
              <Input value={editForm.title} onChange={(e) => setEditForm((p) => ({ ...p, title: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium">{t("kbFieldDesc")}</label>
              <Textarea value={editForm.description} onChange={(e) => setEditForm((p) => ({ ...p, description: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium">{t("kbFieldCategory")}</label>
              <Select
                value={editForm.category}
                onValueChange={(v) =>
                  setEditForm((p) => ({
                    ...p,
                    category: v,
                    categoryId: p.categoryId && dbCategories.find((c) => c.id === p.categoryId)?.parent_key === v ? p.categoryId : "",
                    subCategory: p.categoryId && dbCategories.find((c) => c.id === p.categoryId)?.parent_key === v ? p.subCategory : "",
                  }))
                }
              >
                <SelectTrigger><SelectValue placeholder={t("kbSelectCategory")} /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">細分類（系統分類）</label>
              {(() => {
                const scoped = dbCategories.filter((c) => !editForm.category || c.parent_key === editForm.category);
                return (
                  <Select
                    value={editForm.categoryId}
                    onValueChange={(v) => {
                      const found = dbCategories.find((c) => c.id === v);
                      setEditForm((p) => ({ ...p, categoryId: v, subCategory: found?.name ?? p.subCategory }));
                    }}
                    disabled={!editForm.category}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          !editForm.category
                            ? "請先選擇主分類"
                            : scoped.length
                              ? "選擇系統分類"
                              : "此主分類下尚無細分類"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {scoped.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                );
              })()}
            </div>
            <div>
              <label className="text-sm font-medium">標籤</label>
              {dbTags.length === 0 ? (
                <p className="text-xs text-muted-foreground mt-1">尚未建立任何標籤</p>
              ) : (
                <div className="flex flex-wrap gap-1.5 mt-1.5 max-h-32 overflow-y-auto">
                  {dbTags.map((tag) => {
                    const selected = editForm.tagIds.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() =>
                          setEditForm((p) => ({
                            ...p,
                            tagIds: selected ? p.tagIds.filter((id) => id !== tag.id) : [...p.tagIds, tag.id],
                          }))
                        }
                        className={cn(
                          "px-2 py-0.5 rounded-full text-xs font-medium border transition-all",
                          selected ? "border-transparent text-primary-foreground" : "border-border bg-background text-foreground hover:bg-muted"
                        )}
                        style={selected ? { backgroundColor: tag.color } : undefined}
                      >
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              )}
              {editForm.tagIds.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1.5">已選 {editForm.tagIds.length} 個標籤</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditItem(null)}>{t("cancel")}</Button>
            <Button onClick={handleEditSave} disabled={!editForm.title || !editForm.category}>儲存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* File management dialog */}
      <Dialog open={!!fileItem} onOpenChange={(open) => { if (!open) { setFileItem(null); refetch(); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("kbFileManagement")}</DialogTitle>
          </DialogHeader>
          {fileItem && (
            <KnowledgeFilePanel
              knowledgeItemId={fileItem.id}
              itemTitle={fileItem.title}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Category & tag management dialogs (admin / CS only) */}
      {canManageTaxonomy && (
        <>
          <CategoryManagementDialog open={categoryMgmtOpen} onOpenChange={setCategoryMgmtOpen} />
          <TagManagementDialog open={tagMgmtOpen} onOpenChange={setTagMgmtOpen} />
        </>
      )}
    </DashboardLayout>
  );
};

export default KnowledgeBasePage;
