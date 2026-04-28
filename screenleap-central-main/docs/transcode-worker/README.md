# SignCMS Transcode Worker

自架 ffmpeg 轉檔 worker，搭配 SignCMS 的 `request-transcode` / `transcode-callback` Edge Functions 使用。
完整流程與資料表欄位請參考 [`../transcode-spec.md`](../transcode-spec.md)。

## 功能
- `POST /jobs`：接收轉檔工作（HMAC 驗章）
- `GET /jobs/:id`：查詢工作狀態
- `GET /health`：健康檢查
- 轉檔完成後**直接上傳到 S3 / R2 / MinIO**，刪除本地檔；`output_url` 回傳物件公開 URL
- 內建 p-queue 控制併發、回呼指數退避重試（5s / 30s / 2min）

## 目錄結構
```
docs/transcode-worker/
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── package.json
├── README.md
└── src/
    ├── server.js      # Express 入口
    ├── config.js      # 環境變數
    ├── logger.js      # pino logger
    ├── hmac.js        # HMAC 驗章 / 簽章
    ├── queue.js       # p-queue 工作佇列
    ├── transcode.js   # ffmpeg 處理核心
    ├── s3.js          # S3 SigV4 上傳(支援 R2/MinIO)
    └── callback.js    # 回呼 CMS(含重試)
```

## 快速啟動

### 1. 設定環境變數
```bash
cp .env.example .env
# 編輯 .env：填 HMAC_SECRET 與 S3/R2 認證
```

### S3 / R2 / MinIO 設定對照

| 服務 | `S3_ENDPOINT` | `S3_REGION` | `S3_FORCE_PATH_STYLE` |
| --- | --- | --- | --- |
| AWS S3 | `https://s3.<region>.amazonaws.com` | `us-east-1` 等 | `false` |
| Cloudflare R2 | `https://<account_id>.r2.cloudflarestorage.com` | `auto` | `true` |
| MinIO | `https://minio.example.com` | `us-east-1`(任意) | `true` |

`S3_PUBLIC_BASE_URL` 建議綁自訂網域（R2 自訂域 / CloudFront / MinIO public）；
未設定時 worker 會回傳簽章 endpoint URL，CMS 端通常拿不到（bucket 多半 private）。


### 2. Docker Compose
```bash
docker compose up -d --build
docker compose logs -f
```

### 3. 確認健康
```bash
curl http://localhost:8080/health
# {"ok":true,"pending":0,"active":0,"total":0}
```

## 接線到 SignCMS

在 Lovable Cloud 設定 secrets：

| Secret | 值 |
| --- | --- |
| `TRANSCODE_WORKER_URL` | `https://transcode.your-domain.com` |
| `TRANSCODE_HMAC_SECRET` | 與本 worker `HMAC_SECRET` **完全相同** |

CMS `request-transcode` 會 POST 到 `${TRANSCODE_WORKER_URL}/jobs`，worker 完成後 POST 到 `${callback_url}`。

## HMAC 驗章規則（雙向相同）

```
message   = `${X-Timestamp}.${rawBody}`
signature = hex(hmacSHA256(HMAC_SECRET, message))
```
- `X-Timestamp`：unix 毫秒字串，容許 ±5 分鐘
- `X-Signature`：hex 字串
- 用 raw body（不要 JSON.parse 後再序列化），避免空白字元差異

### 測試（手動產生簽章）
```bash
SECRET="your-secret"
TS=$(date +%s%3N)
BODY='{"job_id":"test-1","input_url":"https://example.com/in.mp4","callback_url":"https://example.com/cb"}'
SIG=$(printf "%s.%s" "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')

curl -X POST http://localhost:8080/jobs \
  -H "Content-Type: application/json" \
  -H "X-Timestamp: $TS" \
  -H "X-Signature: $SIG" \
  --data "$BODY"
```

## 部署建議

### 反向代理 (nginx / Caddy)
- 開 HTTPS（Let's Encrypt）
- `client_max_body_size` 不重要（worker 不收檔案上傳，只收 JSON）
- 若要對外提供 `/files`，記得加快取與 Range 支援

### 物件儲存（推薦）
為避免 worker 同時擔任檔案伺服器，建議改成：
1. ffmpeg 完成後上傳到 R2 / S3 / GCS
2. `output_url` 回傳物件儲存的 public URL
3. 移除本專案的 `/files` 路由

只要修改 `src/transcode.js` 結尾即可。

### 資源需求參考
| 來源規格 | 建議 vCPU | 預估速度 |
| --- | --- | --- |
| 1080p 60fps → 1080p 30fps | 2 核 | ~ 1× 原片時長 |
| 4K HEVC → 1080p H.264 | 4 核 | ~ 1.5× 原片時長 |

`MAX_CONCURRENT_JOBS` 預設 = CPU 核心數 - 1，可依機器調整。

## 常見問題

**Q: ffmpeg 卡住沒結束？**
A: 已在 `runFfmpeg` 用 stderr 收尾，但目前沒設絕對 timeout。建議在 nginx 或 systemd 層加 watchdog；長片可在 `transcode.js` 加 `timeout` 參數。

**Q: HMAC verify failed？**
A: 99% 是 body 編碼差異。確認雙方都用 raw bytes（utf8）+ 同一個 secret，且 timestamp 在 ±5 分鐘內。

**Q: 回呼一直失敗？**
A: 看 worker logs。預設重試 3 次（5s / 30s / 2min）後放棄；CMS 端可從 `transcode_status` 仍停在 `processing` 偵測到並提供「重試」按鈕（需另外實作）。

## 監控（Prometheus）

worker 內建 `/metrics` 端點，符合 Prometheus exposition 格式。

```bash
curl http://localhost:8080/metrics
```

### 指標清單

| 指標 | 型別 | 說明 |
| --- | --- | --- |
| `transcode_queue_pending` | Gauge | 等待中的工作數 |
| `transcode_queue_active` | Gauge | 處理中的工作數 |
| `transcode_jobs_tracked_total` | Gauge | 記憶體中追蹤的工作總數 |
| `transcode_jobs_processed_total{status="done\|failed"}` | Counter | 累計完成 / 失敗數 |
| `transcode_uploaded_bytes_total` | Counter | 累計上傳到物件儲存的位元組數 |
| `transcode_job_duration_seconds{status}` | Histogram | 端到端處理時間（下載 + ffmpeg + 上傳）|
| `transcode_ffmpeg_duration_seconds` | Histogram | ffmpeg 執行時間 |
| `transcode_upload_duration_seconds` | Histogram | S3/R2 上傳時間 |
| `transcode_worker_*` | 預設 | Node.js process 指標（CPU / 記憶體 / event loop）|

### Prometheus scrape 設定

```yaml
# prometheus.yml
scrape_configs:
  - job_name: transcode-worker
    scrape_interval: 15s
    static_configs:
      - targets: ["transcode-worker:8080"]
```

### 建議告警

```yaml
# alerts.yml
groups:
  - name: transcode
    rules:
      - alert: TranscodeQueueBacklog
        expr: transcode_queue_pending > 20
        for: 5m
        annotations:
          summary: "轉檔佇列積壓 ({{ $value }} 件)，考慮擴容 worker"

      - alert: TranscodeFailureRate
        expr: |
          rate(transcode_jobs_processed_total{status="failed"}[15m])
          / rate(transcode_jobs_processed_total[15m]) > 0.2
        for: 10m
        annotations:
          summary: "轉檔失敗率 > 20%，請檢查 worker logs"

      - alert: TranscodeP95Slow
        expr: histogram_quantile(0.95, rate(transcode_job_duration_seconds_bucket[15m])) > 1800
        for: 15m
        annotations:
          summary: "P95 轉檔時間 > 30 分鐘，可能 ffmpeg 卡住或機器過載"
```

### Grafana 推薦面板
- 即時：`transcode_queue_pending` + `transcode_queue_active`
- 趨勢：`rate(transcode_jobs_processed_total[5m])` 按 status 分色
- P50/P95/P99：`histogram_quantile(0.95, rate(transcode_job_duration_seconds_bucket[5m]))`
- 流量：`rate(transcode_uploaded_bytes_total[5m])`

## 進度回報

worker 在 ffmpeg 處理中會每 5 秒對 `callback_url` POST 一次進度，CMS 收到後可更新 `media_items.transcode_progress` 顯示百分比。

### Payload 格式

```json
// 進度中（每 5 秒一次，去重複百分比）
{
  "job_id": "abc-123",
  "status": "progress",
  "progress": 42,
  "out_time_seconds": 180,
  "source_duration_seconds": 430,
  "speed": 1.8
}

// 上傳階段（ffmpeg 完成、上傳 S3 前）
{
  "job_id": "abc-123",
  "status": "progress",
  "progress": 99,
  "phase": "uploading"
}

// 最終完成（與原本相同）
{
  "job_id": "abc-123",
  "status": "done",
  "output_url": "https://...",
  "duration_seconds": 430,
  "size_bytes": 12345678,
  "width": 1920,
  "height": 1080
}
```

所有 callback 都帶 `X-Signature` / `X-Timestamp`，CMS 端用同一支 HMAC 驗章邏輯即可。

### CMS 端建議處理

```ts
// transcode-callback Edge Function
if (payload.status === "progress") {
  await supabase.from("media_items")
    .update({ transcode_progress: payload.progress })
    .eq("id", payload.job_id);
  return new Response("ok"); // 200，worker 才不會重試
}
```

> ⚠️ 進度 callback 採 fire-and-forget，回 5xx 會觸發 worker 重試（最多 3 次），所以 CMS 端就算找不到對應 media_id 也應回 200 並 log warning。

## 大檔上傳（Multipart）

`s3.js` 會依檔案大小自動切換：

| 檔案大小 | 策略 |
| --- | --- |
| `< 100 MB` | 單一 PUT（一次上傳） |
| `≥ 100 MB` | S3 Multipart Upload，切 16 MB 一片，依序上傳 |

每片獨立簽章與 PUT，**單片失敗會重試 3 次**（指數退避 1s/3s/9s），整個 upload 失敗會自動發 `AbortMultipartUpload` 清掉未完成分片，避免被 S3/R2 收費。

### 為什麼不平行上傳？
- ffmpeg worker 通常 CPU bound，網路是空閒的；序列上傳已能跑滿單機頻寬。
- 序列上傳記憶體佔用穩定（同時最多 1 片 = 16MB）。
- 真要加速，把 `multipartUpload()` 內的 for 改 `Promise.all` + p-limit(4) 即可，但要小心記憶體。

### 調整門檻 / 分片大小
直接改 `src/s3.js` 頂端常數：
```js
const MULTIPART_THRESHOLD = 100 * 1024 * 1024; // 100MB
const PART_SIZE = 16 * 1024 * 1024;             // 16MB（S3 規定 ≥5MB，最後一片可更小）
```

> ⚠️ S3 單一 multipart upload 最多 10,000 片；16MB × 10,000 = 160GB 上限，遠大於 worker 能處理的影片，無需擔心。

### R2 / MinIO 相容性
- Cloudflare R2：完全支援 multipart，需 `S3_FORCE_PATH_STYLE=true`
- MinIO：完全支援
- AWS S3：原生支援
