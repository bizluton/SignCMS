/**
 * src/routes/media/transcodeCallback.ts
 *
 * ffmpeg Worker 轉檔完成後呼叫此 endpoint。
 *
 * 整合版本（最終）：
 *  ✅ HMAC-SHA256 驗章（X-Signature + X-Timestamp）
 *  ✅ status=progress → 寫入 transcode_progress → Realtime 推送前端進度條
 *  ✅ status=done     → url 更新為 R2 output_url + 非同步刪除 Supabase Storage 原始大檔
 *  ✅ status=failed   → transcode_status=failed，保留 Supabase Storage（供人工重試）
 */

import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { verifyHmac } from '../../lib/hmac.js'
import { supabaseAdmin } from '../../lib/supabase.js'
import { env } from '../../lib/env.js'

function extractMediaId(jobId: string): string | null {
  const m = jobId.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
  return m ? m[1] : null
}

const callbackBodySchema = z.discriminatedUnion('status', [
  z.object({
    job_id: z.string(), status: z.literal('done'),
    output_url: z.string().url(),
    duration_seconds: z.number().optional(),
    size_bytes: z.number().optional(),
    width: z.number().optional(), height: z.number().optional(),
    storage_key: z.string().optional(),
  }),
  z.object({ job_id: z.string(), status: z.literal('failed'), error: z.string() }),
  z.object({
    job_id: z.string(), status: z.literal('progress'),
    progress: z.number().min(0).max(100),
    out_time_seconds: z.number().optional(),
    source_duration_seconds: z.number().optional(),
    speed: z.number().optional(), phase: z.string().optional(),
  }),
])

const transcodeCallbackRoute: FastifyPluginAsync = async (fastify) => {

  fastify.post('/transcode-callback', { config: { rawBody: true } }, async (request, reply) => {

    if (!env.TRANSCODE_HMAC_SECRET) {
      return reply.status(500).send({ ok: false, error: 'Transcode not configured' })
    }

    const signature = request.headers['x-signature'] as string | undefined
    const timestamp  = request.headers['x-timestamp']  as string | undefined
    if (!signature || !timestamp) {
      return reply.status(401).send({ ok: false, error: 'Missing X-Signature / X-Timestamp' })
    }

    const rawBody = (request as any).rawBody as string
    if (!rawBody) return reply.status(400).send({ ok: false, error: 'Empty body' })

    const hmacResult = verifyHmac(env.TRANSCODE_HMAC_SECRET, timestamp, rawBody, signature)
    if (!hmacResult.ok) {
      request.log.warn({ error: hmacResult.error }, 'Transcode callback HMAC failed')
      return reply.status(401).send({ ok: false, error: 'Invalid signature', detail: hmacResult.error })
    }

    const parsed = callbackBodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: 'Invalid callback body', details: parsed.error.flatten() })
    }
    const payload = parsed.data

    const mediaId = extractMediaId(payload.job_id)
    if (!mediaId) return reply.status(400).send({ ok: false, error: 'Invalid job_id format' })

    const db = supabaseAdmin()

    // ── progress：寫入 transcode_progress → Realtime 推前端進度條
    if (payload.status === 'progress') {
      await db.from('media_items')
        .update({ transcode_progress: Math.round(payload.progress) })
        .eq('id', mediaId)
        .catch(() => {})
      request.log.debug({ mediaId, progress: payload.progress }, 'Transcode progress')
      return { ok: true, data: { received: 'progress' } }
    }

    // ── done：R2 URL + 刪 Supabase Storage 原始大檔
    if (payload.status === 'done') {
      const { data: mediaRow } = await db
        .from('media_items').select('storage_path, url').eq('id', mediaId).single()

      const originalStoragePath = mediaRow?.storage_path ?? null
      const wasBase64 = (mediaRow?.url ?? '').startsWith('data:')

      const { error: updateError } = await db.from('media_items').update({
        transcode_status:   'done',
        transcode_progress: null,
        url:                payload.output_url,
        duration_seconds:   payload.duration_seconds ?? null,
        updated_at:         new Date().toISOString(),
      }).eq('id', mediaId)

      if (updateError) {
        request.log.error({ err: updateError, mediaId }, 'Failed to update media_items on done')
        return reply.status(500).send({ ok: false, error: 'DB update failed' })
      }

      // 非同步刪除原始大檔（不 await，失敗不影響回傳 200）
      if (originalStoragePath && !wasBase64) {
        db.storage.from('media').remove([originalStoragePath])
          .then(({ error }) => {
            if (error) request.log.warn({ mediaId, storagePath: originalStoragePath, err: error.message }, 'Storage delete failed (non-critical)')
            else request.log.info({ mediaId, storagePath: originalStoragePath }, 'Original file deleted ✅')
          })
          .catch((err) => request.log.warn({ err: err.message, mediaId }, 'Storage delete threw'))
      }

      request.log.info({ mediaId, outputUrl: payload.output_url }, 'Transcode done ✅')
      return { ok: true, data: { media_id: mediaId, status: 'done' } }
    }

    // ── failed：標記失敗，保留 Supabase Storage 原始檔
    if (payload.status === 'failed') {
      const { error: updateError } = await db.from('media_items').update({
        transcode_status:   'failed',
        transcode_progress: null,
        updated_at:         new Date().toISOString(),
      }).eq('id', mediaId)

      if (updateError) return reply.status(500).send({ ok: false, error: 'DB update failed' })

      request.log.error({ mediaId, workerError: payload.error }, 'Transcode failed ❌')
      return { ok: true, data: { media_id: mediaId, status: 'failed' } }
    }
  })

  // ── GET /api/media/:mediaId/transcode-status
  fastify.get<{ Params: { mediaId: string } }>('/:mediaId/transcode-status', async (request, reply) => {
    const { mediaId } = request.params
    const db = supabaseAdmin()
    const { data, error } = await db
      .from('media_items')
      .select('id, transcode_status, transcode_progress, url, duration_seconds, updated_at')
      .eq('id', mediaId).single()
    if (error || !data) return reply.status(404).send({ ok: false, error: 'Not found' })
    return { ok: true, data }
  })
}

export default transcodeCallbackRoute
