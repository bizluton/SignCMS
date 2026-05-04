import type { LLMConfig, ChatMessage } from "@/types";
import type { MCPTool } from "@/lib/mcp";
import type { LLMAdapter, LLMStreamChunk } from "./index";

function mcpToAnthropicTool(tool: MCPTool) {
  return { name: tool.name, description: tool.description, input_schema: tool.inputSchema };
}

export function anthropicAdapter(cfg: LLMConfig): LLMAdapter {
  return {
    async stream(messages, tools, onChunk) {
      const history = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

      const systemMsg = messages.find((m) => m.role === "system")?.content;

      const body: Record<string, unknown> = {
        model:      cfg.model,
        max_tokens: 4096,
        stream:     true,
        messages:   history,
        tools:      tools.map(mcpToAnthropicTool),
      };
      if (systemMsg) body.system = systemMsg;

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:  "POST",
        headers: {
          "Content-Type":      "application/json",
          "x-api-key":         cfg.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        onChunk({ type: "error", error: await res.text() });
        return;
      }

      const reader = res.body!.getReader();
      const dec    = new TextDecoder();
      let pendingToolName = "";
      let pendingToolInput = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const lines = dec.decode(value).split("\n").filter((l) => l.startsWith("data:"));
        for (const line of lines) {
          try {
            const ev = JSON.parse(line.slice(5).trim());
            if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use") {
              pendingToolName  = ev.content_block.name;
              pendingToolInput = "";
            } else if (ev.type === "content_block_delta") {
              if (ev.delta?.type === "text_delta") {
                onChunk({ type: "text", text: ev.delta.text });
              } else if (ev.delta?.type === "input_json_delta") {
                pendingToolInput += ev.delta.partial_json;
              }
            } else if (ev.type === "content_block_stop" && pendingToolName) {
              let args: Record<string, unknown> = {};
              try { args = JSON.parse(pendingToolInput); } catch { /* leave empty */ }
              onChunk({ type: "tool_call", toolCall: { name: pendingToolName, arguments: args } });
              pendingToolName  = "";
              pendingToolInput = "";
            } else if (ev.type === "message_stop") {
              onChunk({ type: "done" });
            }
          } catch { /* skip */ }
        }
      }
      onChunk({ type: "done" });
    },
  };
}
