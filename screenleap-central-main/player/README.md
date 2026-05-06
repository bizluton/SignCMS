# SignCMS Player

Electron-based digital signage player for SignCMS.  
Supports macOS (`.dmg`) and Windows (`.exe`) installers.

## Quick Start

```bash
cd player
npm install
npm start          # 開發模式執行
```

## Build Installers

```bash
npm run dist:mac   # → dist/SignCMS Player-x.x.x.dmg
npm run dist:win   # → dist/SignCMS Player Setup x.x.x.exe
npm run dist:all   # 同時打包 Mac + Win (需在 Mac 上執行)
```

> **Windows cross-compile:** 在 Mac 打包 Win 安裝檔需安裝 wine：  
> `brew install --cask wine-stable`

## 首次設定

1. 啟動 App 後出現設定畫面
2. 填入：
   - **Supabase URL**: `https://narhbpojjtnalyfiwxue.supabase.co`
   - **Anon Key**: 在 Supabase 控制台 → Project Settings → API 取得
   - **Device Token**: 在 SignCMS 管理後台 → 螢幕管理 → 該螢幕 → 產生裝置 Token
3. 點擊「連線測試並儲存」

## 快捷鍵

| 快捷鍵 | 功能 |
|--------|------|
| `Ctrl+Shift+S` / `⌘⇧S` | 開啟設定面板 |
| `Ctrl+Shift+D` / `⌘⇧D` | 切換 HUD 除錯資訊 |
| `F11` | 全螢幕切換 |
| `Escape` | 退出全螢幕 / 關閉彈窗 |
| `→` / `←` | 手動切換頁面（多頁內容）|

## 架構說明

```
player/
├── src/
│   ├── main.js          Electron 主程序（視窗、Tray、IPC、心跳）
│   ├── preload.js       安全 IPC 橋接（contextBridge）
│   └── renderer/
│       ├── index.html   播放器 UI（Setup / Standby / Player）
│       └── app.js       播放引擎（Zone 渲染、媒體循環、BGM、公告）
├── assets/
│   ├── icon.svg         App 圖示（需轉為 .icns/.ico 正式打包用）
│   └── tray.svg         系統 Tray 圖示
└── package.json
```

## 產生正式圖示（打包前）

```bash
# Mac (.icns)
npm install -g electron-icon-maker
electron-icon-maker --input=assets/icon.png --output=assets/

# 或使用 ImageMagick
magick assets/icon.svg -resize 512x512 assets/icon.png
```

## 功能特色

- ✅ **多 Zone 渲染** — 百分比座標，完美適配任何解析度
- ✅ **媒體播放** — 圖片輪播（含 crossfade）、影片播放
- ✅ **多頁切換** — 自動切頁 + 手動鍵盤控制
- ✅ **背景音樂** — 多曲循環播放
- ✅ **公告系統** — 底部跑馬燈 + 置頂公告全螢幕彈出
- ✅ **心跳機制** — 每 30 秒同步一次（可調整），自動維持 online 狀態
- ✅ **播放日誌** — 批次回報 playback_logs
- ✅ **排程頻道** — 支援 channel_blocks 時段排程
- ✅ **系統 Tray** — 背景運作，右鍵快速操作
- ✅ **Single Instance** — 防止重複啟動
- ✅ **Kiosk 模式** — 全螢幕鎖定模式（設定後重啟生效）
