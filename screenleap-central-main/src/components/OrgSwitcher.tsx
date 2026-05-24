import { useState, useEffect, useMemo } from "react";
import { Building2, Search, ChevronDown, Monitor, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Org {
  id: string;
  name: string;
  description: string | null;
  deviceCount?: number;
  memberCount?: number;
}

const labels = {
  zh: {
    allOrgs: "全部組織",
    searchOrg: "搜尋組織名稱...",
    switchOrg: "切換組織",
    noResult: "沒有符合的組織",
    currentOrg: "目前檢視",
    clearFilter: "清除篩選",
  },
  en: {
    allOrgs: "All Organizations",
    searchOrg: "Search organization...",
    switchOrg: "Switch Org",
    noResult: "No matching organization",
    currentOrg: "Current view",
    clearFilter: "Clear filter",
  },
  ja: {
    allOrgs: "全組織",
    searchOrg: "組織を検索...",
    switchOrg: "組織切替",
    noResult: "該当する組織がありません",
    currentOrg: "現在の表示",
    clearFilter: "フィルター解除",
  },
} as const;

export function OrgSwitcher({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (orgId: string | null) => void;
}) {
  const { isAdmin, isOrgAdmin, isCsAgent, loading: roleLoading } = useUserRole();
  const { language } = useLanguage();
  const t = labels[language] || labels.en;

  const [orgs, setOrgs] = useState<Org[]>([]);
  // Track whether the org list has finished its first fetch. Without this we
  // can't distinguish "still loading" from "user truly has zero orgs", which
  // caused the active org to be wiped on every page navigation.
  const [orgsLoaded, setOrgsLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Admin/CS can see all orgs; org_admin sees only their own
  const canSwitch = isAdmin || isCsAgent || isOrgAdmin;

  useEffect(() => {
    if (!canSwitch || roleLoading) return;
    let cancelled = false;
    const load = async () => {
      // Step 1: load only the org list + (if needed) the user's allowed org ids.
      // Avoid pulling full screens / team_members tables — those are O(n) and quickly become slow.
      const orgListPromise = supabase.from("organizations").select("id, name, description").order("name");
      type MemberWithTeam = { teams: { org_id: string } | null };
      const allowedPromise: Promise<{ data: MemberWithTeam[] | null }> = isOrgAdmin && !isAdmin && !isCsAgent
        ? supabase.auth.getUser().then(({ data }) =>
            supabase.from("team_members")
              .select("teams!inner(org_id)")
              .eq("user_id", data.user?.id ?? "")
          ) as Promise<{ data: MemberWithTeam[] | null }>
        : Promise.resolve({ data: null });

      const [{ data: orgData }, { data: currentUserMembers }] = await Promise.all([orgListPromise, allowedPromise]);
      if (cancelled) return;

      const allowedOrgIds = new Set<string>(
        (currentUserMembers || []).map((m) => m.teams?.org_id).filter((id): id is string => Boolean(id))
      );

      const visibleOrgs = (orgData || []).filter((o) => {
        if (isAdmin || isCsAgent) return true;
        if (isOrgAdmin) return allowedOrgIds.has(o.id);
        return false;
      });

      // Step 2: render org list immediately (counts come in next).
      setOrgs(visibleOrgs.map((o) => ({ ...o, deviceCount: 0, memberCount: 0 })) as Org[]);
      setOrgsLoaded(true);

      // Step 3: lazy-load per-org counts in parallel using head:true count:exact (no row payload).
      const counts = await Promise.all(
        visibleOrgs.map(async (o) => {
          const [screensRes, membersRes] = await Promise.all([
            supabase.from("screens").select("id", { count: "exact", head: true }).eq("org_id", o.id),
            supabase.from("team_members").select("teams!inner(org_id)", { count: "exact", head: true })
              .eq("teams.org_id", o.id),
          ]);
          return { id: o.id, devices: screensRes.count ?? 0, members: membersRes.count ?? 0 };
        })
      );
      if (cancelled) return;

      const countMap = new Map(counts.map((c) => [c.id, c]));
      setOrgs(
        visibleOrgs.map((o) => ({
          ...o,
          deviceCount: countMap.get(o.id)?.devices ?? 0,
          memberCount: countMap.get(o.id)?.members ?? 0,
        })) as Org[]
      );
    };
    load();
    return () => { cancelled = true; };
  }, [canSwitch, roleLoading, isAdmin, isCsAgent, isOrgAdmin]);

  // Auto-select first org if none selected, or recover from a stale/unauthorized
  // org id. CRITICAL: only run AFTER the org list has finished loading — otherwise
  // every page navigation re-mounts the switcher with `orgs = []` and would
  // wrongly clear the persisted active org before the fetch resolves.
  useEffect(() => {
    if (!orgsLoaded) return;
    if (orgs.length === 0) {
      if (value !== null) onChange(null);
      return;
    }
    const isCurrentValueAllowed = !!value && orgs.some((org) => org.id === value);
    if (!value || !isCurrentValueAllowed) {
      onChange(orgs[0].id);
    }
  }, [orgs, orgsLoaded, value, onChange]);

  const filtered = useMemo(() => {
    if (!search.trim()) return orgs;
    const q = search.toLowerCase();
    return orgs.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        (o.description && o.description.toLowerCase().includes(q))
    );
  }, [orgs, search]);

  const selectedOrg = orgs.find((o) => o.id === value);

  if (!canSwitch || roleLoading) return null;

  // org_admin with only 1 org: show static label, no dropdown
  const singleOrgOnly = isOrgAdmin && !isAdmin && !isCsAgent && orgs.length <= 1;

  if (singleOrgOnly) {
    return (
      <div className="flex items-center gap-1.5 h-8 px-2.5 text-xs font-medium text-muted-foreground max-w-[200px]">
        <Building2 className="w-3.5 h-3.5 shrink-0 text-primary" />
        <span className="truncate">{selectedOrg?.name || "..."}</span>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 h-8 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground max-w-[200px]"
        >
          <Building2 className="w-3.5 h-3.5 shrink-0 text-primary" />
          <span className="truncate">{selectedOrg?.name || "..."}</span>
          <ChevronDown className="w-3 h-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(288px,90vw)] p-0" sideOffset={8}>
        <div className="p-2 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder={t.searchOrg}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 text-xs"
              autoFocus
            />
          </div>
        </div>
        <ScrollArea className="max-h-64">
          <div className="p-1">

            {filtered.map((org) => (
              <button
                key={org.id}
                className={`w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-xs transition-colors hover:bg-accent ${
                  value === org.id
                    ? "bg-accent/60 text-accent-foreground font-medium"
                    : "text-foreground"
                }`}
                onClick={() => {
                  onChange(org.id);
                  setOpen(false);
                  setSearch("");
                }}
              >
                <Building2 className="w-3.5 h-3.5 shrink-0 text-primary/70" />
                <div className="flex flex-col items-start min-w-0 flex-1">
                  <span className="truncate w-full text-left">{org.name}</span>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-0.5"><Monitor className="w-3 h-3" />{org.deviceCount ?? 0}</span>
                    <span className="flex items-center gap-0.5"><Users className="w-3 h-3" />{org.memberCount ?? 0}</span>
                  </div>
                </div>
                {value === org.id && (
                  <Badge variant="secondary" className="ml-auto text-[9px] h-4 px-1.5 shrink-0">
                    {t.currentOrg}
                  </Badge>
                )}
              </button>
            ))}

            {filtered.length === 0 && (
              <div className="px-2.5 py-4 text-center text-xs text-muted-foreground">
                {t.noResult}
              </div>
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}