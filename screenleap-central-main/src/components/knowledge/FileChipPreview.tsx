import { useEffect, useRef, useState } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Button } from "@/components/ui/button";
import { Loader2, ExternalLink, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { openKnowledgeFileInNewTab } from "@/lib/openKnowledgeFile";
import { pdfDocumentOptions, pdfjs } from "@/lib/pdfjs";
import { getCachedThumb, setCachedThumb } from "@/lib/pdfThumbCache";

// Shared caches across chips for the same file.
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
const pdfLargeCache = new Map<string, string>();
const pdfInflight = new Map<string, Promise<string | null>>();
const PDF_LARGE_TARGET_WIDTH = 320;

/** Drop the in-memory large-thumb / signed-url entries for a storage path. */
export function dropFileChipPreviewMemCache(storagePath: string) {
  signedUrlCache.delete(storagePath);
  pdfLargeCache.delete(storagePath);
  pdfInflight.delete(storagePath);
}

/** Clear all in-memory large-thumb / signed-url entries. */
export function clearFileChipPreviewMemCache() {
  signedUrlCache.clear();
  pdfLargeCache.clear();
  pdfInflight.clear();
}

async function getSignedUrl(storagePath: string): Promise<string | null> {
  const cached = signedUrlCache.get(storagePath);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  const { data, error } = await supabase.storage
    .from("knowledge-files")
    .createSignedUrl(storagePath, 3600);
  if (error || !data?.signedUrl) return null;
  signedUrlCache.set(storagePath, {
    url: data.signedUrl,
    expiresAt: Date.now() + 55 * 60 * 1000,
  });
  return data.signedUrl;
}

async function renderPdfLarge(storagePath: string): Promise<string | null> {
  if (pdfLargeCache.has(storagePath)) return pdfLargeCache.get(storagePath)!;
  if (pdfInflight.has(storagePath)) return pdfInflight.get(storagePath)!;

  const promise = (async () => {
    // Try IndexedDB cache first to avoid re-rendering after a reload.
    const cached = await getCachedThumb(storagePath, PDF_LARGE_TARGET_WIDTH);
    if (cached) {
      pdfLargeCache.set(storagePath, cached);
      return cached;
    }

    const url = await getSignedUrl(storagePath);
    if (!url) return null;
    try {
      const pdf = await pdfjs.getDocument({
        url,
        ...pdfDocumentOptions,
      }).promise;
      const page = await pdf.getPage(1);
      const baseViewport = page.getViewport({ scale: 1 });
      const targetWidth = PDF_LARGE_TARGET_WIDTH * (window.devicePixelRatio || 1);
      const scale = targetWidth / baseViewport.width;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      await page.render({ canvasContext: ctx, viewport }).promise;
      const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
      pdfLargeCache.set(storagePath, dataUrl);
      void setCachedThumb(storagePath, PDF_LARGE_TARGET_WIDTH, dataUrl);
      return dataUrl;
    } catch (e) {
      console.warn("PDF large render failed:", e);
      return null;
    } finally {
      pdfInflight.delete(storagePath);
    }
  })();

  pdfInflight.set(storagePath, promise);
  return promise;
}

interface Props {
  storagePath: string;
  fileName: string;
  fileType: string;
  isImage: boolean;
  isPdf: boolean;
  children: React.ReactNode;
}

/**
 * Wraps a chip trigger with a HoverCard that renders a larger preview
 * (image signed URL or PDF first-page rendered via pdfjs).
 * Non-image / non-pdf files fall back to a plain hover label.
 */
export function FileChipPreview({ storagePath, fileName, fileType, isImage, isPdf, children }: Props) {
  const [open, setOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errored, setErrored] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    if (!open || previewUrl || errored) return;
    if (!isImage && !isPdf) return;

    setLoading(true);
    (async () => {
      const result = isImage ? await getSignedUrl(storagePath) : await renderPdfLarge(storagePath);
      if (cancelledRef.current) return;
      setLoading(false);
      if (!result) setErrored(true);
      else setPreviewUrl(result);
    })();

    return () => {
      cancelledRef.current = true;
    };
  }, [open, isImage, isPdf, storagePath, previewUrl, errored]);

  const handleOpen = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await openKnowledgeFileInNewTab(storagePath, fileName, fileType);
  };

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = await getSignedUrl(storagePath);
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <HoverCard openDelay={200} closeDelay={100} onOpenChange={setOpen}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent side="top" className="w-auto max-w-[360px] p-2">
        <div className="space-y-2">
          <div className="relative w-[320px] h-[200px] flex items-center justify-center rounded-md bg-muted overflow-hidden">
            {loading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
            {!loading && previewUrl && (
              <img
                src={previewUrl}
                alt={fileName}
                className="max-w-full max-h-full object-contain"
                onError={() => setErrored(true)}
              />
            )}
            {!loading && (errored || (!isImage && !isPdf)) && (
              <span className="text-xs text-muted-foreground">無法預覽</span>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="space-y-0.5 min-w-0 flex-1">
              <div className="text-xs font-medium truncate" title={fileName}>{fileName}</div>
              <div className="text-[10px] text-muted-foreground">{fileType || "未知類型"}</div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {!isPdf && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title="在新分頁開啟"
                  onClick={handleOpen}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="下載"
                onClick={handleDownload}
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
