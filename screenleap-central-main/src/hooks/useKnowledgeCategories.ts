import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { z } from "zod";

export interface KnowledgeCategory {
  id: string;
  name: string;
  description: string;
  icon: string;
  sort_order: number;
  parent_key: "hq" | "store";
  created_by: string;
  created_at: string;
  updated_at: string;
}

const categorySchema = z.object({
  name: z.string().trim().min(1, "名稱不可為空").max(50, "名稱最多 50 字"),
  description: z.string().trim().max(200, "描述最多 200 字").optional().default(""),
  icon: z.string().trim().max(40).optional().default("Folder"),
  sort_order: z.number().int().min(0).max(9999).optional().default(0),
  parent_key: z.enum(["hq", "store"]).optional().default("store"),
});

// Cross-instance sync: notify all hook consumers when the categories list changes
const CATEGORIES_CHANGED_EVENT = "knowledge-categories-changed";
const notifyCategoriesChanged = () => {
  window.dispatchEvent(new Event(CATEGORIES_CHANGED_EVENT));
};

export function useKnowledgeCategories() {
  const { user } = useAuth();
  const [categories, setCategories] = useState<KnowledgeCategory[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    const { data, error } = await supabase
      .from("knowledge_categories")
      .select("*")
      .order("parent_key", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (error) {
      console.error("Failed to fetch categories:", error);
      toast.error("載入分類失敗");
    } else {
      setCategories((data ?? []) as KnowledgeCategory[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetch();
    const handler = () => { fetch(); };
    window.addEventListener(CATEGORIES_CHANGED_EVENT, handler);
    return () => window.removeEventListener(CATEGORIES_CHANGED_EVENT, handler);
  }, [fetch]);

  const addCategory = useCallback(
    async (input: { name: string; description?: string; icon?: string; sort_order?: number }) => {
      if (!user) return false;
      const parsed = categorySchema.safeParse(input);
      if (!parsed.success) {
        toast.error(parsed.error.errors[0].message);
        return false;
      }
      const { error } = await supabase.from("knowledge_categories").insert([{
        name: parsed.data.name,
        description: parsed.data.description,
        icon: parsed.data.icon,
        sort_order: parsed.data.sort_order,
        created_by: user.id,
      }]);
      if (error) {
        if (error.code === "23505") toast.error("分類名稱已存在");
        else toast.error("新增失敗");
        return false;
      }
      toast.success("分類已新增");
      await fetch();
      notifyCategoriesChanged();
      return true;
    },
    [user, fetch]
  );

  const updateCategory = useCallback(
    async (
      id: string,
      input: { name: string; description?: string; icon?: string; sort_order?: number }
    ) => {
      const parsed = categorySchema.safeParse(input);
      if (!parsed.success) {
        toast.error(parsed.error.errors[0].message);
        return false;
      }
      const { error } = await supabase
        .from("knowledge_categories")
        .update(parsed.data)
        .eq("id", id);
      if (error) {
        if (error.code === "23505") toast.error("分類名稱已存在");
        else toast.error("更新失敗");
        return false;
      }
      toast.success("分類已更新");
      await fetch();
      notifyCategoriesChanged();
      return true;
    },
    [fetch]
  );

  const deleteCategory = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("knowledge_categories").delete().eq("id", id);
      if (error) {
        console.error("Delete category error:", error);
        toast.error("刪除失敗");
        return false;
      }
      toast.success("分類已刪除");
      setCategories((prev) => prev.filter((c) => c.id !== id));
      notifyCategoriesChanged();
      return true;
    },
    []
  );

  const reorderCategories = useCallback(
    async (orderedIds: string[]) => {
      // Optimistic update: only update sort_order of items in orderedIds; keep others as-is
      const idSet = new Set(orderedIds);
      setCategories((prev) =>
        prev.map((c) => {
          if (!idSet.has(c.id)) return c;
          const newOrder = orderedIds.indexOf(c.id);
          return newOrder >= 0 ? { ...c, sort_order: newOrder } : c;
        })
      );

      const updates = orderedIds.map((id, idx) =>
        supabase.from("knowledge_categories").update({ sort_order: idx }).eq("id", id)
      );
      const results = await Promise.all(updates);
      const failed = results.find((r) => r.error);
      if (failed?.error) {
        console.error("Reorder failed:", failed.error);
        toast.error("排序儲存失敗");
        await fetch();
        return false;
      }
      await fetch();
      notifyCategoriesChanged();
      return true;
    },
    [fetch]
  );

  return { categories, loading, addCategory, updateCategory, deleteCategory, reorderCategories, refetch: fetch };
}
