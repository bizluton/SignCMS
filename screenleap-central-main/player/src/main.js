/**
 * SignCMS Player — Electron Main Process
 * Handles: window, tray, config, heartbeat, IPC, MQTT, media disk cache
 */
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage,
        globalShortcut, dialog, shell, session } = require("electron");
const path       = require("path");
const https      = require("https");
const http       = require("http");
const fs         = require("fs");
const mqtt       = require("mqtt");
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

// ─── MQTT state ───────────────────────────────────────────────────────────
let mqttClient       = null;
let mqttConnected    = false;
let mqttHeartbeat    = null;   // setInterval for 60s status ping
let mqttTopicPrefix  = null;   // e.g. "signcms/{org_id}/screens/{screen_id}"
let mqttScreenId     = null;
let mqttOrgId        = null;

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

// ─── MQTT client ──────────────────────────────────────────────────────────
//
// Protocol: Mosquitto (self-hosted)
// Topics (SignPlayer compatible):
//   signage/player/{serial}/heartbeat  — device → server, QoS 0, every 15 s
//   signage/player/{serial}/command    — server → device, QoS 0
//   signage/player/{serial}/response   — device → server, QoS 0
//
// Command payload (server → device):
//   { ts, cls, cmd, data, cid }
//
// Response payload (device → server):
//   { ts, cls, cmd, rid, data }

let mqttSerial = null;   // = screenId from player-sync, used as MQTT topic serial

/** Build topic paths */
const mqttTopic = {
  hb:  (s) => `signage/player/${s}/heartbeat`,
  cmd: (s) => `signage/player/${s}/command`,
  res: (s) => `signage/player/${s}/response`,
};

/**
 * Connect (or reconnect) to the Mosquitto broker.
 * Safe to call multiple times — tears down the previous client first.
 *
 * @param {object} mqttCfg   { broker, serial }   from player-sync response
 * @param {string} deviceToken
 */
function connectMqtt(mqttCfg, deviceToken) {
  if (!mqttCfg?.broker || !mqttCfg?.serial || !deviceToken) return;

  // Already connected to same broker with same serial → skip
  if (mqttClient && mqttConnected &&
      mqttSerial === mqttCfg.serial &&
      mqttClient._connectOptions?.href === mqttCfg.broker) return;

  disconnectMqtt();

  const serial    = mqttCfg.serial;
  mqttSerial      = serial;
  mqttScreenId    = serial;

  console.log("[MQTT] connecting to", mqttCfg.broker, "serial:", serial);

  // LWT — broker auto-publishes this when the TCP connection drops unexpectedly.
  // Using retain: true so the last known status persists for the dashboard.
  const lwt = {
    topic:   `signage/player/${serial}/status`,
    payload: JSON.stringify({ online: false, serial, ts: Math.floor(Date.now() / 1_000) }),
    qos:     1,
    retain:  true,
  };

  mqttClient = mqtt.connect(mqttCfg.broker, {
    clientId:        `screen_${serial}_${Date.now()}`,
    username:        `screen:${serial}`,
    password:        deviceToken,
    clean:           true,
    reconnectPeriod: 5_000,
    connectTimeout:  10_000,
    will:            lwt,
  });

  mqttClient.on("connect", () => {
    console.log("[MQTT] connected, serial:", serial);
    mqttConnected = true;

    // Subscribe: command (QoS 1 — server uses QoS 1 for reliable delivery)
    mqttClient.subscribe(mqttTopic.cmd(serial), { qos: 1 }, (err) => {
      if (err) console.error("[MQTT] cmd subscribe error:", err.message);
      else     console.log("[MQTT] subscribed cmd:", mqttTopic.cmd(serial));
    });

    // Subscribe: shadow/delta (QoS 1, retain) — immediately receive any pending
    // desired-state diff that arrived while the player was offline
    mqttClient.subscribe(`signage/player/${serial}/shadow/delta`, { qos: 1 }, (err) => {
      if (err) console.error("[MQTT] shadow subscribe error:", err.message);
      else     console.log("[MQTT] subscribed shadow/delta:", serial);
    });

    // Publish online status (retained) — overwrites any LWT left by previous crash
    publishOnlineStatus(true);

    // Switch sync loop to slow fallback (5 min) while MQTT is alive
    restartSyncLoop(300);

    // Publish first heartbeat immediately, then every 15 s
    publishHeartbeat();
    startMqttHeartbeat();

    win?.webContents.send("mqtt-status", { connected: true, serial });
  });

  mqttClient.on("message", (topic, payload) => {
    const raw = payload.toString();
    if (!raw) return;  // empty payload = retain clear (e.g. shadow cleared)

    let msg;
    try { msg = JSON.parse(raw); }
    catch { console.warn("[MQTT] bad payload on", topic, raw); return; }

    if (topic === mqttTopic.cmd(serial)) {
      handleMqttCommand(msg);
    } else if (topic === `signage/player/${serial}/shadow/delta`) {
      handleShadowDelta(msg);
    }
  });

  mqttClient.on("reconnect", () => {
    console.log("[MQTT] reconnecting…");
    mqttConnected = false;
    win?.webContents.send("mqtt-status", { connected: false });
  });

  mqttClient.on("close", () => {
    console.log("[MQTT] disconnected");
    mqttConnected = false;
    stopMqttHeartbeat();
    // Fall back to fast polling while offline
    restartSyncLoop(config.syncInterval ?? 30);
    win?.webContents.send("mqtt-status", { connected: false });
  });

  mqttClient.on("error", (err) => {
    console.error("[MQTT] error:", err.message);
  });
}

function disconnectMqtt() {
  stopMqttHeartbeat();
  if (mqttClient) {
    try { mqttClient.end(true); } catch (_) {}
    mqttClient    = null;
    mqttConnected = false;
    mqttSerial    = null;
  }
}

/**
 * Build and publish a heartbeat payload to signage/player/{serial}/heartbeat.
 * Structure matches the SignPlayer Android heartbeat for dashboard compatibility.
 */
function publishHeartbeat() {
  if (!mqttClient || !mqttConnected || !mqttSerial) return;

  const now      = Math.floor(Date.now() / 1_000);
  const uptime   = Math.floor(process.uptime());
  const appVer   = app.getVersion();
  const mem      = process.memoryUsage();
  const memUsed  = (mem.rss / 1_073_741_824).toFixed(2);  // bytes → GB

  const currentSyncId = lastSync?.channel?.id ?? lastSync?.project?.id ?? "";

  const payload = {
    ts:        now,
    uptime,
    activity:  "electron",
    version_code: parseInt(appVer.replace(/\./g, ""), 10) || 0,
    version_name: appVer,
    storage:   "N/A",
    memory:    `${memUsed} GB / N/A`,
    screen_on: true,
    signplayer_status: {
      version_name: appVer,
      version_code: parseInt(appVer.replace(/\./g, ""), 10) || 0,
      type:         "electron",
      status:       lastSync ? "playing" : "idle",
      signage_id:   currentSyncId,
      group_id:     lastSync?.screen?.org_id ?? "",
      ts:           now,
    },
    error_code:    0,
    error_message: "",
  };

  mqttClient.publish(mqttTopic.hb(mqttSerial), JSON.stringify(payload), { qos: 0 });
}

/**
 * Publish a response to signage/player/{serial}/response.
 * @param {object} cmd  The original command message (must have cls, cmd, cid)
 * @param {object} data Response data
 */
function publishResponse(cmd, data = {}) {
  if (!mqttClient || !mqttConnected || !mqttSerial) return;
  const payload = {
    ts:  Math.floor(Date.now() / 1_000),
    cls: cmd.cls ?? "unknown",
    cmd: cmd.cmd ?? "unknown",
    rid: cmd.cid ?? "",
    data: { msg: "okay.", ...data },
  };
  mqttClient.publish(mqttTopic.res(mqttSerial), JSON.stringify(payload), { qos: 0 });
}

/**
 * Publish the device online/offline status to the retained status topic.
 * Called on connect (online=true) and graceful disconnect (online=false).
 * The LWT handles unexpected drops automatically.
 */
function publishOnlineStatus(online) {
  if (!mqttClient || !mqttSerial) return;
  const payload = JSON.stringify({ online, serial: mqttSerial, ts: Math.floor(Date.now() / 1_000) });
  mqttClient.publish(
    `signage/player/${mqttSerial}/status`,
    payload,
    { qos: 1, retain: true },
  );
}

/**
 * Handle a shadow/delta message from the server.
 * Payload: { ts, desired: {...}, delta: {...} }
 *
 * The delta contains only the keys that differ from the device's last
 * reported state.  We trigger an immediate doSync() so the player
 * fetches the updated playlist, then report back to shadow-report
 * so the server can clear the retained message.
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
 * Piggybacks the reported state so the server can compute the new delta.
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

function startMqttHeartbeat() {
  stopMqttHeartbeat();
  mqttHeartbeat = setInterval(() => publishHeartbeat(), 15_000);
}

function stopMqttHeartbeat() {
  if (mqttHeartbeat) { clearInterval(mqttHeartbeat); mqttHeartbeat = null; }
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
function handleMqttCommand(msg) {
  console.log("[MQTT] command", msg?.cls, msg?.cmd);
  const { cls, cmd } = msg ?? {};

  if (cls === "content") {
    switch (cmd) {
      case "sync":
        publishResponse(msg);
        doSync();
        break;
      case "switch_channel":
      case "emergency_broadcast":
      case "restore":
        win?.webContents.send("mqtt-cmd", msg);
        publishResponse(msg);
        doSync();
        break;
      default:
        win?.webContents.send("mqtt-cmd", msg);
        publishResponse(msg, { msg: "unknown content command" });
    }
  } else if (cls === "screen") {
    switch (cmd) {
      case "reload":
        publishResponse(msg);
        setTimeout(() => win?.webContents.reload(), 500);
        break;
      case "fullscreen":
        publishResponse(msg);
        win?.setFullScreen(!win?.isFullScreen());
        break;
      default:
        win?.webContents.send("mqtt-cmd", msg);
        publishResponse(msg, { msg: "unknown screen command" });
    }
  } else {
    // Forward all other classes to renderer
    win?.webContents.send("mqtt-cmd", msg);
    publishResponse(msg);
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
 * When MQTT is connected we use a long fallback (300s); when not, the
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

    // ── MQTT: connect (or reconnect) after first successful sync ──────────
    // result.mqtt = { broker, serial }  (serial = screenId, used as topic identifier)
    if (result.mqtt?.broker && result.mqtt?.serial) {
      const cfg = loadConfig();
      connectMqtt(result.mqtt, cfg.deviceToken);
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
  // Disconnect MQTT so it reconnects with potentially new deviceToken
  disconnectMqtt();
  // Restart sync; MQTT will reconnect automatically after first successful sync
  startSyncLoop();
  return { ok: true };
});

ipcMain.handle("get-mqtt-status", () => ({ connected: mqttConnected }));

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
  // Publish offline status before closing the MQTT connection gracefully
  // (LWT only fires on unexpected drops; this handles clean shutdown)
  publishOnlineStatus(false);
  setTimeout(() => {
    disconnectMqtt();
    try { globalShortcut.unregisterAll(); } catch (_) {}
  }, 300);
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
