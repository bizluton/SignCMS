/**
 * src/routes/webhook/smartTrigger.ts
 *
 * POST /api/webhook/smart-trigger
 *
 * 完整移植 Supabase Edge Function smart-trigger-webhook/index.ts
 * 所有邏輯一比一對齊，無功能刪減：
 *
 *   ✅ X-Webhook-Token per-org 驗證（timing-safe）
 *   ✅ UUID 格式驗證
 *   ✅ Debug ID（header / body / 自動產生）
 *   ✅ org-scope rules + screen-specific rules
 *   ✅ per-screen override map
 *   ✅ trigger_condition 評估（field.path + op + value）
 *   ✅ priority 排序（desc），created_at 次排序（asc）
 *   ✅ Cooldown 機制（per-rule + screen-scoped）
 *   ✅ 全部 smart_trigger_logs 寫入（fired / skipped / no_match / auth_fail）
 *   ✅ X-Debug-Id response header
 */

import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { supabaseAdmin } from '../../lib/supabase.js'

// ─── 型別 ─────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const bodySchema = z.object({
  org_id: z.string().regex(UUID_RE, 'org_id must be a valid UUID'),
  screen_id: z.string().regex(UUID_RE).nullable().optional(),
  trigger_source: z.enum(['gpio', 'remote', 'api', 'iot_sensor', 'webhook', 'schedule']),
  trigger_key: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
  debug_id: z.string().optional(),
})

type Condition = {
  field?: string
  op?: 'eq' | 'gt' | 'gte' | 'lt' | 'lte'
  value?: unknown
}

// ─── Condition 評估（與 Edge Fn 完全對齊）────────────────────

function evalCondition(
  cond: Condition | null | undefined,
  payload: Record<string, unknown> | undefined
): boolean {
  if (!cond || typeof cond !== 'object' || Object.keys(cond).length === 0) return true
  if (!payload) return false

  const { field, op, value: expected } = cond
  if (!field || !op) return true

  const parts = field.split('.')
  let v: unknown = payload
  for (const p of parts) {
    if (v == null || typeof v !== 'object') return false
    v = (v as Record<string, unknown>)[p]
  }
  if (v === undefined || v === null) return false

  switch (op) {
    case 'eq':  return v == expected
    case 'gt':  return Number(v) >  Number(expected)
    case 'gte': return Number(v) >= Number(expected)
    case 'lt':  return Number(v) <  Number(expected)
    case 'lte': return Number(v) <= Number(expected)
    default:    return false
  }
}

// ─── Debug ID sanitize ────────────────────────────────────────

function sanitizeDebugId(s: string): string {
  return s.replace(/[^A-Za-z0-9_\-:.]/g, '').slice(0, 64)
}

// ─── Timing-safe string comparison ───────────────────────────

function timingSafeEqual(a: string, b: string): boolean {
  let mismatch = a.length !== b.length ? 1 : 0
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return mismatch === 0
}

// ─── Route ────────────────────────────────────────────────────

const smartTriggerRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post('/smart-trigger', async (request, reply) => {
    const db = supabaseAdmin()

    // ── Debug ID ───────────────────────────────────────────────
    const incomingDebugId = (
      (request.headers['x-debug-id'] as string | undefined) ?? ''
    ).trim()
    const bodyDebugId = typeof (request.body as any)?.debug_id === 'string'
      ? (request.body as any).debug_id as string
      : ''
    const debugId =
      sanitizeDebugId(incomingDebugId) ||
      sanitizeDebugId(bodyDebugId) ||
      `stw_${Date.now().toString(36)}_${crypto.randomUUID().split('-')[0]}`

    reply.header('X-Debug-Id', debugId)

    // ── Body 解析 ──────────────────────────────────────────────
    const parsed = bodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: parsed.error.errors[0]?.message ?? 'Invalid request body',
        debug_id: debugId,
      })
    }
    const body = parsed.data

    request.log.info(
      { org_id: body.org_id, screen_id: body.screen_id, trigger_source: body.trigger_source,
        trigger_key: body.trigger_key ?? '', debug_id: debugId },
      '[smart-trigger] request received'
    )

    // ── Webhook Token 驗證 ─────────────────────────────────────
    const providedToken = (
      (request.headers['x-webhook-token'] as string | undefined) ?? ''
    ).trim()

    if (!providedToken) {
      return reply.status(401).send({
        error: 'missing_webhook_token',
        message: "Webhook token required. Provide via 'X-Webhook-Token: <token>' header.",
        debug_id: debugId,
      })
    }

    const { data: orgRow, error: orgErr } = await db
      .from('organizations')
      .select('id, webhook_token')
      .eq('id', body.org_id)
      .maybeSingle()

    if (orgErr) {
      return reply.status(500).send({ error: 'org_lookup_failed', message: orgErr.message, debug_id: debugId })
    }
    if (!orgRow) {
      return reply.status(404).send({
        error: 'org_not_found',
        message: `Organization '${body.org_id}' does not exist.`,
        debug_id: debugId,
      })
    }

    if (!timingSafeEqual(providedToken, orgRow.webhook_token ?? '')) {
      // best-effort audit log
      await db.from('smart_trigger_logs').insert({
        org_id: body.org_id, screen_id: body.screen_id ?? null,
        trigger_source: body.trigger_source, trigger_key: body.trigger_key ?? '',
        trigger_payload: body.payload ?? {}, success: false,
        error_message: 'invalid_webhook_token', debug_id: debugId,
      }).catch(() => {})

      return reply.status(403).send({
        error: 'invalid_webhook_token',
        message: 'The provided webhook token does not match this organization.',
        debug_id: debugId,
      })
    }

    // ── Rule 解析 ──────────────────────────────────────────────
    try {
      // 1) Org-scope rules
      const orgQuery = db
        .from('smart_trigger_rules')
        .select('*')
        .eq('org_id', body.org_id)
        .eq('scope', 'org')
        .eq('trigger_source', body.trigger_source)
        .eq('enabled', true)
      if (body.trigger_key) orgQuery.eq('trigger_key', body.trigger_key)

      // 2) Screen-specific rules（透過關聯表）
      const screenLinkPromise = body.screen_id
        ? db.from('screen_smart_trigger_rules')
            .select('smart_trigger_rules(*)')
            .eq('screen_id', body.screen_id)
        : Promise.resolve({ data: [], error: null } as any)

      // 3) Per-screen overrides
      const overridesPromise = body.screen_id
        ? db.from('screen_smart_trigger_overrides')
            .select('rule_id, enabled')
            .eq('screen_id', body.screen_id)
        : Promise.resolve({ data: [], error: null } as any)

      const [orgRes, linkRes, ovrRes] = await Promise.all([orgQuery, screenLinkPromise, overridesPromise])
      if (orgRes.error) throw orgRes.error
      if (linkRes.error) throw linkRes.error
      if (ovrRes.error) throw ovrRes.error

      // Override map: rule_id → enabled
      const overrideMap = new Map<string, boolean>()
      for (const o of (ovrRes.data ?? []) as any[]) overrideMap.set(o.rule_id, o.enabled)

      // Org rules NOT disabled by per-screen override
      const orgRules = ((orgRes.data ?? []) as any[]).filter((r: any) => {
        const ov = overrideMap.get(r.id)
        return ov === undefined ? true : ov === true
      })

      // Screen-specific rules（依 source / key / enabled 篩選）
      const screenRules = ((linkRes.data ?? []) as any[])
        .map((row: any) => row.smart_trigger_rules)
        .filter((r: any) => r && r.enabled
          && r.trigger_source === body.trigger_source
          && (!body.trigger_key || r.trigger_key === body.trigger_key))

      // Union + condition eval（screen rules 優先）
      const seen = new Set<string>()
      const candidates: any[] = []
      for (const r of [...screenRules, ...orgRules]) {
        if (seen.has(r.id)) continue
        seen.add(r.id)
        if (evalCondition(r.trigger_condition as Condition, body.payload)) candidates.push(r)
      }

      // Priority 排序：priority desc, created_at asc
      candidates.sort((a: any, b: any) =>
        (b.priority ?? 0) - (a.priority ?? 0) ||
        String(a.created_at).localeCompare(String(b.created_at))
      )

      // ── Cooldown 檢查 ────────────────────────────────────────
      const fired: any[] = []
      const skipped: Array<{ rule: any; remaining_seconds: number; last_fired_at: string }> = []

      await Promise.all(candidates.map(async (r: any) => {
        const cooldown = Number(r.cooldown_seconds ?? 0)
        if (!cooldown || cooldown <= 0) { fired.push(r); return }

        const sinceIso = new Date(Date.now() - cooldown * 1000).toISOString()
        let q = db.from('smart_trigger_logs')
          .select('created_at')
          .eq('rule_id', r.id)
          .eq('success', true)
          .gte('created_at', sinceIso)
          .order('created_at', { ascending: false })
          .limit(1)
        if (body.screen_id) q = (q as any).eq('screen_id', body.screen_id)

        const { data: recent, error: recentErr } = await (q as any).maybeSingle()
        if (recentErr) { fired.push(r); return }  // fail open

        if (recent?.created_at) {
          const last = new Date(recent.created_at).getTime()
          const remaining = Math.max(0, Math.ceil((last + cooldown * 1000 - Date.now()) / 1000))
          skipped.push({ rule: r, remaining_seconds: remaining, last_fired_at: recent.created_at })
        } else {
          fired.push(r)
        }
      }))

      // ── Log 寫入 ─────────────────────────────────────────────
      const baseLog = {
        org_id: body.org_id,
        screen_id: body.screen_id ?? null,
        trigger_source: body.trigger_source,
        trigger_key: body.trigger_key ?? '',
        trigger_payload: body.payload ?? {},
        debug_id: debugId,
      }

      if (fired.length > 0) {
        await db.from('smart_trigger_logs').insert(
          fired.map((r: any) => ({ ...baseLog, rule_id: r.id, success: true }))
        )
        request.log.info({ debugId, count: fired.length }, '[smart-trigger] fired')
      }

      if (skipped.length > 0) {
        await db.from('smart_trigger_logs').insert(
          skipped.map(({ rule, remaining_seconds, last_fired_at }) => ({
            ...baseLog,
            rule_id: rule.id,
            success: false,
            error_message: `cooldown_active: ${remaining_seconds}s remaining`,
            trigger_payload: {
              ...baseLog.trigger_payload,
              _cooldown: {
                cooldown_seconds: Number(rule.cooldown_seconds ?? 0),
                remaining_seconds, last_fired_at,
              },
            },
          }))
        )
      }

      if (fired.length === 0 && skipped.length === 0) {
        await db.from('smart_trigger_logs').insert({
          ...baseLog, success: false, error_message: 'no_matching_rule',
        })
        request.log.info({ debugId }, '[smart-trigger] no matching rule')
      }

      // ── Response ─────────────────────────────────────────────
      return {
        debug_id: debugId,
        matched_count: fired.length,
        skipped_count: skipped.length,
        matched_rules: fired.map((r: any) => ({
          id: r.id, name: r.name, scope: r.scope,
          target_design_project_id: r.target_design_project_id,
          duration_seconds: r.duration_seconds,
          restore_behavior: r.restore_behavior,
          restore_channel_id: r.restore_channel_id,
          cooldown_seconds: r.cooldown_seconds,
          priority: r.priority,
        })),
        skipped_rules: skipped.map(({ rule, remaining_seconds, last_fired_at }) => ({
          id: rule.id, name: rule.name, reason: 'cooldown_active',
          cooldown_seconds: Number(rule.cooldown_seconds ?? 0),
          remaining_seconds, last_fired_at,
        })),
      }
    } catch (err: any) {
      const msg = err?.message ?? 'Unknown error'
      await db.from('smart_trigger_logs').insert({
        org_id: body.org_id, screen_id: body.screen_id ?? null,
        trigger_source: body.trigger_source, trigger_key: body.trigger_key ?? '',
        trigger_payload: body.payload ?? {}, success: false,
        error_message: msg.slice(0, 500), debug_id: debugId,
      }).catch(() => {})
      request.log.error({ err, debugId }, '[smart-trigger] unhandled error')
      return reply.status(500).send({ error: msg, debug_id: debugId })
    }
  })
}

export default smartTriggerRoute
