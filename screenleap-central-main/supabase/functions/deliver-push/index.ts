// deliver-push: Web Push notification delivery
//
// Called by:
//   1. pg_net trigger when screens.online transitions to false
//   2. MCP emergency_broadcast tool (manual push)
//
// Auth: Bearer {PUSH_DELIVERY_KEY} — a shared secret, NOT the service role key
// VAPID env vars: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  type PushSubscription,
  sendNotification,
  setVapidDetails,
} from "npm:web-push@3.6.7";
import { bearerEquals } from "../_shared/timingSafeEqual.ts";

// ── CORS (only DB/internal calls; add origins if needed) ─────────────────────
const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ── Notification templates (zh / en fallback) ─────────────────────────────────
function buildNotification(type: string, payload: Record<string, unknown>) {
  switch (type) {
    case "screen_offline":
      return {
        title: "⚠️ 螢幕離線",
        body:  `${payload.screen_name ?? "螢幕"} (${payload.location ?? payload.branch ?? ""}) 已離線`,
        icon:  "/icon-192.png",
        badge: "/icon-192.png",
        tag:   `offline-${payload.screen_id}`,
        data:  { type, payload, url: "/" },
      };
    case "emergency_broadcast":
      return {
        title: "🚨 緊急廣播已啟動",
        body:  `${payload.channel_name ?? "緊急頻道"} — ${payload.reason ?? ""}`,
        icon:  "/icon-192.png",
        badge: "/icon-192.png",
        tag:   "emergency",
        data:  { type, payload, url: "/" },
      };
    default:
      return {
        title: "SignCMS 通知",
        body:  JSON.stringify(payload).slice(0, 120),
        icon:  "/icon-192.png",
        badge: "/icon-192.png",
        data:  { type, payload, url: "/" },
      };
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, 405);

  // ── Auth: verify shared delivery key ────────────────────────────────────
  const deliveryKey   = Deno.env.get("PUSH_DELIVERY_KEY") ?? "";
  const authorization = req.headers.get("authorization");
  if (!bearerEquals(authorization, deliveryKey)) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: { org_id?: string; type?: string; reference?: string; payload?: Record<string, unknown> };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const { org_id, type = "generic", reference, payload = {} } = body;
  if (!org_id) return json({ error: "org_id required" }, 400);

  // ── Configure VAPID ────────────────────────────────────────────────────
  const vapidSubject    = Deno.env.get("VAPID_SUBJECT")      ?? "mailto:admin@signcms.app";
  const vapidPublicKey  = Deno.env.get("VAPID_PUBLIC_KEY")   ?? "";
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY")  ?? "";

  if (!vapidPublicKey || !vapidPrivateKey) {
    return json({ error: "VAPID keys not configured" }, 500);
  }

  setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  // ── Fetch subscriptions for this org ────────────────────────────────────
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: subs, error: subErr } = await sb
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth_key")
    .eq("org_id", org_id);

  if (subErr) {
    console.error("Failed to fetch subscriptions:", subErr);
    return json({ error: subErr.message }, 500);
  }
  if (!subs || subs.length === 0) return json({ sent: 0, message: "No subscribers" });

  // ── Check notification_log for deduplication (5-min window) ────────────
  const dedupeWindow = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data: recent } = await sb
    .from("notification_log")
    .select("id")
    .eq("org_id", org_id)
    .eq("type", type)
    .eq("reference_id", reference ?? "")
    .gte("sent_at", dedupeWindow)
    .limit(1);

  if (recent && recent.length > 0) {
    return json({ sent: 0, message: "Deduplicated (sent within 5 min)" });
  }

  // ── Send notifications ──────────────────────────────────────────────────
  const notification = buildNotification(type, { ...payload, screen_id: reference });
  const notifPayload = JSON.stringify(notification);
  const expiredIds: string[] = [];
  let   sent = 0;

  await Promise.allSettled(
    subs.map(async (sub) => {
      const pushSub: PushSubscription = {
        endpoint: sub.endpoint,
        keys:     { p256dh: sub.p256dh, auth: sub.auth_key },
      };
      try {
        await sendNotification(pushSub, notifPayload, { TTL: 3600 });
        sent++;
      } catch (e: unknown) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 410 || status === 404) {
          expiredIds.push(sub.id);
        } else {
          console.error("Push send error:", e);
        }
      }
    }),
  );

  // ── Clean up expired subscriptions ─────────────────────────────────────
  if (expiredIds.length > 0) {
    await sb.from("push_subscriptions").delete().in("id", expiredIds);
  }

  // ── Log the notification ────────────────────────────────────────────────
  await sb.from("notification_log").insert({
    org_id,
    type,
    reference_id: reference ?? null,
    payload:      { ...payload, sent_count: sent },
  });

  return json({ sent, expired_removed: expiredIds.length });
});
