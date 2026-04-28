import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { z } from "zod";

export interface KnowledgeTag {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

const tagSchema = z.object({
  name: z.string().trim().min(1, "標籤名稱不可為空").max(30, "名稱最多 30 字"),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9A-Fa-f]{6}$/, "顏色須為 #RRGGBB 格式")
    .optional()
    .default("#3B82F6"),
});

const TAGS_CHANGED_EVENT = "knowledge-tags-changed";
const notifyTagsChanged = () => {
  window.dispatchEvent(new Event(TAGS_CHANGED_EVENT));
};

export function useKnowledgeTags() {
  const { user } = useAuth();
  const [tags, setTags] = useState<KnowledgeTag[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    const { data, error } = await supabase
      .from("knowledge_tags")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (error) {
      console.error("Failed to fetch tags:", error);
      toast.error("載入標籤失敗");
    } else {
      setTags((data ?? []) as KnowledgeTag[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetch();
    const handler = () => { fetch(); };
    window.addEventListener(TAGS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(TAGS_CHANGED_EVENT, handler);
  }, [fetch]);

  const addTag = useCallback(
    async (input: { name: string; color?: string }) => {
      if (!user) return false;
      const parsed = tagSchema.safeParse(input);
      if (!parsed.success) {
        toast.error(parsed.error.errors[0].message);
        return false;
      }
      // Append at end
      const nextOrder = tags.length > 0 ? Math.max(...tags.map((t) => t.sort_order)) + 1 : 0;
      const { error } = await supabase
        .from("knowledge_tags")
        .insert([{ name: parsed.data.name, color: parsed.data.color, sort_order: nextOrder, created_by: user.id }]);
      if (error) {
        if (error.code === "23505") toast.error("標籤名稱已存在");
        else toast.error("新增失敗");
        return false;
      }
      toast.success("標籤已新增");
      await fetch();
      notifyTagsChanged();
      return true;
    },
    [user, fetch, tags]
  );

  const updateTag = useCallback(
    async (id: string, input: { name: string; color?: string }) => {
      const parsed = tagSchema.safeParse(input);
      if (!parsed.success) {
        toast.error(parsed.error.errors[0].message);
        return false;
      }
      const { error } = await supabase.from("knowledge_tags").update(parsed.data).eq("id", id);
      if (error) {
        if (error.code === "23505") toast.error("標籤名稱已存在");
        else toast.error("更新失敗");
        return false;
      }
      toast.success("標籤已更新");
      await fetch();
      notifyTagsChanged();
      return true;
    },
    [fetch]
  );

  const deleteTag = useCallback(async (id: string) => {
    const { error } = await supabase.from("knowledge_tags").delete().eq("id", id);
    if (error) {
      console.error("Delete tag error:", error);
      toast.error("刪除失敗");
      return false;
    }
    toast.success("標籤已刪除");
    setTags((prev) => prev.filter((t) => t.id !== id));
    notifyTagsChanged();
    return true;
  }, []);

  const reorderTags = useCallback(
    async (orderedIds: string[]) => {
      const idSet = new Set(orderedIds);
      setTags((prev) =>
        prev.map((t) => {
          if (!idSet.has(t.id)) return t;
          const newOrder = orderedIds.indexOf(t.id);
          return newOrder >= 0 ? { ...t, sort_order: newOrder } : t;
        }).sort((a, b) => a.sort_order - b.sort_order)
      );

      const updates = orderedIds.map((id, idx) =>
        supabase.from("knowledge_tags").update({ sort_order: idx }).eq("id", id)
      );
      const results = await Promise.all(updates);
      const failed = results.find((r) => r.error);
      if (failed?.error) {
        console.error("Reorder tags failed:", failed.error);
        toast.error("排序儲存失敗");
        await fetch();
        return false;
      }
      await fetch();
      notifyTagsChanged();
      return true;
    },
    [fetch]
  );

  return { tags, loading, addTag, updateTag, deleteTag, reorderTags, refetch: fetch };
}
