import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Eye, EyeOff, Save, CheckCircle, Link2, ExternalLink } from "lucide-react";
import { clsx } from "clsx";

import type { LLMProvider } from "@/types";
import { loadSettings, saveSettings, getDefaultModel,
         parseConnectionUrl, makeConnectionUrl } from "@/store/settings";

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
  const navigate       = useNavigate();
  const [searchParams] = useSearchParams();
  const [s, setS]      = useState(loadSettings);
  const [showKey,   setShowKey]   = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [oauthMsg,  setOauthMsg]  = useState<{ ok: boolean; text: string } | null>(null);

  // Connection URL field — single input that accepts either base URL or token-in-URL
  const [connectionInput, setConnectionInput] = useState(() =>
    makeConnectionUrl(loadSettings().mcp.serverUrl, loadSettings().mcp.token),
  );

  // Show OAuth success/error from callback redirect
  useEffect(() => {
    const result = searchParams.get("oauth");
    if (result === "success") setOauthMsg({ ok: true,  text: "✅ 已成功透過 OAuth 取得 Token！" });
    if (result === "error")   setOauthMsg({ ok: false, text: "❌ OAuth 授權失敗，請重試。" });
    if (result) setTimeout(() => setOauthMsg(null), 4000);
  }, [searchParams]);

  // Detect token in the connection URL as user types
  const { token: detectedToken } = parseConnectionUrl(connectionInput);
  const tokenOk = detectedToken.length === 64;

  const handleConnectionUrl = (raw: string) => {
    setConnectionInput(raw);
    const { serverUrl, token } = parseConnectionUrl(raw);
    setS((p) => ({ ...p, mcp: { ...p.mcp, serverUrl, token } }));
  };

  // OAuth Connect — opens the MCP server's authorize page in a popup
  const handleOAuthConnect = () => {
    const { serverUrl } = parseConnectionUrl(connectionInput);
    if (!serverUrl) { alert("請先輸入 MCP Server URL。"); return; }

    const state = crypto.randomUUID();
    sessionStorage.setItem("mcp_oauth_state",      state);
    sessionStorage.setItem("mcp_oauth_server_url", serverUrl);

    // Build callback URL for this PWA
    const base        = (import.meta as unknown as { env: Record<string, string> }).env.BASE_URL ?? "/";
    const callbackUrl = `${window.location.origin}${base}oauth/callback`.replace(/([^:])\/\//g, "$1/");

    const authorize = new URL(`${serverUrl}/oauth/authorize`);
    authorize.searchParams.set("client_id",     "signcms-go");
    authorize.searchParams.set("redirect_uri",  callbackUrl);
    authorize.searchParams.set("state",         state);
    authorize.searchParams.set("response_type", "code");

    window.open(authorize.toString(), "_blank", "popup,width=500,height=640,noopener");
  };

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
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">MCP 連線</h2>

          {/* OAuth 狀態訊息 */}
          {oauthMsg && (
            <div className={clsx(
              "rounded-xl px-3 py-2.5 text-xs font-medium",
              oauthMsg.ok ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400",
            )}>
              {oauthMsg.text}
            </div>
          )}

          {/* Connection URL */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs text-slate-400">Connection URL</label>
              {connectionInput && (
                <span className={clsx(
                  "text-[10px] font-medium px-1.5 py-0.5 rounded-full",
                  tokenOk
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "bg-amber-500/20 text-amber-400",
                )}>
                  {tokenOk ? "✓ Token 已偵測" : "⚠ 未偵測到 Token"}
                </span>
              )}
            </div>
            <input
              type="url"
              value={connectionInput}
              onChange={(e) => handleConnectionUrl(e.target.value)}
              placeholder="https://…/signcms-mcp/你的64位Token"
              className="w-full bg-slate-800 border border-slate-700 text-slate-100 placeholder:text-slate-500 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand transition-colors font-mono"
            />
            <p className="text-[11px] text-slate-500 leading-relaxed">
              貼上「SignCMS → 系統設定 → MCP 金鑰」的完整連線 URL（已含 Token）。
            </p>
          </div>

          {/* OAuth Connect 按鈕 */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-slate-800" />
            <span className="text-[11px] text-slate-600">或</span>
            <div className="flex-1 h-px bg-slate-800" />
          </div>
          <button
            type="button"
            onClick={handleOAuthConnect}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-slate-700 bg-slate-800 text-slate-300 text-sm font-medium hover:border-brand hover:text-white transition-colors"
          >
            <Link2 className="w-4 h-4" />
            透過 OAuth 連線
            <ExternalLink className="w-3.5 h-3.5 opacity-50" />
          </button>
          <p className="text-[11px] text-slate-500">
            開啟 SignCMS 授權頁面，輸入 Token 後自動完成設定。
          </p>

          <p className="text-[11px] text-slate-600 border-t border-slate-800 pt-3">
            Token 僅儲存在本裝置，不會上傳至 SignCMS 伺服器。
          </p>
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
