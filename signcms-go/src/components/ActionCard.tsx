import { clsx } from "clsx";
import { CheckCircle, AlertTriangle, XCircle, Info, HelpCircle } from "lucide-react";
import type { ActionCard } from "@/types";

interface Props {
  card: ActionCard;
}

const ICONS = {
  success: CheckCircle,
  warning: AlertTriangle,
  error:   XCircle,
  info:    Info,
  confirm: HelpCircle,
};

const COLORS = {
  success: "border-emerald-700 bg-emerald-950/60 text-emerald-300",
  warning: "border-amber-700  bg-amber-950/60  text-amber-300",
  error:   "border-red-700    bg-red-950/60    text-red-300",
  info:    "border-blue-700   bg-blue-950/60   text-blue-300",
  confirm: "border-indigo-700 bg-indigo-950/60 text-indigo-300",
};

export function ActionCardView({ card }: Props) {
  const Icon = ICONS[card.variant];

  return (
    <div className={clsx("mx-4 rounded-xl border p-4 space-y-3", COLORS[card.variant])}>
      <div className="flex items-start gap-2.5">
        <Icon className="w-5 h-5 flex-shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="font-semibold text-sm">{card.title}</p>
          <p className="text-xs opacity-80 mt-0.5 leading-relaxed">{card.body}</p>
        </div>
      </div>

      {(card.onConfirm || card.onCancel) && (
        <div className="flex gap-2 pt-1">
          {card.onConfirm && (
            <button
              onClick={card.onConfirm}
              className="flex-1 py-1.5 text-xs font-medium rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
            >
              {card.confirmLabel ?? "確認"}
            </button>
          )}
          {card.onCancel && (
            <button
              onClick={card.onCancel}
              className="flex-1 py-1.5 text-xs font-medium rounded-lg opacity-60 hover:opacity-100 transition-opacity"
            >
              {card.cancelLabel ?? "取消"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
