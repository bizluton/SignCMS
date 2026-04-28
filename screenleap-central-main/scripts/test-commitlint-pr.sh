#!/usr/bin/env bash
# scripts/test-commitlint-pr.sh
# 自動化驗證 commitlint GitHub Action：先用不合規 commit 開 PR 預期紅燈，
# 再修正 commit 訊息預期綠燈，最後關 PR 並刪除遠端/本地分支。
#
# 需求：
#   - gh CLI 已登入 (gh auth status)
#   - 目前在乾淨的 git working tree
#   - 目標 base 分支預設為 main，可用 BASE_BRANCH 覆寫
#
# 用法：
#   bash scripts/test-commitlint-pr.sh
#   BASE_BRANCH=main bash scripts/test-commitlint-pr.sh

set -euo pipefail

BASE_BRANCH="${BASE_BRANCH:-main}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BRANCH="test/commitlint-${TIMESTAMP}"
WORKFLOW_NAME="commitlint (PR)"   # 對應 .github/workflows/lint.yml 中的 job name
POLL_INTERVAL=10
POLL_MAX=60   # 最多等 10 分鐘

log()  { printf "\033[1;34m[INFO]\033[0m  %s\n" "$*"; }
ok()   { printf "\033[1;32m[ OK ]\033[0m  %s\n" "$*"; }
warn() { printf "\033[1;33m[WARN]\033[0m  %s\n" "$*"; }
err()  { printf "\033[1;31m[ERR ]\033[0m  %s\n" "$*" >&2; }

cleanup() {
  local exit_code=$?
  log "清理階段：關 PR + 刪分支"
  if [[ -n "${PR_NUMBER:-}" ]]; then
    gh pr close "$PR_NUMBER" --delete-branch --comment "auto-cleanup by test-commitlint-pr.sh" \
      >/dev/null 2>&1 && ok "PR #$PR_NUMBER 已關閉並刪除遠端分支" \
      || warn "關 PR / 刪遠端分支失敗（可能已關）"
  fi
  git checkout "$BASE_BRANCH" >/dev/null 2>&1 || true
  git branch -D "$BRANCH" >/dev/null 2>&1 && ok "本地分支 $BRANCH 已刪除" || true
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

# --- 前置檢查 ---
command -v gh >/dev/null || { err "請先安裝 gh CLI"; exit 1; }
gh auth status >/dev/null 2>&1 || { err "gh 尚未登入，請先 gh auth login"; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { err "Working tree 不乾淨，請先 commit/stash"; exit 1; }

log "Base 分支：$BASE_BRANCH"
log "測試分支：$BRANCH"

git fetch origin "$BASE_BRANCH" --quiet
git checkout -b "$BRANCH" "origin/$BASE_BRANCH"

# --- Step 1: 故意用不合規 commit 訊息 ---
log "Step 1：建立不合規 commit（預期 commitlint 紅燈）"
echo "# commitlint test $(date)" > .commitlint-test.md
git add .commitlint-test.md
git commit -m "random msg" --no-verify   # 跳過本地 husky，讓 CI 來擋
git push -u origin "$BRANCH" --quiet

PR_URL=$(gh pr create \
  --base "$BASE_BRANCH" \
  --head "$BRANCH" \
  --title "test: commitlint job verification ($TIMESTAMP)" \
  --body "Automated test from scripts/test-commitlint-pr.sh — do not merge.")
PR_NUMBER=$(echo "$PR_URL" | grep -oE '[0-9]+$')
ok "PR 已開：$PR_URL (#$PR_NUMBER)"

# --- 等待並驗證紅燈 ---
wait_for_check() {
  local expected="$1"   # FAIL 或 PASS
  local label="$2"
  log "等待 commitlint job 結束，期望結果：$label"
  for ((i=1; i<=POLL_MAX; i++)); do
    sleep "$POLL_INTERVAL"
    # 取得 commitlint job 的 conclusion
    local conclusion
    conclusion=$(gh pr checks "$PR_NUMBER" --json name,state,conclusion 2>/dev/null \
      | node -e "
        let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{
          const arr=JSON.parse(d);
          const j=arr.find(x=>x.name && x.name.toLowerCase().includes('commitlint'));
          if(!j){console.log('PENDING');return;}
          if(j.state!=='COMPLETED'){console.log('PENDING');return;}
          console.log(j.conclusion||'UNKNOWN');
        });
      ") || conclusion="PENDING"

    if [[ "$conclusion" == "PENDING" ]]; then
      printf "  ...第 %d 次輪詢，仍在執行中\n" "$i"
      continue
    fi

    log "commitlint job 結束，conclusion=$conclusion"
    if [[ "$expected" == "FAIL" && "$conclusion" == "FAILURE" ]]; then
      ok "✅ 如預期紅燈（$label）"
      return 0
    elif [[ "$expected" == "PASS" && "$conclusion" == "SUCCESS" ]]; then
      ok "✅ 如預期綠燈（$label）"
      return 0
    else
      err "❌ 結果不如預期：expected=$expected, actual=$conclusion"
      return 1
    fi
  done
  err "輪詢逾時（$((POLL_INTERVAL*POLL_MAX))s）"
  return 1
}

wait_for_check "FAIL" "step1: random msg 應被擋下"

# --- Step 2: amend 成合規 commit 訊息 ---
log "Step 2：amend 成合規 commit 訊息（預期 commitlint 綠燈）"
git commit --amend -m "ci: verify commitlint job" --no-verify
git push --force-with-lease origin "$BRANCH" --quiet
ok "已 force-push 修正後 commit"

wait_for_check "PASS" "step2: ci: verify commitlint job 應通過"

ok "🎉 commitlint job 紅綠燈驗證皆符合預期"
# cleanup trap 會處理關 PR + 刪分支
