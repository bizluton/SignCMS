import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, ChevronLeft } from "lucide-react";
import { format } from "date-fns";

export interface FlowDateTimePickerRef {
  open: () => void;
}

interface Props {
  value: string; // "YYYY-MM-DDTHH:mm" or ""
  onChange: (v: string) => void;
  /** Called after minute is confirmed — use to auto-open the next picker. */
  onDone?: () => void;
  disablePast?: boolean;
  placeholder?: string;
  className?: string;
}

function pad(n: number) { return String(n).padStart(2, "0"); }

function parseValue(v: string) {
  if (!v) return { date: undefined as Date | undefined, h: null as number | null, m: null as number | null };
  const [d, t] = v.split("T");
  const [y, mo, day] = (d ?? "").split("-").map(Number);
  const date = y && mo && day ? new Date(y, mo - 1, day) : undefined;
  if (!t) return { date, h: null, m: null };
  const [hh, mm] = t.split(":").map(Number);
  return { date, h: hh ?? null, m: mm ?? null };
}

function combine(date: Date, h: number, m: number) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(h)}:${pad(m)}`;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

export const FlowDateTimePicker = forwardRef<FlowDateTimePickerRef, Props>(
  function FlowDateTimePicker({ value, onChange, onDone, disablePast = false, placeholder, className }, ref) {
    const [open, setOpen] = useState(false);
    const [phase, setPhase] = useState<"date" | "hour" | "minute">("date");
    const [pendingDate, setPendingDate] = useState<Date | undefined>(undefined);
    const [pendingHour, setPendingHour] = useState<number | null>(null);

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const { date, h, m } = parseValue(value);

    const resetToValue = () => {
      const { date: d, h: hour } = parseValue(value);
      setPendingDate(d);
      setPendingHour(hour);
      setPhase("date");
    };

    useImperativeHandle(ref, () => ({
      open: () => { resetToValue(); setOpen(true); },
    }));

    useEffect(() => { if (open) resetToValue(); }, [open]);

    const handleDateSelect = (d: Date | undefined) => {
      if (!d) return;
      setPendingDate(d);
      setPhase("hour");
    };

    const handleHourSelect = (hour: number) => {
      setPendingHour(hour);
      setPhase("minute");
    };

    const handleMinuteSelect = (minute: number) => {
      if (!pendingDate || pendingHour === null) return;
      onChange(combine(pendingDate, pendingHour, minute));
      setOpen(false);
      onDone?.();
    };

    const label = date && h !== null && m !== null
      ? `${format(date, "yyyy-MM-dd")}  ${pad(h)}:${pad(m)}`
      : date ? `${format(date, "yyyy-MM-dd")}` : null;

    return (
      <Popover open={open} onOpenChange={(o) => { setOpen(o); }}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline"
            className={cn("w-full justify-start text-left font-normal h-10", !label && "text-muted-foreground", className)}>
            <CalendarIcon className="mr-2 h-4 w-4 flex-shrink-0" />
            {label ?? <span>{placeholder ?? "選擇日期時間"}</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">

          {/* Phase 1 — Date */}
          {phase === "date" && (
            <Calendar
              mode="single"
              selected={pendingDate}
              defaultMonth={pendingDate ?? today}
              onSelect={handleDateSelect}
              disabled={disablePast ? (d) => d < today : undefined}
              initialFocus
              className="p-3 pointer-events-auto"
            />
          )}

          {/* Phase 2 — Hour (0-23) */}
          {phase === "hour" && (
            <div className="p-3" style={{ width: 264 }}>
              <div className="flex items-center gap-2 mb-3">
                <button type="button" onClick={() => setPhase("date")}
                  className="text-muted-foreground hover:text-foreground transition-colors">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm font-medium text-muted-foreground">
                  {pendingDate ? format(pendingDate, "yyyy-MM-dd") : ""} · 選擇小時
                </span>
              </div>
              <div className="grid grid-cols-6 gap-1">
                {HOURS.map((hr) => (
                  <button key={hr} type="button" onClick={() => handleHourSelect(hr)}
                    className={cn(
                      "rounded-md py-2 text-sm tabular-nums font-medium transition-colors",
                      "hover:bg-primary hover:text-primary-foreground",
                      pendingHour === hr ? "bg-primary text-primary-foreground" : "bg-muted/50 text-foreground",
                    )}>
                    {pad(hr)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Phase 3 — Minute (0,5,...,55) */}
          {phase === "minute" && (
            <div className="p-3" style={{ width: 264 }}>
              <div className="flex items-center gap-2 mb-3">
                <button type="button" onClick={() => setPhase("hour")}
                  className="text-muted-foreground hover:text-foreground transition-colors">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm font-medium text-muted-foreground">
                  {pendingDate ? format(pendingDate, "yyyy-MM-dd") : ""} {pendingHour !== null ? pad(pendingHour) : ""}:__ · 選擇分鐘
                </span>
              </div>
              <div className="grid grid-cols-6 gap-1">
                {MINUTES.map((mn) => (
                  <button key={mn} type="button" onClick={() => handleMinuteSelect(mn)}
                    className={cn(
                      "rounded-md py-2 text-sm tabular-nums font-medium transition-colors",
                      "hover:bg-primary hover:text-primary-foreground",
                      h === pendingHour && m === mn ? "bg-primary text-primary-foreground" : "bg-muted/50 text-foreground",
                    )}>
                    {pad(mn)}
                  </button>
                ))}
              </div>
            </div>
          )}

        </PopoverContent>
      </Popover>
    );
  }
);
