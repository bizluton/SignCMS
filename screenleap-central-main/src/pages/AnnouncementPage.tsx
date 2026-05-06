import { useState, useRef, useMemo, useEffect, useCallback } from "react";
import DOMPurify from "dompurify";
import { useLanguage } from "@/contexts/LanguageContext";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import RichTextEditor from "@/components/announcement/RichTextEditor";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Megaphone, Upload, Send, Monitor, Smartphone,
  Trash2, ImageIcon, Pin, Pencil, Save, Settings, Loader2,
} from "lucide-react";
import AnnouncementSettings, { type LabelItem, type DbCategory } from "@/components/announcement/AnnouncementSettings";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

// ── DB types ──────────────────────────────────────────────────────────────────
interface DbAnnouncement {
  id: string;
  org_id: string;
  team_id: string | null;
  category_id: string | null;
  subject: string;
  content: string;
  image_url: string | null;
  department: string;
  pinned: boolean;
  dwell_seconds: number;
  start_at: string;
  end_at: string;
  created_at: string;
  category?: { name: string; color: string } | null;
}

interface OrgTeam { id: string; name: string; }

// ── localStorage helpers (departments only) ───────────────────────────────────
const DEFAULT_DEPARTMENTS: LabelItem[] = [
  { value: "hq",          label: { zh: "總管理處", en: "Headquarters", ja: "本部" } },
  { value: "marketing",   label: { zh: "行銷部",   en: "Marketing",    ja: "マーケティング部" } },
  { value: "maintenance", label: { zh: "維修組",   en: "Maintenance",  ja: "メンテナンス" } },
  { value: "hr",          label: { zh: "人事部",   en: "HR",           ja: "人事部" } },
  { value: "ops",         label: { zh: "營運部",   en: "Operations",   ja: "運営部" } },
];

function orgKey(base: string, orgId: string | null) {
  return orgId ? `${base}:${orgId}` : base;
}

function loadDepts(orgId: string | null): LabelItem[] {
  try {
    const s = localStorage.getItem(orgKey("signboard-departments", orgId));
    if (s) return JSON.parse(s) as LabelItem[];
  } catch { /* */ }
  return DEFAULT_DEPARTMENTS;
}

// ── Image upload helper ───────────────────────────────────────────────────────
async function uploadImage(dataUrl: string, orgId: string): Promise<string | null> {
  if (!dataUrl.startsWith("data:")) return dataUrl; // already a remote URL
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const mime = match[1];
  const ext  = mime.split("/")[1] || "jpg";
  const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
  const blob  = new Blob([bytes], { type: mime });
  const path  = `announcement-images/${orgId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("media").upload(path, blob, { contentType: mime });
  if (error) { toast.error("圖片上傳失敗"); return null; }
  const { data } = supabase.storage.from("media").getPublicUrl(path);
  return data.publicUrl;
}

// ── Component ─────────────────────────────────────────────────────────────────
const AnnouncementPage = () => {
  const { language, t: globalT } = useLanguage();
  const { activeOrgId } = useActiveOrg();
  const { user } = useAuth();

  // ── Text ──────────────────────────────────────────────────────────────────
  const texts = {
    pageTitle:      { zh: "公告發佈管理",       en: "Announcement Manager",      ja: "お知らせ管理" },
    tabEdit:        { zh: "新增公告",           en: "New Announcement",           ja: "新規作成" },
    tabList:        { zh: "公告列表",           en: "Announcement List",          ja: "お知らせ一覧" },
    subject:        { zh: "公告主旨",           en: "Subject",                    ja: "件名" },
    subjectPh:      { zh: "例如：年終特賣、緊急停電通知", en: "e.g. Year-End Sale, Emergency Notice", ja: "例：年末セール、緊急停電通知" },
    dept:           { zh: "發佈單位",           en: "Department",                 ja: "発信部署" },
    deptPh:         { zh: "選擇發佈單位",        en: "Select department",          ja: "部署を選択" },
    categoryLabel:  { zh: "公告類別",           en: "Category",                   ja: "カテゴリ" },
    categoryPh:     { zh: "選擇公告類別",        en: "Select category",            ja: "カテゴリを選択" },
    pinnedLabel:    { zh: "重要公告置頂",        en: "Pin as Important",           ja: "重要：トップに固定" },
    pinnedDesc:     { zh: "開啟後此公告將置頂顯示", en: "This announcement will be pinned to the top", ja: "このお知らせをトップに固定します" },
    contentLabel:   { zh: "公告內容",           en: "Content",                    ja: "内容" },
    contentPh:      { zh: "輸入公告的詳細內容…",  en: "Enter announcement details…", ja: "お知らせの詳細を入力…" },
    imageLabel:     { zh: "附件圖片",           en: "Attachment Image",           ja: "添付画像" },
    imageDrop:      { zh: "拖放圖片至此，或點擊上傳", en: "Drag & drop or click to upload", ja: "ドラッグ＆ドロップまたはクリック" },
    startTime:      { zh: "上架時間",           en: "Start Time",                 ja: "開始日時" },
    endTime:        { zh: "下架時間",           en: "End Time",                   ja: "終了日時" },
    pickDate:       { zh: "選擇日期",           en: "Pick a date",                ja: "日付を選択" },
    dwellLabel:     { zh: "停留秒數",           en: "Dwell Seconds",              ja: "表示秒数" },
    preview:        { zh: "即時模擬預覽",        en: "Live Preview",               ja: "リアルタイムプレビュー" },
    landscape:      { zh: "橫式螢幕",           en: "Landscape",                  ja: "横型" },
    portrait:       { zh: "直式螢幕",           en: "Portrait",                   ja: "縦型" },
    publish:        { zh: "確認發佈",           en: "Publish",                    ja: "公開する" },
    noContent:      { zh: "請在左側輸入公告內容…", en: "Enter content on the left…", ja: "左側に内容を入力してください…" },
    statusActive:   { zh: "進行中",             en: "Active",                     ja: "配信中" },
    statusExpired:  { zh: "已過期",             en: "Expired",                    ja: "終了" },
    statusPending:  { zh: "尚未開始",           en: "Pending",                    ja: "配信前" },
    colSubject:     { zh: "主旨",              en: "Subject",                     ja: "件名" },
    colCategory:    { zh: "類別",              en: "Category",                    ja: "カテゴリ" },
    colDept:        { zh: "發佈單位",           en: "Department",                  ja: "部署" },
    colPeriod:      { zh: "時間區間",           en: "Period",                      ja: "期間" },
    colStatus:      { zh: "狀態",              en: "Status",                      ja: "ステータス" },
    colActions:     { zh: "操作",              en: "Actions",                     ja: "操作" },
    noAnnouncements:{ zh: "尚無公告紀錄",       en: "No announcements yet",        ja: "お知らせはまだありません" },
    successPublish: { zh: "公告已成功發佈！",    en: "Announcement published!",     ja: "お知らせを公開しました！" },
    errorFill:      { zh: "請填寫主旨、內容、起訖時間", en: "Please fill in subject, content, and dates", ja: "件名・内容・日時を入力してください" },
    deleted:        { zh: "已刪除公告",         en: "Announcement deleted",        ja: "お知らせを削除しました" },
    pinnedTag:      { zh: "📌 置頂",            en: "📌 Pinned",                   ja: "📌 固定" },
    successEdit:    { zh: "公告已更新",         en: "Announcement updated",        ja: "お知らせを更新しました" },
    editTitle:      { zh: "編輯公告",           en: "Edit Announcement",           ja: "お知らせを編集" },
    cancelBtn:      { zh: "取消",              en: "Cancel",                      ja: "キャンセル" },
    saveBtn:        { zh: "儲存變更",           en: "Save Changes",                ja: "変更を保存" },
    selectOrgFirst: { zh: "請先選擇組織",        en: "Please select an organisation", ja: "組織を選択してください" },
    teamLabel:      { zh: "發布對象",            en: "Audience",                      ja: "配信対象" },
    teamPh:         { zh: "選擇團隊（留空 = 全組織）", en: "Select team (empty = org-wide)", ja: "チーム（空欄=組織全体）" },
    teamAll:        { zh: "全組織",             en: "Org-wide",                       ja: "組織全体" },
    colTeam:        { zh: "對象",               en: "Audience",                       ja: "配信対象" },
  };
  const t = (key: keyof typeof texts) => texts[key][language];

  // ── State: departments (localStorage) ────────────────────────────────────
  const [DEPARTMENTS, setDepartments] = useState<LabelItem[]>(() => loadDepts(activeOrgId));

  const handleDepartmentsChange = (items: LabelItem[]) => {
    setDepartments(items);
    localStorage.setItem(orgKey("signboard-departments", activeOrgId), JSON.stringify(items));
  };

  // ── State: teams (Supabase) ───────────────────────────────────────────────
  const [teams, setTeams] = useState<OrgTeam[]>([]);

  const loadTeams = useCallback(async (oid: string) => {
    const { data } = await supabase.from("teams").select("id, name").eq("org_id", oid).order("name");
    if (data) setTeams(data as OrgTeam[]);
  }, []);

  // ── State: categories (Supabase) ──────────────────────────────────────────
  const [categories, setCategories] = useState<DbCategory[]>([]);

  const loadCategories = useCallback(async (oid: string) => {
    const { data } = await supabase
      .from("announcement_categories")
      .select("id, name, color, sort_order")
      .eq("org_id", oid)
      .order("sort_order")
      .order("created_at");
    if (data) setCategories(data as DbCategory[]);
  }, []);

  const handleAddCategory = async (name: string, color: string) => {
    if (!activeOrgId) { toast.error(t("selectOrgFirst")); return; }
    const { error } = await supabase.from("announcement_categories").insert({
      org_id: activeOrgId, name, color,
      sort_order: categories.length,
      created_by: user?.id,
    });
    if (error) { toast.error(error.message); return; }
    await loadCategories(activeOrgId);
  };

  const handleDeleteCategory = async (id: string) => {
    const { error } = await supabase.from("announcement_categories").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    if (activeOrgId) await loadCategories(activeOrgId);
  };

  // ── State: announcements (Supabase) ───────────────────────────────────────
  const [announcements, setAnnouncements] = useState<DbAnnouncement[]>([]);
  const [loading, setLoading] = useState(false);

  const loadAnnouncements = useCallback(async (oid: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from("announcements")
      .select("*, category:announcement_categories(name,color)")
      .eq("org_id", oid)
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false });
    if (!error && data) setAnnouncements(data as DbAnnouncement[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!activeOrgId) { setAnnouncements([]); setCategories([]); setTeams([]); return; }
    void loadAnnouncements(activeOrgId);
    void loadCategories(activeOrgId);
    void loadTeams(activeOrgId);
    setDepartments(loadDepts(activeOrgId));
  }, [activeOrgId, loadAnnouncements, loadCategories, loadTeams]);

  // ── Form state ────────────────────────────────────────────────────────────
  const [subject,     setSubject]     = useState("");
  const [teamId,      setTeamId]      = useState("");
  const [department,  setDepartment]  = useState("");
  const [categoryId,  setCategoryId]  = useState("");
  const [pinned,      setPinned]      = useState(false);
  const [content,     setContent]     = useState("");
  const [imageUrl,    setImageUrl]    = useState<string | null>(null);
  const [startDate,   setStartDate]   = useState<Date | undefined>();
  const [endDate,     setEndDate]     = useState<Date | undefined>();
  const [dwell,       setDwell]       = useState(10);
  const [publishing,  setPublishing]  = useState(false);
  const [previewMode, setPreviewMode] = useState<"landscape" | "portrait">("landscape");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);

  const handleImageSelect = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => setImageUrl(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handlePublish = async () => {
    if (!subject.trim() || !content || content === "<p></p>" || !startDate || !endDate) {
      toast.error(t("errorFill")); return;
    }
    if (!activeOrgId) { toast.error(t("selectOrgFirst")); return; }
    setPublishing(true);
    try {
      let finalImageUrl: string | null = null;
      if (imageUrl) {
        finalImageUrl = await uploadImage(imageUrl, activeOrgId);
      }
      const { error } = await supabase.from("announcements").insert({
        org_id:        activeOrgId,
        team_id:       teamId || null,
        category_id:   categoryId || null,
        subject:       subject.trim(),
        content,
        image_url:     finalImageUrl,
        department,
        pinned,
        dwell_seconds: dwell,
        start_at:      startDate.toISOString(),
        end_at:        endDate.toISOString(),
        created_by:    user?.id,
      });
      if (error) { toast.error(error.message); return; }
      toast.success(t("successPublish"));
      setSubject(""); setTeamId(""); setDepartment(""); setCategoryId("");
      setPinned(false); setContent(""); setImageUrl(null);
      setStartDate(undefined); setEndDate(undefined); setDwell(10);
      await loadAnnouncements(activeOrgId);
    } finally {
      setPublishing(false);
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("announcements").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success(t("deleted"));
    if (activeOrgId) await loadAnnouncements(activeOrgId);
  };

  // ── Edit dialog ───────────────────────────────────────────────────────────
  const [editOpen,        setEditOpen]        = useState(false);
  const [editTarget,      setEditTarget]      = useState<DbAnnouncement | null>(null);
  const [editSubject,     setEditSubject]     = useState("");
  const [editTeamId,      setEditTeamId]      = useState("");
  const [editDepartment,  setEditDepartment]  = useState("");
  const [editCategoryId,  setEditCategoryId]  = useState("");
  const [editPinned,      setEditPinned]      = useState(false);
  const [editContent,     setEditContent]     = useState("");
  const [editImageUrl,    setEditImageUrl]    = useState<string | null>(null);
  const [editStartDate,   setEditStartDate]   = useState<Date | undefined>();
  const [editEndDate,     setEditEndDate]     = useState<Date | undefined>();
  const [editDwell,       setEditDwell]       = useState(10);
  const [editSaving,      setEditSaving]      = useState(false);
  const editFileRef = useRef<HTMLInputElement>(null);

  const startEditing = (a: DbAnnouncement) => {
    setEditTarget(a);
    setEditSubject(a.subject);
    setEditTeamId(a.team_id || "");
    setEditDepartment(a.department);
    setEditCategoryId(a.category_id || "");
    setEditPinned(a.pinned);
    setEditContent(a.content);
    setEditImageUrl(a.image_url);
    setEditStartDate(new Date(a.start_at));
    setEditEndDate(new Date(a.end_at));
    setEditDwell(a.dwell_seconds);
    setEditOpen(true);
  };

  const saveEditing = async () => {
    if (!editTarget) return;
    if (!editSubject.trim() || !editContent || editContent === "<p></p>" || !editStartDate || !editEndDate) {
      toast.error(t("errorFill")); return;
    }
    if (!activeOrgId) return;
    setEditSaving(true);
    try {
      let finalImageUrl = editImageUrl;
      if (editImageUrl && editImageUrl.startsWith("data:")) {
        finalImageUrl = await uploadImage(editImageUrl, activeOrgId);
      }
      const { error } = await supabase.from("announcements").update({
        team_id:       editTeamId || null,
        category_id:   editCategoryId || null,
        subject:       editSubject.trim(),
        content:       editContent,
        image_url:     finalImageUrl,
        department:    editDepartment,
        pinned:        editPinned,
        dwell_seconds: editDwell,
        start_at:      editStartDate.toISOString(),
        end_at:        editEndDate.toISOString(),
        updated_at:    new Date().toISOString(),
      }).eq("id", editTarget.id);
      if (error) { toast.error(error.message); return; }
      toast.success(texts.successEdit[language]);
      setEditOpen(false); setEditTarget(null);
      await loadAnnouncements(activeOrgId);
    } finally {
      setEditSaving(false);
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const getStatus = (a: DbAnnouncement) => {
    const now = new Date();
    if (now < new Date(a.start_at)) return "pending";
    if (now > new Date(a.end_at))   return "expired";
    return "active";
  };

  const statusBadge = (status: string) => {
    const map = {
      active:  { label: t("statusActive"),  className: "bg-emerald-500/90 hover:bg-emerald-500 text-white border-0" },
      expired: { label: t("statusExpired"), className: "bg-muted text-muted-foreground" },
      pending: { label: t("statusPending"), className: "border-amber-500 text-amber-600" },
    };
    const s = map[status as keyof typeof map];
    return <Badge variant="outline" className={s.className}>{s.label}</Badge>;
  };

  const deptLabel  = (val: string) => DEPARTMENTS.find((d) => d.value === val)?.label[language] || val || "—";
  const teamName   = (id: string | null) => teams.find((t) => t.id === id)?.name || null;
  const catForId   = (id: string | null) => categories.find((c) => c.id === id) ?? null;

  const sortedAnnouncements = useMemo(() =>
    [...announcements].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }), [announcements]);

  const hasContent = subject || (content && content !== "<p></p>") || imageUrl;

  // ── Date range picker helper (kept for layout consistency) ────────────────

  // ── Preview helpers ───────────────────────────────────────────────────────
  const previewCat = catForId(categoryId);

  // ── Render ────────────────────────────────────────────────────────────────
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
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t("subjectPh")} className="h-12 text-lg font-medium" />
              </div>

              {/* Audience (Team) + Department */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label className="text-base font-semibold">{t("teamLabel")}</Label>
                  <Select value={teamId || "__all__"} onValueChange={(v) => setTeamId(v === "__all__" ? "" : v)}>
                    <SelectTrigger className="h-12 text-base"><SelectValue placeholder={t("teamPh")} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__" className="text-base">{t("teamAll")}</SelectItem>
                      {teams.map((tm) => (
                        <SelectItem key={tm.id} value={tm.id} className="text-base">{tm.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-base font-semibold">{t("dept")}</Label>
                  <Select value={department} onValueChange={setDepartment}>
                    <SelectTrigger className="h-12 text-base"><SelectValue placeholder={t("deptPh")} /></SelectTrigger>
                    <SelectContent>
                      {DEPARTMENTS.map((d) => (
                        <SelectItem key={d.value} value={d.value} className="text-base">{d.label[language]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-base font-semibold">{t("categoryLabel")}</Label>
                  <Select value={categoryId} onValueChange={setCategoryId}>
                    <SelectTrigger className="h-12 text-base"><SelectValue placeholder={t("categoryPh")} /></SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id} className="text-base">
                          <span className="flex items-center gap-2">
                            <span className="inline-block w-3 h-3 rounded-full shrink-0" style={{ background: c.color }} />
                            {c.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Pinned */}
              <div className="flex items-center justify-between rounded-xl border border-border p-4">
                <div className="space-y-0.5">
                  <Label className="text-base font-semibold flex items-center gap-2">
                    <Pin className="h-4 w-4 text-amber-500" />{t("pinnedLabel")}
                  </Label>
                  <p className="text-sm text-muted-foreground">{t("pinnedDesc")}</p>
                </div>
                <Switch checked={pinned} onCheckedChange={setPinned} />
              </div>

              {/* Content */}
              <div className="space-y-2">
                <Label className="text-base font-semibold">{t("contentLabel")}</Label>
                <RichTextEditor content={content} onChange={setContent} placeholder={t("contentPh")} minHeight="160px" />
              </div>

              {/* Image */}
              <div className="space-y-2">
                <Label className="text-base font-semibold">{t("imageLabel")}</Label>
                <div
                  onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleImageSelect(f); }}
                  onDragOver={(e) => e.preventDefault()}
                  onClick={() => fileInputRef.current?.click()}
                  className={cn("relative border-2 border-dashed rounded-xl cursor-pointer transition-all duration-200 hover:border-primary hover:bg-primary/5 flex flex-col items-center justify-center",
                    imageUrl ? "h-48 border-primary/40" : "h-36 border-border")}
                >
                  {imageUrl ? (
                    <>
                      <img src={imageUrl} alt="preview" className="h-full w-full object-contain rounded-lg p-2" />
                      <button onClick={(e) => { e.stopPropagation(); setImageUrl(null); }}
                        className="absolute top-2 right-2 bg-destructive text-destructive-foreground rounded-full p-1 hover:opacity-80">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </button>
                    </>
                  ) : (
                    <><Upload className="h-8 w-8 text-muted-foreground mb-2" /><p className="text-sm text-muted-foreground">{t("imageDrop")}</p></>
                  )}
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageSelect(f); }} />
                </div>
              </div>

              {/* Dates + Dwell */}
              <div className="space-y-2">
                <Label className="text-base font-semibold">{t("startTime")} ~ {t("endTime")}</Label>
                <DateRangePicker
                  from={startDate}
                  to={endDate}
                  onChange={({ from, to }) => { setStartDate(from); setEndDate(to); }}
                  placeholder={`${t("pickDate")} ~ ${t("pickDate")}`}
                  clearable
                />
              </div>
              <div className="space-y-2">
                <Label className="text-base font-semibold">{t("dwellLabel")} (3–60 秒)</Label>
                <Input type="number" min={3} max={60} value={dwell}
                  onChange={(e) => setDwell(Math.max(3, Math.min(60, parseInt(e.target.value) || 10)))}
                  className="h-12 text-base w-32" />
              </div>
            </div>

            {/* Right: Live Preview */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <Monitor className="h-5 w-5" />{t("preview")}
                </h2>
                <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
                  <Button size="sm" variant={previewMode === "landscape" ? "default" : "ghost"} onClick={() => setPreviewMode("landscape")} className="text-xs h-8 gap-1">
                    <Monitor className="h-3.5 w-3.5" />{t("landscape")}
                  </Button>
                  <Button size="sm" variant={previewMode === "portrait" ? "default" : "ghost"} onClick={() => setPreviewMode("portrait")} className="text-xs h-8 gap-1">
                    <Smartphone className="h-3.5 w-3.5" />{t("portrait")}
                  </Button>
                </div>
              </div>

              <div className="flex justify-center">
                <div className={cn("relative bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl border-4 border-gray-700 shadow-2xl overflow-hidden transition-all duration-300",
                  previewMode === "landscape" ? "w-full aspect-video" : "w-[280px] aspect-[9/16]")}>
                  {hasContent ? (
                    <div className="absolute inset-0 flex flex-col">
                      {/* Accent top bar */}
                      <div className="bg-gradient-to-r from-orange-600/90 to-amber-500/90 px-4 py-2 flex items-center gap-2 shrink-0">
                        <Megaphone className="h-3.5 w-3.5 text-white shrink-0" />
                        <p className="text-white text-xs font-bold truncate">
                          {subject || "公告"}
                        </p>
                        {pinned && <span className="ml-auto text-[10px] text-white/80 shrink-0">📌</span>}
                      </div>
                      {imageUrl && (
                        <div className={cn("relative", previewMode === "landscape" ? "h-1/2" : "h-2/5")}>
                          <img src={imageUrl} alt="" className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-gray-900/60" />
                        </div>
                      )}
                      <div className={cn("flex-1 flex flex-col justify-end p-4", imageUrl ? "" : "justify-center")}>
                        {previewCat && (
                          <span className="inline-flex items-center gap-1.5 mb-1 text-[10px] font-bold uppercase tracking-widest" style={{ color: previewCat.color }}>
                            <span className="w-2 h-2 rounded-full inline-block" style={{ background: previewCat.color }} />
                            {previewCat.name}
                          </span>
                        )}
                        {department && (
                          <span className="text-amber-400 text-[10px] font-bold uppercase tracking-widest mb-1">{deptLabel(department)}</span>
                        )}
                        <h3 className={cn("text-white font-black leading-tight mb-2", previewMode === "landscape" ? "text-xl" : "text-base")}>
                          {subject || "…"}
                        </h3>
                        <div
                          className={cn("text-white/70 line-clamp-3", previewMode === "landscape" ? "text-sm" : "text-xs")}
                          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content || "<p>…</p>") }}
                        />
                        {startDate && endDate && (
                          <p className="text-white/40 text-[10px] mt-2">{format(startDate, "MM/dd")} – {format(endDate, "MM/dd")} · {dwell}s</p>
                        )}
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

              <Button onClick={handlePublish} disabled={publishing} size="lg"
                className="w-full h-14 text-lg font-bold bg-gradient-to-r from-orange-500 to-amber-500 hover:opacity-90 border-0 text-white shadow-lg">
                {publishing ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Send className="mr-2 h-5 w-5" />}
                {t("publish")}
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* ===== List Tab ===== */}
        <TabsContent value="list">
          {loading ? (
            <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin opacity-40" /></div>
          ) : sortedAnnouncements.length === 0 ? (
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
                    <TableHead className="text-base">{t("colTeam")}</TableHead>
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
                    const cat    = a.category;
                    return (
                      <TableRow key={a.id} className={a.pinned ? "bg-amber-500/5" : ""}>
                        <TableCell className="font-semibold text-base max-w-[240px] truncate">
                          {a.pinned && <Badge variant="outline" className="mr-2 border-amber-500 text-amber-600 text-[10px]">{t("pinnedTag")}</Badge>}
                          {a.subject}
                        </TableCell>
                        <TableCell className="text-sm">
                          {a.team_id ? (
                            <Badge variant="outline" className="border-blue-400 text-blue-500 text-[11px]">
                              {teamName(a.team_id) ?? a.team_id.slice(0, 8)}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">{t("teamAll")}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {cat ? (
                            <span className="inline-flex items-center gap-1.5 text-sm">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: cat.color }} />
                              {cat.name}
                            </span>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-base">{deptLabel(a.department)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {format(new Date(a.start_at), "yyyy/MM/dd")} – {format(new Date(a.end_at), "yyyy/MM/dd")}
                        </TableCell>
                        <TableCell>{statusBadge(status)}</TableCell>
                        <TableCell className="text-right space-x-1">
                          <Button size="sm" variant="ghost" onClick={() => startEditing(a)} className="text-muted-foreground hover:text-foreground">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleDelete(a.id)} className="text-destructive hover:text-destructive">
                            <Trash2 className="h-4 w-4 text-destructive" />
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

      {/* ── Edit Dialog ── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2">
              <Pencil className="h-5 w-5" />{texts.editTitle[language]}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <Label className="text-base font-semibold">{t("subject")}</Label>
              <Input value={editSubject} onChange={(e) => setEditSubject(e.target.value)} placeholder={t("subjectPh")} className="h-12 text-lg font-medium" />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label className="text-base font-semibold">{t("teamLabel")}</Label>
                <Select value={editTeamId || "__all__"} onValueChange={(v) => setEditTeamId(v === "__all__" ? "" : v)}>
                  <SelectTrigger className="h-12 text-base"><SelectValue placeholder={t("teamPh")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">{t("teamAll")}</SelectItem>
                    {teams.map((tm) => <SelectItem key={tm.id} value={tm.id}>{tm.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-base font-semibold">{t("dept")}</Label>
                <Select value={editDepartment} onValueChange={setEditDepartment}>
                  <SelectTrigger className="h-12 text-base"><SelectValue placeholder={t("deptPh")} /></SelectTrigger>
                  <SelectContent>
                    {DEPARTMENTS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label[language]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-base font-semibold">{t("categoryLabel")}</Label>
                <Select value={editCategoryId} onValueChange={setEditCategoryId}>
                  <SelectTrigger className="h-12 text-base"><SelectValue placeholder={t("categoryPh")} /></SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        <span className="flex items-center gap-2">
                          <span className="inline-block w-3 h-3 rounded-full shrink-0" style={{ background: c.color }} />
                          {c.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border p-4">
              <div className="space-y-0.5">
                <Label className="text-base font-semibold flex items-center gap-2">
                  <Pin className="h-4 w-4 text-amber-500" />{t("pinnedLabel")}
                </Label>
                <p className="text-sm text-muted-foreground">{t("pinnedDesc")}</p>
              </div>
              <Switch checked={editPinned} onCheckedChange={setEditPinned} />
            </div>
            <div className="space-y-2">
              <Label className="text-base font-semibold">{t("contentLabel")}</Label>
              <RichTextEditor content={editContent} onChange={setEditContent} placeholder={t("contentPh")} minHeight="120px" />
            </div>
            <div className="space-y-2">
              <Label className="text-base font-semibold">{t("imageLabel")}</Label>
              <div onClick={() => editFileRef.current?.click()}
                className={cn("relative border-2 border-dashed rounded-xl cursor-pointer transition-all hover:border-primary hover:bg-primary/5 flex flex-col items-center justify-center",
                  editImageUrl ? "h-36 border-primary/40" : "h-24 border-border")}>
                {editImageUrl ? (
                  <>
                    <img src={editImageUrl} alt="preview" className="h-full w-full object-contain rounded-lg p-2" />
                    <button onClick={(e) => { e.stopPropagation(); setEditImageUrl(null); }}
                      className="absolute top-2 right-2 bg-destructive text-destructive-foreground rounded-full p-1 hover:opacity-80">
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </button>
                  </>
                ) : (
                  <><Upload className="h-6 w-6 text-muted-foreground mb-1" /><p className="text-xs text-muted-foreground">{t("imageDrop")}</p></>
                )}
                <input ref={editFileRef} type="file" accept="image/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) { const r = new FileReader(); r.onload = (ev) => setEditImageUrl(ev.target?.result as string); r.readAsDataURL(f); }}} />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-base font-semibold">{t("startTime")} ~ {t("endTime")}</Label>
              <DateRangePicker
                from={editStartDate}
                to={editEndDate}
                onChange={({ from, to }) => { setEditStartDate(from); setEditEndDate(to); }}
                placeholder={`${t("pickDate")} ~ ${t("pickDate")}`}
                clearable
              />
            </div>
            <div className="space-y-2">
              <Label className="text-base font-semibold">{t("dwellLabel")} (3–60 秒)</Label>
              <Input type="number" min={3} max={60} value={editDwell}
                onChange={(e) => setEditDwell(Math.max(3, Math.min(60, parseInt(e.target.value) || 10)))}
                className="h-12 text-base w-32" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>{t("cancelBtn")}</Button>
            <Button onClick={saveEditing} disabled={editSaving} className="gap-2">
              {editSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {t("saveBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Settings Dialog ── */}
      <AnnouncementSettings
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        departments={DEPARTMENTS}
        onDepartmentsChange={handleDepartmentsChange}
        categories={categories}
        onAddCategory={handleAddCategory}
        onDeleteCategory={handleDeleteCategory}
      />
    </div>
  );
};

export default AnnouncementPage;
