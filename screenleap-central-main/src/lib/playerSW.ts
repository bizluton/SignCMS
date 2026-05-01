/**
 * Client-side Service Worker helpers for the Player.
 *
 * - registerPlayerSW()      — call once at app startup (main.tsx)
 * - precacheMediaUrls(urls) — ask the SW to pre-download media files
 * - cleanupMediaCache(keep) — ask the SW to evict URLs not in `keep`
 *
 * All functions are safe no-ops when the SW API is unavailable (older Tizen,
 * SSSP 5 and below, or HTTP contexts).
 */

const SW_PATH  = '/sw.js';
const SW_SCOPE = '/';

export async function registerPlayerSW(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register(SW_PATH, { scope: SW_SCOPE });
  } catch (err) {
    // Non-fatal — HTTP cache remains the fallback.
    console.warn('[SW] registration failed:', err);
  }
}

function controller(): ServiceWorker | null {
  return navigator.serviceWorker?.controller ?? null;
}

export function precacheMediaUrls(urls: string[]): void {
  const sw = controller();
  if (!sw) return;
  const unique = [...new Set(urls.filter(Boolean))];
  if (unique.length === 0) return;
  sw.postMessage({ type: 'PRECACHE', urls: unique });
}

export function cleanupMediaCache(keepUrls: string[]): void {
  const sw = controller();
  if (!sw) return;
  sw.postMessage({ type: 'CLEANUP', keepUrls: [...new Set(keepUrls.filter(Boolean))] });
}
