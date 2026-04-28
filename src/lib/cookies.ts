/**
 * Cross-subdomain cookie utilities for .signcms.net
 */

const COOKIE_DOMAIN = ".signcms.net";

const isProduction = () =>
  typeof window !== "undefined" && window.location.hostname.endsWith("signcms.net");

export function setCookie(name: string, value: string): void {
  const secure = isProduction() ? "; Secure" : "";
  const domain = isProduction() ? `; domain=${COOKIE_DOMAIN}` : "";
  document.cookie = `${name}=${encodeURIComponent(value)}${domain}; path=/; SameSite=Lax${secure}; max-age=31536000`;
}

export function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function deleteCookie(name: string): void {
  const domain = isProduction() ? `; domain=${COOKIE_DOMAIN}` : "";
  document.cookie = `${name}=${domain}; path=/; max-age=0`;
}
