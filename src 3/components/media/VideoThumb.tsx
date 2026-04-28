import { useEffect, useState } from "react";
import { FileVideo, Play } from "lucide-react";
import { captureAndCachePoster, getCachedPoster } from "@/lib/videoPosterCache";

interface Props {
  src: string;
  name: string;
  className?: string;
  showPlayHint?: boolean;
  poster?: string | null;
}

export function VideoThumb({ src, name, className, showPlayHint = true, poster }: Props) {
  const [resolvedPoster, setResolvedPoster] = useState<string | null>(poster ?? null);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setResolvedPoster(poster ?? null);
    setErrored(false);

    if (poster || !src) return () => { cancelled = true; };

    void getCachedPoster(src).then((cached) => {
      if (cancelled) return;
      if (cached) { setResolvedPoster(cached); return; }
      void captureAndCachePoster(src).then((dataUrl) => {
        if (!cancelled && dataUrl) setResolvedPoster(dataUrl);
        else if (!cancelled && !dataUrl) setErrored(true);
      });
    });

    return () => { cancelled = true; };
  }, [src, poster]);

  if (!src) {
    return (
      <div className={`flex items-center justify-center ${className ?? ""}`}>
        <FileVideo className="h-10 w-10 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className={`relative h-full w-full overflow-hidden ${className ?? ""}`}>
      {resolvedPoster ? (
        <img
          src={resolvedPoster}
          alt={name}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-muted">
          <FileVideo className="h-10 w-10 text-muted-foreground" />
        </div>
      )}

      {showPlayHint && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-full bg-foreground/55 p-2 backdrop-blur-sm">
            <Play className="h-4 w-4 fill-background text-background" />
          </div>
        </div>
      )}
    </div>
  );
}
