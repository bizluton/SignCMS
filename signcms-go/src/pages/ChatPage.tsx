import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Send } from "lucide-react";
import { clsx } from "clsx";

import type { ChatMessage } from "@/types";
import { loadSettings, isConfigured } from "@/store/settings";
import { makeMCPClient } from "@/lib/mcp";
import type { MCPTool } from "@/lib/mcp";
import { getAdapter } from "@/lib/llm";
import { MessageBubble, TypingIndicator } from "@/components/MessageBubble";
import { StatusBar } from "@/components/StatusBar";
import { QuickActions } from "@/components/QuickActions";
import { VoiceButton } from "@/components/VoiceButton";

function makeId() {
  return Math.random().toString(36).slice(2);
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

  const [messages,   setMessages]   = useState<ChatMessage[]>([]);
  const [input,      setInput]      = useState("");
  const [typing,     setTyping]     = useState(false);
  const [connected,  setConnected]  = useState(false);
  const [tools,      setTools]      = useState<MCPTool[]>([]);
  const [orgSummary, setOrgSummary] = useState<{ total: number; online: number; offline: number } | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  // ── Redirect to settings if not configured ──────────────────────────────
  useEffect(() => {
    if (!isConfigured(settings)) navigate("/settings");
  }, []);

  // ── Connect to MCP on mount ──────────────────────────────────────────────
  useEffect(() => {
    const mcp = makeMCPClient(settings.mcp);
    (async () => {
      const ok = await mcp.ping();
      setConnected(ok);
      if (!ok) return;

      try {
        const toolList = await mcp.listTools();
        setTools(toolList);

        // Pull org summary for status bar
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
  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || typing) return;
    setInput("");

    const userMsg: ChatMessage = {
      id:        makeId(),
      role:      "user",
      content:   text.trim(),
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

    const history = [systemMsg, ...messages.filter((m) => m.role !== "system"), userMsg];
    const mcp     = makeMCPClient(settings.mcp);
    const adapter = getAdapter(settings.llm);

    const assistantId = makeId();
    let   assistantText = "";
    const toolCallsForMsg: ChatMessage["toolCalls"] = [];

    // Add a placeholder assistant message
    setMessages((prev) => [...prev, {
      id: assistantId, role: "assistant", content: "", timestamp: Date.now(),
    }]);

    const processStream = async (): Promise<void> => {
      return new Promise((resolve) => {
        adapter.stream(history, tools, async (chunk) => {
          if (chunk.type === "text" && chunk.text) {
            assistantText += chunk.text;
            setMessages((prev) => prev.map((m) =>
              m.id === assistantId ? { ...m, content: assistantText } : m,
            ));
          }

          if (chunk.type === "tool_call" && chunk.toolCall) {
            const tc = chunk.toolCall;
            const t0 = Date.now();
            try {
              const result = await mcp.callTool(tc);
              const resultText = result.content[0]?.text ?? "{}";
              toolCallsForMsg.push({ tool: tc.name, args: tc.arguments, result: JSON.parse(resultText), ms: Date.now() - t0 });

              // Feed tool result back into history and continue
              const toolResultMsg: ChatMessage = {
                id:        makeId(),
                role:      "system",
                content:   `Tool ${tc.name} result: ${resultText}`,
                timestamp: Date.now(),
              };
              history.push(toolResultMsg);
            } catch (e) {
              toolCallsForMsg.push({ tool: tc.name, args: tc.arguments, result: { error: String(e) }, ms: Date.now() - t0 });
            }
          }

          if (chunk.type === "done" || chunk.type === "error") {
            setMessages((prev) => prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content:   assistantText || (chunk.error ? "" : m.content),
                    toolCalls: toolCallsForMsg.length > 0 ? toolCallsForMsg : undefined,
                    error:     chunk.error,
                  }
                : m,
            ));
            setTyping(false);
            resolve();
          }
        });
      });
    };

    await processStream();
  }, [messages, tools, settings, typing]);

  // ── Input key handling ───────────────────────────────────────────────────
  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* Header */}
      <div className="safe-top bg-slate-950" />
      <StatusBar connected={connected} orgSummary={orgSummary} />

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

      {/* Input bar */}
      <div className="border-t border-slate-800 bg-slate-900 px-3 py-2 safe-bottom">
        <div className="flex items-end gap-2">
          <VoiceButton
            onTranscript={(t) => { setInput(t); setTimeout(() => sendMessage(t), 100); }}
            disabled={typing}
            language={settings.language === "ja" ? "ja-JP" : settings.language === "en" ? "en-US" : "zh-TW"}
          />
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="輸入訊息…"
            disabled={typing}
            className={clsx(
              "flex-1 bg-slate-800 text-slate-100 placeholder:text-slate-500",
              "rounded-2xl px-4 py-2.5 text-sm resize-none outline-none",
              "max-h-32 overflow-y-auto scrollbar-hide",
              "border border-slate-700 focus:border-brand transition-colors",
              typing && "opacity-50",
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
            disabled={!input.trim() || typing}
            className={clsx(
              "p-2.5 rounded-full transition-colors",
              input.trim() && !typing
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
