/**
 * SignCMS Player — Electron Main Process
 * Handles: window, tray, config, heartbeat, IPC
 */
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage,
        globalShortcut, dialog, shell, session } = require("electron");
const path  = require("path");
const https = require("https");
const http  = require("http");
const fs    = require("fs");

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
let win        = null;
let tray       = null;
let syncTimer  = null;
let lastSync   = null;       // last successful API response
let isDev      = process.argv.includes("--dev");

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
function startSyncLoop() {
  stopSyncLoop();
  doSync();  // immediate first sync
  const interval = Math.max(10, (loadConfig().syncInterval ?? 30)) * 1000;
  syncTimer = setInterval(doSync, interval);
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
  // Restart sync with new interval
  startSyncLoop();
  return { ok: true };
});

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
  // Force Content-Type: text/html for any .html URLs (e.g. widget files
  // served from Supabase Storage which may return text/plain or octet-stream)
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = Object.assign({}, details.responseHeaders);
    if (/\.html(\?|$)/i.test(details.url)) {
      headers["content-type"] = ["text/html; charset=utf-8"];
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
