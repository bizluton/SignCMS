/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope;

// Workbox precache manifest (injected by vite-plugin-pwa)
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Take control immediately on install/activate so updates show right away
self.addEventListener("install",  () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// ── Push notification handler ─────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  const data = event.data?.json() as {
    title?: string;
    body?:  string;
    icon?:  string;
    badge?: string;
    tag?:   string;
    data?:  Record<string, unknown>;
  } | undefined ?? {};

  event.waitUntil(
    self.registration.showNotification(data.title ?? "SignCMS Go", {
      body:  data.body  ?? "",
      icon:  data.icon  ?? "/icon-192.png",
      badge: data.badge ?? "/icon-192.png",
      tag:   data.tag,
      data:  data.data,
      // vibration pattern for mobile
      vibrate: [200, 100, 200],
    } as NotificationOptions),
  );
});

// ── Notification click → focus / open app ────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data as Record<string, unknown> | undefined)?.url as string | undefined ?? "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    }),
  );
});

// ── Background sync stub (future use) ────────────────────────────────────────
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
