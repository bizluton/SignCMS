# Week 4 — 監控 + CI/CD 部署指南

## 架構總覽

```
GitHub repo (main branch)
    │
    ├── push → GitHub Actions CI
    │           ├── typecheck + vitest
    │           ├── tsc build
    │           └── Docker build → ghcr.io/your-org/signcms-bff:latest
    │
    └── Supabase migrations (paths: supabase/migrations/**)
                └── supabase db push（自動執行）

ghcr.io image
    └── Railway / Render / Fly.io 監聽 image 更新 → 自動部署
```

---

## Step 1：GitHub Secrets 設定

在 GitHub repo > Settings > Secrets and variables > Actions 新增：

| Secret | 說明 | 取得方式 |
|--------|------|---------|
| `SUPABASE_ACCESS_TOKEN` | Supabase PAT | app.supabase.com > Account > Access Tokens |
| `SUPABASE_DB_PASSWORD` | DB 密碼 | Supabase > Project Settings > Database |
| `SUPABASE_PROJECT_ID` | 如 `pgbpmgqxtkaheqcmgwwj` | Supabase > Project Settings > General |

CI workflow 用 `GITHUB_TOKEN`（自動提供）推送到 ghcr.io，不需要額外設定。

---

## Step 2：Railway 部署（推薦）

### 2.1 建立服務

1. [railway.app](https://railway.app) > New Project > Deploy from GitHub repo
2. 選擇 `signcms-bff` 目錄（或整個 monorepo）
3. Railway 自動偵測 Dockerfile

### 2.2 環境變數

在 Railway > Variables 貼入所有 `.env.example` 的必填項目：

```
PORT=3001
SUPABASE_URL=https://pgbpmgqxtkaheqcmgwwj.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_JWT_SECRET=...
REDIS_URL=redis://...    # Railway 內建 Redis add-on
ANTHROPIC_API_KEY=sk-ant-...
FRONTEND_ORIGIN=https://your-signcms-domain.com
SENTRY_DSN=https://xxx@yyy.ingest.sentry.io/zzz
```

### 2.3 Redis Add-on

Railway > New Service > Database > Redis，然後從 Redis 服務複製 `REDIS_URL` 到 BFF 的變數。

### 2.4 自動部署

Railway 預設監聽 GitHub main branch，每次 push 自動 re-deploy。
或用 Deploy Hook URL，在 GitHub Actions `ci.yml` 取消 comment deploy job。

---

## Step 3：Sentry 設定

1. [sentry.io](https://sentry.io) > New Project > Node.js
2. 複製 DSN 到 Railway 環境變數 `SENTRY_DSN`
3. 在 Sentry 設定 Alert Rule：
   - **Condition**：error count > 5 in 1 minute
   - **Action**：Email / Slack 通知
4. 驗證：故意送一個錯誤請求，確認 Sentry 收到

---

## Step 4：Health Check 監控

使用 [BetterUptime](https://betteruptime.com)（免費）或 UptimeRobot：

| 探針 | URL | 間隔 |
|------|-----|------|
| 存活探針 | `GET /health` | 每 1 分鐘 |
| 深度探針 | `GET /health/deep` | 每 5 分鐘 |

`/health/deep` 回應範例：
```json
{
  "status": "ok",
  "checks": {
    "supabase": { "status": "ok", "latency_ms": 45 },
    "redis": { "status": "ok", "latency_ms": 2 },
    "transcode_worker": { "status": "ok", "latency_ms": 12 }
  }
}
```
任一 check 為 `error` → HTTP 503 → 監控觸發告警。

---

## Step 5：Supabase DB 備份確認

Supabase Pro 方案自動每日備份，確認設定：
1. Supabase Dashboard > Database > Backups
2. 確認 PITR（Point-in-Time Recovery）已啟用
3. 測試還原流程（用 staging 環境）

---

## Step 6：前端 Vercel 部署

前端（`screenleap-central-main`）推薦 Vercel：

1. Vercel > New Project > Import from GitHub
2. Framework: Vite
3. Build Command: `npm run build`
4. Output Directory: `dist`
5. 環境變數：
   ```
   VITE_SUPABASE_URL=https://pgbpmgqxtkaheqcmgwwj.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=eyJ...
   VITE_BFF_URL=https://your-bff.railway.app
   ```

Vercel 預設每次 push main branch 自動部署。

---

## 驗證 checklist

部署完成後逐項確認：

- [ ] `GET /health` → `{"status":"ok"}`
- [ ] `GET /health/deep` → 全部 check 為 `ok`
- [ ] Sentry 收到測試錯誤
- [ ] GitHub Actions CI 全部 pass（綠燈）
- [ ] 前端能正常登入、上傳媒體
- [ ] Smart Trigger webhook 能觸發（用 curl 測試）
- [ ] Knowledge Chat 能回應（需要 ANTHROPIC_API_KEY）
- [ ] License 兌換流程正常

---

## 月費估算（台灣客戶起步規模）

| 服務 | 方案 | 月費 |
|------|------|------|
| Supabase | Pro | $25 USD |
| Railway（BFF） | Hobby | $5 USD |
| Railway（Redis） | 內建 | $0（含在 Hobby） |
| Vercel（前端） | Hobby | $0 |
| Sentry | Free（5K events/月） | $0 |
| BetterUptime | Free | $0 |
| **合計** | | **~$30 USD/月** |

> ffmpeg Worker 如需自架，另計 VPS 費用（~$10-20 USD/月）
