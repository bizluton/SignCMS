import * as React from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * Combined date + time picker.
 * - Calendar disables days before today (when `disablePast` is true).
 * - Time Input enforces `min` on the selected day if it is today.
 * Value format: "YYYY-MM-DDTHH:mm" (same as <input type="datetime-local">).
 */
export interface DateTimePickerProps {
  value: string;
  onChange: (next: string) => void;
  disablePast?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
  /**
   * IANA timezone name (e.g. "Asia/Taipei"). When provided, "now"/"today"
   * used by `disablePast` and the default time are calculated as wall-clock
   * values in this timezone instead of the browser's local zone.
   */
  tz?: string;
}

function pad(n: number) { return String(n).padStart(2, "0"); }

function parseValue(v: string): { date: Date | undefined; time: string } {
  if (!v) return { date: undefined, time: "" };
  const [d, t] = v.split("T");
  const [y, m, day] = (d || "").split("-").map(Number);
  const date = y && m && day ? new Date(y, m - 1, day) : undefined;
  return { date, time: (t || "").slice(0, 5) };
}

function combine(date: Date | undefined, time: string): string {
  if (!date) return "";
  const t = time && /^\d{2}:\d{2}$/.test(time) ? time : "00:00";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${t}`;
}

/**
 * Wall-clock {y,m,d,h,min} for `now` in the given IANA timezone.
 * Falls back to the browser's local time when `tz` is undefined or invalid.
 */
function nowInTz(tz?: string): { y: number; m: number; d: number; h: number; min: number } {
  const now = new Date();
  if (!tz) {
    return {
      y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate(),
      h: now.getHours(), min: now.getMinutes(),
    };
  }
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(now);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || "0");
    let h = get("hour");
    if (h === 24) h = 0; // some runtimes return 24 for midnight
    return { y: get("year"), m: get("month"), d: get("day"), h, min: get("minute") };
  } catch {
    return {
      y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate(),
      h: now.getHours(), min: now.getMinutes(),
    };
  }
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

export function DateTimePicker({
  value,
  onChange,
  disablePast = false,
  placeholder,
  className,
  id,
  tz,
}: DateTimePickerProps) {
  const { date, time } = parseValue(value);
  const tzNow = nowInTz(tz);
  // Build a Date representing "today" in the target tz, expressed as the same
  // wall-clock components in the local zone — so calendar comparisons
  // (`isSameDay`, `d < today`) work against the user-selected day.
  const today = new Date(tzNow.y, tzNow.m - 1, tzNow.d);
  const todayMinTime = `${pad(tzNow.h)}:${pad(tzNow.min)}`;
  const isToday = date ? isSameDay(date, today) : false;
  const minTime = disablePast && isToday ? todayMinTime : undefined;

  const handleSelectDate = (d: Date | undefined) => {
    if (!d) return;
    let nextTime = time || `${pad(tzNow.h)}:${pad(tzNow.min)}`;
    // If past time was chosen earlier and the date is today, snap forward to now.
    if (disablePast && isSameDay(d, today) && nextTime < todayMinTime) {
      nextTime = todayMinTime;
    }
    onChange(combine(d, nextTime));
  };

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    const base = date ?? today;
    onChange(combine(base, next));
  };

  return (
    <div className={cn("flex gap-2", className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            className={cn(
              "flex-1 justify-start text-left font-normal h-10",
              !date && "text-muted-foreground",
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {date ? format(date, "yyyy-MM-dd") : <span>{placeholder ?? "Pick a date"}</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            defaultMonth={date ?? today}
            onSelect={handleSelectDate}
            disabled={disablePast ? (d) => d < today : undefined}
            initialFocus
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>
      <Input
        type="time"
        value={time}
        min={minTime}
        onChange={handleTimeChange}
        className="w-[120px]"
      />
    </div>
  );
}