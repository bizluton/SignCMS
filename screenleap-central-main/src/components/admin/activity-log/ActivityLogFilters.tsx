import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search } from "lucide-react";
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
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {t("activityLogFilterDateFrom")} ~ {t("activityLogFilterDateTo")}
          </span>
          <DateRangePicker
            from={dateFrom}
            to={dateTo}
            onChange={({ from, to }) => {
              onDateFromChange(from);
              onDateToChange(to);
            }}
            disabled={(d) => d > new Date()}
            placeholder={t("activityLogPickDate")}
            clearable
            className="w-[300px]"
          />
        </div>
      </CardContent>
    </Card>
  );
}
