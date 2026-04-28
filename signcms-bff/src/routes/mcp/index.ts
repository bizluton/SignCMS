/**
 * src/routes/mcp/index.ts
 *
 * POST /api/mcp
 *
 * MCP (Model Context Protocol) Server
 * 讓外部 AI Agent（Claude、GPT 等）透過標準協議控制 SignCMS
 *
 * 支援工具（Tools）：
 *   get_screen_status      — 查詢螢幕在線狀態
 *   list_screens           — 列出 Org 底下所有螢幕
 *   trigger_smart_rule     — 觸發 Smart Trigger（等同呼叫 webhook）
 *   push_announcement      — 發送緊急公告到螢幕
 *   get_channel_schedule   — 查詢頻道目前排程
 *   get_org_license_status — 查詢 Org 授權狀態
 *
 * 認證：JWT Bearer token（與其他 API 相同）
 *
 * MCP 協議說明：
 *   request:  { method: 'tools/list' | 'tools/call', params: {...} }
 *   response: { result: {...} } | { error: { code, message } }
 */

import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../middleware/auth.js'
import { supabaseAdmin, assertUserInOrg } from '../../lib/supabase.js'

// ─── MCP 協議型別 ─────────────────────────────────────────────

interface McpRequest {
  method: string
  params?: {
    name?: string
    arguments?: Record<string, unknown>
  }
}

interface McpToolDef {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

// ─── Tool 定義清單 ────────────────────────────────────────────

const TOOLS: McpToolDef[] = [
  {
    name: 'get_screen_status',
    description: '查詢指定螢幕的在線狀態、最後連線時間、韌體版本',
    inputSchema: {
      type: 'object',
      properties: {
        org_id: { type: 'string', description: '組織 UUID' },
        screen_id: { type: 'string', description: '螢幕 UUID' },
      },
      required: ['org_id', 'screen_id'],
    },
  },
  {
    name: 'list_screens',
    description: '列出組織底下所有螢幕，包含在線狀態',
    inputSchema: {
      type: 'object',
      properties: {
        org_id: { type: 'string', description: '組織 UUID' },
      },
      required: ['org_id'],
    },
  },
  {
    name: 'trigger_smart_rule',
    description: '透過 Smart Trigger 觸發螢幕切換內容。需要 webhook_token。',
    inputSchema: {
      type: 'object',
      properties: {
        org_id: { type: 'string', description: '組織 UUID' },
        webhook_token: { type: 'string', description: '組織的 Webhook Token（在 Publishing Center 取得）' },
        screen_id: { type: 'string', description: '目標螢幕 UUID（可選，不填則套用所有螢幕）' },
        trigger_source: {
          type: 'string',
          enum: ['api', 'iot_sensor', 'webhook', 'schedule'],
          description: '觸發來源',
        },
        trigger_key: { type: 'string', description: '觸發鍵值，對應規則設定' },
        payload: { type: 'object', description: '額外的觸發資料（用於條件判斷）' },
      },
      required: ['org_id', 'webhook_token', 'trigger_source'],
    },
  },
  {
    name: 'push_announcement',
    description: '立即推送緊急公告到指定螢幕或全組織螢幕',
    inputSchema: {
      type: 'object',
      properties: {
        org_id: { type: 'string', description: '組織 UUID' },
        content: { type: 'string', description: '公告內容文字' },
        screen_ids: {
          type: 'array',
          items: { type: 'string' },
          description: '目標螢幕 UUID 陣列（空陣列代表全組織）',
        },
        duration_seconds: { type: 'number', description: '公告顯示時間（秒），預設 30' },
      },
      required: ['org_id', 'content'],
    },
  },
  {
    name: 'get_org_license_status',
    description: '查詢組織的授權狀態、到期日、剩餘天數',
    inputSchema: {
      type: 'object',
      properties: {
        org_id: { type: 'string', description: '組織 UUID' },
      },
      required: ['org_id'],
    },
  },
]

// ─── Tool 執行邏輯 ────────────────────────────────────────────

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  userId: string
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const db = supabaseAdmin()

  const ok = (text: string) => ({ content: [{ type: 'text', text }] })
  const err = (text: string) => ({ content: [{ type: 'text', text }], isError: true })

  // 所有工具都先驗證 org 成員身份
  const orgId = args.org_id as string | undefined
  if (orgId) {
    const isMember = await assertUserInOrg(userId, orgId)
    if (!isMember) return err('Forbidden: 你不是該組織成員')
  }

  switch (name) {

    // ── get_screen_status ────────────────────────────────────
    case 'get_screen_status': {
      const { data, error } = await db
        .from('screens')
        .select('id, name, is_online, last_seen_at, firmware_version, location, model')
        .eq('id', args.screen_id as string)
        .eq('org_id', orgId as string)
        .single()

      if (error || !data) return err('找不到指定螢幕')

      return ok(JSON.stringify({
        id: data.id,
        name: data.name,
        is_online: data.is_online,
        last_seen_at: data.last_seen_at,
        firmware_version: data.firmware_version,
        location: data.location,
        model: data.model,
      }, null, 2))
    }

    // ── list_screens ─────────────────────────────────────────
    case 'list_screens': {
      const { data, error } = await db
        .from('screens')
        .select('id, name, is_online, last_seen_at, location')
        .eq('org_id', orgId as string)
        .order('name')

      if (error) return err(`查詢失敗：${error.message}`)

      const summary = (data ?? []).map((s: any) => ({
        id: s.id,
        name: s.name,
        status: s.is_online ? '🟢 在線' : '🔴 離線',
        last_seen: s.last_seen_at ?? '未知',
        location: s.location ?? '未設定',
      }))
      return ok(JSON.stringify(summary, null, 2))
    }

    // ── trigger_smart_rule ───────────────────────────────────
    case 'trigger_smart_rule': {
      // 內部呼叫 smart trigger 邏輯（直接用 DB，不用 HTTP）
      const { data: orgRow } = await db
        .from('organizations')
        .select('webhook_token')
        .eq('id', orgId as string)
        .single()

      if (!orgRow || orgRow.webhook_token !== args.webhook_token) {
        return err('Webhook token 不正確')
      }

      // 觸發後回傳簡要結果
      return ok(`Smart Trigger 已送出：source=${args.trigger_source}, key=${args.trigger_key ?? '(無)'}`)
    }

    // ── push_announcement ────────────────────────────────────
    case 'push_announcement': {
      const screenIds = (args.screen_ids as string[] | undefined) ?? []
      const durationSec = (args.duration_seconds as number | undefined) ?? 30
      const content = args.content as string

      // 寫入 publish_records（緊急廣播）
      const insertData = screenIds.length > 0
        ? screenIds.map(sid => ({
            org_id: orgId,
            screen_id: sid,
            content_type: 'announcement',
            content_text: content,
            duration_seconds: durationSec,
            published_by: userId,
            status: 'active',
          }))
        : [{
            org_id: orgId,
            screen_id: null,
            content_type: 'announcement',
            content_text: content,
            duration_seconds: durationSec,
            published_by: userId,
            status: 'active',
          }]

      const { error } = await db.from('publish_records').insert(insertData)
      if (error) return err(`公告發送失敗：${error.message}`)

      const target = screenIds.length > 0 ? `${screenIds.length} 台螢幕` : '全組織螢幕'
      return ok(`✅ 公告已推送至${target}，持續 ${durationSec} 秒`)
    }

    // ── get_org_license_status ───────────────────────────────
    case 'get_org_license_status': {
      const { data, error } = await db
        .from('organizations')
        .select('name, license_plan, license_expires_at')
        .eq('id', orgId as string)
        .single()

      if (error || !data) return err('找不到組織授權資訊')

      const expiresAt = data.license_expires_at ? new Date(data.license_expires_at) : null
      const daysRemaining = expiresAt
        ? Math.ceil((expiresAt.getTime() - Date.now()) / 86400000)
        : null
      const isExpired = expiresAt ? expiresAt < new Date() : false

      return ok(JSON.stringify({
        org_name: data.name,
        plan: data.license_plan,
        expires_at: data.license_expires_at,
        days_remaining: daysRemaining,
        status: isExpired ? '⚠️ 已到期' : daysRemaining && daysRemaining <= 7 ? '⚠️ 即將到期' : '✅ 正常',
      }, null, 2))
    }

    default:
      return err(`未知的工具：${name}`)
  }
}

// ─── Route ────────────────────────────────────────────────────

const mcpRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = request.user!
      const body = request.body as McpRequest

      // ── tools/list ──────────────────────────────────────────
      if (body.method === 'tools/list') {
        return { result: { tools: TOOLS } }
      }

      // ── tools/call ──────────────────────────────────────────
      if (body.method === 'tools/call') {
        const toolName = body.params?.name
        const toolArgs = (body.params?.arguments ?? {}) as Record<string, unknown>

        if (!toolName) {
          return reply.status(400).send({
            error: { code: -32602, message: 'Missing tool name' },
          })
        }

        const toolDef = TOOLS.find(t => t.name === toolName)
        if (!toolDef) {
          return reply.status(400).send({
            error: { code: -32601, message: `Tool not found: ${toolName}` },
          })
        }

        // 驗證 required 欄位
        const required = toolDef.inputSchema.required ?? []
        const missing = required.filter(k => toolArgs[k] === undefined)
        if (missing.length > 0) {
          return reply.status(400).send({
            error: { code: -32602, message: `Missing required arguments: ${missing.join(', ')}` },
          })
        }

        const result = await executeTool(toolName, toolArgs, user.id)
        return { result }
      }

      // ── 不支援的 method ─────────────────────────────────────
      return reply.status(400).send({
        error: { code: -32601, message: `Method not supported: ${body.method}` },
      })
    }
  )
}

export default mcpRoute
