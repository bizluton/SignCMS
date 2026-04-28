/**
 * src/routes/player/index.ts
 *
 * 播放器完整 API（取代並修正之前的 manifest.ts）
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │  Token 核發（Org Admin 操作）                                │
 * │  POST /api/player/screens/:screenId/issue-token             │
 * │  POST /api/player/screens/:screenId/revoke-token            │
 * │  GET  /api/player/screens/:screenId/token-status            │
 * ├─────────────────────────────────────────────────────────────┤
 * │  播放器使用（裝置端，X-Device-Token 認證）                   │
 * │  GET  /api/player/manifest/:screenId/hash   輕量探針         │
 * │  GET  /api/player/manifest/:screenId        完整 manifest    │
 * └─────────────────────────────────────────────────────────────┘
 *
 * 修正之前的 Bug：
 *   ❌ 舊版：直接查 screens.device_token（欄位不存在）
 *   ✅ 新版：呼叫 get_screen_by_device_token() RPC（SECURITY DEFINER）
 *            → 驗證 token → 取得 screen_id + org_id
 *            → manifest 只回傳該 screen 的排程，不允許跨 screen
 */

import { FastifyPluginAsync } from 'fastify'
import { createHash } from 'crypto'
import { z } from 'zod'
import { requireAuth } from '../../middleware/auth.js'
import { supabaseAdmin } from '../../lib/supabase.js'

// ─── 常數 ─────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DEVICE_TOKEN_RE = /^[0-9a-f]{64}$/

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
  'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/aac': 'aac',
}

function extFromMime(mime: string | null): string {
  if (!mime) return 'bin'
  return MIME_TO_EXT[mime.toLowerCase()] ?? mime.split('/')[1]?.split('+')[0] ?? 'bin'
}

function localFilename(md5: string | null, mime: string | null): string | null {
  if (!md5) return null
  return `${md5}.${extFromMime(mime)}`
}

function computeManifestHash(
  mediaList: Array<{ id: string; md5: string | null; size_bytes: number | null }>,
  scheduleUpdatedAt: string | null
): string {
  const sorted = [...mediaList].sort((a, b) => a.id.localeCompare(b.id))
  const payload = JSON.stringify({ media: sorted, updated_at: scheduleUpdatedAt ?? '' })
  return createHash('sha256').update(payload).digest('hex')
}

// ─── 核心：驗證 Device Token ───────────────────────────────────
//
// 呼叫 get_screen_by_device_token()（SECURITY DEFINER RPC）
// 這是唯一可以讀到 device_token 欄位的路徑，
// BFF 用 service_role 呼叫，前端絕對無法直接查詢

interface TokenVerifyResult {
  ok: boolean
  screenId?: string
  orgId?: string
  screenName?: string
  error?: string
}

async function verifyDeviceToken(token: string): Promise<TokenVerifyResult> {
  if (!DEVICE_TOKEN_RE.test(token)) {
    return { ok: false, error: 'invalid_token_format' }
  }

  const db = supabaseAdmin()
  const { data, error } = await db.rpc('get_screen_by_device_token', {
    _token: token,
  })

  if (error) {
    return { ok: false, error: `rpc_error: ${error.message}` }
  }

  const result = data as {
    ok: boolean
    screen_id?: string
    org_id?: string
    screen_name?: string
    error?: string
  }

  if (!result.ok) {
    return { ok: false, error: result.error ?? 'invalid_token' }
  }

  return {
    ok: true,
    screenId: result.screen_id,
    orgId: result.org_id,
    screenName: result.screen_name,
  }
}

// ─── 核心：建立 Manifest ──────────────────────────────────────

async function buildManifest(screenId: string, orgId: string) {
  const db = supabaseAdmin()
  const today = new Date().toISOString().slice(0, 10)

  // 有效排程（只取屬於此 screen 的）
  const { data: schedRow } = await db
    .from('schedules')
    .select('*')
    .eq('screen_id', screenId)
    .eq('enabled', true)
    .or(`start_date.is.null,start_date.lte.${today}`)
    .or(`end_date.is.null,end_date.gte.${today}`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // 無排程：回傳空 manifest（Android 清空本地媒體）
  if (!schedRow) {
    const hash = createHash('sha256').update(`empty:${screenId}`).digest('hex')
    return {
      hash,
      manifest: {
        format: 'signcms.player.manifest', version: 2,
        manifest_hash: hash,
        generated_at: new Date().toISOString(),
        screen: { id: screenId },
        schedule: null,
        items: [], bgm: [], design_projects: [],
        media: [], widgets: [], warnings: [],
      },
    }
  }

  // 排程項目
  const { data: itemRows } = await db
    .from('schedule_items')
    .select('media_id, design_project_id, item_type, duration, sort_order')
    .eq('schedule_id', schedRow.id)
    .order('sort_order')

  const { data: bgmRows } = await db
    .from('schedule_bgm_items')
    .select('media_id, sort_order')
    .eq('schedule_id', schedRow.id)
    .order('sort_order')

  // 收集所有 ID
  const mediaIds = new Set<string>()
  const designIds = new Set<string>()
  const widgetIds = new Set<string>()
  const isWidgetId = (id: string) =>
    id.startsWith('system-widget-') || id.startsWith('cat-widget-')

  for (const it of itemRows ?? []) {
    if (it.media_id) {
      const id = String(it.media_id)
      if (isWidgetId(id)) widgetIds.add(id)
      else if (UUID_RE.test(id)) mediaIds.add(id)
    }
    if (it.design_project_id) designIds.add(String(it.design_project_id))
  }
  for (const b of bgmRows ?? []) {
    if (b.media_id && UUID_RE.test(String(b.media_id))) mediaIds.add(String(b.media_id))
  }

  // Design Projects（並收集 zone 內的媒體）
  let designRows: any[] = []
  if (designIds.size > 0) {
    const { data } = await db
      .from('design_projects')
      .select('id, name, aspect, zones, updated_at, created_at')
      .in('id', Array.from(designIds))
      .eq('org_id', orgId)   // ← 確保 design project 屬於同一個 org
    designRows = data ?? []

    const walkContent = (content: any) => {
      if (!content) return
      if (Array.isArray(content.mediaItems)) {
        for (const m of content.mediaItems) {
          if (!m?.id || !UUID_RE.test(String(m.id))) continue
          if (m.type && m.type !== 'image' && m.type !== 'video') continue
          mediaIds.add(String(m.id))
        }
      }
    }
    for (const d of designRows) {
      for (const z of Array.isArray(d.zones) ? d.zones : []) {
        walkContent(z?.content)
        if (Array.isArray(z?.overlays)) {
          for (const o of z.overlays) walkContent(o?.content)
        }
        const bgmItems = z?.bgm?.items
        if (Array.isArray(bgmItems)) {
          for (const a of bgmItems) {
            if (a?.id && UUID_RE.test(String(a.id))) mediaIds.add(String(a.id))
          }
        }
      }
    }
  }

  // Media Items（加上 org_id 過濾，確保不跨 org 取資料）
  let mediaRows: any[] = []
  if (mediaIds.size > 0) {
    const { data } = await db
      .from('media_items')
      .select('id, name, original_name, type, mime_type, url, storage_path, md5, size_bytes, width, height, duration_seconds, transcode_status')
      .in('id', Array.from(mediaIds))
      .eq('org_id', orgId)   // ← 關鍵：只取屬於此 org 的媒體
    mediaRows = data ?? []
  }

  // 組裝 media manifest
  const warnings: any[] = []
  const mediaManifest: any[] = []
  const fetchedIds = new Set(mediaRows.map((r: any) => String(r.id)))

  for (const id of mediaIds) {
    if (!fetchedIds.has(id)) warnings.push({ media_id: id, reason: 'media_not_found_in_db' })
  }

  for (const m of mediaRows) {
    if (m.transcode_status === 'pending' || m.transcode_status === 'processing') {
      warnings.push({ media_id: String(m.id), reason: `transcode_${m.transcode_status}` })
      continue
    }
    const url: string = m.url ?? ''
    if (url.startsWith('data:')) {
      warnings.push({ media_id: String(m.id), reason: 'base64_not_downloadable' })
      continue
    }
    mediaManifest.push({
      id: String(m.id),
      name: m.name,
      original_name: m.original_name ?? m.name,
      type: m.type,
      mime_type: m.mime_type,
      md5: m.md5 ?? null,
      size_bytes: m.size_bytes ?? null,
      url,
      storage_path: m.storage_path ?? null,
      local_filename: localFilename(m.md5, m.mime_type),
      duration_seconds: m.duration_seconds ?? null,
      width: m.width ?? null,
      height: m.height ?? null,
    })
  }

  // Widgets
  const widgetManifest: any[] = []
  const catalogUuids: string[] = []
  for (const id of widgetIds) {
    if (id.startsWith('cat-widget-')) catalogUuids.push(id.replace(/^cat-widget-/, ''))
    else widgetManifest.push({ id, type: 'widget', mime_type: 'application/x-widget', source: 'system' })
  }
  if (catalogUuids.length > 0) {
    const { data: wData } = await db.from('widgets').select('id, name, config').in('id', catalogUuids)
    for (const w of wData ?? []) {
      widgetManifest.push({
        id: `cat-widget-${w.id}`, name: w.name,
        type: 'widget', mime_type: 'application/x-widget',
        source: 'catalog', widgetConfig: w.config,
      })
    }
  }

  // Design BGM
  const designBgm: any[] = []
  const bgmSeen = new Set<string>()
  let bgmOrder = 1000
  for (const d of designRows) {
    for (const z of Array.isArray(d.zones) ? d.zones : []) {
      for (const a of Array.isArray(z?.bgm?.items) ? z.bgm.items : []) {
        const id = a?.id ? String(a.id) : ''
        if (!UUID_RE.test(id) || bgmSeen.has(id)) continue
        bgmSeen.add(id)
        designBgm.push({ media_id: id, sort_order: bgmOrder++ })
      }
    }
  }

  const hash = computeManifestHash(
    mediaManifest.map(m => ({ id: m.id, md5: m.md5, size_bytes: m.size_bytes })),
    schedRow.updated_at ?? null
  )

  return {
    hash,
    manifest: {
      format: 'signcms.player.manifest', version: 2,
      manifest_hash: hash,
      generated_at: new Date().toISOString(),
      screen: { id: screenId },
      schedule: {
        id: schedRow.id, name: schedRow.name,
        start_date: schedRow.start_date ?? null,
        end_date: schedRow.end_date ?? null,
        start_time: schedRow.start_time ?? null,
        end_time: schedRow.end_time ?? null,
        days: schedRow.days ?? [],
        enabled: schedRow.enabled,
        bgm_volume: schedRow.bgm_volume ?? 50,
        updated_at: schedRow.updated_at,
      },
      items: (itemRows ?? []).map((i: any) => ({
        media_id: i.media_id, design_project_id: i.design_project_id,
        item_type: i.item_type, duration: i.duration, sort_order: i.sort_order,
      })),
      bgm: [
        ...(bgmRows ?? []).map((b: any) => ({ media_id: b.media_id, sort_order: b.sort_order })),
        ...designBgm,
      ],
      design_projects: designRows.map((d: any) => ({
        id: d.id, name: d.name, aspect: d.aspect,
        zones: d.zones, updated_at: d.updated_at, created_at: d.created_at,
      })),
      media: mediaManifest,
      widgets: widgetManifest,
      warnings,
    },
  }
}

// ─── Routes ────────────────────────────────────────────────────

const playerRoutes: FastifyPluginAsync = async (fastify) => {

  // ════════════════════════════════════════════════════════
  // Token 管理（Org Admin 使用，需要 JWT）
  // ════════════════════════════════════════════════════════

  // ── POST /api/player/screens/:screenId/issue-token ───────
  fastify.post<{ Params: { screenId: string } }>(
    '/screens/:screenId/issue-token',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { screenId } = request.params
      if (!UUID_RE.test(screenId)) {
        return reply.status(400).send({ ok: false, error: 'Invalid screenId' })
      }

      const db = supabaseAdmin()
      const { data, error } = await db.rpc('issue_screen_device_token', {
        _screen_id: screenId,
      })

      if (error) {
        return reply.status(500).send({ ok: false, error: error.message })
      }

      const result = data as { ok: boolean; token?: string; error?: string }
      if (!result.ok) {
        const status = result.error === 'permission_denied' ? 403
          : result.error === 'screen_not_found' ? 404 : 400
        return reply.status(status).send({ ok: false, error: result.error })
      }

      request.log.info(
        { screenId, by: request.user!.id },
        'Device token issued'
      )

      // token 只在這次回應中出現一次，之後只能撤銷重發
      return {
        ok: true,
        data: {
          screen_id: screenId,
          token: result.token,
          issued_at: new Date().toISOString(),
          note: '請立即複製 token，此後不會再次顯示。如遺失請重新核發。',
        },
      }
    }
  )

  // ── POST /api/player/screens/:screenId/revoke-token ──────
  fastify.post<{ Params: { screenId: string } }>(
    '/screens/:screenId/revoke-token',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { screenId } = request.params
      if (!UUID_RE.test(screenId)) {
        return reply.status(400).send({ ok: false, error: 'Invalid screenId' })
      }

      const db = supabaseAdmin()
      const { data, error } = await db.rpc('revoke_screen_device_token', {
        _screen_id: screenId,
      })

      if (error) {
        return reply.status(500).send({ ok: false, error: error.message })
      }

      const result = data as { ok: boolean; error?: string }
      if (!result.ok) {
        const status = result.error === 'permission_denied' ? 403
          : result.error === 'screen_not_found' ? 404 : 400
        return reply.status(status).send({ ok: false, error: result.error })
      }

      request.log.info({ screenId, by: request.user!.id }, 'Device token revoked')
      return { ok: true, data: { screen_id: screenId, status: 'revoked' } }
    }
  )

  // ── GET /api/player/screens/:screenId/token-status ───────
  // 查詢 token 核發狀態（只回傳有無 token、核發時間，不回傳 token 本身）
  fastify.get<{ Params: { screenId: string } }>(
    '/screens/:screenId/token-status',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { screenId } = request.params
      if (!UUID_RE.test(screenId)) {
        return reply.status(400).send({ ok: false, error: 'Invalid screenId' })
      }

      const db = supabaseAdmin()
      const { data, error } = await db
        .from('screens')
        .select('id, name, device_token_issued_at, device_token_issued_by')
        .eq('id', screenId)
        .single()

      if (error || !data) {
        return reply.status(404).send({ ok: false, error: 'Screen not found' })
      }

      return {
        ok: true,
        data: {
          screen_id: screenId,
          screen_name: (data as any).name,
          has_token: !!(data as any).device_token_issued_at,
          issued_at: (data as any).device_token_issued_at ?? null,
          issued_by: (data as any).device_token_issued_by ?? null,
        },
      }
    }
  )

  // ════════════════════════════════════════════════════════
  // Manifest（播放器裝置使用，X-Device-Token 認證）
  // ════════════════════════════════════════════════════════

  // 共用的 token 驗證邏輯
  async function resolveDeviceToken(
    request: any,
    reply: any
  ): Promise<{ screenId: string; orgId: string } | null> {
    const deviceToken = (request.headers['x-device-token'] as string | undefined)?.trim()

    if (!deviceToken) {
      reply.status(401).send({
        ok: false,
        error: 'missing_device_token',
        message: "請提供 X-Device-Token header。Token 由 Org Admin 在管理後台核發。",
      })
      return null
    }

    const result = await verifyDeviceToken(deviceToken)

    if (!result.ok) {
      // 統一回傳 401，不透露 token 是否存在（防止枚舉攻擊）
      reply.status(401).send({
        ok: false,
        error: 'invalid_device_token',
        detail: result.error,
      })
      return null
    }

    return { screenId: result.screenId!, orgId: result.orgId! }
  }

  // ── GET /api/player/manifest/:screenId ───────────────────
  fastify.get<{ Params: { screenId: string } }>(
    '/manifest/:screenId',
    async (request, reply) => {
      if (!UUID_RE.test(request.params.screenId)) {
        return reply.status(400).send({ ok: false, error: 'Invalid screenId format' })
      }

      const auth = await resolveDeviceToken(request, reply)
      if (!auth) return  // resolveDeviceToken 已寫入回應

      // 關鍵安全檢查：URL 的 screenId 必須與 token 對應的 screenId 一致
      // 防止裝置 A 的 token 去查詢螢幕 B 的播放清單
      if (auth.screenId !== request.params.screenId) {
        request.log.warn(
          { tokenScreenId: auth.screenId, requestedScreenId: request.params.screenId },
          'Device token / screenId mismatch — possible unauthorized cross-screen access attempt'
        )
        return reply.status(403).send({
          ok: false,
          error: 'screen_mismatch',
          message: '此 token 不屬於所請求的螢幕。',
        })
      }

      const { hash, manifest } = await buildManifest(auth.screenId, auth.orgId)

      reply.header('Cache-Control', 'no-store')
      reply.header('X-Manifest-Hash', hash)

      return { ok: true, data: manifest }
    }
  )

  // ── GET /api/player/manifest/:screenId/hash ──────────────
  fastify.get<{ Params: { screenId: string } }>(
    '/manifest/:screenId/hash',
    async (request, reply) => {
      if (!UUID_RE.test(request.params.screenId)) {
        return reply.status(400).send({ ok: false, error: 'Invalid screenId format' })
      }

      const auth = await resolveDeviceToken(request, reply)
      if (!auth) return

      if (auth.screenId !== request.params.screenId) {
        return reply.status(403).send({ ok: false, error: 'screen_mismatch' })
      }

      const { hash } = await buildManifest(auth.screenId, auth.orgId)
      reply.header('X-Manifest-Hash', hash)

      return {
        ok: true,
        data: {
          screen_id: auth.screenId,
          manifest_hash: hash,
          checked_at: new Date().toISOString(),
        },
      }
    }
  )
}

export default playerRoutes
