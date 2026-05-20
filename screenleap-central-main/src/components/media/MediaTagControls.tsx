import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tags, Plus, X, Check } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatUserError } from "@/lib/formatUserError";

export interface MediaTag {
  id: string;
  org_id: string;
  name: string;
  color: string;
}

/** Hook: load all tags for an org and the per-media tag map. */
export function useMediaTags(orgId: string | null | undefined, mediaIds: string[]) {
  const [tags, setTags] = useState<MediaTag[]>([]);
  const [itemTags, setItemTags] = useState<Map<string, string[]>>(new Map());
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!orgId) { setTags([]); return; }
    (async () => {
      const { data } = await supabase
        .from("media_tags").select("id, org_id, name, color")
        .eq("org_id", orgId).order("name");
      setTags((data || []) as MediaTag[]);
    })();
  }, [orgId, version]);

  useEffect(() => {
    if (mediaIds.length === 0) { setItemTags(new Map()); return; }
    (async () => {
      const { data } = await supabase
        .from("media_item_tags").select("media_id, tag_id").in("media_id", mediaIds);
      const m = new Map<string, string[]>();
      ((data || []) as { media_id: string; tag_id: string }[]).forEach((r) => {
        const arr = m.get(r.media_id) || [];
        arr.push(r.tag_id);
        m.set(r.media_id, arr);
      });
      setItemTags(m);
    })();
  }, [mediaIds.join(","), version]);

  return {
    tags,
    itemTags,
    refresh: () => setVersion((v) => v + 1),
  };
}

/** Toolbar chip filter: click to toggle (OR logic). */
export function MediaTagFilter({
  tags,
  selectedIds,
  onChange,
}: {
  tags: MediaTag[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useLanguage();
  if (tags.length === 0) return null;
  const toggle = (id: string) => {
    if (selectedIds.includes(id)) onChange(selectedIds.filter((x) => x !== id));
    else onChange([...selectedIds, id]);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
        <Tags className="h-3.5 w-3.5" /> {t("mediaTagFilter")}:
      </span>
      {tags.map((tag) => {
        const active = selectedIds.includes(tag.id);
        return (
          <button
            key={tag.id}
            type="button"
            onClick={() => toggle(tag.id)}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition ${
              active ? "border-transparent text-white" : "border-border bg-background text-foreground hover:bg-muted"
            }`}
            style={active ? { backgroundColor: tag.color } : undefined}
          >
            {active && <Check className="h-3 w-3" />}
            {tag.name}
          </button>
        );
      })}
      {selectedIds.length > 0 && (
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" onClick={() => onChange([])}>
          <X className="h-3 w-3" /> {t("cancel")}
        </Button>
      )}
    </div>
  );
}

/** Inline editor to add/remove/create tags on a media item (used inside preview dialog). */
export function MediaTagEditor({
  mediaId,
  orgId,
  allTags,
  selectedIds,
  canEdit,
  onChanged,
}: {
  mediaId: string;
  orgId: string | null | undefined;
  allTags: MediaTag[];
  selectedIds: string[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const selected = useMemo(
    () => allTags.filter((tg) => selectedIds.includes(tg.id)),
    [allTags, selectedIds],
  );

  const toggle = async (tagId: string) => {
    if (!canEdit) return;
    setBusy(true);
    if (selectedIds.includes(tagId)) {
      const { error } = await supabase
        .from("media_item_tags").delete().eq("media_id", mediaId).eq("tag_id", tagId);
      if (error) toast.error(formatUserError(error, t));
    } else {
      const { error } = await supabase
        .from("media_item_tags").insert({ media_id: mediaId, tag_id: tagId });
      if (error) toast.error(formatUserError(error, t));
    }
    onChanged();
    setBusy(false);
  };

  const createAndAdd = async () => {
    const name = newName.trim();
    if (!name || !orgId) return;
    setBusy(true);
    const { data, error } = await supabase
      .from("media_tags").insert({ org_id: orgId, name }).select("id").single();
    if (error) { toast.error(formatUserError(error, t)); setBusy(false); return; }
    await supabase.from("media_item_tags").insert({ media_id: mediaId, tag_id: data.id });
    setNewName("");
    onChanged();
    setBusy(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {selected.map((tg) => (
        <Badge key={tg.id} className="gap-1" style={{ backgroundColor: tg.color, color: "#fff" }}>
          {tg.name}
          {canEdit && (
            <button type="button" onClick={() => toggle(tg.id)} className="opacity-80 hover:opacity-100" disabled={busy}>
              <X className="h-3 w-3" />
            </button>
          )}
        </Badge>
      ))}
      {canEdit && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-6 gap-1 px-2 text-xs">
              <Plus className="h-3 w-3" /> {t("mediaTagAdd")}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 space-y-2 p-3">
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {allTags.length === 0 && (
                <p className="text-xs text-muted-foreground">{t("mediaTagEmpty")}</p>
              )}
              {allTags.map((tg) => {
                const checked = selectedIds.includes(tg.id);
                return (
                  <button
                    key={tg.id}
                    type="button"
                    onClick={() => toggle(tg.id)}
                    disabled={busy}
                    className="flex w-full items-center justify-between rounded px-2 py-1 text-sm hover:bg-muted"
                  >
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tg.color }} />
                      {tg.name}
                    </span>
                    {checked && <Check className="h-3.5 w-3.5 text-primary" />}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-1 border-t pt-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("mediaTagCreate")}
                className="h-7 text-xs"
                onKeyDown={(e) => { if (e.key === "Enter") createAndAdd(); }}
              />
              <Button size="sm" onClick={createAndAdd} disabled={!newName.trim() || busy}>
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
