/**
 * src/routes/openapi/spec.ts
 *
 * GET /api/docs/openapi.json  — OpenAPI 3.0 spec（機器可讀）
 * GET /api/docs               — Scalar UI（人類可讀，取代 Swagger UI）
 *
 * 這是手寫的 OpenAPI spec，涵蓋 BFF 所有端點。
 * 比自動生成更精確，可作為客戶 API 文件直接發布。
 */

import { FastifyPluginAsync } from 'fastify'
import { env } from '../../lib/env.js'

const SPEC = {
  openapi: '3.0.3',
  info: {
    title: 'SignCMS BFF API',
    version: '1.0.0',
    description: `SignCMS Enterprise 數位看板管理系統 — Backend API

## 認證方式

大多數 API 需要 Supabase JWT Bearer Token：
\`\`\`
Authorization: Bearer <supabase_access_token>
\`\`\`

Webhook 端點使用 \`X-Webhook-Token\`（每個 Org 各自的 token）。

## 基礎 URL

| 環境 | URL |
|------|-----|
| 本地開發 | http://localhost:3001 |
| Production | https://api.your-domain.com |
`,
    contact: { name: 'Bizlution', email: 'support@bizlution.ai' },
  },
  servers: [
    { url: env.NODE_ENV === 'production'
        ? (process.env.BFF_PUBLIC_URL ?? 'https://api.your-domain.com')
        : 'http://localhost:3001',
      description: env.NODE_ENV === 'production' ? 'Production' : 'Local Dev',
    },
  ],
  tags: [
    { name: 'Health', description: '存活探針與深度依賴檢查' },
    { name: 'Media', description: '媒體上傳與轉檔管理' },
    { name: 'License', description: 'License Code 產生、兌換與查詢' },
    { name: 'Webhook', description: '外部系統觸發 Smart Trigger' },
    { name: 'Knowledge', description: 'AI 知識庫 RAG 聊天' },
    { name: 'MCP', description: 'Model Context Protocol — AI Agent 控制介面' },
    { name: 'Onboarding', description: '客戶開通自動化（System Admin）' },
    { name: 'Admin', description: '客戶管理 Portal（System Admin）' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http', scheme: 'bearer', bearerFormat: 'JWT',
        description: 'Supabase 登入後取得的 access_token',
      },
      webhookToken: {
        type: 'apiKey', in: 'header', name: 'X-Webhook-Token',
        description: '各 Org 專屬的 Webhook Token（Publishing Center 取得）',
      },
    },
    schemas: {
      ApiSuccess: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', example: true },
          data: { type: 'object' },
        },
      },
      ApiError: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', example: false },
          error: { type: 'string' },
          code: { type: 'string' },
        },
      },
      Pagination: {
        type: 'object',
        properties: {
          page: { type: 'integer' },
          per_page: { type: 'integer' },
          total: { type: 'integer' },
          total_pages: { type: 'integer' },
        },
      },
    },
  },
  paths: {
    // ── Health ─────────────────────────────────────────────
    '/health': {
      get: {
        tags: ['Health'],
        summary: '快速存活探針',
        description: 'Load balancer liveness probe，毫秒級回應',
        responses: {
          '200': { description: 'Server is alive',
            content: { 'application/json': { schema: {
              type: 'object',
              properties: {
                status: { type: 'string', example: 'ok' },
                version: { type: 'string', example: '1.0.0' },
                timestamp: { type: 'string', format: 'date-time' },
                uptime_seconds: { type: 'integer' },
                features: { type: 'object' },
              },
            }}},
          },
        },
      },
    },
    '/health/deep': {
      get: {
        tags: ['Health'],
        summary: '深度依賴檢查',
        description: '同時檢查 Supabase + Redis + ffmpeg Worker，任一失敗回 503',
        responses: {
          '200': { description: '所有依賴正常' },
          '503': { description: '一或多個依賴異常' },
        },
      },
    },

    // ── Media ──────────────────────────────────────────────
    '/api/media/upload': {
      post: {
        tags: ['Media'],
        summary: '上傳媒體檔案',
        description: '接受圖片或影片，自動判斷是否需要轉檔（>60fps / >20Mbps / 非 h264/mp4）',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file', 'org_id', 'name'],
                properties: {
                  file: { type: 'string', format: 'binary' },
                  org_id: { type: 'string', format: 'uuid' },
                  name: { type: 'string' },
                  source_fps: { type: 'number' },
                  source_bitrate: { type: 'number' },
                  source_codec: { type: 'string' },
                  source_container: { type: 'string' },
                  source_width: { type: 'integer' },
                  source_height: { type: 'integer' },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: '上傳成功',
            content: { 'application/json': { schema: {
              type: 'object',
              properties: {
                ok: { type: 'boolean', example: true },
                data: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    url: { type: 'string', format: 'uri' },
                    transcode_status: { type: 'string', enum: ['none', 'pending', 'processing', 'done', 'failed'] },
                  },
                },
              },
            }}},
          },
        },
      },
    },
    '/api/media/{mediaId}/transcode-status': {
      get: {
        tags: ['Media'],
        summary: '查詢轉檔狀態',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'mediaId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: '轉檔狀態' },
          '404': { description: '媒體不存在' },
        },
      },
    },

    // ── License ────────────────────────────────────────────
    '/api/license/generate': {
      post: {
        tags: ['License'],
        summary: '產生 License Code（System Admin）',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object',
            required: ['plan_name', 'extend_days'],
            properties: {
              plan_name: { type: 'string', example: 'standard' },
              extend_days: { type: 'integer', example: 365 },
              count: { type: 'integer', default: 1, maximum: 100 },
            },
          }}},
        },
        responses: { '200': { description: '產生的 License Codes' } },
      },
    },
    '/api/license/redeem': {
      post: {
        tags: ['License'],
        summary: '兌換 License Code（Org Admin）',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object',
            required: ['org_id', 'code'],
            properties: {
              org_id: { type: 'string', format: 'uuid' },
              code: { type: 'string', pattern: '^[0-9]{6}$', example: '123456' },
            },
          }}},
        },
        responses: {
          '200': { description: '兌換成功，授權到期日延長' },
          '400': { description: '無效 Code 或已兌換' },
        },
      },
    },
    '/api/license/device/verify': {
      post: {
        tags: ['License'],
        summary: '裝置 License 驗證',
        description: '數位看板播放器開機時呼叫，驗證裝置授權',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object',
            required: ['device_model', 'device_serial', 'code'],
            properties: {
              device_model: { type: 'string' },
              device_serial: { type: 'string' },
              code: { type: 'string', pattern: '^[0-9]{6}$' },
            },
          }}},
        },
        responses: {
          '200': { description: '授權有效' },
          '403': { description: '授權無效或已過期' },
        },
      },
    },

    // ── Webhook ────────────────────────────────────────────
    '/api/webhook/smart-trigger': {
      post: {
        tags: ['Webhook'],
        summary: '觸發 Smart Trigger',
        description: `IoT 感測器、GPIO、外部系統透過此端點觸發螢幕換頁。

**認證**：每個 Org 有獨立的 Webhook Token，在 Publishing Center → Smart Triggers 設定頁取得。

**Cooldown**：每條規則可設定冷卻時間，防止重複觸發。

**條件判斷**：規則可設定 \`trigger_condition\`（field / op / value），只有 payload 符合條件才觸發。`,
        security: [{ webhookToken: [] }],
        parameters: [
          { name: 'X-Debug-Id', in: 'header', required: false,
            schema: { type: 'string' }, description: '端對端追蹤 ID，回應中會帶回' },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object',
            required: ['org_id', 'trigger_source'],
            properties: {
              org_id: { type: 'string', format: 'uuid' },
              screen_id: { type: 'string', format: 'uuid', nullable: true },
              trigger_source: { type: 'string', enum: ['gpio', 'remote', 'api', 'iot_sensor', 'webhook', 'schedule'] },
              trigger_key: { type: 'string' },
              payload: { type: 'object', description: '自訂資料，用於條件判斷（如 { temperature: 35 }）' },
              debug_id: { type: 'string' },
            },
          }}},
        },
        responses: {
          '200': {
            description: '觸發結果',
            content: { 'application/json': { schema: {
              type: 'object',
              properties: {
                debug_id: { type: 'string' },
                matched_count: { type: 'integer' },
                skipped_count: { type: 'integer' },
                matched_rules: { type: 'array', items: { type: 'object' } },
                skipped_rules: { type: 'array', items: { type: 'object' } },
              },
            }}},
          },
          '401': { description: '缺少 X-Webhook-Token' },
          '403': { description: 'Token 不正確' },
        },
      },
    },

    // ── Knowledge ──────────────────────────────────────────
    '/api/knowledge/chat': {
      post: {
        tags: ['Knowledge'],
        summary: 'AI 知識庫聊天（SSE 串流）',
        description: '根據 Org 知識庫內容，用 Claude AI 回答客服問題。回應為 SSE 串流格式。',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object',
            required: ['messages'],
            properties: {
              messages: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    role: { type: 'string', enum: ['user', 'assistant'] },
                    content: { type: 'string' },
                  },
                },
              },
            },
          }}},
        },
        responses: {
          '200': {
            description: 'SSE 串流回應',
            content: { 'text/event-stream': { schema: { type: 'string' } } },
          },
        },
      },
    },

    // ── MCP ────────────────────────────────────────────────
    '/api/mcp': {
      post: {
        tags: ['MCP'],
        summary: 'MCP Server（AI Agent 控制介面）',
        description: `Model Context Protocol 端點，供 AI Agent 呼叫 SignCMS 工具。

**支援 method**：
- \`tools/list\` — 列出可用工具
- \`tools/call\` — 執行工具

**可用工具**：get_screen_status, list_screens, trigger_smart_rule, push_announcement, get_org_license_status`,
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object',
            required: ['method'],
            properties: {
              method: { type: 'string', enum: ['tools/list', 'tools/call'] },
              params: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  arguments: { type: 'object' },
                },
              },
            },
          }}},
        },
        responses: { '200': { description: 'MCP 回應' } },
      },
    },

    // ── Onboarding ─────────────────────────────────────────
    '/api/onboarding/provision': {
      post: {
        tags: ['Onboarding'],
        summary: '一鍵開通新客戶（System Admin）',
        description: `完整自動化流程：建立使用者 → 建立 Org → 套用 License → 寄送歡迎信。`,
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object',
            required: ['org_name', 'admin_email'],
            properties: {
              org_name: { type: 'string', example: '台灣好公司' },
              admin_email: { type: 'string', format: 'email' },
              admin_display_name: { type: 'string' },
              plan_name: { type: 'string', default: 'standard' },
              license_days: { type: 'integer', default: 365 },
              locale: { type: 'string', enum: ['zh', 'en', 'ja'], default: 'zh' },
              note: { type: 'string' },
            },
          }}},
        },
        responses: {
          '200': {
            description: '開通成功',
            content: { 'application/json': { schema: {
              type: 'object',
              properties: {
                ok: { type: 'boolean', example: true },
                data: {
                  type: 'object',
                  properties: {
                    org_id: { type: 'string', format: 'uuid' },
                    org_name: { type: 'string' },
                    admin_email: { type: 'string' },
                    license_code: { type: 'string' },
                    invite_link: { type: 'string', format: 'uri' },
                    welcome_email_sent: { type: 'boolean' },
                  },
                },
              },
            }}},
          },
        },
      },
    },
    '/api/onboarding/status/{orgId}': {
      get: {
        tags: ['Onboarding'],
        summary: '查詢 Org 開通狀態（System Admin）',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Org 開通狀態與統計' } },
      },
    },

    // ── Admin ──────────────────────────────────────────────
    '/api/admin/stats': {
      get: {
        tags: ['Admin'],
        summary: '平台整體統計（System Admin）',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: '統計數據',
            content: { 'application/json': { schema: {
              type: 'object',
              properties: {
                ok: { type: 'boolean' },
                data: {
                  type: 'object',
                  properties: {
                    total_orgs: { type: 'integer' },
                    active_orgs: { type: 'integer' },
                    expiring_soon: { type: 'integer' },
                    expired_orgs: { type: 'integer' },
                    total_screens: { type: 'integer' },
                  },
                },
              },
            }}},
          },
        },
      },
    },
    '/api/admin/orgs': {
      get: {
        tags: ['Admin'],
        summary: '列出所有客戶 Org（System Admin）',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'per_page', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'expired', 'expiring'] } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Org 列表（含授權狀態）' } },
      },
    },
    '/api/admin/orgs/{orgId}/extend-license': {
      post: {
        tags: ['Admin'],
        summary: '延長 Org 授權（System Admin）',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object',
            required: ['extend_days'],
            properties: {
              extend_days: { type: 'integer', example: 365 },
              note: { type: 'string' },
            },
          }}},
        },
        responses: { '200': { description: '延長成功，回傳新的到期日' } },
      },
    },
    '/api/admin/orgs/{orgId}/suspend': {
      post: {
        tags: ['Admin'],
        summary: '暫停 Org 服務（System Admin）',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object',
            required: ['reason'],
            properties: { reason: { type: 'string' } },
          }}},
        },
        responses: { '200': { description: '已暫停' } },
      },
    },
  },
}

// ─── Route ────────────────────────────────────────────────────

const openApiRoute: FastifyPluginAsync = async (fastify) => {

  // 機器可讀的 OpenAPI JSON
  fastify.get('/openapi.json', async () => SPEC)

  // Scalar UI（現代 API 文件介面，比 Swagger UI 更好看）
  fastify.get('/', async (_req, reply) => {
    reply.type('text/html').send(`<!DOCTYPE html>
<html>
<head>
  <title>SignCMS BFF API Docs</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
  <script
    id="api-reference"
    data-url="/api/docs/openapi.json"
    data-configuration='{"theme":"purple","layout":"modern"}'
  ></script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>`)
  })
}

export default openApiRoute
