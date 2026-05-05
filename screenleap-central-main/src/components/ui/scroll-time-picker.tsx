import * as React from "react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

// ─── helpers ───────────────────────────────────────────────────────────────

const HOURS_12: number[] = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES: number[] = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
const PERIODS: ("AM" | "PM")[] = ["AM", "PM"];

function parse24h(v: string): { h: number; m: number; period: "AM" | "PM" } {
  if (!v) return { h: 12, m: 0, period: "AM" };
  const [hStr, mStr] = v.split(":");
  const h24 = parseInt(hStr ?? "0", 10);
  const m = parseInt(mStr ?? "0", 10);
  const period: "AM" | "PM" = h24 >= 12 ? "PM" : "AM";
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return { h: h12, m: nearestMinute(m), period };
}

function nearestMinute(m: number): number {
  const rounded = Math.round(m / 5) * 5;
  return MINUTES.includes(rounded) ? rounded : MINUTES.reduce((prev, cur) =>
    Math.abs(cur - m) < Math.abs(prev - m) ? cur : prev
  );
}

function to24h(h12: number, m: number, period: "AM" | "PM"): string {
  let h = h12;
  if (period === "AM" && h12 === 12) h = 0;
  else if (period === "PM" && h12 !== 12) h = h12 + 12;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ─── ScrollColumn ───────────────────────────────────────────────────────────

const ITEM_H = 36; // px per row
const VISIBLE = 5; // number of visible rows
const CONTAINER_H = ITEM_H * VISIBLE; // 180px
const PAD = Math.floor(VISIBLE / 2) * ITEM_H; // top+bottom padding so first/last can center

interface ColumnProps<T> {
  items: T[];
  selected: T;
  onSelect: (v: T) => void;
  fmt: (v: T) => string;
}

function ScrollColumn<T>({ items, selected, onSelect, fmt }: ColumnProps<T>) {
  const listRef = React.useRef<HTMLDivElement>(null);
  const selectedIdx = items.indexOf(selected);

  // Scroll to the selected item on mount and when selection changes
  React.useLayoutEffect(() => {
    if (listRef.current && selectedIdx !== -1) {
      listRef.current.scrollTop = selectedIdx * ITEM_H;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIdx]);

  return (
    <div className="relative flex-1" style={{ width: 56 }}>
      {/* Center highlight bar */}
      <div
        className="pointer-events-none absolute inset-x-1 z-0 rounded-md bg-primary/10"
        style={{ top: PAD, height: ITEM_H }}
      />
      {/* Scrollable list */}
      <div
        ref={listRef}
        className="overflow-y-auto overscroll-contain"
        style={{
          height: CONTAINER_H,
          scrollbarWidth: "none",
          msOverflowStyle: "none",
        } as React.CSSProperties}
      >
        {/* top padding */}
        <div style={{ height: PAD }} />
        {items.map((item, i) => {
          const isSel = i === selectedIdx;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelect(item)}
              className={cn(
                "relative z-10 w-full flex items-center justify-center text-sm font-medium transition-colors",
                isSel
                  ? "text-primary font-bold"
                  : "text-muted-foreground hover:text-foreground",
              )}
              style={{ height: ITEM_H }}
            >
              {fmt(item)}
            </button>
          );
        })}
        {/* bottom padding */}
        <div style={{ height: PAD }} />
      </div>
    </div>
  );
}

// ─── Public component ───────────────────────────────────────────────────────

export interface ScrollTimePickerProps {
  /** "HH:mm" in 24-hour format */
  value: string;
  onChange: (v: string) => void;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
}

export function ScrollTimePicker({
  value,
  onChange,
  className,
  disabled,
  placeholder,
  id,
}: ScrollTimePickerProps) {
  const [open, setOpen] = React.useState(false);
  const { h, m, period } = parse24h(value);

  const handleH = (newH: number) => onChange(to24h(newH, m, period));
  const handleM = (newM: number) => onChange(to24h(h, newM, period));
  const handleP = (newP: "AM" | "PM") => onChange(to24h(h, m, newP));

  const display = value
    ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} ${period}`
    : "";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start text-left font-normal h-10",
            !display && "text-muted-foreground",
            className,
          )}
        >
          {display || placeholder || "選擇時間"}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-auto p-0 overflow-hidden" align="start" sideOffset={4}>
        <div className="flex items-stretch">
          {/* Hour */}
          <ScrollColumn
            items={HOURS_12}
            selected={h}
            onSelect={handleH}
            fmt={(v) => String(v).padStart(2, "0")}
          />

          {/* Colon */}
          <div className="flex items-center justify-center px-0.5 text-muted-foreground font-bold text-sm select-none">
            :
          </div>

          {/* Minute */}
          <ScrollColumn
            items={MINUTES}
            selected={m}
            onSelect={handleM}
            fmt={(v) => String(v).padStart(2, "0")}
          />

          {/* AM / PM */}
          <div className="flex flex-col items-center justify-center gap-2 border-l px-3">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => handleP(p)}
                className={cn(
                  "w-12 py-1.5 rounded-md text-xs font-bold transition-colors",
                  period === p
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Footer: confirmed value */}
        <div className="border-t flex items-center justify-center px-4 py-1.5 text-sm font-semibold text-primary bg-muted/30">
          {display || "—"}
        </div>
      </PopoverContent>
    </Popover>
  );
}
