/**
 * SignCMS Player — Preload (IPC Bridge)
 * Exposes safe Node.js APIs to the renderer via contextBridge.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("player", {
  // ── Config ──────────────────────────────────────────────────────────────
  getConfig:       ()       => ipcRenderer.invoke("get-config"),
  saveConfig:      (cfg)    => ipcRenderer.invoke("save-config", cfg),
  getVersion:      ()       => ipcRenderer.invoke("get-version"),

  // ── Playback ─────────────────────────────────────────────────────────────
  forceSync:       ()       => ipcRenderer.invoke("force-sync"),
  addLog:          (entry)  => ipcRenderer.invoke("add-log", entry),

  // ── Window ───────────────────────────────────────────────────────────────
  toggleFullscreen: ()      => ipcRenderer.invoke("toggle-fullscreen"),
  openExternal:    (url)    => ipcRenderer.invoke("open-external", url),

  // ── Media disk cache ─────────────────────────────────────────────────────
  /**
   * Check in-memory index for a cached URL (very fast, synchronous under the hood).
   * Returns "file://..." string if cached, null if not.
   */
  getCachedUrl:    (url)    => ipcRenderer.invoke("cache-get", url),

  /**
   * Pre-warm the disk cache for a list of URLs.
   * Downloads missing files in the background (up to 3 concurrent).
   * Resolves with { [originalUrl]: "file://..." } for all cached files.
   */
  prewarmCache:    (urls)   => ipcRenderer.invoke("cache-prewarm", urls),

  /** Returns { count, totalSize, maxSize, cacheDir } */
  getCacheStats:   ()       => ipcRenderer.invoke("cache-stats"),

  // ── Events: main → renderer ───────────────────────────────────────────────
  onSyncData:      (cb) => { ipcRenderer.on("sync-data",      (_e, d) => cb(d)); },
  onSyncError:     (cb) => { ipcRenderer.on("sync-error",     (_e, d) => cb(d)); },
  onShowSettings:  (cb) => { ipcRenderer.on("show-settings",  ()      => cb()); },
  onToggleHud:     (cb) => { ipcRenderer.on("toggle-hud",     ()      => cb()); },
  onConfigSaved:   (cb) => { ipcRenderer.on("config-saved",   ()      => cb()); },
  /** MQTT command from server: { ts, cls, cmd, data, cid } */
  onMqttCmd:       (cb) => { ipcRenderer.on("mqtt-cmd",       (_e, d) => cb(d)); },
  /** MQTT shadow delta: { ts, desired, delta } */
  onShadowDelta:   (cb) => { ipcRenderer.on("shadow-delta",   (_e, d) => cb(d)); },
  /** MQTT connection status: { connected: bool, serial?: string } */
  onMqttStatus:    (cb) => { ipcRenderer.on("mqtt-status",    (_e, d) => cb(d)); },

  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});
