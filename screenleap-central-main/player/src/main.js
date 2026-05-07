/**
 * SignCMS Player — Electron Main Process
 * Handles: window, tray, config, heartbeat, IPC, MQTT
 */
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage,
        globalShortcut, dialog, shell, session } = require("electron");
const path  = require("path");
const https = require("https");
const http  = require("http");
const fs    = require("fs");
const mqtt  = require("mqtt");

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
    }, { log_batch: logBatch });
    if (res.status === 200 && res.body?.ok) return res.body;
    console.warn("player-sync error:", res.status, res.body);
    return null;
  } catch (e) {
    console.error("player-sync fetch failed:", e.message);
    return null;
  }
}

// ─── MQTT client ──────────────────────────────────────────────────────────

/**
 * Connect (or reconnect) to the MQTT broker using credentials from the
 * sync response.  Safe to call multiple times — tears down the old client
 * first so we never have duplicate connections.
 *
 * @param {object} mqttCfg  { broker, topic_prefix }   from player-sync response
 * @param {string} screenId
 * @param {string} orgId
 * @param {string} deviceToken
 */
function connectMqtt(mqttCfg, screenId, orgId, deviceToken) {
  if (!mqttCfg?.broker || !deviceToken) return;

  // Avoid reconnecting if already connected to the same broker
  if (mqttClient && mqttConnected && mqttCfg.broker === mqttClient.options?.href) return;

  disconnectMqtt();

  const prefix = mqttCfg.topic_prefix ?? `signcms/${orgId}/screens/${screenId}`;
  mqttTopicPrefix = prefix;
  mqttScreenId    = screenId;
  mqttOrgId       = orgId;

  const lwt = {
    topic:   `${prefix}/status`,
    payload: JSON.stringify({ online: false, screen_id: screenId, ts: Date.now() }),
    qos:     1,
    retain:  true,
  };

  console.log("[MQTT] connecting to", mqttCfg.broker);
  mqttClient = mqtt.connect(mqttCfg.broker, {
    clientId:  `screen_${screenId}_${Date.now()}`,
    username:  `screen:${screenId}`,
    password:  deviceToken,
    clean:     true,
    reconnectPeriod: 5000,
    will: lwt,
  });

  mqttClient.on("connect", () => {
    console.log("[MQTT] connected");
    mqttConnected = true;

    // Subscribe to command topic
    mqttClient.subscribe(`${prefix}/cmd`, { qos: 1 }, (err) => {
      if (err) console.error("[MQTT] subscribe error:", err.message);
    });

    // Subscribe to org-wide broadcast topic
    mqttClient.subscribe(`signcms/${orgId}/broadcast`, { qos: 1 }, (err) => {
      if (err) console.error("[MQTT] broadcast subscribe error:", err.message);
    });

    // Publish online status (retained)
    publishStatus({ online: true });

    // When MQTT is up, switch sync loop to slow fallback (5 min)
    restartSyncLoop(300);

    // Start 60-second heartbeat ping
    startMqttHeartbeat();

    win?.webContents.send("mqtt-status", { connected: true });
  });

  mqttClient.on("message", (topic, payload) => {
    let msg;
    try { msg = JSON.parse(payload.toString()); }
    catch { console.warn("[MQTT] bad payload on", topic); return; }

    console.log("[MQTT] message", topic, msg);

    if (topic === `${prefix}/cmd` || topic === `signcms/${orgId}/broadcast`) {
      handleMqttCommand(msg);
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
    // Fall back to fast polling until reconnect succeeds
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
    mqttClient   = null;
    mqttConnected = false;
  }
}

function publishStatus(extra = {}) {
  if (!mqttClient || !mqttConnected || !mqttTopicPrefix) return;
  const payload = JSON.stringify({
    online:    true,
    screen_id: mqttScreenId,
    ts:        Date.now(),
    ...extra,
  });
  mqttClient.publish(`${mqttTopicPrefix}/status`, payload, { qos: 1, retain: true });
}

function startMqttHeartbeat() {
  stopMqttHeartbeat();
  mqttHeartbeat = setInterval(() => publishStatus(), 60_000);
}

function stopMqttHeartbeat() {
  if (mqttHeartbeat) { clearInterval(mqttHeartbeat); mqttHeartbeat = null; }
}

/**
 * Handle an inbound MQTT command from the server.
 * Supported types: sync, switch_channel, emergency_broadcast, restore, reload
 */
function handleMqttCommand(msg) {
  const type = msg?.type;
  switch (type) {
    case "sync":
      // Server is telling us to re-sync immediately
      doSync();
      break;

    case "switch_channel":
    case "emergency_broadcast":
    case "restore":
      // Push the command payload directly to the renderer so it can act immediately
      win?.webContents.send("mqtt-cmd", msg);
      // Also trigger a sync to get the full updated playlist
      doSync();
      break;

    case "reload":
      win?.webContents.reload();
      break;

    default:
      // Forward unknown commands to renderer
      if (type) win?.webContents.send("mqtt-cmd", msg);
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
    if (result.mqtt?.broker && result.screen?.id) {
      const cfg = loadConfig();
      connectMqtt(result.mqtt, result.screen.id, result.screen.org_id, cfg.deviceToken);
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
  // Fix response headers for widget HTML files served from Supabase Storage:
  // 1. Force Content-Type: text/html so Chromium renders instead of showing source
  // 2. Remove Content-Security-Policy and X-Frame-Options that block scripts/styles
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = Object.assign({}, details.responseHeaders);
    if (/\.html(\?|$)/i.test(details.url)) {
      headers["content-type"] = ["text/html; charset=utf-8"];
      // Remove headers that would block widget scripts and external resources
      delete headers["content-security-policy"];
      delete headers["Content-Security-Policy"];
      delete headers["x-frame-options"];
      delete headers["X-Frame-Options"];
    }
    callback({ responseHeaders: headers });
  });

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
  disconnectMqtt();
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
