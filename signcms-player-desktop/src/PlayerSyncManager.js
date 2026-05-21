'use strict';
const https = require('https');
const http  = require('http');

class PlayerSyncManager {
  constructor() {
    this._serverUrl       = null;
    this._deviceToken     = null;
    this._intervalMs      = 60_000;  // fixed 60 s tick; safety-net pattern decides per-tick
    this._lastSync        = null;
    this._logBatch        = [];
    this._diskFn          = null;  // () => diskStatus object | null
    this._onSync          = null;  // (response) => void
    this._onError         = null;  // (msg) => void
    this._timer           = null;
    this._shouldSkipSync  = null;  // () => boolean — true ⇒ skip this tick's HTTP sync
  }

  configure({ serverUrl, deviceToken, intervalMs = 60_000, onSync, onError, shouldSkipSync = null }) {
    this._serverUrl      = serverUrl.replace(/\/$/, '');
    this._deviceToken    = deviceToken;
    this._intervalMs     = intervalMs;
    this._onSync         = onSync;
    this._onError        = onError;
    this._shouldSkipSync = shouldSkipSync;
  }

  setDiskStatusProvider(fn) { this._diskFn = fn; }

  // Renderer calls window.player.addLog → IPC → here
  addLog(mediaId, durationSeconds) {
    const entry = { duration_seconds: durationSeconds || 0 };
    if (mediaId) entry.media_id = mediaId;
    this._logBatch.push(entry);
    if (this._logBatch.length > 200) this._logBatch.shift();
  }

  start() {
    this.stop();
    this._doSync();
    this._timer = setInterval(() => this._doSync(), this._intervalMs);
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  forceSync() { this._doSync(); }

  getLastSync() { return this._lastSync; }

  /** True if there are queued playback logs waiting to be flushed. */
  hasPendingLogs() { return this._logBatch.length > 0; }

  // Public wrapper used by the test-connection IPC handler
  post(url, body) { return this._post(url, body); }

  async _doSync() {
    if (!this._serverUrl || !this._deviceToken) return;

    // Safety-net skip: in steady state (MQTT heartbeat up + Realtime up
    // + no pending logs + not stale), the HTTP sync round-trip is
    // unnecessary. shouldSkipSync() encapsulates that decision in main.js.
    if (this._shouldSkipSync && this._shouldSkipSync()) return;

    const body = {};

    // ETag: skip zones blob when content unchanged
    if (this._lastSync?.project?.updated_at)
      body.project_etag = this._lastSync.project.updated_at;

    // CAS telemetry (fire-and-forget; never block sync on error)
    try { const ds = this._diskFn?.(); if (ds) body.disk_status = ds; } catch {}

    // Drain log batch
    if (this._logBatch.length > 0) {
      body.log_batch    = this._logBatch.splice(0);
    }

    try {
      const data = await this._post(`${this._serverUrl}/player-sync`, body);
      if (!data.ok) { this._onError?.(`server: ${data.error ?? 'ok=false'}`); return; }

      // ETag optimisation: restore cached zones when server skips them
      if (data.project?.zones_changed === false && this._lastSync?.project?.zones)
        data.project.zones = this._lastSync.project.zones;

      this._lastSync = data;
      this._onSync?.(data);
    } catch (e) {
      this._onError?.(e.message);
    }
  }

  _post(url, body) {
    return new Promise((resolve, reject) => {
      const raw    = JSON.stringify(body);
      const parsed = new URL(url);
      const proto  = parsed.protocol === 'https:' ? https : http;
      const opts   = {
        hostname: parsed.hostname,
        port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path:     parsed.pathname + parsed.search,
        method:   'POST',
        headers:  {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(raw),
          'x-device-token': this._deviceToken,
        },
        timeout: 20_000,
      };
      const req = proto.request(opts, (res) => {
        let buf = '';
        res.on('data', c => buf += c);
        res.on('end',  () => {
          try { resolve(JSON.parse(buf)); }
          catch { reject(new Error('invalid JSON from server')); }
        });
      });
      req.on('error',   reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('sync request timeout')); });
      req.write(raw);
      req.end();
    });
  }
}

module.exports = PlayerSyncManager;
