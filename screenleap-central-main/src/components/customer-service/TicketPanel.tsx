import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useProfiles } from "@/contexts/ProfilesContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Loader2, Plus, Search, AlertTriangle, Clock, CheckCircle2, XCircle,
  ArrowUpCircle, ChevronRight, User, MessageCircle, Pencil, Send, Trash2, AtSign,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Ticket {
  id: string;
  session_id: string | null;
  title: string;
  description: string;
  priority: string;
  status: string;
  assigned_to: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  // joined
  session_subject?: string;
  /** Customer's user_id for the linked chat session, used to look up display_name. */
  customer_user_id?: string;
}

interface TicketComment {
  id: string;
  ticket_id: string;
  content: string;
  created_by: string;
  created_at: string;
}

interface AdminProfile {
  user_id: string;
}

const PRIORITY_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  low: { label: "低", color: "bg-muted text-muted-foreground", icon: null },
  medium: { label: "中", color: "bg-blue-500/10 text-blue-500 border-blue-500/20", icon: null },
  high: { label: "高", color: "bg-orange-500/10 text-orange-500 border-orange-500/20", icon: <AlertTriangle className="h-3 w-3" /> },
  urgent: { label: "緊急", color: "bg-destructive/10 text-destructive border-destructive/20", icon: <AlertTriangle className="h-3 w-3" /> },
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  open: { label: "待處理", color: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20", icon: <Clock className="h-3 w-3" /> },
  in_progress: { label: "處理中", color: "bg-blue-500/10 text-blue-500 border-blue-500/20", icon: <ArrowUpCircle className="h-3 w-3" /> },
  resolved: { label: "已解決", color: "bg-green-500/10 text-green-600 border-green-500/20", icon: <CheckCircle2 className="h-3 w-3" /> },
  closed: { label: "已關閉", color: "bg-muted text-muted-foreground", icon: <XCircle className="h-3 w-3" /> },
};

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("zh-TW", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

interface TicketPanelProps {
  sessionId?: string | null;
  sessionSubject?: string | null;
  customerName?: string | null;
  onCreated?: () => void;
}

const TicketPanel = ({ sessionId, sessionSubject, customerName, onCreated }: TicketPanelProps) => {
  const { t, language } = useLanguage();
  const { ensureProfiles, getDisplayName, profilesVersion } = useProfiles();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState<Ticket | null>(null);
  const [admins, setAdmins] = useState<AdminProfile[]>([]);

  // Form state
  const [formTitle, setFormTitle] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formPriority, setFormPriority] = useState("medium");
  const [formAssignee, setFormAssignee] = useState<string>("none");
  const [formSaving, setFormSaving] = useState(false);

  // Edit state
  const [editing, setEditing] = useState(false);

  // Comments state
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commentSaving, setCommentSaving] = useState(false);

  // Mention state
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const commentRef = useRef<HTMLTextAreaElement>(null);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("support_tickets")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      setLoading(false);
      return;
    }

    // Enrich session info (subject + customer user_id), then push all user_ids
    // through ProfilesContext so creator/assignee/customer names render via cache.
    const sessionIds = [...new Set((data || []).map(t => t.session_id).filter(Boolean))];
    const sessionMap = new Map<string, { subject: string | null; customer_user_id: string | null }>();
    if (sessionIds.length > 0) {
      const { data: sessData } = await supabase
        .from("customer_chat_sessions")
        .select("id, subject, user_id")
        .in("id", sessionIds as string[]);
      sessData?.forEach(s => {
        sessionMap.set(s.id, { subject: s.subject, customer_user_id: s.user_id });
      });
    }

    const enriched = (data || []).map(t => ({
      ...t,
      session_subject: t.session_id ? sessionMap.get(t.session_id)?.subject || undefined : undefined,
      customer_user_id: t.session_id ? sessionMap.get(t.session_id)?.customer_user_id || undefined : undefined,
    }));

    const allUserIds = new Set<string>();
    for (const t of enriched) {
      allUserIds.add(t.created_by);
      if (t.assigned_to) allUserIds.add(t.assigned_to);
      if (t.customer_user_id) allUserIds.add(t.customer_user_id);
    }
    await ensureProfiles([...allUserIds]);

    setTickets(enriched);
    setLoading(false);
  }, [ensureProfiles]);

  const loadAdmins = useCallback(async () => {
    const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
    if (!roles) return;
    const ids = roles.map(r => r.user_id);
    await ensureProfiles(ids);
    setAdmins(ids.map(user_id => ({ user_id })));
  }, [ensureProfiles]);

  useEffect(() => { loadTickets(); loadAdmins(); }, [loadTickets, loadAdmins]);

  // Auto-open create dialog when sessionId is provided via URL
  const autoOpenDone = useRef(false);
  useEffect(() => {
    if (sessionId && !autoOpenDone.current) {
      autoOpenDone.current = true;
      openCreate();
    }
  }, [sessionId]);

  // Resolve admin names against the profile cache; recompute when cache changes.
  const adminsWithNames = useMemo(
    () => admins.map(a => ({ user_id: a.user_id, display_name: getDisplayName(a.user_id, "") || null })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [admins, profilesVersion]
  );

  const loadComments = useCallback(async (ticketId: string) => {
    setCommentsLoading(true);
    const { data } = await supabase
      .from("ticket_comments")
      .select("*")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true });
    const userIds = [...new Set((data || []).map(c => c.created_by))];
    if (userIds.length > 0) await ensureProfiles(userIds);
    setComments(data || []);
    setCommentsLoading(false);
  }, [ensureProfiles]);

  const handleAddComment = async () => {
    if (!showDetail || !commentText.trim()) return;
    setCommentSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setCommentSaving(false); return; }
    const content = commentText.trim();
    const { error } = await supabase.from("ticket_comments").insert({
      ticket_id: showDetail.id,
      content,
      created_by: user.id,
    });
    if (error) { toast.error("評論發送失敗"); } else {
      // Send notifications for @mentions
      const mentionRegex = /@([^\s@]+)/g;
      let match: RegExpExecArray | null;
      const mentionedNames = new Set<string>();
      while ((match = mentionRegex.exec(content)) !== null) {
        mentionedNames.add(match[1]);
      }
      if (mentionedNames.size > 0) {
        const senderName = getDisplayName(user.id, "") || user.email?.split("@")[0] || "某人";
        const mentionedAdmins = adminsWithNames.filter(a =>
          a.display_name && mentionedNames.has(a.display_name) && a.user_id !== user.id
        );
        if (mentionedAdmins.length > 0) {
          const notifications = mentionedAdmins.map(a => ({
            user_id: a.user_id,
            type: "mention",
            title: `${senderName} 在工單中提及了你`,
            body: `工單「${showDetail.title}」：${content.length > 80 ? content.slice(0, 80) + "…" : content}`,
            link: "/customer-service",
            created_by: user.id,
          }));
          await supabase.from("notifications").insert(notifications);
        }
      }
      setCommentText("");
      await loadComments(showDetail.id);
    }
    setCommentSaving(false);
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!showDetail) return;
    await supabase.from("ticket_comments").delete().eq("id", commentId);
    await loadComments(showDetail.id);
  };

  // Mention helpers
  const getMentionContext = (text: string, cursorPos: number) => {
    const before = text.slice(0, cursorPos);
    const match = before.match(/@([^\s@]*)$/);
    return match ? { start: before.lastIndexOf("@"), query: match[1] } : null;
  };

  const handleCommentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setCommentText(val);
    const cursor = e.target.selectionStart;
    const ctx = getMentionContext(val, cursor);
    if (ctx) {
      setMentionFilter(ctx.query.toLowerCase());
      setMentionOpen(true);
      setMentionIndex(0);
    } else {
      setMentionOpen(false);
    }
  };

  const insertMention = (admin: { user_id: string; display_name: string | null }) => {
    const el = commentRef.current;
    if (!el) return;
    const cursor = el.selectionStart;
    const ctx = getMentionContext(commentText, cursor);
    if (!ctx) return;
    const name = admin.display_name || "未命名";
    const before = commentText.slice(0, ctx.start);
    const after = commentText.slice(cursor);
    const newText = `${before}@${name} ${after}`;
    setCommentText(newText);
    setMentionOpen(false);
    // Focus back and set cursor
    setTimeout(() => {
      el.focus();
      const pos = ctx.start + name.length + 2; // @name + space
      el.setSelectionRange(pos, pos);
    }, 0);
  };

  const filteredMentionAdmins = adminsWithNames.filter(a =>
    !mentionFilter || (a.display_name || "").toLowerCase().includes(mentionFilter)
  );

  const handleCommentKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen && filteredMentionAdmins.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex(i => Math.min(i + 1, filteredMentionAdmins.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(filteredMentionAdmins[mentionIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionOpen(false);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !mentionOpen) {
      e.preventDefault();
      handleAddComment();
    }
  };

  // Render comment content with highlighted mentions
  const renderCommentContent = (content: string) => {
    const parts = content.split(/(@[^\s@]+)/g);
    return parts.map((part, i) => {
      if (part.startsWith("@")) {
        const name = part.slice(1);
        const isKnown = adminsWithNames.some(a => a.display_name === name);
        return (
          <span key={i} className={cn("font-medium", isKnown ? "text-primary" : "text-foreground")}>
            {part}
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  const handleCreate = async () => {
    if (!formTitle.trim()) return;
    setFormSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setFormSaving(false); return; }

    const { error } = await supabase.from("support_tickets").insert({
      title: formTitle.trim(),
      description: formDesc.trim(),
      priority: formPriority,
      assigned_to: formAssignee === "none" ? null : formAssignee,
      session_id: sessionId || null,
      created_by: user.id,
    });

    if (error) {
      toast.error("建立工單失敗");
      console.error(error);
    } else {
      toast.success("工單已建立");
      setShowCreate(false);
      resetForm();
      await loadTickets();
      onCreated?.();
    }
    setFormSaving(false);
  };

  const handleUpdate = async () => {
    if (!showDetail || !formTitle.trim()) return;
    setFormSaving(true);
    const { error } = await supabase.from("support_tickets").update({
      title: formTitle.trim(),
      description: formDesc.trim(),
      priority: formPriority,
      assigned_to: formAssignee === "none" ? null : formAssignee,
    }).eq("id", showDetail.id);

    if (error) {
      toast.error("更新失敗");
    } else {
      toast.success("工單已更新");
      setEditing(false);
      await loadTickets();
      // refresh detail
      const updated = tickets.find(t => t.id === showDetail.id);
      if (updated) setShowDetail({ ...updated, title: formTitle.trim(), description: formDesc.trim(), priority: formPriority, assigned_to: formAssignee === "none" ? null : formAssignee });
    }
    setFormSaving(false);
  };

  const handleStatusChange = async (ticketId: string, newStatus: string) => {
    await supabase.from("support_tickets").update({ status: newStatus }).eq("id", ticketId);
    toast.success(`狀態已更新為「${STATUS_CONFIG[newStatus]?.label || newStatus}」`);
    await loadTickets();
    if (showDetail?.id === ticketId) {
      setShowDetail(prev => prev ? { ...prev, status: newStatus } : null);
    }
  };

  const handleDelete = async (ticketId: string) => {
    await supabase.from("support_tickets").delete().eq("id", ticketId);
    toast.success("工單已刪除");
    setShowDetail(null);
    await loadTickets();
  };

  const resetForm = () => {
    setFormTitle("");
    setFormDesc("");
    setFormPriority("medium");
    setFormAssignee("none");
  };

  const openCreate = async () => {
    resetForm();
    if (sessionSubject) setFormTitle(sessionSubject);

    // Auto-fill description with recent messages summary
    if (sessionId) {
      const { data: msgs } = await supabase
        .from("customer_chat_messages")
        .select("sender_type, sender_name, content, created_at")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false })
        .limit(10);

      if (msgs && msgs.length > 0) {
        const reversed = [...msgs].reverse();
        const summary = reversed.map(m => {
          const name = m.sender_type === "customer"
            ? (m.sender_name || customerName || t("csCustomer"))
            : (m.sender_name || t("csAgent"));
          const time = new Date(m.created_at).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
          return `[${time}] ${name}：${m.content}`;
        }).join("\n");

        const header = customerName ? `${t("ticketCustomer")}：${customerName}\n` : "";
        setFormDesc(`${header}--- ${language === "en" ? "Recent Chat Summary" : language === "ja" ? "最近の会話概要" : "最近對話摘要"} ---\n${summary}\n\n${t("ticketDescPrefix")}`);
      } else if (customerName) {
        setFormDesc(`${t("ticketCustomer")}：${customerName}\n\n${t("ticketDescPrefix")}`);
      }
    } else if (customerName) {
      setFormDesc(`${t("ticketCustomer")}：${customerName}\n\n${t("ticketDescPrefix")}`);
    }

    setShowCreate(true);
  };

  const openDetail = (ticket: Ticket) => {
    setShowDetail(ticket);
    setEditing(false);
    setFormTitle(ticket.title);
    setFormDesc(ticket.description);
    setFormPriority(ticket.priority);
    setFormAssignee(ticket.assigned_to || "none");
    setCommentText("");
    loadComments(ticket.id);
  };

  const filtered = tickets.filter(t => {
    if (filterStatus !== "all" && t.status !== filterStatus) return false;
    if (filterPriority !== "all" && t.priority !== filterPriority) return false;
    if (search && !t.title.includes(search) && !((t.customer_user_id ? getDisplayName(t.customer_user_id, "") : "")).includes(search)) return false;
    return true;
  });

  const stats = {
    open: tickets.filter(t => t.status === "open").length,
    in_progress: tickets.filter(t => t.status === "in_progress").length,
    resolved: tickets.filter(t => t.status === "resolved").length,
    total: tickets.length,
  };

  return (
    <div className="flex-1 flex flex-col p-6 gap-4 overflow-hidden">
      {/* Header stats */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <h2 className="text-lg font-bold text-foreground">{t("navCSTickets")}</h2>
          <p className="text-sm text-muted-foreground">{t("ticketTrackIssues")}</p>
        </div>
        <div className="flex gap-2">
          {[
            { key: "open", label: "待處理", count: stats.open, color: "text-yellow-600" },
            { key: "in_progress", label: "處理中", count: stats.in_progress, color: "text-blue-500" },
            { key: "resolved", label: "已解決", count: stats.resolved, color: "text-green-600" },
          ].map(s => (
            <div key={s.key} className="text-center px-3 py-1.5 rounded-lg bg-muted/50">
              <p className={cn("text-lg font-bold", s.color)}>{s.count}</p>
              <p className="text-[10px] text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
        <Button size="sm" className="gap-1.5" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5" />
          建立工單
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="搜尋工單..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9 text-sm" />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[120px] h-9 text-sm">
            <SelectValue placeholder="狀態" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部狀態</SelectItem>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterPriority} onValueChange={setFilterPriority}>
          <SelectTrigger className="w-[120px] h-9 text-sm">
            <SelectValue placeholder="優先級" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部優先級</SelectItem>
            {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Ticket list */}
      <ScrollArea className="flex-1">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">
            {tickets.length === 0 ? "尚無工單，點擊「建立工單」開始" : "沒有符合條件的工單"}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(ticket => {
              const pri = PRIORITY_CONFIG[ticket.priority] || PRIORITY_CONFIG.medium;
              const sta = STATUS_CONFIG[ticket.status] || STATUS_CONFIG.open;
              return (
                <button
                  key={ticket.id}
                  onClick={() => openDetail(ticket)}
                  className="w-full text-left p-4 rounded-xl border border-border bg-card hover:bg-accent/30 transition-colors flex items-start gap-3 group"
                >
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-foreground truncate">{ticket.title}</h3>
                      <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 gap-1 shrink-0", pri.color)}>
                        {pri.icon}{pri.label}
                      </Badge>
                      <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 gap-1 shrink-0", sta.color)}>
                        {sta.icon}{sta.label}
                      </Badge>
                    </div>
                    {ticket.description && (
                      <p className="text-xs text-muted-foreground line-clamp-1">{ticket.description}</p>
                    )}
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />{formatDate(ticket.created_at)}
                      </span>
                      {ticket.customer_user_id && getDisplayName(ticket.customer_user_id, "") && (
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />{getDisplayName(ticket.customer_user_id, "")}
                        </span>
                      )}
                      {ticket.session_id && (
                        <span className="flex items-center gap-1">
                          <MessageCircle className="h-3 w-3" />關聯對話
                        </span>
                      )}
                      {ticket.assigned_to && (
                        <span>負責人：{getDisplayName(ticket.assigned_to, "未指派")}</span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-1" />
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={open => { setShowCreate(open); if (!open) resetForm(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>建立工單</DialogTitle>
            <DialogDescription>{t("ticketEscalateDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">工單標題</label>
              <Input placeholder="簡述問題" value={formTitle} onChange={e => setFormTitle(e.target.value)} className="h-9" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">問題描述</label>
              <Textarea placeholder="詳細描述問題..." value={formDesc} onChange={e => setFormDesc(e.target.value)} rows={3} className="resize-none text-sm" />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">優先級</label>
                <Select value={formPriority} onValueChange={setFormPriority}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">指派負責人</label>
                <Select value={formAssignee} onValueChange={setFormAssignee}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">未指派</SelectItem>
                    {adminsWithNames.map(a => (
                      <SelectItem key={a.user_id} value={a.user_id}>{a.display_name || "未命名"}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {sessionId && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <MessageCircle className="h-3 w-3" />此工單將關聯至目前對話
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>取消</Button>
            <Button size="sm" onClick={handleCreate} disabled={formSaving || !formTitle.trim()}>
              {formSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
              建立
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={!!showDetail} onOpenChange={open => { if (!open) { setShowDetail(null); setEditing(false); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              工單詳情
              {showDetail && (
                <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 gap-1", STATUS_CONFIG[showDetail.status]?.color)}>
                  {STATUS_CONFIG[showDetail.status]?.icon}{STATUS_CONFIG[showDetail.status]?.label}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>檢視和管理工單狀態</DialogDescription>
          </DialogHeader>
          {showDetail && (
            <div className="space-y-4">
              {editing ? (
                <div className="space-y-3">
                  <Input value={formTitle} onChange={e => setFormTitle(e.target.value)} className="h-9 font-semibold" />
                  <Textarea value={formDesc} onChange={e => setFormDesc(e.target.value)} rows={3} className="resize-none text-sm" />
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">優先級</label>
                      <Select value={formPriority} onValueChange={setFormPriority}>
                        <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
                            <SelectItem key={k} value={k}>{v.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex-1">
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">指派負責人</label>
                      <Select value={formAssignee} onValueChange={setFormAssignee}>
                        <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">未指派</SelectItem>
                          {adminsWithNames.map(a => (
                            <SelectItem key={a.user_id} value={a.user_id}>{a.display_name || "未命名"}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleUpdate} disabled={formSaving || !formTitle.trim()}>
                      {formSaving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}儲存
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditing(false)}>取消</Button>
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <h3 className="text-base font-semibold text-foreground">{showDetail.title}</h3>
                    <div className="flex items-center gap-2 mt-1.5">
                      <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 gap-1", PRIORITY_CONFIG[showDetail.priority]?.color)}>
                        {PRIORITY_CONFIG[showDetail.priority]?.icon}{PRIORITY_CONFIG[showDetail.priority]?.label}
                      </Badge>
                    </div>
                  </div>
                  {showDetail.description && (
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap bg-muted/30 p-3 rounded-lg">{showDetail.description}</p>
                  )}
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div><span className="text-muted-foreground">建立者：</span>{getDisplayName(showDetail.created_by, "未知")}</div>
                    <div><span className="text-muted-foreground">建立時間：</span>{formatDate(showDetail.created_at)}</div>
                    <div><span className="text-muted-foreground">負責人：</span>{showDetail.assigned_to ? getDisplayName(showDetail.assigned_to, "未指派") : "未指派"}</div>
                    <div><span className="text-muted-foreground">更新時間：</span>{formatDate(showDetail.updated_at)}</div>
                    {showDetail.customer_user_id && getDisplayName(showDetail.customer_user_id, "") && (
                      <div><span className="text-muted-foreground">{t("ticketCustomer")}：</span>{getDisplayName(showDetail.customer_user_id, "")}</div>
                    )}
                    {showDetail.session_id && (
                      <div className="flex items-center gap-1"><MessageCircle className="h-3 w-3 text-muted-foreground" /><span className="text-muted-foreground">已關聯對話</span></div>
                    )}
                  </div>
                </>
              )}

              {/* Status actions */}
              {!editing && (
                <div className="border-t border-border pt-3">
                  <p className="text-xs font-medium text-muted-foreground mb-2">變更狀態</p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                      <Button
                        key={k}
                        size="sm"
                        variant={showDetail.status === k ? "default" : "outline"}
                        className="h-7 text-xs gap-1"
                        onClick={() => handleStatusChange(showDetail.id, k)}
                        disabled={showDetail.status === k}
                      >
                        {v.icon}{v.label}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {/* Comments section */}
              {!editing && (
                <div className="border-t border-border pt-3">
                  <p className="text-xs font-medium text-muted-foreground mb-2">討論評論</p>
                  <ScrollArea className="max-h-48">
                    {commentsLoading ? (
                      <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                    ) : comments.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-3">尚無評論</p>
                    ) : (
                      <div className="space-y-2">
                        {comments.map(c => (
                          <div key={c.id} className="bg-muted/30 rounded-lg p-2.5 group relative">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-medium text-foreground">{getDisplayName(c.created_by, "未知")}</span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-muted-foreground">{formatDate(c.created_at)}</span>
                                <button
                                  onClick={() => handleDeleteComment(c.id)}
                                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                             <p className="text-xs text-muted-foreground whitespace-pre-wrap">{renderCommentContent(c.content)}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                  <div className="relative mt-2">
                    {/* Mention dropdown */}
                    {mentionOpen && filteredMentionAdmins.length > 0 && (
                      <div className="absolute bottom-full left-0 right-10 mb-1 bg-popover border border-border rounded-lg shadow-lg z-50 max-h-32 overflow-y-auto">
                        {filteredMentionAdmins.map((a, idx) => (
                          <button
                            key={a.user_id}
                            onMouseDown={(e) => { e.preventDefault(); insertMention(a); }}
                            className={cn(
                              "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors",
                              idx === mentionIndex ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                            )}
                          >
                            <AtSign className="h-3 w-3 text-primary shrink-0" />
                            <span className="font-medium">{a.display_name || "未命名"}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Textarea
                        ref={commentRef}
                        value={commentText}
                        onChange={handleCommentChange}
                        onKeyDown={handleCommentKeyDown}
                        placeholder="輸入評論... 使用 @ 提及管理員"
                        rows={2}
                        className="resize-none text-sm flex-1"
                      />
                      <Button size="icon" className="h-auto shrink-0" onClick={handleAddComment} disabled={commentSaving || !commentText.trim()}>
                        {commentSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          {!editing && showDetail && (
            <DialogFooter className="gap-2">
              <Button variant="outline" size="sm" className="gap-1" onClick={() => setEditing(true)}>
                <Pencil className="h-3 w-3" />編輯
              </Button>
              <Button variant="destructive" size="sm" onClick={() => handleDelete(showDetail.id)}>
                刪除工單
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TicketPanel;
