import type { LLMConfig, ChatMessage } from "@/types";
import type { MCPTool } from "@/lib/mcp";
import type { LLMAdapter, LLMStreamChunk } from "./index";

function mcpToOpenAI(tool: MCPTool) {
  return {
    type:     "function" as const,
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
  };
}

function historyToOpenAI(messages: ChatMessage[]) {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
}

export function openaiAdapter(cfg: LLMConfig): LLMAdapter {
  const endpoint = cfg.endpoint ?? "https://api.openai.com/v1";
  return {
    async stream(messages, tools, onChunk) {
      const body = {
        model:       cfg.model,
        stream:      true,
        messages:    historyToOpenAI(messages),
        tools:       tools.map(mcpToOpenAI),
        tool_choice: "auto",
      };

      const res = await fetch(`${endpoint}/chat/completions`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
        body:    JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.text();
        onChunk({ type: "error", error: err });
        return;
      }

      const reader = res.body!.getReader();
      const dec    = new TextDecoder();

      // Accumulate tool-call arguments across chunks
      const pendingToolCalls: Record<number, { name: string; args: string }> = {};
      let textBuffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const lines = dec.decode(value).split("\n").filter((l) => l.startsWith("data:"));
        for (const line of lines) {
          const raw = line.slice(5).trim();
          if (raw === "[DONE]") { onChunk({ type: "done" }); return; }
          try {
            const parsed = JSON.parse(raw);
            const delta  = parsed.choices?.[0]?.delta;
            if (!delta) continue;

            if (delta.content) {
              textBuffer += delta.content;
              onChunk({ type: "text", text: delta.content });
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!pendingToolCalls[idx]) {
                  pendingToolCalls[idx] = { name: tc.function?.name ?? "", args: "" };
                }
                if (tc.function?.name)      pendingToolCalls[idx].name  += tc.function.name;
                if (tc.function?.arguments) pendingToolCalls[idx].args  += tc.function.arguments;
              }
            }

            if (parsed.choices?.[0]?.finish_reason === "tool_calls") {
              for (const tc of Object.values(pendingToolCalls)) {
                let args: Record<string, unknown> = {};
                try { args = JSON.parse(tc.args); } catch { /* leave empty */ }
                onChunk({ type: "tool_call", toolCall: { name: tc.name, arguments: args } });
              }
            }
          } catch { /* skip malformed chunks */ }
        }
      }
      onChunk({ type: "done" });
    },
  };
}
