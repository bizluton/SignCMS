import { useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { pdfDocumentOptions, pdfjs } from "@/lib/pdfjs";
import { getCachedThumb, setCachedThumb } from "@/lib/pdfThumbCache";

// Target CSS width of the small chip thumb. Multiplied by devicePixelRatio
// when rendering, but used as-is for the cache key so the same DPR returns
// a consistent entry.
const TARGET_WIDTH = 64;

// In-memory mirror to avoid hitting IndexedDB repeatedly within a session.
const memCache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

/** Drop the in-memory thumb for a given storage path. */
export function dropPdfChipThumbMemCache(storagePath: string) {
  memCache.delete(storagePath);
  inflight.delete(storagePath);
}

/** Clear all in-memory PDF chip thumbnails. */
export function clearPdfChipThumbMemCache() {
  memCache.clear();
  inflight.clear();
}

interface Props {
  storagePath: string;
  alt: string;
  className?: string;
  imgClassName?: string;
}

async function renderPdfThumb(storagePath: string): Promise<string | null> {
  if (memCache.has(storagePath)) return memCache.get(storagePath)!;
  if (inflight.has(storagePath)) return inflight.get(storagePath)!;

  const promise = (async () => {
    // 1. Try IndexedDB cache first.
    const cached = await getCachedThumb(storagePath, TARGET_WIDTH);
    if (cached) {
      memCache.set(storagePath, cached);
      return cached;
    }

    // 2. Fetch signed URL and render the first page.
    const { data, error } = await supabase.storage
      .from("knowledge-files")
      .createSignedUrl(storagePath, 3600);
    if (error || !data?.signedUrl) return null;

    try {
      const loadingTask = pdfjs.getDocument({
        url: data.signedUrl,
        ...pdfDocumentOptions,
      });
      const pdf = await loadingTask.promise;
      const page = await pdf.getPage(1);
      const baseViewport = page.getViewport({ scale: 1 });
      const targetWidth = TARGET_WIDTH * (window.devicePixelRatio || 1);
      const scale = targetWidth / baseViewport.width;
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;

      await page.render({ canvasContext: ctx, viewport }).promise;
      const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
      memCache.set(storagePath, dataUrl);
      // Persist to IndexedDB (fire-and-forget).
      void setCachedThumb(storagePath, TARGET_WIDTH, dataUrl);
      return dataUrl;
    } catch (e) {
      console.warn("PDF thumb render failed:", e);
      return null;
    } finally {
      inflight.delete(storagePath);
    }
  })();

  inflight.set(storagePath, promise);
  return promise;
}

/**
 * Renders a thumbnail of the first page of a PDF stored in knowledge-files.
 * Falls back to a FileText icon while loading or if rendering fails.
 * Uses an IndexedDB cache so thumbnails persist across reloads.
 */
export function PdfChipThumb({ storagePath, alt, className, imgClassName }: Props) {
  const [url, setUrl] = useState<string | null>(() => memCache.get(storagePath) ?? null);
  const [errored, setErrored] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    if (url) return;

    renderPdfThumb(storagePath).then((result) => {
      if (cancelledRef.current) return;
      if (!result) setErrored(true);
      else setUrl(result);
    });

    return () => {
      cancelledRef.current = true;
    };
  }, [storagePath, url]);

  if (!url || errored) {
    return <FileText className={className ?? "h-3 w-3 shrink-0 ml-1"} />;
  }

  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      onError={() => setErrored(true)}
      className={imgClassName ?? "h-4 w-4 rounded-sm object-cover shrink-0"}
    />
  );
}
