/**
 * cz-customizable 設定檔（中文化提示 + 專案專屬 scope）
 * 對應 commitlint.config.cjs 使用 @commitlint/config-conventional 的規則。
 *
 * 提示與輸出皆遵循 Conventional Commits：
 *   <type>(<scope>): <subject>
 *
 *   <body>
 *
 *   <footer>
 */
const { scopes } = require('./.commit-scopes.cjs');

module.exports = {
  // type 必須與 @commitlint/config-conventional 的 type-enum 相容
  types: [
    { value: 'feat',     name: 'feat:     ✨ 新功能 (對應 SemVer minor)' },
    { value: 'fix',      name: 'fix:      🐛 修 bug (對應 SemVer patch)' },
    { value: 'docs',     name: 'docs:     📝 只改文件 (README、註解…)' },
    { value: 'style',    name: 'style:    💄 格式調整 (空白、分號…不影響邏輯)' },
    { value: 'refactor', name: 'refactor: ♻️  重構 (非 bug 修正、非新功能)' },
    { value: 'perf',     name: 'perf:     ⚡ 效能優化' },
    { value: 'test',     name: 'test:     ✅ 新增/修改測試' },
    { value: 'build',    name: 'build:    📦 建置系統或外部依賴變更 (vite、npm…)' },
    { value: 'ci',       name: 'ci:       👷 CI 設定變更 (GitHub Actions、husky…)' },
    { value: 'chore',    name: 'chore:    🔧 雜項 (不改 src 或 test 的維護工作)' },
    { value: 'revert',   name: 'revert:   ⏪ 還原先前 commit' },
  ],

  // 專案模組 scope —— 從 .commit-scopes.cjs 載入（同時被 commitlint scope-enum 引用）
  scopes,

  // 關閉自訂 scope：強制只能用清單內的值，避免 CI 端被 commitlint 擋下
  allowCustomScopes: false,

  // 允許 BREAKING CHANGE 用於這些 type
  allowBreakingChanges: ['feat', 'fix', 'refactor', 'perf'],

  // ===== 中文化提示 =====
  messages: {
    type:           '請選擇本次 commit 的類型：',
    scope:          '\n請選擇本次變更的影響範圍 (scope，可選)：',
    customScope:    '請輸入自訂 scope：',
    subject:        '簡短描述本次變更 (祈使句、英文小寫開頭、不加句號)：\n',
    body:           '詳細說明（可選）。用 "|" 換行：\n',
    breaking:       '列出所有 BREAKING CHANGE（可選）：\n',
    footer:         '關聯的 issue（可選），例如 #31, #34：\n',
    confirmCommit:  '確定送出以上 commit？',
  },

  // 子主題長度上限（commitlint header-max-length 預設 100）
  subjectLimit: 72,

  // 跳過某些問題：scope/body/footer 都允許跳過，type/subject 必填
  skipQuestions: [],

  // 換行字元
  breaklineChar: '|',

  // footer 前綴（關聯 issue 用）
  footerPrefix: 'ISSUES CLOSED:',

  // 預設選項
  ticketNumberPrefix: '',
};
