# CI/CD 建置完整清單

## 需要設定的 GitHub Secrets

前往：`github.com/bizlution/signcms-bff` → Settings → Secrets and variables → Actions

| Secret 名稱 | 取得方式 | 用途 |
|------------|---------|------|
| `GITHUB_TOKEN` | 自動提供，不需設定 | Push image 到 GHCR |
| `CF_ACCOUNT_ID` | Cloudflare Dashboard → 右側欄 Account ID | 更新 KV 版本號 |
| `CF_KV_NAMESPACE` | `wrangler kv:namespace create SIGNCMS_KV` 輸出的 ID | KV namespace |
| `CF_API_TOKEN` | Cloudflare → My Profile → API Tokens → 建立 KV Edit token | 寫入 KV |
| `SLACK_WEBHOOK` | Slack App → Incoming Webhooks（選填） | 發布通知 |

---

## 完整建置步驟（一次性設定）

### Step 1：建立 GitHub Repos

```bash
# BFF 主 repo
gh repo create bizlution/signcms-bff --private
cd signcms-bff && git init && git remote add origin ...

# Installer repo（腳本發布用）
gh repo create bizlution/signcms-installer --private
```

### Step 2：設定 GHCR 可見性

```bash
# 讓客戶伺服器可以 pull image（不需要 Docker login）
gh api /user/packages/container/signcms-bff/versions \
  --method PATCH \
  -f visibility=public
```

或在 GitHub → Packages → signcms-bff → Package settings → Change visibility → Public

### Step 3：建立 Cloudflare 基礎設施

```bash
# 安裝 wrangler
npm install -g wrangler
wrangler login

# 建立 KV namespace
wrangler kv:namespace create SIGNCMS_KV
# 記下輸出的 id，填入 wrangler.toml

# 部署 Worker
cd cloudflare-worker
wrangler deploy

# 上傳初始腳本
wrangler kv:key put --namespace-id=YOUR_NS_ID install_sh "$(cat ../scripts/install.sh)"
wrangler kv:key put --namespace-id=YOUR_NS_ID update_sh  "$(cat ../scripts/update.sh)"
wrangler kv:key put --namespace-id=YOUR_NS_ID signcms_latest_version "1.0.0"
```

### Step 4：設定 DNS

在 Cloudflare DNS 加入：
```
類型：CNAME
名稱：install
值：signcms-install-cdn.your-account.workers.dev
Proxy：開啟（橘色雲朵）
```

驗證：
```bash
curl https://install.bizlution.ai/version
# → {"version":"1.0.0","updated_at":"..."}

curl -fsSL https://install.bizlution.ai/signcms | head -5
# → #!/bin/bash 開頭的安裝腳本
```

### Step 5：第一次發布

```bash
cd signcms-bff

# 確認所有設定正確
git add -A && git commit -m "feat: initial release"
git push origin main
# → 觸發 CI：test → version(edge) → docker(push edge) → integration

# 正式發布 v1.0.0
git tag v1.0.0
git push origin v1.0.0
# → 觸發 CI：
#   test → version(1.0.0) → docker(push 1.0.0/1.0/1/latest) →
#   integration → release(GitHub Release) → notify-cdn(KV 更新)
```

---

## CI 流程時間估算

| Job | 時間 | 說明 |
|-----|------|------|
| test | ~2 min | typecheck + vitest |
| version | <1 min | 計算 tag |
| docker | ~8 min | amd64 + arm64 multi-arch build（有快取後 ~3 min）|
| integration | ~2 min | 拉 image + 啟動 + health check |
| release | <1 min | 建立 GitHub Release |
| notify-cdn | <1 min | 更新 KV |
| **總計** | **~14 min** | 有快取後約 **~8 min** |

---

## 版本號規範（Conventional Commits）

專案已有 `commitlint` 設定，PR merge 到 main 後：

```bash
# 功能更新 → 觸發 minor 版本
git tag v1.1.0 && git push origin v1.1.0

# Bug 修復 → 觸發 patch 版本
git tag v1.0.1 && git push origin v1.0.1

# 破壞性變更 → 觸發 major 版本
git tag v2.0.0 && git push origin v2.0.0
```

未來可接 `release-please` 自動產生 tag（已在 Lovable 原始專案中配置）。

---

## 客戶伺服器拉取 image（驗證）

image 設為 public 後，客戶伺服器不需要 `docker login`：

```bash
# 客戶伺服器端驗證
docker pull ghcr.io/bizlution/signcms-bff:latest
docker run --rm ghcr.io/bizlution/signcms-bff:latest node -e "console.log('ok')"
```

---

## 監控 CI 狀態

```bash
# 查看最新 workflow 執行狀況
gh run list --repo bizlution/signcms-bff --limit 5

# 查看特定 run 的 log
gh run view --repo bizlution/signcms-bff --log

# 手動觸發（強制重新 build）
gh workflow run ci.yml --repo bizlution/signcms-bff
```
