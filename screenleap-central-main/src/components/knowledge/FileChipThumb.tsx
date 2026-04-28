import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

// Module-level cache so chips for the same file don't refetch signed URLs.
const urlCache = new Map<string, { url: string; expiresAt: number }>();

interface Props {
  storagePath: string;
  alt: string;
  className?: string;
  imgClassName?: string;
}

/**
 * Renders a small thumbnail for an image stored in the knowledge-files bucket.
 * Falls back to an icon while loading or if the signed URL fails.
 */
export function FileChipThumb({ storagePath, alt, className, imgClassName }: Props) {
  const [url, setUrl] = useState<string | null>(() => {
    const cached = urlCache.get(storagePath);
    return cached && cached.expiresAt > Date.now() ? cached.url : null;
  });
  const [errored, setErrored] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    if (url) return;

    (async () => {
      const { data, error } = await supabase.storage
        .from("knowledge-files")
        .createSignedUrl(storagePath, 3600);
      if (cancelledRef.current) return;
      if (error || !data?.signedUrl) {
        setErrored(true);
        return;
      }
      urlCache.set(storagePath, {
        url: data.signedUrl,
        expiresAt: Date.now() + 55 * 60 * 1000, // refresh slightly before 1h expiry
      });
      setUrl(data.signedUrl);
    })();

    return () => {
      cancelledRef.current = true;
    };
  }, [storagePath, url]);

  if (!url || errored) {
    return <ImageIcon className={className ?? "h-3 w-3 shrink-0"} />;
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
