import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  MessageCircle, X, Send, Mic, Paperclip, Bot, User, Loader2, FileText, Check, CheckCheck, Star, ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { streamKnowledgeChat } from "@/lib/knowledgeChat";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

interface ChatMsg {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  time: string;
  attachment_url?: string | null;
  attachment_type?: string | null;
  is_read?: boolean;
  delegationRequestId?: string;
  delegationHours?: number;
}

const DELEGATION_RE = /^\[delegation_request:([0-9a-f-]+):(\d+)\]\s*(.*)$/is;

const now = () => new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });

const TELEGRAM_SERVICE_CHAT_ID = import.meta.env.VITE_TELEGRAM_CHAT_ID || "-1003989508866";

/** Inline card for CS-agent delegation requests shown to the customer */
const DelegationRequestCard = ({
  requestId, hours, content, time,
}: { requestId: string; hours: number; content: string; time: string }) => {
  const { t } = useLanguage();
  const [status, setStatus] = useState<"pending" | "accepted" | "declined" | "loading" | "checking">("checking");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("delegation_requests")
        .select("status")
        .eq("id", requestId)
        .maybeSingle();
      if (cancelled) return;
      if (data?.status === "accepted") setStatus("accepted");
      else if (data?.status === "declined" || data?.status === "cancelled" || data?.status === "expired") setStatus("declined");
      else setStatus("pending");
    })();
    return () => { cancelled = true; };
  }, [requestId]);

  const respond = async (action: "accept" | "decline") => {
    setStatus("loading");
    const { data, error } = await supabase.functions.invoke("accept-delegation-request", {
      body: { request_id: requestId, action },
    });
    if (error || (data as Record<string, unknown>)?.error) {
      toast.error(t("delegationRequestActionFailed") + (error?.message || (data as Record<string, unknown>)?.error));
      setStatus("pending");
      return;
    }
    setStatus(action === "accept" ? "accepted" : "declined");
    toast.success(action === "accept" ? t("delegationRequestAcceptedToast") : t("delegationRequestDeclinedToast"));
  };

  return (
    <div className="mx-auto my-2 max-w-[90%] rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2.5">
      <div className="flex items-start gap-2">
        <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-foreground">{t("delegationRequestCardTitle")}</p>
          <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap">{content}</p>
          <p className="text-[10px] text-muted-foreground mt-1">
            {t("delegationRequestCardMeta").replace("{hours}", String(hours))} · {time}
          </p>
        </div>
      </div>
      {status === "pending" && (
        <div className="flex gap-2">
          <Button size="sm" className="flex-1 h-7 text-xs" onClick={() => respond("accept")}>{t("delegationRequestAccept")}</Button>
          <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={() => respond("decline")}>{t("delegationRequestDecline")}</Button>
        </div>
      )}
      {status === "loading" && (
        <div className="flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
      )}
      {status === "accepted" && (
        <p className="text-[11px] text-success font-medium">{t("delegationRequestAccepted")}</p>
      )}
      {status === "declined" && (
        <p className="text-[11px] text-muted-foreground">{t("delegationRequestEnded")}</p>
      )}
      {status === "checking" && (
        <div className="flex justify-center"><Loader2 className="w-3 h-3 animate-spin text-muted-foreground" /></div>
      )}
    </div>
  );
};

/** Render attachment (image or file link) */
const AttachmentBubble = ({ url, type, isUser }: { url: string; type: string; isUser: boolean }) => {
  if (type === "image") {
    return (
      <img
        src={url}
        alt="attachment"
        className="rounded-lg max-w-full max-h-48 cursor-pointer mt-1"
        onClick={() => window.open(url, "_blank")}
      />
    );
  }
  const fileName = url.split("/").pop() || "file";
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "flex items-center gap-2 mt-1 px-2 py-1.5 rounded-lg text-xs",
        isUser ? "bg-primary-foreground/20 text-primary-foreground" : "bg-background/60 text-foreground"
      )}
    >
      <FileText className="h-4 w-4 shrink-0" />
      <span className="truncate max-w-[180px]">{decodeURIComponent(fileName)}</span>
    </a>
  );
};

const ChatWidget = () => {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [isAI, setIsAI] = useState(true);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<string>("open");
  const [unreadCount, setUnreadCount] = useState(0);
  const [showRating, setShowRating] = useState(false);
  const [ratingValue, setRatingValue] = useState(0);
  const [ratingHover, setRatingHover] = useState(0);
  const [ratingFeedback, setRatingFeedback] = useState("");
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([
    { id: "0", role: "assistant", content: t("chatAIGreeting"), time: now() },
  ]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const ensureSession = useCallback(async () => {
    if (sessionId) return sessionId;
    if (!user) return null;

    const { data: existing } = await supabase
      .from('customer_chat_sessions')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(1);

    if (existing && existing.length > 0) {
      setSessionId(existing[0].id);
      return existing[0].id;
    }

    const { data: newSession, error } = await supabase
      .from('customer_chat_sessions')
      .insert({
        user_id: user.id,
        telegram_chat_id: TELEGRAM_SERVICE_CHAT_ID ? parseInt(TELEGRAM_SERVICE_CHAT_ID) : null,
        subject: t("chatSessionSubject"),
      })
      .select('id')
      .single();

    if (error) {
      console.error('Failed to create session:', error);
      return null;
    }

    setSessionId(newSession.id);
    return newSession.id;
  }, [sessionId, user]);

  const mapDbMessages = useCallback((data: Record<string, unknown>[] = []): ChatMsg[] => data.map((m) => {
    const isSystem = m.sender_type === 'system';
    const role: ChatMsg["role"] = m.sender_type === 'customer' ? 'user' : (isSystem ? 'system' : 'assistant');
    let content = (m.content as string) || '';
    let delegationRequestId: string | undefined;
    let delegationHours: number | undefined;
    if (isSystem) {
      const match = DELEGATION_RE.exec(content);
      if (match) {
        delegationRequestId = match[1];
        delegationHours = parseInt(match[2], 10);
        content = match[3] || content;
      }
    }
    return {
      id: m.id as string,
      role,
      content,
      time: new Date(m.created_at as string).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" }),
      attachment_url: m.attachment_url as string | null | undefined,
      attachment_type: m.attachment_type as string | null | undefined,
      is_read: m.is_read as boolean | undefined,
      delegationRequestId,
      delegationHours,
    };
  }), []);

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  const playNotificationSound = useCallback(() => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.value = 0.15;
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.stop(ctx.currentTime + 0.3);
    } catch {}
  }, []);

  const showDesktopNotification = useCallback((content: string) => {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(t("chatBizlutionReply"), { body: content, icon: "/logo.png" });
    }
    playNotificationSound();
  }, [playNotificationSound]);

  /** Mark all agent messages in a session as read */
  const markMessagesAsRead = useCallback(async (sid: string) => {
    await supabase
      .from('customer_chat_messages')
      .update({ is_read: true })
      .eq('session_id', sid)
      .eq('sender_type', 'agent')
      .eq('is_read', false);
  }, []);

  const syncHumanMessages = useCallback(async (sid: string, notifyForNewAgentMessages = false) => {
    const { data, error } = await supabase
      .from('customer_chat_messages')
      .select('*')
      .eq('session_id', sid)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Load messages error:', error);
      return;
    }

    // Check session status
    const { data: sessionData } = await supabase
      .from('customer_chat_sessions')
      .select('status')
      .eq('id', sid)
      .single();

    if (sessionData) {
      const prevStatus = sessionStatus;
      setSessionStatus(sessionData.status);
      // If session just became closed, check if already rated
      if (sessionData.status === 'closed' && prevStatus !== 'closed') {
        const { data: existingRating } = await supabase
          .from('customer_satisfaction_ratings')
          .select('id')
          .eq('session_id', sid)
          .limit(1);
        if (!existingRating || existingRating.length === 0) {
          setShowRating(true);
        } else {
          setRatingSubmitted(true);
        }
      }
    }

    const loaded = mapDbMessages((data || []) as Record<string, unknown>[]);
    if (notifyForNewAgentMessages && loaded.length > 0) {
      const currentIds = new Set(messages.map((msg) => msg.id));
      const newAgentMessages = loaded.filter((msg) => msg.role === 'assistant' && !currentIds.has(msg.id));
      newAgentMessages.forEach((msg) => showDesktopNotification(msg.content || '您收到一則新回覆'));
    }

    // Count unread agent messages
    const unread = (data || []).filter((m) => m.sender_type === 'agent' && !m.is_read).length;
    setUnreadCount(unread);

    // If chat is open, auto-mark as read
    if (open && !isAI) {
      await markMessagesAsRead(sid);
      setUnreadCount(0);
    }

    setMessages([
      { id: "human-intro", role: "assistant", content: t("chatHumanGreeting"), time: now() },
      ...loaded,
    ]);
  }, [mapDbMessages, messages, showDesktopNotification, open, isAI, markMessagesAsRead, sessionStatus]);

  const handleSubmitRating = async () => {
    if (!sessionId || !user || ratingValue === 0) return;
    setRatingSubmitting(true);
    const { error } = await supabase.from('customer_satisfaction_ratings').insert({
      session_id: sessionId,
      user_id: user.id,
      rating: ratingValue,
      feedback: ratingFeedback.trim(),
    });
    setRatingSubmitting(false);
    if (error) {
      toast.error("評分提交失敗，請稍後重試");
      console.error(error);
      return;
    }
    setRatingSubmitted(true);
    setShowRating(false);
    toast.success("感謝您的評分！");
  };

  // Poll unread count even when chat is closed
  useEffect(() => {
    if (!user) return;

    const pollUnread = async () => {
      // Find the user's open session
      const { data: sessions } = await supabase
        .from('customer_chat_sessions')
        .select('id')
        .eq('user_id', user.id)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(1);

      if (!sessions || sessions.length === 0) return;

      const sid = sessions[0].id;
      if (!sessionId) setSessionId(sid);

      const { count } = await supabase
        .from('customer_chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', sid)
        .eq('sender_type', 'agent')
        .eq('is_read', false);

      setUnreadCount(count || 0);
    };

    // Only poll when chat is closed or in AI mode
    if (!open || isAI) {
      void pollUnread();
      const id = window.setInterval(pollUnread, 5000);
      return () => window.clearInterval(id);
    }
  }, [user, open, isAI, sessionId]);

  // When chat opens in human mode, mark messages as read
  useEffect(() => {
    if (open && !isAI && sessionId) {
      void markMessagesAsRead(sessionId).then(() => setUnreadCount(0));
    }
  }, [open, isAI, sessionId, markMessagesAsRead]);

  useEffect(() => {
    if (!sessionId || isAI) return;

    const channel = supabase
      .channel(`chat:${user?.id ?? "anon"}:${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'customer_chat_messages',
          filter: `session_id=eq.${sessionId}`,
        },
        async () => {
          await syncHumanMessages(sessionId, true);
        }
      )
      .subscribe();

    const intervalId = window.setInterval(() => {
      void syncHumanMessages(sessionId, true);
    }, 3000);

    void syncHumanMessages(sessionId);

    return () => {
      window.clearInterval(intervalId);
      supabase.removeChannel(channel);
    };
  }, [sessionId, isAI, syncHumanMessages]);

  const handleModeSwitch = async (toHuman: boolean) => {
    if (toHuman && !user) {
      toast.error(t("chatLoginRequired"));
      return;
    }
    setIsAI(!toHuman);
    if (toHuman) {
      const sid = await ensureSession();
      if (sid) {
        await syncHumanMessages(sid);
      }
    } else {
      setMessages([
        { id: "0", role: "assistant", content: t("chatAIGreeting"), time: now() },
      ]);
    }
  };

  /** Upload file to storage and send as message */
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    if (file.size > 10 * 1024 * 1024) {
      toast.error("檔案大小不能超過 10MB");
      return;
    }

    if (!user) {
      toast.error("請先登入");
      return;
    }

    setUploading(true);
    try {
      const sid = isAI ? null : (sessionId || await ensureSession());
      const isImage = file.type.startsWith("image/");
      const ext = file.name.split(".").pop() || "bin";
      const path = `${user.id}/${Date.now()}.${ext}`;

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

      const userMsg: ChatMsg = {
        id: Date.now().toString(),
        role: "user",
        content: contentText,
        time: now(),
        attachment_url: publicUrl,
        attachment_type: attachmentType,
      };
      setMessages((prev) => [...prev, userMsg]);

      if (!isAI && sid) {
        await supabase.functions.invoke("telegram-send", {
          body: {
            session_id: sid,
            content: contentText,
            telegram_chat_id: TELEGRAM_SERVICE_CHAT_ID ? parseInt(TELEGRAM_SERVICE_CHAT_ID) : null,
            attachment_url: publicUrl,
            attachment_type: attachmentType,
          },
        });
      }
    } catch (err) {
      console.error(err);
      toast.error("檔案上傳失敗");
    } finally {
      setUploading(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || streaming || sending) return;
    const userMsg: ChatMsg = { id: Date.now().toString(), role: "user", content: input, time: now() };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    const currentInput = input;
    setInput("");

    if (!isAI) {
      setSending(true);
      try {
        const sid = sessionId || await ensureSession();
        if (!sid) {
          toast.error(t("chatConnectFailed"));
          setSending(false);
          return;
        }

        const { error } = await supabase.functions.invoke("telegram-send", {
          body: {
            session_id: sid,
            content: currentInput,
            telegram_chat_id: TELEGRAM_SERVICE_CHAT_ID ? parseInt(TELEGRAM_SERVICE_CHAT_ID) : null,
          },
        });

        if (error) {
          console.error('Send error:', error);
          toast.error("訊息發送失敗，請稍後重試");
        }
      } catch (err) {
        console.error('Send error:', err);
        toast.error("訊息發送失敗");
      } finally {
        setSending(false);
      }
      return;
    }

    // AI streaming response
    setStreaming(true);
    let assistantContent = "";
    const assistantId = (Date.now() + 1).toString();

    const aiMessages = updatedMessages
      .filter((m) => m.id !== "0" && m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    await streamKnowledgeChat({
      messages: aiMessages,
      onDelta: (chunk) => {
        assistantContent += chunk;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.id === assistantId) {
            return prev.map((m) => (m.id === assistantId ? { ...m, content: assistantContent } : m));
          }
          return [...prev, { id: assistantId, role: "assistant", content: assistantContent, time: now() }];
        });
      },
      onDone: () => setStreaming(false),
      onError: (msg) => {
        toast.error(msg);
        setStreaming(false);
      },
    });
  };

  const isBusy = streaming || sending || uploading;

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200 flex items-center justify-center"
        >
          <MessageCircle className="h-6 w-6" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 h-5 min-w-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[11px] font-bold flex items-center justify-center animate-bounce">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      )}

      {open && (
        <div className="fixed bottom-6 right-6 z-50 w-[380px] h-[540px] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-scale-in">
          {/* Header */}
          <div className="bg-gradient-to-r from-primary to-primary/80 px-4 py-3 flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-primary-foreground/20 flex items-center justify-center">
              {isAI ? <Bot className="h-5 w-5 text-primary-foreground" /> : <User className="h-5 w-5 text-primary-foreground" />}
            </div>
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-primary-foreground">
                {isAI ? t("chatAITitle") : t("chatHumanTitle")}
              </h4>
              <p className="text-xs text-primary-foreground/70">
                {isAI ? t("chatAISubtitle") : t("chatHumanSubtitle")}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-primary-foreground/80 hover:text-primary-foreground hover:bg-primary-foreground/10"
              onClick={() => setOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* AI / Human toggle */}
          <div className="px-4 py-2 border-b border-border bg-muted/30 flex items-center justify-between">
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Bot className="h-3.5 w-3.5" /> {t("chatAITitle")}
            </span>
            <Switch checked={!isAI} onCheckedChange={(v) => handleModeSwitch(v)} />
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              {t("chatSwitchToHuman")} <User className="h-3.5 w-3.5" />
            </span>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((msg) => {
              if (msg.role === "system") {
                if (msg.delegationRequestId) {
                  return (
                    <DelegationRequestCard
                      key={msg.id}
                      requestId={msg.delegationRequestId}
                      hours={msg.delegationHours || 24}
                      content={msg.content}
                      time={msg.time}
                    />
                  );
                }
                return (
                  <div key={msg.id} className="mx-auto my-1 px-3 py-1.5 rounded-full bg-muted/60 text-[11px] text-muted-foreground max-w-[85%] text-center">
                    {msg.content}
                  </div>
                );
              }
              return (
              <div key={msg.id} className={cn("flex gap-2", msg.role === "user" ? "justify-end" : "justify-start")}>
                {msg.role === "assistant" && (
                  <Avatar className="h-7 w-7 mt-1 shrink-0">
                    <AvatarFallback className="bg-primary/15 text-primary">
                      {isAI ? <Bot className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
                    </AvatarFallback>
                  </Avatar>
                )}
                <div className={cn(
                  "max-w-[75%] rounded-2xl px-3.5 py-2.5 text-sm",
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-md"
                    : "bg-muted text-foreground rounded-bl-md"
                )}>
                  {msg.attachment_url && msg.attachment_type && (
                    <AttachmentBubble url={msg.attachment_url} type={msg.attachment_type} isUser={msg.role === "user"} />
                  )}
                  {!(msg.attachment_url && msg.attachment_type === "image" && msg.content.startsWith("[圖片]")) && (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}
                  <div className={cn("flex items-center gap-1 mt-1", msg.role === "user" ? "justify-end" : "")}>
                    <span className={cn("text-[10px]", msg.role === "user" ? "text-primary-foreground/60" : "text-muted-foreground")}>
                      {msg.time}
                    </span>
                    {msg.role === "user" && !isAI && msg.id !== "human-intro" && !msg.id.match(/^\d+$/) && (
                      msg.is_read
                        ? <CheckCheck className="h-3 w-3 text-primary-foreground/80" />
                        : <Check className="h-3 w-3 text-primary-foreground/50" />
                    )}
                    {msg.role === "user" && !isAI && msg.id.match(/^\d+$/) && (
                      <Check className="h-3 w-3 text-primary-foreground/50" />
                    )}
                  </div>
                </div>
              </div>
              );
            })}
            {isBusy && (
              <div className="flex gap-2 justify-start">
                <Avatar className="h-7 w-7 mt-1 shrink-0">
                  <AvatarFallback className="bg-primary/15 text-primary">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  </AvatarFallback>
                </Avatar>
              </div>
            )}

            {/* Rating card when session closed */}
            {!isAI && sessionStatus === 'closed' && showRating && !ratingSubmitted && (
              <div className="mx-auto my-3 p-4 rounded-xl border border-border bg-card shadow-sm max-w-[300px] text-center space-y-3">
                <p className="text-sm font-medium">{t("chatSessionEnded")}</p>
                <p className="text-xs text-muted-foreground">{t("chatRateExperience")}</p>
                <div className="flex justify-center gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      onClick={() => setRatingValue(star)}
                      onMouseEnter={() => setRatingHover(star)}
                      onMouseLeave={() => setRatingHover(0)}
                      className="p-0.5 transition-transform hover:scale-110"
                    >
                      <Star
                        className={cn(
                          "h-7 w-7 transition-colors",
                          (ratingHover || ratingValue) >= star
                            ? "fill-yellow-400 text-yellow-400"
                            : "text-muted-foreground/40"
                        )}
                      />
                    </button>
                  ))}
                </div>
                <textarea
                  placeholder="有什麼建議或回饋嗎？（選填）"
                  value={ratingFeedback}
                  onChange={(e) => setRatingFeedback(e.target.value)}
                  rows={2}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                />
                <Button
                  size="sm"
                  className="w-full"
                  onClick={handleSubmitRating}
                  disabled={ratingValue === 0 || ratingSubmitting}
                >
                  {ratingSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                  提交評分
                </Button>
              </div>
            )}

            {!isAI && sessionStatus === 'closed' && ratingSubmitted && (
              <div className="mx-auto my-3 p-3 rounded-xl border border-border bg-card shadow-sm max-w-[260px] text-center space-y-1">
                <p className="text-sm font-medium">感謝您的評分！🙏</p>
                <p className="text-xs text-muted-foreground">您的回饋將幫助我們改善服務品質</p>
              </div>
            )}
          </div>

          {/* Input area */}
          <div className="p-3 border-t border-border bg-card">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.rar,.txt"
              className="hidden"
              onChange={handleFileSelect}
            />
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground"
                title={t("tipUploadAttachment")}
                onClick={() => fileInputRef.current?.click()}
                disabled={isBusy}
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
              </Button>
              <Input
                placeholder="輸入訊息..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="flex-1 h-9 text-sm bg-muted/50 border-0"
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                disabled={isBusy}
              />
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground" title={t("tipVoiceToText")}>
                <Mic className="h-4 w-4" />
              </Button>
              <Button size="icon" className="h-8 w-8 shrink-0" onClick={handleSend} disabled={isBusy} title={t("tipSendMessage")}>
                {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ChatWidget;
