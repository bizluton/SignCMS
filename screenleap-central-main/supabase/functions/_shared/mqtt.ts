/**
 * MQTT publish helpers for SignCMS Supabase Edge Functions.
 *
 * Publishes commands to the EMQX broker via its HTTP API so that
 * connected players receive real-time push messages without polling.
 *
 * Required environment variables:
 *   MQTT_API_URL        — e.g. https://xxxxx.emqxsl.com:8883 (REST API base)
 *   MQTT_API_KEY        — EMQX API key ID
 *   MQTT_API_SECRET     — EMQX API key secret
 *
 * Optional:
 *   MQTT_BROKER_WS      — wss:// URL given to players for WebSocket connections
 *                         (returned in player-sync response)
 */

const API_URL    = Deno.env.get("MQTT_API_URL")    ?? "";
const API_KEY    = Deno.env.get("MQTT_API_KEY")    ?? "";
const API_SECRET = Deno.env.get("MQTT_API_SECRET") ?? "";

/** wss:// broker URL served to player clients */
export const BROKER_WS = Deno.env.get("MQTT_BROKER_WS") ?? "";

// ── Low-level publish via EMQX HTTP API ──────────────────────────────────

interface PublishOpts {
  topic:   string;
  payload: unknown;
  qos?:    0 | 1 | 2;
  retain?: boolean;
}

/**
 * Publish a single message to any topic via EMQX HTTP API.
 * Returns true on success; false when MQTT is not configured or the request fails.
 */
export async function mqttPublish(opts: PublishOpts): Promise<boolean> {
  if (!API_URL || !API_KEY || !API_SECRET) return false;  // MQTT not configured

  const body = {
    topic:          opts.topic,
    payload:        JSON.stringify(opts.payload),
    qos:            opts.qos    ?? 1,
    retain:         opts.retain ?? false,
    payload_encoding: "plain",
  };

  try {
    const res = await fetch(`${API_URL}/api/v5/publish`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": "Basic " + btoa(`${API_KEY}:${API_SECRET}`),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("[mqtt] publish failed", res.status, text);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[mqtt] publish error:", (e as Error).message);
    return false;
  }
}

// ── High-level helpers ────────────────────────────────────────────────────

/**
 * Send a command to a specific screen.
 * Topic: signcms/{orgId}/screens/{screenId}/cmd
 */
export async function screenCmd(
  orgId:    string,
  screenId: string,
  payload:  Record<string, unknown>,
): Promise<boolean> {
  return mqttPublish({
    topic:   `signcms/${orgId}/screens/${screenId}/cmd`,
    payload: { ...payload, ts: Date.now() },
  });
}

/**
 * Send a command to every screen in an org.
 * Topic: signcms/{orgId}/broadcast
 */
export async function orgBroadcast(
  orgId:   string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  return mqttPublish({
    topic:   `signcms/${orgId}/broadcast`,
    payload: { ...payload, ts: Date.now() },
  });
}

/**
 * Convenience: tell one or more screens to re-sync immediately.
 */
export async function notifySync(orgId: string, screenIds: string[]): Promise<void> {
  await Promise.all(
    screenIds.map((sid) => screenCmd(orgId, sid, { type: "sync" })),
  );
}
