/**
 * src/services/transcodeQueue.ts
 *
 * BullMQ job queue — BFF 端的 producer + worker
 *
 * Worker 呼叫 ffmpeg worker 的 POST /jobs，格式對齊：
 *   docs/transcode-worker/src/server.js
 *
 * Worker body 欄位：
 *   job_id       — BFF 自產的 UUID，用於 dedup 與追蹤
 *   input_url    — Supabase Storage signed URL（1小時有效）
 *   callback_url — BFF 的 /api/media/transcode-callback
 *   target       — 可選，覆寫轉檔預設值（fps / video_bitrate 等）
 */

import { Queue, Worker, Job } from 'bullmq'
import { env } from '../lib/env.js'
import { buildWorkerHeaders } from '../lib/hmac.js'
import { supabaseAdmin } from '../lib/supabase.js'

// ─── Job data 型別 ────────────────────────────────────────────

export interface TranscodeJobData {
  mediaId: string
  storagePath: string
  orgId: string
  sourceMeta: {
    fps?: number
    bitrate?: number
    codec?: string
    container?: string
    width?: number
    height?: number
  }
}

// ─── Queue（Producer）────────────────────────────────────────

export const transcodeQueue = new Queue<TranscodeJobData>('transcode', {
  connection: { url: env.REDIS_URL },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
})

// ─── Worker（Consumer）───────────────────────────────────────

let _worker: Worker<TranscodeJobData> | null = null

export function startTranscodeWorker(): void {
  if (!env.TRANSCODE_WORKER_URL || !env.TRANSCODE_HMAC_SECRET) {
    console.warn('⚠️  TRANSCODE_WORKER_URL / TRANSCODE_HMAC_SECRET 未設定，轉檔 worker 不啟動')
    return
  }

  _worker = new Worker<TranscodeJobData>(
    'transcode',
    async (job: Job<TranscodeJobData>) => {
      const { mediaId, storagePath } = job.data
      const db = supabaseAdmin()

      // 1. 標記 processing
      await db
        .from('media_items')
        .update({ transcode_status: 'processing', updated_at: new Date().toISOString() })
        .eq('id', mediaId)

      // 2. 取得 Supabase Storage 的 signed URL（1小時有效，供 worker 下載）
      const { data: signedData, error: signedErr } = await db.storage
        .from('media')
        .createSignedUrl(storagePath, 3600)

      if (signedErr || !signedData?.signedUrl) {
        throw new Error(`無法建立 signed URL：${signedErr?.message ?? 'unknown'}`)
      }

      // 3. 組合送給 worker 的 payload
      //    job_id 用 bullmq job.id，worker 以此做 dedup
      const jobId = `${mediaId}-${job.id}`
      const bffPublicUrl = process.env.BFF_PUBLIC_URL ?? `http://localhost:${env.PORT}`

      const workerPayload = {
        job_id: jobId,
        input_url: signedData.signedUrl,
        callback_url: `${bffPublicUrl}/api/media/transcode-callback`,
        // target 可留空讓 worker 用預設值（1080p, h264, 8Mbps）
        // 若來源超過 4K 可在此指定降解析度
        target: {},
      }

      // 4. 送給 ffmpeg worker（POST /jobs），HMAC 簽名
      const rawBody = JSON.stringify(workerPayload)
      const headers = buildWorkerHeaders(env.TRANSCODE_HMAC_SECRET!, rawBody)

      const response = await fetch(`${env.TRANSCODE_WORKER_URL}/jobs`, {
        method: 'POST',
        headers,
        body: rawBody,
      })

      if (!response.ok) {
        const errText = await response.text().catch(() => '')
        throw new Error(`Worker 拒絕 job：HTTP ${response.status} ${errText}`)
      }

      const result = await response.json() as { job_id: string; status: string; deduplicated?: boolean }
      job.log(`Worker accepted: job_id=${result.job_id}, status=${result.status}, dedup=${result.deduplicated ?? false}`)
    },
    {
      connection: { url: env.REDIS_URL },
      concurrency: 3,
    }
  )

  _worker.on('failed', async (job, err) => {
    if (!job) return
    const { mediaId } = job.data
    console.error(`[transcode] job failed for media ${mediaId} (attempt ${job.attemptsMade}):`, err.message)

    // 只有最後一次重試失敗才把 DB 標為 failed
    if (job.attemptsMade >= (job.opts.attempts ?? 3)) {
      const db = supabaseAdmin()
      await db
        .from('media_items')
        .update({ transcode_status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', mediaId)
        .catch(console.error)
    }
  })

  _worker.on('completed', (job) => {
    console.log(`[transcode] job ${job.id} submitted to worker for media ${job.data.mediaId}`)
  })

  console.log('✅ Transcode BullMQ worker started')
}

export async function stopTranscodeWorker(): Promise<void> {
  if (_worker) {
    await _worker.close()
    _worker = null
  }
  await transcodeQueue.close()
}
