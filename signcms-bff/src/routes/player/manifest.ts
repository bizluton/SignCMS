/**
 * src/routes/player/manifest.ts
 *
 * Android 播放器差異同步 API
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  GET /api/player/manifest/:screenId                             │
 * │                                                                 │
 * │  回傳螢幕目前有效排程的完整 manifest，Android App 用此來：       │
 * │   1. 比對 manifest_hash → 決定要不要同步                        │
 * │   2. 比對每個 media.md5 → 決定哪些檔案要下載                    │
 * │   3. 決定哪些本地舊檔案要刪除（節省磁碟空間）                    │
 * │                                                                 │
 * │  GET /api/player/manifest/:screenId/hash                        │
 * │                                                                 │
 * │  只回傳 manifest_hash（輕量探針，開機 / 定時檢查用）             │
 * │  Android App 先打這支，hash 不同才取完整 manifest               │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * 認證方式：
 *   Bearer JWT（已登入的 Org 使用者），或
 *   X-Device-Token（裝置綁定 token，儲存於 screens.device_token）
 *   → 兩者擇一，裝置端建議用 X-Device-Token 避免 JWT 需要定期 refresh
 *
 * manifest_hash 計算方式：
 *   SHA-256( sorted JSON of all media {id,md5,size_bytes} + schedule updated_at )
 *   → 任何媒體異動或排程更新都會產生新的 hash
 *   → Android App 可安全做 hash 比對，不需要 parse 完整 manifest
 *
 * Manifest 結構（完整版）：
 * {
 *   format: "signcms.player.manifest",
 *   version: 2,
 *   manifest_hash: "sha256hex",
 *   generated_at: "ISO8601",
 *   screen: { id, name },
 *   schedule: {
 *     id, name, start_date, end_date, start_time, end_time, days,
 *     enabled, bgm_volume, updated_at
 *   },
 *   items: [ { media_id, design_project_id, item_type, duration, sort_order } ],
 *   bgm:   [ { media_id, sort_order } ],
 *   design_projects: [ { id, name, aspect, zones, updated_at } ],
 *   media: [
 *     {
 *       id, name, type, mime_type,
 *       md5,            ← 核心：Android 用此比對本地檔案
 *       size_bytes,     ← 下載前預估空間
 *       url,            ← Supabase Storage 下載來源
 *       storage_path,   ← 相對路徑（可 deterministic 重建 URL）
 *       duration_seconds,
 *       width, height,
 *       local_filename, ← 建議的本地檔名 "{md5}.{ext}"
 *     }
 *   ],
 *   widgets: [         ← 系統 widget / catalog widget（不需下載檔案）
 *     { id, type: "widget", mime_type: "application/x-widget", widgetConfig }
 *   ],
 *   warnings: []       ← 轉檔中、找不到的 media（Android 應跳過）
 * }
 */

import { FastifyPluginAsync } from 'fastify'
import { createHash } from 'crypto'
import { supabaseAdmin } from '../../lib/supabase.js'
import { env } from '../../lib/env.js'

// ─── 常數 ─────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
  'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  'video/x-msvideo': 'avi', 'audio/mpeg': 'mp3', 'audio/wav': 'wav',
  'audio/aac': 'aac', 'audio/ogg': 'ogg',
}

function extFromMime(mime: string | null): string {
  if (!mime) return 'bin'
  return MIME_TO_EXT[mime.toLowerCase()] ?? mime.split('/')[1]?.split('+')[0] ?? 'bin'
}

/** local_filename 建議格式：{md5}.{ext}，確保同一檔案永遠同一個本地名稱 */
function localFilename(md5: string | null, mime: string | null): string | null {
  if (!md5) return null
  return `${md5}.${extFromMime(mime)}`
}

// ─── manifest_hash 計算 ────────────────────────────────────────

function computeManifestHash(
  mediaList: Array<{ id: string; md5: string | null; size_bytes: number | null }>,
  scheduleUpdatedAt: string | null
): string {
  // 排序後計算，確保順序不影響 hash
  const sorted = [...mediaList].sort((a, b) => a.id.localeCompare(b.id))
  const payload = JSON.stringify({ media: sorted, updated_at: scheduleUpdatedAt ?? '' })
  return createHash('sha256').update(payload).digest('hex')
}

// ─── 核心：組裝完整 manifest ──────────────────────────────────

async function buildManifest(screenId: string): Promise<{
  manifest: Record<string, unknown>
  hash: string
  error?: string
}> {
  const db = supabaseAdmin()

  // ── 1. 確認螢幕存在 ───────────────────────────────────────
  const { data: screen, error: screenErr } = await db
    .from('screens')
    .select('id, name, org_id')
    .eq('id', screenId)
    .single()

  if (screenErr || !screen) {
    return { manifest: {}, hash: '', error: 'screen_not_found' }
  }

  // ── 2. 取得目前有效排程 ─────────────────────────────────────
  //    有效條件：enabled=true，今天在 start_date ~ end_date 之間，
  //    或者 start_date/end_date 為 null（永久有效）
  const today = new Date().toISOString().slice(0, 10)

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

  if (!schedRow) {
    // 沒有有效排程：回傳空 manifest，Android 清空本地媒體
    const hash = createHash('sha256').update('empty').digest('hex')
    return {
      hash,
      manifest: {
        format: 'signcms.player.manifest',
        version: 2,
        manifest_hash: hash,
        generated_at: new Date().toISOString(),
        screen: { id: screen.id, name: screen.name },
        schedule: null,
        items: [], bgm: [], design_projects: [], media: [], widgets: [], warnings: [],
      },
    }
  }

  // ── 3. 取得排程項目 ────────────────────────────────────────
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

  // ── 4. 收集所有 ID ─────────────────────────────────────────
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
    if (b.media_id && UUID_RE.test(String(b.media_id))) {
      mediaIds.add(String(b.media_id))
    }
  }

  // ── 5. 取得 Design Projects（並從 zones 收集媒體）──────────
  let designRows: any[] = []
  if (designIds.size > 0) {
    const { data } = await db
      .from('design_projects')
      .select('id, name, aspect, zones, updated_at, created_at')
      .in('id', Array.from(designIds))
    designRows = data ?? []

    // 遞迴走訪 zones → content → mediaItems
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
        // Design-level BGM
        const bgmItems = z?.bgm?.items
        if (Array.isArray(bgmItems)) {
          for (const a of bgmItems) {
            if (a?.id && UUID_RE.test(String(a.id))) mediaIds.add(String(a.id))
          }
        }
      }
    }
  }

  // ── 6. 取得 media_items（含 md5）──────────────────────────
  let mediaRows: any[] = []
  if (mediaIds.size > 0) {
    const { data } = await db
      .from('media_items')
      .select('id, name, original_name, type, mime_type, url, storage_path, md5, size_bytes, width, height, duration_seconds, transcode_status')
      .in('id', Array.from(mediaIds))
    mediaRows = data ?? []
  }

  // ── 7. 組裝 media manifest entries ────────────────────────
  const warnings: Array<{ media_id: string; reason: string }> = []
  const mediaManifest: any[] = []

  // 孤立參照（media_id 存在於排程但 DB 已刪除）
  const fetchedIds = new Set(mediaRows.map((r: any) => String(r.id)))
  for (const id of mediaIds) {
    if (!fetchedIds.has(id)) {
      warnings.push({ media_id: id, reason: 'media_not_found_in_db' })
    }
  }

  for (const m of mediaRows) {
    // 轉檔中的媒體：Android 跳過，等完成後下次 sync 再抓
    if (m.transcode_status === 'pending' || m.transcode_status === 'processing') {
      warnings.push({ media_id: String(m.id), reason: `transcode_${m.transcode_status}` })
      continue
    }

    // Base64 資料（舊格式）：url 不是 http 開頭，Android 無法直接下載
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
      // ── 差異同步的核心欄位 ──
      md5: m.md5 ?? null,
      size_bytes: m.size_bytes ?? null,
      // ── 下載來源 ──
      url,
      storage_path: m.storage_path ?? null,
      // ── 本地建議檔名：{md5}.{ext} ──
      local_filename: localFilename(m.md5, m.mime_type),
      // ── 播放用 ──
      duration_seconds: m.duration_seconds ?? null,
      width: m.width ?? null,
      height: m.height ?? null,
    })
  }

  // ── 8. 取得 Widget entries ─────────────────────────────────
  const widgetManifest: any[] = []
  const catalogUuids: string[] = []

  for (const id of widgetIds) {
    if (id.startsWith('cat-widget-')) {
      catalogUuids.push(id.replace(/^cat-widget-/, ''))
    } else {
      // system widget：config 在前端 SYSTEM_WIDGETS 常數，BFF 只記錄 id
      widgetManifest.push({
        id, type: 'widget', mime_type: 'application/x-widget',
        source: 'system',
      })
    }
  }
  if (catalogUuids.length > 0) {
    const { data: widgetData } = await db
      .from('widgets')
      .select('id, name, config')
      .in('id', catalogUuids)
    for (const w of widgetData ?? []) {
      widgetManifest.push({
        id: `cat-widget-${w.id}`,
        name: w.name,
        type: 'widget',
        mime_type: 'application/x-widget',
        source: 'catalog',
        widgetConfig: w.config,
      })
    }
  }

  // ── 9. Design-level BGM 補充 ──────────────────────────────
  const designBgm: Array<{ media_id: string; sort_order: number }> = []
  {
    const seen = new Set<string>()
    let order = 1000
    for (const d of designRows) {
      for (const z of Array.isArray(d.zones) ? d.zones : []) {
        const items = z?.bgm?.items
        if (!Array.isArray(items)) continue
        for (const a of items) {
          const id = a?.id ? String(a.id) : ''
          if (!UUID_RE.test(id) || seen.has(id)) continue
          seen.add(id)
          designBgm.push({ media_id: id, sort_order: order++ })
        }
      }
    }
  }

  // ── 10. 計算 manifest_hash ────────────────────────────────
  const hash = computeManifestHash(
    mediaManifest.map(m => ({ id: m.id, md5: m.md5, size_bytes: m.size_bytes })),
    schedRow.updated_at ?? null
  )

  const manifest = {
    format: 'signcms.player.manifest',
    version: 2,
    manifest_hash: hash,
    generated_at: new Date().toISOString(),

    screen: { id: screen.id, name: screen.name },

    schedule: {
      id: schedRow.id,
      name: schedRow.name,
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
      media_id: i.media_id,
      design_project_id: i.design_project_id,
      item_type: i.item_type,
      duration: i.duration,
      sort_order: i.sort_order,
    })),

    bgm: [
      ...(bgmRows ?? []).map((b: any) => ({
        media_id: b.media_id, sort_order: b.sort_order,
      })),
      ...designBgm,
    ],

    design_projects: designRows.map((d: any) => ({
      id: d.id, name: d.name, aspect: d.aspect,
      zones: d.zones, updated_at: d.updated_at, created_at: d.created_at,
    })),

    // 差異同步的核心 ──────────────────────────────────────────
    media: mediaManifest,    // 每個 entry 有 md5 + local_filename + url
    widgets: widgetManifest, // 不需下載，渲染時動態處理

    warnings,
  }

  return { manifest, hash }
}

// ─── Route ────────────────────────────────────────────────────

const playerManifestRoute: FastifyPluginAsync = async (fastify) => {

  // ── GET /api/player/manifest/:screenId ──────────────────────
  //    完整 manifest（第一次同步 / hash 不符時用）
  fastify.get<{ Params: { screenId: string } }>(
    '/manifest/:screenId',
    async (request, reply) => {
      const { screenId } = request.params

      if (!UUID_RE.test(screenId)) {
        return reply.status(400).send({ ok: false, error: 'Invalid screenId format' })
      }

      // 裝置 Token 或 JWT 二擇一
      const deviceToken = request.headers['x-device-token'] as string | undefined
      const authHeader = request.headers.authorization

      if (!deviceToken && !authHeader) {
        return reply.status(401).send({ ok: false, error: 'Missing auth: X-Device-Token or Authorization' })
      }

      // 若用 JWT，做基本驗章（device token 由 DB 查詢隱式驗證）
      if (!deviceToken && authHeader) {
        try {
          await (request as any).jwtVerify()
        } catch {
          return reply.status(401).send({ ok: false, error: 'Invalid JWT' })
        }
      }

      // 若用 device token，驗證裝置是否屬於此 screen
      if (deviceToken) {
        const db = supabaseAdmin()
        const { data: screenRow } = await db
          .from('screens')
          .select('id, device_token')
          .eq('id', screenId)
          .single()

        if (!screenRow || screenRow.device_token !== deviceToken) {
          return reply.status(403).send({ ok: false, error: 'Invalid device token' })
        }
      }

      const { manifest, hash, error } = await buildManifest(screenId)
      if (error) {
        return reply.status(404).send({ ok: false, error })
      }

      // Cache-Control：短時間 cache 允許播放器在不穩定網路下重試
      reply.header('Cache-Control', 'no-store')
      reply.header('X-Manifest-Hash', hash)

      return {
        ok: true,
        data: manifest,
      }
    }
  )

  // ── GET /api/player/manifest/:screenId/hash ──────────────────
  //    輕量探針（開機 / 每 N 分鐘定時檢查）
  //    回應極小，節省流量
  fastify.get<{ Params: { screenId: string } }>(
    '/manifest/:screenId/hash',
    async (request, reply) => {
      const { screenId } = request.params

      if (!UUID_RE.test(screenId)) {
        return reply.status(400).send({ ok: false, error: 'Invalid screenId format' })
      }

      const deviceToken = request.headers['x-device-token'] as string | undefined
      const authHeader = request.headers.authorization

      if (!deviceToken && !authHeader) {
        return reply.status(401).send({ ok: false, error: 'Missing auth' })
      }

      if (deviceToken) {
        const db = supabaseAdmin()
        const { data: screenRow } = await db
          .from('screens')
          .select('id, device_token')
          .eq('id', screenId)
          .single()
        if (!screenRow || screenRow.device_token !== deviceToken) {
          return reply.status(403).send({ ok: false, error: 'Invalid device token' })
        }
      }

      const { hash, error } = await buildManifest(screenId)
      if (error) {
        return reply.status(404).send({ ok: false, error })
      }

      reply.header('X-Manifest-Hash', hash)

      return {
        ok: true,
        data: {
          screen_id: screenId,
          manifest_hash: hash,
          checked_at: new Date().toISOString(),
        },
      }
    }
  )
}

export default playerManifestRoute
