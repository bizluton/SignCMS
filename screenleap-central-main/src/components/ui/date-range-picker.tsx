import * as React from "react";
import type { DateRange } from "react-day-picker";
import { format } from "date-fns";
import { CalendarIcon, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface DateRangePickerProps {
  /** Start of the selected range */
  from: Date | undefined;
  /** End of the selected range */
  to: Date | undefined;
  onChange: (range: DateRange) => void;
  /** react-day-picker disabled matcher — e.g. `(d) => d < today` */
  disabled?: (date: Date) => boolean;
  placeholder?: string;
  /** Show an × button to clear the range */
  clearable?: boolean;
  className?: string;
  id?: string;
}

export function DateRangePicker({
  from,
  to,
  onChange,
  disabled,
  placeholder,
  clearable = false,
  className,
  id,
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);

  const label = from
    ? to
      ? `${format(from, "yyyy-MM-dd")}  ~  ${format(to, "yyyy-MM-dd")}`
      : format(from, "yyyy-MM-dd")
    : null;

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            className={cn(
              "flex-1 justify-start text-left font-normal h-10",
              !label && "text-muted-foreground",
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
            {label ?? <span>{placeholder ?? "選擇日期範圍"}</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            selected={{ from, to }}
            onSelect={(range) => {
              onChange(range ?? { from: undefined, to: undefined });
            }}
            disabled={disabled}
            numberOfMonths={1}
            initialFocus
            className="p-3 pointer-events-auto"
          />
        </PopoverContent>
      </Popover>

      {clearable && (from || to) && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0"
          onClick={() => onChange({ from: undefined, to: undefined })}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
