// LayoutThumb — small SVG that renders a zone layout's geometry as labelled
// rectangles. Used in the layout/template picker.
//
// Extracted from src/pages/ContentStudioPage.tsx. Pure SVG renderer; takes
// only the geometry it needs so it doesn't import the page's bigger Zone
// type universe.

export type LayoutThumbAspect = "16:9" | "9:16";

interface ThumbZone {
  id:    string;
  x:     number;  // 0–100
  y:     number;
  w:     number;
  h:     number;
  label: string;
}

interface LayoutThumbProps {
  zones:   ThumbZone[];
  aspect?: LayoutThumbAspect;
}

export function LayoutThumb({ zones, aspect = "16:9" }: LayoutThumbProps) {
  const vbW = aspect === "9:16" ? 36 : 64;
  const vbH = aspect === "9:16" ? 64 : 36;
  return (
    <svg viewBox={`0 0 ${vbW} ${vbH}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet" aria-hidden>
      <rect x="0" y="0" width={vbW} height={vbH} className="fill-muted" />
      {zones.map((z) => (
        <rect
          key={z.id}
          x={(z.x / 100) * vbW + 0.5}
          y={(z.y / 100) * vbH + 0.5}
          width={(z.w / 100) * vbW - 1}
          height={(z.h / 100) * vbH - 1}
          className="fill-primary/20 stroke-primary"
          strokeWidth={0.6}
          rx={1}
        />
      ))}
      {zones.map((z) => (
        <text
          key={`t-${z.id}`}
          x={(z.x / 100) * vbW + ((z.w / 100) * vbW) / 2}
          y={(z.y / 100) * vbH + ((z.h / 100) * vbH) / 2 + 1.6}
          textAnchor="middle"
          className="fill-foreground"
          fontSize={Math.max(3, Math.min(6, (z.w * z.h) / 800))}
          fontWeight={600}
        >
          {z.label}
        </text>
      ))}
    </svg>
  );
}
