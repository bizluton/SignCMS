'use strict';
const WebSocket = require('ws');

class RealtimeManager {
  constructor() {
    this._ws              = null;
    this._url             = null;
    this._channelTopic    = null;
    this._onCommand       = null;  // (event, payload) => void
    this._onStatus        = null;  // (connected) => void
    this._reconnectTimer  = null;
    this._heartbeatTimer  = null;
    this._ref             = 0;
    this._connected       = false;
  }

  // supabaseUrl: https://xxx.supabase.co
  // channel: "screen:<screenId>"  (returned by player-sync as realtime.channel)
  configure({ supabaseUrl, apikey, channel, onCommand, onStatus }) {
    this._channelTopic = channel;
    this._onCommand    = onCommand;
    this._onStatus     = onStatus;
    this._url = supabaseUrl
      .replace(/^https/, 'wss')
      .replace(/^http/,  'ws')
      .replace(/\/$/, '') + `/realtime/v1/websocket?apikey=${apikey}&vsn=1.0.0`;
    this._connect();
  }

  disconnect() {
    clearTimeout(this._reconnectTimer);
    clearInterval(this._heartbeatTimer);
    this._ws?.removeAllListeners();
    try { this._ws?.close(); } catch {}
    this._ws = null;
    this._connected = false;
  }

  _connect() {
    this.disconnect();

    try {
      this._ws = new WebSocket(this._url);

      this._ws.on('open', () => {
        console.log('[Realtime] connected, joining', this._channelTopic);
        this._send('1', String(++this._ref), `realtime:${this._channelTopic}`, 'phx_join', {});

        // Heartbeat every 30 s
        this._heartbeatTimer = setInterval(() => {
          if (this._ws?.readyState === WebSocket.OPEN)
            this._send(null, String(++this._ref), 'phoenix', 'heartbeat', {});
        }, 30_000);
      });

      this._ws.on('message', (raw) => {
        try {
          const [, , topic, event, payload] = JSON.parse(raw.toString());
          if (event === 'phx_reply' && payload?.status === 'ok') {
            this._connected = true;
            this._onStatus?.(true);
            console.log('[Realtime] joined', topic);
          } else if (event === 'broadcast') {
            this._onCommand?.(payload?.event, payload?.payload ?? {});
          }
        } catch {}
      });

      this._ws.on('close', () => {
        this._connected = false;
        this._onStatus?.(false);
        console.log('[Realtime] disconnected — retry in 5 s');
        clearInterval(this._heartbeatTimer);
        this._reconnectTimer = setTimeout(() => this._connect(), 5_000);
      });

      this._ws.on('error', (e) => {
        console.warn('[Realtime] error:', e.message);
      });

    } catch (e) {
      this._reconnectTimer = setTimeout(() => this._connect(), 5_000);
    }
  }

  _send(joinRef, ref, topic, event, payload) {
    if (this._ws?.readyState === WebSocket.OPEN)
      this._ws.send(JSON.stringify([joinRef, ref, topic, event, payload]));
  }

  get connected() { return this._connected; }
}

module.exports = RealtimeManager;
