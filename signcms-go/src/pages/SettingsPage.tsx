import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Eye, EyeOff, Save, CheckCircle } from "lucide-react";
import { clsx } from "clsx";

import type { LLMProvider } from "@/types";
import { loadSettings, saveSettings, getDefaultModel } from "@/store/settings";

const PROVIDERS: { value: LLMProvider; label: string; models: string[] }[] = [
  { value: "openai",    label: "OpenAI",          models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"] },
  { value: "anthropic", label: "Anthropic Claude", models: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"] },
  { value: "ollama",    label: "Ollama (本地)",    models: ["llama3.2", "mistral", "gemma2", "qwen2.5"] },
  { value: "azure",     label: "Azure OpenAI",     models: ["gpt-4o", "gpt-4-turbo"] },
];

const LANGUAGES = [
  { value: "zh" as const, label: "繁體中文" },
  { value: "en" as const, label: "English" },
  { value: "ja" as const, label: "日本語" },
];

export default function SettingsPage() {
  const navigate  = useNavigate();
  const [s, setS] = useState(loadSettings);
  const [showKey, setShowKey] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [saved,   setSaved]   = useState(false);

  const handleSave = () => {
    saveSettings(s);
    setSaved(true);
    setTimeout(() => { setSaved(false); navigate("/"); }, 1200);
  };

  const setProvider = (p: LLMProvider) => {
    setS((prev) => ({ ...prev, llm: { ...prev.llm, provider: p, model: getDefaultModel(p) } }));
  };

  const needsEndpoint = s.llm.provider === "ollama" || s.llm.provider === "azure";

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* Header */}
      <div className="safe-top bg-slate-950" />
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800">
        <button
          onClick={() => navigate(-1)}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="font-semibold text-white text-base">設定</h1>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6 scrollbar-hide">

        {/* ── MCP Section ─────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">MCP 伺服器</h2>
          <div className="space-y-2">
            <SettingField
              label="伺服器 URL"
              value={s.mcp.serverUrl}
              onChange={(v) => setS((p) => ({ ...p, mcp: { ...p.mcp, serverUrl: v } }))}
              placeholder="https://xxx.supabase.co/functions/v1/signcms-mcp"
              type="url"
            />
            <PasswordField
              label="MCP Token"
              value={s.mcp.token}
              onChange={(v) => setS((p) => ({ ...p, mcp: { ...p.mcp, token: v } }))}
              show={showToken}
              onToggle={() => setShowToken((x) => !x)}
              placeholder="64 位十六進位 Token"
            />
          </div>
          <p className="text-[11px] text-slate-500">Token 僅儲存在本裝置，不會上傳至 SignCMS 伺服器。</p>
        </section>

        {/* ── LLM Section ─────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">大語言模型 (BYOL)</h2>

          {/* Provider selector */}
          <div className="grid grid-cols-2 gap-2">
            {PROVIDERS.map((p) => (
              <button
                key={p.value}
                onClick={() => setProvider(p.value)}
                className={clsx(
                  "py-2 px-3 rounded-xl text-xs font-medium text-left transition-colors border",
                  s.llm.provider === p.value
                    ? "bg-brand/20 border-brand text-white"
                    : "bg-slate-800 border-slate-700 text-slate-400 hover:text-white",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Model */}
          <div className="space-y-1">
            <label className="text-xs text-slate-400">模型</label>
            <select
              value={s.llm.model}
              onChange={(e) => setS((p) => ({ ...p, llm: { ...p.llm, model: e.target.value } }))}
              className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand"
            >
              {PROVIDERS.find((p) => p.value === s.llm.provider)?.models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {/* API Key */}
          <PasswordField
            label="API Key"
            value={s.llm.apiKey}
            onChange={(v) => setS((p) => ({ ...p, llm: { ...p.llm, apiKey: v } }))}
            show={showKey}
            onToggle={() => setShowKey((x) => !x)}
            placeholder={s.llm.provider === "ollama" ? "Ollama 不需要 API Key" : "sk-…"}
          />

          {/* Endpoint (for Ollama / Azure) */}
          {needsEndpoint && (
            <SettingField
              label={s.llm.provider === "azure" ? "Azure 端點" : "Ollama 端點"}
              value={s.llm.endpoint ?? ""}
              onChange={(v) => setS((p) => ({ ...p, llm: { ...p.llm, endpoint: v } }))}
              placeholder={s.llm.provider === "azure" ? "https://your-resource.openai.azure.com" : "http://localhost:11434"}
              type="url"
            />
          )}
          <p className="text-[11px] text-slate-500">API Key 僅儲存在本裝置，對話請求直接從此裝置發送。</p>
        </section>

        {/* ── Language ────────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">介面語言</h2>
          <div className="flex gap-2">
            {LANGUAGES.map((l) => (
              <button
                key={l.value}
                onClick={() => setS((p) => ({ ...p, language: l.value }))}
                className={clsx(
                  "flex-1 py-2 text-xs font-medium rounded-xl border transition-colors",
                  s.language === l.value
                    ? "bg-brand/20 border-brand text-white"
                    : "bg-slate-800 border-slate-700 text-slate-400 hover:text-white",
                )}
              >
                {l.label}
              </button>
            ))}
          </div>
        </section>
      </div>

      {/* Save */}
      <div className="border-t border-slate-800 px-4 py-3 safe-bottom">
        <button
          onClick={handleSave}
          className={clsx(
            "w-full py-3 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors",
            saved ? "bg-emerald-600 text-white" : "bg-brand text-white hover:bg-brand-dark",
          )}
        >
          {saved ? <CheckCircle className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          {saved ? "已儲存" : "儲存設定"}
        </button>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function SettingField({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-slate-400">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-slate-800 border border-slate-700 text-slate-100 placeholder:text-slate-500 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand transition-colors"
      />
    </div>
  );
}

function PasswordField({ label, value, onChange, placeholder, show, onToggle }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; show: boolean; onToggle: () => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-slate-400">{label}</label>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-slate-800 border border-slate-700 text-slate-100 placeholder:text-slate-500 rounded-xl px-3 py-2.5 pr-10 text-sm outline-none focus:border-brand transition-colors"
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
