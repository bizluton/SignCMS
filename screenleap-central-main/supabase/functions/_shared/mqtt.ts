/**
 * MQTT helpers for self-hosted Mosquitto broker.
 *
 * ── Topics ────────────────────────────────────────────────────────────────
 *   signage/player/{serial}/heartbeat       device→server  QoS 0  15 s
 *   signage/player/{serial}/command         server→device  QoS 1
 *   signage/player/{serial}/response        device→server  QoS 0
 *   signage/player/{serial}/status          device (LWT)   QoS 1  retain
 *   signage/player/{serial}/shadow/delta    server→device  QoS 1  retain
 *
 * ── Shadow delta (retain + QoS 1) ────────────────────────────────────────
 *   Mosquitto stores the last retained message per topic.
 *   When the device connects and subscribes to shadow/delta it immediately
 *   receives any pending desired-state diff — even if it was offline when
 *   the server wrote the change.  Once the device reports back (reported ==
 *   desired), the server clears the retain by publishing an empty payload.
 *
 * ── Environment variables ─────────────────────────────────────────────────
 *   MQTT_BROKER_WS        — WebSocket URL served to players (ws:// or wss://)
 *   MQTT_BROKER_WS_SERVER — WebSocket URL for Edge Function publishing
 *                           (falls back to MQTT_BROKER_WS)
 *   MQTT_SERVER_USER      — server publisher username
 *   MQTT_SERVER_PASS      — server publisher password
 */

// deno-lint-ignore-file no-explicit-any
import mqtt from "npm:mqtt@5.10.1";

/** WebSocket URL returned to players so they know where to connect. */
export const BROKER_WS: string = Deno.env.get("MQTT_BROKER_WS") ?? "";

const SERVER_BROKER = Deno.env.get("MQTT_BROKER_WS_SERVER") || BROKER_WS;
const SERVER_USER   = Deno.env.get("MQTT_SERVER_USER")      ?? "";
const SERVER_PASS   = Deno.env.get("MQTT_SERVER_PASS")      ?? "";

// ── Topic builders ────────────────────────────────────────────────────────

export const topicCommand     = (s: string) => `signage/player/${s}/command`;
export const topicHeartbeat   = (s: string) => `signage/player/${s}/heartbeat`;
export const topicResponse    = (s: string) => `signage/player/${s}/response`;
export const topicStatus      = (s: string) => `signage/player/${s}/status`;
export const topicShadowDelta = (s: string) => `signage/player/${s}/shadow/delta`;

// ── Low-level publish ─────────────────────────────────────────────────────

interface PubOpts {
  qos?:    0 | 1 | 2;
  retain?: boolean;
}

/**
 * Publish a message via an ephemeral Mosquitto WebSocket connection.
 * Edge Functions are stateless so we connect → publish → disconnect each time.
 *
 * @param topic   Full MQTT topic string
 * @param payload Object to JSON-encode, or empty string to clear a retain
 * @param opts    { qos, retain }
 */
export async function mqttPublish(
  topic:   string,
  payload: unknown,
  opts:    PubOpts = {},
): Promise<boolean> {
  if (!SERVER_BROKER || !SERVER_USER) return false;

  const qos    = opts.qos    ?? 0;
  const retain = opts.retain ?? false;
  const raw    = payload === "" ? "" : JSON.stringify(payload);

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => { if (!settled) { settled = true; resolve(ok); } };

    const timer = setTimeout(() => {
      try { client?.end(true); } catch (_) {}
      finish(false);
    }, 8_000);

    const client: any = mqtt.connect(SERVER_BROKER, {
      clientId:        `signcms_srv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      username:        SERVER_USER,
      password:        SERVER_PASS,
      clean:           true,
      connectTimeout:  5_000,
      reconnectPeriod: 0,
    });

    client.on("connect", () => {
      client.publish(topic, raw, { qos, retain }, (err: Error | null) => {
        clearTimeout(timer);
        client.end(false, {}, () => finish(!err));
        if (err) console.error("[mqtt] publish err:", err.message);
      });
    });

    client.on("error", (err: Error) => {
      console.error("[mqtt] connect error:", err.message);
      clearTimeout(timer);
      try { client.end(true); } catch (_) {}
      finish(false);
    });
  });
}

// ── Command (QoS 1) ───────────────────────────────────────────────────────

/**
 * Send a structured command to one screen.
 * QoS 1 — broker retries until the device ACKs.
 */
export async function screenCmd(
  serial: string,
  cls:    string,
  cmd:    string,
  data:   Record<string, unknown> = {},
): Promise<boolean> {
  return mqttPublish(
    topicCommand(serial),
    { ts: Math.floor(Date.now() / 1_000), cls, cmd, data, cid: crypto.randomUUID() },
    { qos: 1 },
  );
}

/**
 * Tell a list of screens to re-sync content immediately.
 * _orgId kept for API compatibility — not used in Mosquitto topics.
 */
export async function notifySync(_orgId: string, screenIds: string[]): Promise<void> {
  await Promise.all(screenIds.map((sid) => screenCmd(sid, "content", "sync")));
}

/**
 * Send an arbitrary command to a list of screens.
 */
export async function orgBroadcast(
  _orgId:    string,
  screenIds: string[],
  cls:       string,
  cmd:       string,
  data:      Record<string, unknown> = {},
): Promise<void> {
  await Promise.all(screenIds.map((sid) => screenCmd(sid, cls, cmd, data)));
}

// ── Device Shadow helpers (QoS 1, retain) ────────────────────────────────

/**
 * Publish the current shadow delta to the device.
 * Uses retain: true so the device receives it immediately on subscribe,
 * even if it was offline when the server wrote the change.
 *
 * @param serial  Screen ID used as MQTT topic serial
 * @param desired The full desired state object
 * @param delta   Only the keys that differ from reported
 */
export async function publishShadowDelta(
  serial:  string,
  desired: Record<string, unknown>,
  delta:   Record<string, unknown>,
): Promise<boolean> {
  return mqttPublish(
    topicShadowDelta(serial),
    { ts: Math.floor(Date.now() / 1_000), desired, delta },
    { qos: 1, retain: true },
  );
}

/**
 * Clear the retained shadow delta once the device is in sync.
 * Publishing an empty payload with retain: true removes the retained message
 * from the broker — new subscribers will no longer receive a stale delta.
 */
export async function clearShadowDelta(serial: string): Promise<boolean> {
  return mqttPublish(topicShadowDelta(serial), "", { qos: 1, retain: true });
}

/**
 * Upsert desired state in screen_shadows via Supabase admin client,
 * then publish the resulting delta (or clear if already synced).
 *
 * Call this after every server-side state change so the device gets pushed
 * the diff even when it reconnects later.
 */
export async function pushDesiredState(
  admin:    { from: (t: string) => any },  // SupabaseClient (service role)
  serial:   string,
  desired:  Record<string, unknown>,
): Promise<void> {
  // Upsert desired; the DB trigger auto-computes delta + synced_at
  const { data: shadow, error } = await admin
    .from("screen_shadows")
    .upsert({ screen_id: serial, desired }, { onConflict: "screen_id" })
    .select("delta, synced_at")
    .maybeSingle();

  if (error) {
    console.error("[shadow] upsert error:", error.message);
    return;
  }

  const delta = shadow?.delta ?? {};

  if (Object.keys(delta).length === 0) {
    // Already in sync — clear any stale retain on the broker
    await clearShadowDelta(serial);
  } else {
    // Push delta so the device gets it on its next subscribe
    await publishShadowDelta(serial, desired, delta);
  }
}
