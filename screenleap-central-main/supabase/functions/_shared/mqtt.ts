/**
 * SignCMS — Real-time push helpers (Supabase Realtime)
 *
 * ── Migration: MQTT → Supabase Realtime ──────────────────────────────────────
 * This module previously used a self-hosted Mosquitto broker.
 * It now uses the Supabase Realtime REST broadcast API so that no external
 * broker is needed.  All function signatures are unchanged so importing
 * Edge Functions require zero modifications.
 *
 * ── Architecture ─────────────────────────────────────────────────────────────
 * Server → Device  (commands / shadow delta):
 *   POST  /realtime/v1/api/broadcast   (service-role key, fire-and-forget)
 *   Topic: "screen:{screenId}"
 *   Event: "command"  |  "shadow_delta"
 *
 * Device → Server  (heartbeat / logs / shadow report):
 *   HTTP POST to player-sync / shadow-report Edge Functions (unchanged)
 *
 * Offline delivery:
 *   Commands   — device re-syncs via HTTP player-sync on next poll (30 s)
 *   Shadow     — persisted in screen_shadows; device reads it on player-sync
 *
 * ── Channel convention ────────────────────────────────────────────────────────
 *   Channel name: "screen:{screenId}"
 *   Supabase Realtime subscribes with anonKey; server broadcasts with service-role key.
 */

// ── Realtime REST broadcast ───────────────────────────────────────────────────

interface BroadcastMessage {
  topic:   string;
  event:   string;
  payload: unknown;
}

async function realtimeBroadcast(messages: BroadcastMessage[]): Promise<boolean> {
  if (messages.length === 0) return true;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!supabaseUrl || !serviceRole) {
    console.warn("[realtime] SUPABASE_URL or SERVICE_ROLE_KEY not set");
    return false;
  }

  try {
    const res = await fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${serviceRole}`,
        "apikey":        serviceRole,
      },
      body: JSON.stringify({ messages }),
    });
    if (!res.ok) {
      console.error("[realtime] broadcast HTTP", res.status, await res.text().catch(() => ""));
    }
    return res.ok;
  } catch (e) {
    console.error("[realtime] broadcast error:", e);
    return false;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const screenChannel = (screenId: string) => `screen:${screenId}`;

function makeCommand(
  cls:  string,
  cmd:  string,
  data: Record<string, unknown>,
) {
  return {
    ts:  Math.floor(Date.now() / 1_000),
    cls,
    cmd,
    data,
    cid: crypto.randomUUID(),
  };
}

// ── Public API (same signatures as the old MQTT module) ───────────────────────

/** @deprecated No longer needed — Realtime has no broker URL. Always "". */
export const BROKER_WS = "";

/**
 * Send a command to a single screen via Realtime broadcast.
 * Fire-and-forget; offline devices receive it on the next player-sync poll.
 */
export async function screenCmd(
  serial: string,
  cls:    string,
  cmd:    string,
  data:   Record<string, unknown> = {},
): Promise<boolean> {
  return realtimeBroadcast([{
    topic:   screenChannel(serial),
    event:   "command",
    payload: makeCommand(cls, cmd, data),
  }]);
}

/**
 * Notify a list of screens to re-sync content immediately.
 */
export async function notifySync(_orgId: string, screenIds: string[]): Promise<void> {
  if (screenIds.length === 0) return;
  await realtimeBroadcast(screenIds.map((sid) => ({
    topic:   screenChannel(sid),
    event:   "command",
    payload: makeCommand("content", "sync", {}),
  })));
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
  if (screenIds.length === 0) return;
  await realtimeBroadcast(screenIds.map((sid) => ({
    topic:   screenChannel(sid),
    event:   "command",
    payload: makeCommand(cls, cmd, data),
  })));
}

/**
 * Upsert desired state in screen_shadows and push shadow_delta broadcast
 * to the device if it is online.  Offline devices receive the delta via
 * player-sync HTTP on reconnect (screen_shadows is the persistent store).
 */
// deno-lint-ignore no-explicit-any
export async function pushDesiredState(
  admin:   { from: (t: string) => any },
  serial:  string,
  desired: Record<string, unknown>,
): Promise<void> {
  const { data: shadow, error } = await admin
    .from("screen_shadows")
    .upsert({ screen_id: serial, desired }, { onConflict: "screen_id" })
    .select("delta, synced_at")
    .maybeSingle();

  if (error) {
    console.error("[shadow] upsert error:", error.message);
    return;
  }

  const delta = (shadow?.delta ?? {}) as Record<string, unknown>;
  if (Object.keys(delta).length === 0) return;  // already in sync

  // Push delta via Realtime to the device if it is currently connected.
  // No retain needed: the delta is persisted in screen_shadows.
  await realtimeBroadcast([{
    topic:   screenChannel(serial),
    event:   "shadow_delta",
    payload: { ts: Math.floor(Date.now() / 1_000), desired, delta },
  }]);
}

/**
 * Legacy: publish shadow delta via Realtime broadcast.
 * @deprecated Call pushDesiredState() instead; this is kept for shadow-report compatibility.
 */
export async function publishShadowDelta(
  serial:  string,
  desired: Record<string, unknown>,
  delta:   Record<string, unknown>,
): Promise<boolean> {
  if (Object.keys(delta).length === 0) return true;
  return realtimeBroadcast([{
    topic:   screenChannel(serial),
    event:   "shadow_delta",
    payload: { ts: Math.floor(Date.now() / 1_000), desired, delta },
  }]);
}

/**
 * Legacy: MQTT had a retained "clear" message; Realtime has no retain.
 * The screen_shadows delta is cleared by the DB trigger when desired==reported,
 * so this is a no-op.
 */
export async function clearShadowDelta(_serial: string): Promise<boolean> {
  return true;  // no-op: DB handles delta clearing
}

/**
 * Legacy: generic MQTT publish shim.
 * Extracts screenId from old MQTT topic pattern and re-routes to Realtime.
 * @deprecated Use screenCmd() or pushDesiredState() instead.
 */
export async function mqttPublish(
  topic:   string,
  payload: unknown,
  _opts:   { qos?: number; retain?: boolean } = {},
): Promise<boolean> {
  const m = topic.match(/signage\/player\/([^/]+)\//);
  if (!m) return false;
  const serial = m[1];
  const event  = topic.includes("/shadow/delta") ? "shadow_delta" : "command";
  return realtimeBroadcast([{ topic: screenChannel(serial), event, payload }]);
}

// ── Legacy topic builders (no longer used — kept for import compat) ───────────
export const topicCommand     = (_s: string) => "";
export const topicHeartbeat   = (_s: string) => "";
export const topicResponse    = (_s: string) => "";
export const topicStatus      = (_s: string) => "";
export const topicShadowDelta = (_s: string) => "";
