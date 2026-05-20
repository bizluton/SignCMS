// Pill-shaped colour swatch with a hidden native colour input.
//
// Originally embedded in src/pages/ContentStudioPage.tsx. Extracted as a
// reusable leaf — no app state, no DB, just a controlled input.

interface ColorSwatchInputProps {
  value:    string;
  onChange: (v: string) => void;
  /** Shown when value is empty or "transparent". */
  fallback?: string;
  disabled?: boolean;
}

export function ColorSwatchInput({
  value,
  onChange,
  fallback = "#000000",
  disabled = false,
}: ColorSwatchInputProps) {
  const display = value === "transparent" || !value ? fallback : value;
  return (
    <label className="relative flex-1 min-w-0 h-8 block cursor-pointer">
      <div
        className="absolute inset-0 rounded-full border border-input"
        style={{ background: display, opacity: disabled ? 0.45 : 1 }}
      />
      <input
        type="color"
        value={display}
        onChange={(e) => { if (!disabled) onChange(e.target.value); }}
        disabled={disabled}
        className="absolute inset-0 opacity-0 w-full h-full cursor-pointer disabled:cursor-not-allowed"
      />
    </label>
  );
}
