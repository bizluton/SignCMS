import type { LLMConfig, ChatMessage, MCPToolCall } from "@/types";
import type { MCPTool } from "@/lib/mcp";
import { openaiAdapter } from "./openai";
import { anthropicAdapter } from "./anthropic";
import { ollamaAdapter } from "./ollama";

export interface LLMStreamChunk {
  type:      "text" | "tool_call" | "done" | "error";
  text?:     string;
  toolCall?: MCPToolCall;
  error?:    string;
}

export interface LLMAdapter {
  stream(
    messages:  ChatMessage[],
    tools:     MCPTool[],
    onChunk:   (chunk: LLMStreamChunk) => void,
  ): Promise<void>;
}

export function getAdapter(cfg: LLMConfig): LLMAdapter {
  switch (cfg.provider) {
    case "openai":
    case "azure":
      return openaiAdapter(cfg);
    case "anthropic":
      return anthropicAdapter(cfg);
    case "ollama":
      return ollamaAdapter(cfg);
  }
}
