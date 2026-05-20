# Media CDN deployment runbook

> 配合 `cloudflare-worker/worker.js`、`supabase/functions/upload-media`、
> `supabase/functions/transcode-callback`、`migrations/20260521000009`。
>
> 目標：把 player 媒體下載從 Supabase Storage 直連改成走 Cloudflare 邊
> 緣 cache。10K device 規模下省 90%+ Supabase egress 費用。

## 1. 為什麼要做

| 指標 | 不走 CDN | 走 CDN |
|---|---|---|
| 10K device × 100 MB/day × 30 day | 30 TB / 月 | 30 TB cache hit / 月 |
| Supabase egress 費 ($0.09/GB) | **$2,700 / 月** | < $50（少量 origin miss） |
| Cloudflare Workers 帳單 | $0 | ~$5（10M requests/月） |
| 第一次取檔 latency（全球） | 視 origin 地區 | edge 命中 ~30ms |

媒體採 CAS（同 sha256 = 同 URL），cache hit rate 接近 100%。

## 2. 系統元件對應

```
                            ┌──────────────────────────────────────┐
upload-media (edge)         │  MEDIA_CDN_BASE_URL=https://cdn.signcms.net  │
transcode-callback (edge)   │  ↓                                   │
                            │  media_items.url = https://cdn.signcms.net/storage/v1/object/public/media/assets/<sha256>.<ext>
                            └──────────────────────────────────────┘
                                              ↓
Player GET <url>                          DNS: cdn.signcms.net → Cloudflare
                                              ↓
                            ┌──────────────────────────────────────┐
                            │   Cloudflare Worker (cloudflare-worker/worker.js) │
                            │   /storage/v1/object/public/media/*  → cacheTtl 1yr
                            │   其他路徑                            → passthrough
                            └──────────────────────────────────────┘
                                              ↓
                            ┌──────────────────────────────────────┐
                            │   Cloudflare edge cache               │
                            │   Hit  → 直接回應，0 origin call      │
                            │   Miss → origin fetch + cache         │
                            └──────────────────────────────────────┘
                                              ↓
                            narhbpojjtnalyfiwxue.supabase.co/storage/...
```

## 3. 部署步驟

### 3.1 Worker 部署（前置）

```bash
cd cloudflare-worker
npm install -g wrangler  # 若沒裝
wrangler login

wrangler deploy
# → 看到 "Published signcms-api (X ms)" 表示完成
# → 預設 URL：https://signcms-api.<your-subdomain>.workers.dev
```

驗證 worker 本身能 proxy：

```bash
# 應該回 200 + JSON (Supabase 的 health check)
curl https://signcms-api.<your-subdomain>.workers.dev/

# 試一個現有的 media URL
curl -I https://signcms-api.<your-subdomain>.workers.dev/storage/v1/object/public/media/assets/<sha256>.png
# 應該回 200 + X-SignCMS-Cache: media-cas
```

### 3.2 綁定自定 domain

在 Cloudflare Dashboard：

1. **Workers & Pages** → 選 `signcms-api` worker
2. **Settings** → **Triggers** → **Custom Domains** → **Add Custom Domain**
3. 輸入 `cdn.signcms.net`（或您要的 host）
4. Cloudflare 會自動處理 DNS 與 SSL（若 `signcms.net` 已掛在同個 Cloudflare 帳號下）

驗證：

```bash
dig cdn.signcms.net           # 應指向 Cloudflare anycast IP
curl -I https://cdn.signcms.net/
# 應該回 200 + cf-ray header（代表走 Cloudflare）
```

### 3.3 Supabase 加 env var

到 Supabase Dashboard → Project Settings → Edge Functions → Secrets：

```
MEDIA_CDN_BASE_URL=https://cdn.signcms.net
```

設好後**不用重新部署 edge function**，下次有人呼叫 `upload-media` /
`transcode-callback` 就會生效。

### 3.4 套 migration 20260521000009

```sql
-- 不會自動跑，是給 operator 手動觸發的 RPC
-- 部署 migration 後，到 SQL Editor 跑：

SELECT public.rewrite_media_urls_to_cdn(
  'narhbpojjtnalyfiwxue.supabase.co',
  'cdn.signcms.net'
);

-- 回應：{"success": true, "url_updated": <N>, "thumb_updated": <M>}
```

## 4. 驗證 cache 真的生效

### 4.1 X-SignCMS-Cache header

```bash
curl -I https://cdn.signcms.net/storage/v1/object/public/media/assets/<sha256>.mp4
# 應該有：
# HTTP/2 200
# cache-control: public, max-age=31536000, immutable
# x-signcms-cache: media-cas
# cf-cache-status: HIT  ← 第二次以後請求看到 HIT
```

### 4.2 第一次 miss + 之後全 hit

```bash
# 第一次（cold cache）
curl -sI https://cdn.signcms.net/storage/v1/object/public/media/assets/<sha256>.mp4 | grep -i cf-cache-status
# cf-cache-status: MISS  ← cold miss，Cloudflare 拉一次 origin

# 第二次（熱了）
curl -sI https://cdn.signcms.net/storage/v1/object/public/media/assets/<sha256>.mp4 | grep -i cf-cache-status
# cf-cache-status: HIT
```

### 4.3 Cloudflare Analytics

Dashboard → Workers → `signcms-api` → **Metrics**：

| 指標 | 預期 |
|---|---|
| Total requests | 顯著上升（player 開始走 CDN） |
| Successful requests | ~ 100% |
| Subrequests | 應該遠少於 Total requests（多數 hit cache，不打 origin） |
| Cache HIT 比例 | > 90% 穩態 |

### 4.4 Supabase Storage egress 下降

Supabase Dashboard → Project Settings → **Usage** → **Bandwidth** 應該
看到部署後 24h 內顯著下降（部分 cold cache、後續穩態幾乎 0）。

## 5. 回滾

任何階段都可回退到「不走 CDN」的狀態：

```bash
# 1. 把 Supabase env 的 MEDIA_CDN_BASE_URL 移除（或設成空字串）
#    → 之後新上傳 / 新轉碼會用回 Supabase 直接 URL

# 2. 把既有 row 改回 Supabase host
psql -c "SELECT public.rewrite_media_urls_to_cdn('cdn.signcms.net', 'narhbpojjtnalyfiwxue.supabase.co');"

# 3. （選擇性）撤掉 Cloudflare Worker
cd cloudflare-worker && wrangler delete
```

## 6. 變更 cache 規則

更新 `cloudflare-worker/worker.js` 的 `CACHE_RULES` 後 `wrangler deploy`
即可。要 purge 已 cache 的內容：

- 全 purge：Dashboard → Caching → Configuration → **Purge Everything**
- 按 tag 部分 purge：Dashboard → Caching → **Purge by Tag** → 填 `media-cas` / `media-legacy` / `system-widgets`

## 7. 失敗模式 / 注意事項

| 情境 | 行為 |
|---|---|
| Worker crash | Cloudflare 邊緣自動降級，請求變 502 — player 端可 fallback 用原 Supabase URL（要在 player 端加 retry-on-bad-cdn 邏輯） |
| Cache 提供舊版檔（CAS 應該不會） | CAS 同 sha256 不可能變內容；如果不放心可短暫降 TTL 到 1 小時 |
| Range request 切片邊界錯 | Cloudflare 原生 handle Range；如果遇到問題，臨時改 `cacheTtlByStatus: { "206": 0 }` 強制每次 range 都打 origin |
| 私人 bucket | Worker 不接 `/storage/v1/object/sign/*` 簽名 URL —— 那些已經帶 expiry，CDN 不該介入 |
| 客戶要求資料留特定地區 | Cloudflare Workers 不保證 region；要 EU only 需要走 Cloudflare for SaaS + region binding |

## 8. 進階：分流 GET vs PUT

目前 worker 對所有路徑都 proxy（cache 規則只看 path）。下面這個檢查
可加在 `worker.js` 進階版：

```js
// 不要快取已登入用戶的 storage list / 私人 bucket 訪問
if (request.headers.get("Authorization") && !cacheRule) {
  // 直接 passthrough，跳過 CDN
}
```

目前 worker 已預設 GET / HEAD 才走 cache，其他 method 透傳。

## 9. 部署驗收 checklist

- [ ] `wrangler deploy` 成功
- [ ] `cdn.signcms.net` DNS 解析到 Cloudflare
- [ ] `curl -I https://cdn.signcms.net/storage/v1/object/public/media/assets/<known-sha>.mp4` → 200 + X-SignCMS-Cache header
- [ ] 第二次 curl → CF-Cache-Status: HIT
- [ ] Supabase env `MEDIA_CDN_BASE_URL` 已設
- [ ] 新上傳測試（上傳新檔 → DB 內 media_items.url 帶 cdn.signcms.net host）
- [ ] 跑 `rewrite_media_urls_to_cdn` migration → 看 url_updated / thumb_updated 數量符合預期
- [ ] Player 拉 stale 內容沒問題（隨機抽幾個現役 device 看）
- [ ] Cloudflare Analytics 顯示 cache hit > 90%
- [ ] Supabase Usage → Bandwidth 下降
