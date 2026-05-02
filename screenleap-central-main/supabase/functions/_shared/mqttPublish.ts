/**
 * mqttPublish — HTTP Bridge helper for Mosquitto integration.
 *
 * SignCMS runs on Supabase (cloud); the Mosquitto broker sits behind the
 * company firewall. A lightweight HTTP Bridge service runs on a public endpoint
 * in the company network, accepts POST requests from this helper, and forwards
 * them to the local broker via the standard MQTT client library.
 *
 * Required env vars (set in Supabase project secrets):
 *   MQTT_BRIDGE_URL    — public HTTPS URL of the bridge endpoint
 *                        e.g. https://mqtt-bridge.example.com/publish
 *   MQTT_BRIDGE_SECRET — shared secret; bridge verifies via Authorization header
 *
 * If either env var is absent this module is a silent no-op (safe for local dev
 * and test environments that don't have Mosquitto configured).
 *
 * Topic conventions:
 *   signcms/{org_id}/screen/{screen_id}   — full sync payload, retain=true,  QoS=1
 *   signcms/{org_id}/trigger/{screen_id}  — trigger event,   retain=false, QoS=0
 *   signcms/{org_id}/trigger/broadcast    — org-wide trigger, retain=false, QoS=0
 *   signcms/{org_id}/broadcast            — org-wide sync,    retain=true,  QoS=1
 */

export interface MqttMessage {
  /** Schema version — increment on breaking payload changes. */
  v: 1;
  type: "sync" | "trigger" | "command" | "license";
  /** ISO-8601 timestamp from server. APK uses this as `since` cursor. */
  ts: string;
  org_id: string;
  screen_id: string | null;
  payload: Record<string, unknown>;
}

interface BridgeRequest {
  topic: string;
  payload: MqttMessage;
  retain: boolean;
  qos: 0 | 1 | 2;
}

// ─── Topic builders ───────────────────────────────────────────────────────────

/** Per-screen sync topic. Publish with retain=true, QoS=1. */
export function topicScreen(orgId: string, screenId: string): string {
  return `signcms/${orgId}/screen/${screenId}`;
}

/**
 * Per-screen or org-wide trigger topic.
 * screenId=null → publishes to `…/trigger/broadcast` so all screens in the org receive it.
 * Publish with retain=false, QoS=0.
 */
export function topicTrigger(orgId: string, screenId: string | null): string {
  return `signcms/${orgId}/trigger/${screenId ?? "broadcast"}`;
}

/** Org-wide broadcast sync topic. Publish with retain=true, QoS=1. */
export function topicBroadcast(orgId: string): string {
  return `signcms/${orgId}/broadcast`;
}

// ─── Publish ──────────────────────────────────────────────────────────────────

/**
 * Fire-and-forget MQTT publish via HTTP Bridge.
 *
 * - Never throws. Errors are logged as warnings only.
 * - Safe to call without `await` in hot paths (e.g. smart-trigger-webhook).
 * - 5-second timeout so a slow bridge never stalls the main request.
 */
export async function mqttPublish(
  topic: string,
  message: MqttMessage,
  options: { retain?: boolean; qos?: 0 | 1 | 2 } = {},
): Promise<void> {
  const bridgeUrl    = Deno.env.get("MQTT_BRIDGE_URL");
  const bridgeSecret = Deno.env.get("MQTT_BRIDGE_SECRET");
  if (!bridgeUrl || !bridgeSecret) return;

  const body: BridgeRequest = {
    topic,
    payload: message,
    retain: options.retain ?? false,
    qos:    options.qos    ?? 0,
  };

  try {
    const res = await fetch(bridgeUrl, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${bridgeSecret}`,
      },
      body:   JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      console.warn(`[mqttPublish] bridge ${res.status} for topic ${topic}`);
    }
  } catch (err) {
    console.warn(`[mqttPublish] failed for topic ${topic}:`, err);
  }
}
