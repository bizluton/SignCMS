# SignCMS Desktop Player

Electron-based Windows / macOS testing player for the SignCMS digital-signage system.
Implements the same protocol as the Android player so you can validate the full
dispatch pipeline on a development machine without needing physical hardware.

## Quick Start

```bash
npm install
npm run dev        # development (DevTools auto-opens)
npm start          # production mode
```

On first launch press **F1** (or triple-click anywhere) to open the HUD,
then click **Open Settings** and fill in:

| Field | Example |
|-------|---------|
| Server URL | `https://abcdefgh.supabase.co/functions/v1` |
| Device Token | (from SignCMS → Screens → this device) |
| Sync interval | `30` seconds |

Click **Test Connection** to validate before saving.

## Build distributables

```bash
npm run build:mac   # → dist/SignCMS Player-1.0.0.dmg  (universal)
npm run build:win   # → dist/SignCMS Player Setup 1.0.0.exe
```

Requires `electron-builder` (already a devDependency).

## Architecture

```
main.js                 Electron main process
├── src/ConfigManager.js      Persistent settings (userData/config.json)
├── src/PlayerSyncManager.js  30-second HTTP sync loop + log batch
├── src/DownloadService.js    CAS download engine + LRU eviction
└── src/RealtimeManager.js    Supabase Realtime (Phoenix WebSocket)

preload.js              contextBridge → window.player API (same surface as Android)
renderer.html           Content player (zone layout + media playlist)
settings.html           Configuration form
```

## CAS storage

Downloaded assets are stored at:

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/SignCMS Player/cas/` |
| Windows | `%APPDATA%\SignCMS Player\cas\` |

Files are named by their 64-character SHA-256 digest (no extension), matching the
Android `/sdcard/SignEffeX/cas/` layout. The `cas://` custom protocol serves them
to the renderer without relaxing web security.

## HUD (F1 / triple-click)

| Button | Action |
|--------|--------|
| Force Sync | Immediate player-sync POST |
| Settings | Open configuration window |
| Refresh HUD | Re-read cache stats |
| Verify CAS | Full SHA-256 integrity scan |
| Open CAS Dir | Reveal cache folder in Finder/Explorer |

## window.player API

The renderer exposes the same JS bridge as the Android `PlayerJsBridge`:

```js
window.player.getCachedUrl(url)     // → Promise<"cas://…" | null>
window.player.addLog(jsonStr)       // { media_id, duration_seconds }
window.player.forceSync()
window.player.openSettings()
window.player.getCacheStats()       // → Promise<stats>
window.player.verifyIntegrity()     // → Promise<{ checked, failed }>
window.player.getVersion()          // → "1.0.0"
```

Events dispatched on `window`:

| Event | Payload |
|-------|---------|
| `__signSyncData` | Full player-sync response |
| `__signSyncError` | Error string |
| `__signRealtimeCmd` | `{ event, payload }` |
| `__signRealtimeStatus` | `{ connected: bool }` |
| `__signDownloadProgress` | `{ done, total, sha256 }` |
| `__signCasReady` | `{ count, total }` |
| `__signVerifyProgress` | `{ checked, total, sha256, ok }` |
