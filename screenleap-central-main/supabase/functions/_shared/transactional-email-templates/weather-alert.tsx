/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview,
  Text, Hr, Section,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface WeatherAlertProps {
  source?: string
  fallback?: string
  location?: string
  errorMsg?: string
  timestamp?: string
}

const WeatherAlertEmail = ({
  source    = '--',
  fallback  = '--',
  location  = '--',
  errorMsg  = '--',
  timestamp,
}: WeatherAlertProps) => (
  <Html lang="zh-TW" dir="ltr">
    <Head />
    <Preview>⚠️ SignCMS 天氣資料源異常：{source}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>⚠️ 天氣資料源異常通知</Heading>
        <Text style={intro}>
          SignCMS 天氣系統偵測到資料源異常，目前已切換至備援模式，請盡速確認：
        </Text>
        <Hr style={hr} />
        <Section>
          <table style={table} cellPadding={0} cellSpacing={0}>
            <tbody>
              <Row label="異常來源" value={source} highlight />
              <Row label="備援方式" value={fallback} />
              <Row label="影響地點" value={location} />
              <Row label="錯誤訊息" value={errorMsg} error />
              <Row label="發生時間 (UTC)" value={timestamp ?? new Date().toISOString()} />
            </tbody>
          </table>
        </Section>
        <Hr style={hr} />
        <Text style={footer}>
          此郵件由 SignCMS 天氣系統自動發送（冷卻時間 1 小時，同一資料源異常期間不重複發送）。
        </Text>
      </Container>
    </Body>
  </Html>
)

function Row({ label, value, highlight, error }: {
  label: string; value: string; highlight?: boolean; error?: boolean;
}) {
  return (
    <tr>
      <td style={tdLabel}>{label}</td>
      <td style={{ ...tdValue, ...(highlight ? { color: '#dc2626', fontWeight: 700 } : {}), ...(error ? { color: '#b45309' } : {}) }}>
        {value}
      </td>
    </tr>
  )
}

export const template = {
  component: WeatherAlertEmail,
  subject: (data: Record<string, any>) =>
    `⚠️ SignCMS 天氣資料源異常：${data?.source ?? '--'}`,
  displayName: 'Weather data source alert',
  previewData: {
    source: 'CWA',
    fallback: 'Open-Meteo（縣市座標）',
    location: '臺北市信義區',
    errorMsg: 'CWA API timeout after 10000ms',
    timestamp: new Date().toISOString(),
  },
} satisfies TemplateEntry

const main  = { backgroundColor: '#ffffff', fontFamily: 'Arial, Helvetica, sans-serif' }
const container = { padding: '28px', maxWidth: '600px' }
const h1    = { fontSize: '18px', fontWeight: 'bold' as const, color: '#dc2626', margin: '0 0 8px' }
const intro = { fontSize: '13px', color: '#0f172a', margin: '0 0 16px' }
const hr    = { borderColor: '#e2e8f0', margin: '16px 0' }
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: '13px' }
const tdLabel: React.CSSProperties = {
  padding: '7px 10px', fontWeight: 600, width: '32%',
  background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569',
}
const tdValue: React.CSSProperties = {
  padding: '7px 10px', color: '#0f172a',
  borderBottom: '1px solid #e2e8f0',
}
const footer = { fontSize: '11px', color: '#94a3b8', margin: '12px 0 0' }
