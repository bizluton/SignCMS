// ── App-wide types ─────────────────────────────────────────────────────────────

export type LLMProvider = "openai" | "anthropic" | "ollama" | "azure";

export interface LLMConfig {
  provider:    LLMProvider;
  apiKey:      string;   // stored only in localStorage, never sent to server
  endpoint?:   string;   // for ollama / azure custom endpoints
  model:       string;
  proxyUrl?:   string;   // MCP server URL used as CORS proxy
  proxyToken?: string;   // MCP token for proxy auth
}

export interface MCPConfig {
  serverUrl: string;   // e.g. https://narhbpojjtnalyfiwxue.supabase.co/functions/v1/signcms-mcp
  token:     string;   // raw MCP token
}

export interface AppSettings {
  llm:      LLMConfig;
  mcp:      MCPConfig;
  language: "zh" | "en" | "ja";
}

// ── Chat types ─────────────────────────────────────────────────────────────────

export type MessageRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id:        string;
  role:      MessageRole;
  content:   string;
  timestamp: number;
  toolCalls?: ToolCallRecord[];
  error?:    string;
}

export interface ToolCallRecord {
  tool:   string;
  args:   Record<string, unknown>;
  result: unknown;
  ms:     number;
}

// ── Action card types ─────────────────────────────────────────────────────────

export type ActionCardVariant = "success" | "warning" | "error" | "info" | "confirm";

export interface ActionCard {
  variant:    ActionCardVariant;
  title:      string;
  body:       string;
  confirmLabel?: string;
  cancelLabel?:  string;
  onConfirm?:    () => void;
  onCancel?:     () => void;
}

// ── MCP tool types ────────────────────────────────────────────────────────────

export interface MCPToolCall {
  name:      string;
  arguments: Record<string, unknown>;
}

export interface MCPToolResult {
  content: Array<{ type: "text"; text: string }>;
}
