# 影片轉檔互接規格書 (Transcode Integration Spec)

> 狀態：**規劃中 / 暫未實作**
> 目的：將高 FPS、高位元率、非標準編碼的影片，透過自架 ffmpeg worker 轉成播放器友善的格式。
> 範圍：前端偵測 → CMS 後端排程 → 外部 worker 處理 → 回呼更新狀態。

---

## 1. 流程總覽

```
┌──────────┐  1.偵測 metadata   ┌──────────────┐  2.上傳+標 pending   ┌──────────────┐
│  前端     │ ─────────────────▶ │  upload-media │ ───────────────────▶ │  media_items │
│ (Browser) │   MediaInfo.js     │ (Edge Func)  │                      │   (Postgres) │
└──────────┘                     └──────────────┘                      └──────┬───────┘
                                                                              │ 3.使用者按「開始轉檔」
                                                                              ▼
                                ┌──────────────────┐  4.HMAC POST job   ┌──────────────┐
                                │ request-transcode│ ─────────────────▶ │ ffmpeg worker│
                                │   (Edge Func)    │                    │   (自架)      │
                                └──────────────────┘                    └──────┬───────┘
                                                                                │ 5.轉完 / 失敗
                                                                                ▼
                                ┌────────────────────┐  6.HMAC 回呼      ┌──────────────┐
                                │ transcode-callback │ ◀───────────────  │ ffmpeg worker│
                                │    (Edge Func)     │                    └──────────────┘
                                └────────────────────┘
                                          │ 7.更新 media_items
                                          ▼
                                  url / thumbnail / status = done
```

---

## 2. 判定門檻 (Pending 條件)

任一條件成立即標 `transcode_status = 'pending'`：

| 條件 | 門檻 |
| --- | --- |
| FPS | `> 60` |
| Bitrate | `> 20 Mbps` (20_000_000 bps) |
| Codec | `≠ h264` (avc1 視為通過) |
| Container | `≠ mp4` |
| 解析度 | 寬 `> 3840` 或 高 `> 2160` |

否則 `transcode_status = 'none'`，可直接播放。

---

## 3. 轉檔目標規格

| 項目 | 值 |
| --- | --- |
| 容器 | `mp4` (faststart) |
| 視訊編碼 | `H.264 / High Profile` |
| 像素格式 | `yuv420p` (8-bit) |
| 解析度 | 維持原比例，**最高 1080p**（超過則等比例縮小） |
| FPS | `30` (超過則降，低於則維持) |
| Bitrate | `8 Mbps` (CBR or 2-pass VBR) |
| 音訊編碼 | `AAC LC, 128kbps, 48kHz, stereo` |

### 建議 ffmpeg 命令

```bash
ffmpeg -i INPUT \
  -c:v libx264 -profile:v high -pix_fmt yuv420p \
  -vf "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease,fps=30" \
  -b:v 8M -maxrate 8M -bufsize 16M \
  -c:a aac -b:a 128k -ar 48000 -ac 2 \
  -movflags +faststart \
  OUTPUT.mp4
```

---

## 4. 資料表欄位 (`media_items`)

已在資料庫存在，**不需新增 migration**：

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `transcode_status` | text | `none` / `pending` / `processing` / `done` / `failed` |
| `transcode_requested_at` | timestamptz | 使用者按下「開始轉檔」時間 |
| `transcode_completed_at` | timestamptz | worker 回呼成功時間 |
| `transcode_error` | text | 失敗原因 |
| `source_codec` | text | 原始編碼，例：`hevc` |
| `source_container` | text | 原始容器，例：`mov` |
| `source_fps` | numeric | 原始 FPS |
| `source_bitrate` | bigint | 原始 bitrate (bps) |

---

## 5. 前端 (MediaInfo.js)

```ts
import MediaInfoFactory from "mediainfo.js";

const mi = await MediaInfoFactory({ format: "object", locateFile: () => "/mediainfo/MediaInfoModule.wasm" });
const info = await mi.analyzeData(() => file.size, (size, offset) =>
  file.slice(offset, offset + size).arrayBuffer().then((b) => new Uint8Array(b))
);

const video = info.media?.track?.find((t: any) => t["@type"] === "Video");
const meta = {
  fps: Number(video?.FrameRate ?? 0),
  bitrate: Number(video?.BitRate ?? 0),
  codec: String(video?.Format ?? "").toLowerCase(),       // "avc" → 視為 h264
  container: file.name.split(".").pop()?.toLowerCase() ?? "",
  width: Number(video?.Width ?? 0),
  height: Number(video?.Height ?? 0),
};

const needsTranscode =
  meta.fps > 60 ||
  meta.bitrate > 20_000_000 ||
  !["h264", "avc"].includes(meta.codec) ||
  meta.container !== "mp4" ||
  meta.width > 3840 || meta.height > 2160;
```

把 `meta` 與 `needsTranscode` 透過 `FormData` 一併送到 `upload-media`。

---

## 6. Edge Functions

### 6.1 `upload-media` (修改)

新增接收欄位：`source_fps`, `source_bitrate`, `source_codec`, `source_container`, `needs_transcode`。
寫入 `media_items` 時：

```ts
transcode_status: needs_transcode ? "pending" : "none",
source_fps, source_bitrate, source_codec, source_container,
```

### 6.2 `request-transcode` (新增)

- **權限**：admin / org_admin / 上傳者本人
- **輸入**：`{ media_id: string }`
- **流程**：
  1. 讀取 `media_items`，確認 `transcode_status = 'pending'`
  2. 產生 `job_id = media_id`，HMAC 簽章
  3. POST 到 `TRANSCODE_WORKER_URL`
  4. 更新 `transcode_status = 'processing'`, `transcode_requested_at = now()`

```ts
POST {TRANSCODE_WORKER_URL}/jobs
Headers:
  Content-Type: application/json
  X-Signature: hex(hmacSHA256(TRANSCODE_HMAC_SECRET, body))
  X-Timestamp: <unix_ms>
Body:
{
  "job_id": "<media_id>",
  "input_url": "<public_url_of_original>",
  "callback_url": "https://<project>.supabase.co/functions/v1/transcode-callback",
  "target": {
    "container": "mp4",
    "video_codec": "h264",
    "max_height": 1080,
    "fps": 30,
    "video_bitrate": 8000000,
    "pix_fmt": "yuv420p",
    "audio_codec": "aac",
    "audio_bitrate": 128000
  }
}
```

### 6.3 `transcode-callback` (新增)

- **驗證**：HMAC（同上），時間戳 ±5 分鐘
- **輸入**（worker → CMS）：

```json
// 成功
{
  "job_id": "<media_id>",
  "status": "done",
  "output_url": "https://worker.example.com/out/<media_id>.mp4",
  "duration_seconds": 123,
  "size_bytes": 45678901,
  "width": 1920,
  "height": 1080
}
// 失敗
{
  "job_id": "<media_id>",
  "status": "failed",
  "error": "ffmpeg exit code 1: ..."
}
```

- **動作**：
  1. 下載 `output_url` → 上傳到 `media` bucket，覆蓋路徑 `{org_id}/{md5}.mp4`
  2. 更新 `media_items`：`url`, `thumbnail`, `size_bytes`, `dimensions`, `duration`, `mime_type='video/mp4'`, `transcode_status='done'`, `transcode_completed_at=now()`
  3. 失敗則寫 `transcode_status='failed'`, `transcode_error`

---

## 7. Worker 介面契約

### 7.1 環境變數
- `HMAC_SECRET`：與 CMS `TRANSCODE_HMAC_SECRET` 相同
- `MAX_CONCURRENT_JOBS`：建議 = CPU 核心數
- `TMP_DIR`：暫存路徑，工作完成後清除

### 7.2 端點

| Method | Path | 說明 |
| --- | --- | --- |
| `POST` | `/jobs` | 接收新工作（同步回 `202 Accepted`，非同步處理） |
| `GET` | `/jobs/{id}` | (選用) 查詢進度 |
| `GET` | `/health` | 健康檢查 |

### 7.3 HMAC 驗證 (雙向相同)

```ts
const expected = createHmac("sha256", SECRET)
  .update(timestamp + "." + rawBody)
  .digest("hex");
if (!timingSafeEqual(expected, headerSig)) reject();
if (Math.abs(Date.now() - Number(timestamp)) > 5 * 60 * 1000) reject();
```

### 7.4 重試策略
- Worker 處理失敗自動重試 **2 次**，全失敗才回呼 `failed`
- CMS 回呼若收到非 200，worker 重試 **3 次**（指數退避：5s / 30s / 2min）

---

## 8. UI 規格 (Media 頁面)

| 狀態 | 視覺 | 操作 |
| --- | --- | --- |
| `none` | 無徽章 | 正常使用 |
| `pending` | 黃色徽章「待轉檔」 | 顯示「開始轉檔」按鈕；**無法加入排程** |
| `processing` | 藍色徽章「轉檔中」+ spinner | 全部操作鎖定 |
| `done` | （無徽章） | 正常使用 |
| `failed` | 紅色徽章「轉檔失敗」+ tooltip 顯示 `transcode_error` | 顯示「重新轉檔」按鈕 |

排程 / 內容編輯器在挑選素材時，需過濾 `transcode_status NOT IN ('pending','processing','failed')`。

---

## 9. 需要的 Secrets (未來補)

| 名稱 | 用途 |
| --- | --- |
| `TRANSCODE_WORKER_URL` | 自架 worker 對外網址，例：`https://transcode.signcms.net` |
| `TRANSCODE_HMAC_SECRET` | 雙向 HMAC 共用密鑰，建議 ≥ 32 bytes 隨機字串 |

---

## 10. 待辦清單 (Implementation Checklist)

- [ ] 安裝 `mediainfo.js` 並把 wasm 放到 `public/mediainfo/`
- [ ] `MediaPage.tsx` 上傳前偵測，附帶 metadata 給 `upload-media`
- [ ] `upload-media` 接收新欄位並寫入
- [ ] 新增 `request-transcode` Edge Function
- [ ] 新增 `transcode-callback` Edge Function
- [ ] Media 列表 UI：徽章 / 按鈕 / 鎖定狀態
- [ ] 排程 / 內容編輯器過濾不可用素材
- [ ] 自架 worker（Node/Go/Python 任選 + ffmpeg）
- [ ] 設定 secrets `TRANSCODE_WORKER_URL`, `TRANSCODE_HMAC_SECRET`
- [ ] 端對端測試（含失敗情境、HMAC 驗證、超大檔）
