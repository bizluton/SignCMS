import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useIsSystemAdmin } from "@/hooks/useIsSystemAdmin";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2, ShieldCheck, Crown, Search, X, UserCheck } from "lucide-react";

interface UserSearchResult {
  user_id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface AdminRow {
  user_id: string;
  is_root: boolean;
  note: string;
  added_by: string | null;
  created_at: string;
  display_name: string | null;
  avatar_url: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function SystemAdminManagement() {
  const { user } = useAuth();
  const { isSystemAdmin } = useIsSystemAdmin();
  const { t } = useLanguage();
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [removeTarget, setRemoveTarget] = useState<AdminRow | null>(null);

  // User picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<UserSearchResult | null>(null);
  const debounceRef = useRef<number | null>(null);

  const existingIds = useMemo(() => new Set(admins.map((a) => a.user_id)), [admins]);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("list_system_admins");
    if (error) {
      toast({ title: t("error"), description: error.message, variant: "destructive" });
    } else {
      setAdmins((data as AdminRow[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => { if (isSystemAdmin) load(); }, [isSystemAdmin]);

  // Debounced search
  useEffect(() => {
    if (!pickerOpen) return;
    const term = searchTerm.trim();
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (term.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = window.setTimeout(async () => {
      const { data, error } = await (supabase.rpc as any)("search_users_for_admin", { _query: term });
      if (!error) setSearchResults((data as UserSearchResult[]) || []);
      setSearching(false);
    }, 300);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
  }, [searchTerm, pickerOpen]);

  const handleAdd = async () => {
    if (!selected) {
      toast({ title: t("sysAdminPickUserFirst"), variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const { data, error } = await supabase.rpc("add_system_admin", { _user_id: selected.user_id, _note: newNote.trim() });
    setSubmitting(false);
    const result = data as { success: boolean; error?: string } | null;
    if (error || !result?.success) {
      toast({ title: t("sysAdminAddFailed"), description: result?.error || error?.message, variant: "destructive" });
      return;
    }
    toast({ title: t("sysAdminAdded") });
    setSelected(null); setNewNote(""); setSearchTerm(""); setSearchResults([]);
    load();
  };

  const handleRemove = async () => {
    if (!removeTarget) return;
    setSubmitting(true);
    const { data, error } = await supabase.rpc("remove_system_admin", { _user_id: removeTarget.user_id });
    setSubmitting(false);
    const result = data as { success: boolean; error?: string } | null;
    if (error || !result?.success) {
      toast({ title: t("sysAdminRemoveFailed"), description: result?.error || error?.message, variant: "destructive" });
    } else {
      toast({ title: t("sysAdminRemoved") });
      load();
    }
    setRemoveTarget(null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          {t("sysAdminMgmtTitle")}
        </CardTitle>
        <CardDescription>{t("sysAdminMgmtDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Add form with user picker */}
        <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
          <div className="text-sm font-medium">{t("sysAdminAddNew")}</div>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" className="justify-start font-normal" disabled={submitting}>
                  {selected ? (
                    <span className="flex items-center gap-2 min-w-0 w-full">
                      <Avatar className="h-5 w-5">
                        {selected.avatar_url && <AvatarImage src={selected.avatar_url} />}
                        <AvatarFallback className="text-[10px]">
                          {(selected.display_name || selected.email).slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="truncate">{selected.display_name || selected.email}</span>
                      <X
                        className="h-3.5 w-3.5 ml-auto text-muted-foreground hover:text-foreground"
                        onClick={(e) => { e.stopPropagation(); setSelected(null); }}
                      />
                    </span>
                  ) : (
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <Search className="h-4 w-4" /> {t("sysAdminSearchUserPlaceholder")}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0 w-[320px]" align="start">
                <div className="p-2 border-b">
                  <Input
                    autoFocus
                    placeholder={t("sysAdminSearchHint")}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {searching ? (
                    <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                  ) : searchTerm.trim().length < 2 ? (
                    <div className="py-6 text-center text-xs text-muted-foreground">{t("sysAdminSearchMinChars")}</div>
                  ) : searchResults.length === 0 ? (
                    <div className="py-6 text-center text-xs text-muted-foreground">{t("sysAdminNoResults")}</div>
                  ) : (
                    searchResults.map((u) => {
                      const already = existingIds.has(u.user_id);
                      return (
                        <button
                          key={u.user_id}
                          type="button"
                          disabled={already}
                          onClick={() => { setSelected(u); setPickerOpen(false); }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          <Avatar className="h-7 w-7">
                            {u.avatar_url && <AvatarImage src={u.avatar_url} />}
                            <AvatarFallback className="text-[10px]">
                              {(u.display_name || u.email).slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm truncate">{u.display_name || t("sysAdminUnnamed")}</div>
                            <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                          </div>
                          {already && <UserCheck className="h-3.5 w-3.5 text-muted-foreground" />}
                        </button>
                      );
                    })
                  )}
                </div>
              </PopoverContent>
            </Popover>
            <Input
              placeholder={t("sysAdminNotePlaceholder")}
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              maxLength={200}
              disabled={submitting}
            />
            <Button onClick={handleAdd} disabled={submitting || !selected}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
              {t("add")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("sysAdminSearchHint")}</p>
        </div>

        {/* List */}
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-2">
            {admins.map((a) => {
              const isSelf = a.user_id === user?.id;
              const canRemove = !a.is_root && !isSelf;
              return (
                <div key={a.user_id} className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/30 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar className="h-9 w-9">
                      {a.avatar_url && <AvatarImage src={a.avatar_url} />}
                      <AvatarFallback>{(a.display_name || "?").slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium truncate">{a.display_name || t("sysAdminUnnamed")}</span>
                        {a.is_root && (
                          <Badge variant="default" className="gap-1 text-[10px]">
                            <Crown className="h-3 w-3" />{t("sysAdminRoot")}
                          </Badge>
                        )}
                        {isSelf && <Badge variant="secondary" className="text-[10px]">{t("sysAdminSelf")}</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono truncate">{a.user_id}</div>
                      {a.note && <div className="text-xs text-muted-foreground mt-0.5 truncate">{a.note}</div>}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setRemoveTarget(a)}
                    disabled={!canRemove}
                    title={a.is_root ? t("sysAdminCannotRemoveRoot") : isSelf ? t("sysAdminCannotRemoveSelf") : t("delete")}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <AlertDialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("sysAdminRemoveConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("sysAdminRemoveConfirmDesc")} <span className="font-medium">{removeTarget?.display_name || removeTarget?.user_id}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
