import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Send } from "lucide-react";
import { clsx } from "clsx";

import type { ChatMessage, MCPToolCall } from "@/types";
import { loadSettings, isConfigured } from "@/store/settings";
import { makeMCPClient } from "@/lib/mcp";
import type { MCPTool } from "@/lib/mcp";
import { getAdapter } from "@/lib/llm";
import { MessageBubble, TypingIndicator } from "@/components/MessageBubble";
import { StatusBar } from "@/components/StatusBar";
import { QuickActions } from "@/components/QuickActions";
import { VoiceButton } from "@/components/VoiceButton";
import { AttachButton } from "@/components/AttachButton";
import { usePushNotifications } from "@/hooks/usePushNotifications";

function makeId() {
  return Math.random().toString(36).slice(2);
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const SYSTEM_PROMPT = `你是 SignCMS 智慧看板管理助理。你可以使用以下 MCP 工具查詢和控制數位看板系統。
重要規則：
1. 執行寫入操作（切換頻道、發布、緊急廣播）前，先向用戶確認目標
2. 大量操作（all screens）前必須得到明確授權
3. 用繁體中文回覆，除非用戶使用其他語言
4. 工具調用後，簡要說明結果，不要重複原始 JSON
`;

export default function ChatPage() {
  const navigate  = useNavigate();
  const settings  = loadSettings();

  const [messages,    setMessages]    = useState<ChatMessage[]>([]);
  const [input,       setInput]       = useState("");
  const [typing,      setTyping]      = useState(false);
  const [connected,   setConnected]   = useState(false);
  const [tools,       setTools]       = useState<MCPTool[]>([]);
  const [orgSummary,  setOrgSummary]  = useState<{ total: number; online: number; offline: number } | null>(null);
  const [mcpClient,   setMcpClient]   = useState<ReturnType<typeof makeMCPClient> | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading,   setUploading]   = useState(false);

  const { state: pushState, subscribe: subscribePush, unsubscribe: unsubscribePush } = usePushNotifications();

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  // ── Redirect to settings if not configured ──────────────────────────────
  useEffect(() => {
    if (!isConfigured(settings)) navigate("/settings");
  }, []);

  // ── Connect to MCP on mount ──────────────────────────────────────────────
  useEffect(() => {
    const mcp = makeMCPClient(settings.mcp);
    setMcpClient(mcp);
    (async () => {
      const ok = await mcp.ping();
      setConnected(ok);
      if (!ok) return;

      try {
        const toolList = await mcp.listTools();
        setTools(toolList);

        const result = await mcp.callTool({ name: "get_org_summary", arguments: {} });
        if (result.content[0]) {
          const data = JSON.parse(result.content[0].text) as {
            total_screens: number; online_screens: number; offline_screens: number;
          };
          setOrgSummary({
            total:   data.total_screens,
            online:  data.online_screens,
            offline: data.offline_screens,
          });
        }
      } catch { /* non-fatal */ }
    })();
  }, []);

  // ── Auto-scroll ──────────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  // ── Send a message ───────────────────────────────────────────────────────
  const sendMessage = useCallback(async (text: string, file?: File) => {
    const attachFile = file ?? pendingFile;
    if (!text.trim() && !attachFile || typing) return;

    setInput("");
    setPendingFile(null);

    const mcp     = mcpClient ?? makeMCPClient(settings.mcp);
    const adapter = getAdapter(settings.llm);

    // ── Upload file if attached ──────────────────────────────────────────
    let uploadNote = "";
    if (attachFile) {
      setUploading(true);
      try {
        const base64 = await fileToBase64(attachFile);
        const res    = await mcp.callTool({
          name:      "upload_media",
          arguments: {
            filename:    attachFile.name,
            mime_type:   attachFile.type,
            base64_data: base64,
            file_size:   attachFile.size,
          },
        });
        const data = JSON.parse(res.content[0]?.text ?? "{}") as {
          id?: string; name?: string; url?: string;
        };
        if (data.id && data.url) {
          uploadNote = `\n[已上傳媒體: 名稱="${data.name}", id="${data.id}", url="${data.url}"]`;
        }
      } catch (e) {
        uploadNote = `\n[媒體上傳失敗: ${e instanceof Error ? e.message : String(e)}]`;
      } finally {
        setUploading(false);
      }
    }

    const userContent = (text.trim() + uploadNote).trim() || "(已上傳檔案)";

    const userMsg: ChatMessage = {
      id:        makeId(),
      role:      "user",
      content:   userContent,
      timestamp: Date.now(),
    };
    const systemMsg: ChatMessage = {
      id:        "system",
      role:      "system",
      content:   SYSTEM_PROMPT,
      timestamp: 0,
    };

    setMessages((prev) => [...prev, userMsg]);
    setTyping(true);

    // Working history mutated each agentic round
    const history: ChatMessage[] = [systemMsg, ...messages.filter((m) => m.role !== "system"), userMsg];

    const assistantId                                          = makeId();
    let   assistantText                                        = "";
    const allToolCalls: NonNullable<ChatMessage["toolCalls"]> = [];
    let   errorMsg: string | undefined;

    setMessages((prev) => [...prev, {
      id: assistantId, role: "assistant", content: "", timestamp: Date.now(),
    }]);

    try {
      const MAX_ROUNDS = 5;

      for (let round = 0; round < MAX_ROUNDS; round++) {
        const turnCalls: MCPToolCall[] = [];
        let   turnError: string | undefined;
        const roundTextStart = assistantText.length;

        // Properly awaited — errors propagate to outer try/catch
        await adapter.stream(history, tools, (chunk) => {
          if (chunk.type === "text" && chunk.text) {
            assistantText += chunk.text;
            setMessages((prev) => prev.map((m) =>
              m.id === assistantId ? { ...m, content: assistantText } : m,
            ));
          }
          if (chunk.type === "tool_call" && chunk.toolCall) {
            turnCalls.push(chunk.toolCall);
          }
          if (chunk.type === "error") {
            turnError = chunk.error ?? "Unknown LLM error";
          }
        });

        if (turnError) throw new Error(turnError);

        // No tool calls → LLM is done
        if (turnCalls.length === 0) break;

        // ── Execute every tool called this turn ────────────────────────────
        const toolResults: string[] = [];
        for (const tc of turnCalls) {
          const t0 = Date.now();
          let resultText = "{}";
          try {
            const res  = await mcp.callTool(tc);
            resultText = res.content[0]?.text ?? "{}";
            allToolCalls.push({
              tool:   tc.name,
              args:   tc.arguments,
              result: JSON.parse(resultText),
              ms:     Date.now() - t0,
            });
          } catch (e) {
            resultText = JSON.stringify({ error: String(e) });
            allToolCalls.push({
              tool:   tc.name,
              args:   tc.arguments,
              result: { error: String(e) },
              ms:     Date.now() - t0,
            });
          }
          toolResults.push(`[工具結果 ${tc.name}]: ${resultText}`);
        }

        // Show tool chips in the bubble while we wait for the next round
        setMessages((prev) => prev.map((m) =>
          m.id === assistantId ? { ...m, toolCalls: [...allToolCalls] } : m,
        ));

        // Add assistant turn FIRST — prevents consecutive user messages (Anthropic rejects them)
        const roundText = assistantText.slice(roundTextStart);
        history.push({
          id:        makeId(),
          role:      "assistant",
          content:   roundText || turnCalls.map((tc) => `[calling ${tc.name}]`).join(" "),
          timestamp: Date.now(),
        });

        // Batch ALL tool results into a single user message
        history.push({
          id:        makeId(),
          role:      "user",
          content:   toolResults.join("\n"),
          timestamp: Date.now(),
        });
      }
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e);
    } finally {
      // Single final state update — always runs even if stream hangs or throws
      setMessages((prev) => prev.map((m) =>
        m.id === assistantId
          ? {
              ...m,
              content:   assistantText,
              toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
              error:     errorMsg,
            }
          : m,
      ));
      setTyping(false);
    }
  }, [messages, tools, settings, typing, mcpClient, pendingFile]);

  // ── Input key handling ───────────────────────────────────────────────────
  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const busy = typing || uploading;

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* Header */}
      <div className="safe-top bg-slate-950" />
      <StatusBar
        connected={connected}
        orgSummary={orgSummary}
        pushState={pushState}
        onPushToggle={() => {
          if (!mcpClient) return;
          if (pushState === "granted") unsubscribePush(mcpClient);
          else subscribePush(mcpClient);
        }}
      />

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4 space-y-3 scrollbar-hide">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
            <div className="w-14 h-14 rounded-2xl bg-brand/20 flex items-center justify-center">
              <Send className="w-7 h-7 text-brand" />
            </div>
            <p className="text-slate-300 font-medium">你好！我是 SignCMS 助理</p>
            <p className="text-slate-500 text-sm">輸入問題或點擊下方快速操作開始</p>
          </div>
        )}
        {messages
          .filter((m) => m.role !== "system")
          .map((m) => <MessageBubble key={m.id} message={m} />)
        }
        {typing && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* Quick actions */}
      {messages.filter((m) => m.role !== "system").length === 0 && (
        <QuickActions onSelect={(p) => sendMessage(p)} />
      )}

      {/* File preview strip */}
      {pendingFile && (
        <div className="border-t border-slate-800 bg-slate-900 px-3 pt-2 flex items-center gap-2">
          <div className="flex items-center gap-2 bg-slate-800 rounded-lg px-3 py-1.5 flex-1 min-w-0">
            {pendingFile.type.startsWith("image/") ? (
              <img
                src={URL.createObjectURL(pendingFile)}
                alt="preview"
                className="w-8 h-8 rounded object-cover shrink-0"
              />
            ) : (
              <div className="w-8 h-8 rounded bg-slate-700 flex items-center justify-center shrink-0 text-xs text-slate-400">
                🎬
              </div>
            )}
            <span className="text-xs text-slate-300 truncate">{pendingFile.name}</span>
          </div>
          <button
            onClick={() => setPendingFile(null)}
            className="text-slate-500 hover:text-slate-300 text-lg leading-none px-1"
            aria-label="Remove file"
          >
            ×
          </button>
        </div>
      )}

      {/* Input bar */}
      <div className="border-t border-slate-800 bg-slate-900 px-3 py-2 safe-bottom">
        <div className="flex items-end gap-2">
          <VoiceButton
            onTranscript={(t) => { setInput(t); setTimeout(() => sendMessage(t), 100); }}
            disabled={busy}
            language={settings.language === "ja" ? "ja-JP" : settings.language === "en" ? "en-US" : "zh-TW"}
          />
          <AttachButton
            onFile={(f) => setPendingFile(f)}
            disabled={busy}
          />
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={uploading ? "上傳中…" : "輸入訊息…"}
            disabled={busy}
            className={clsx(
              "flex-1 bg-slate-800 text-slate-100 placeholder:text-slate-500",
              "rounded-2xl px-4 py-2.5 text-sm resize-none outline-none",
              "max-h-32 overflow-y-auto scrollbar-hide",
              "border border-slate-700 focus:border-brand transition-colors",
              busy && "opacity-50",
            )}
            style={{ height: "auto" }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = `${el.scrollHeight}px`;
            }}
          />
          <button
            type="button"
            onClick={() => sendMessage(input)}
            disabled={(!input.trim() && !pendingFile) || busy}
            className={clsx(
              "p-2.5 rounded-full transition-colors",
              (input.trim() || pendingFile) && !busy
                ? "bg-brand text-white hover:bg-brand-dark"
                : "bg-slate-700 text-slate-500",
            )}
            aria-label="Send"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
