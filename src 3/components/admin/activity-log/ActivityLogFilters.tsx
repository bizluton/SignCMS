import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, CalendarIcon, X } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { localizeAction, localizeCategory } from "@/lib/activityLogI18n";

interface Props {
  search: string;
  onSearchChange: (v: string) => void;
  categoryFilter: string;
  onCategoryChange: (v: string) => void;
  actionFilter: string;
  onActionChange: (v: string) => void;
  categories: string[];
  actions: string[];
  dateFrom: Date | undefined;
  dateTo: Date | undefined;
  onDateFromChange: (d: Date | undefined) => void;
  onDateToChange: (d: Date | undefined) => void;
  onClearDates: () => void;
}

export default function ActivityLogFilters({
  search,
  onSearchChange,
  categoryFilter,
  onCategoryChange,
  actionFilter,
  onActionChange,
  categories,
  actions,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onClearDates,
}: Props) {
  const { t, language } = useLanguage();

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={t("activityLogSearchPlaceholder")}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">{t("activityLogFilterCategory")}</span>
            <Select value={categoryFilter} onValueChange={onCategoryChange}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("activityLogFilterAll")}</SelectItem>
                {categories.map(c => (
                  <SelectItem key={c} value={c}>{localizeCategory(c, language)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">{t("activityLogFilterAction")}</span>
            <Select value={actionFilter} onValueChange={onActionChange}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("activityLogFilterAll")}</SelectItem>
                {actions.map(a => (
                  <SelectItem key={a} value={a}>{localizeAction(a, language)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground whitespace-nowrap">{t("activityLogFilterDateFrom")}</span>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn("w-[160px] justify-start text-left font-normal", !dateFrom && "text-muted-foreground")}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateFrom ? format(dateFrom, "yyyy-MM-dd") : <span>{t("activityLogPickDate")}</span>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={dateFrom}
                onSelect={onDateFromChange}
                disabled={(d) => (dateTo ? d > dateTo : false) || d > new Date()}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>

          <span className="text-xs text-muted-foreground whitespace-nowrap">{t("activityLogFilterDateTo")}</span>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn("w-[160px] justify-start text-left font-normal", !dateTo && "text-muted-foreground")}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateTo ? format(dateTo, "yyyy-MM-dd") : <span>{t("activityLogPickDate")}</span>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={dateTo}
                onSelect={onDateToChange}
                disabled={(d) => (dateFrom ? d < dateFrom : false) || d > new Date()}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>

          {(dateFrom || dateTo) && (
            <Button variant="ghost" size="sm" onClick={onClearDates}>
              <X className="w-3 h-3 mr-1" />
              {t("activityLogClearDates")}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
