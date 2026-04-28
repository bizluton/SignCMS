#!/usr/bin/env node
/**
 * 自動把 .gitmessage 設為本 repo 的 commit template。
 * 由 husky 的 prepare hook 觸發（npm install 後自動執行）。
 *
 * 使用 --local 只影響本 repo，不會污染使用者全域設定。
 * 失敗（例如不在 git repo 內）時靜默跳過，不阻斷 install 流程。
 */
const { execSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

const template = resolve(__dirname, '..', '.gitmessage');

if (!existsSync(template)) {
  console.warn('[setup-git-template] .gitmessage not found, skip');
  process.exit(0);
}

try {
  // 確認在 git repo 裡（CI 或 tarball 安裝可能不是）
  execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
  execSync(`git config --local commit.template "${template}"`, { stdio: 'ignore' });
  console.log('[setup-git-template] commit.template → .gitmessage ✔');
} catch {
  // 不在 git repo / 沒裝 git → 安靜跳過
}
