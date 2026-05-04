import type { AppSettings, LLMProvider } from "@/types";

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

export function isConfigured(s: AppSettings): boolean {
  return !!(s.mcp.serverUrl && s.mcp.token && s.llm.apiKey);
}
