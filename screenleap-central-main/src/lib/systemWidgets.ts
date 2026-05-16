// System (built-in) widgets — virtually injected into every org's media library.
// They are not stored in the DB; they are read-only and cannot be deleted.

const STORAGE_BASE = `${import.meta.env.VITE_SUPABASE_URL ?? ""}/storage/v1/object/public/system-widgets`;

export type SystemWidgetSubType =
  | "date" | "clock" | "webpage" | "marquee"
  | "qrcode" | "countdown" | "youtube" | "weather" | "weather_tw";

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
  {
    id: "sys-widget-weather",
    name: "Weather",
    nameKey: "widgetWeather",
    config: {
      widgetType: "weather", city: "Taipei",
      bgColor: "#0ea5e9", textColor: "#ffffff",
      fontSize: "large", animation: "fadeIn",
    },
  },
  {
    id: "sys-widget-weather-tw",
    name: "Taiwan Weather",
    nameKey: "widgetWeatherTw",
    config: {
      widgetType: "weather_tw",
      url: `${STORAGE_BASE}/taiwan_weather/index.html`,
      bgColor: "#0f172a",
      textColor: "#cccccc",
      animation: "fadeIn",
      params: {
        locationName: "臺北市",
        regionName: "信義區",
        fontColor: "#cccccc",
        wallColor: "#0f172a",
        weatherColor: "#ffffff",
        layoutMode: "auto",
        showUV: true,
        showAQ: true,
      },
      paramsSchema: [
        {
          key: "locationName", type: "select", label: "County", label_zh: "縣市", default: "臺北市",
          options: [
            { value: "臺北市", label: "Taipei City",    label_zh: "臺北市" },
            { value: "新北市", label: "New Taipei",     label_zh: "新北市" },
            { value: "桃園市", label: "Taoyuan",        label_zh: "桃園市" },
            { value: "臺中市", label: "Taichung",       label_zh: "臺中市" },
            { value: "臺南市", label: "Tainan",         label_zh: "臺南市" },
            { value: "高雄市", label: "Kaohsiung",      label_zh: "高雄市" },
            { value: "基隆市", label: "Keelung",        label_zh: "基隆市" },
            { value: "新竹縣", label: "Hsinchu County", label_zh: "新竹縣" },
            { value: "新竹市", label: "Hsinchu City",   label_zh: "新竹市" },
            { value: "苗栗縣", label: "Miaoli",         label_zh: "苗栗縣" },
            { value: "彰化縣", label: "Changhua",       label_zh: "彰化縣" },
            { value: "南投縣", label: "Nantou",         label_zh: "南投縣" },
            { value: "雲林縣", label: "Yunlin",         label_zh: "雲林縣" },
            { value: "嘉義縣", label: "Chiayi County",  label_zh: "嘉義縣" },
            { value: "嘉義市", label: "Chiayi City",    label_zh: "嘉義市" },
            { value: "屏東縣", label: "Pingtung",       label_zh: "屏東縣" },
            { value: "宜蘭縣", label: "Yilan",          label_zh: "宜蘭縣" },
            { value: "花蓮縣", label: "Hualien",        label_zh: "花蓮縣" },
            { value: "臺東縣", label: "Taitung",        label_zh: "臺東縣" },
            { value: "澎湖縣", label: "Penghu",         label_zh: "澎湖縣" },
            { value: "金門縣", label: "Kinmen",         label_zh: "金門縣" },
            { value: "連江縣", label: "Lienchiang",     label_zh: "連江縣" },
          ],
        },
        { key: "regionName",   type: "text",   label: "District",     label_zh: "鄉鎮區",     default: "信義區"  },
        {
          key: "layoutMode", type: "select", label: "Layout", label_zh: "版面模式", default: "auto",
          options: [
            { value: "auto",      label: "Auto",      label_zh: "自動" },
            { value: "portrait",  label: "Portrait",  label_zh: "直式" },
            { value: "landscape", label: "Landscape", label_zh: "橫式" },
          ],
        },
        { key: "fontColor",    type: "color",  label: "Text Color",      label_zh: "文字顏色",   default: "#cccccc" },
        { key: "weatherColor", type: "color",  label: "Icon Color",      label_zh: "圖示顏色",   default: "#ffffff" },
        { key: "wallColor",    type: "color",  label: "Background",      label_zh: "背景顏色",   default: "#0f172a" },
        { key: "showUV",       type: "toggle", label: "Show UV Index",   label_zh: "顯示 UV 指數",  default: true  },
        { key: "showAQ",       type: "toggle", label: "Show Air Quality",label_zh: "顯示空氣品質", default: true },
      ],
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
