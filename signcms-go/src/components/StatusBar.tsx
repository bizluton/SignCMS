import { clsx } from "clsx";
import { Wifi, WifiOff, Settings, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface Props {
  connected:  boolean;
  orgSummary?: { total: number; online: number; offline: number } | null;
}

export function StatusBar({ connected, orgSummary }: Props) {
  const navigate = useNavigate();

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-slate-900/80 backdrop-blur border-b border-slate-800">
      {/* Left: connection status */}
      <div className="flex items-center gap-1.5">
        <div className={clsx(
          "w-2 h-2 rounded-full",
          connected ? "bg-emerald-400 animate-pulse" : "bg-red-500",
        )} />
        <span className="text-xs text-slate-400">
          {connected ? "已連線" : "未連線"}
        </span>
      </div>

      {/* Center: screen summary */}
      {orgSummary && (
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1 text-emerald-400">
            <Wifi className="w-3 h-3" />
            {orgSummary.online}
          </span>
          {orgSummary.offline > 0 && (
            <span className="flex items-center gap-1 text-red-400">
              <WifiOff className="w-3 h-3" />
              {orgSummary.offline}
            </span>
          )}
        </div>
      )}

      {/* Right: settings */}
      <button
        onClick={() => navigate("/settings")}
        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
        aria-label="Settings"
      >
        <Settings className="w-4 h-4" />
      </button>
    </div>
  );
}

export function AppHeader() {
  return (
    <div className="flex items-center gap-2 px-4 pt-safe-top pb-2 bg-slate-950">
      <div className="w-7 h-7 rounded-lg bg-brand flex items-center justify-center">
        <Zap className="w-4 h-4 text-white" />
      </div>
      <h1 className="text-base font-bold text-white tracking-tight">SignCMS Go</h1>
    </div>
  );
}
