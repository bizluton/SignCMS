import { useState, useEffect, useCallback } from "react";
import liff from "@line/liff";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Ticket, Users, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TicketResult {
  ticketId: string;
  number: number;
  shareToken: string;
  prefix: string;
}

interface QueueStatus {
  queueName: string;
  prefix: string;
  currentNumber: number;
  waitingCount: number;
}

type PageState =
  | { kind: "loading" }
  | { kind: "no-liff" }        // not opened inside LINE
  | { kind: "join-success"; number: number; status: string }
  | { kind: "join-error"; message: string }
  | { kind: "idle"; queueId: string; orgId: string; status: QueueStatus | null }
  | { kind: "issued"; ticket: TicketResult; queueId: string; orgId: string }
  | { kind: "error"; message: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSupabaseUrl(): string {
  return (supabase as unknown as { supabaseUrl: string }).supabaseUrl;
}

function getAnonKey(): string {
  return (supabase as unknown as { supabaseKey: string }).supabaseKey;
}

async function apiFetch(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${getSupabaseUrl()}/functions/v1/queue-system${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getAnonKey()}`,
    },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

async function fetchStatus(orgId: string, queueId: string): Promise<QueueStatus | null> {
  try {
    const res = await fetch(
      `${getSupabaseUrl()}/functions/v1/queue-system/status?org_id=${orgId}&queue_id=${queueId}`,
      { headers: { Authorization: `Bearer ${getAnonKey()}` } },
    );
    if (!res.ok) return null;
    const d = (await res.json()) as { queueName: string; prefix: string; currentNumber: number; waitingCount: number };
    return { queueName: d.queueName, prefix: d.prefix, currentNumber: d.currentNumber, waitingCount: d.waitingCount };
  } catch {
    return null;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function QueueLiffPage() {
  const [state, setState] = useState<PageState>({ kind: "loading" });
  const [liffReady, setLiffReady] = useState(false);
  const [lineUid, setLineUid] = useState<string | null>(null);
  const [queueIdInput, setQueueIdInput] = useState("");
  const [orgIdInput, setOrgIdInput] = useState("");

  // Parse URL params from both search and hash (HashRouter compatibility)
  const getParam = useCallback((key: string): string | null => {
    const fromSearch = new URLSearchParams(window.location.search).get(key);
    if (fromSearch) return fromSearch;
    const hash = window.location.hash; // e.g. "#/liff/queue?queue_id=..."
    const hashQuery = hash.includes("?") ? hash.split("?")[1] : "";
    return new URLSearchParams(hashQuery).get(key);
  }, []);

  // ── LIFF init ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const liffId = import.meta.env.VITE_LINE_LIFF_ID as string | undefined;
    if (!liffId) {
      // No LIFF ID configured — show debug/manual UI
      const orgId   = getParam("org_id")   ?? "";
      const queueId = getParam("queue_id") ?? "";
      setState({ kind: "idle", queueId, orgId, status: null });
      return;
    }

    liff
      .init({ liffId })
      .then(async () => {
        setLiffReady(true);

        if (!liff.isInClient()) {
          // Opened in external browser — show "open in LINE" message
          setState({ kind: "no-liff" });
          return;
        }

        const profile = await liff.getProfile();
        setLineUid(profile.userId);

        const action    = getParam("action");
        const ticketId  = getParam("ticket_id");
        const token     = getParam("token");
        const orgId     = getParam("org_id")   ?? "";
        const queueId   = getParam("queue_id") ?? "";

        // ── Join flow (friend shared a ticket) ─────────────────────────────
        if (action === "join" && ticketId && token) {
          const data = await apiFetch("/join-ticket", {
            ticket_id:   ticketId,
            share_token: token,
            line_uid:    profile.userId,
          });
          if (data.ok) {
            setState({ kind: "join-success", number: data.number as number, status: data.status as string });
          } else {
            setState({ kind: "join-error", message: (data.error as string) ?? "Failed to join" });
          }
          return;
        }

        // ── Normal take-a-number flow ──────────────────────────────────────
        const status = orgId && queueId ? await fetchStatus(orgId, queueId) : null;
        setState({ kind: "idle", queueId, orgId, status });
      })
      .catch(() => setState({ kind: "error", message: "LIFF 初始化失敗" }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Realtime subscription for queue status updates ─────────────────────────
  useEffect(() => {
    if (state.kind !== "idle" && state.kind !== "issued") return;
    const queueId = state.kind === "idle" ? state.queueId : state.queueId;
    if (!queueId) return;

    const channel = supabase
      .channel(`liff-qs-${queueId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "queue_system_queues", filter: `id=eq.${queueId}` },
        (payload) => {
          const orgId = state.kind === "idle" ? state.orgId : state.orgId;
          void fetchStatus(orgId, queueId).then((s) => {
            if (!s) return;
            setState((prev) =>
              prev.kind === "idle"
                ? { ...prev, status: s }
                : prev,
            );
          });
          void payload;
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind === "idle" ? state.queueId : null]);

  // ── Take a number ──────────────────────────────────────────────────────────
  const handleIssue = useCallback(async () => {
    const queueId = state.kind === "idle" ? state.queueId || queueIdInput : "";
    const orgId   = state.kind === "idle" ? state.orgId   || orgIdInput   : "";
    if (!queueId) return;

    setState({ kind: "loading" });
    const data = await apiFetch("/issue-ticket", {
      queue_id: queueId,
      ...(lineUid ? { line_uid: lineUid } : {}),
    });

    if (data.ok) {
      setState({
        kind: "issued",
        ticket: {
          ticketId:   data.ticketId as string,
          number:     data.number as number,
          shareToken: data.shareToken as string,
          prefix:     data.prefix as string,
        },
        queueId,
        orgId,
      });
    } else {
      setState({ kind: "error", message: (data.error as string) ?? "無法取號" });
    }
  }, [state, lineUid, queueIdInput, orgIdInput]);

  // ── Share ticket ──────────────────────────────────────────────────────────
  const handleShare = useCallback(async () => {
    if (state.kind !== "issued") return;
    const { ticket, queueId, orgId } = state;
    const numStr = `${ticket.prefix}${String(ticket.number).padStart(3, "0")}`;

    const baseUrl = `${window.location.origin}${window.location.pathname}`;
    const joinUrl = `${baseUrl}?action=join&ticket_id=${ticket.ticketId}&token=${ticket.shareToken}&queue_id=${queueId}&org_id=${orgId}`;

    if (liffReady && liff.isInClient()) {
      await liff.shareTargetPicker([
        {
          type: "flex",
          altText: `我拿到了 ${numStr} 號，邀請你也加入排隊追蹤！`,
          contents: {
            type: "bubble",
            body: {
              type: "box",
              layout: "vertical",
              contents: [
                { type: "text", text: "排隊叫號通知", weight: "bold", size: "sm", color: "#6B7280" },
                { type: "text", text: numStr, weight: "bold", size: "5xl", color: "#1D4ED8", align: "center", margin: "md" },
                { type: "text", text: "點下方按鈕加入追蹤，叫號時自動通知", size: "sm", color: "#374151", align: "center", wrap: true, margin: "sm" },
              ],
            },
            footer: {
              type: "box",
              layout: "vertical",
              contents: [
                {
                  type: "button",
                  style: "primary",
                  color: "#1D4ED8",
                  action: { type: "uri", label: "加入追蹤", uri: joinUrl },
                },
              ],
            },
          },
        },
      ]);
    } else {
      await navigator.clipboard.writeText(joinUrl).catch(() => {});
      alert(`分享連結已複製：${joinUrl}`);
    }
  }, [state, liffReady]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (state.kind === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (state.kind === "no-liff") {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-white px-6 text-center">
        <AlertCircle className="h-12 w-12 text-yellow-500" />
        <h1 className="text-xl font-bold">請在 LINE 中開啟</h1>
        <p className="text-sm text-gray-500">此頁面需在 LINE 應用程式中開啟才能使用。</p>
      </div>
    );
  }

  if (state.kind === "join-success") {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-white px-6 text-center">
        <CheckCircle2 className="h-12 w-12 text-green-500" />
        <h1 className="text-xl font-bold">加入成功</h1>
        <p className="text-4xl font-black text-blue-700 tabular-nums">
          {String(state.number).padStart(3, "0")}
        </p>
        <p className="text-sm text-gray-500">叫號時將自動通知您</p>
      </div>
    );
  }

  if (state.kind === "join-error") {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-white px-6 text-center">
        <AlertCircle className="h-12 w-12 text-red-500" />
        <h1 className="text-xl font-bold">加入失敗</h1>
        <p className="text-sm text-gray-500">{state.message}</p>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-white px-6 text-center">
        <AlertCircle className="h-12 w-12 text-red-500" />
        <h1 className="text-xl font-bold">發生錯誤</h1>
        <p className="text-sm text-gray-500">{state.message}</p>
      </div>
    );
  }

  if (state.kind === "issued") {
    const { ticket } = state;
    const numStr = `${ticket.prefix}${String(ticket.number).padStart(3, "0")}`;
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-6 bg-white px-6 text-center">
        <Ticket className="h-12 w-12 text-blue-600" />
        <div>
          <p className="text-sm font-medium text-gray-500">您的號碼</p>
          <p className="mt-1 text-7xl font-black tabular-nums text-blue-700">{numStr}</p>
        </div>
        <p className="text-sm text-gray-500">叫到您的號碼時，LINE 將自動通知您</p>
        <Button
          onClick={handleShare}
          variant="outline"
          className="gap-2 border-blue-200 text-blue-700 hover:bg-blue-50"
        >
          <Users className="h-4 w-4" />
          分享給朋友一起追蹤
        </Button>
      </div>
    );
  }

  // ── idle: take-a-number form ───────────────────────────────────────────────
  const { status } = state;
  const hasParams = !!(state.queueId && state.orgId);

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-6 bg-white px-6">
      <Ticket className="h-14 w-14 text-blue-600" />
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900">排隊取號</h1>
        {status && (
          <p className="mt-1 text-sm text-gray-500">
            {status.queueName}{" "}目前叫到：
            <span className="font-semibold text-blue-700">
              {status.prefix}{String(status.currentNumber).padStart(3, "0")}
            </span>
            {" "}等候：<span className="font-semibold">{status.waitingCount}</span> 人
          </p>
        )}
      </div>

      {!hasParams && (
        <div className="w-full max-w-xs space-y-3">
          <div>
            <Label htmlFor="orgId" className="text-xs text-gray-500">Org ID</Label>
            <Input id="orgId" value={orgIdInput} onChange={(e) => setOrgIdInput(e.target.value)} placeholder="組織 UUID" />
          </div>
          <div>
            <Label htmlFor="queueId" className="text-xs text-gray-500">Queue ID</Label>
            <Input id="queueId" value={queueIdInput} onChange={(e) => setQueueIdInput(e.target.value)} placeholder="隊列 UUID" />
          </div>
        </div>
      )}

      <Button
        size="lg"
        className="w-full max-w-xs bg-blue-600 text-white hover:bg-blue-700"
        onClick={handleIssue}
        disabled={!hasParams && !(queueIdInput && orgIdInput)}
      >
        取號
      </Button>
    </div>
  );
}
