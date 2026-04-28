/**
 * Single source of truth for whether connection-related UI
 * (online/offline badges, IP, heartbeat, network speed,
 * wired/wireless icons, helper tooltips) may be rendered
 * for a given screen.
 *
 * Unlicensed and revoked screens MUST NOT render any
 * connection signals — they are gray-locked everywhere.
 */

export type ScreenLicenseSummary = {
  licensed: boolean;
  status?: string;
} | null | undefined;

export function isScreenUnlicensed(ls: ScreenLicenseSummary): boolean {
  return !!ls && !ls.licensed;
}

export function shouldShowConnectionUi(ls: ScreenLicenseSummary): boolean {
  return !isScreenUnlicensed(ls);
}