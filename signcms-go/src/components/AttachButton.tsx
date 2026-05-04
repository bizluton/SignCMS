import { Paperclip } from "lucide-react";
import { useRef } from "react";
import { clsx } from "clsx";

interface Props {
  onFile:    (file: File) => void;
  disabled?: boolean;
}

export function AttachButton({ onFile, disabled }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) { onFile(file); e.target.value = ""; }
        }}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={disabled}
        className={clsx(
          "p-2.5 rounded-full transition-colors",
          disabled
            ? "text-slate-600 pointer-events-none"
            : "text-slate-400 hover:text-slate-200 hover:bg-slate-800",
        )}
        aria-label="Attach file"
      >
        <Paperclip className="w-4 h-4" />
      </button>
    </>
  );
}
