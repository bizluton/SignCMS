import type { LLMConfig, ChatMessage } from "@/types";
import type { MCPTool } from "@/lib/mcp";
import type { LLMAdapter, LLMStreamChunk } from "./index";

function mcpToOllama(tool: MCPTool) {
  return {
    type:     "function" as const,
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
  };
}

export function ollamaAdapter(cfg: LLMConfig): LLMAdapter {
  const endpoint = cfg.endpoint ?? "http://localhost:11434";
  return {
    async stream(messages, tools, onChunk) {
      const history = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

      const res = await fetch(`${endpoint}/api/chat`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model:    cfg.model,
          stream:   true,
          messages: history,
          tools:    tools.map(mcpToOllama),
        }),
      });

      if (!res.ok) {
        onChunk({ type: "error", error: await res.text() });
        return;
      }

      const reader = res.body!.getReader();
      const dec    = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const lines = dec.decode(value).split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const ev = JSON.parse(line);
            const msg = ev.message;
            if (msg?.content) onChunk({ type: "text", text: msg.content });
            if (msg?.tool_calls) {
              for (const tc of msg.tool_calls) {
                onChunk({
                  type:     "tool_call",
                  toolCall: { name: tc.function.name, arguments: tc.function.arguments ?? {} },
                });
              }
            }
            if (ev.done) { onChunk({ type: "done" }); return; }
          } catch { /* skip */ }
        }
      }
      onChunk({ type: "done" });
    },
  };
}
