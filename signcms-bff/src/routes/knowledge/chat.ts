/**
 * src/routes/knowledge/chat.ts
 *
 * POST /api/knowledge/chat
 *
 * 混合 Skills 架構（System Prompt + RAG）：
 *
 * ┌─────────────────────────────────────────────────────────┐
 * │  System Prompt（每次都帶，~1,800 tokens）                │
 * │  ├─ 角色定義和行為準則                                   │
 * │  ├─ 核心產品知識（架構、部署、API 認證）                  │
 * │  └─ 常見操作快速參考                                     │
 * ├─────────────────────────────────────────────────────────┤
 * │  RAG Context（依使用者問題動態擷取，~2,000 tokens）       │
 * │  ├─ 從 knowledge_items 找最相關的段落（最多 8 筆）        │
 * │  ├─ 依 category 關鍵字權重排序                           │
 * │  └─ 注入到 user message 前的 <context> 區塊              │
 * └─────────────────────────────────────────────────────────┘
 *
 * 模型：由 CLAUDE_MODEL 環境變數控制（預設 claude-haiku-4-5-20251001）
 */

import { FastifyPluginAsync } from 'fastify'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { requireAuth } from '../../middleware/auth.js'
import { supabaseAdmin } from '../../lib/supabase.js'
import { env } from '../../lib/env.js'

// ─── System Prompt（核心知識，每次對話都帶）──────────────────
const CORE_SYSTEM_PROMPT = `你是 SignCMS Enterprise 的專業客服 AI，由晟碁科技（Bizlution）提供。

## 角色定義

協助客戶和 IT 人員解決 SignCMS 數位看板管理系統的問題，包含安裝部署、功能操作、故障排除和技術整合。回答準確、簡潔，使用繁體中文。遇到不確定的問題，誠實說明並建議聯繫技術支援（support@bizlution.ai）。

## 核心產品快速參考

**系統架構**：前端（React）+ BFF API（Node.js/Fastify）+ Supabase DB + Android 播放器。BFF 跑在客戶 Docker 容器，Nginx 反向代理，Port 3001。

**一鍵安裝**：curl -fsSL https://install.bizlution.ai/signcms | sudo bash（Ubuntu/Debian，約 10-15 分鐘）

**API 認證**：
- 一般 API → Authorization: Bearer <supabase_jwt>
- Smart Trigger → X-Webhook-Token: <org_token>
- 播放器 API → X-Device-Token: <64char_hex>

**常用管理指令**：
- 查看狀態：/opt/signcms/scripts/status.sh
- 查看日誌：/opt/signcms/scripts/logs.sh [bff|nginx|redis]
- 手動更新：sudo /opt/signcms/scripts/update.sh
- 重啟：sudo systemctl restart signcms
- 設定檔：sudo nano /opt/signcms/config/.env

**影片轉碼**：超過 60fps/20Mbps/非 H.264 自動轉碼，約 80-200 秒。前端媒體卡片顯示進度條。完成後 URL 切換至 R2，Supabase Storage 原始檔自動刪除。

**License Code**：6 位數字，Org Admin 在後台兌換，或 POST /api/license/redeem。一次只能用一次，兌換後延長授權天數。

**播放器同步**：每 5 分鐘 hash 探針，hash 不同才下載完整 manifest，依 md5 只下載差異媒體。斷網繼續播放本地快取。

## 行為準則

- 先確認問題情境再給解答
- 提供可直接執行的指令，附上具體數值
- 不確定時引導聯繫 support@bizlution.ai
- 禁止憑空捏造功能或 API 端點`

// ─── SSE 輸出 helper ──────────────────────────────────────────
function sseChunk(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
}

// ─── 關鍵字類別映射（提升 RAG 精準度）────────────────────────
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  deployment:     ['安裝', '部署', 'install', 'docker', 'nginx', 'ssl', 'dns', '伺服器', '憑證', '更新', 'migration'],
  api:            ['api', '端點', 'endpoint', '認證', 'token', 'jwt', '請求', '回應', '401', '403', '404'],
  media:          ['媒體', '圖片', '影片', '上傳', '轉碼', 'transcode', 'r2', '素材', '格式', 'mp4', 'hevc'],
  player:         ['播放器', 'android', '螢幕', '同步', 'manifest', '裝置', '下載', '離線', '快取', '排程'],
  license:        ['license', '授權', 'code', '兌換', '到期', '方案', '付費'],
  'smart-trigger':['trigger', '觸發', 'webhook', 'iot', 'gpio', '感測器', '條件', '冷卻', 'cooldown'],
  security:       ['安全', '權限', '隔離', 'token', '撤銷', 'revoke', '多租戶', 'rls'],
  troubleshooting:['失敗', '錯誤', 'error', '無法', '問題', '排查', '除錯', '不work', '壞掉'],
  architecture:   ['架構', 'bff', 'supabase', 'redis', 'cicd', 'schema', '資料庫'],
}

/**
 * 依使用者問題內容，計算各 category 的相關性分數，
 * 回傳排序後的 category 列表，用於 RAG 查詢排序
 */
function rankCategories(userQuestion: string): string[] {
  const q = userQuestion.toLowerCase()
  const scores: Record<string, number> = {}

  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    scores[cat] = keywords.filter(kw => q.includes(kw)).length
  }

  return Object.entries(scores)
    .sort(([, a], [, b]) => b - a)
    .filter(([, score]) => score > 0)
    .map(([cat]) => cat)
}

const messagesSchema = z.array(
  z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })
).min(1)

// ─── Route ────────────────────────────────────────────────────
const knowledgeChatRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/chat',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!env.ANTHROPIC_API_KEY) {
        return reply.status(503).send({ error: 'AI 服務未設定，請聯繫管理員' })
      }

      const bodyParsed = z.object({ messages: messagesSchema }).safeParse(request.body)
      if (!bodyParsed.success) {
        return reply.status(400).send({ error: '無效的訊息格式' })
      }
      const { messages } = bodyParsed.data

      // ── RAG：依問題內容智慧擷取知識庫 ──────────────────────
      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content ?? ''
      const rankedCategories = rankCategories(lastUserMsg)
      const db = supabaseAdmin()

      let ragItems: any[] = []

      if (rankedCategories.length > 0) {
        // 優先撈最相關 category 的條目（最多 6 筆）
        const { data: topItems } = await db
          .from('knowledge_items')
          .select('title, description, category, sub_category')
          .eq('synced', true)
          .in('category', rankedCategories.slice(0, 3))
          .limit(6)
        ragItems = topItems ?? []
      }

      // 補充其他 category 填滿至 8 筆（背景知識兜底）
      if (ragItems.length < 8) {
        const usedCategories = rankedCategories.slice(0, 3)
        const { data: fallbackItems } = await db
          .from('knowledge_items')
          .select('title, description, category, sub_category')
          .eq('synced', true)
          .not('category', 'in', `(${usedCategories.map(c => `"${c}"`).join(',')})`)
          .limit(8 - ragItems.length)
        ragItems = [...ragItems, ...(fallbackItems ?? [])]
      }

      // ── 組裝 System Prompt（核心知識 + RAG context）─────────
      let systemPrompt = CORE_SYSTEM_PROMPT

      if (ragItems.length > 0) {
        const ragContext = ragItems
          .map((item: any) =>
            `### ${item.title}（${item.sub_category}）\n${item.description}`
          )
          .join('\n\n')

        systemPrompt += `\n\n## 相關知識庫參考（依問題擷取）\n\n${ragContext}`
      }

      // ── SSE Headers ──────────────────────────────────────────
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': env.FRONTEND_ORIGIN,
      })

      // ── 呼叫 Claude API（streaming）─────────────────────────
      const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

      try {
        const stream = await anthropic.messages.stream({
          model: env.CLAUDE_MODEL,
          max_tokens: 1024,
          system: systemPrompt,
          messages: messages.map(m => ({ role: m.role, content: m.content })),
        })

        for await (const event of stream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            reply.raw.write(sseChunk(event.delta.text))
          }
        }

        reply.raw.write('data: [DONE]\n\n')
        reply.raw.end()

        // 記錄 RAG 命中情況（供後續優化）
        request.log.info(
          {
            model: env.CLAUDE_MODEL,
            ragHits: ragItems.length,
            topCategories: rankedCategories.slice(0, 3),
            question: lastUserMsg.slice(0, 50),
          },
          'knowledge chat completed'
        )
      } catch (err: any) {
        request.log.error({ err }, 'Claude API error')
        const msg = err?.status === 429
          ? '請求過於頻繁，請稍後再試'
          : 'AI 服務暫時無法使用'
        reply.raw.write(`data: ${JSON.stringify({ error: msg })}\n\n`)
        reply.raw.end()
      }
    }
  )
}

export default knowledgeChatRoute
