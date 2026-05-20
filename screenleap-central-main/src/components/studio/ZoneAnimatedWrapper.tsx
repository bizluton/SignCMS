// Zone animation wrapper — applies one of a small set of Tailwind keyframe
// classes to its children. Used to animate widget zones in / out when a
// scene transitions.
//
// Extracted from src/pages/ContentStudioPage.tsx. Pure presentational.

import type { ReactNode } from "react";

export const ZONE_ANIMATION_CSS: Record<string, string> = {
  none:    "",
  fadeIn:  "animate-[widgetFadeIn_0.8s_ease-out_both]",
  slideUp: "animate-[widgetSlideUp_0.6s_ease-out_both]",
  bounce:  "animate-[widgetBounce_0.8s_ease-out_both]",
  zoomIn:  "animate-[widgetZoomIn_0.5s_ease-out_both]",
  flipIn:  "animate-[widgetFlipIn_0.7s_ease-out_both]",
};

interface ZoneAnimatedWrapperProps {
  animation?: string;
  children:   ReactNode;
}

export function ZoneAnimatedWrapper({ animation, children }: ZoneAnimatedWrapperProps) {
  const anim = animation || "none";
  if (anim === "none") return <>{children}</>;
  return <div className={`w-full h-full ${ZONE_ANIMATION_CSS[anim] || ""}`}>{children}</div>;
}
