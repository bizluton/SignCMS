import { ReactNode } from "react";
import { shouldShowConnectionUi, type ScreenLicenseSummary } from "@/lib/screenConnectionVisibility";

/**
 * Wrapper that hides ALL connection-related children
 * (online badges, IP, heartbeat, wired/wireless icons,
 * network speed, related tooltips and helper copy)
 * when the screen is unlicensed or revoked.
 *
 * Use this as the single gate for any connection UI
 * inside a screen card / list / detail view.
 */
export function ConnectionInfo({
  license,
  children,
}: {
  license: ScreenLicenseSummary;
  children: ReactNode;
}) {
  if (!shouldShowConnectionUi(license)) return null;
  return <>{children}</>;
}