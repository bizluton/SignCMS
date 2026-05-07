/**
 * MQTT helpers for self-hosted Mosquitto broker.
 *
 * Topics follow the existing SignPlayer protocol:
 *   signage/player/{serial}/heartbeat  — device → server (QoS 0, 15 s)
 *   signage/player/{serial}/command    — server → device (QoS 0)
 *   signage/player/{serial}/response   — device → server (QoS 0)
 *
 * Command payload (server → device):
 *   { ts, cls, cmd, data, cid }
 *
 * Publishing from Edge Functions uses an ephemeral WebSocket MQTT connection
 * (connect → publish → disconnect) since Edge Functions are stateless.
 *
 * Required environment variables:
 *   MQTT_BROKER_WS        — WebSocket URL given to players, e.g. wss://mqtt.example.com:8883
 *   MQTT_BROKER_WS_SERVER — WebSocket URL for server-side publishing (may differ from player URL)
 *                           Falls back to MQTT_BROKER_WS if not set.
 *   MQTT_SERVER_USER      — Server publisher username (e.g. "signcms-server")
 *   MQTT_SERVER_PASS      — Server publisher password
 */

// deno-lint-ignore-file no-explicit-any
import mqtt from "npm:mqtt@5.10.1";

/** wss:// URL returned to players so they know where to connect */
export const BROKER_WS: string = Deno.env.get("MQTT_BROKER_WS") ?? "";

const SERVER_BROKER = Deno.env.get("MQTT_BROKER_WS_SERVER") || BROKER_WS;
const SERVER_USER   = Deno.env.get("MQTT_SERVER_USER")      ?? "";
const SERVER_PASS   = Deno.env.get("MQTT_SERVER_PASS")      ?? "";

// ── Topic builders ────────────────────────────────────────────────────────

export const topicCommand   = (serial: string) => `signage/player/${serial}/command`;
export const topicHeartbeat = (serial: string) => `signage/player/${serial}/heartbeat`;
export const topicResponse  = (serial: string) => `signage/player/${serial}/response`;

// ── Low-level publish ─────────────────────────────────────────────────────

/**
 * Publish a message via an ephemeral Mosquitto connection.
 * Returns true on success; false when MQTT is not configured or fails.
 */
export async function mqttPublish(
  topic:   string,
  payload: unknown,
  qos:     0 | 1 | 2 = 0,
): Promise<boolean> {
  if (!SERVER_BROKER || !SERVER_USER) return false;

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => { if (!settled) { settled = true; resolve(ok); } };

    // Safety timeout — don't hang the Edge Function
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
      reconnectPeriod: 0,   // no auto-reconnect for ephemeral publisher
    });

    client.on("connect", () => {
      client.publish(
        topic,
        JSON.stringify(payload),
        { qos, retain: false },
        (err: Error | null) => {
          clearTimeout(timer);
          client.end(false, {}, () => finish(!err));
          if (err) console.error("[mqtt] publish err:", err.message);
        },
      );
    });

    client.on("error", (err: Error) => {
      console.error("[mqtt] connect error:", err.message);
      clearTimeout(timer);
      try { client.end(true); } catch (_) {}
      finish(false);
    });
  });
}

// ── High-level helpers ────────────────────────────────────────────────────

/**
 * Send a structured command to a specific screen.
 *
 * @param serial   Device serial / screen_id used as MQTT client identity
 * @param cls      Command class, e.g. "content", "screen", "app"
 * @param cmd      Command name, e.g. "sync", "reload", "switch_channel"
 * @param data     Optional payload data
 */
export async function screenCmd(
  serial: string,
  cls:    string,
  cmd:    string,
  data:   Record<string, unknown> = {},
): Promise<boolean> {
  const payload = {
    ts:  Math.floor(Date.now() / 1_000),
    cls,
    cmd,
    data,
    cid: crypto.randomUUID(),
  };
  return mqttPublish(topicCommand(serial), payload, 0);
}

/**
 * Tell a list of screens to re-sync content immediately.
 * Each screenId is used directly as the MQTT serial (topic identifier).
 *
 * @param _orgId    Kept for API compatibility; not used in Mosquitto topics.
 * @param screenIds List of screen UUIDs (used as serials in topics).
 */
export async function notifySync(
  _orgId:    string,
  screenIds: string[],
): Promise<void> {
  await Promise.all(
    screenIds.map((sid) => screenCmd(sid, "content", "sync")),
  );
}

/**
 * Send an arbitrary command to a list of screens.
 *
 * @param _orgId    Kept for API compatibility.
 * @param screenIds Screens to notify.
 * @param cls       Command class.
 * @param cmd       Command name.
 * @param data      Command data payload.
 */
export async function orgBroadcast(
  _orgId:    string,
  screenIds: string[],
  cls:       string,
  cmd:       string,
  data:      Record<string, unknown> = {},
): Promise<void> {
  await Promise.all(
    screenIds.map((sid) => screenCmd(sid, cls, cmd, data)),
  );
}
