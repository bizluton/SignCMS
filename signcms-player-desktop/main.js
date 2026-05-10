'use strict';
const { app, BrowserWindow, ipcMain, protocol, shell, Menu, session } = require('electron');
const path           = require('path');
const fs             = require('fs');
const { spawn }      = require('child_process');
const os             = require('os');

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

// Track last realtime config — only (re)connect when channel or URL actually changes
let lastRealtimeKey = '';

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  config          = new ConfigManager(app.getPath('userData'));
  downloadService = new DownloadService(app.getPath('userData'));
  syncManager     = new PlayerSyncManager();
  realtimeManager = new RealtimeManager();

  // Patch response headers for Supabase Storage HTML widget files.
  //
  // Problems solved:
  // 1. Content-Type: Supabase Storage serves .html as text/plain / octet-stream,
  //    causing iframes to show raw source instead of rendering.
  // 2. Content-Security-Policy: Storage CSP headers restrict fetch() inside the
  //    widget iframe, preventing announcements from loading (black slide area).
  // 3. X-Frame-Options: Some CDN configs include DENY/SAMEORIGIN, blocking iframes.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (!/\.html(\?.*)?$/i.test(details.url)) { callback({}); return; }

    const headers = { ...(details.responseHeaders ?? {}) };

    // Fix Content-Type
    const ctKey = Object.keys(headers).find(k => k.toLowerCase() === 'content-type') ?? 'Content-Type';
    const ctVal = (headers[ctKey] ?? []).join('').toLowerCase();
    if (!ctVal.includes('text/html')) headers[ctKey] = ['text/html; charset=utf-8'];

    // Remove headers that restrict the widget's ability to make fetch requests
    for (const key of Object.keys(headers)) {
      const kl = key.toLowerCase();
      if (kl === 'content-security-policy' ||
          kl === 'content-security-policy-report-only' ||
          kl === 'x-frame-options') {
        delete headers[key];
      }
    }

    callback({ responseHeaders: headers });
  });

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

// 'activate' can fire before app is ready on macOS (e.g. after app.relaunch).
// Guard with app.isReady() to avoid "Cannot create BrowserWindow before app is ready".
app.on('activate', () => {
  if (!app.isReady()) return;
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

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

  // Realtime: (re)subscribe only when channel or supabase URL actually changes.
  // Previously configure() was called every sync cycle which disconnected the
  // WebSocket each time before it could stabilise.
  if (data.realtime?.channel && data.realtime?.apikey) {
    const supabaseUrl  = data.realtime.supabase_url
      ?? config.get('serverUrl').replace(/\/functions\/v1\/?$/, '');
    const realtimeKey  = `${supabaseUrl}|${data.realtime.channel}`;

    if (realtimeKey !== lastRealtimeKey) {
      lastRealtimeKey = realtimeKey;
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
  lastRealtimeKey = '';          // force reconnect with new credentials
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

// Update software: git pull → repack app.asar only → relaunch
//
// ⚠ IMPORTANT: We deliberately do NOT run electron-builder / npm run build:mac here.
// electron-builder invokes hdiutil to create APFS DMG images, which is a known cause
// of system-level hangs on macOS (the OS kernel I/O queue blocks). Running it inside
// the Electron main process makes this worse — the entire system can freeze and become
// unresponsive, with risk of file-system corruption.
//
// Instead we do an asar-only update:
//   1. git pull  (fast network operation)
//   2. Extract current app.asar → /tmp   (preserves node_modules/ws, etc.)
//   3. Overwrite only the JS/HTML source files from the new source tree
//   4. Repack to a new app.asar  (compress JS only, < 1 second)
//   5. Helper script swaps the asar in /Applications and relaunches
//
// This never touches electron-builder, hdiutil, or large temp dirs.
ipcMain.on('update-software', async () => {
  const srcDir      = path.join(os.homedir(), 'Documents', 'GitHub', 'SignCMS', 'signcms-player-desktop');
  const installDir  = '/Applications/SignCMS Player.app';
  const asarInApp   = path.join(installDir, 'Contents', 'Resources', 'app.asar');
  const extractDir  = path.join(os.tmpdir(), 'signcms_asar_extract');
  const newAsarPath = path.join(os.tmpdir(), 'signcms_app_new.asar');
  const helperPath  = path.join(os.tmpdir(), 'signcms_asar_swap.sh');
  const env         = {
    ...process.env,
    PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:' + (process.env.PATH || ''),
  };

  function send(line, done = false, ok = true) {
    mainWindow?.webContents.send('update-log', { line: line.trim(), done, ok });
  }

  try {
    // ── 1. git pull ──────────────────────────────────────────────────────────
    send('── git pull ──────────────────────');
    await new Promise((resolve, reject) => {
      const p = spawn('git', ['pull'], { cwd: srcDir, env });
      p.stdout.on('data', (d) => send(d.toString()));
      p.stderr.on('data', (d) => send(d.toString()));
      p.on('close', (code) => code === 0 ? resolve() : reject(new Error('git pull failed')));
    });

    // ── 2. Extract current asar (preserves node_modules from installed build) ──
    send('── extracting current asar ───────');
    const asar = require(path.join(srcDir, 'node_modules', '@electron', 'asar'));
    fs.rmSync(extractDir, { recursive: true, force: true });
    asar.extractAll(asarInApp, extractDir);

    // ── 3. Copy updated source files over the extract ──────────────────────
    send('── patching source files ─────────');

    // Top-level files
    for (const f of ['main.js', 'preload.js', 'renderer.html', 'settings.html', 'package.json']) {
      const s = path.join(srcDir, f);
      if (fs.existsSync(s)) fs.copyFileSync(s, path.join(extractDir, f));
    }

    // src/ directory (ConfigManager, DownloadService, PlayerSyncManager, RealtimeManager)
    const srcSubDir  = path.join(srcDir, 'src');
    const destSubDir = path.join(extractDir, 'src');
    fs.mkdirSync(destSubDir, { recursive: true });
    for (const f of fs.readdirSync(srcSubDir)) {
      if (f.endsWith('.js')) fs.copyFileSync(path.join(srcSubDir, f), path.join(destSubDir, f));
    }

    // ── 4. Repack to new asar ─────────────────────────────────────────────
    send('── repacking asar ────────────────');
    fs.rmSync(newAsarPath, { force: true });
    await asar.createPackageWithOptions(extractDir, newAsarPath, {
      unpack: '{**/*.node,**/*.dylib,**/*.so}',  // keep native addons unpacked
    });
    const asarSize = fs.statSync(newAsarPath).size;
    send(`   new asar: ${(asarSize / 1024).toFixed(0)} KB`);

    // ── 5. Detached helper: swap asar + relaunch ──────────────────────────
    send('── swapping asar + relaunching ───');
    const script = [
      '#!/bin/bash',
      'set -e',
      'sleep 1',
      // Atomic swap: backup → replace → open
      `cp -f "${asarInApp}" "${asarInApp}.bak"`,      // keep backup just in case
      `cp -f "${newAsarPath}" "${asarInApp}"`,         // replace asar (fast file copy)
      `open "${installDir}"`,
      `rm -f "${newAsarPath}" "$0"`,
    ].join('\n') + '\n';

    fs.writeFileSync(helperPath, script, { mode: 0o755 });
    const helper = spawn('bash', [helperPath], { detached: true, stdio: 'ignore' });
    helper.unref();

    send('✓ 完成 — 正在重啟…', true, true);
    setTimeout(() => app.exit(0), 800);

  } catch (e) {
    send(`✗ 更新失敗：${e.message}`, true, false);
  }
});

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
