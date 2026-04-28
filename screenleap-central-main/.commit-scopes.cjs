/**
 * 專案統一的 commit scope 清單。
 * 同時被 .cz-config.cjs（commitizen 互動選單）與 commitlint.config.cjs（CI 驗證）引用，
 * 確保「能選的 scope」與「能通過驗證的 scope」永遠一致。
 *
 * 新增/移除 scope 時只需修改本檔。
 */
const scopes = [
  { name: 'auth',           description: '登入 / 註冊 / 權限' },
  { name: 'media',          description: '素材庫、上傳、Edge Function' },
  { name: 'screens',        description: '裝置/螢幕管理' },
  { name: 'schedules',      description: '排程播放' },
  { name: 'publishing',     description: '發布中心 / 緊急廣播' },
  { name: 'content-studio', description: '設計編輯器、Overlay、Widget' },
  { name: 'knowledge',      description: '知識庫 / RAG 聊天' },
  { name: 'cs',             description: '客服系統 / Ticket / Delegation' },
  { name: 'admin',          description: '後台管理 / 授權 / 組織' },
  { name: 'iot',            description: 'IoT 裝置與感測' },
  { name: 'i18n',           description: '多語系 (zh / en / ja)' },
  { name: 'ui',             description: '共用元件 / 樣式 / 主題' },
  { name: 'db',             description: 'Supabase migration / RLS / 函式' },
  { name: 'edge-fn',        description: 'Supabase Edge Function' },
  { name: 'ci',             description: 'GitHub Actions / husky / commitlint' },
  { name: 'deps',           description: '依賴升級' },
  { name: 'docs',           description: 'README / memory / 文件' },
];

module.exports = {
  scopes,
  scopeNames: scopes.map((s) => s.name),
};
