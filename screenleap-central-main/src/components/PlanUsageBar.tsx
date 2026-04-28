import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { LucideIcon } from "lucide-react";

interface PlanUsageBarProps {
  icon: LucideIcon;
  label: string;
  /** Current usage value */
  used: number;
  /** Plan limit. -1 means unlimited */
  limit: number;
  /** Optional formatter for the numeric values (defaults to integer string). Used for both `used` and `limit`. */
  formatValue?: (value: number) => string;
  /** Plan name suffix (e.g. "Business") */
  planLabel?: string;
  /** Suffix appended after the percentage (e.g. "used") */
  usedSuffix?: string;
}

export function PlanUsageBar({
  icon: Icon,
  label,
  used,
  limit,
  formatValue,
  planLabel,
  usedSuffix,
}: PlanUsageBarProps) {
  const fmt = formatValue ?? ((v: number) => String(v));
  const unlimited = limit < 0;
  const pct = unlimited ? 0 : Math.min((used / Math.max(limit, 1)) * 100, 100);
  const overLimit = !unlimited && used >= limit;
  const warn = !unlimited && pct > 80 && !overLimit;

  return (
    <Card className="p-4 space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 font-medium text-foreground">
          <Icon className="w-4 h-4" />
          {label}
        </span>
        <span
          className={`text-xs ${
            overLimit ? "text-destructive font-bold" : "text-muted-foreground"
          }`}
        >
          {fmt(used)} / {unlimited ? "∞" : fmt(limit)}
          {planLabel && (
            <span className="ml-1.5 text-muted-foreground">({planLabel})</span>
          )}
        </span>
      </div>
      <Progress
        value={unlimited ? 0 : pct}
        className={`h-2.5 ${
          overLimit
            ? "[&>div]:bg-destructive"
            : warn
              ? "[&>div]:bg-orange-500"
              : ""
        }`}
      />
      {!unlimited && (
        <p className="text-xs text-muted-foreground">
          {pct.toFixed(1)}% {usedSuffix ?? ""}
        </p>
      )}
    </Card>
  );
}
