import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Downloads or opens a knowledge-files object.
 *
 * - PDFs: trigger a direct download (rendering large PDFs in a new tab is too
 *   slow and looks like the app is hung — users prefer to download).
 * - Images / other files: open in a new tab via a Blob URL with an explicit
 *   MIME type (some uploads land in storage as application/octet-stream).
 */
export async function openKnowledgeFileInNewTab(
  storagePath: string,
  fileName?: string,
  fileType?: string,
) {
  const { data, error } = await supabase.storage
    .from("knowledge-files")
    .createSignedUrl(storagePath, 3600);

  if (error || !data?.signedUrl) {
    toast.error("無法開啟檔案");
    return;
  }

  // For PDFs we always download — inline rendering of large PDFs is slow and
  // gives the impression the browser/app has frozen.
  if (isPdfFile(fileName, fileType)) {
    triggerDownload(data.signedUrl, fileName ?? "document.pdf");
    return;
  }

  // Open a same-origin placeholder tab synchronously so the popup is allowed.
  const tab = window.open("", "_blank");

  try {
    const res = await fetch(data.signedUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const originalBlob = await res.blob();

    const mime = inferMime(originalBlob.type, fileName, fileType);
    const blob = mime === originalBlob.type ? originalBlob : originalBlob.slice(0, originalBlob.size, mime);

    const objectUrl = URL.createObjectURL(blob);
    if (tab && !tab.closed) tab.location.replace(objectUrl);
    else window.open(objectUrl, "_blank");

    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch (e) {
    console.warn("Blob open failed, falling back to signed URL:", e);
    if (tab && !tab.closed) tab.location.replace(data.signedUrl);
    else window.open(data.signedUrl, "_blank");
  }
}

function triggerDownload(url: string, fileName: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function isPdfFile(fileName?: string, fileType?: string) {
  return fileType === "application/pdf" || fileName?.toLowerCase().endsWith(".pdf");
}

function inferMime(blobType: string, fileName?: string, fileType?: string): string {
  if (blobType && blobType !== "application/octet-stream") return blobType;
  if (fileType && fileType !== "application/octet-stream") return fileType;
  const ext = fileName?.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "pdf": return "application/pdf";
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "webp": return "image/webp";
    case "gif": return "image/gif";
    case "svg": return "image/svg+xml";
    case "txt": return "text/plain";
    case "json": return "application/json";
    default: return blobType || "application/octet-stream";
  }
}
