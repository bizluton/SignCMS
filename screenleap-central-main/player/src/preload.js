/**
 * SignCMS Player — Preload (IPC Bridge)
 * Exposes safe Node.js APIs to the renderer via contextBridge.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("player", {
  // Config
  getConfig:       ()       => ipcRenderer.invoke("get-config"),
  saveConfig:      (cfg)    => ipcRenderer.invoke("save-config", cfg),
  getVersion:      ()       => ipcRenderer.invoke("get-version"),

  // Playback
  forceSync:       ()       => ipcRenderer.invoke("force-sync"),
  addLog:          (entry)  => ipcRenderer.invoke("add-log", entry),

  // Window
  toggleFullscreen: ()      => ipcRenderer.invoke("toggle-fullscreen"),
  openExternal:    (url)    => ipcRenderer.invoke("open-external", url),

  // Events from main → renderer
  onSyncData:      (cb) => { ipcRenderer.on("sync-data",      (_e, d) => cb(d)); },
  onSyncError:     (cb) => { ipcRenderer.on("sync-error",     (_e, d) => cb(d)); },
  onShowSettings:  (cb) => { ipcRenderer.on("show-settings",  ()      => cb()); },
  onToggleHud:     (cb) => { ipcRenderer.on("toggle-hud",     ()      => cb()); },
  onConfigSaved:   (cb) => { ipcRenderer.on("config-saved",   ()      => cb()); },

  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});
