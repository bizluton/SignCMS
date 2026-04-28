import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Send, Search, MoreVertical, Bot, User,
  Circle, Loader2, Sparkles, MessageCircle, XCircle, Clock, Paperclip, FileText, Zap, Volume2, VolumeX,
  Plus, Pencil, Trash2, Settings2, Star, GripVertical, BarChart3, Tag, X, StickyNote, AlertTriangle, Ticket, UserCircle, History, ShieldCheck,
} from "lucide-react";
import RequestDelegationDialog from "@/components/customer-service/RequestDelegationDialog";
import PendingDelegationButton from "@/components/customer-service/PendingDelegationButton";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { streamKnowledgeChat } from "@/lib/knowledgeChat";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Session {
  id: string;
  user_id: string;
  status: string;
  subject: string | null;
  telegram_chat_id: number | null;
  created_at: string;
  updated_at: string;
  assigned_to: string | null;
  // joined from profiles
  display_name: string | null;
  last_message?: string;
  unread_count?: number;
  rating?: number | null;
  feedback?: string | null;
  assigned_name?: string | null;
}

interface ChatMessage {
  id: string;
  sender_type: string;
  sender_name: string | null;
  content: string;
  created_at: string;
  is_read: boolean;
  attachment_url?: string | null;
  attachment_type?: string | null;
}

const statusConfig: Record<string, { label: string; color: string }> = {
  open: { label: "進行中", color: "bg-success text-success-foreground" },
  closed: { label: "已結束", color: "bg-muted text-muted-foreground" },
};

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });

const formatRelative = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "剛剛";
  if (mins < 60) return `${mins} 分鐘前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小時前`;
  return `${Math.floor(hrs / 24)} 天前`;
};

interface QuickReplyTemplate {
  id: string;
  label: string;
  text: string;
  sort_order: number;
}

interface ChatTag {
  id: string;
  name: string;
  color: string;
}

interface SessionNote {
  id: string;
  session_id: string;
  content: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  // joined
  author_name?: string;
}

const TAG_COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
  "#EC4899", "#06B6D4", "#F97316",
];

const playNotificationSound = () => {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 660;
    gain.gain.value = 0.12;
    osc.start();
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.stop(ctx.currentTime + 0.4);
  } catch {}
};

const SortableTemplateItem = ({ qr, onEdit, onDelete }: {
  qr: QuickReplyTemplate;
  onEdit: (qr: QuickReplyTemplate) => void;
  onDelete: (id: string) => void;
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: qr.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <div ref={setNodeRef} style={style} className="flex items-start gap-2 p-2.5 rounded-lg border border-border bg-muted/30">
      <button {...attributes} {...listeners} className="mt-1 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground">
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{qr.label}</p>
        <p className="text-xs text-muted-foreground line-clamp-2">{qr.text}</p>
      </div>
      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => onEdit(qr)}>
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-destructive hover:text-destructive" onClick={() => onDelete(qr.id)}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
};

const CustomerServicePage = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { user: authUser } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [showDelegationRequest, setShowDelegationRequest] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const activeTab = "chat"; // dashboard & tickets moved to separate pages
  const [inputText, setInputText] = useState("");
  const [searchText, setSearchText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [quickReplies, setQuickReplies] = useState<QuickReplyTemplate[]>([]);
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<QuickReplyTemplate | null>(null);
  const [templateLabel, setTemplateLabel] = useState("");
  const [templateText, setTemplateText] = useState("");
  const [templateSaving, setTemplateSaving] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevMessageCountRef = useRef<number>(0);

  // Tags state
  const [allTags, setAllTags] = useState<ChatTag[]>([]);
  const [sessionTagsMap, setSessionTagsMap] = useState<Record<string, string[]>>({}); // session_id -> tag_id[]
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [showTagManager, setShowTagManager] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[0]);
  const [editingTag, setEditingTag] = useState<ChatTag | null>(null);

  // Notes state
  const [showNotes, setShowNotes] = useState(false);
  const [sessionNotes, setSessionNotes] = useState<SessionNote[]>([]);
  const [newNoteText, setNewNoteText] = useState("");
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [editNoteText, setEditNoteText] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);

  // Customer info state
  const [showCustomerInfo, setShowCustomerInfo] = useState(false);
  const [customerHistory, setCustomerHistory] = useState<{ id: string; subject: string | null; status: string; created_at: string; message_count: number }[]>([]);
  const [customerInfoLoading, setCustomerInfoLoading] = useState(false);

  // Admin profiles for assignment
  const [adminProfiles, setAdminProfiles] = useState<{ user_id: string; display_name: string | null }[]>([]);

  const loadAdminProfiles = useCallback(async () => {
    const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
    if (!roles || roles.length === 0) return;
    const ids = roles.map(r => r.user_id);
    const { data: profiles } = await supabase.from("profiles").select("user_id, display_name").in("user_id", ids);
    if (profiles) setAdminProfiles(profiles);
  }, []);

  useEffect(() => { loadAdminProfiles(); }, [loadAdminProfiles]);

  // Agent busy status
  const [agentBusy, setAgentBusy] = useState(false);

  useEffect(() => {
    const loadStatus = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("agent_status").select("status").eq("user_id", user.id).maybeSingle();
      if (data) setAgentBusy(data.status === "busy");
    };
    loadStatus();
  }, []);

  const toggleAgentBusy = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const newStatus = agentBusy ? "available" : "busy";
    const { data: existing } = await supabase.from("agent_status").select("id").eq("user_id", user.id).maybeSingle();
    if (existing) {
      await supabase.from("agent_status").update({ status: newStatus, updated_at: new Date().toISOString() }).eq("user_id", user.id);
    } else {
      await supabase.from("agent_status").insert({ user_id: user.id, status: newStatus });
    }
    setAgentBusy(!agentBusy);
    toast.success(newStatus === "busy" ? "已設為忙碌，暫停自動分派" : "已恢復可用，開始接收新對話");
  }, [agentBusy]);

  // Load quick reply templates
  const loadTemplates = useCallback(async () => {
    const { data } = await supabase
      .from("quick_reply_templates")
      .select("id, label, text, sort_order")
      .order("sort_order", { ascending: true });
    if (data) setQuickReplies(data);
  }, []);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  // Load tags and session-tag mappings
  const loadTags = useCallback(async () => {
    const { data } = await supabase.from("chat_tags").select("id, name, color").order("created_at");
    if (data) setAllTags(data);
  }, []);

  const loadSessionTags = useCallback(async () => {
    const { data } = await supabase.from("chat_session_tags").select("session_id, tag_id");
    if (data) {
      const map: Record<string, string[]> = {};
      data.forEach((st: any) => {
        if (!map[st.session_id]) map[st.session_id] = [];
        map[st.session_id].push(st.tag_id);
      });
      setSessionTagsMap(map);
    }
  }, []);

  useEffect(() => { loadTags(); loadSessionTags(); }, [loadTags, loadSessionTags]);

  // Notes logic
  const loadNotes = useCallback(async (sessionId: string) => {
    const { data } = await supabase
      .from("chat_session_notes")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false });
    if (data) {
      // Get author names
      const userIds = [...new Set(data.map((n: any) => n.created_by))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", userIds);
      const profileMap = new Map((profiles || []).map((p: any) => [p.user_id, p.display_name]));
      setSessionNotes(data.map((n: any) => ({ ...n, author_name: profileMap.get(n.created_by) || "未知" })));
    }
  }, []);

  useEffect(() => {
    if (selectedSession && showNotes) {
      loadNotes(selectedSession);
    }
  }, [selectedSession, showNotes, loadNotes]);

  const handleAddNote = async () => {
    if (!newNoteText.trim() || !selectedSession || noteSaving) return;
    setNoteSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setNoteSaving(false); return; }
    await supabase.from("chat_session_notes").insert({
      session_id: selectedSession,
      content: newNoteText.trim(),
      created_by: user.id,
    });
    setNewNoteText("");
    setNoteSaving(false);
    await loadNotes(selectedSession);
    toast.success("筆記已新增");
  };

  const handleUpdateNote = async (noteId: string) => {
    if (!editNoteText.trim()) return;
    await supabase.from("chat_session_notes").update({ content: editNoteText.trim() }).eq("id", noteId);
    setEditingNote(null);
    setEditNoteText("");
    if (selectedSession) await loadNotes(selectedSession);
    toast.success("筆記已更新");
  };

  const handleDeleteNote = async (noteId: string) => {
    await supabase.from("chat_session_notes").delete().eq("id", noteId);
    if (selectedSession) await loadNotes(selectedSession);
    toast.success("筆記已刪除");
  };

  // Customer info / history logic
  const loadCustomerHistory = useCallback(async (userId: string) => {
    setCustomerInfoLoading(true);
    const { data: sessData } = await supabase
      .from("customer_chat_sessions")
      .select("id, subject, status, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (sessData) {
      const enriched = await Promise.all(
        sessData.map(async (s) => {
          const { count } = await supabase
            .from("customer_chat_messages")
            .select("*", { count: "exact", head: true })
            .eq("session_id", s.id);
          return { ...s, message_count: count || 0 };
        })
      );
      setCustomerHistory(enriched);
    }
    setCustomerInfoLoading(false);
  }, []);

  useEffect(() => {
    if (showCustomerInfo && selectedSession) {
      const sess = sessions.find(s => s.id === selectedSession);
      if (sess) loadCustomerHistory(sess.user_id);
    }
  }, [showCustomerInfo, selectedSession, sessions, loadCustomerHistory]);

  const handleSaveTag = async () => {
    if (!newTagName.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    if (editingTag) {
      await supabase.from("chat_tags").update({ name: newTagName.trim(), color: newTagColor }).eq("id", editingTag.id);
    } else {
      await supabase.from("chat_tags").insert({ name: newTagName.trim(), color: newTagColor, created_by: user.id });
    }
    setNewTagName(""); setNewTagColor(TAG_COLORS[0]); setEditingTag(null);
    await loadTags();
    toast.success(editingTag ? "標籤已更新" : "標籤已新增");
  };

  const handleDeleteTag = async (id: string) => {
    await supabase.from("chat_tags").delete().eq("id", id);
    if (filterTag === id) setFilterTag(null);
    await loadTags();
    await loadSessionTags();
    toast.success("標籤已刪除");
  };

  const toggleSessionTag = async (sessionId: string, tagId: string) => {
    const current = sessionTagsMap[sessionId] || [];
    if (current.includes(tagId)) {
      await supabase.from("chat_session_tags").delete().eq("session_id", sessionId).eq("tag_id", tagId);
    } else {
      await supabase.from("chat_session_tags").insert({ session_id: sessionId, tag_id: tagId });
    }
    await loadSessionTags();
  };

  const handleSaveTemplate = async () => {
    if (!templateLabel.trim() || !templateText.trim()) return;
    setTemplateSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setTemplateSaving(false); return; }

    if (editingTemplate) {
      await supabase.from("quick_reply_templates").update({
        label: templateLabel.trim(),
        text: templateText.trim(),
      }).eq("id", editingTemplate.id);
    } else {
      const maxOrder = quickReplies.length > 0 ? Math.max(...quickReplies.map(q => q.sort_order)) + 1 : 0;
      await supabase.from("quick_reply_templates").insert({
        label: templateLabel.trim(),
        text: templateText.trim(),
        sort_order: maxOrder,
        created_by: user.id,
      });
    }
    setTemplateSaving(false);
    setEditingTemplate(null);
    setTemplateLabel("");
    setTemplateText("");
    await loadTemplates();
    toast.success(editingTemplate ? "模板已更新" : "模板已新增");
  };

  const handleDeleteTemplate = async (id: string) => {
    await supabase.from("quick_reply_templates").delete().eq("id", id);
    await loadTemplates();
    toast.success("模板已刪除");
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = quickReplies.findIndex((q) => q.id === active.id);
    const newIndex = quickReplies.findIndex((q) => q.id === over.id);
    const reordered = arrayMove(quickReplies, oldIndex, newIndex);
    setQuickReplies(reordered);
    // Persist new sort_order
    await Promise.all(
      reordered.map((q, i) =>
        supabase.from("quick_reply_templates").update({ sort_order: i }).eq("id", q.id)
      )
    );
  };

  // Load sessions
  useEffect(() => {
    const loadSessions = async () => {
      setLoading(true);
      const { data: sessionsData, error } = await supabase
        .from("customer_chat_sessions")
        .select("*")
        .order("updated_at", { ascending: false });

      if (error) {
        console.error("Load sessions error:", error);
        setLoading(false);
        return;
      }

      // Get user profiles for display names (including assigned agents)
      const assignedIds = [...new Set((sessionsData || []).filter(s => s.assigned_to).map(s => s.assigned_to!))];
      const userIds = [...new Set([...(sessionsData || []).map((s) => s.user_id), ...assignedIds])];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", userIds);

      const profileMap = new Map(
        (profiles || []).map((p) => [p.user_id, p.display_name])
      );

      // Get ratings for closed sessions
      const sessionIds = (sessionsData || []).map(s => s.id);
      const { data: ratings } = await supabase
        .from("customer_satisfaction_ratings")
        .select("session_id, rating, feedback")
        .in("session_id", sessionIds);
      const ratingMap = new Map(
        (ratings || []).map((r: any) => [r.session_id, { rating: r.rating, feedback: r.feedback }])
      );

      // Get last message and unread count for each session
      const enriched: Session[] = await Promise.all(
        (sessionsData || []).map(async (s) => {
          const { data: lastMsg } = await supabase
            .from("customer_chat_messages")
            .select("content")
            .eq("session_id", s.id)
            .order("created_at", { ascending: false })
            .limit(1);

          const { count } = await supabase
            .from("customer_chat_messages")
            .select("*", { count: "exact", head: true })
            .eq("session_id", s.id)
            .eq("sender_type", "customer")
            .eq("is_read", false);

          const r = ratingMap.get(s.id);
          return {
            ...s,
            display_name: profileMap.get(s.user_id) || "未知用戶",
            assigned_name: s.assigned_to ? profileMap.get(s.assigned_to) || null : null,
            last_message: lastMsg?.[0]?.content || "",
            unread_count: count || 0,
            rating: r?.rating ?? null,
            feedback: r?.feedback ?? null,
          };
        })
      );

      setSessions(enriched);
      if (enriched.length > 0 && !selectedSession) {
        setSelectedSession(enriched[0].id);
      }
      setLoading(false);
    };

    loadSessions();
  }, []);

  // Load messages for selected session
  useEffect(() => {
    if (!selectedSession) return;

    const loadMessages = async () => {
      const { data } = await supabase
        .from("customer_chat_messages")
        .select("*")
        .eq("session_id", selectedSession)
        .order("created_at", { ascending: true });

      setMessages(data || []);

      // Mark customer messages as read
      await supabase
        .from("customer_chat_messages")
        .update({ is_read: true })
        .eq("session_id", selectedSession)
        .eq("sender_type", "customer")
        .eq("is_read", false);

      // Clear unread count in sidebar list
      setSessions((prev) =>
        prev.map((s) => (s.id === selectedSession ? { ...s, unread_count: 0 } : s))
      );
    };

    loadMessages();
  }, [selectedSession]);

  // Realtime subscription + polling fallback for selected session messages
  useEffect(() => {
    if (!selectedSession) return;

    const refreshMessages = async () => {
      const { data } = await supabase
        .from("customer_chat_messages")
        .select("*")
        .eq("session_id", selectedSession)
        .order("created_at", { ascending: true });

      if (data) {
        setMessages((prev) => {
          const hasNew = data.length !== prev.length || (data.length > 0 && data[data.length - 1].id !== prev[prev.length - 1]?.id);
          if (hasNew) {
            // Play sound for new customer messages
            if (soundEnabled && data.length > prevMessageCountRef.current) {
              const newMsgs = data.slice(prevMessageCountRef.current);
              if (newMsgs.some((m: any) => m.sender_type === 'customer')) {
                playNotificationSound();
              }
            }
            prevMessageCountRef.current = data.length;
            return data;
          }
          return prev;
        });
      }

      // Mark customer messages as read
      await supabase
        .from("customer_chat_messages")
        .update({ is_read: true })
        .eq("session_id", selectedSession)
        .eq("sender_type", "customer")
        .eq("is_read", false);

      // Clear unread in sidebar
      setSessions((prev) =>
        prev.map((s) => (s.id === selectedSession ? { ...s, unread_count: 0 } : s))
      );
    };

    const channel = supabase
      .channel(`admin-chat:${authUser?.id ?? "anon"}:${selectedSession}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "customer_chat_messages",
          filter: `session_id=eq.${selectedSession}`,
        },
        () => {
          void refreshMessages();
        }
      )
      .subscribe();

    // Poll every 3s as fallback
    const intervalId = window.setInterval(() => {
      void refreshMessages();
    }, 3000);

    return () => {
      window.clearInterval(intervalId);
      supabase.removeChannel(channel);
    };
  }, [selectedSession]);

  // Also subscribe to all sessions for sidebar updates
  useEffect(() => {
    const channel = supabase
      .channel(`admin-all-messages:${authUser?.id ?? "anon"}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "customer_chat_messages",
        },
        (payload) => {
          const msg = payload.new as any;
          // Play sound for new customer messages in other sessions
          if (msg.sender_type === "customer" && msg.session_id !== selectedSession && soundEnabled) {
            playNotificationSound();
          }
          setSessions((prev) =>
            prev.map((s) =>
              s.id === msg.session_id
                ? {
                    ...s,
                    last_message: msg.content,
                    updated_at: msg.created_at,
                    unread_count:
                      msg.sender_type === "customer" && s.id !== selectedSession
                        ? (s.unread_count || 0) + 1
                        : s.unread_count,
                  }
                : s
            )
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedSession]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const selected = sessions.find((s) => s.id === selectedSession);
  const filtered = sessions.filter((s) => {
    const matchSearch = !searchText ||
      (s.display_name || "").includes(searchText) ||
      (s.last_message || "").includes(searchText);
    const matchTag = !filterTag || (sessionTagsMap[s.id] || []).includes(filterTag);
    return matchSearch && matchTag;
  });

  // Send reply via Telegram
  const handleSend = useCallback(async () => {
    if (!inputText.trim() || !selectedSession || sending) return;
    setSending(true);

    try {
      const session = sessions.find((s) => s.id === selectedSession);
      const { error } = await supabase.functions.invoke("telegram-send", {
        body: {
          session_id: selectedSession,
          content: inputText,
          telegram_chat_id: session?.telegram_chat_id,
          as_agent: true,
        },
      });

      if (error) {
        toast.error("訊息發送失敗");
        console.error("Send error:", error);
      } else {
        setInputText("");
      }
    } catch (err) {
      toast.error("訊息發送失敗");
      console.error(err);
    } finally {
      setSending(false);
    }
  }, [inputText, selectedSession, sending, sessions]);

  // AI smart reply
  const handleAIReply = useCallback(async () => {
    if (streaming || !messages.length) return;
    setStreaming(true);

    const aiMessages = messages.map((m) => ({
      role: (m.sender_type === "customer" ? "user" : "assistant") as "user" | "assistant",
      content: m.content,
    }));

    let aiContent = "";
    await streamKnowledgeChat({
      messages: aiMessages,
      onDelta: (chunk) => {
        aiContent += chunk;
        setInputText(aiContent);
      },
      onDone: () => setStreaming(false),
      onError: (msg) => {
        toast.error(msg);
        setStreaming(false);
      },
    });
  }, [messages, streaming]);

  // Close session
  const handleCloseSession = useCallback(async () => {
    if (!selectedSession) return;
    await supabase
      .from("customer_chat_sessions")
      .update({ status: "closed", closed_at: new Date().toISOString() })
      .eq("id", selectedSession);

    setSessions((prev) =>
      prev.map((s) => (s.id === selectedSession ? { ...s, status: "closed" } : s))
    );
    toast.success("對話已結束");
  }, [selectedSession]);

  // Reassign session to another agent
  const handleReassign = useCallback(async (agentId: string) => {
    if (!selectedSession) return;
    const agentName = adminProfiles.find(a => a.user_id === agentId)?.display_name || "未知";
    const selected = sessions.find(s => s.id === selectedSession);
    const customerName = selected?.display_name || "未知用戶";

    await supabase
      .from("customer_chat_sessions")
      .update({ assigned_to: agentId })
      .eq("id", selectedSession);

    // Notification is now handled by the notify_chat_assignment trigger

    setSessions(prev =>
      prev.map(s => s.id === selectedSession ? { ...s, assigned_to: agentId, assigned_name: agentName } : s)
    );
    toast.success(`已分派給 ${agentName}`);
  }, [selectedSession, adminProfiles, sessions]);

  // Admin file upload
  const handleAdminFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedSession) return;
    e.target.value = "";

    if (file.size > 10 * 1024 * 1024) {
      toast.error("檔案大小不能超過 10MB");
      return;
    }

    setUploading(true);
    try {
      const isImage = file.type.startsWith("image/");
      const ext = file.name.split(".").pop() || "bin";
      const path = `admin/${Date.now()}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from("chat-attachments")
        .upload(path, file, { contentType: file.type });

      if (uploadErr) {
        toast.error("檔案上傳失敗");
        console.error(uploadErr);
        return;
      }

      const { data: signedData, error: signedErr } = await supabase.storage
        .from("chat-attachments")
        .createSignedUrl(path, 60 * 60 * 24 * 7); // 7 days

      if (signedErr || !signedData?.signedUrl) {
        toast.error("無法取得檔案連結");
        return;
      }
      const publicUrl = signedData.signedUrl;
      const attachmentType = isImage ? "image" : "file";
      const contentText = isImage ? `[圖片] ${file.name}` : `[檔案] ${file.name}`;

      const session = sessions.find((s) => s.id === selectedSession);
      await supabase.functions.invoke("telegram-send", {
        body: {
          session_id: selectedSession,
          content: contentText,
          telegram_chat_id: session?.telegram_chat_id,
          as_agent: true,
          attachment_url: publicUrl,
          attachment_type: attachmentType,
        },
      });
    } catch (err) {
      console.error(err);
      toast.error("檔案上傳失敗");
    } finally {
      setUploading(false);
    }
  }, [selectedSession, sessions]);

  return (
    <DashboardLayout>
      <div className="h-[calc(100vh-4rem)] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center">
            <MessageCircle className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">{t("csTitle")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("csSubtitle")}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {/* Tab buttons removed — dashboard & tickets are now separate sidebar pages */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setSoundEnabled(!soundEnabled)}
              title={soundEnabled ? t("csSoundOn") : t("csSoundOff")}
            >
              {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4 text-muted-foreground" />}
            </Button>
            <button
              onClick={toggleAgentBusy}
              title={agentBusy ? "點擊恢復可用狀態" : "點擊設為忙碌"}
            >
              <Badge variant="outline" className={agentBusy ? "border-destructive/50 text-destructive cursor-pointer" : "border-success text-success cursor-pointer"}>
                <Circle className="h-2 w-2 fill-current mr-1" /> {agentBusy ? "忙碌中" : "線上"}
              </Badge>
            </button>
            <Badge variant="secondary">
              {sessions.filter((s) => s.status === "open").length} 進行中
            </Badge>
          </div>
        </div>

        
        {/* Main area */}
        <div className="flex-1 flex min-h-0">
          {/* Session list */}
          <div className="w-80 border-r border-border flex flex-col bg-card/50">
            <div className="p-3 space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t("csSearchCustomer")}
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  className="pl-9 h-9 text-sm bg-muted/50 border-0"
                />
              </div>
              {allTags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {allTags.map(tag => (
                    <button
                      key={tag.id}
                      onClick={() => setFilterTag(filterTag === tag.id ? null : tag.id)}
                      className={cn(
                        "text-[10px] px-2 py-0.5 rounded-full border transition-colors font-medium",
                        filterTag === tag.id
                          ? "text-white border-transparent"
                          : "border-border text-muted-foreground hover:text-foreground"
                      )}
                      style={filterTag === tag.id ? { backgroundColor: tag.color } : {}}
                    >
                      {tag.name}
                    </button>
                  ))}
                  <button
                    onClick={() => setShowTagManager(true)}
                    className="text-[10px] px-1.5 py-0.5 rounded-full border border-dashed border-border text-muted-foreground hover:text-foreground"
                    title="管理標籤"
                  >
                    <Settings2 className="h-2.5 w-2.5" />
                  </button>
                </div>
              )}
            </div>
            <ScrollArea className="flex-1">
              {loading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  {t("csNoConversations")}
                </div>
              ) : (
                filtered.map((s) => {
                  const st = statusConfig[s.status] || statusConfig.open;
                  return (
                    <button
                      key={s.id}
                      onClick={() => setSelectedSession(s.id)}
                      className={cn(
                        "w-full text-left px-3 py-3 flex items-start gap-3 hover:bg-accent/50 transition-colors",
                        selectedSession === s.id && "bg-accent"
                      )}
                    >
                      <div className="relative">
                        <Avatar className="h-10 w-10">
                          <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                            {(s.display_name || "?")[0]}
                          </AvatarFallback>
                        </Avatar>
                        <div
                          className={cn(
                            "absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-card",
                            s.status === "open" ? "bg-success" : "bg-muted-foreground/50"
                          )}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-foreground">
                            {s.display_name || "未知用戶"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatRelative(s.updated_at)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {s.last_message || s.subject || "新對話"}
                        </p>
                        <div className="flex items-center gap-1.5 mt-1">
                          <Badge
                            variant="outline"
                            className={cn("text-[10px] px-1.5 py-0", st.color)}
                          >
                            {st.label}
                          </Badge>
                          {s.telegram_chat_id && (
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 border-blue-500/30 text-blue-500"
                            >
                              TG
                            </Badge>
                          )}
                          {s.assigned_name && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/30 text-primary">
                              👤 {s.assigned_name}
                            </Badge>
                          )}
                          {(sessionTagsMap[s.id] || []).map(tid => {
                            const tag = allTags.find(t => t.id === tid);
                            return tag ? (
                              <span key={tid} className="text-[9px] px-1.5 py-0 rounded-full text-white font-medium" style={{ backgroundColor: tag.color }}>
                                {tag.name}
                              </span>
                            ) : null;
                          })}
                          {(s.unread_count || 0) > 0 && (
                            <span className="ml-auto bg-destructive text-destructive-foreground text-[10px] font-bold h-4 min-w-4 rounded-full flex items-center justify-center px-1">
                              {s.unread_count}
                            </span>
                          )}
                          {s.rating && (
                            <span className="ml-auto flex items-center gap-0.5 text-[10px] text-muted-foreground" title={s.feedback || ''}>
                              <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                              {s.rating}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </ScrollArea>
          </div>

          {/* Chat area */}
          <div className="flex-1 flex flex-col">
            {selected ? (
              <>
                {/* Chat header */}
                <div className="px-4 py-3 border-b border-border flex items-center gap-3">
                  <Avatar className="h-9 w-9">
                    <AvatarFallback className="bg-primary/10 text-primary text-sm">
                      {(selected.display_name || "?")[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-foreground">
                      {selected.display_name || "未知用戶"}
                    </h3>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(selected.created_at).toLocaleString("zh-TW")}
                      {selected.assigned_name && (
                        <span className="ml-2 text-primary">
                          📋 負責人：{selected.assigned_name}
                        </span>
                      )}
                    </p>
                  </div>
                  {/* Reassign agent */}
                  <Select
                    value={selected.assigned_to || ""}
                    onValueChange={handleReassign}
                  >
                    <SelectTrigger className="w-[130px] h-8 text-xs">
                      <SelectValue placeholder={t("csAssignAgent")} />
                    </SelectTrigger>
                    <SelectContent>
                      {adminProfiles.map(a => (
                        <SelectItem key={a.user_id} value={a.user_id}>
                          {a.display_name || a.user_id.slice(0, 8)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* Session tags */}
                  <div className="flex items-center gap-1 flex-wrap">
                    {(sessionTagsMap[selected.id] || []).map(tid => {
                      const tag = allTags.find(t => t.id === tid);
                      return tag ? (
                        <span key={tid} className="text-[10px] px-2 py-0.5 rounded-full text-white font-medium flex items-center gap-1" style={{ backgroundColor: tag.color }}>
                          {tag.name}
                          <button onClick={() => toggleSessionTag(selected.id, tid)} className="hover:opacity-70"><X className="h-2.5 w-2.5" /></button>
                        </span>
                      ) : null;
                    })}
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-6 px-1.5 gap-1 text-muted-foreground hover:text-foreground">
                          <Tag className="h-3 w-3" />
                          <Plus className="h-2.5 w-2.5" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-48 p-2" align="start">
                        <p className="text-xs font-medium text-muted-foreground mb-1.5">加上標籤</p>
                        {allTags.length === 0 ? (
                          <p className="text-xs text-muted-foreground py-2 text-center">尚無標籤</p>
                        ) : allTags.map(tag => {
                          const active = (sessionTagsMap[selected.id] || []).includes(tag.id);
                          return (
                            <button
                              key={tag.id}
                              onClick={() => toggleSessionTag(selected.id, tag.id)}
                              className={cn("w-full text-left text-xs px-2 py-1.5 rounded flex items-center gap-2 transition-colors", active ? "bg-accent" : "hover:bg-muted")}
                            >
                              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                              {tag.name}
                              {active && <span className="ml-auto text-primary">✓</span>}
                            </button>
                          );
                        })}
                        <button
                          onClick={() => { setShowTagManager(true); }}
                          className="w-full text-left text-xs px-2 py-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted mt-1 border-t border-border pt-1.5"
                        >
                          <Settings2 className="h-3 w-3 inline mr-1" />管理標籤
                        </button>
                      </PopoverContent>
                    </Popover>
                  </div>
                  {selected.rating && (
                    <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted text-xs" title={selected.feedback || ''}>
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Star key={s} className={cn("h-3 w-3", s <= (selected.rating || 0) ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/30")} />
                      ))}
                      {selected.feedback && <span className="ml-1 text-muted-foreground max-w-[120px] truncate">「{selected.feedback}」</span>}
                    </div>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={handleAIReply}
                    disabled={streaming}
                  >
                    {streaming ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    AI 智慧回覆
                  </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => {
                        const params = new URLSearchParams();
                        params.set("session_id", selected.id);
                        if (selected.subject) params.set("subject", selected.subject);
                        if (selected.display_name) params.set("customer", selected.display_name);
                        navigate(`/cs-tickets?${params.toString()}`);
                      }}
                    >
                      <Ticket className="h-3.5 w-3.5" />
                      升級為工單
                    </Button>
                    {(() => {
                      const isSelf = !!authUser && selected.user_id === authUser.id;
                      return (
                        <PendingDelegationButton
                          sessionId={selected.id}
                          customerId={selected.user_id}
                          isSelf={isSelf}
                          onRequest={() => setShowDelegationRequest(true)}
                        />
                      );
                    })()}
                  {selected.status === "open" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-destructive hover:text-destructive"
                      onClick={handleCloseSession}
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      結束對話
                    </Button>
                  )}
                  <Button
                    variant={showNotes ? "default" : "outline"}
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setShowNotes(!showNotes)}
                  >
                    <StickyNote className="h-3.5 w-3.5" />
                    筆記{sessionNotes.length > 0 ? ` (${sessionNotes.length})` : ""}
                  </Button>
                  <Button
                    variant={showCustomerInfo ? "default" : "outline"}
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setShowCustomerInfo(!showCustomerInfo)}
                  >
                    <UserCircle className="h-3.5 w-3.5" />
                    {t("csCustomerInfo")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title={t("tipMoreOptions")}
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </div>

                {/* Messages + Notes area */}
                <div className="flex-1 flex min-h-0">
                  {/* Messages column */}
                  <div className="flex-1 flex flex-col min-h-0">
                <ScrollArea className="flex-1 p-4">
                  <div className="space-y-4 max-w-3xl mx-auto" ref={scrollRef}>
                    {messages.map((msg) => {
                      const isCustomer = msg.sender_type === "customer";
                      return (
                        <div
                          key={msg.id}
                          className={cn(
                            "flex gap-2",
                            isCustomer ? "justify-start" : "justify-end"
                          )}
                        >
                          {isCustomer && (
                            <Avatar className="h-7 w-7 mt-1">
                              <AvatarFallback className="bg-primary/20 text-primary text-xs">
                                <User className="h-3.5 w-3.5" />
                              </AvatarFallback>
                            </Avatar>
                          )}
                          <div
                            className={cn(
                              "max-w-[70%] rounded-2xl px-4 py-2.5 text-sm",
                              isCustomer
                                ? "bg-muted text-foreground rounded-bl-md"
                                : "bg-primary text-primary-foreground rounded-br-md"
                            )}
                          >
                            {!isCustomer && msg.sender_name && (
                              <p className="text-[10px] font-medium mb-0.5 opacity-80">
                                {msg.sender_name}
                              </p>
                            )}
                            {msg.attachment_url && msg.attachment_type === "image" && (
                              <img
                                src={msg.attachment_url}
                                alt="attachment"
                                className="rounded-lg max-w-full max-h-48 cursor-pointer mb-1"
                                onClick={() => window.open(msg.attachment_url!, "_blank")}
                              />
                            )}
                            {msg.attachment_url && msg.attachment_type === "file" && (
                              <a
                                href={msg.attachment_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={cn(
                                  "flex items-center gap-2 mb-1 px-2 py-1.5 rounded-lg text-xs",
                                  isCustomer ? "bg-background/60 text-foreground" : "bg-primary-foreground/20 text-primary-foreground"
                                )}
                              >
                                <FileText className="h-4 w-4 shrink-0" />
                                <span className="truncate max-w-[180px]">{decodeURIComponent(msg.attachment_url.split("/").pop() || "file")}</span>
                              </a>
                            )}
                            {!(msg.attachment_url && msg.attachment_type === "image" && msg.content.startsWith("[圖片]")) && (
                              <p className="whitespace-pre-wrap">{msg.content}</p>
                            )}
                            <p
                              className={cn(
                                "text-[10px] mt-1",
                                isCustomer
                                  ? "text-muted-foreground"
                                  : "text-primary-foreground/70"
                              )}
                            >
                              {formatTime(msg.created_at)}
                            </p>
                          </div>
                          {!isCustomer && (
                            <Avatar className="h-7 w-7 mt-1">
                              <AvatarFallback className="bg-accent text-accent-foreground text-xs">
                                {msg.sender_name ? msg.sender_name[0].toUpperCase() : <Bot className="h-3.5 w-3.5" />}
                              </AvatarFallback>
                            </Avatar>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
                  </div>

                  {/* Notes side panel */}
                  {showNotes && (
                    <div className="w-72 border-l border-border flex flex-col bg-card/50">
                      <div className="px-3 py-2.5 border-b border-border flex items-center gap-2">
                        <StickyNote className="h-4 w-4 text-muted-foreground" />
                        <h4 className="text-sm font-semibold flex-1">內部備忘筆記</h4>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowNotes(false)}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      {/* Add note */}
                      <div className="p-3 border-b border-border space-y-2">
                        <Textarea
                          placeholder="輸入內部備忘..."
                          value={newNoteText}
                          onChange={(e) => setNewNoteText(e.target.value)}
                          rows={2}
                          className="text-xs resize-none"
                        />
                        <Button size="sm" className="w-full h-7 text-xs" onClick={handleAddNote} disabled={noteSaving || !newNoteText.trim()}>
                          {noteSaving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
                          新增筆記
                        </Button>
                      </div>
                      {/* Notes list */}
                      <ScrollArea className="flex-1">
                        <div className="p-2 space-y-2">
                          {sessionNotes.length === 0 ? (
                            <p className="text-xs text-muted-foreground text-center py-6">尚無筆記</p>
                          ) : sessionNotes.map(note => (
                            <div key={note.id} className="p-2.5 rounded-lg border border-border bg-muted/30 space-y-1.5">
                              {editingNote === note.id ? (
                                <>
                                  <Textarea
                                    value={editNoteText}
                                    onChange={(e) => setEditNoteText(e.target.value)}
                                    rows={2}
                                    className="text-xs resize-none"
                                  />
                                  <div className="flex gap-1">
                                    <Button size="sm" className="h-6 text-[10px] px-2" onClick={() => handleUpdateNote(note.id)}>儲存</Button>
                                    <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => { setEditingNote(null); setEditNoteText(""); }}>取消</Button>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <p className="text-xs whitespace-pre-wrap text-foreground">{note.content}</p>
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-muted-foreground">
                                      {note.author_name} · {formatRelative(note.created_at)}
                                    </span>
                                    <div className="flex gap-0.5">
                                      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => { setEditingNote(note.id); setEditNoteText(note.content); }}>
                                        <Pencil className="h-2.5 w-2.5" />
                                      </Button>
                                      <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive hover:text-destructive" onClick={() => handleDeleteNote(note.id)}>
                                        <Trash2 className="h-2.5 w-2.5" />
                                      </Button>
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>
                  )}

                  {/* Customer info side panel */}
                  {showCustomerInfo && selected && (
                    <div className="w-72 border-l border-border flex flex-col bg-card/50">
                      <div className="px-3 py-2.5 border-b border-border flex items-center gap-2">
                        <UserCircle className="h-4 w-4 text-muted-foreground" />
                        <h4 className="text-sm font-semibold flex-1">{t("csCustomerInfo")}</h4>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowCustomerInfo(false)}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      {/* Basic info */}
                      <div className="p-3 border-b border-border space-y-3">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-12 w-12">
                            <AvatarFallback className="bg-primary/10 text-primary text-lg font-semibold">
                              {(selected.display_name || "?")[0]}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="text-sm font-semibold text-foreground">{selected.display_name || "未知用戶"}</p>
                            <p className="text-[10px] text-muted-foreground">ID: {selected.user_id.slice(0, 8)}...</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="bg-muted/30 rounded-lg p-2 text-center">
                            <p className="text-foreground font-bold">{customerHistory.length}</p>
                            <p className="text-muted-foreground text-[10px]">歷史對話</p>
                          </div>
                          <div className="bg-muted/30 rounded-lg p-2 text-center">
                            <p className="text-foreground font-bold">
                              {customerHistory.reduce((sum, h) => sum + h.message_count, 0)}
                            </p>
                            <p className="text-muted-foreground text-[10px]">總訊息數</p>
                          </div>
                        </div>
                        <div className="text-xs space-y-1">
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            首次對話：{customerHistory.length > 0 ? new Date(customerHistory[customerHistory.length - 1].created_at).toLocaleDateString("zh-TW") : "-"}
                          </div>
                          {selected.telegram_chat_id && (
                            <div className="flex items-center gap-1.5 text-muted-foreground">
                              <MessageCircle className="h-3 w-3" />
                              Telegram 用戶
                            </div>
                          )}
                        </div>
                      </div>
                      {/* History */}
                      <div className="px-3 pt-2.5 pb-1">
                        <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                          <History className="h-3 w-3" />歷史對話記錄
                        </p>
                      </div>
                      <ScrollArea className="flex-1">
                        {customerInfoLoading ? (
                          <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                        ) : customerHistory.length === 0 ? (
                          <p className="text-xs text-muted-foreground text-center py-6">尚無歷史記錄</p>
                        ) : (
                          <div className="p-2 space-y-1.5">
                            {customerHistory.map(h => {
                              const isCurrent = h.id === selectedSession;
                              return (
                                <button
                                  key={h.id}
                                  onClick={() => { if (!isCurrent) setSelectedSession(h.id); }}
                                  className={cn(
                                    "w-full text-left p-2 rounded-lg text-xs transition-colors",
                                    isCurrent ? "bg-primary/10 border border-primary/20" : "hover:bg-muted/50"
                                  )}
                                >
                                  <div className="flex items-center justify-between mb-0.5">
                                    <span className="font-medium text-foreground truncate max-w-[140px]">
                                      {h.subject || "無主題"}
                                    </span>
                                    <Badge variant="outline" className={cn("text-[9px] px-1 py-0 shrink-0", statusConfig[h.status]?.color || "")}>
                                      {statusConfig[h.status]?.label || h.status}
                                    </Badge>
                                  </div>
                                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                    <span>{new Date(h.created_at).toLocaleDateString("zh-TW")}</span>
                                    <span>{h.message_count} 則訊息</span>
                                    {isCurrent && <span className="text-primary font-medium">← 目前</span>}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </ScrollArea>
                    </div>
                  )}
                </div>

                {/* Quick reply templates */}
                {showQuickReplies && selected.status === "open" && (
                  <div className="px-4 py-2 border-t border-border bg-muted/20">
                    <div className="flex flex-wrap gap-1.5 max-w-3xl mx-auto items-center">
                      {quickReplies.map((qr) => (
                        <button
                          key={qr.id}
                          onClick={() => {
                            setInputText(qr.text);
                            setShowQuickReplies(false);
                          }}
                          className="text-xs px-2.5 py-1.5 rounded-full border border-border bg-card hover:bg-accent hover:text-accent-foreground transition-colors"
                          title={qr.text}
                        >
                          {qr.label}
                        </button>
                      ))}
                      <button
                        onClick={() => setShowTemplateManager(true)}
                        className="text-xs px-2 py-1.5 rounded-full border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
                        title="管理模板"
                      >
                        <Settings2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Input area */}
                <div className="p-4 border-t border-border">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.rar,.txt"
                    className="hidden"
                    onChange={handleAdminFileSelect}
                  />
                  <div className="flex items-center gap-2 max-w-3xl mx-auto">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 shrink-0 text-muted-foreground"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={selected.status === "closed" || uploading}
                      title={t("tipUploadAttachment")}
                    >
                      {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn("h-10 w-10 shrink-0", showQuickReplies ? "text-primary" : "text-muted-foreground")}
                      onClick={() => setShowQuickReplies(!showQuickReplies)}
                      disabled={selected.status === "closed"}
                      title="快捷回覆"
                    >
                      <Zap className="h-4 w-4" />
                    </Button>
                    <Input
                      placeholder={
                        selected.status === "closed"
                          ? "此對話已結束"
                          : "輸入回覆訊息..."
                      }
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      className="flex-1 h-10 bg-muted/50"
                      onKeyDown={(e) => e.key === "Enter" && handleSend()}
                      disabled={selected.status === "closed" || sending}
                    />
                    <Button
                      size="icon"
                      className="h-10 w-10 shrink-0"
                      onClick={handleSend}
                      disabled={
                        selected.status === "closed" || sending || !inputText.trim()
                      }
                      title={t("tipSendMessage")}
                    >
                      {sending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2">
                <MessageCircle className="h-12 w-12 opacity-30" />
                <p>{loading ? t("csLoading") : t("csSelectConversation")}</p>
              </div>
            )}
          </div>
        </div>
        
      </div>

      {/* Template Management Dialog */}
      <Dialog open={showTemplateManager} onOpenChange={(open) => {
        setShowTemplateManager(open);
        if (!open) { setEditingTemplate(null); setTemplateLabel(""); setTemplateText(""); }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>管理快捷回覆模板</DialogTitle>
            <DialogDescription>新增、編輯或刪除常用的回覆模板</DialogDescription>
          </DialogHeader>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={quickReplies.map(q => q.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {quickReplies.map((qr) => (
                  <SortableTemplateItem
                    key={qr.id}
                    qr={qr}
                    onEdit={(q) => {
                      setEditingTemplate(q);
                      setTemplateLabel(q.label);
                      setTemplateText(q.text);
                    }}
                    onDelete={handleDeleteTemplate}
                  />
                ))}
                {quickReplies.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">尚無模板，請新增</p>
                )}
              </div>
            </SortableContext>
          </DndContext>
          <div className="border-t border-border pt-3 space-y-2">
            <p className="text-sm font-medium">{editingTemplate ? "編輯模板" : "新增模板"}</p>
            <Input
              placeholder="模板標題（如：歡迎）"
              value={templateLabel}
              onChange={(e) => setTemplateLabel(e.target.value)}
              className="h-9"
            />
            <textarea
              placeholder="模板內容"
              value={templateText}
              onChange={(e) => setTemplateText(e.target.value)}
              rows={3}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSaveTemplate} disabled={templateSaving || !templateLabel.trim() || !templateText.trim()}>
                {templateSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
                {editingTemplate ? "更新" : "新增"}
              </Button>
              {editingTemplate && (
                <Button size="sm" variant="outline" onClick={() => { setEditingTemplate(null); setTemplateLabel(""); setTemplateText(""); }}>
                  取消
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Tag Manager Dialog */}
      <Dialog open={showTagManager} onOpenChange={(open) => {
        setShowTagManager(open);
        if (!open) { setEditingTag(null); setNewTagName(""); setNewTagColor(TAG_COLORS[0]); }
      }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>管理對話標籤</DialogTitle>
            <DialogDescription>新增、編輯或刪除標籤分類</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[250px] overflow-y-auto">
            {allTags.map(tag => (
              <div key={tag.id} className="flex items-center gap-2 p-2 rounded-lg border border-border bg-muted/30">
                <span className="h-4 w-4 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                <span className="text-sm flex-1">{tag.name}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                  setEditingTag(tag); setNewTagName(tag.name); setNewTagColor(tag.color);
                }}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDeleteTag(tag.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            {allTags.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">尚無標籤，請新增</p>}
          </div>
          <div className="border-t border-border pt-3 space-y-2">
            <p className="text-sm font-medium">{editingTag ? "編輯標籤" : "新增標籤"}</p>
            <Input placeholder="標籤名稱" value={newTagName} onChange={e => setNewTagName(e.target.value)} className="h-9" />
            <div className="flex gap-1.5">
              {TAG_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setNewTagColor(c)}
                  className={cn("h-6 w-6 rounded-full transition-all", newTagColor === c ? "ring-2 ring-offset-2 ring-primary" : "")}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSaveTag} disabled={!newTagName.trim()}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                {editingTag ? "更新" : "新增"}
              </Button>
              {editingTag && (
                <Button size="sm" variant="outline" onClick={() => { setEditingTag(null); setNewTagName(""); setNewTagColor(TAG_COLORS[0]); }}>
                  取消
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {selected && (
        <RequestDelegationDialog
          open={showDelegationRequest}
          onOpenChange={setShowDelegationRequest}
          sessionId={selected.id}
          customerId={selected.user_id}
          customerName={selected.display_name}
        />
      )}
    </DashboardLayout>
  );
};

export default CustomerServicePage;
