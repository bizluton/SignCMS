# SignCMS 派送邏輯與播放器設計規格

> 版本：2026-05-10　作者：SignCMS Engineering

---

## 目錄

1. [系統總覽](#1-系統總覽)
2. [內容派送流程](#2-內容派送流程)
3. [播放器檔案架構](#3-播放器檔案架構)
4. [類別職責說明](#4-類別職責說明)
5. [CAS 檔案管理](#5-cas-檔案管理)
6. [同步協議（Sync Protocol）](#6-同步協議sync-protocol)
7. [頻道與排程解析](#7-頻道與排程解析)
8. [播放紀錄（Playback Log）](#8-播放紀錄playback-log)
9. [即時指令（Realtime Commands）](#9-即時指令realtime-commands)
10. [裝置 Shadow 狀態](#10-裝置-shadow-狀態)
11. [後端 Edge Functions 規格](#11-後端-edge-functions-規格)
12. [資料庫關鍵表格](#12-資料庫關鍵表格)
13. [配置常數參考表](#13-配置常數參考表)
14. [eMMC 磨損防護機制](#14-emmc-磨損防護機制)
15. [斷電恢復機制](#15-斷電恢復機制)

---

## 1. 系統總覽

SignCMS 為一套企業級數位看板管理系統，其核心架構分為三層：

```
┌─────────────────────────────────────────────────────────────┐
│                       管理後台 (Web)                         │
│   媒體上傳 → 設計專案 → 頻道排程 → 螢幕管理                    │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTPS / Supabase Realtime
┌────────────────────────▼────────────────────────────────────┐
│                  Supabase 後端                               │
│  player-sync │ player-dashboard │ upload-media │ shadow-report│
│  PostgreSQL RLS │ Supabase Storage (CDN) │ Realtime (WS)    │
└────────────────────────┬────────────────────────────────────┘
                         │ x-device-token / Phoenix WebSocket
┌────────────────────────▼────────────────────────────────────┐
│                   Android 播放器                             │
│  WebView 渲染層 │ CAS 磁碟快取 │ 記憶體快取 │ 即時控制         │
└─────────────────────────────────────────────────────────────┘
```

### 三層快取架構

| 層級 | 位置 | 形式 | 管理者 |
|------|------|------|--------|
| L1 CDN | Supabase Storage | HTTP URL | 後端自動 |
| L2 磁碟 | `/sdcard/SignEffeX/cas/<sha256>` | CAS 命名檔案 | `DownloadService.kt` |
| L3 記憶體 | 程序記憶體 LRU | URL → 本機路徑對映 | `MediaCacheManager.java` |

---

## 2. 內容派送流程

### 完整生命週期

```
設計師上傳媒體
       │
       ▼
  upload-media (Edge Function)
  ┌─────────────────────────────────┐
  │ 1. 計算 SHA-256 (server-side)   │
  │ 2. 跨組織 sha256 去重           │
  │ 3. 若新檔 → 寫入 Storage        │
  │    路徑: media/assets/<sha256>.<ext>  │
  │ 4. 更新 media_items 表          │
  └─────────────────────────────────┘
       │
       ▼
  設計師建立/編輯 design_project
  (zones JSON layout + 連結 media_items)
       │
       ▼
  設定頻道 (channel) 及排程 (channel_blocks)
       │
       ▼
  Android 播放器 每 30 秒 POST /player-sync
  ┌─────────────────────────────────────────────────────┐
  │ 請求：project_etag, log_batch, disk_status, reported│
  │                                                     │
  │ 回應：                                              │
  │  • project (zones JSON + asset_manifest)            │
  │  • channel (name, aspect, bgm_volume)               │
  │  • announcements                                    │
  │  • shadow (desired, delta)                          │
  │  • realtime (WebSocket channel + apikey)            │
  └─────────────────────────────────────────────────────┘
       │
       ▼
  DownloadService.kt — CAS 同步
  ┌─────────────────────────────────┐
  │ Diff manifest vs /sdcard/cas/   │
  │ 下載缺失 → .tmp → fsync → rename│
  │ LRU 淘汰 (空間 < 512 MB)        │
  └─────────────────────────────────┘
       │
       ▼
  MediaCacheManager — 預熱 WebView 快取
       │
       ▼
  WebView 渲染器播放媒體
  window.player.addLog({ media_id, duration_seconds })
       │
       ▼
  下次 player-sync — 上傳播放紀錄
  server 以 media_id JOIN media_items 解析 media_name
```

---

## 3. 播放器檔案架構

### Android 專案目錄結構

```
signcms-player-android/
├── app/
│   ├── build.gradle                          # 依賴宣告（Kotlin 1.9.22, OkHttp, Gson, WebSocket）
│   └── src/main/
│       ├── AndroidManifest.xml               # 權限、Service、BroadcastReceiver 宣告
│       ├── java/com/signcms/player/
│       │   ├── SignCMSApplication.java        # Application 單例，初始化全域元件
│       │   ├── MainActivity.java              # 主 Activity：WebView 宿主 + 同步協調
│       │   ├── SettingsActivity.java          # 裝置設定 UI（伺服器 URL、裝置 Token）
│       │   │
│       │   ├── ── 核心同步 ─────────────────────────────────────
│       │   ├── PlayerSyncManager.java         # HTTP 輪詢 + 播放紀錄批次
│       │   ├── DownloadService.kt             # CAS 下載引擎（Kotlin）
│       │   ├── MediaCacheManager.java         # WebView 記憶體 LRU 快取
│       │   │
│       │   ├── ── 即時控制 ─────────────────────────────────────
│       │   ├── RealtimeManager.java           # Supabase Realtime (Phoenix WebSocket)
│       │   ├── MqttForegroundService.java     # Foreground Service 保持 WS 連線
│       │   ├── ShadowManager.java             # 裝置 Shadow (reported / desired / delta)
│       │   │
│       │   ├── ── WebView 橋接 ─────────────────────────────────
│       │   ├── PlayerJsBridge.java            # window.player JS API 實作
│       │   │
│       │   ├── ── 設定與啟動 ───────────────────────────────────
│       │   ├── ConfigManager.java             # SharedPreferences 包裝
│       │   ├── BootReceiver.java              # 開機自動啟動
│       │   │
│       │   └── model/
│       │       ├── PlayerConfig.java          # 裝置設定資料類別
│       │       ├── SyncResponse.java          # player-sync 回應 POJO
│       │       └── MqttCommand.java           # Realtime 指令 POJO
│       │
│       └── res/
│           ├── layout/                        # activity_main.xml, activity_settings.xml
│           └── values/                        # strings.xml, colors.xml
```

### 外部儲存目錄結構（裝置端）

```
/sdcard/SignEffeX/
└── cas/
    ├── <64 char sha256>           # 正式檔案（無副檔名，以內容定址）
    ├── <64 char sha256>.tmp       # 下載中暫存（重啟後自動清除）
    ├── _failures.json             # 持久化失敗記錄
    └── ...

# 備用路徑（API 30+，未授予 MANAGE_EXTERNAL_STORAGE 時）
/data/user/0/com.signcms.player/files/external/cas/
```

> **CAS 命名原則**：目錄內只允許出現 64 字元 hex SHA-256 為名的檔案（含 `.tmp` 後綴的暫存版）。嚴禁在同步路徑出現原始檔名。

---

## 4. 類別職責說明

### `SignCMSApplication.java`
Application 級別的單例管理，負責初始化並持有以下全域物件：
- `OkHttpClient`（全域共用，統一 timeout 設定）
- `DownloadService`（CAS 同步引擎）
- `Gson`

### `MainActivity.java`
主 Activity，負責：
- 建立沉浸式全螢幕 WebView
- 啟動 `PlayerSyncManager` 每 30 秒同步
- 收到 `SyncResponse` 後執行二階段快取（CAS → WebView）
- 觸發 `RealtimeManager` 訂閱 `screen:<id>` 頻道
- 將 `DownloadService` 以 `DiskStatusProvider` 介面注入 `PlayerSyncManager`
- 三連點 Back 鍵顯示 HUD（除錯資訊）

**二階段同步流程（`handleSyncData()`）：**
```
SyncResponse 含 asset_manifest
    │
    ▼ Stage 1
DownloadService.syncAssets(entries)
    │ onComplete(casFiles: Map<sha256, File>)
    ▼ Stage 2
MediaCacheManager.prewarmAssets(refs)
    │ WebView shouldInterceptRequest() 已可攔截
    ▼
renderer 呈現畫面
```

### `PlayerSyncManager.java`
- 每 30 秒執行 `doSync()`，使用 `ScheduledExecutorService`
- 攜帶 ETag（`project_etag = lastSync.project.updatedAt`）
- 批次上傳最多 200 筆播放紀錄
- 透過 `DiskStatusProvider` 介面收集 `disk_status` 遙測
- 靜默錯誤：telemetry 異常不中斷同步

```java
public interface DiskStatusProvider {
    @Nullable JsonObject getDiskStatusJson();
}
```

### `DownloadService.kt`
CAS 同步引擎，詳見 [第 5 節](#5-cas-檔案管理)。

### `MediaCacheManager.java`
- 維護 `Map<String url, String localFilePath>` 記憶體索引
- `shouldInterceptRequest()` 攔截 WebView HTTP 請求，改由本機 `file://` 提供
- 以 sha256 為 key 做跨 URL 去重（同內容不同 URL 只存一份）
- Manifest 更新以 30 秒 debounce 寫入磁碟（防止 eMMC 過度寫入）

### `RealtimeManager.java`
- 訂閱 Supabase Realtime 頻道 `realtime:screen:<screenId>`
- Phoenix WebSocket 協議：`[join_ref, ref, topic, event, payload]`
- 收到 `broadcast` 事件時，透過 `PlayerJsBridge` 分派至 WebView

### `PlayerJsBridge.java`
暴露給渲染器 JS 的 `window.player` API：

| 方法 | 方向 | 說明 |
|------|------|------|
| `getCachedUrl(url)` | JS→Java | 查詢本機快取路徑，回傳 `file://...` 或空字串 |
| `prewarmCache(urlsJson)` | JS→Java | 批次預熱快取 |
| `addLog(jsonStr)` | JS→Java | 新增播放紀錄（僅接受 `media_id`, `duration_seconds`） |
| `forceSync()` | JS→Java | 立即觸發一次同步 |
| `getCacheStats()` | JS→Java | 取得快取統計 JSON |
| `getVersion()` | JS→Java | 回傳 `BuildConfig.VERSION_NAME` |
| `openSettings()` | JS→Java | 開啟設定 Activity |

事件（Java → WebView）：

| 事件 | 說明 |
|------|------|
| `window.__signSyncData(json)` | 同步成功，派發新的 project/channel 資料 |
| `window.__signSyncError(err)` | 同步失敗通知 |
| `window.__signMqttCmd(json)` | 收到即時指令 |
| `window.__signShadowDelta(json)` | 收到 shadow delta |
| `window.__signMqttStatus(json)` | WebSocket 連線狀態變更 |

### `ShadowManager.java`
- 維護裝置期望狀態（`desired`）與回報狀態（`reported`）
- 計算 delta（desired - reported）
- 套用 delta：切換頻道、調整音量等
- 套用後呼叫 `PlayerSyncManager.postShadowReport()` 向伺服器確認

---

## 5. CAS 檔案管理

### 同步演算法（`DownloadService.syncAssets()`）

```
INPUT: asset_manifest = [{url, sha256, size}, ...]

1. cleanupOrphans()
   - 刪除所有 *.tmp 檔案
   - 刪除長度為 0 的 <sha256> 檔案

2. Diff 計算
   FOR each entry in manifest WHERE sha256 != null:
     f = File("/sdcard/SignEffeX/cas/<sha256>")
     IF !f.exists()            → 標記為 missing
     IF f.length() == 0        → 刪除，標記為 missing（磁碟損壞）
     IF f.length() != entry.size → 刪除，標記為 missing（大小不符）
     IF sha256 in failureLog && attempts >= MAX_RETRY → 永久跳過
     ELSE                      → 已完整，跳過

3. 並行下載（最多 3 個 coroutine）
   FOR each sha256 in missing:
     a. 下載至 <sha256>.tmp
     b. 計算下載內容的 SHA-256（背景執行緒）
     c. IF hash 不符 → 刪除 .tmp，記錄 FailureRecord，重試
     d. IF hash 相符：
          FileOutputStream.flush()
          FileDescriptor.sync()     ← fsync：確保寫入 eMMC
          File.renameTo(<sha256>)   ← atomic rename

4. LRU 淘汰
   IF freeBytesExternal < MIN_FREE_BYTES (512 MB):
     刪除不在當前 manifest 的檔案（按 mtime 由舊到新）
     直到 free >= 75% of 512 MB

5. 更新 lruMap（記憶體，mtime 節流 60 秒寫磁碟）

6. 建立 casFiles: Map<sha256, File>
   回呼 onComplete(casFiles)
```

### 失敗記錄（`_failures.json`）

```json
{
  "abc123...": {
    "sha256": "abc123...",
    "url": "https://cdn.example.com/assets/abc123.mp4",
    "attempts": 3,
    "lastFailedMs": 1715000000000,
    "expectedHash": "abc123...",
    "actualHash": "def456...",
    "lastError": "hash mismatch"
  }
}
```

- `attempts >= MAX_RETRY (3)` 時，永久標記為失敗，不再重試
- 檔案只在狀態變更時寫入磁碟（`failureLogDirty` flag）

### LRU 淘汰策略

| 條件 | 行動 |
|------|------|
| `freeBytesExternal < 512 MB` | 啟動淘汰 |
| 淘汰目標 | 不在當前 manifest 的 sha256 檔案 |
| 淘汰順序 | mtime 由舊至新（Least Recently Used） |
| 淘汰目標大小 | 恢復至 512 MB × 75% = 384 MB headroom |
| mtime 更新 | 每次 `getLocalFile()` 呼叫時，節流至每 60 秒寫一次 |

### `verifyIntegrity()`（OTA 後完整性驗證）

```kotlin
fun verifyIntegrity(progress: (checked: Int, total: Int, sha256: String, ok: Boolean) -> Unit)
```

- 掃描 cas/ 目錄內所有 64 字元檔案
- 逐一計算 SHA-256，比對檔名
- 回報進度；不符者自動刪除，等待下次同步重下
- 適用於：OTA 韌體升級後、eMMC 錯誤恢復

---

## 6. 同步協議（Sync Protocol）

### 請求（`POST /player-sync`）

**Header：**
```
x-device-token: <device_token>
Content-Type: application/json
```

**Body：**
```json
{
  "project_etag": "2026-05-10T12:00:00.000Z",
  "log_batch": [
    { "media_id": "uuid-v4", "duration_seconds": 30 }
  ],
  "reported": {
    "channel_id": "uuid",
    "status": "playing",
    "version": "1.2.3"
  },
  "disk_status": {
    "casDirPath": "/sdcard/SignEffeX/cas",
    "casTotalBytes": 2147483648,
    "casFileCount": 42,
    "freeBytesExternal": 10737418240,
    "manifestTotal": 50,
    "manifestSynced": 48,
    "manifestPending": 2,
    "manifestFailed": 0,
    "failures": []
  }
}
```

### 回應

```json
{
  "ok": true,
  "server_time": "2026-05-10T12:00:01.000Z",
  "screen": { "id": "uuid", "name": "Lobby Screen", "org_id": "uuid" },
  "channel": { "id": "uuid", "name": "Main Channel", "aspect": "16:9", "bgm_volume": 50 },
  "project": {
    "id": "uuid",
    "name": "Spring Campaign",
    "aspect": "16:9",
    "zones": { ... },
    "updated_at": "2026-05-10T12:00:00.000Z",
    "zones_changed": true,
    "asset_manifest": [
      { "url": "https://cdn.../assets/abc123.mp4", "sha256": "abc123...", "size": 10485760 }
    ]
  },
  "announcements": [],
  "shadow": { "desired": {}, "delta": {} },
  "realtime": { "channel": "screen:uuid", "apikey": "anon-key" }
}
```

### ETag 最佳化

```
Client sends: project_etag = "2026-05-10T11:00:00.000Z"
Server checks: project.updated_at == project_etag?
  YES → zones_changed: false  (省略 zones 欄位，節省頻寬)
  NO  → zones_changed: true   (回傳完整 zones JSON)

注意：asset_manifest 無論如何都會回傳（讓播放器暖快取）
```

---

## 7. 頻道與排程解析

### 頻道解析優先順序

```
1. screens.current_channel_id
   AND screens.channel_override_until > NOW()
   → 時間限制覆蓋（例：緊急公告）

2. screen_channel_subscriptions
   WHERE screen_id = ? AND is_default = true
   → 預設頻道

3. screen_channel_subscriptions
   WHERE screen_id = ?
   LIMIT 1
   → 任一頻道（fallback）
```

### 排程播放（channel_blocks）解析

每次 player-sync 都會重算目前有效的 `design_project_id`：

```
activeProjectId = channel.default_design_project_id

FOR each block in channel_blocks WHERE enabled = true ORDER BY priority DESC:
  IF block.weekdays 不為空 AND 今日 weekday NOT IN block.weekdays → 跳過
  IF block.start_time AND now < block.start_time → 跳過
  IF block.end_time   AND now > block.end_time   → 跳過
  IF block.effective_from AND today < block.effective_from → 跳過
  IF block.effective_to   AND today > block.effective_to   → 跳過
  → activeProjectId = block.design_project_id
  BREAK（最高優先權的符合排程勝出）
```

**channel_blocks 欄位說明：**

| 欄位 | 型別 | 說明 |
|------|------|------|
| `channel_id` | UUID | 所屬頻道 |
| `design_project_id` | UUID | 排程期間使用的設計專案 |
| `priority` | int | 數值越高越優先 |
| `weekdays` | int[] | 0=週日…6=週六，空陣列=每天 |
| `start_time` | time | 開始時間（HH:MM:SS） |
| `end_time` | time | 結束時間（HH:MM:SS） |
| `effective_from` | date | 生效起始日期（YYYY-MM-DD） |
| `effective_to` | date | 生效截止日期（YYYY-MM-DD） |
| `enabled` | bool | 停用不影響其他排程 |

---

## 8. 播放紀錄（Playback Log）

### 資料流

```
渲染器（JS）
  window.player.addLog({ media_id: "uuid", duration_seconds: 30 })
       ↓
PlayerJsBridge.addLog()
  ← 只讀取 media_id, duration_seconds（忽略 media_name，防止污染）
       ↓
PlayerSyncManager.logBatch（最多 200 筆）
       ↓
POST /player-sync body.log_batch
       ↓
player-sync Edge Function：
  1. 收集所有 media_id
  2. SELECT id, name FROM media_items WHERE id IN (...)
  3. 建立 Map<media_id, name>
  4. INSERT INTO playback_logs (screen_id, org_id, media_id, media_name, duration_seconds, played_at)
     media_name 來自 DB JOIN，非 client 提供
```

### 設計原則

- **渲染器只傳 UUID**（`media_id`）：不信任 client 端提供的 `media_name`
- **伺服器解析真實檔名**：透過 `media_items.name` JOIN，保持 CAS 紀律
- **查詢顯示名稱**：`SELECT pl.*, mi.original_name FROM playback_logs pl JOIN media_items mi ON pl.media_id = mi.id`
- **保留期限**：90 天，每日 03:00 UTC 由 pg_cron 清除

---

## 9. 即時指令（Realtime Commands）

### 訂閱

播放器在首次同步取得 `realtime.channel` 與 `realtime.apikey` 後，建立 WebSocket：

```
ws://[supabase-host]/realtime/v1/websocket?apikey=<anon_key>
Topic: realtime:screen:<screenId>
```

### 支援指令（`window.__signMqttCmd`）

| 指令 `type` | 說明 |
|------------|------|
| `content.sync` | 立即觸發 `forceSync()`，取得最新內容 |
| `channel.override` | 設定時間限制頻道覆蓋 |
| `shadow.update` | 更新 desired state，播放器套用 delta |
| `reboot` | 重啟 Android Activity |
| `screenshot` | 截圖並上傳（選配） |

---

## 10. 裝置 Shadow 狀態

Shadow 提供「期望狀態 vs 實際狀態」的一致性保證：

```
Server desired: { channel_id: "A", volume: 80 }
Device reported: { channel_id: "B", volume: 50 }
Delta (computed by DB trigger): { channel_id: "A", volume: 80 }

↓ 播放器套用 delta
↓ 切換頻道至 A，調整音量至 80
↓ POST /shadow-report { reported: { channel_id: "A", volume: 80 } }
↓ Server 確認 delta 清空
```

**`screen_shadows` 表：**
- `screen_id` (PK)
- `desired` (JSONB)
- `reported` (JSONB)
- `delta` (JSONB，由 DB trigger 自動計算 desired - reported 的差集)

---

## 11. 後端 Edge Functions 規格

### `POST /player-sync`

| 項目 | 說明 |
|------|------|
| 認證 | `x-device-token` header |
| 心跳更新 | 每次請求更新 `screens.last_ping_at`, `online=true` |
| disk_status | 有傳則寫入 `screens.disk_status` + `disk_status_at` |
| ETag 最佳化 | `project_etag` 相符則跳過 zones JSON |
| asset_manifest | 每次都回傳（含 sha256, size） |
| log_batch | 限制 200 筆，media_name 由 DB JOIN 解析 |

### `GET /player-dashboard`

| 項目 | 說明 |
|------|------|
| 認證 | `Authorization: Bearer <SERVICE_ROLE_KEY>` |
| 查詢參數 | `?org_id=`, `?failed=true`, `?stale=true` |
| stale 定義 | `disk_status_at` 超過 5 分鐘未更新 |
| 計算欄位 | `sync_pct`, `free_gb`, `has_failures`, `is_stale` |

**回應範例：**
```json
{
  "ok": true,
  "generated_at": "2026-05-10T12:00:00Z",
  "total_players": 12,
  "stats": {
    "total": 12,
    "online": 10,
    "with_failures": 1,
    "stale": 2,
    "fully_synced": 9
  },
  "players": [...]
}
```

### `POST /upload-media`

去重邏輯（依序檢查，任一命中即回傳現有資產）：

```
1. 同組織 sha256 相符 → 409（org-level dedup）
2. 跨組織 sha256 相符 → 重用 Storage URL（cross-org dedup）
3. 同組織 md5+size 相符 → 409（legacy row dedup）
4. 全無命中 → 上傳至 media/assets/<sha256>.<ext>，INSERT media_items
```

**回傳 HTTP 碼：**
- `201 Created`：新資產
- `200 OK`：已存在（去重命中）
- `409 Conflict`：同組織重複（由呼叫方處理）

---

## 12. 資料庫關鍵表格

### `screens`

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | UUID PK | |
| `org_id` | UUID FK | 所屬組織 |
| `name` | text | 顯示名稱 |
| `device_token` | text UNIQUE | 裝置認證 token |
| `online` | bool | 是否在線（由心跳維持） |
| `status` | text | online / offline |
| `last_ping_at` | timestamptz | 最後心跳時間 |
| `current_channel_id` | UUID | 時間限制覆蓋頻道 |
| `channel_override_until` | timestamptz | 覆蓋到期時間 |
| `disk_status` | JSONB | CAS 遙測快照 |
| `disk_status_at` | timestamptz | 遙測時間戳 |

### `media_items`

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | UUID PK | |
| `org_id` | UUID FK | |
| `design_project_id` | UUID FK | |
| `name` | text | 顯示名稱（無副檔名） |
| `original_name` | text | 上傳時的原始檔名 |
| `url` | text | CDN 公開 URL |
| `sha256` | char(64) | CAS Hash（null for legacy） |
| `size_bytes` | bigint | 檔案大小 |
| `type` | text | image / video |
| `deleted_at` | timestamptz | 軟刪除時間戳 |

### `playback_logs`（分區表，按月）

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | UUID | |
| `screen_id` | UUID FK | |
| `org_id` | UUID | |
| `media_id` | UUID FK | 參照 media_items.id |
| `media_name` | text | 由伺服器 JOIN 解析，非 client 提供 |
| `duration_seconds` | int | 播放秒數 |
| `played_at` | timestamptz | 播放時間（分區鍵） |

> 分區策略：`PARTITION BY RANGE (played_at)`，每月一個分區。
> 保留策略：pg_cron 每日 03:00 UTC 刪除超過 90 天的舊分區。

---

## 13. 配置常數參考表

| 常數 | 值 | 位置 | 說明 |
|------|----|------|------|
| `SYNC_INTERVAL_MS` | 30,000 ms | `MainActivity.java` | 輪詢間隔 |
| `MIN_FREE_BYTES` | 512 MB | `DownloadService.kt` | 觸發 LRU 淘汰門檻 |
| `MAX_CONCURRENT` | 3 | `DownloadService.kt` | 最大並行下載數 |
| `MAX_RETRY` | 3 | `DownloadService.kt` | 永久失敗閾值 |
| `SHA256_LEN` | 64 | `DownloadService.kt` | CAS 檔名長度驗證 |
| `LRU_MTIME_INTERVAL` | 60,000 ms | `DownloadService.kt` | mtime 寫磁碟節流 |
| `MANIFEST_DEBOUNCE_MS` | 30,000 ms | `MediaCacheManager.java` | Manifest 延遲寫入 |
| `LOG_BATCH_MAX` | 200 | `PlayerSyncManager.java` | 最大待傳播放紀錄筆數 |
| `STALE_THRESHOLD_MS` | 300,000 ms | `player-dashboard` | disk_status 5 分鐘無更新視為 stale |
| `ASSET_MANIFEST_LIMIT` | 500 | `player-sync` | 單專案最大媒體項目數 |
| `LOG_RETENTION_DAYS` | 90 | Migration SQL | playback_logs 保留天數 |

---

## 14. eMMC 磨損防護機制

數位看板裝置全天 24 小時運行，過度寫入會縮短 eMMC 壽命。以下是系統中採取的防護措施：

### 問題一：LRU mtime 每次存取都更新

**症狀**：`MediaCacheManager.getLocalFileUrl()` 可能每秒被呼叫數十次（每個視頻幀的 WebView 請求）。

**解法**：在 `DownloadService` 的 `lruWriteThrottle: HashMap<sha256, Long>` 中記錄上次寫入時間。只有距上次寫入超過 60 秒才呼叫 `File.setLastModified()`。記憶體中的 LRU 順序始終精確，不依賴磁碟 mtime。

### 問題二：Manifest JSON 每次下載/淘汰都全量覆寫

**症狀**：每次 `downloadAsset()` 或 `evict()` 都觸發 `saveManifest()`，等於每下載一個檔案就重寫整個索引。

**解法**：`MediaCacheManager` 使用 `ScheduledExecutorService` 配合 dirty flag，30 秒 debounce 後才執行實際寫入：

```java
private void scheduleManifestSave() {
    manifestDirty = true;
    if (pendingSave != null && !pendingSave.isDone()) pendingSave.cancel(false);
    pendingSave = saveScheduler.schedule(
        this::flushManifest, MANIFEST_DEBOUNCE_MS, TimeUnit.MILLISECONDS);
}
```

### 問題三：失敗記錄頻繁更新

**解法**：`DownloadService` 維護 `failureLogDirty: Boolean`。僅在失敗狀態實際改變（新增失敗、重試更新）時才寫入 `_failures.json`。

---

## 15. 斷電恢復機制

### 下載中途斷電

```
風險：rename() 後，kernel write-back cache 尚未 flush 到 eMMC
     → 正確 SHA-256 名稱，但檔案內容損壞或截斷

防護：
1. fsync()：在 rename() 前確保資料寫入實體儲存
   FileOutputStream.flush()
   FileDescriptor.sync()    ← 重點：等 kernel buffer 清空
   File.renameTo(<sha256>)  ← 之後才 rename

2. 啟動時 cleanupOrphans()：
   - 刪除 *.tmp 檔（中斷的下載）
   - 刪除 length == 0 的 <sha256>（空白損壞檔）

3. Diff 時大小驗證：
   - f.length() != manifest.size → 視為損壞，刪除重下

4. 重啟後自動重下：
   - 損壞或缺失的 sha256 在下次 syncAssets() 時進入 missing 清單
```

### OTA 韌體升級後

```
風險：韌體升級可能影響檔案系統完整性

防護：verifyIntegrity() 全量掃描
  - 遍歷 cas/ 所有 64 字元檔案
  - 重新計算 SHA-256，比對檔名
  - 不符者刪除，等待 player-sync 重下
  - 建議在首次啟動後（BOOT_COMPLETED）、版本升級後觸發
```

---

*文件結束。如需更新，請同步修改 `SIGNCMS_PLAYER_SPEC.md` 及相關源碼註解。*
