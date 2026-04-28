const { scopeNames } = require('./.commit-scopes.cjs');

module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // 限制 scope 只能用 .commit-scopes.cjs 清單內的值（可省略 scope）
    'scope-enum': [2, 'always', scopeNames],
    // scope 必須小寫（kebab-case）
    'scope-case': [2, 'always', 'kebab-case'],
    // 主旨至少 8 字，避免 "fix: typo" 這種沒資訊量的 commit
    'subject-min-length': [2, 'always', 8],
    // 主旨上限 72 字（與 .cz-config.cjs subjectLimit 一致）
    'subject-max-length': [2, 'always', 72],
    // body 每行上限 100 字，避免出現超長單行（換行用空行或 "|" 即可）
    'body-max-line-length': [2, 'always', 100],
    // footer 每行也限 100 字（issue 連結等）
    'footer-max-line-length': [2, 'always', 100],
  },
};
