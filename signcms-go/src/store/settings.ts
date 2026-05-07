import type { AppSettings, LLMProvider } from "@/types";

// Default MCP server — baked in so users never need to type a Supabase URL
export const DEFAULT_MCP_URL =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_MCP_SERVER_URL
  ?? "https://narhbpojjtnalyfiwxue.supabase.co/functions/v1/signcms-mcp";

const STORAGE_KEY = "signcms_go_settings";

const DEFAULTS: AppSettings = {
  llm: {
    provider: "openai",
    apiKey:   "",
    model:    "gpt-4o",
  },
  mcp: {
    serverUrl: "",
    token:     "",
  },
  language: "zh",
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULTS);
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function saveSettings(s: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export function getDefaultModel(provider: LLMProvider): string {
  const map: Record<LLMProvider, string> = {
    openai:    "gpt-4o",
    anthropic: "claude-sonnet-4-6",
    ollama:    "llama3.2",
    azure:     "gpt-4o",
  };
  return map[provider];
}

// ── Token-in-URL helpers ────────────────────────────────────────────────────

/**
 * Parse a connection URL that may have a 64-hex MCP token embedded in the path.
 * Accepts both:
 *   https://…/signcms-mcp                      → { serverUrl, token: "" }
 *   https://…/signcms-mcp/d7c53670…(64 hex)    → { serverUrl, token }
 */
export function parseConnectionUrl(raw: string): { serverUrl: string; token: string } {
  const trimmed = raw.trim().replace(/\/$/, "");
  // Match the last path segment that is exactly 64 lowercase hex chars
  const m = trimmed.match(/^(https?:\/\/.+?)\/([0-9a-f]{64})(\/.*)?$/i);
  if (m) return { serverUrl: m[1], token: m[2].toLowerCase() };
  return { serverUrl: trimmed, token: "" };
}

/**
 * Build the display connection URL from separate serverUrl + token.
 */
export function makeConnectionUrl(serverUrl: string, token: string): string {
  if (serverUrl && token) return `${serverUrl}/${token}`;
  return serverUrl;
}

export function isConfigured(s: AppSettings): boolean {
  const hasServer = !!(s.mcp.serverUrl && s.mcp.token);
  // Ollama runs locally — no API key required
  const hasLlm = s.llm.provider === "ollama"
    ? true
    : !!(s.llm.apiKey);
  return hasServer && hasLlm;
}
