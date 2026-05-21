'use strict';
/**
 * MqttManager — lightweight MQTT heartbeat publisher.
 *
 * Replaces the HTTP heartbeat path for steady-state pings. Each player opens
 * one TLS connection to the broker, then publishes a retained ~60-byte
 * message to `signage/player/{screenId}/heartbeat` every 60 s. The broker-
 * side `heartbeat-collector` sidecar subscribes, buffers, and bulk-updates
 * `screens.last_ping_at` via a single Supabase RPC every 30 s — at 10K
 * device scale this saves ~3000× the edge function invocations vs hitting
 * player-sync / player-heartbeat over HTTPS every minute.
 *
 * Auth (Phase A — shared user):
 *   username = config.mqttUser     (default: "signcms-player")
 *   password = config.mqttPassword (set per-player via settings UI)
 * Phase B (mosquitto-go-auth, per-device token) is gated on the broker-side
 * plugin debug task; the player code change to switch is one line.
 *
 * Lifecycle expectations:
 *   - configure() may be called multiple times; teardown + reconnect happens
 *     only when (screenId / brokerUrl / username / password) actually change.
 *   - start() is implicit inside configure() — no separate call needed.
 *   - stop() / disconnect() are safe to call on a not-running manager.
 */
const mqtt = require('mqtt');

class MqttManager {
  constructor() {
    this._client      = null;
    this._timer       = null;
    this._brokerUrl   = null;
    this._username    = null;
    this._password    = null;
    this._screenId    = null;
    this._onStatus    = null;   // (connected: boolean) => void
    this._lastKey     = null;   // (screenId|user|broker) — re-config if changed
  }

  /**
   * Configure (and connect if needed). Safe to call repeatedly; tears down
   * + reconnects only when any of (screenId, brokerUrl, username, password)
   * change.
   */
  configure({ brokerUrl, username, password, screenId, onStatus } = {}) {
    this._onStatus = onStatus ?? this._onStatus;

    if (!brokerUrl || !username || !password || !screenId) {
      // Missing config — disconnect any existing connection
      this.disconnect();
      return;
    }

    const key = `${screenId}|${username}|${brokerUrl}`;
    if (this._client && this._client.connected && key === this._lastKey) {
      return; // no-op, same connection still alive
    }

    this.disconnect();
    this._brokerUrl = brokerUrl;
    this._username  = username;
    this._password  = password;
    this._screenId  = screenId;
    this._lastKey   = key;

    console.log(`[MQTT] connecting to ${brokerUrl} as ${username}`);
    this._client = mqtt.connect(brokerUrl, {
      username,
      password,
      keepalive:          60,
      reconnectPeriod:    5_000,
      connectTimeout:     30_000,
      clean:              true,
      clientId:           `signcms-desktop-${screenId}-${Math.random().toString(36).slice(2, 8)}`,
      rejectUnauthorized: false,  // broker uses an internal self-signed-ish cert
    });

    this._client.on('connect',   () => {
      console.log(`[MQTT] connected — publishing to signage/player/${screenId}/heartbeat`);
      this._publishHeartbeat();
      this._startTimer();
      this._onStatus?.(true);
    });
    this._client.on('reconnect', () => console.warn('[MQTT] reconnecting…'));
    this._client.on('close',     () => {
      this._stopTimer();
      console.warn('[MQTT] connection closed');
      this._onStatus?.(false);
    });
    this._client.on('error',     (err) => console.error('[MQTT] error:', err.message));
  }

  disconnect() {
    this._stopTimer();
    if (this._client) {
      try { this._client.end(true); } catch {}
      this._client   = null;
      this._lastKey  = null;
      this._onStatus?.(false);
    }
  }

  _publishHeartbeat() {
    if (!this._client || !this._client.connected || !this._screenId) return;
    const topic   = `signage/player/${this._screenId}/heartbeat`;
    const payload = JSON.stringify({ ts: new Date().toISOString() });
    this._client.publish(topic, payload, { qos: 0, retain: true });
  }

  _startTimer() {
    this._stopTimer();
    this._timer = setInterval(() => this._publishHeartbeat(), 60_000);
  }

  _stopTimer() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  get connected() { return !!(this._client && this._client.connected); }
}

module.exports = MqttManager;
