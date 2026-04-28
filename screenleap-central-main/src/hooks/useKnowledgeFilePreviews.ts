import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface FilePreview {
  id: string;
  knowledge_item_id: string;
  file_name: string;
  file_type: string;
  storage_path: string;
  created_at: string;
}

/**
 * Fetches up to N latest files per knowledge item id, in a single query.
 * Returns a map: item_id -> FilePreview[] (length <= perItem).
 */
export function useKnowledgeFilePreviews(itemIds: string[], perItem = 3) {
  const [previews, setPreviews] = useState<Record<string, FilePreview[]>>({});
  const key = itemIds.slice().sort().join(",");

  useEffect(() => {
    if (itemIds.length === 0) {
      setPreviews({});
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("knowledge_files")
        .select("id, knowledge_item_id, file_name, file_type, storage_path, created_at")
        .in("knowledge_item_id", itemIds)
        .order("created_at", { ascending: false });

      if (cancelled) return;
      if (error) {
        console.error("Failed to fetch file previews:", error);
        return;
      }

      const map: Record<string, FilePreview[]> = {};
      for (const f of data ?? []) {
        const arr = map[f.knowledge_item_id] ?? (map[f.knowledge_item_id] = []);
        if (arr.length < perItem) arr.push(f as FilePreview);
      }
      setPreviews(map);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, perItem]);

  return previews;
}
