import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ChatPage          from "@/pages/ChatPage";
import SettingsPage      from "@/pages/SettingsPage";
import OAuthCallbackPage from "@/pages/OAuthCallbackPage";
import { loadSettings, saveSettings, DEFAULT_MCP_URL } from "@/store/settings";

// ── One-time startup: read ?token= from URL, auto-configure, clean up URL ──
// This runs synchronously before the first render so ChatPage sees a valid config.
;(function autoConfigureFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const token  = params.get("token")?.trim().toLowerCase() ?? "";
  if (!/^[0-9a-f]{64}$/.test(token)) return;                // not a valid token

  const cfg = loadSettings();
  cfg.mcp.serverUrl = DEFAULT_MCP_URL;
  cfg.mcp.token     = token;
  saveSettings(cfg);

  // Strip ?token= from the address bar (security + clean UX)
  const clean = window.location.origin + window.location.pathname;
  window.history.replaceState({}, "", clean);
})();

// Strip trailing slash so BrowserRouter receives "/SignCMS" not "/SignCMS/"
const basename = ((import.meta as unknown as { env: Record<string, string> }).env.BASE_URL ?? "/").replace(/\/$/, "") || "/";

export default function App() {
  return (
    <BrowserRouter basename={basename}>
      <div className="h-full max-w-lg mx-auto relative overflow-hidden">
        <Routes>
          <Route path="/"               element={<ChatPage />} />
          <Route path="/settings"       element={<SettingsPage />} />
          <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
          <Route path="*"               element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
