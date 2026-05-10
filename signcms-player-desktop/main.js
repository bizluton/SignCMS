'use strict';
const { app, BrowserWindow, ipcMain, protocol, shell, Menu } = require('electron');
const path = require('path');
const fs   = require('fs');

const ConfigManager    = require('./src/ConfigManager');
const DownloadService  = require('./src/DownloadService');
const PlayerSyncManager = require('./src/PlayerSyncManager');
const RealtimeManager  = require('./src/RealtimeManager');

// ── Register CAS protocol before app ready ────────────────────────────────────
// Allows renderer to use  cas://<sha256>  for downloaded assets.
protocol.registerSchemesAsPrivileged([{
  scheme: 'cas',
  privileges: { secure: true, supportFetchAPI: true, corsEnabled: false, stream: true },
}]);

// ── Singletons ────────────────────────────────────────────────────────────────
let config;
let downloadService;
let syncManager;
let realtimeManager;

let mainWindow    = null;
let settingsWindow = null;
let currentManifest = [];

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  config          = new ConfigManager(app.getPath('userData'));
  downloadService = new DownloadService(app.getPath('userData'));
  syncManager     = new PlayerSyncManager();
  realtimeManager = new RealtimeManager();

  // Serve CAS files via  cas://<sha256>
  protocol.registerFileProtocol('cas', (req, cb) => {
    const sha256 = decodeURIComponent(req.url.replace('cas://', '').replace(/\/$/, ''));
    cb({ path: downloadService.casPath(sha256) });
  });

  createMainWindow();

  // Wire disk-status provider
  syncManager.setDiskStatusProvider(() => downloadService.getDiskStatus(currentManifest));

  if (config.isConfigured()) startPlayer();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });

// ── Windows ───────────────────────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width:           1280,
    height:          720,
    minWidth:        640,
    minHeight:       360,
    backgroundColor: '#000000',
    title:           'SignCMS Player',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  mainWindow.loadFile('renderer.html');

  if (process.env.NODE_ENV === 'development')
    mainWindow.webContents.openDevTools({ mode: 'detach' });

  // Remove default menu in production
  if (process.env.NODE_ENV !== 'development') Menu.setApplicationMenu(null);

  mainWindow.on('closed', () => { mainWindow = null; });
}

function createSettingsWindow() {
  if (settingsWindow) { settingsWindow.focus(); return; }
  settingsWindow = new BrowserWindow({
    width:  520,
    height: 560,
    parent: mainWindow,
    modal:  true,
    title:  'SignCMS Player — Settings',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });
  settingsWindow.loadFile('settings.html');
  if (process.env.NODE_ENV !== 'development') settingsWindow.setMenu(null);
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

// ── Player orchestration ──────────────────────────────────────────────────────
function startPlayer() {
  syncManager.configure({
    serverUrl:   config.get('serverUrl'),
    deviceToken: config.get('deviceToken'),
    intervalMs:  config.get('syncIntervalMs', 30_000),
    onSync:      handleSyncResponse,
    onError:     (err) => {
      mainWindow?.webContents.send('sync-error', err);
    },
  });
  syncManager.start();
}

async function handleSyncResponse(data) {
  // Forward to renderer (non-blocking display update)
  mainWindow?.webContents.send('sync-data', data);

  // Realtime: (re)subscribe when channel info changes
  // Use supabase_url from server response (direct Supabase URL) so WebSocket
  // bypasses the Cloudflare Worker proxy which cannot tunnel WebSocket.
  if (data.realtime?.channel && data.realtime?.apikey) {
    const supabaseUrl = data.realtime.supabase_url
      ?? config.get('serverUrl').replace(/\/functions\/v1\/?$/, '');
    realtimeManager.configure({
      supabaseUrl,
      apikey:    data.realtime.apikey,
      channel:   data.realtime.channel,
      onCommand: (event, payload) => {
        mainWindow?.webContents.send('realtime-cmd', { event, payload });
        if (event === 'content.sync') syncManager.forceSync();
      },
      onStatus: (connected) => {
        mainWindow?.webContents.send('realtime-status', { connected });
      },
    });
  }

  // CAS sync — download missing assets in background
  const manifest = data.project?.asset_manifest ?? [];
  currentManifest = manifest;

  if (manifest.length === 0) return;

  downloadService.setProgressCallback((done, total, sha256) => {
    mainWindow?.webContents.send('download-progress', { done, total, sha256 });
  });

  try {
    const casFiles = await downloadService.syncAssets(manifest);
    mainWindow?.webContents.send('cas-ready', {
      count: Object.keys(casFiles).length,
      total: manifest.filter(e => e.sha256?.length === 64).length,
    });
  } catch (e) {
    console.error('[Main] CAS sync error:', e.message);
  }
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

// Config
ipcMain.handle('get-config',    () => config.getAll());
ipcMain.handle('is-configured', () => config.isConfigured());

ipcMain.handle('save-config', (_e, cfg) => {
  config.setAll(cfg);
  syncManager.stop();
  realtimeManager.disconnect();
  if (config.isConfigured()) startPlayer();
  return { ok: true };
});

// Test a server URL + device token without saving
ipcMain.handle('test-connection', async (_e, { serverUrl, deviceToken }) => {
  const tester = new PlayerSyncManager();
  tester.configure({ serverUrl, deviceToken, onSync: () => {}, onError: () => {} });
  try {
    const url  = serverUrl.replace(/\/$/, '') + '/player-sync';
    const data = await tester.post(url, {});
    if (data.ok) {
      return { ok: true, screenName: data.screen?.name ?? '?', orgId: data.screen?.org_id ?? '?' };
    }
    return { ok: false, error: data.error ?? 'Server returned ok:false' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// CAS lookup: renderer passes original CDN URL, gets back cas:// or null
ipcMain.handle('get-cached-url', (_e, url) => {
  // Extract sha256 from URL: last path segment or query param
  const sha256 = extractSha256(url);
  if (!sha256) return null;
  const f = downloadService.getLocalFile(sha256);
  return f ? `cas://${sha256}` : null;
});

// Playback log
ipcMain.on('add-log', (_e, { mediaId, durationSeconds }) => {
  syncManager.addLog(mediaId, durationSeconds);
});

// Force sync
ipcMain.on('force-sync', () => syncManager.forceSync());

// Open settings window
ipcMain.on('open-settings', () => createSettingsWindow());

// Cache stats
ipcMain.handle('get-cache-stats', () => {
  const ds = downloadService.getDiskStatus(currentManifest);
  return {
    ...ds,
    serverUrl:    config.get('serverUrl'),
    deviceToken:  maskToken(config.get('deviceToken', '')),
    lastSyncAt:   syncManager.getLastSync()?.server_time ?? null,
    screenName:   syncManager.getLastSync()?.screen?.name ?? null,
    channelName:  syncManager.getLastSync()?.channel?.name ?? null,
    projectName:  syncManager.getLastSync()?.project?.name ?? null,
    syncPct:      (() => {
      const s = syncManager.getLastSync();
      const m = s?.project?.asset_manifest ?? [];
      const synced = m.filter(e => e.sha256?.length === 64 && fs.existsSync(downloadService.casPath(e.sha256))).length;
      return m.length > 0 ? Math.round(synced / m.length * 100) : null;
    })(),
  };
});

// Integrity verification
ipcMain.handle('verify-integrity', async () => {
  const results = { checked: 0, failed: 0 };
  await downloadService.verifyIntegrity((checked, total, sha256, ok) => {
    results.checked = checked;
    if (!ok) results.failed++;
    mainWindow?.webContents.send('verify-progress', { checked, total, sha256, ok });
  });
  return results;
});

// Open CAS directory in Finder/Explorer
ipcMain.on('open-cas-dir', () => shell.openPath(downloadService.casDir));

// Restart / relaunch the full application
ipcMain.on('restart-player', () => {
  // app.relaunch works for packaged builds; for dev (electron .) it also works
  // because execPath is the electron binary and argv contains the app path.
  app.relaunch({ args: process.argv.slice(1) });
  app.exit(0);
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function extractSha256(url) {
  if (!url) return null;
  try {
    // Try URL path segment matching 64-char hex
    const parts = new URL(url).pathname.split('/');
    for (const part of parts.reverse()) {
      const base = part.split('.')[0]; // strip extension
      if (/^[0-9a-f]{64}$/i.test(base)) return base.toLowerCase();
    }
  } catch {}
  return null;
}

function maskToken(token) {
  if (!token || token.length < 8) return '****';
  return token.slice(0, 4) + '****' + token.slice(-4);
}
