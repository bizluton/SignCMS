/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'

export interface TemplateEntry {
  component: React.ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  to?: string
  displayName?: string
  previewData?: Record<string, any>
}

import { template as screenHealthReport } from './screen-health-report.tsx'
import { template as weatherAlert }      from './weather-alert.tsx'

export const TEMPLATES: Record<string, TemplateEntry> = {
  'screen-health-report': screenHealthReport,
  'weather-alert':        weatherAlert,
}