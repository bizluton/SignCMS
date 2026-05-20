#!/usr/bin/env node
// heartbeat-collector — MQTT subscriber that funnels player heartbeats
// into a single Supabase bulk update per flush window.
//
// Architecture (see docs/runbooks/player-sync-scaling.md §"MQTT-based heartbeat"):
//
//   Player publishes (every 60s, retained, QoS 0) →
//     signage/player/{screenId}/heartbeat  payload: { ts, disk_status? }
//   This service subscribes to signage/player/+/heartbeat,
//   buffers messages in memory,
//   flushes every FLUSH_INTERVAL_MS (default 30s) via Supabase RPC
//     update_screen_heartbeats(jsonb)
//
// Designed to run as a single instance on the same VM as the broker.
// For 10k devices that's ~167 msg/s in, 2 RPC calls/min out — trivial.
//
// Env vars (all required unless marked):
//   MQTT_URL              e.g. mqtts://mqtt.signcms.net:18884
//   MQTT_USERNAME         the signcms-server account (superuser in mqtt-auth)
//   MQTT_PASSWORD         MQTT_SERVER_PASS value (must match supabase env)
//   MQTT_CA_FILE          optional, path to CA cert if self-signed
//   MQTT_INSECURE         optional, "true" to skip TLS verification (dev only)
//   SUPABASE_URL          e.g. https://<project>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY
//   FLUSH_INTERVAL_MS     optional, default 30000
//   MAX_BUFFER            optional, default 50000 (safety cap; force flush
//                          when buffer reaches this size)
//
// Exit codes:
//   0  clean shutdown (SIGTERM/SIGINT)
//   1  fatal initialization error (bad config / connect failure)
//   2  unrecoverable runtime error (Supabase auth lost, etc.)

import mqtt           from "mqtt";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = (k, fallback) => {
  const v = process.env[k];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    console.error(`[heartbeat-collector] missing env: ${k}`);
    process.exit(1);
  }
  return v;
};

const MQTT_URL                = env("MQTT_URL");
const MQTT_USERNAME           = env("MQTT_USERNAME");
const MQTT_PASSWORD           = env("MQTT_PASSWORD");
const MQTT_CA_FILE            = process.env.MQTT_CA_FILE;
const MQTT_INSECURE           = process.env.MQTT_INSECURE === "true";
const SUPABASE_URL            = env("SUPABASE_URL");
const SUPABASE_SERVICE_KEY    = env("SUPABASE_SERVICE_ROLE_KEY");
const FLUSH_INTERVAL_MS       = parseInt(env("FLUSH_INTERVAL_MS", "30000"));
const MAX_BUFFER              = parseInt(env("MAX_BUFFER",        "50000"));

// UUIDv4-ish regex; the topic segment must look like a screen UUID.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Supabase client ─────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── In-memory buffer ────────────────────────────────────────────────────────
// Latest-wins per screen_id (a player may publish multiple heartbeats in a
// flush window; we only need the most recent for last_ping_at).
const buffer = new Map();   // screenId → { screen_id, ts, disk_status? }

function bufferHeartbeat(screenId, payload) {
  if (!UUID_RE.test(screenId)) return;
  // payload comes from MQTT publish body — JSON or plain.
  let parsed = null;
  if (payload?.length > 0) {
    try { parsed = JSON.parse(payload.toString("utf8")); }
    catch { /* allow empty / non-JSON heartbeats — just timestamp */ }
  }

  const entry = {
    screen_id: screenId,
    ts:        parsed?.ts && typeof parsed.ts === "string" ? parsed.ts : new Date().toISOString(),
  };
  if (parsed?.disk_status && typeof parsed.disk_status === "object") {
    entry.disk_status = parsed.disk_status;
  }
  buffer.set(screenId, entry);

  // Safety cap: if a misconfigured player floods us, force a flush.
  if (buffer.size >= MAX_BUFFER) {
    console.warn(`[heartbeat-collector] buffer hit MAX_BUFFER=${MAX_BUFFER}, forcing flush`);
    void flush();
  }
}

// ── Flush logic ─────────────────────────────────────────────────────────────
let flushing = false;
async function flush() {
  if (flushing) return;
  if (buffer.size === 0) return;
  flushing = true;

  // Snapshot + clear so concurrent inserts during the RPC don't get lost.
  const batch = Array.from(buffer.values());
  buffer.clear();

  const t0 = Date.now();
  try {
    const { data, error } = await supabase.rpc("update_screen_heartbeats", {
      p_heartbeats: batch,
    });
    if (error) {
      console.error(`[heartbeat-collector] RPC error after ${Date.now()-t0}ms`, error);
      // Re-buffer so we retry on next flush. Mind ordering: don't overwrite
      // newer heartbeats that arrived during the RPC.
      for (const h of batch) if (!buffer.has(h.screen_id)) buffer.set(h.screen_id, h);
    } else {
      console.log(`[heartbeat-collector] flushed ${batch.length} heartbeats, ${data} rows updated in ${Date.now()-t0}ms`);
    }
  } catch (e) {
    console.error(`[heartbeat-collector] flush exception`, e);
    for (const h of batch) if (!buffer.has(h.screen_id)) buffer.set(h.screen_id, h);
  } finally {
    flushing = false;
  }
}

// ── MQTT client ─────────────────────────────────────────────────────────────
const mqttOpts = {
  username:    MQTT_USERNAME,
  password:    MQTT_PASSWORD,
  keepalive:   60,
  reconnectPeriod: 5_000,
  connectTimeout:  30_000,
  clean:       true,
  clientId:    `signcms-heartbeat-collector-${Math.random().toString(36).slice(2, 10)}`,
};
if (MQTT_CA_FILE) {
  mqttOpts.ca = readFileSync(MQTT_CA_FILE);
}
if (MQTT_INSECURE) {
  mqttOpts.rejectUnauthorized = false;
}

console.log(`[heartbeat-collector] connecting to ${MQTT_URL} as ${MQTT_USERNAME}…`);
const client = mqtt.connect(MQTT_URL, mqttOpts);

client.on("connect", () => {
  console.log(`[heartbeat-collector] MQTT connected`);
  client.subscribe("signage/player/+/heartbeat", { qos: 0 }, (err) => {
    if (err) {
      console.error(`[heartbeat-collector] subscribe failed`, err);
      process.exit(1);
    }
    console.log(`[heartbeat-collector] subscribed to signage/player/+/heartbeat`);
  });
});

client.on("message", (topic, payload) => {
  // topic shape: signage/player/{screenId}/heartbeat
  const parts = topic.split("/");
  if (parts.length !== 4) return;
  const screenId = parts[2];
  bufferHeartbeat(screenId, payload);
});

client.on("reconnect", () => console.warn(`[heartbeat-collector] MQTT reconnecting…`));
client.on("close",     () => console.warn(`[heartbeat-collector] MQTT connection closed`));
client.on("error",     (err) => console.error(`[heartbeat-collector] MQTT error`, err));

// ── Periodic flush ──────────────────────────────────────────────────────────
const flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
console.log(`[heartbeat-collector] flush every ${FLUSH_INTERVAL_MS}ms`);

// ── Graceful shutdown ───────────────────────────────────────────────────────
async function shutdown(sig) {
  console.log(`[heartbeat-collector] received ${sig}, flushing & disconnecting…`);
  clearInterval(flushTimer);
  await flush();
  client.end(false, {}, () => {
    console.log(`[heartbeat-collector] done`);
    process.exit(0);
  });
  // Hard exit if mqtt.end() hangs
  setTimeout(() => process.exit(0), 5_000);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
