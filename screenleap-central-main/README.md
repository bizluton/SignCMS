# Welcome to your Lovable project

TODO: Document your project here

## Commit message 規範（Conventional Commits）

本專案使用 [Conventional Commits](https://www.conventionalcommits.org/) 規範，commit 時會由 husky 的 `commit-msg` hook 自動透過 `@commitlint/config-conventional` 檢查；不符合格式會被擋下。

### 互動式產生 commit message（中文化）

不熟規範時請用 commitizen + cz-customizable 互動 CLI（提示為繁體中文，scope 已預先列好專案模組）：

```bash
npm run commit
```

依提示用方向鍵選 **type**（feat / fix / docs…）、選 **scope**（auth / media / schedules / cs…），再輸入 **subject** 即可，產出的 message 一定符合 commitlint 規範。

> 提示與允許的 type / scope 清單定義於專案根目錄的 `.cz-config.cjs` 與 `.commit-scopes.cjs`，要新增模組請編輯後者。

### Git commit 範本（直接 `git commit` 也有提示）

執行 `npm install` 時會自動跑 `scripts/setup-git-template.cjs`，把 `.gitmessage` 設為本 repo 的 `commit.template`。之後直接 `git commit`（不加 `-m`）開啟編輯器時，會自動帶出 type/scope/長度提示，不用記規則也能寫對格式。

> 若手動安裝過後沒生效，可手動跑：`git config --local commit.template .gitmessage`

### 格式

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

- `type`：必填，下列常用類型之一
- `scope`：選填，但若填寫**只能用清單內的值**（由 `.commit-scopes.cjs` 定義並由 commitlint `scope-enum` 強制），且需小寫 kebab-case
- `subject`：必填，**8–72 字**、建議祈使句、結尾不加句號

### 長度限制（commitlint 強制）

| 規則                       | 值          | 說明                                                          |
| -------------------------- | ----------- | ------------------------------------------------------------- |
| `subject-min-length`       | 8           | 避免 `fix: typo` 這種沒資訊量的 commit                        |
| `subject-max-length`       | 72          | 與 `.cz-config.cjs` 的 `subjectLimit` 一致                    |
| `body-max-line-length`     | 100         | body 每行上限，避免出現超長單行（換行用空行或 `\|`）          |
| `footer-max-line-length`   | 100         | footer 每行上限（issue 連結等）                               |
| `scope-case`               | kebab-case  | scope 一律小寫、用 `-` 連字                                   |

### 常用 type

| type       | 用途                                               |
| ---------- | -------------------------------------------------- |
| `feat`     | 新功能                                             |
| `fix`      | 修 bug                                             |
| `chore`    | 雜項（相依套件升級、設定調整、無關 src 的小改動)  |
| `docs`     | 純文件變更（README、註解、JSDoc）                  |
| `refactor` | 重構，不改變外部行為也不修 bug                     |
| `test`     | 新增或修正測試                                     |
| `ci`       | CI/CD 設定變更（GitHub Actions、husky、lint-staged）|

其他可用：`style`、`perf`、`build`、`revert`。

### 可用 scope（單一來源：`.commit-scopes.cjs`）

> 同一份清單同時被 `commitlint`（CI 驗證）、`cz-customizable`（互動選單）、`pr-title.yml`（PR 標題檢查）引用。

| scope            | 影響範圍                              |
| ---------------- | ------------------------------------- |
| `auth`           | 登入 / 註冊 / 權限                    |
| `media`          | 素材庫、上傳、Edge Function           |
| `screens`        | 裝置 / 螢幕管理                       |
| `schedules`      | 排程播放                              |
| `publishing`    | 發布中心 / 緊急廣播                   |
| `content-studio` | 設計編輯器、Overlay、Widget           |
| `knowledge`      | 知識庫 / RAG 聊天                     |
| `cs`             | 客服系統 / Ticket / Delegation        |
| `admin`          | 後台管理 / 授權 / 組織                |
| `iot`            | IoT 裝置與感測                        |
| `i18n`           | 多語系（zh / en / ja）                |
| `ui`             | 共用元件 / 樣式 / 主題                |
| `db`             | Supabase migration / RLS / 函式       |
| `edge-fn`        | Supabase Edge Function                |
| `ci`             | GitHub Actions / husky / commitlint   |
| `deps`           | 依賴升級                              |
| `docs`           | README / memory / 文件                |

新增 / 移除 scope 只需編輯 `.commit-scopes.cjs`，三處設定會自動同步。

### 範例

```bash
feat(schedules): 新增播放清單拖曳排序
fix(auth): 修正 reset password token 過期判斷
chore: 升級 vite 至 5.4.10
docs(readme): 補 commit 規範說明
refactor(media): 抽出 displayName helper
test(activity-log): 補 localizeActivityDetail 單元測試
ci: 在 workflow 加 build job
```

### 略過檢查（緊急時）

```bash
git commit --no-verify -m "緊急 hotfix"
```

> 注意：`--no-verify` 會同時略過 `pre-commit`（eslint / vitest / activity-log / screen-log lint），請僅在必要時使用，並在後續補跑 `npm run lint && npm test`。

## 自動發版（release-please）

`main` 分支每次有新 conventional commits push 進來，[`googleapis/release-please-action`](https://github.com/googleapis/release-please-action) 會自動：

1. 開（或更新）一個 **Release PR**，內含 `CHANGELOG.md` 草稿與 `package.json` 版本 bump
2. 你 review 通過、merge 該 PR 後，會自動：
   - 打 git tag（如 `v1.2.0`）
   - 建 GitHub Release
   - 寫入 `CHANGELOG.md`

### 版本判斷規則

| commit type            | semver bump |
| ---------------------- | ----------- |
| `fix:`                 | patch (x.x.**+1**) |
| `feat:`                | minor (x.**+1**.0) |
| `BREAKING CHANGE:` footer / `feat!:` | major (**+1**.0.0) |
| 其他（`chore`/`docs`/`ci`/`test`/`refactor`） | 不觸發發版 |

### 不想發版

直接不 merge Release PR，或 commit 用 `chore:` / `docs:` 等不觸發 bump 的 type。

