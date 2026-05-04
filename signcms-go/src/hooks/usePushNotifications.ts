import { useState, useCallback } from "react";
import type { MCPClient } from "@/lib/mcp";

export type PushState = "idle" | "loading" | "granted" | "denied" | "unsupported";

// VITE_VAPID_PUBLIC_KEY is embedded at build time.
// Set it in your .env.local or build environment before deploying.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const VAPID_PUBLIC_KEY = (import.meta as unknown as { env: Record<string, string> }).env.VITE_VAPID_PUBLIC_KEY as string | undefined;

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw     = window.atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function usePushNotifications() {
  const [state, setState] = useState<PushState>(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
    if (Notification.permission === "granted") return "granted";
    if (Notification.permission === "denied")  return "denied";
    return "idle";
  });

  const subscribe = useCallback(async (mcp: MCPClient): Promise<boolean> => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return false;
    }
    if (!VAPID_PUBLIC_KEY) {
      console.warn("VITE_VAPID_PUBLIC_KEY not set — push notifications disabled");
      return false;
    }

    setState("loading");

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState("denied");
        return false;
      }

      const registration = await navigator.serviceWorker.ready;
      const existing     = await registration.pushManager.getSubscription();
      if (existing) await existing.unsubscribe();

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY).buffer as ArrayBuffer,
      });

      const json    = subscription.toJSON();
      const keys    = json.keys ?? {};
      const p256dh  = keys.p256dh  ?? "";
      const authKey = keys.auth    ?? "";

      if (!p256dh || !authKey) throw new Error("Push subscription missing keys");

      await mcp.callTool({
        name:      "register_push_subscription",
        arguments: {
          endpoint:    json.endpoint ?? "",
          p256dh,
          auth_key:    authKey,
          device_name: navigator.userAgent.slice(0, 80),
        },
      });

      setState("granted");
      return true;
    } catch (e) {
      console.error("Push subscription failed:", e);
      setState("idle");
      return false;
    }
  }, []);

  const unsubscribe = useCallback(async (mcp: MCPClient): Promise<void> => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await mcp.callTool({
          name:      "unregister_push_subscription",
          arguments: { endpoint: sub.endpoint },
        });
        await sub.unsubscribe();
      }
      setState("idle");
    } catch (e) {
      console.error("Unsubscribe failed:", e);
    }
  }, []);

  return { state, subscribe, unsubscribe };
}
