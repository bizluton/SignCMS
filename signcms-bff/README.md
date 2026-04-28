# SignCMS BFF API Server

> **Backend-for-Frontend** — 介於 React 前端與 Supabase 之間的業務邏輯層

## 架構圖

```
React Frontend (不動)
    │
    ├─ SELECT 查詢 ──────────────────▶ Supabase Client (直連，RLS 保護)
    │
    └─ 業務邏輯操作 ─────────────────▶ BFF API Server  ◀─── 本專案
                                            │
                                            ├── /api/media/*     (上傳、轉檔)
                                            ├── /api/license/*   (License 管理)
                                            ├── /api/webhook/*   (Smart Trigger)
                                            ├── /api/admin/*     (Week 4)
                                            └── /api/mcp/*       (Week 4)
                                            │
                                            ├─▶ Supabase DB (service_role)
                                            ├─▶ Supabase Storage
                                            ├─▶ BullMQ + Redis
                                            └─▶ ffmpeg Worker (HMAC)
```

## 快速開始

### 1. 安裝依賴

```bash
npm install
```

### 2. 設定環境變數

```bash
cp .env.example .env
# 編輯 .env，填入 Supabase 金鑰
```

必填項目：
- `SUPABASE_URL` — Supabase Project URL
- `SUPABASE_ANON_KEY` — Supabase anon key
- `SUPABASE_SERVICE_ROLE_KEY` — ⚠️ 保密！不可給前端
- `SUPABASE_JWT_SECRET` — Project Settings > API > JWT Secret

### 3. 啟動（開發模式）

```bash
# 啟動 Redis（需要 Docker）
docker compose up redis -d

# 啟動 BFF（hot reload）
npm run dev
```

或用 Docker Compose 一鍵啟動全部：

```bash
docker compose up
```

### 4. 驗證

```bash
curl http://localhost:3001/health
# → {"status":"ok","version":"1.0.0",...}
```

## API 端點

### Media

| Method | Path | 說明 | Auth |
|--------|------|------|------|
| POST | `/api/media/upload` | 上傳媒體（圖片/影片），影片自動判斷是否需要轉檔 | JWT |
| GET | `/api/media/:id/transcode-status` | 查詢轉檔進度 | JWT |
| POST | `/api/media/transcode-callback` | ffmpeg worker 回呼（HMAC 驗證） | HMAC |

#### 上傳範例（前端改動）

```typescript
// 原本呼叫 Supabase Edge Function：
// await supabase.functions.invoke('upload-media', { body: formData })

// 改成呼叫 BFF：
const session = await supabase.auth.getSession()
const res = await fetch(`${BFF_URL}/api/media/upload`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${session.data.session?.access_token}`,
  },
  body: formData, // 包含 file + org_id + name 等欄位
})
```

### License

| Method | Path | 說明 | Auth |
|--------|------|------|------|
| POST | `/api/license/generate` | 產生 License Code | JWT + System Admin |
| POST | `/api/license/redeem` | 兌換 License Code | JWT + Org Admin |
| GET | `/api/license/org/:orgId` | 查詢 Org 授權狀態 | JWT |
| POST | `/api/license/device/verify` | 裝置 License 驗證 | 無（裝置端） |

### Webhook

| Method | Path | 說明 | Auth |
|--------|------|------|------|
| POST | `/api/webhook/smart-trigger` | Smart Trigger 觸發 | X-Webhook-Token |

## 前端改動清單

前端需要修改的地方**很少**，只有原本呼叫 Edge Function 的地方：

```
src/lib/uploadMedia.ts          → 改呼叫 BFF /api/media/upload
src/components/admin/LicenseManagement.tsx → 改呼叫 BFF /api/license/*
```

其他所有 Supabase client 查詢**保持不動**。

## 環境變數說明

| 變數 | 必填 | 說明 |
|------|------|------|
| `PORT` | 否 | 預設 3001 |
| `SUPABASE_URL` | ✅ | Supabase Project URL |
| `SUPABASE_ANON_KEY` | ✅ | Supabase public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | 後端 service key，切勿洩漏 |
| `SUPABASE_JWT_SECRET` | ✅ | 用於驗證 Supabase issued JWT |
| `REDIS_URL` | 否 | 預設 redis://localhost:6379 |
| `TRANSCODE_WORKER_URL` | 否 | ffmpeg worker URL |
| `TRANSCODE_HMAC_SECRET` | 否 | HMAC 共享密鑰 |
| `ANTHROPIC_API_KEY` | 否 | Week 4 MCP/RAG 用 |
| `FRONTEND_ORIGIN` | 否 | CORS origin，預設 http://localhost:5173 |

## 開發路線圖

- [x] Week 1: BFF 骨架、JWT 驗證、媒體上傳、轉檔 queue
- [ ] Week 2: ffmpeg worker 整合、transcode callback
- [ ] Week 3: License 付款整合（Stripe）
- [ ] Week 4: Smart Trigger 強化、MCP Server、Knowledge Chat
- [ ] Week 5: CI/CD、Sentry、OpenTelemetry
- [ ] Week 6: Onboarding 自動化、OpenAPI 文件
