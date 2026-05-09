/**
 * SignCMS Player — Electron Main Process
 * Handles: window, tray, config, heartbeat, IPC, Realtime, media disk cache
 */
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage,
        globalShortcut, dialog, shell, session } = require("electron");
const path       = require("path");
const https      = require("https");
const http       = require("http");
const fs         = require("fs");
const WebSocket  = require("ws");
const mediaCache = require("./media-cache");

// ── Chromium HTTP disk cache (persists across restarts) ───────────────────────
// Must be set before app.whenReady() / before BrowserWindow creation.
// 200 MB for widget HTML, fonts, scripts (managed by Chromium internally).
app.commandLine.appendSwitch("disk-cache-dir",
  path.join(app.getPath("userData"), "net-cache"),
);
app.commandLine.appendSwitch("disk-cache-size", String(200 * 1024 * 1024));

// ─── Config ────────────────────────────────────────────────────────────────
const CONFIG_PATH = path.join(app.getPath("userData"), "config.json");
const DEFAULT_CFG = {
  supabaseUrl:   "https://narhbpojjtnalyfiwxue.supabase.co",
  anonKey:       "",
  deviceToken:   "",
  syncInterval:  30,   // seconds
  kiosk:         false,
  devMode:       false,
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return { ...DEFAULT_CFG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) };
    }
  } catch (e) { console.error("Config load error:", e); }
  return { ...DEFAULT_CFG };
}

function saveConfig(cfg) {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
  } catch (e) { console.error("Config save error:", e); }
}

let config = loadConfig();

// ─── Globals ───────────────────────────────────────────────────────────────
let win          = null;
let tray         = null;
let syncTimer    = null;
let lastSync     = null;       // last successful API response
let isDev        = process.argv.includes("--dev");

// ─── Supabase Realtime state ──────────────────────────────────────────────
// Phoenix channels protocol over WebSocket.
// Topic: "realtime:screen:{screenId}"
// Receives events: "command", "shadow_delta"
let realtimeWs        = null;
let realtimeConnected = false;
let realtimeHeartbeat = null;   // setInterval for Phoenix heartbeats (30s)
let realtimeSerial    = null;   // screenId from player-sync
let realtimeChannel   = null;   // e.g. "screen:{screenId}"
let realtimeApiKey    = null;   // Supabase anon key for WS auth
let realtimeRef       = 0;      // incrementing Phoenix message ref counter
let realtimeReconnect = null;   // reconnect timer

// ─── HTTP helper (no external deps) ────────────────────────────────────────
function httpPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const parsed   = new URL(url);
    const mod      = parsed.protocol === "https:" ? https : http;
    const data     = JSON.stringify(body);
    const req      = mod.request({
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   "POST",
      headers:  { ...headers, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
    }, (res) => {
      let raw = "";
      res.on("data", (c) => raw += c);
      res.on("end",  () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ─── player-sync API call ──────────────────────────────────────────────────
async function playerSync(logBatch = []) {
  const cfg = loadConfig();
  if (!cfg.deviceToken || !cfg.supabaseUrl) return null;
  const url = `${cfg.supabaseUrl.replace(/\/$/, "")}/functions/v1/player-sync`;
  try {
    const res = await httpPost(url, {
      "x-device-token": cfg.deviceToken,
      "apikey":         cfg.anonKey,
    }, {
      log_batch:    logBatch,
      // Send last-known project timestamp so server can skip zones when unchanged
      project_etag: lastSync?.project?.updated_at ?? null,
    });
    if (res.status === 200 && res.body?.ok) return res.body;
    console.warn("player-sync error:", res.status, res.body);
    return null;
  } catch (e) {
    console.error("player-sync fetch failed:", e.message);
    return null;
  }
}

// ─── Supabase Realtime client (Phoenix channels over WebSocket) ───────────
//
// Architecture:
//   WebSocket URL:  wss://{project}.supabase.co/realtime/v1/websocket?apikey=…&vsn=1.0.0
//   Channel topic:  "realtime:screen:{screenId}"
//   Server → device: event "broadcast" with payload.event = "command" | "shadow_delta"
//
// Phoenix wire format (array):
//   [join_ref, ref, topic, event, payload]
//
// Offline resilience:
//   Commands   — device re-syncs via HTTP player-sync on next poll (30 s)
//   Shadow     — persisted in screen_shadows; device reads it on player-sync

/**
 * Connect (or reconnect) to Supabase Realtime.
 * Safe to call multiple times — tears down the previous socket first.
 *
 * @param {{ channel: string, apikey: string }} realtimeCfg  from player-sync response
 */
function connectRealtime(realtimeCfg) {
  if (!realtimeCfg?.channel || !realtimeCfg?.apikey) return;

  const serial = realtimeCfg.channel.replace(/^screen:/, "");

  // Already connected to same channel → skip
  if (realtimeWs && realtimeConnected && realtimeSerial === serial) return;

  disconnectRealtime();

  realtimeSerial  = serial;
  realtimeChannel = realtimeCfg.channel;
  realtimeApiKey  = realtimeCfg.apikey;

  const cfg    = loadConfig();
  const wsBase = (cfg.supabaseUrl ?? "https://narhbpojjtnalyfiwxue.supabase.co")
    .replace(/\/$/, "")
    .replace(/^https:\/\//i, "wss://")
    .replace(/^http:\/\//i, "ws://");
  const wsUrl  = `${wsBase}/realtime/v1/websocket?apikey=${encodeURIComponent(realtimeCfg.apikey)}&vsn=1.0.0`;

  console.log("[Realtime] connecting to", wsBase, "channel:", realtimeCfg.channel);

  realtimeWs = new WebSocket(wsUrl);

  realtimeWs.on("open", () => {
    console.log("[Realtime] socket open — joining realtime:" + realtimeCfg.channel);
    realtimeConnected = true;

    // Join the channel (Phoenix phx_join)
    realtimeRef++;
    realtimeWs.send(JSON.stringify([
      "1",                                          // join_ref
      String(realtimeRef),                          // ref
      `realtime:${realtimeCfg.channel}`,            // topic
      "phx_join",                                   // event
      { config: { broadcast: { self: false }, presence: { key: "" } } },
    ]));

    // Phoenix heartbeat every 30 s (keeps the socket alive)
    startRealtimeHeartbeat();

    // Switch polling to slow fallback (5 min) while Realtime is alive
    restartSyncLoop(300);

    win?.webContents.send("mqtt-status", { connected: true, serial });
  });

  realtimeWs.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); }
    catch { return; }

    // Phoenix array: [join_ref, ref, topic, event, payload]
    const [, , , event, payload] = msg;

    if (event === "phx_reply") return;   // join/heartbeat ack — ignore

    if (event === "broadcast" && payload?.type === "broadcast") {
      const innerEvent   = payload.event;
      const innerPayload = payload.payload ?? {};
      if (innerEvent === "command") {
        handleRealtimeCommand(innerPayload);
      } else if (innerEvent === "shadow_delta") {
        handleShadowDelta(innerPayload);
      }
    }
  });

  realtimeWs.on("close", (code) => {
    console.log("[Realtime] disconnected, code:", code);
    realtimeConnected = false;
    stopRealtimeHeartbeat();
    restartSyncLoop(config.syncInterval ?? 30);
    win?.webContents.send("mqtt-status", { connected: false });

    // Auto-reconnect after 5 s (mirrors old MQTT reconnectPeriod)
    if (realtimeChannel && realtimeApiKey) {
      if (realtimeReconnect) clearTimeout(realtimeReconnect);
      realtimeReconnect = setTimeout(() => {
        realtimeReconnect = null;
        connectRealtime({ channel: realtimeChannel, apikey: realtimeApiKey });
      }, 5_000);
    }
  });

  realtimeWs.on("error", (err) => {
    console.error("[Realtime] error:", err.message);
  });
}

function disconnectRealtime() {
  stopRealtimeHeartbeat();
  if (realtimeReconnect) { clearTimeout(realtimeReconnect); realtimeReconnect = null; }
  if (realtimeWs) {
    try { realtimeWs.terminate(); } catch (_) {}
    realtimeWs        = null;
    realtimeConnected = false;
    realtimeSerial    = null;
  }
}

function startRealtimeHeartbeat() {
  stopRealtimeHeartbeat();
  realtimeHeartbeat = setInterval(() => {
    if (!realtimeWs || realtimeWs.readyState !== WebSocket.OPEN) return;
    realtimeRef++;
    realtimeWs.send(JSON.stringify([null, String(realtimeRef), "phoenix", "heartbeat", {}]));
  }, 30_000);
}

function stopRealtimeHeartbeat() {
  if (realtimeHeartbeat) { clearInterval(realtimeHeartbeat); realtimeHeartbeat = null; }
}

/**
 * Handle a shadow/delta message from the server.
 * Payload: { ts, desired: {...}, delta: {...} }
 */
function handleShadowDelta(msg) {
  if (!msg?.delta || Object.keys(msg.delta).length === 0) return;
  console.log("[Shadow] delta received:", JSON.stringify(msg.delta));

  // Forward to renderer for any UI updates
  win?.webContents.send("shadow-delta", msg);

  // Re-sync to pick up the new channel/project from the DB
  doSync();

  // Report new state after a short delay (let doSync complete)
  setTimeout(() => postShadowReport(msg.desired ?? {}), 3_000);
}

/**
 * HTTP POST to the shadow-report Edge Function so the server knows
 * the device has applied the desired state.
 */
async function postShadowReport(desired) {
  const cfg = loadConfig();
  if (!cfg.deviceToken || !cfg.supabaseUrl) return;

  const channelId = lastSync?.channel?.id ?? desired?.channel_id ?? null;
  const reported  = {
    channel_id: channelId,
    status:     lastSync ? "playing" : "idle",
    version:    app.getVersion(),
  };

  const url = `${cfg.supabaseUrl.replace(/\/$/, "")}/functions/v1/shadow-report`;
  try {
    await httpPost(url, {
      "x-device-token": cfg.deviceToken,
      "apikey":         cfg.anonKey,
    }, { reported });
    console.log("[Shadow] reported state:", JSON.stringify(reported));
  } catch (e) {
    console.error("[Shadow] report failed:", e.message);
  }
}

/**
 * Handle an inbound command from the server.
 * Payload format: { ts, cls, cmd, data, cid }
 *
 * cls: "content" — playlist / channel commands
 *   cmd: "sync"           → immediate re-sync
 *   cmd: "switch_channel" → update channel, sync
 * cls: "screen" — display commands
 *   cmd: "reload"         → reload renderer
 * cls: "app"   — application commands (forwarded to renderer)
 */
function handleRealtimeCommand(msg) {
  console.log("[Realtime] command", msg?.cls, msg?.cmd);
  const { cls, cmd } = msg ?? {};

  if (cls === "content") {
    switch (cmd) {
      case "sync":
        doSync();
        break;
      case "switch_channel":
      case "emergency_broadcast":
      case "restore":
        win?.webContents.send("mqtt-cmd", msg);
        doSync();
        break;
      default:
        win?.webContents.send("mqtt-cmd", msg);
    }
  } else if (cls === "screen") {
    switch (cmd) {
      case "reload":
        setTimeout(() => win?.webContents.reload(), 500);
        break;
      case "fullscreen":
        win?.setFullScreen(!win?.isFullScreen());
        break;
      default:
        win?.webContents.send("mqtt-cmd", msg);
    }
  } else {
    // Forward all other classes to renderer
    win?.webContents.send("mqtt-cmd", msg);
  }
}

// ─── Window ───────────────────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width:           1280,
    height:          720,
    minWidth:        640,
    minHeight:       360,
    fullscreen:      config.kiosk,
    kiosk:           config.kiosk,
    backgroundColor: "#000000",
    titleBarStyle:   "hiddenInset",
    autoHideMenuBar: true,
    webPreferences: {
      preload:             path.join(__dirname, "preload.js"),
      contextIsolation:    true,
      nodeIntegration:     false,
      webSecurity:         false,   // allow cross-origin media
      allowRunningInsecureContent: false,
    },
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"));

  if (isDev) win.webContents.openDevTools({ mode: "detach" });

  win.on("closed", () => { win = null; });

  // Prevent navigation away from app
  win.webContents.on("will-navigate", (e, url) => {
    const fileUrl = `file://`;
    if (!url.startsWith(fileUrl)) { e.preventDefault(); shell.openExternal(url); }
  });
}

// ─── Tray ─────────────────────────────────────────────────────────────────
function createTray() {
  try {
    const iconPath = path.join(__dirname, "..", "assets", "tray.png");
    const icon = fs.existsSync(iconPath)
      ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
      : nativeImage.createEmpty();
    tray = new Tray(icon);
    updateTrayMenu();
  } catch (e) { console.warn("Tray error:", e.message); }
}

function updateTrayMenu() {
  if (!tray) return;
  const cfg    = loadConfig();
  const status = lastSync ? `✅ ${lastSync.screen?.name ?? "Connected"}` : "⚠️  Not connected";
  const menu   = Menu.buildFromTemplate([
    { label: "SignCMS Player",  enabled: false },
    { label: status,            enabled: false },
    { type: "separator" },
    { label: "Show Window",     click: () => { win?.show(); win?.focus(); } },
    { label: "Settings",        click: () => win?.webContents.send("show-settings") },
    { type: "separator" },
    { label: cfg.kiosk ? "Exit Kiosk Mode" : "Enter Kiosk Mode",
      click: () => { cfg.kiosk = !cfg.kiosk; saveConfig(cfg); app.relaunch(); app.exit(0); } },
    { type: "separator" },
    { label: "Open Config File", click: () => shell.openPath(CONFIG_PATH) },
    { type: "separator" },
    { label: "Quit",            click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(`SignCMS Player — ${status}`);
}

// ─── Sync loop ────────────────────────────────────────────────────────────

/**
 * Start or restart the polling loop with a given interval (seconds).
 * When Realtime is connected we use a long fallback (300s); when not, the
 * user-configured value (default 30s).
 */
function startSyncLoop(intervalSeconds) {
  stopSyncLoop();
  doSync();  // immediate first sync
  const secs = intervalSeconds ?? Math.max(10, (loadConfig().syncInterval ?? 30));
  syncTimer  = setInterval(doSync, secs * 1000);
}

function restartSyncLoop(intervalSeconds) {
  stopSyncLoop();
  const secs = intervalSeconds ?? Math.max(10, (loadConfig().syncInterval ?? 30));
  syncTimer  = setInterval(doSync, secs * 1000);
}

function stopSyncLoop() {
  if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
}

let pendingLogs = [];

async function doSync() {
  const logsToSend = pendingLogs.splice(0);  // drain buffer atomically
  const result     = await playerSync(logsToSend);
  if (result) {
    lastSync = result;
    win?.webContents.send("sync-data", result);
    updateTrayMenu();

    // ── Realtime: connect (or reconnect) after first successful sync ──────
    // result.realtime = { channel: "screen:{screenId}", apikey: anonKey }
    if (result.realtime?.channel && result.realtime?.apikey) {
      // Persist anonKey so it survives restarts without needing a full sync first
      if (!config.anonKey) {
        config.anonKey = result.realtime.apikey;
        saveConfig(config);
      }
      connectRealtime(result.realtime);
    }
  } else {
    win?.webContents.send("sync-error", { time: new Date().toISOString() });
  }
}

// ─── IPC handlers ─────────────────────────────────────────────────────────
ipcMain.handle("get-config",  () => loadConfig());
ipcMain.handle("get-version", () => app.getVersion());

ipcMain.handle("save-config", (_e, cfg) => {
  saveConfig(cfg);
  config = cfg;
  win?.webContents.send("config-saved");
  // Disconnect Realtime so it reconnects with potentially new credentials
  disconnectRealtime();
  // Restart sync; Realtime will reconnect automatically after first successful sync
  startSyncLoop();
  return { ok: true };
});

ipcMain.handle("get-mqtt-status", () => ({ connected: realtimeConnected }));

// ── Media disk cache IPC ──────────────────────────────────────────────────
// cache-get: synchronous check (in-memory index only, very fast)
ipcMain.handle("cache-get", (_e, url) => {
  const local = mediaCache.getLocalPath(url);
  return local ? `file://${local}` : null;
});

// cache-prewarm: download a batch of URLs in background, return {url→file://} map
ipcMain.handle("cache-prewarm", (_e, urls) => {
  if (!Array.isArray(urls)) return {};
  return mediaCache.prewarm(urls);
});

ipcMain.handle("cache-stats", () => mediaCache.getStats());

ipcMain.handle("force-sync", async () => {
  await doSync();
  return { ok: true };
});

ipcMain.handle("add-log", (_e, entry) => {
  pendingLogs.push(entry);
});

ipcMain.handle("toggle-fullscreen", () => {
  if (!win) return;
  win.setFullScreen(!win.isFullScreen());
});

ipcMain.handle("open-external", (_e, url) => { shell.openExternal(url); });

// ─── App lifecycle ────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // ── Response header fixups ─────────────────────────────────────────────────
  //
  // 1. Widget HTML: force text/html, strip CSP/X-Frame-Options, add short-lived cache
  // 2. Static assets (JS/CSS/fonts): aggressive long cache (content-addressed)
  // 3. Images/videos from CDN: 1-day cache so Chromium reuses them across restarts
  //
  // These Cache-Control values work in tandem with the persistent disk-cache-dir
  // configured above and with the explicit media-cache.js disk cache.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = Object.assign({}, details.responseHeaders);
    const u       = details.url;

    if (/\.html(\?|$)/i.test(u)) {
      // Widget HTML — render correctly + cache for 10 minutes
      headers["content-type"]             = ["text/html; charset=utf-8"];
      headers["cache-control"]            = ["public, max-age=600, stale-while-revalidate=60"];
      delete headers["content-security-policy"];
      delete headers["Content-Security-Policy"];
      delete headers["x-frame-options"];
      delete headers["X-Frame-Options"];

    } else if (/\.(js|mjs)(\?|$)/i.test(u)) {
      // Widget scripts — cache 1 week (Supabase Storage uses content-addressed URLs)
      if (!headers["cache-control"]) {
        headers["cache-control"] = ["public, max-age=604800, immutable"];
      }
    } else if (/\.(css)(\?|$)/i.test(u)) {
      if (!headers["cache-control"]) {
        headers["cache-control"] = ["public, max-age=604800, immutable"];
      }
    } else if (/\.(woff2?|ttf|eot|otf)(\?|$)/i.test(u)) {
      // Fonts — virtually never change
      if (!headers["cache-control"]) {
        headers["cache-control"] = ["public, max-age=2592000, immutable"];
      }
    } else if (/\.(jpg|jpeg|png|gif|webp|avif|svg)(\?|$)/i.test(u)) {
      // Images — 1 day (also handled by explicit disk cache in media-cache.js)
      if (!headers["cache-control"]) {
        headers["cache-control"] = ["public, max-age=86400, stale-while-revalidate=3600"];
      }
    } else if (/\.(mp4|webm|mov|mp3|aac|wav|ogg)(\?|$)/i.test(u)) {
      // Video/audio — 1 day; Range requests are naturally supported
      if (!headers["cache-control"]) {
        headers["cache-control"] = ["public, max-age=86400"];
      }
    }

    callback({ responseHeaders: headers });
  });

  // Initialise disk media cache (must be after userData path is available)
  mediaCache.init(app.getPath("userData"));

  createWindow();
  createTray();
  startSyncLoop();

  // Keyboard shortcuts
  globalShortcut.register("CommandOrControl+Shift+S", () => {
    win?.webContents.send("show-settings");
  });
  globalShortcut.register("CommandOrControl+Shift+D", () => {
    win?.webContents.send("toggle-hud");
  });
  globalShortcut.register("F11", () => {
    win?.setFullScreen(!win?.isFullScreen());
  });
  globalShortcut.register("Escape", () => {
    if (win?.isFullScreen()) win.setFullScreen(false);
    if (win?.isKiosk())      win.setKiosk(false);
  });

  app.on("activate", () => { if (!win) createWindow(); });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  stopSyncLoop();
  disconnectRealtime();
  try { globalShortcut.unregisterAll(); } catch (_) {}
});

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
}
