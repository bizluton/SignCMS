# Week 2 — ffmpeg Worker 整合指南

## 整體流程

```
前端上傳                BFF                  BullMQ       ffmpeg Worker       Supabase
   │                    │                     │                │                  │
   │── multipart ──────▶│                     │                │                  │
   │                    │── upload Storage ──────────────────────────────────────▶│
   │                    │── INSERT media_items (pending) ────────────────────────▶│
   │                    │── queue.add('transcode') ──────▶│                       │
   │◀── { id, status } ─│                     │                │                  │
   │                    │                     │── Worker picks │                  │
   │                    │                     │   up job       │                  │
   │                    │                     │                │                  │
   │                    │── UPDATE processing ───────────────────────────────────▶│
   │                    │── createSignedUrl ─────────────────────────────────────▶│
   │                    │◀── signedUrl ───────────────────────────────────────────│
   │                    │── POST /jobs (HMAC) ────────────▶│                      │
   │                    │◀── 202 queued ──────────────────│                       │
   │                    │                                  │── ffmpeg process      │
   │                    │                                  │── upload to S3/R2     │
   │                    │◀── POST /transcode-callback ────│                       │
   │                    │    (HMAC, status=done)           │                      │
   │                    │── UPDATE done, url=output_url ────────────────────────▶│
   │                    │                                                          │
   │ (前端輪詢)          │                                                          │
   │── GET transcode-status ──▶│                                                   │
   │◀── { status:'done' } ─────│                                                  │
```

## Step 1：準備 transcode-worker

從 Lovable 專案複製 worker 到 BFF 旁邊：

```bash
# 在你的工作目錄執行（BFF 與 worker 平行放）
cp -r screenleap-central-main/docs/transcode-worker ./signcms-bff/transcode-worker
```

### 設定 worker 的 .env

```bash
cd signcms-bff/transcode-worker
cp .env.example .env
```

編輯 `transcode-worker/.env`：
```
HMAC_SECRET=change-me-strong-secret-32chars!!   # 與 BFF 的 TRANSCODE_HMAC_SECRET 完全相同！
S3_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
S3_BUCKET=signcms-media
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_FORCE_PATH_STYLE=true
S3_PUBLIC_BASE_URL=https://media.your-domain.com
```

## Step 2：設定 Supabase Storage Bucket

在 Supabase Dashboard > Storage > Buckets：

1. 建立 bucket 名稱：`media`
2. Public bucket：**否**（private，透過 signed URL 存取）
3. 檔案大小限制：50 MB

如果 bucket 已存在（Lovable 可能已建立），確認 policy 允許 service_role 讀寫。

## Step 3：設定 BFF .env

```bash
cd signcms-bff
cp .env.example .env
```

關鍵設定：
```
TRANSCODE_WORKER_URL=http://localhost:8080
TRANSCODE_HMAC_SECRET=change-me-strong-secret-32chars!!  # 與 worker 完全相同
BFF_PUBLIC_URL=http://你的公開IP或域名:3001              # worker callback 用
S3_ENDPOINT=...   # 與 worker 相同
```

> ⚠️ `BFF_PUBLIC_URL` 必須是 ffmpeg worker 能連到的位址。
> 本地開發時 worker 與 BFF 在同一台機器，可用 `http://host.docker.internal:3001`（Mac/Windows）
> 或 `http://bff:3001`（docker compose 內部網路）

## Step 4：啟動服務

### 選項 A：全部 Docker Compose（推薦）

```bash
cd signcms-bff
docker compose --profile with-transcode up --build
```

服務啟動後：
- BFF API: http://localhost:3001
- ffmpeg Worker: http://localhost:8080
- Redis: localhost:6379

### 選項 B：BFF 本地 + Worker Docker

```bash
# Terminal 1：Redis + Worker
docker compose --profile with-transcode up redis transcode-worker

# Terminal 2：BFF hot reload
npm run dev
```

## Step 5：跑測試

```bash
npm test
```

測試涵蓋：
- HMAC 簽名 / 驗章（`hmac.test.ts`）
- transcode-callback endpoint（`transcodeCallback.test.ts`）

## Step 6：端對端驗證

### 6.1 Health Check

```bash
curl http://localhost:3001/health
curl http://localhost:8080/health
```

### 6.2 模擬 Worker Callback（手動測試）

```bash
# 產生合法簽名
SECRET="change-me-strong-secret-32chars!!"
TIMESTAMP=$(date +%s000)
BODY='{"job_id":"550e8400-e29b-41d4-a716-446655440000-1","status":"done","output_url":"https://media.example.com/transcoded/test.mp4","duration_seconds":30}'
SIG=$(echo -n "${TIMESTAMP}.${BODY}" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

curl -X POST http://localhost:3001/api/media/transcode-callback \
  -H "Content-Type: application/json" \
  -H "X-Signature: $SIG" \
  -H "X-Timestamp: $TIMESTAMP" \
  -d "$BODY"

# 期待回應：{"ok":true,"data":{"media_id":"550e8400-...","status":"done"}}
```

### 6.3 查詢轉檔狀態

```bash
# 需要有效的 JWT token
curl http://localhost:3001/api/media/<mediaId>/transcode-status \
  -H "Authorization: Bearer <supabase_jwt>"
```

## 前端改動（uploadMedia.ts）

在 `src/lib/uploadMedia.ts` 找到 `supabase.functions.invoke('upload-media', ...)` 替換：

```typescript
// ─── 原本（Edge Function）────────────────────────────────
const { data, error } = await supabase.functions.invoke('upload-media', {
  body: formData,
})

// ─── 改成（BFF）─────────────────────────────────────────
const session = await supabase.auth.getSession()
const token = session.data.session?.access_token

// formData 需要補上 org_id 和 name 欄位
formData.append('org_id', currentOrgId)
formData.append('name', fileName)
// 若前端有 MediaInfo.js，補上：
// formData.append('source_fps', String(fps))
// formData.append('source_codec', codec)
// ...

const res = await fetch(`${import.meta.env.VITE_BFF_URL}/api/media/upload`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: formData,
})
const result = await res.json()
if (!result.ok) throw new Error(result.error)

const { id, url, transcode_status } = result.data

// 如果 transcode_status === 'pending'，顯示轉檔中狀態
// 前端輪詢：GET /api/media/:id/transcode-status 直到 status === 'done'
```

## 常見問題

**Q: Worker callback 連不到 BFF？**
A: 確認 `BFF_PUBLIC_URL` 是 worker container 能訪問的位址。Docker compose 內部用服務名稱，外部用實際 IP。

**Q: HMAC 驗證失敗？**
A: 確認 `TRANSCODE_HMAC_SECRET` 在 BFF `.env` 和 `transcode-worker/.env` 完全相同（包含大小寫和特殊字元）。

**Q: S3 upload 失敗？**
A: 先用 worker 的 `GET /health` 確認 worker 正常，再用 AWS CLI 測試 S3 連線。Cloudflare R2 需要 `S3_FORCE_PATH_STYLE=true`。

**Q: 影片上傳後 transcode_status 一直是 pending？**
A: 確認 Redis 服務正常（`redis-cli ping`），BullMQ worker 有啟動（看 BFF 啟動 log 應有 `✅ Transcode BullMQ worker started`）。
