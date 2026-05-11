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

      let res: Response;

      if (cfg.proxyUrl) {
        // Route through MCP edge function to avoid Anthropic CORS block
        res = await fetch(`${cfg.proxyUrl}/llm`, {
          method:  "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization:  `Bearer ${cfg.proxyToken ?? ""}`,
          },
          body: JSON.stringify({
            provider: "anthropic",
            api_key:  cfg.apiKey,
            model:    cfg.model,
            messages: history,
            system:   systemMsg,
            tools:    tools.length > 0 ? tools.map(mcpToAnthropicTool) : undefined,
          }),
        });
      } else {
        // Direct call (local dev / non-CORS-blocked origins)
        const body: Record<string, unknown> = {
          model:      cfg.model,
          max_tokens: 4096,
          stream:     true,
          messages:   history,
        };
        if (systemMsg) body.system = systemMsg;
        if (tools.length > 0) body.tools = tools.map(mcpToAnthropicTool);

        res = await fetch("https://api.anthropic.com/v1/messages", {
          method:  "POST",
          headers: {
            "Content-Type":                      "application/json",
            "x-api-key":                         cfg.apiKey,
            "anthropic-version":                 "2023-06-01",
            "anthropic-dangerous-allow-browser": "true",
          },
          body: JSON.stringify(body),
        });
      }

      if (!res.ok) {
        onChunk({ type: "error", error: await res.text() });
        return;
      }

      const reader = res.body!.getReader();
      const dec    = new TextDecoder();
      let lineBuf          = "";   // accumulate across read() chunks
      let pendingToolName  = "";
      let pendingToolInput = "";

      const processLine = (line: string) => {
        if (!line.startsWith("data:")) return;
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
        } catch { /* skip malformed chunks */ }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        // Append to buffer; use { stream: true } so multi-byte chars across chunks decode correctly
        lineBuf += dec.decode(value, { stream: true });
        const lines = lineBuf.split("\n");
        lineBuf = lines.pop() ?? "";   // last entry may be an incomplete line — keep it
        for (const line of lines) processLine(line);
      }
      // Flush any remaining complete line in the buffer
      for (const line of lineBuf.split("\n")) processLine(line);

      onChunk({ type: "done" });
    },
  };
}
