// System (built-in) widgets — virtually injected into every org's media library.
// They are not stored in the DB; they are read-only and cannot be deleted.

export type SystemWidgetSubType =
  | "date" | "webpage" | "marquee"
  | "qrcode" | "countdown" | "youtube";

export interface SystemWidgetConfig {
  widgetType: SystemWidgetSubType;
  url?: string;
  text?: string;
  speed?: "slow" | "normal" | "fast";
  format?: "12" | "24";
  clockStyle?: "digital" | "analog";
  showDate?: boolean;
  timezone?: string;
  bgColor?: string;
  textColor?: string;
  qrcodeContent?: string;
  targetDate?: string;
  countdownTitle?: string;
  youtubeUrl?: string;
  fontSize?: "small" | "medium" | "large" | "xlarge";
  qrcodeSize?: number;
  animation?: "none" | "fadeIn" | "slideUp" | "bounce" | "zoomIn" | "flipIn";
}

export interface SystemWidgetDef {
  id: string;            // virtual id, prefixed `sys-widget-`
  name: string;          // i18n key suffix on widget*
  nameKey: string;       // translation key
  config: SystemWidgetConfig;
}

// Stable ISO created_at so sorting is deterministic and they appear last by newest order
const SYSTEM_CREATED_AT = "2000-01-01T00:00:00.000Z";

export const SYSTEM_WIDGETS: SystemWidgetDef[] = [
  {
    id: "sys-widget-date",
    name: "Date",
    nameKey: "widgetDate",
    config: {
      widgetType: "date", bgColor: "#1e293b", textColor: "#ffffff",
      fontSize: "large", animation: "fadeIn",
    },
  },
  {
    id: "sys-widget-webpage",
    name: "Webpage",
    nameKey: "widgetWebpage",
    config: {
      widgetType: "webpage", url: "https://example.com",
      bgColor: "#ffffff", textColor: "#000000", animation: "none",
    },
  },
  {
    id: "sys-widget-marquee",
    name: "Marquee",
    nameKey: "widgetMarquee",
    config: {
      widgetType: "marquee", text: "Welcome to SignCMS",
      speed: "normal", bgColor: "#0f172a", textColor: "#fbbf24",
      fontSize: "large", animation: "none",
    },
  },
  {
    id: "sys-widget-qrcode",
    name: "QR Code",
    nameKey: "widgetQrcode",
    config: {
      widgetType: "qrcode", qrcodeContent: "https://signcms.com",
      qrcodeSize: 200, bgColor: "#ffffff", textColor: "#000000",
      animation: "fadeIn",
    },
  },
  {
    id: "sys-widget-countdown",
    name: "Countdown",
    nameKey: "widgetCountdown",
    config: {
      widgetType: "countdown",
      countdownTitle: "Countdown",
      targetDate: "2030-01-01T00:00:00",
      bgColor: "#1e293b", textColor: "#ffffff",
      fontSize: "large", animation: "zoomIn",
    },
  },
  {
    id: "sys-widget-youtube",
    name: "YouTube",
    nameKey: "widgetYoutube",
    config: {
      widgetType: "youtube",
      youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      bgColor: "#000000", textColor: "#ffffff", animation: "none",
    },
  },
];

/**
 * Build virtual media_items rows that mirror the DB shape used by MediaPage.
 * Caller passes activeOrgId so they look like rows belonging to that org,
 * and an optional `t` translator to localize widget names.
 */
export function getSystemWidgetMediaRows(
  orgId: string | null | undefined,
  t?: (key: string) => string,
) {
  return SYSTEM_WIDGETS.map((w) => ({
    id: w.id,
    name: t ? t(w.nameKey) : w.name,
    original_name: null as string | null,
    type: "widget" as const,
    url: "widget://" + JSON.stringify(w.config),
    thumbnail: "",
    size_bytes: 0,
    width: null as number | null,
    height: null as number | null,
    duration_seconds: null as number | null,
    created_at: SYSTEM_CREATED_AT,
    design_project_id: null as string | null,
    is_system: true,
    org_id: orgId || "",
    md5: null as string | null,
    mime_type: "application/x-widget",
    uploaded_by: null as string | null,
  }));
}

/**
 * Build virtual rows for ContentStudio's `dbWidgets` shape.
 * url is raw JSON (starts with `{`) so the existing parser picks it up.
 */
export function getSystemWidgetStudioRows(t?: (key: string) => string) {
  return SYSTEM_WIDGETS.map((w) => ({
    id: w.id,
    name: t ? t(w.nameKey) : w.name,
    url: JSON.stringify(w.config),
    created_at: SYSTEM_CREATED_AT,
  }));
}

export function isSystemWidgetId(id: string | null | undefined) {
  return !!id && id.startsWith("sys-widget-");
}
