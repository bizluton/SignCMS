# SignCMS × Management Software 整合規格文件

**版本：** 1.0  
**更新日期：** 2026-05-02  
**適用對象：** Management Software / APK 開發者

---

## 目錄

1. [系統架構總覽](#1-系統架構總覽)
2. [內容派送流程](#2-內容派送流程)
3. [HTTP API 規格](#3-http-api-規格)
   - 3.1 player-sync（完整同步）
   - 3.2 player-trigger（Smart Trigger 輪詢）
4. [MQTT 規格](#4-mqtt-規格)
   - 4.1 連線設定
   - 4.2 Topic 結構
   - 4.3 訊息格式
   - 4.4 HTTP Bridge
5. [Playlist / Schedule 資料規格](#5-playlist--schedule-資料規格)
6. [媒體檔案管理](#6-媒體檔案管理)
7. [Smart Trigger 規格](#7-smart-trigger-規格)
8. [程式碼範本](#8-程式碼範本)

---

## 1. 系統架構總覽

```
┌─────────────────────────────────────────────────────────────┐
│                     公司內網 (Intranet)                       │
│                                                             │
│  ┌─────────────┐    MQTT      ┌──────────────────────────┐  │
│  │  Mosquitto  │◄────────────►│  Management Software     │  │
│  │   Broker    │  subscribe   │  (APK on Android device) │  │
│  └──────┬──────┘              └────────────┬─────────────┘  │
│         │ publish                          │ HTTP API        │
│  ┌──────▼──────┐                           │ (備援輪詢)       │
│  │ HTTP Bridge │                           │                 │
│  │  (Node.js)  │                           │                 │
│  └──────▲──────┘                           │                 │
└─────────│─────────────────────────────────│─────────────────┘
          │ HTTPS POST                       │ HTTPS GET
          │                                  │
┌─────────┴──────────────────────────────────▼─────────────────┐
│                     Supabase Cloud                            │
│                                                               │
│  Edge Functions:                                              │
│    notify-screen      ────────► mqttPublish ──► HTTP Bridge  │
│    smart-trigger-webhook ──────► mqttPublish ──► HTTP Bridge  │
│    player-sync        ◄── GET /functions/v1/player-sync       │
│    player-trigger     ◄── GET /functions/v1/player-trigger    │
│                                                               │
│  Storage:  media files (CDN URL)                              │
│  Database: schedules, media_items, smart_trigger_*            │
└───────────────────────────────────────────────────────────────┘
```

### 角色說明

| 元件 | 位置 | 說明 |
|------|------|------|
| SignCMS Admin UI | Cloud (Supabase) | 內容管理後台，供操作人員編排排程與素材 |
| Supabase Edge Functions | Cloud | REST API 端點，負責授權、資料查詢與 MQTT 推播 |
| Supabase Storage | Cloud (CDN) | 媒體檔案儲存（圖片、影片、音訊），提供 HTTPS 下載 URL |
| HTTP Bridge | 公司機房（公開端點） | 接收 Supabase 的 HTTP POST，轉發至內部 Mosquitto |
| Mosquitto Broker | 公司機房（內網） | MQTT 訊息中介，負責推播到所有 Player |
| Management Software | Android Device | 處理排程邏輯、媒體下載、播放控制 |

---

## 2. 內容派送流程

### 2.1 正常更新流程（Push + Pull）

```
Admin 存檔
    │
    ▼
notify-screen（Edge Function）
    │  POST /functions/v1/notify-screen
    │  { "screen_id": "uuid" }
    ▼
player-sync（內部呼叫）
    │  取得完整 playlist / 媒體清單
    ▼
mqttPublish
    │  POST https://mqtt-bridge.example.com/publish
    │  topic: signcms/{org_id}/screen/{screen_id}
    │  retain: true, QoS: 1
    ▼
HTTP Bridge → Mosquitto → Management Software
    │
    ▼
Management Software 比對 sync_token
    ├── 相同 → 略過（無需重新下載）
    └── 不同 → 下載差異媒體檔案 → 更新播放排程
```

### 2.2 設備啟動流程

```
設備開機
    │
    ▼
Management Software 連線至 Mosquitto
    │  subscribe: signcms/{org_id}/screen/{screen_id}
    │  subscribe: signcms/{org_id}/trigger/{screen_id}
    │  subscribe: signcms/{org_id}/trigger/broadcast
    │
    ├── Mosquitto 立即回放 retained 訊息（若存在）
    │       → 解析 sync 訊息，比對 sync_token
    │       → 若與本機不同，下載差異檔案
    │
    └── 呼叫 player-sync HTTP API（保底確認）
            GET /functions/v1/player-sync?screen_id=xxx
```

### 2.3 網路中斷後重連流程

```
網路恢復 → MQTT 重連
    │
    ├── Mosquitto 自動回放最後 retained 訊息
    │       → 立即取得最新排程，無需輪詢
    │
    └── player-trigger 輪詢繼續（每 10 秒）
            → 使用本機儲存的 since 游標
            → 補齊斷線期間錯過的 trigger 事件
```

### 2.4 Smart Trigger 觸發流程

```
IoT 感測器 / 外部系統
    │
    ▼
smart-trigger-webhook（Edge Function）
    POST /functions/v1/smart-trigger-webhook
    │
    ├── 驗證 webhook token
    ├── 比對觸發規則（冷卻時間、條件）
    ├── 寫入 smart_trigger_logs
    │
    └── mqttPublish（fire-and-forget）
            topic: signcms/{org_id}/trigger/{screen_id}
            retain: false, QoS: 0

Management Software 收到 MQTT trigger 訊息
    → 立即顯示指定 design 內容 duration_seconds 秒
    → 計時結束後恢復正常排程播放

（備援）player-trigger 每 10 秒輪詢
    → 確保 MQTT 不通時仍可收到 trigger 事件
```

---

## 3. HTTP API 規格

Base URL：`https://{SUPABASE_PROJECT_REF}.supabase.co/functions/v1`

所有請求均需帶入：
```
Authorization: Bearer {SUPABASE_ANON_KEY}
apikey: {SUPABASE_ANON_KEY}
```

---

### 3.1 player-sync — 完整同步

**用途：** 取得完整的排程清單、媒體清單、Smart Trigger 規則。設備啟動、MQTT 離線備援、sync_token 變動時呼叫。

```
GET /functions/v1/player-sync?screen_id={uuid}
```

**回應（授權成功）：**

```json
{
  "licensed": true,
  "license_status": "active",
  "sync_token": "2026-05-01T10:30:00.000Z",
  "screen": {
    "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "name": "大廳螢幕 A",
    "org_id": "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy",
    "resolution": "1920x1080"
  },
  "schedules": [ ... ],
  "smart_triggers": [ ... ]
}
```

**回應（未授權 / 授權到期）：**

```json
{
  "licensed": false,
  "license_status": "revoked",
  "revoked_at": "2026-04-01T00:00:00.000Z",
  "screen": null,
  "schedules": [],
  "smart_triggers": [],
  "sync_token": "2026-05-01T10:30:00.000Z"
}
```

**APK 處理邏輯：**

1. 儲存 `sync_token` 至本機
2. 下次呼叫前，若 token 未變動則略過重新處理
3. 對照 `media.md5`：md5 不符或檔案不存在 → 重新下載
4. 清除本機中不再出現於任何排程的媒體檔案

---

### 3.2 player-trigger — Smart Trigger 事件輪詢

**用途：** 輪詢 Smart Trigger 觸發事件，作為 MQTT 推播的備援機制。Management Software 每 **10 秒** 呼叫一次。

```
GET /functions/v1/player-trigger
    ?screen_id={uuid}
    &org_id={uuid}
    &since={ISO-8601}
```

| 參數 | 必填 | 說明 |
|------|------|------|
| `screen_id` | 是 | 裝置的 Screen UUID |
| `org_id` | 是 | 組織 UUID |
| `since` | 否 | 上次成功輪詢的 `server_time`；省略時預設為 now−30s |

**回應：**

```json
{
  "events": [
    {
      "log_id":          "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "rule_id":         "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy",
      "trigger_key":     "iot_sensor_1",
      "design_id":       "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz",
      "design_name":     "緊急公告",
      "duration_seconds": 30,
      "fired_at":        "2026-05-01T12:00:05.000Z"
    }
  ],
  "server_time": "2026-05-01T12:00:10.000Z"
}
```

**APK 處理邏輯：**

1. `events` 非空 → 立即顯示最新 `design_id` 內容，持續 `duration_seconds` 秒
2. 計時結束後恢復正常排程播放
3. 若播放期間收到新 event → 以最新 event 取代目前播放內容
4. 成功回應後，將 `server_time` 儲存為下次請求的 `since` 值

---

## 4. MQTT 規格

### 4.1 連線設定

| 項目 | 值 |
|------|-----|
| Broker | 公司內網 Mosquitto（自建） |
| Protocol | MQTT 3.1.1 |
| Port | 1883（明文）/ 8883（TLS，建議正式環境） |
| Keep-alive | 60 秒 |
| Clean Session | `false`（重連後補收 QoS 1 未確認訊息） |
| Client ID 格式 | `signcms-{screen_id}` |

### 4.2 Topic 結構

| Topic | 方向 | Retain | QoS | 說明 |
|-------|------|--------|-----|------|
| `signcms/{org_id}/screen/{screen_id}` | Cloud → APK | **true** | 1 | 完整排程同步（fat message）。retain=true 確保重連後立即取得最新排程 |
| `signcms/{org_id}/trigger/{screen_id}` | Cloud → APK | false | 0 | 針對特定螢幕的 Smart Trigger 事件 |
| `signcms/{org_id}/trigger/broadcast` | Cloud → APK | false | 0 | 全組織 Smart Trigger 事件（screen_id 未指定時） |
| `signcms/{org_id}/broadcast` | Cloud → APK | **true** | 1 | 全組織排程廣播（未來預留） |

**APK 訂閱範本（啟動時執行）：**

```java
// 訂閱單一螢幕的同步訊息
mqttClient.subscribe("signcms/" + orgId + "/screen/" + screenId, 1);

// 訂閱針對此螢幕的 trigger
mqttClient.subscribe("signcms/" + orgId + "/trigger/" + screenId, 0);

// 訂閱全組織廣播 trigger
mqttClient.subscribe("signcms/" + orgId + "/trigger/broadcast", 0);
```

### 4.3 訊息格式

所有 MQTT 訊息的 payload 均為 **UTF-8 JSON**，遵循以下外層結構：

```json
{
  "v": 1,
  "type": "sync | trigger | command | license",
  "ts": "2026-05-01T12:00:00.000Z",
  "org_id": "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy",
  "screen_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "payload": { }
}
```

| 欄位 | 型別 | 說明 |
|------|------|------|
| `v` | number | 訊息 schema 版本，目前固定為 `1` |
| `type` | string | 訊息類型，見下方說明 |
| `ts` | string | Server 時間（ISO-8601）|
| `org_id` | string | 組織 UUID |
| `screen_id` | string \| null | 螢幕 UUID；null 表示全組織廣播 |
| `payload` | object | 依 type 不同而異 |

#### type = "sync"

`payload` 與 `player-sync` HTTP API 回應完全相同：

```json
{
  "payload": {
    "licensed": true,
    "license_status": "active",
    "sync_token": "2026-05-01T10:30:00.000Z",
    "screen": { ... },
    "schedules": [ ... ],
    "smart_triggers": [ ... ]
  }
}
```

#### type = "trigger"

```json
{
  "payload": {
    "rules": [
      {
        "rule_id":         "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy",
        "trigger_key":     "iot_sensor_1",
        "design_id":       "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz",
        "duration_seconds": 30
      }
    ]
  }
}
```

#### type = "license"（未來預留）

```json
{
  "payload": {
    "licensed": false,
    "license_status": "revoked",
    "revoked_at": "2026-04-01T00:00:00.000Z"
  }
}
```

### 4.4 HTTP Bridge

由於 Mosquitto Broker 位於公司內網，SignCMS Cloud 無法直接連線。採用 **HTTP Bridge** 模式：Supabase Edge Function 透過 HTTPS 呼叫公司部署的 Bridge 服務，Bridge 再以 MQTT client 轉發至 Mosquitto。

#### 架構圖

```
Supabase Edge Function
        │
        │  POST https://mqtt-bridge.example.com/publish
        │  Authorization: Bearer {MQTT_BRIDGE_SECRET}
        │  {
        │    "topic":   "signcms/xxx/screen/yyy",
        │    "payload": { ... MqttMessage ... },
        │    "retain":  true,
        │    "qos":     1
        │  }
        ▼
HTTP Bridge（公司機房，公開 HTTPS 端點）
        │
        │  mqtt.publish(topic, JSON.stringify(payload), {retain, qos})
        ▼
Mosquitto Broker（內網）
        │
        │  MQTT push
        ▼
Management Software（Android APK）
```

#### Supabase 需設定的環境變數

| 變數名 | 說明 |
|--------|------|
| `MQTT_BRIDGE_URL` | Bridge 端點 URL，例：`https://mqtt-bridge.example.com/publish` |
| `MQTT_BRIDGE_SECRET` | 共用密鑰，Bridge 驗證用 |

#### Bridge 服務範本（Node.js）

```javascript
// mqtt-bridge/server.js
import express from 'express';
import mqtt    from 'mqtt';

const app    = express();
const SECRET = process.env.BRIDGE_SECRET;           // 與 MQTT_BRIDGE_SECRET 相同
const broker = mqtt.connect(process.env.MQTT_URL ?? 'mqtt://localhost:1883');

app.use(express.json({ limit: '2mb' }));

broker.on('connect', () => console.log('[bridge] connected to Mosquitto'));
broker.on('error',   (err) => console.error('[bridge] MQTT error:', err));

app.post('/publish', (req, res) => {
  // 驗證 Bearer token
  const auth = (req.headers['authorization'] ?? '').trim();
  if (auth !== `Bearer ${SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { topic, payload, retain = false, qos = 0 } = req.body;
  if (!topic || !payload) {
    return res.status(400).json({ error: 'topic and payload are required' });
  }

  broker.publish(
    topic,
    JSON.stringify(payload),
    { retain, qos },
    (err) => {
      if (err) {
        console.error('[bridge] publish error:', err);
        return res.status(500).json({ error: err.message });
      }
      res.json({ ok: true, topic });
    }
  );
});

app.listen(process.env.PORT ?? 3000, () =>
  console.log('[bridge] listening on port', process.env.PORT ?? 3000)
);
```

```json
// package.json
{
  "type": "module",
  "dependencies": {
    "express": "^4.18.0",
    "mqtt": "^5.0.0"
  }
}
```

#### Bridge 安全建議

- 部署於公司 DMZ，僅開放 Supabase IP 範圍存取（Supabase 出口 IP 可在 Dashboard → Settings → Network 查詢）
- 正式環境強制使用 TLS（nginx 反向代理 + Let's Encrypt）
- `BRIDGE_SECRET` 最少 32 bytes 隨機值，定期輪換

---

## 5. Playlist / Schedule 資料規格

以下為 `player-sync` 回應中 `schedules` 陣列的完整結構說明。

### 5.1 Schedule 物件

```json
{
  "id":         "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "name":       "白天排程",
  "enabled":    true,
  "time_rules": {
    "start": "09:00",
    "end":   "18:00",
    "days":  ["Mon", "Tue", "Wed", "Thu", "Fri"]
  },
  "updated_at": "2026-05-01T08:00:00.000Z",
  "playlist":   [ ... PlaylistItem[] ... ],
  "bgm": {
    "volume": 30,
    "tracks": [ ... BgmTrack[] ... ]
  }
}
```

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | string | Schedule UUID |
| `name` | string | 管理用名稱 |
| `enabled` | boolean | `false` 時此排程不應播放 |
| `time_rules.start` | string | 播放開始時間 `HH:MM`（24h） |
| `time_rules.end` | string | 播放結束時間 `HH:MM`（24h） |
| `time_rules.days` | string[] | 播放日，值為 `"Mon"` `"Tue"` `"Wed"` `"Thu"` `"Fri"` `"Sat"` `"Sun"` |
| `bgm.volume` | number | 背景音樂音量 0–100 |

**排程選擇邏輯（APK 端）：**

```
目前時間 T = now()
目前星期 D = today()

可播放排程 = schedules.filter(s =>
    s.enabled == true
    AND D in s.time_rules.days
    AND T >= parse(s.time_rules.start)
    AND T <  parse(s.time_rules.end)
)

若無可播放排程 → 顯示空白畫面 / 待機畫面
若多個排程同時符合 → 依陣列順序取第一個
```

### 5.2 PlaylistItem 物件

```json
{
  "id":       "item-uuid",
  "type":     "image",
  "duration": 10,
  "media": {
    "id":               "media-uuid",
    "name":             "product_banner.jpg",
    "url":              "https://xxx.supabase.co/storage/v1/object/public/media/product_banner.jpg",
    "local_path":       "media/d41d8cd98f00b204e9800998ecf8427e.jpg",
    "md5":              "d41d8cd98f00b204e9800998ecf8427e",
    "size_bytes":       524288,
    "mime_type":        "image/jpeg",
    "width":            1920,
    "height":           1080,
    "duration_seconds": null
  }
}
```

#### type 值說明

| type | duration | media | design_id | 說明 |
|------|----------|-------|-----------|------|
| `"image"` | 秒數（整數） | 有 | — | 靜態圖片，顯示 duration 秒後進下一項 |
| `"video"` | **null** | 有 | — | 影片，播放到自然結束後進下一項 |
| `"audio"` | 秒數 | 有 | — | 音訊（搭配畫面，少用） |
| `"design_project"` | 秒數 | — | 有 | Content Studio 設計，WebView 載入 |

**design_project 範例：**

```json
{
  "id":          "item-uuid",
  "type":        "design_project",
  "duration":    15,
  "design_id":   "design-uuid",
  "design_name": "首頁公告版型"
}
```

Design 內容載入 URL：
```
https://{SUPABASE_PROJECT_REF}.supabase.co/player?design_id={design_id}
```

### 5.3 MediaEntry 物件

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | string | 媒體 UUID |
| `name` | string | 檔案名稱（顯示用） |
| `url` | string | Supabase Storage CDN 下載 URL |
| `local_path` | string | APK 本機儲存相對路徑，格式：`media/{md5}.{ext}` |
| `md5` | string | 檔案 MD5 hex，用於判斷是否需要重新下載 |
| `size_bytes` | number | 檔案大小（bytes），下載進度計算用 |
| `mime_type` | string | MIME 類型 |
| `width` | number \| null | 影像寬度（px），音訊為 null |
| `height` | number \| null | 影像高度（px），音訊為 null |
| `duration_seconds` | number \| null | 媒體時長（秒），圖片為 null |

### 5.4 BgmTrack 物件

與 `MediaEntry` 結構相同，額外包含：

| 欄位 | 型別 | 說明 |
|------|------|------|
| `track_name` | string | 曲目名稱（顯示用，同 `name`） |

BGM 播放邏輯：隨機或循序播放 `bgm.tracks`，獨立音訊 channel，音量設為 `bgm.volume`。排程切換時，BGM 應依新排程的設定切換。

---

## 6. 媒體檔案管理

### 6.1 本機儲存路徑

```
{filesDir}/
└── media/
    ├── d41d8cd98f00b204e9800998ecf8427e.jpg
    ├── 9e107d9d372bb6826bd81d3542a419d6.mp4
    └── ...
```

APK 以 `local_path`（`media/{md5}.{ext}`）作為唯一識別；相同 md5 代表檔案內容完全相同，永遠不需重新下載。

### 6.2 下載比對演算法

```
syncData = player-sync 回應

// 1. 收集所有需要的媒體
needed = Set<md5>
for each schedule in syncData.schedules:
  for each item in schedule.playlist:
    if item.media exists:
      needed.add(item.media.md5)
  for each track in schedule.bgm.tracks:
    needed.add(track.md5)

// 2. 下載缺少的檔案
for each media in all_media:
  localFile = filesDir + "/" + media.local_path
  if not exists(localFile):
    download(media.url, localFile)
  else if md5(localFile) != media.md5:
    delete(localFile)
    download(media.url, localFile)

// 3. 清除不再需要的舊檔案
for each file in listFiles(filesDir + "/media/"):
  fileMd5 = extractMd5FromFilename(file)
  if fileMd5 not in needed:
    delete(file)
```

### 6.3 sync_token 使用方式

```
// 啟動時
localToken = loadFromPrefs("sync_token")
response   = GET player-sync
if response.sync_token == localToken:
  // 排程未變動，略過下載處理（仍要執行播放）
else:
  processSchedules(response.schedules)
  downloadMissingMedia()
  saveToPrefs("sync_token", response.sync_token)

// MQTT sync 訊息收到時
if message.payload.sync_token == localToken:
  // 略過
else:
  // 處理同上
```

---

## 7. Smart Trigger 規格

### 7.1 smart_triggers 陣列（player-sync 回應）

```json
{
  "smart_triggers": [
    {
      "rule_id":         "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy",
      "name":            "緊急疏散警報",
      "enabled":         true,
      "scope":           "org",
      "design_id":       "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz",
      "duration_seconds": 60
    }
  ]
}
```

APK 啟動時儲存此清單作為本機 trigger 規則快取（輔助用）。

### 7.2 Trigger 觸發優先順序

1. **MQTT push**（`type=trigger`）— 最快，毫秒級延遲
2. **player-trigger 輪詢**（每 10 秒）— MQTT 斷線時的備援

兩者可能重複觸發同一規則。APK 應以 `log_id`（player-trigger）或 `rule_id + ts`（MQTT）做去重處理。

### 7.3 Trigger 播放行為

```
收到 trigger 事件（MQTT 或輪詢）
    │
    ├── 暫停目前播放項目（記錄當前位置）
    ├── 載入 design_id 對應的 WebView 內容
    ├── 開始計時 duration_seconds
    │
    ├── [計時期間收到新 trigger] → 以新 trigger 取代，重置計時器
    │
    └── [計時結束] → 恢復正常排程播放
```

---

## 8. 程式碼範本

### 8.1 Android — SyncService 核心骨架（Kotlin）

```kotlin
class SyncService : Service() {

    private val PREFS_KEY_TOKEN       = "sync_token"
    private val PREFS_KEY_TRIGGER_TS  = "trigger_since"
    private val POLL_INTERVAL_MS      = 10_000L  // 10 秒
    private val SUPABASE_ANON_KEY     = BuildConfig.SUPABASE_ANON_KEY
    private val PLAYER_SYNC_URL       = "${BuildConfig.SUPABASE_URL}/functions/v1/player-sync"
    private val PLAYER_TRIGGER_URL    = "${BuildConfig.SUPABASE_URL}/functions/v1/player-trigger"

    private lateinit var screenId: String
    private lateinit var orgId:    String

    // ── MQTT ─────────────────────────────────────────────────────────────────

    private fun connectMqtt() {
        val client = MqttAndroidClient(applicationContext, "tcp://mqtt.example.com:1883",
            "signcms-$screenId")
        val options = MqttConnectOptions().apply {
            isCleanSession = false
            keepAliveInterval = 60
        }
        client.connect(options, null, object : IMqttActionListener {
            override fun onSuccess(token: IMqttToken) {
                client.subscribe("signcms/$orgId/screen/$screenId",    1)
                client.subscribe("signcms/$orgId/trigger/$screenId",   0)
                client.subscribe("signcms/$orgId/trigger/broadcast",   0)
            }
            override fun onFailure(token: IMqttToken, ex: Throwable) {
                Log.w("SyncService", "MQTT connect failed: ${ex.message}")
                // 退避重連；player-trigger 輪詢繼續作為備援
            }
        })
        client.setCallback(object : MqttCallback {
            override fun messageArrived(topic: String, message: MqttMessage) {
                handleMqttMessage(topic, String(message.payload))
            }
            override fun connectionLost(cause: Throwable?) {
                Log.w("SyncService", "MQTT connection lost")
            }
            override fun deliveryComplete(token: IMqttDeliveryToken) {}
        })
    }

    private fun handleMqttMessage(topic: String, raw: String) {
        val msg = JSONObject(raw)
        when (msg.getString("type")) {
            "sync"    -> processSyncPayload(msg.getJSONObject("payload"))
            "trigger" -> processTriggerPayload(msg.getJSONObject("payload"))
            "license" -> processLicensePayload(msg.getJSONObject("payload"))
        }
    }

    // ── HTTP player-sync ─────────────────────────────────────────────────────

    private fun fetchPlayerSync() {
        val url  = "$PLAYER_SYNC_URL?screen_id=$screenId"
        val resp = httpGet(url)
        if (resp != null) processSyncPayload(JSONObject(resp))
    }

    private fun processSyncPayload(payload: JSONObject) {
        if (!payload.optBoolean("licensed", false)) {
            showUnlicensedScreen()
            return
        }
        val newToken = payload.optString("sync_token", "")
        val oldToken = getPrefs().getString(PREFS_KEY_TOKEN, "")
        if (newToken == oldToken) return   // 無變動，略過

        val schedules = payload.getJSONArray("schedules")
        saveSchedulesToDb(schedules)
        downloadMissingMedia(schedules)
        getPrefs().edit().putString(PREFS_KEY_TOKEN, newToken).apply()
        broadcastScheduleUpdated()
    }

    // ── HTTP player-trigger（每 10 秒輪詢）──────────────────────────────────

    private fun startTriggerPolling() {
        handler.postDelayed(object : Runnable {
            override fun run() {
                pollTrigger()
                handler.postDelayed(this, POLL_INTERVAL_MS)
            }
        }, POLL_INTERVAL_MS)
    }

    private fun pollTrigger() {
        val since = getPrefs().getString(PREFS_KEY_TRIGGER_TS, "") ?: ""
        val url   = "$PLAYER_TRIGGER_URL?screen_id=$screenId&org_id=$orgId" +
                    if (since.isNotEmpty()) "&since=$since" else ""
        val resp  = httpGet(url) ?: return
        val json  = JSONObject(resp)
        val events = json.getJSONArray("events")
        if (events.length() > 0) {
            processTriggerPayload(
                JSONObject().put("rules", convertEventsToRules(events))
            )
        }
        // 更新 since 游標
        getPrefs().edit()
            .putString(PREFS_KEY_TRIGGER_TS, json.getString("server_time"))
            .apply()
    }

    private fun processTriggerPayload(payload: JSONObject) {
        val rules = payload.getJSONArray("rules")
        if (rules.length() == 0) return
        // 取最後一條規則（最新的）
        val rule = rules.getJSONObject(rules.length() - 1)
        broadcastTriggerFired(
            designId        = rule.optString("design_id"),
            durationSeconds = rule.optInt("duration_seconds", 30)
        )
    }
}
```

### 8.2 Android — MediaDownloader（Kotlin）

```kotlin
object MediaDownloader {

    fun syncMedia(context: Context, schedules: JSONArray) {
        val needed   = mutableSetOf<String>()
        val allMedia = mutableListOf<JSONObject>()

        // 收集所有需要的媒體
        for (i in 0 until schedules.length()) {
            val schedule = schedules.getJSONObject(i)
            val playlist = schedule.getJSONArray("playlist")
            for (j in 0 until playlist.length()) {
                val item = playlist.getJSONObject(j)
                if (item.has("media")) {
                    val media = item.getJSONObject("media")
                    needed.add(media.getString("md5"))
                    allMedia.add(media)
                }
            }
            val bgmTracks = schedule.getJSONObject("bgm").getJSONArray("tracks")
            for (j in 0 until bgmTracks.length()) {
                val track = bgmTracks.getJSONObject(j)
                needed.add(track.getString("md5"))
                allMedia.add(track)
            }
        }

        // 下載缺少的檔案
        val mediaDir = File(context.filesDir, "media").also { it.mkdirs() }
        for (media in allMedia) {
            val localPath = File(context.filesDir, media.getString("local_path"))
            if (!localPath.exists()) {
                downloadFile(media.getString("url"), localPath)
            }
        }

        // 清除過期檔案
        mediaDir.listFiles()?.forEach { file ->
            val md5 = file.nameWithoutExtension
            if (md5 !in needed) file.delete()
        }
    }

    private fun downloadFile(url: String, dest: File) {
        try {
            URL(url).openStream().use { input ->
                dest.outputStream().use { output -> input.copyTo(output) }
            }
        } catch (e: Exception) {
            Log.e("MediaDownloader", "Download failed: $url", e)
            dest.delete()
        }
    }
}
```

### 8.3 Android — PlaylistPlayer（排程選擇 + 播放，Kotlin）

```kotlin
class PlaylistPlayer(private val context: Context) {

    private var currentSchedule: Schedule? = null
    private var currentIndex: Int = 0
    private var triggerOverride: TriggerOverride? = null

    /** 每分鐘呼叫一次，重新選擇有效排程 */
    fun tick() {
        val now     = LocalTime.now()
        val today   = DayOfWeek.from(LocalDate.now()).name.take(3).replaceFirstChar { it.uppercase() }
        val schedules = db.loadSchedules()

        val active = schedules.firstOrNull { s ->
            s.enabled
            && today in s.timeDays
            && now >= LocalTime.parse(s.timeStart)
            && now <  LocalTime.parse(s.timeEnd)
        }
        if (active?.id != currentSchedule?.id) {
            currentSchedule = active
            currentIndex    = 0
            playCurrentItem()
        }
    }

    /** Smart Trigger 觸發時呼叫 */
    fun applyTrigger(designId: String, durationSeconds: Int) {
        triggerOverride = TriggerOverride(designId, durationSeconds)
        showDesignWebView(designId)
        Handler(Looper.getMainLooper()).postDelayed({
            triggerOverride = null
            playCurrentItem()
        }, durationSeconds * 1000L)
    }

    private fun playCurrentItem() {
        val schedule = currentSchedule ?: return showStandby()
        val playlist = schedule.playlist
        if (playlist.isEmpty()) return showStandby()

        val item = playlist[currentIndex % playlist.size]
        when (item.type) {
            "image"          -> showImage(item.mediaLocalPath(), item.duration!!)
            "video"          -> playVideo(item.mediaLocalPath())
            "design_project" -> showDesignWebView(item.designId!!)
        }
    }

    private fun advance() {
        if (triggerOverride != null) return  // trigger 播放中，不推進
        currentIndex++
        playCurrentItem()
    }
}

data class TriggerOverride(val designId: String, val durationSeconds: Int)
```

### 8.4 MQTT 觸發訊息範例（完整）

```json
{
  "v": 1,
  "type": "trigger",
  "ts": "2026-05-01T12:00:05.123Z",
  "org_id": "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy",
  "screen_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "payload": {
    "rules": [
      {
        "rule_id":         "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "trigger_key":     "emergency_button",
        "design_id":       "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz",
        "duration_seconds": 60
      }
    ]
  }
}
```

### 8.5 player-sync 完整回應範例

```json
{
  "licensed": true,
  "license_status": "active",
  "sync_token": "2026-05-01T08:30:00.000Z",
  "screen": {
    "id":         "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "name":       "大廳螢幕 A",
    "org_id":     "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy",
    "resolution": "1920x1080"
  },
  "schedules": [
    {
      "id":      "schedule-uuid-1",
      "name":    "白天排程",
      "enabled": true,
      "time_rules": {
        "start": "09:00",
        "end":   "18:00",
        "days":  ["Mon", "Tue", "Wed", "Thu", "Fri"]
      },
      "updated_at": "2026-05-01T08:00:00.000Z",
      "playlist": [
        {
          "id":       "item-uuid-1",
          "type":     "image",
          "duration": 10,
          "media": {
            "id":               "media-uuid-1",
            "name":             "banner_01.jpg",
            "url":              "https://xxx.supabase.co/storage/v1/object/public/media/banner_01.jpg",
            "local_path":       "media/abc123def456.jpg",
            "md5":              "abc123def456",
            "size_bytes":       204800,
            "mime_type":        "image/jpeg",
            "width":            1920,
            "height":           1080,
            "duration_seconds": null
          }
        },
        {
          "id":       "item-uuid-2",
          "type":     "video",
          "duration": null,
          "media": {
            "id":               "media-uuid-2",
            "name":             "promo_video.mp4",
            "url":              "https://xxx.supabase.co/storage/v1/object/public/media/promo_video.mp4",
            "local_path":       "media/9e107d9d372bb682.mp4",
            "md5":              "9e107d9d372bb682",
            "size_bytes":       52428800,
            "mime_type":        "video/mp4",
            "width":            1920,
            "height":           1080,
            "duration_seconds": 30
          }
        },
        {
          "id":          "item-uuid-3",
          "type":        "design_project",
          "duration":    15,
          "design_id":   "design-uuid-1",
          "design_name": "今日特惠版型"
        }
      ],
      "bgm": {
        "volume": 20,
        "tracks": [
          {
            "id":               "bgm-uuid-1",
            "track_name":       "背景音樂 01",
            "name":             "bg_music_01.mp3",
            "url":              "https://xxx.supabase.co/storage/v1/object/public/media/bg_music_01.mp3",
            "local_path":       "media/f1d3ff8443297732.mp3",
            "md5":              "f1d3ff8443297732",
            "size_bytes":       3145728,
            "mime_type":        "audio/mpeg",
            "width":            null,
            "height":           null,
            "duration_seconds": 180
          }
        ]
      }
    }
  ],
  "smart_triggers": [
    {
      "rule_id":         "trigger-rule-uuid-1",
      "name":            "緊急疏散警報",
      "enabled":         true,
      "scope":           "org",
      "design_id":       "design-uuid-emergency",
      "duration_seconds": 60
    }
  ]
}
```

---

## 附錄：版本更新記錄

| 版本 | 日期 | 說明 |
|------|------|------|
| 1.0 | 2026-05-02 | 初版，涵蓋 player-sync、player-trigger、MQTT HTTP Bridge、Playlist 規格 |
