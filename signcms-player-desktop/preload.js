'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// ── window.player — matches the Android PlayerJsBridge surface ────────────────
contextBridge.exposeInMainWorld('player', {

  // ── Config (used by settings.html) ─────────────────────────────────────────
  getConfig:      ()    => ipcRenderer.invoke('get-config'),
  saveConfig:     (cfg) => ipcRenderer.invoke('save-config', cfg),
  isConfigured:   ()    => ipcRenderer.invoke('is-configured'),
  testConnection: (cfg) => ipcRenderer.invoke('test-connection', cfg),

  // ── CAS cache lookup ────────────────────────────────────────────────────────
  // Returns a  cas://<sha256>  URL if the file is on disk, otherwise null.
  getCachedUrl: (url) => ipcRenderer.invoke('get-cached-url', url),

  // ── Playback log ────────────────────────────────────────────────────────────
  // Only media_id + duration — matches Android contract (no media_name from renderer)
  addLog: (jsonStr) => {
    try {
      const e = JSON.parse(jsonStr);
      ipcRenderer.send('add-log', {
        mediaId:         e.media_id         ?? null,
        durationSeconds: e.duration_seconds ?? 0,
      });
    } catch {}
  },

  // ── Control ─────────────────────────────────────────────────────────────────
  forceSync:    () => ipcRenderer.send('force-sync'),
  openSettings: () => ipcRenderer.send('open-settings'),

  // ── Debug / testing ─────────────────────────────────────────────────────────
  getCacheStats:   () => ipcRenderer.invoke('get-cache-stats'),
  verifyIntegrity: () => ipcRenderer.invoke('verify-integrity'),
  openCasDir:      () => ipcRenderer.send('open-cas-dir'),
  restartPlayer:   () => ipcRenderer.send('restart-player'),

  getVersion: () => '1.0.0',
});

// ── Events pushed from main → renderer ───────────────────────────────────────
// Delivered as CustomEvents on window so renderer JS uses addEventListener.
function relay(ipcChannel, domEvent) {
  ipcRenderer.on(ipcChannel, (_e, payload) =>
    window.dispatchEvent(new CustomEvent(domEvent, { detail: payload }))
  );
}

relay('sync-data',         '__signSyncData');
relay('sync-error',        '__signSyncError');
relay('realtime-cmd',      '__signRealtimeCmd');
relay('realtime-status',   '__signRealtimeStatus');
relay('download-progress', '__signDownloadProgress');
relay('cas-ready',         '__signCasReady');
relay('verify-progress',   '__signVerifyProgress');
