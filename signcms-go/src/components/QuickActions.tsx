import { Monitor, AlertTriangle, BarChart2, List } from "lucide-react";

const QUICK = [
  { icon: Monitor,       label: "螢幕狀態",   prompt: "顯示目前所有螢幕的上線狀態" },
  { icon: AlertTriangle, label: "警報",       prompt: "目前有哪些螢幕離線？" },
  { icon: List,          label: "頻道列表",   prompt: "列出所有可用頻道" },
  { icon: BarChart2,     label: "今日統計",   prompt: "顯示今日的播放統計摘要" },
];

interface Props {
  onSelect: (prompt: string) => void;
}

export function QuickActions({ onSelect }: Props) {
  return (
    <div className="flex gap-2 px-4 pb-2 overflow-x-auto scrollbar-hide">
      {QUICK.map((q) => {
        const Icon = q.icon;
        return (
          <button
            key={q.label}
            onClick={() => onSelect(q.prompt)}
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors border border-slate-700/50"
          >
            <Icon className="w-3.5 h-3.5" />
            {q.label}
          </button>
        );
      })}
    </div>
  );
}
