/**
 * src/routes/media/upload.ts
 *
 * POST /api/media/upload
 *
 * 取代 Supabase Edge Function upload-media/index.ts
 * 新增：影片轉檔判斷 + BullMQ job 排隊
 *
 * 流程：
 *  1. 驗證 JWT
 *  2. 驗證使用者有權上傳（org member）
 *  3. 接收 multipart（file + metadata）
 *  4. 上傳至 Supabase Storage
 *  5. 寫入 media_items
 *  6. 如需轉檔 → 加入 transcode job queue
 *  7. 回傳 media item id
 */

import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../middleware/auth.js'
import { supabaseAdmin } from '../../lib/supabase.js'
import { transcodeQueue } from '../../services/transcodeQueue.js'
import { env } from '../../lib/env.js'

// 需要轉檔的判斷門檻（對應 docs/transcode-spec.md）
const TRANSCODE_THRESHOLDS = {
  maxFps: 60,
  maxBitrateBps: 20_000_000,
  allowedCodecs: ['h264', 'avc1'],
  allowedContainer: 'mp4',
  maxWidth: 3840,
  maxHeight: 2160,
}

const uploadMetaSchema = z.object({
  org_id: z.string().uuid(),
  name: z.string().min(1).max(255),
  // 前端 MediaInfo.js 偵測到的 metadata（可選）
  source_fps: z.coerce.number().optional(),
  source_bitrate: z.coerce.number().optional(),
  source_codec: z.string().optional(),
  source_container: z.string().optional(),
  source_width: z.coerce.number().optional(),
  source_height: z.coerce.number().optional(),
})

function needsTranscode(meta: z.infer<typeof uploadMetaSchema>): boolean {
  if (meta.source_fps && meta.source_fps > TRANSCODE_THRESHOLDS.maxFps) return true
  if (meta.source_bitrate && meta.source_bitrate > TRANSCODE_THRESHOLDS.maxBitrateBps) return true
  if (
    meta.source_codec &&
    !TRANSCODE_THRESHOLDS.allowedCodecs.includes(meta.source_codec.toLowerCase())
  ) return true
  if (
    meta.source_container &&
    meta.source_container.toLowerCase() !== TRANSCODE_THRESHOLDS.allowedContainer
  ) return true
  if (meta.source_width && meta.source_width > TRANSCODE_THRESHOLDS.maxWidth) return true
  if (meta.source_height && meta.source_height > TRANSCODE_THRESHOLDS.maxHeight) return true
  return false
}

function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() || 'file'
  return base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'file'
}

const mediaUploadRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/upload',
    {
      preHandler: [requireAuth],
      config: { rawBody: false },
    },
    async (request, reply) => {
      const user = request.user!
      const db = supabaseAdmin()

      // ── 1. 解析 multipart ──────────────────────────────────────
      const data = await request.file()
      if (!data) {
        return reply.status(400).send({ ok: false, error: 'No file provided' })
      }

      // meta 放在 fields
      const fields = data.fields as Record<string, { value: string }>
      const rawMeta: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(fields)) {
        rawMeta[k] = v.value
      }

      const parsed = uploadMetaSchema.safeParse(rawMeta)
      if (!parsed.success) {
        return reply.status(400).send({
          ok: false,
          error: 'Invalid metadata',
          details: parsed.error.flatten(),
        })
      }
      const meta = parsed.data

      // ── 2. 權限：使用者必須屬於該 org ────────────────────────────
      const { data: memberData } = await db.rpc('user_in_org', {
        _user_id: user.id,
        _org_id: meta.org_id,
      })
      if (!memberData) {
        return reply.status(403).send({ ok: false, error: 'Forbidden' })
      }

      // ── 3. 上傳至 Supabase Storage ────────────────────────────────
      const fileBuffer = await data.toBuffer()
      const storagePath = `${meta.org_id}/${Date.now()}_${safeName(data.filename)}`

      const { error: storageError } = await db.storage
        .from('media')
        .upload(storagePath, fileBuffer, {
          contentType: data.mimetype,
          upsert: false,
        })

      if (storageError) {
        request.log.error({ err: storageError }, 'Storage upload failed')
        return reply.status(500).send({ ok: false, error: 'Storage upload failed' })
      }

      const { data: publicData } = db.storage.from('media').getPublicUrl(storagePath)
      const publicUrl = publicData.publicUrl

      // ── 4. 判斷是否需要轉檔 ──────────────────────────────────────
      const isVideo = data.mimetype.startsWith('video/')
      const transcodeStatus = isVideo && needsTranscode(meta) ? 'pending' : 'none'

      // ── 5. 寫入 media_items ───────────────────────────────────────
      const { data: mediaItem, error: dbError } = await db
        .from('media_items')
        .insert({
          org_id: meta.org_id,
          name: meta.name,
          url: publicUrl,
          storage_path: storagePath,
          file_size: fileBuffer.byteLength,
          mime_type: data.mimetype,
          transcode_status: transcodeStatus,
        })
        .select('id, transcode_status')
        .single()

      if (dbError || !mediaItem) {
        // rollback storage
        await db.storage.from('media').remove([storagePath])
        return reply.status(500).send({ ok: false, error: 'DB insert failed' })
      }

      // ── 6. 如需轉檔，加入 BullMQ queue ───────────────────────────
      if (transcodeStatus === 'pending') {
        await transcodeQueue.add('transcode', {
          mediaId: mediaItem.id,
          storagePath,
          orgId: meta.org_id,
          sourceMeta: {
            fps: meta.source_fps,
            bitrate: meta.source_bitrate,
            codec: meta.source_codec,
            container: meta.source_container,
            width: meta.source_width,
            height: meta.source_height,
          },
        })
        request.log.info({ mediaId: mediaItem.id }, 'Transcode job enqueued')
      }

      // ── 7. 回傳 ────────────────────────────────────────────────────
      return reply.status(201).send({
        ok: true,
        data: {
          id: mediaItem.id,
          url: publicUrl,
          transcode_status: mediaItem.transcode_status,
        },
      })
    }
  )

  // ── GET /api/media/:mediaId/transcode-status ─────────────────
  fastify.get<{ Params: { mediaId: string } }>(
    '/:mediaId/transcode-status',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { mediaId } = request.params
      const db = supabaseAdmin()

      const { data, error } = await db
        .from('media_items')
        .select('id, transcode_status, url')
        .eq('id', mediaId)
        .single()

      if (error || !data) {
        return reply.status(404).send({ ok: false, error: 'Not found' })
      }

      return { ok: true, data }
    }
  )
}

export default mediaUploadRoute
