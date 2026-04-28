/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
  Hr,
  Button,
  Link,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'trial-signcms'

interface ScreenRow {
  name: string
  group?: string
  status: 'online' | 'offline'
  ip?: string
  heartbeat?: string
  alert?: boolean
}

interface ScreenHealthReportProps {
  orgName?: string
  cadence?: 'daily' | 'weekly'
  generatedAt?: string
  rangeLabel?: string
  total?: number
  online?: number
  offline?: number
  alerts?: number
  rows?: ScreenRow[]
  downloadUrl?: string | null
  downloadExpiresAt?: string | null
  csvFilename?: string
}

const ScreenHealthReportEmail = ({
  orgName,
  cadence = 'daily',
  generatedAt,
  rangeLabel,
  total = 0,
  online = 0,
  offline = 0,
  alerts = 0,
  rows = [],
  downloadUrl,
  downloadExpiresAt,
  csvFilename,
}: ScreenHealthReportProps) => {
  // Render every screen so admins can audit the full fleet inline.
  // For very large fleets we still cap to a sane upper bound to avoid
  // exceeding Mailgun's per-message size — the full CSV is always linked.
  const MAX_INLINE_ROWS = 500
  const inlineRows = rows.slice(0, MAX_INLINE_ROWS)
  const truncated = rows.length > inlineRows.length
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        {cadence === 'weekly' ? 'Weekly' : 'Daily'} screen health report
        {orgName ? ` — ${orgName}` : ''}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>
            {cadence === 'weekly' ? 'Weekly' : 'Daily'} Screen Health Report
          </Heading>
          {orgName ? <Text style={subtle}>{orgName}</Text> : null}
          {generatedAt ? (
            <Text style={subtle}>Generated: {generatedAt}</Text>
          ) : null}
          {rangeLabel ? (
            <Text style={subtle}>Range: {rangeLabel}</Text>
          ) : null}

          <Section style={statsRow}>
            <Text style={statBox}>
              <span style={statLabel}>Total</span>
              <br />
              <span style={statValue}>{total}</span>
            </Text>
            <Text style={{ ...statBox, color: '#16a34a' }}>
              <span style={statLabel}>Online</span>
              <br />
              <span style={statValue}>{online}</span>
            </Text>
            <Text style={{ ...statBox, color: '#dc2626' }}>
              <span style={statLabel}>Offline</span>
              <br />
              <span style={statValue}>{offline}</span>
            </Text>
            <Text style={{ ...statBox, color: '#d97706' }}>
              <span style={statLabel}>Alerts</span>
              <br />
              <span style={statValue}>{alerts}</span>
            </Text>
          </Section>

          {downloadUrl ? (
            <Section style={{ textAlign: 'center', margin: '8px 0 16px' }}>
              <Button href={downloadUrl} style={downloadButton}>
                Download full CSV ({total} screens)
              </Button>
              <Text style={subtle}>
                {csvFilename ? `${csvFilename} · ` : ''}
                {downloadExpiresAt ? `Link expires ${downloadExpiresAt}` : 'Link valid for 30 days'}
              </Text>
            </Section>
          ) : null}

          <Hr style={hr} />

          <Heading as="h2" style={h2}>
            Screens{truncated ? ` (showing ${inlineRows.length} of ${rows.length} — see CSV for full list)` : ''}
          </Heading>

          <table style={table} cellPadding={0} cellSpacing={0}>
            <thead>
              <tr>
                <th style={th}>Name</th>
                <th style={th}>Group</th>
                <th style={th}>Status</th>
                <th style={th}>IP</th>
                <th style={th}>Heartbeat</th>
                <th style={th}>Alert</th>
              </tr>
            </thead>
            <tbody>
              {inlineRows.map((r, i) => (
                <tr key={i} style={i % 2 ? trAlt : undefined}>
                  <td style={td}>{r.name}</td>
                  <td style={td}>{r.group || '-'}</td>
                  <td style={{ ...td, color: r.status === 'online' ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
                    {r.status}
                  </td>
                  <td style={td}>{r.ip || '-'}</td>
                  <td style={td}>{r.heartbeat || '-'}</td>
                  <td style={{ ...td, color: '#d97706' }}>{r.alert ? '!' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <Hr style={hr} />
          <Text style={footer}>
            Sent automatically by {SITE_NAME}.
            {downloadUrl ? (
              <>
                {' '}Need a different format? Open the Screens page in the
                console to export as PDF, or use the{' '}
                <Link href={downloadUrl} style={{ color: '#2563eb' }}>direct CSV link</Link>.
              </>
            ) : (
              <> Open the Screens page in the console to export the full CSV / PDF report.</>
            )}
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: ScreenHealthReportEmail,
  subject: (data: Record<string, any>) =>
    `${data?.cadence === 'weekly' ? 'Weekly' : 'Daily'} screen health report${
      data?.orgName ? ` — ${data.orgName}` : ''
    }`,
  displayName: 'Screen health report',
  previewData: {
    orgName: 'Acme Co',
    cadence: 'daily',
    generatedAt: new Date().toISOString(),
    rangeLabel: 'Last 24h',
    total: 12,
    online: 10,
    offline: 2,
    alerts: 1,
    downloadUrl: 'https://example.com/signed-csv',
    downloadExpiresAt: '2024-12-31',
    csvFilename: 'screen-health-daily-2024-01-15-abc12345.csv',
    rows: [
      { name: 'Lobby Display', group: 'HQ', status: 'online', ip: '10.0.0.5', heartbeat: '2024-01-15 09:00', alert: false },
      { name: 'Cafe Display', group: 'HQ', status: 'offline', ip: '10.0.0.6', heartbeat: '2024-01-14 21:12', alert: true },
    ],
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, Helvetica, sans-serif' }
const container = { padding: '24px', maxWidth: '720px' }
const h1 = { fontSize: '22px', fontWeight: 'bold', color: '#0f172a', margin: '0 0 8px' }
const h2 = { fontSize: '15px', fontWeight: 600, color: '#0f172a', margin: '16px 0 8px' }
const subtle = { fontSize: '12px', color: '#64748b', margin: '0 0 4px' }
const statsRow = { display: 'block', margin: '16px 0' }
const statBox: React.CSSProperties = {
  display: 'inline-block',
  width: '23%',
  padding: '10px',
  textAlign: 'center',
  border: '1px solid #e2e8f0',
  borderRadius: '6px',
  margin: '0 1% 0 0',
  color: '#0f172a',
  verticalAlign: 'top',
}
const statLabel = { fontSize: '11px', color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '0.04em' }
const statValue = { fontSize: '20px', fontWeight: 700 }
const hr = { borderColor: '#e2e8f0', margin: '16px 0' }
const table: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '12px',
  color: '#0f172a',
}
const th: React.CSSProperties = {
  textAlign: 'left',
  background: '#f1f5f9',
  padding: '6px 8px',
  borderBottom: '1px solid #e2e8f0',
  fontWeight: 600,
}
const td: React.CSSProperties = {
  padding: '6px 8px',
  borderBottom: '1px solid #f1f5f9',
}
const trAlt: React.CSSProperties = { backgroundColor: '#fafafa' }
const footer = { fontSize: '11px', color: '#94a3b8', margin: '12px 0 0' }
const downloadButton: React.CSSProperties = {
  backgroundColor: '#0f172a',
  color: '#ffffff',
  padding: '10px 18px',
  borderRadius: '6px',
  fontSize: '13px',
  fontWeight: 600,
  textDecoration: 'none',
  display: 'inline-block',
}