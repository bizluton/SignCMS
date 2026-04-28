import { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import RichTextEditor from "@/components/announcement/RichTextEditor";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Megaphone, Upload, CalendarIcon, Send, Monitor, Smartphone, Trash2, ImageIcon, Pin, Pencil, Save, Settings } from "lucide-react";
import AnnouncementSettings, { type LabelItem } from "@/components/announcement/AnnouncementSettings";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface Announcement {
  id: string;
  subject: string;
  department: string;
  category: string;
  pinned: boolean;
  content: string;
  imageUrl: string | null;
  startDate: Date;
  endDate: Date;
  createdAt: Date;
}

const DEFAULT_CATEGORIES: LabelItem[] = [
  { value: "general", label: { zh: "一般公告", en: "General", ja: "一般" } },
  { value: "urgent", label: { zh: "緊急通知", en: "Urgent", ja: "緊急" } },
  { value: "event", label: { zh: "活動公告", en: "Event", ja: "イベント" } },
  { value: "policy", label: { zh: "政策規章", en: "Policy", ja: "規定" } },
  { value: "maintenance", label: { zh: "維護公告", en: "Maintenance", ja: "メンテナンス" } },
];

const DEFAULT_DEPARTMENTS: LabelItem[] = [
  { value: "hq", label: { zh: "總管理處", en: "Headquarters", ja: "本部" } },
  { value: "marketing", label: { zh: "行銷部", en: "Marketing", ja: "マーケティング部" } },
  { value: "maintenance", label: { zh: "維修組", en: "Maintenance", ja: "メンテナンス" } },
  { value: "hr", label: { zh: "人事部", en: "HR", ja: "人事部" } },
  { value: "ops", label: { zh: "營運部", en: "Operations", ja: "運営部" } },
];

function orgKey(base: string, orgId: string | null) {
  return orgId ? `${base}:${orgId}` : base;
}

const loadFromStorage = <T,>(key: string, fallback: T): T => {
  try {
    const saved = localStorage.getItem(key);
    if (saved) return JSON.parse(saved);
  } catch {}
  return fallback;
};

const AnnouncementPage = () => {
  const { language, t: globalT } = useLanguage();
  const { activeOrgId } = useActiveOrg();

  // Settings state
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [DEPARTMENTS, setDepartments] = useState<LabelItem[]>(() => loadFromStorage(orgKey("signboard-departments", activeOrgId), DEFAULT_DEPARTMENTS));
  const [CATEGORIES, setCategories] = useState<LabelItem[]>(() => loadFromStorage(orgKey("signboard-categories", activeOrgId), DEFAULT_CATEGORIES));

  const handleDepartmentsChange = (items: LabelItem[]) => {
    setDepartments(items);
    localStorage.setItem(orgKey("signboard-departments", activeOrgId), JSON.stringify(items));
  };
  const handleCategoriesChange = (items: LabelItem[]) => {
    setCategories(items);
    localStorage.setItem(orgKey("signboard-categories", activeOrgId), JSON.stringify(items));
  };

  // Form state
  const [subject, setSubject] = useState("");
  const [department, setDepartment] = useState("");
  const [category, setCategory] = useState("");
  const [pinned, setPinned] = useState(false);
  const [content, setContent] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [previewMode, setPreviewMode] = useState<"landscape" | "portrait">("landscape");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Announcement list
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  // Load announcements from org-scoped storage
  const loadAnnouncements = useCallback((oid: string | null) => {
    try {
      const saved = localStorage.getItem(orgKey("signboard-announcements", oid));
      if (saved) {
        return JSON.parse(saved).map((a: any) => ({
          ...a,
          startDate: new Date(a.startDate),
          endDate: new Date(a.endDate),
          createdAt: new Date(a.createdAt),
        }));
      }
    } catch {}
    return [];
  }, []);

  // Reload all data when org changes
  useEffect(() => {
    setAnnouncements(loadAnnouncements(activeOrgId));
    setDepartments(loadFromStorage(orgKey("signboard-departments", activeOrgId), DEFAULT_DEPARTMENTS));
    setCategories(loadFromStorage(orgKey("signboard-categories", activeOrgId), DEFAULT_CATEGORIES));
  }, [activeOrgId, loadAnnouncements]);

  const texts = {
    pageTitle: { zh: "公告發佈管理", en: "Announcement Manager", ja: "お知らせ管理" },
    tabEdit: { zh: "新增公告", en: "New Announcement", ja: "新規作成" },
    tabList: { zh: "公告列表", en: "Announcement List", ja: "お知らせ一覧" },
    subject: { zh: "公告主旨", en: "Subject", ja: "件名" },
    subjectPh: { zh: "例如：年終大特賣、緊急停電通知", en: "e.g. Year-End Sale, Emergency Notice", ja: "例：年末セール、緊急停電通知" },
    dept: { zh: "發佈單位", en: "Department", ja: "発信部署" },
    deptPh: { zh: "選擇發佈單位", en: "Select department", ja: "部署を選択" },
    categoryLabel: { zh: "公告類別", en: "Category", ja: "カテゴリ" },
    categoryPh: { zh: "選擇公告類別", en: "Select category", ja: "カテゴリを選択" },
    pinnedLabel: { zh: "重要公告置頂", en: "Pin as Important", ja: "重要：トップに固定" },
    pinnedDesc: { zh: "開啟後此公告將置頂顯示", en: "This announcement will be pinned to the top", ja: "このお知らせをトップに固定します" },
    contentLabel: { zh: "公告內容", en: "Content", ja: "内容" },
    contentPh: { zh: "輸入公告的詳細內容…", en: "Enter announcement details…", ja: "お知らせの詳細を入力…" },
    imageLabel: { zh: "附件圖片", en: "Attachment Image", ja: "添付画像" },
    imageDrop: { zh: "拖放圖片至此，或點擊上傳", en: "Drag & drop image here, or click to upload", ja: "画像をドラッグ＆ドロップ、またはクリック" },
    startTime: { zh: "公告開始時間", en: "Start Time", ja: "開始日時" },
    endTime: { zh: "公告結束時間", en: "End Time", ja: "終了日時" },
    pickDate: { zh: "選擇日期", en: "Pick a date", ja: "日付を選択" },
    preview: { zh: "即時模擬預覽", en: "Live Preview", ja: "リアルタイムプレビュー" },
    landscape: { zh: "橫式螢幕", en: "Landscape", ja: "横型" },
    portrait: { zh: "直式螢幕", en: "Portrait", ja: "縦型" },
    publish: { zh: "確認發佈", en: "Publish", ja: "公開する" },
    noContent: { zh: "請在左側輸入公告內容…", en: "Enter content on the left…", ja: "左側に内容を入力してください…" },
    statusActive: { zh: "進行中", en: "Active", ja: "配信中" },
    statusExpired: { zh: "已過期", en: "Expired", ja: "終了" },
    statusPending: { zh: "尚未開始", en: "Pending", ja: "配信前" },
    colSubject: { zh: "主旨", en: "Subject", ja: "件名" },
    colCategory: { zh: "類別", en: "Category", ja: "カテゴリ" },
    colDept: { zh: "發佈單位", en: "Department", ja: "部署" },
    colPeriod: { zh: "時間區間", en: "Period", ja: "期間" },
    colStatus: { zh: "狀態", en: "Status", ja: "ステータス" },
    colActions: { zh: "操作", en: "Actions", ja: "操作" },
    noAnnouncements: { zh: "尚無公告紀錄", en: "No announcements yet", ja: "お知らせはまだありません" },
    successPublish: { zh: "公告已成功發佈！", en: "Announcement published!", ja: "お知らせを公開しました！" },
    errorFill: { zh: "請填寫主旨、內容、起訖時間", en: "Please fill in subject, content, and dates", ja: "件名・内容・日時を入力してください" },
    deleted: { zh: "已刪除公告", en: "Announcement deleted", ja: "お知らせを削除しました" },
    pinnedTag: { zh: "📌 置頂", en: "📌 Pinned", ja: "📌 固定" },
    successEdit: { zh: "公告已更新", en: "Announcement updated", ja: "お知らせを更新しました" },
    editTitle: { zh: "編輯公告", en: "Edit Announcement", ja: "お知らせを編集" },
    cancelBtn: { zh: "取消", en: "Cancel", ja: "キャンセル" },
    saveBtn: { zh: "儲存變更", en: "Save Changes", ja: "変更を保存" },
  };

  const t = (key: keyof typeof texts) => texts[key][language];

  const handleImageUpload = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => setImageUrl(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleImageUpload(file);
  };

  const handlePublish = () => {
    if (!subject.trim() || !content || content === "<p></p>" || !startDate || !endDate) {
      toast.error(t("errorFill"));
      return;
    }
    const newAnnouncement: Announcement = {
      id: crypto.randomUUID(),
      subject,
      department,
      category,
      pinned,
      content,
      imageUrl,
      startDate,
      endDate,
      createdAt: new Date(),
    };
    const updated = [newAnnouncement, ...announcements];
    setAnnouncements(updated);
    localStorage.setItem(orgKey("signboard-announcements", activeOrgId), JSON.stringify(updated));
    toast.success(t("successPublish"));
    setSubject("");
    setDepartment("");
    setCategory("");
    setPinned(false);
    setContent("");
    setImageUrl(null);
    setStartDate(undefined);
    setEndDate(undefined);
  };

  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editDepartment, setEditDepartment] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editPinned, setEditPinned] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [editImageUrl, setEditImageUrl] = useState<string | null>(null);
  const [editStartDate, setEditStartDate] = useState<Date | undefined>();
  const [editEndDate, setEditEndDate] = useState<Date | undefined>();
  const editFileInputRef = useRef<HTMLInputElement>(null);

  const startEditing = (a: Announcement) => {
    setEditingAnnouncement(a);
    setEditSubject(a.subject);
    setEditDepartment(a.department);
    setEditCategory(a.category);
    setEditPinned(a.pinned);
    setEditContent(a.content);
    setEditImageUrl(a.imageUrl);
    setEditStartDate(a.startDate);
    setEditEndDate(a.endDate);
    setEditDialogOpen(true);
  };

  const handleEditImageUpload = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => setEditImageUrl(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const saveEditing = () => {
    if (!editingAnnouncement) return;
    if (!editSubject.trim() || !editContent || editContent === "<p></p>" || !editStartDate || !editEndDate) {
      toast.error(t("errorFill"));
      return;
    }
    const updated = announcements.map((a) =>
      a.id === editingAnnouncement.id
        ? { ...a, subject: editSubject, department: editDepartment, category: editCategory, pinned: editPinned, content: editContent, imageUrl: editImageUrl, startDate: editStartDate, endDate: editEndDate }
        : a
    );
    setAnnouncements(updated);
    localStorage.setItem(orgKey("signboard-announcements", activeOrgId), JSON.stringify(updated));
    setEditDialogOpen(false);
    setEditingAnnouncement(null);
    toast.success(texts.successEdit[language]);
  };

  const handleDelete = (id: string) => {
    const updated = announcements.filter((a) => a.id !== id);
    setAnnouncements(updated);
    localStorage.setItem(orgKey("signboard-announcements", activeOrgId), JSON.stringify(updated));
    toast.success(t("deleted"));
  };

  const getStatus = (a: Announcement) => {
    const now = new Date();
    if (now < a.startDate) return "pending";
    if (now > a.endDate) return "expired";
    return "active";
  };

  const statusBadge = (status: string) => {
    const map = {
      active: { label: t("statusActive"), variant: "default" as const, className: "bg-emerald-500/90 hover:bg-emerald-500" },
      expired: { label: t("statusExpired"), variant: "secondary" as const, className: "bg-muted text-muted-foreground" },
      pending: { label: t("statusPending"), variant: "outline" as const, className: "border-amber-500 text-amber-600" },
    };
    const s = map[status as keyof typeof map];
    return <Badge variant={s.variant} className={s.className}>{s.label}</Badge>;
  };

  const deptLabel = (val: string) => {
    const d = DEPARTMENTS.find((x) => x.value === val);
    return d ? d.label[language] : val || "—";
  };

  const categoryLabel = (val: string) => {
    const c = CATEGORIES.find((x) => x.value === val);
    return c ? c.label[language] : val || "—";
  };

  // Sort: pinned first, then by createdAt
  const sortedAnnouncements = useMemo(() => {
    return [...announcements].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
  }, [announcements]);

  const hasContent = subject || (content && content !== "<p></p>") || imageUrl;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center shadow-lg">
            <Megaphone className="h-5 w-5 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">{t("pageTitle")}</h1>
        </div>
        <Button variant="outline" size="icon" onClick={() => setSettingsOpen(true)} className="h-10 w-10 rounded-xl" title={globalT("tipSystemSettings")}>
          <Settings className="h-5 w-5" />
        </Button>
      </div>

      <Tabs defaultValue="edit" className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="edit" className="min-w-[140px]">{t("tabEdit")}</TabsTrigger>
          <TabsTrigger value="list" className="min-w-[140px]">
            {t("tabList")}
            {announcements.length > 0 && (
              <Badge className="ml-2 bg-primary/20 text-primary text-xs">{announcements.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ===== Editor Tab ===== */}
        <TabsContent value="edit">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Left: Form */}
            <div className="space-y-5 bg-card border border-border rounded-2xl p-6">
              {/* Subject */}
              <div className="space-y-2">
                <Label className="text-base font-semibold">{t("subject")}</Label>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder={t("subjectPh")}
                  className="h-12 text-lg font-medium"
                />
              </div>

              {/* Department */}
              <div className="space-y-2">
                <Label className="text-base font-semibold">{t("dept")}</Label>
                <Select value={department} onValueChange={setDepartment}>
                  <SelectTrigger className="h-12 text-base">
                    <SelectValue placeholder={t("deptPh")} />
                  </SelectTrigger>
                  <SelectContent>
                    {DEPARTMENTS.map((d) => (
                      <SelectItem key={d.value} value={d.value} className="text-base">
                        {d.label[language]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Category */}
              <div className="space-y-2">
                <Label className="text-base font-semibold">{t("categoryLabel")}</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="h-12 text-base">
                    <SelectValue placeholder={t("categoryPh")} />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value} className="text-base">
                        {c.label[language]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Pinned */}
              <div className="flex items-center justify-between rounded-xl border border-border p-4">
                <div className="space-y-0.5">
                  <Label className="text-base font-semibold flex items-center gap-2">
                    <Pin className="h-4 w-4 text-amber-500" />
                    {t("pinnedLabel")}
                  </Label>
                  <p className="text-sm text-muted-foreground">{t("pinnedDesc")}</p>
                </div>
                <Switch checked={pinned} onCheckedChange={setPinned} />
              </div>

              {/* Content */}
              <div className="space-y-2">
                <Label className="text-base font-semibold">{t("contentLabel")}</Label>
                <RichTextEditor
                  content={content}
                  onChange={setContent}
                  placeholder={t("contentPh")}
                  minHeight="160px"
                />
              </div>

              {/* Image Upload */}
              <div className="space-y-2">
                <Label className="text-base font-semibold">{t("imageLabel")}</Label>
                <div
                  onDrop={handleDrop}
                  onDragOver={(e) => e.preventDefault()}
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    "relative border-2 border-dashed rounded-xl cursor-pointer transition-all duration-200 hover:border-primary hover:bg-primary/5 flex flex-col items-center justify-center",
                    imageUrl ? "h-48 border-primary/40" : "h-36 border-border"
                  )}
                >
                  {imageUrl ? (
                    <>
                      <img src={imageUrl} alt="preview" className="h-full w-full object-contain rounded-lg p-2" />
                      <button
                        onClick={(e) => { e.stopPropagation(); setImageUrl(null); }}
                        className="absolute top-2 right-2 bg-destructive text-destructive-foreground rounded-full p-1 hover:opacity-80"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                      <p className="text-sm text-muted-foreground">{t("imageDrop")}</p>
                    </>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleImageUpload(f);
                    }}
                  />
                </div>
              </div>

              {/* Date pickers */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Start */}
                <div className="space-y-2">
                  <Label className="text-base font-semibold">{t("startTime")}</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-full h-12 justify-start text-left text-base", !startDate && "text-muted-foreground")}>
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {startDate ? format(startDate, "yyyy/MM/dd") : t("pickDate")}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={startDate} onSelect={setStartDate} initialFocus className="p-3 pointer-events-auto" />
                    </PopoverContent>
                  </Popover>
                </div>
                {/* End */}
                <div className="space-y-2">
                  <Label className="text-base font-semibold">{t("endTime")}</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-full h-12 justify-start text-left text-base", !endDate && "text-muted-foreground")}>
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {endDate ? format(endDate, "yyyy/MM/dd") : t("pickDate")}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={endDate} onSelect={setEndDate} initialFocus className="p-3 pointer-events-auto" />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </div>

            {/* Right: Live Preview */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <Monitor className="h-5 w-5" />
                  {t("preview")}
                </h2>
                <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
                  <Button
                    size="sm"
                    variant={previewMode === "landscape" ? "default" : "ghost"}
                    onClick={() => setPreviewMode("landscape")}
                    className="text-xs h-8 gap-1"
                  >
                    <Monitor className="h-3.5 w-3.5" />
                    {t("landscape")}
                  </Button>
                  <Button
                    size="sm"
                    variant={previewMode === "portrait" ? "default" : "ghost"}
                    onClick={() => setPreviewMode("portrait")}
                    className="text-xs h-8 gap-1"
                  >
                    <Smartphone className="h-3.5 w-3.5" />
                    {t("portrait")}
                  </Button>
                </div>
              </div>

              {/* Simulated screen */}
              <div className="flex justify-center">
                <div
                  className={cn(
                    "relative bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl border-4 border-gray-700 shadow-2xl overflow-hidden transition-all duration-300",
                    previewMode === "landscape" ? "w-full aspect-video" : "w-[280px] aspect-[9/16]"
                  )}
                >
                  {/* Screen background pattern */}
                  <div className="absolute inset-0 bg-[url('/placeholder.svg')] bg-cover opacity-5" />

                  {hasContent ? (
                    <div className="absolute inset-0 flex flex-col">
                      {/* Image area */}
                      {imageUrl && (
                        <div className={cn("relative", previewMode === "landscape" ? "h-1/2" : "h-2/5")}>
                          <img src={imageUrl} alt="" className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-gray-900/60" />
                        </div>
                      )}

                      {/* Text overlay */}
                      <div className={cn(
                        "flex-1 flex flex-col justify-end p-4",
                        imageUrl ? "" : "justify-center"
                      )}>
                        {department && (
                          <span className="text-amber-400 text-[10px] font-bold uppercase tracking-widest mb-1">
                            {deptLabel(department)}
                          </span>
                        )}
                        <h3 className={cn(
                          "text-white font-black leading-tight mb-2",
                          previewMode === "landscape" ? "text-xl" : "text-base"
                        )}>
                          {subject || "…"}
                        </h3>
                        <div
                          className={cn(
                            "text-white/80 leading-relaxed line-clamp-4 prose prose-sm prose-invert",
                            previewMode === "landscape" ? "text-sm" : "text-xs"
                          )}
                          dangerouslySetInnerHTML={{ __html: content || "<p>…</p>" }}
                        />
                        {startDate && endDate && (
                          <p className="text-white/50 text-[10px] mt-3">
                            {format(startDate, "MM/dd")} – {format(endDate, "MM/dd")}
                          </p>
                        )}
                      </div>

                      {/* Bottom ticker bar */}
                      <div className="bg-gradient-to-r from-orange-600/90 to-amber-500/90 px-4 py-2 backdrop-blur-sm">
                        <div className="flex items-center gap-2">
                          <Megaphone className="h-3.5 w-3.5 text-white shrink-0" />
                          <p className="text-white text-xs font-medium truncate animate-pulse">
                            {subject || "公告"}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-white/30 gap-3">
                      <ImageIcon className="h-12 w-12" />
                      <p className="text-sm text-center px-4">{t("noContent")}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Publish button */}
              <Button
                onClick={handlePublish}
                size="lg"
                className="w-full h-14 text-lg font-bold bg-gradient-to-r from-orange-500 to-amber-500 hover:opacity-90 border-0 text-white shadow-lg"
              >
                <Send className="mr-2 h-5 w-5" />
                {t("publish")}
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* ===== List Tab ===== */}
        <TabsContent value="list">
          {announcements.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">
              <Megaphone className="mx-auto h-12 w-12 mb-4 opacity-30" />
              <p className="text-lg">{t("noAnnouncements")}</p>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-2xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-base">{t("colSubject")}</TableHead>
                    <TableHead className="text-base">{t("colCategory")}</TableHead>
                    <TableHead className="text-base">{t("colDept")}</TableHead>
                    <TableHead className="text-base">{t("colPeriod")}</TableHead>
                    <TableHead className="text-base">{t("colStatus")}</TableHead>
                    <TableHead className="text-base text-right">{t("colActions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedAnnouncements.map((a) => {
                    const status = getStatus(a);
                    return (
                      <TableRow key={a.id} className={a.pinned ? "bg-amber-500/5" : ""}>
                        <TableCell className="font-semibold text-base max-w-[240px] truncate">
                          {a.pinned && <Badge variant="outline" className="mr-2 border-amber-500 text-amber-600 text-[10px]">{t("pinnedTag")}</Badge>}
                          {a.subject}
                        </TableCell>
                        <TableCell className="text-base">{categoryLabel(a.category)}</TableCell>
                        <TableCell className="text-base">{deptLabel(a.department)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {format(a.startDate, "yyyy/MM/dd")} – {format(a.endDate, "yyyy/MM/dd")}
                        </TableCell>
                        <TableCell>{statusBadge(status)}</TableCell>
                        <TableCell className="text-right space-x-1">
                          <Button size="sm" variant="ghost" onClick={() => startEditing(a)} className="text-muted-foreground hover:text-foreground">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleDelete(a.id)} className="text-destructive hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2">
              <Pencil className="h-5 w-5" />
              {texts.editTitle[language]}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Subject */}
            <div className="space-y-2">
              <Label className="text-base font-semibold">{t("subject")}</Label>
              <Input value={editSubject} onChange={(e) => setEditSubject(e.target.value)} placeholder={t("subjectPh")} className="h-12 text-lg font-medium" />
            </div>

            {/* Department & Category */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-base font-semibold">{t("dept")}</Label>
                <Select value={editDepartment} onValueChange={setEditDepartment}>
                  <SelectTrigger className="h-12 text-base"><SelectValue placeholder={t("deptPh")} /></SelectTrigger>
                  <SelectContent>
                    {DEPARTMENTS.map((d) => (
                      <SelectItem key={d.value} value={d.value}>{d.label[language]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-base font-semibold">{t("categoryLabel")}</Label>
                <Select value={editCategory} onValueChange={setEditCategory}>
                  <SelectTrigger className="h-12 text-base"><SelectValue placeholder={t("categoryPh")} /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label[language]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Pinned */}
            <div className="flex items-center justify-between rounded-xl border border-border p-4">
              <div className="space-y-0.5">
                <Label className="text-base font-semibold flex items-center gap-2">
                  <Pin className="h-4 w-4 text-amber-500" />
                  {t("pinnedLabel")}
                </Label>
                <p className="text-sm text-muted-foreground">{t("pinnedDesc")}</p>
              </div>
              <Switch checked={editPinned} onCheckedChange={setEditPinned} />
            </div>

            {/* Content */}
            <div className="space-y-2">
              <Label className="text-base font-semibold">{t("contentLabel")}</Label>
              <RichTextEditor
                content={editContent}
                onChange={setEditContent}
                placeholder={t("contentPh")}
                minHeight="120px"
              />
            </div>

            {/* Image */}
            <div className="space-y-2">
              <Label className="text-base font-semibold">{t("imageLabel")}</Label>
              <div
                onClick={() => editFileInputRef.current?.click()}
                className={cn(
                  "relative border-2 border-dashed rounded-xl cursor-pointer transition-all duration-200 hover:border-primary hover:bg-primary/5 flex flex-col items-center justify-center",
                  editImageUrl ? "h-36 border-primary/40" : "h-24 border-border"
                )}
              >
                {editImageUrl ? (
                  <>
                    <img src={editImageUrl} alt="preview" className="h-full w-full object-contain rounded-lg p-2" />
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditImageUrl(null); }}
                      className="absolute top-2 right-2 bg-destructive text-destructive-foreground rounded-full p-1 hover:opacity-80"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </>
                ) : (
                  <>
                    <Upload className="h-6 w-6 text-muted-foreground mb-1" />
                    <p className="text-xs text-muted-foreground">{t("imageDrop")}</p>
                  </>
                )}
                <input ref={editFileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleEditImageUpload(f); }} />
              </div>
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-base font-semibold">{t("startTime")}</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full h-12 justify-start text-left text-base", !editStartDate && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {editStartDate ? format(editStartDate, "yyyy/MM/dd") : t("pickDate")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={editStartDate} onSelect={setEditStartDate} initialFocus className="p-3 pointer-events-auto" />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label className="text-base font-semibold">{t("endTime")}</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full h-12 justify-start text-left text-base", !editEndDate && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {editEndDate ? format(editEndDate, "yyyy/MM/dd") : t("pickDate")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={editEndDate} onSelect={setEditEndDate} initialFocus className="p-3 pointer-events-auto" />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>{texts.cancelBtn[language]}</Button>
            <Button onClick={saveEditing} className="bg-gradient-to-r from-orange-500 to-amber-500 text-white border-0 hover:opacity-90">
              <Save className="mr-2 h-4 w-4" />
              {texts.saveBtn[language]}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settings Dialog */}
      <AnnouncementSettings
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        departments={DEPARTMENTS}
        categories={CATEGORIES}
        onDepartmentsChange={handleDepartmentsChange}
        onCategoriesChange={handleCategoriesChange}
      />
    </div>
  );
};

export default AnnouncementPage;
