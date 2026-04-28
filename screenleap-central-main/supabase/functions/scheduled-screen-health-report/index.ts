// Scheduled Screen Health Report dispatcher.
// Invoked by pg_cron hourly. For each enabled schedule whose hour_utc matches
// the current UTC hour (and day_of_week for weekly), it builds a CSV summary
// of the org's screens and enqueues a transactional email to each recipient
// via the existing send-transactional-email function.

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ScreenRow {
  id: string
  name: string
  branch: string | null
  online: boolean | null
  ip_address: string | null
  updated_at: string | null
  org_id: string
}

function buildCsv(headers: string[], rows: string[][]): string {
  const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`
  return (
    '\uFEFF' +
    [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n')
  )
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, serviceKey)

  // Allow caller to override "now" for testing
  let body: any = {}
  try {
    body = req.method === 'POST' ? await req.json() : {}
  } catch {
    body = {}
  }
  const now = body?.now ? new Date(body.now) : new Date()
  const force = body?.force === true
  const onlyScheduleId: string | undefined = body?.schedule_id

  let q: any = supabase
    .from('screen_health_report_schedules')
    .select('*')
    .eq('enabled', true)

  if (onlyScheduleId) q = q.eq('id', onlyScheduleId)

  const { data: schedules, error: schedErr } = await q
  if (schedErr) {
    return new Response(JSON.stringify({ ok: false, error: schedErr.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Resolve "now" in the schedule's IANA timezone using Intl. This is
  // DST-aware: when a region transitions (e.g. EDT->EST), the same configured
  // local hour still maps to the correct UTC instant automatically.
  const localParts = (tz: string) => {
    try {
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour12: false,
        weekday: 'short',
        hour: '2-digit',
      })
      const parts = fmt.formatToParts(now)
      const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '0'
      const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun'
      const dowMap: Record<string, number> = {
        Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
      }
      // Intl returns "24" for midnight in some locales — normalize to 0.
      const h = Number(hourStr) % 24
      return { hour: h, dow: dowMap[wd] ?? 0 }
    } catch {
      // Invalid tz — fall back to UTC so the schedule still runs.
      return { hour: now.getUTCHours(), dow: now.getUTCDay() }
    }
  }

  const due = (schedules ?? []).filter((s: any) => {
    if (force || onlyScheduleId) return true
    const tz = s.timezone || 'UTC'
    const { hour, dow } = localParts(tz)
    if (s.hour_utc !== hour) return false
    if (s.cadence === 'weekly' && s.day_of_week !== dow) return false
    return true
  })

  const results: any[] = []

  for (const s of due) {
    try {
      const recipients: string[] = Array.isArray(s.recipients)
        ? s.recipients.filter((r: any) => typeof r === 'string' && r.includes('@'))
        : []
      if (recipients.length === 0) {
        await supabase
          .from('screen_health_report_schedules')
          .update({
            last_run_at: now.toISOString(),
            last_status: 'skipped',
            last_error: 'no recipients',
          })
          .eq('id', s.id)
        results.push({ id: s.id, status: 'skipped', reason: 'no recipients' })
        continue
      }

      // Org name (best-effort)
      const { data: org } = await supabase
        .from('organizations')
        .select('name')
        .eq('id', s.org_id)
        .maybeSingle()

      // Pull screens for the org
      const { data: screens } = await supabase
        .from('screens')
        .select('id,name,branch,online,ip_address,updated_at,org_id')
        .eq('org_id', s.org_id)

      const cutoffMs = Date.now() - s.time_range_hours * 60 * 60 * 1000
      let filtered: ScreenRow[] = (screens ?? []) as ScreenRow[]
      filtered = filtered.filter((sc) => {
        if (!sc.updated_at) return false
        return new Date(sc.updated_at).getTime() >= cutoffMs
      })
      if (s.include_offline_only) {
        filtered = filtered.filter((sc) => !sc.online)
      }

      // Active alerts
      const { data: alerts } = await supabase
        .from('screen_alerts')
        .select('screen_id')
        .eq('org_id', s.org_id)
        .is('resolved_at', null)
      const alertIds = new Set((alerts ?? []).map((a: any) => a.screen_id))

      const total = filtered.length
      const online = filtered.filter((x) => x.online).length
      const offline = total - online
      const alertsCount = filtered.filter((x) => alertIds.has(x.id)).length

      const tableRows = filtered.map((x) => ({
        name: x.name,
        group: x.branch || '-',
        status: x.online ? 'online' : 'offline',
        ip: x.ip_address || '-',
        heartbeat: x.updated_at
          ? new Date(x.updated_at).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
          : '-',
        alert: alertIds.has(x.id),
      }))

      const csv = buildCsv(
        ['Name', 'Group', 'Status', 'IP', 'Heartbeat', 'Alert'],
        tableRows.map((r) => [r.name, r.group, r.status, r.ip, r.heartbeat, r.alert ? '!' : '']),
      )

      const cadence = s.cadence as 'daily' | 'weekly'
      const tz = s.timezone || 'UTC'
      let generatedAt: string
      try {
        generatedAt = new Intl.DateTimeFormat('en-CA', {
          timeZone: tz,
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
          hour12: false,
        }).format(now).replace(',', '') + ` ${tz}`
      } catch {
        generatedAt = now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
      }
      const rangeLabel = `Last ${s.time_range_hours}h`

      // Upload the full CSV to private storage and create a signed URL so
      // admins can download every screen even when the inline table is huge.
      const csvFilename = `screen-health-${cadence}-${now.toISOString().slice(0, 10)}-${s.id.slice(0, 8)}.csv`
      const storagePath = `${s.org_id}/${csvFilename}`
      let downloadUrl: string | null = null
      let downloadExpiresAt: string | null = null
      try {
        const { error: upErr } = await supabase.storage
          .from('screen-health-reports')
          .upload(storagePath, new Blob([csv], { type: 'text/csv' }), {
            contentType: 'text/csv; charset=utf-8',
            upsert: true,
          })
        if (upErr) throw upErr
        // 30 days
        const expiresInSec = 60 * 60 * 24 * 30
        const { data: signed, error: signErr } = await supabase.storage
          .from('screen-health-reports')
          .createSignedUrl(storagePath, expiresInSec)
        if (signErr) throw signErr
        downloadUrl = signed?.signedUrl ?? null
        downloadExpiresAt = new Date(
          Date.now() + expiresInSec * 1000,
        ).toISOString().slice(0, 10)
      } catch (e) {
        console.error('csv upload/sign failed', s.id, e)
      }

      // Enqueue one email per recipient
      for (const recipient of recipients) {
        const idemKey = `screen-health-${s.id}-${cadence}-${now.toISOString().slice(0, 13)}-${recipient}`
        const { error: invokeErr } = await supabase.functions.invoke('send-transactional-email', {
          body: {
            templateName: 'screen-health-report',
            recipientEmail: recipient,
            idempotencyKey: idemKey,
            templateData: {
              orgName: org?.name ?? null,
              cadence,
              generatedAt,
              rangeLabel,
              total,
              online,
              offline,
              alerts: alertsCount,
              rows: tableRows,
              csvFilename,
              downloadUrl,
              downloadExpiresAt,
            },
          },
        })
        if (invokeErr) throw invokeErr
      }

      await supabase
        .from('screen_health_report_schedules')
        .update({
          last_run_at: now.toISOString(),
          last_status: 'sent',
          last_error: null,
        })
        .eq('id', s.id)
      results.push({ id: s.id, status: 'sent', recipients: recipients.length, total })
    } catch (err: any) {
      console.error('schedule failure', s.id, err)
      await supabase
        .from('screen_health_report_schedules')
        .update({
          last_run_at: now.toISOString(),
          last_status: 'failed',
          last_error: String(err?.message ?? err).slice(0, 500),
        })
        .eq('id', s.id)
      results.push({ id: s.id, status: 'failed', error: String(err?.message ?? err) })
    }
  }

  return new Response(
    JSON.stringify({ ok: true, processed: results.length, results }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})