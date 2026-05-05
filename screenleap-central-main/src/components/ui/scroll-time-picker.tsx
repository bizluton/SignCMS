import * as React from "react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ChevronUp, ChevronDown } from "lucide-react";

// ─── helpers ────────────────────────────────────────────────────────────────

const HOURS_12: number[] = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES: number[] = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
const PERIODS: ("AM" | "PM")[] = ["AM", "PM"];

function parse24h(v: string): { h: number; m: number; period: "AM" | "PM" } {
  if (!v) return { h: 12, m: 0, period: "AM" };
  const [hStr, mStr] = v.split(":");
  const h24 = parseInt(hStr ?? "0", 10);
  const rawM = parseInt(mStr ?? "0", 10);
  const period: "AM" | "PM" = h24 >= 12 ? "PM" : "AM";
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return { h: h12, m: nearestMinute(rawM), period };
}

function nearestMinute(m: number): number {
  const rounded = Math.round(m / 5) * 5;
  return MINUTES.includes(rounded)
    ? rounded
    : MINUTES.reduce((prev, cur) =>
        Math.abs(cur - m) < Math.abs(prev - m) ? cur : prev
      );
}

function to24h(h12: number, m: number, period: "AM" | "PM"): string {
  let h = h12;
  if (period === "AM" && h12 === 12) h = 0;
  else if (period === "PM" && h12 !== 12) h = h12 + 12;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ─── DrumColumn ─────────────────────────────────────────────────────────────
// Renders 5 visible rows at all times; the center row is the selected value.
// Mouse wheel, arrow buttons, and clicking adjacent rows all change the value.
// Items wrap around circularly.

const ITEM_H = 38; // px per row
const VISIBLE = 5; // must be odd
const CENTER = Math.floor(VISIBLE / 2); // = 2

interface ColumnProps<T> {
  items: T[];
  selected: T;
  onSelect: (v: T) => void;
  fmt: (v: T) => string;
  width?: number;
}

function DrumColumn<T>({ items, selected, onSelect, fmt, width = 52 }: ColumnProps<T>) {
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Keep a stable ref to latest state to avoid stale closures in the wheel handler
  const stateRef = React.useRef({ items, selected, onSelect });
  stateRef.current = { items, selected, onSelect };

  // Register wheel listener with { passive: false } so we can preventDefault
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let lastTs = 0;
    const THROTTLE_MS = 80; // max one step per 80 ms

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const now = Date.now();
      if (now - lastTs < THROTTLE_MS) return;
      lastTs = now;

      const { items: its, selected: sel, onSelect: os } = stateRef.current;
      const idx = its.indexOf(sel);
      const dir = e.deltaY > 0 ? 1 : -1;
      const next = ((idx + dir) % its.length + its.length) % its.length;
      os(its[next]);
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  // Step helpers
  const step = (dir: 1 | -1) => {
    const idx = items.indexOf(selected);
    const next = ((idx + dir) % items.length + items.length) % items.length;
    onSelect(items[next]);
  };

  const selectedIdx = items.indexOf(selected);

  // Build the 5 visible items (circular)
  const visibles = Array.from({ length: VISIBLE }, (_, i) => {
    const offset = i - CENTER; // -2 … +2
    const idx = ((selectedIdx + offset) % items.length + items.length) % items.length;
    return { item: items[idx], offset };
  });

  // Opacity / scale by distance from center
  const styleFor = (offset: number) => {
    const d = Math.abs(offset);
    return {
      opacity: d === 0 ? 1 : d === 1 ? 0.45 : 0.18,
      fontSize: d === 0 ? "0.9rem" : "0.8rem",
    };
  };

  return (
    <div className="flex flex-col items-center" style={{ width }}>
      {/* Up chevron */}
      <button
        type="button"
        tabIndex={-1}
        onClick={() => step(-1)}
        className="h-6 w-full flex items-center justify-center text-muted-foreground hover:text-primary transition-colors"
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>

      {/* Drum barrel */}
      <div
        ref={containerRef}
        className="relative select-none cursor-ns-resize overflow-hidden"
        style={{ width, height: ITEM_H * VISIBLE }}
        title="Scroll to change"
      >
        {/* Center highlight band */}
        <div
          className="pointer-events-none absolute inset-x-1 rounded-md bg-primary/10 z-0"
          style={{ top: CENTER * ITEM_H, height: ITEM_H }}
        />
        {/* Top fade */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-10"
          style={{
            height: CENTER * ITEM_H,
            background: "linear-gradient(to bottom, var(--popover) 0%, transparent 100%)",
          }}
        />
        {/* Bottom fade */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10"
          style={{
            height: CENTER * ITEM_H,
            background: "linear-gradient(to top, var(--popover) 0%, transparent 100%)",
          }}
        />

        {/* Rows */}
        {visibles.map(({ item, offset }) => {
          const isCenter = offset === 0;
          const s = styleFor(offset);
          return (
            <button
              key={offset}
              type="button"
              onClick={() => !isCenter && onSelect(item)}
              className={cn(
                "absolute inset-x-0 z-20 flex items-center justify-center font-medium transition-all duration-150",
                isCenter
                  ? "text-primary font-bold"
                  : "text-foreground hover:text-primary",
              )}
              style={{
                top: (CENTER + offset) * ITEM_H,
                height: ITEM_H,
                opacity: s.opacity,
                fontSize: s.fontSize,
                cursor: isCenter ? "default" : "pointer",
              }}
            >
              {fmt(item)}
            </button>
          );
        })}
      </div>

      {/* Down chevron */}
      <button
        type="button"
        tabIndex={-1}
        onClick={() => step(1)}
        className="h-6 w-full flex items-center justify-center text-muted-foreground hover:text-primary transition-colors"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─── Public component ────────────────────────────────────────────────────────

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

      <PopoverContent
        className="w-auto p-0 overflow-hidden"
        align="start"
        sideOffset={4}
      >
        {/* Column header row */}
        <div className="flex items-center justify-center gap-1 pt-2 pb-0 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground select-none">
          <span style={{ width: 52, textAlign: "center" }}>HR</span>
          <span className="w-4" />
          <span style={{ width: 52, textAlign: "center" }}>MIN</span>
          <span style={{ width: 56 }} />
        </div>

        <div className="flex items-center px-2 pb-2 pt-0 gap-1">
          {/* Hour drum */}
          <DrumColumn
            items={HOURS_12}
            selected={h}
            onSelect={handleH}
            fmt={(v) => String(v).padStart(2, "0")}
            width={52}
          />

          {/* Colon separator */}
          <div className="flex flex-col items-center justify-center self-stretch">
            <span
              className="text-muted-foreground font-bold text-base select-none"
              style={{ marginTop: (CENTER + 0.5) * ITEM_H + 6 - (VISIBLE * ITEM_H) / 2 }}
            >
              :
            </span>
          </div>

          {/* Minute drum */}
          <DrumColumn
            items={MINUTES}
            selected={m}
            onSelect={handleM}
            fmt={(v) => String(v).padStart(2, "0")}
            width={52}
          />

          {/* AM / PM toggle */}
          <div className="flex flex-col items-center justify-center gap-2 pl-2 border-l self-stretch">
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

        {/* Footer: selected time */}
        <div className="border-t flex items-center justify-center px-4 py-1.5 text-sm font-semibold text-primary bg-muted/30 select-none">
          {display || "—"}
        </div>
      </PopoverContent>
    </Popover>
  );
}
