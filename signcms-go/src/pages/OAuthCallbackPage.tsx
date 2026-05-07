import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { loadSettings, saveSettings } from "@/store/settings";

type Status = "loading" | "success" | "error";

export default function OAuthCallbackPage() {
  const navigate = useNavigate();
  const [status,  setStatus]  = useState<Status>("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const params     = new URLSearchParams(window.location.search);
    const code       = params.get("code")?.trim();
    const state      = params.get("state") ?? "";
    const oauthError = params.get("error");

    const savedState     = sessionStorage.getItem("mcp_oauth_state");
    const savedServerUrl = sessionStorage.getItem("mcp_oauth_server_url");

    // Clean up session storage regardless of outcome
    sessionStorage.removeItem("mcp_oauth_state");
    sessionStorage.removeItem("mcp_oauth_server_url");

    if (oauthError) {
      setStatus("error");
      setMessage(`OAuth 錯誤：${oauthError}`);
      setTimeout(() => navigate("/settings?oauth=error", { replace: true }), 2500);
      return;
    }

    if (!code) {
      setStatus("error");
      setMessage("未收到授權碼，請重試。");
      setTimeout(() => navigate("/settings?oauth=error", { replace: true }), 2500);
      return;
    }

    if (!savedState || state !== savedState) {
      setStatus("error");
      setMessage("State 不符，請重試。");
      setTimeout(() => navigate("/settings?oauth=error", { replace: true }), 2500);
      return;
    }

    // All good — save token + server URL
    try {
      const settings = loadSettings();
      if (savedServerUrl) settings.mcp.serverUrl = savedServerUrl;
      settings.mcp.token = code;
      saveSettings(settings);
      setStatus("success");
      setMessage("授權成功！正在返回設定…");
      setTimeout(() => navigate("/settings?oauth=success", { replace: true }), 1200);
    } catch {
      setStatus("error");
      setMessage("儲存設定失敗，請重試。");
      setTimeout(() => navigate("/settings?oauth=error", { replace: true }), 2500);
    }
  }, [navigate]);

  return (
    <div className="flex flex-col items-center justify-center h-full bg-slate-950 gap-5 px-6">
      {status === "loading" && (
        <>
          <div className="w-10 h-10 border-2 border-brand border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-400 text-sm">正在處理授權…</p>
        </>
      )}
      {status === "success" && (
        <>
          <div className="w-14 h-14 rounded-full bg-emerald-500/20 flex items-center justify-center text-2xl">✅</div>
          <p className="text-emerald-400 font-medium">{message}</p>
        </>
      )}
      {status === "error" && (
        <>
          <div className="w-14 h-14 rounded-full bg-red-500/20 flex items-center justify-center text-2xl">❌</div>
          <p className="text-red-400 text-sm text-center">{message}</p>
        </>
      )}
    </div>
  );
}
