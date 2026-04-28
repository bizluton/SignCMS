import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";
import { useUserOrgs } from "@/hooks/useUserOrgs";
import { toast } from "sonner";

export interface KnowledgeItem {
  id: string;
  title: string;
  description: string;
  category: string;
  sub_category: string;
  file_count: number;
  synced: boolean;
  org_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  tags?: { id: string; name: string; color: string }[];
}

export function useKnowledgeItems() {
  const { user } = useAuth();
  const { activeOrgId } = useActiveOrg();
  const { defaultOrgId } = useUserOrgs();
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchItems = useCallback(async () => {
    const { data, error } = await supabase
      .from("knowledge_items")
      .select("*, knowledge_item_tags(tag_id, knowledge_tags(id, name, color))")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Failed to fetch knowledge items:", error);
      toast.error("載入知識庫失敗");
    } else {
      const mapped = (data ?? []).map((row: any) => ({
        ...row,
        tags: (row.knowledge_item_tags ?? [])
          .map((rel: any) => rel.knowledge_tags)
          .filter(Boolean),
      })) as KnowledgeItem[];
      setItems(mapped);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (user) fetchItems();
    else setLoading(false);
  }, [user, fetchItems]);

  const addItem = useCallback(
    async (input: {
      title: string;
      description: string;
      category: string;
      subCategory: string;
      categoryId?: string | null;
      tagIds?: string[];
    }) => {
      if (!user) return;
      const orgId = activeOrgId || defaultOrgId;
      if (!orgId) {
        toast.error("請先選擇組織");
        return;
      }
      const { data: inserted, error } = await supabase
        .from("knowledge_items")
        .insert({
          title: input.title,
          description: input.description,
          category: input.category,
          sub_category: input.subCategory,
          category_id: input.categoryId ?? null,
          created_by: user.id,
          org_id: orgId,
        })
        .select("id")
        .single();
      if (error || !inserted) {
        console.error("Insert error:", error);
        toast.error("新增失敗");
        return;
      }
      // Attach selected tags (best-effort; row-level errors won't block success toast)
      const tagIds = input.tagIds ?? [];
      if (tagIds.length > 0) {
        const rows = tagIds.map((tag_id) => ({
          knowledge_item_id: inserted.id,
          tag_id,
          created_by: user.id,
        }));
        const { error: tagErr } = await supabase.from("knowledge_item_tags").insert(rows);
        if (tagErr) {
          console.error("Attach tags error:", tagErr);
          toast.warning("知識點已新增，但部分標籤關聯失敗");
        }
      }
      toast.success("知識點已新增");
      await fetchItems();
    },
    [user, activeOrgId, defaultOrgId, fetchItems]
  );

  const updateItem = useCallback(
    async (
      id: string,
      input: {
        title: string;
        description: string;
        category: string;
        subCategory: string;
        categoryId?: string | null;
        tagIds?: string[];
      }
    ) => {
      if (!user) return;
      const { error } = await supabase
        .from("knowledge_items")
        .update({
          title: input.title,
          description: input.description,
          category: input.category,
          sub_category: input.subCategory,
          category_id: input.categoryId ?? null,
          synced: false,
        })
        .eq("id", id);
      if (error) {
        console.error("Update error:", error);
        toast.error("更新失敗");
        return;
      }
      // Replace tag associations
      const { error: delErr } = await supabase
        .from("knowledge_item_tags")
        .delete()
        .eq("knowledge_item_id", id);
      if (delErr) console.error("Clear tags error:", delErr);
      const tagIds = input.tagIds ?? [];
      if (tagIds.length > 0) {
        const rows = tagIds.map((tag_id) => ({
          knowledge_item_id: id,
          tag_id,
          created_by: user.id,
        }));
        const { error: tagErr } = await supabase.from("knowledge_item_tags").insert(rows);
        if (tagErr) {
          console.error("Reattach tags error:", tagErr);
          toast.warning("知識點已更新，但部分標籤關聯失敗");
        }
      }
      toast.success("知識點已更新");
      await fetchItems();
    },
    [user, fetchItems]
  );

  const deleteItem = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("knowledge_items").delete().eq("id", id);
      if (error) {
        console.error("Delete error:", error);
        toast.error("刪除失敗");
      } else {
        toast.success("知識點已刪除");
        setItems((prev) => prev.filter((i) => i.id !== id));
      }
    },
    []
  );

  const syncAll = useCallback(async () => {
    const unsyncedIds = items.filter((i) => !i.synced).map((i) => i.id);
    if (unsyncedIds.length === 0) {
      toast.info("所有知識點已同步");
      return;
    }
    const { error } = await supabase
      .from("knowledge_items")
      .update({ synced: true })
      .in("id", unsyncedIds);
    if (error) {
      console.error("Sync error:", error);
      toast.error("同步失敗");
    } else {
      toast.success("所有知識已同步至 AI 學習模型", {
        description: "AI 助手將能根據最新知識庫回答客戶問題",
      });
      setItems((prev) => prev.map((i) => ({ ...i, synced: true })));
    }
  }, [items]);

  return { items, loading, addItem, updateItem, deleteItem, syncAll, refetch: fetchItems };
}
