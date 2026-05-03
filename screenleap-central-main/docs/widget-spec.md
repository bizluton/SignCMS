# SignCMS Widget 設計規範與 JSON 說明

**版本 1.0 · 2026-05-03**  
**適用對象：系統管理員、內容設計師、第三方 Widget 開發者**

---

## 目錄

1. [架構概覽](#1-架構概覽)
2. [資料庫結構](#2-資料庫結構)
3. [WidgetConfig JSON 規範](#3-widgetconfig-json-規範)
4. [paramsSchema 規範](#4-paramsschema-規範)
5. [內建 Widget 完整 JSON 範例](#5-內建-widget-完整-json-範例)
6. [外部 Widget（第三方）JSON 範例](#6-外部-widget第三方-json-範例)
7. [Zone 中的 widgetConfig 使用方式](#7-zone-中的-widgetconfig-使用方式)
8. [新增自訂 Widget 步驟](#8-新增自訂-widget-步驟)
9. [欄位速查表](#9-欄位速查表)

---

## 1. 架構概覽

```
widgets 資料表（DB）
    │
    ├── scope = "system"    系統內建，所有組織可見
    ├── scope = "app"       需安裝指定 App 才可見（app_id 為 App 識別碼）
    ├── scope = "user"      組織自建，僅限該組織
    └── scope = "external"  第三方 App Store Widget（需安裝 store_app）
          │
          └── config (jsonb)
                └── WidgetConfig JSON
                      ├── widgetType        決定渲染引擎
                      ├── url               HTML Widget 的入口位址
                      ├── params            執行期可設定的參數值
                      ├── paramsSchema      Content Studio 表單自動產生的描述
                      └── 外觀欄位 (bgColor, textColor, animation…)
```

Content Studio 將 Widget 拖入 Zone 後，`widgetConfig` 以 JSON 字串嵌入 Zone 的設定中。  
播放端直接讀取該 JSON 進行渲染，**不再回查資料庫**，因此 JSON 格式必須完整自足。

---

## 2. 資料庫結構

### 2.1 `public.widgets` 資料表

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | uuid | 主鍵，自動產生 |
| `scope` | text | `system` / `app` / `user` / `external` |
| `name` | text | 顯示名稱（語系 fallback 用）|
| `name_i18n` | jsonb | 多語系名稱 `{"zh":"…","en":"…","ja":"…"}` |
| `widget_type` | text | 唯一識別碼（即 `config.widgetType`），需全表唯一 |
| `config` | jsonb | **WidgetConfig JSON**（見第 3 節）|
| `thumbnail` | text | 縮圖 URL（Media Library 顯示用）|
| `app_id` | text | app-scope Widget 所屬的 App 識別碼（slug）|
| `org_id` | uuid | user-scope Widget 所屬的組織 |
| `sort_order` | integer | 排序（數字越小越前面）|
| `created_by` | uuid | 建立者 user id |
| `created_at` | timestamptz | 建立時間 |
| `updated_at` | timestamptz | 更新時間 |

### 2.2 `public.widget_org_exclusions` 資料表

| 欄位 | 型別 | 說明 |
|---|---|---|
| `widget_id` | uuid | FK → widgets.id |
| `org_id` | uuid | FK → organizations.id |

某組織若在此表有對應記錄，該 Widget 對該組織隱藏（不出現在 Content Studio Widget 清單中）。

---

## 3. WidgetConfig JSON 規範

`config` 欄位為 JSONB 格式，所有 Widget 共用以下根層欄位。

### 3.1 根層欄位（所有 widgetType 共用）

| 欄位 | 型別 | 必填 | 預設值 | 說明 |
|---|---|---|---|---|
| `widgetType` | string | ✓ | — | Widget 類型識別碼（見第 5 節）|
| `url` | string | 視類型 | — | HTML Widget 入口 URL；HTML-based Widget 必填 |
| `bgColor` | string | — | `"#1a1a2e"` | 背景色（CSS 色碼或 `"transparent"`）|
| `textColor` | string | — | `"#ffffff"` | 主文字色（CSS 色碼）|
| `animation` | string | — | `"none"` | 進場動畫（見 §3.2）|
| `fontSize` | string | — | `"medium"` | 字型大小等級（見 §3.3）|
| `params` | object | — | `{}` | 執行期參數值（配合 `paramsSchema` 使用）|
| `paramsSchema` | array | — | `[]` | 參數描述陣列（定義 Content Studio 表單）|
| `widgetScope` | string | — | — | 由系統寫入；`"system"` / `"app"` / `"user"` / `"external"` |
| `widgetAppId` | string | — | — | 由系統寫入；external scope Widget 的 store_apps UUID |
| `_catalogType` | string | — | — | 由系統寫入；等同 `widgetType`，供 Media Library 識別用 |

### 3.2 `animation` 有效值

| 值 | 效果 |
|---|---|
| `"none"` | 無動畫（預設）|
| `"fadeIn"` | 淡入（0.8s）|
| `"slideUp"` | 由下滑入（0.6s）|
| `"bounce"` | 彈跳出現（0.8s）|
| `"zoomIn"` | 縮放放大（0.5s）|

### 3.3 `fontSize` 有效值

適用於 `clock`（legacy）、`date`、`marquee`、`countdown` 類型。

| 值 | 說明 |
|---|---|
| `"small"` | 小字 |
| `"medium"` | 中字（預設）|
| `"large"` | 大字 |
| `"xlarge"` | 超大字 |

---

## 4. paramsSchema 規範

`paramsSchema` 是一個陣列，每個元素描述一個可在 Content Studio 設定的參數。  
平台依此陣列自動渲染表單控制項；HTML Widget 在 iframe 中讀取 `params` 物件取得實際值。

### 4.1 ParamDef 物件結構

```jsonc
{
  "key":       "locationName",       // 必填：params 中的 key 名稱
  "type":      "select",             // 必填：控制項類型（見 §4.2）
  "label":     "County",             // 必填：英文標籤
  "label_zh":  "縣市",               // 選填：中文標籤
  "default":   "臺北市",              // 選填：預設值
  "options": [                       // 僅 type="select" 時使用
    { "value": "臺北市", "label": "Taipei City", "label_zh": "臺北市" }
  ],
  "min": 3,                          // 僅 type="number" 時使用
  "max": 3600,                       // 僅 type="number" 時使用
  "transparent": true                // 僅 type="color" 時使用；允許透明選項
}
```

### 4.2 `type` 有效值

| type | 渲染元件 | 說明 |
|---|---|---|
| `"text"` | Input | 單行文字輸入 |
| `"select"` | Select + SelectItem | 下拉選單；需提供 `options` |
| `"color"` | ColorSwatchInput | 顏色選取器（hex 格式）|
| `"toggle"` | Switch | 開關（boolean，`true` / `false`）|
| `"number"` | Slider + 數字顯示 | 數值滑桿；支援 `min`、`max` |

### 4.3 params 資料流

```
DB: widgets.config.paramsSchema  →  Content Studio 表單
                                         │ 使用者填寫
                                         ▼
                               widgetConfig.params (JSON)
                                         │ 存入 Zone
                                         ▼
                             HTML Widget iframe URL query params
                             或 postMessage 傳入（視 Widget 實作）
```

> **重要：** HTML Widget 必須自行從 `window.location.search` 讀取 `params` 中的值；  
> 平台不會主動推送，只在 iframe src 載入時帶入。

---

## 5. 內建 Widget 完整 JSON 範例

### 5.1 數位時鐘（`clock`）— React 原生渲染

```json
{
  "widgetType":  "clock",
  "clockStyle":  "digital",
  "format":      "HH:mm:ss",
  "timezone":    "Asia/Taipei",
  "showDate":    true,
  "bgColor":     "#1a1a2e",
  "textColor":   "#ffffff",
  "fontSize":    "large",
  "animation":   "none"
}
```

| 欄位 | 型別 | 有效值 | 說明 |
|---|---|---|---|
| `clockStyle` | string | `"digital"` / `"analog"` | 時鐘外觀 |
| `format` | string | 任意 dayjs 格式字串 | 時間格式，如 `"HH:mm"` |
| `timezone` | string | IANA 時區名稱 | 如 `"Asia/Taipei"`、`"America/New_York"` |
| `showDate` | boolean | `true` / `false` | 是否顯示日期 |

---

### 5.2 HTML 時鐘（`clock` + `paramsSchema`）— HTML Widget

當 `paramsSchema` 存在時，平台切換為 HTML iframe 模式，`url` 為 HTML 檔案位址。

```json
{
  "widgetType": "clock",
  "url":        "https://<project>.supabase.co/storage/v1/object/public/system-widgets/html_clock/index.html",
  "bgColor":    "#0f172a",
  "textColor":  "#ffffff",
  "animation":  "fadeIn",
  "params": {
    "timeFmt":  "HH:mm",
    "showSec":  false,
    "fontColor": "#ffffff",
    "wallColor": "#0f172a"
  },
  "paramsSchema": [
    {
      "key": "timeFmt",
      "type": "select",
      "label": "Time Format",
      "label_zh": "時間格式",
      "default": "HH:mm",
      "options": [
        { "value": "HH:mm",    "label": "24hr (HH:mm)",    "label_zh": "24小時制" },
        { "value": "hh:mm A",  "label": "12hr (hh:mm AM)", "label_zh": "12小時制" }
      ]
    },
    {
      "key": "showSec",
      "type": "toggle",
      "label": "Show Seconds",
      "label_zh": "顯示秒數",
      "default": false
    },
    {
      "key": "fontColor",
      "type": "color",
      "label": "Text Color",
      "label_zh": "文字顏色",
      "default": "#ffffff"
    },
    {
      "key": "wallColor",
      "type": "color",
      "label": "Background",
      "label_zh": "背景顏色",
      "default": "#0f172a"
    }
  ]
}
```

---

### 5.3 日期顯示（`date`）

```json
{
  "widgetType": "date",
  "format":     "YYYY年MM月DD日 dddd",
  "timezone":   "Asia/Taipei",
  "bgColor":    "#1a1a2e",
  "textColor":  "#ffffff",
  "fontSize":   "medium",
  "animation":  "fadeIn"
}
```

| 欄位 | 型別 | 說明 |
|---|---|---|
| `format` | string | dayjs 格式字串；支援 `YYYY`、`MM`、`DD`、`dddd`（週幾）等 |
| `timezone` | string | IANA 時區名稱 |

---

### 5.4 跑馬燈文字（`marquee`）

```json
{
  "widgetType": "marquee",
  "text":       "歡迎蒞臨 SignCMS 智慧看板系統！",
  "speed":      "normal",
  "bgColor":    "#1a1a2e",
  "textColor":  "#ffffff",
  "fontSize":   "medium",
  "animation":  "none"
}
```

| 欄位 | 型別 | 有效值 | 說明 |
|---|---|---|---|
| `text` | string | — | 顯示文字內容 |
| `speed` | string | `"slow"` / `"normal"` / `"fast"` | 滾動速度（對應 25s / 14s / 8s 週期）|

---

### 5.5 網頁嵌入（`webpage`）

```json
{
  "widgetType": "webpage",
  "url":        "https://example.com/dashboard",
  "bgColor":    "#ffffff",
  "animation":  "none"
}
```

> ⚠️ 目標網站必須允許被 iframe 嵌入（不設置 `X-Frame-Options: DENY`）。

---

### 5.6 QR Code（`qrcode`）

```json
{
  "widgetType":    "qrcode",
  "qrcodeContent": "https://example.com",
  "qrcodeSize":    200,
  "bgColor":       "#ffffff",
  "textColor":     "#000000",
  "animation":     "fadeIn"
}
```

| 欄位 | 型別 | 說明 |
|---|---|---|
| `qrcodeContent` | string | QR Code 編碼的文字或 URL |
| `qrcodeSize` | number | QR Code 像素大小（80–400，步進 10）|

---

### 5.7 倒數計時（`countdown`）

```json
{
  "widgetType":     "countdown",
  "countdownTitle": "新產品發布",
  "targetDate":     "2026-12-31T00:00:00",
  "bgColor":        "#1a1a2e",
  "textColor":      "#ffffff",
  "fontSize":       "large",
  "animation":      "slideUp"
}
```

| 欄位 | 型別 | 說明 |
|---|---|---|
| `countdownTitle` | string | 倒數標題文字（選填）|
| `targetDate` | string | 目標日期時間，ISO 8601 格式（`YYYY-MM-DDTHH:mm:ss`）|

---

### 5.8 YouTube 影片（`youtube`）

```json
{
  "widgetType":    "youtube",
  "youtubeUrl":    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "youtubeMuted":  true,
  "youtubeMuteBgm": false,
  "youtubeVolume": 50,
  "bgColor":       "transparent",
  "animation":     "none"
}
```

| 欄位 | 型別 | 說明 |
|---|---|---|
| `youtubeUrl` | string | YouTube 影片網址（支援 watch?v= 及 youtu.be 格式）|
| `youtubeMuted` | boolean | 是否靜音（預設 `true`，數位看板建議維持靜音）|
| `youtubeMuteBgm` | boolean | 靜音模式下是否停止背景音樂 |
| `youtubeVolume` | number | 音量（0–100）；`youtubeMuted=false` 時有效 |

---

### 5.9 RTSP / HLS 串流（`stream`）

```json
{
  "widgetType":     "stream",
  "streamUrl":      "https://live.example.com/stream.m3u8",
  "streamMuted":    true,
  "streamFit":      "cover",
  "streamProtocol": "hls",
  "bgColor":        "transparent",
  "animation":      "none"
}
```

| 欄位 | 型別 | 有效值 | 說明 |
|---|---|---|---|
| `streamUrl` | string | — | 串流位址（HLS .m3u8 或 RTSP）|
| `streamMuted` | boolean | `true` / `false` | 是否靜音 |
| `streamFit` | string | `"cover"` / `"contain"` / `"fill"` | 影像填充方式 |
| `streamProtocol` | string | `"hls"` / `"rtsp"` | 串流協定 |

---

### 5.10 台灣天氣（`weather_tw`）— HTML Widget

```json
{
  "widgetType": "weather_tw",
  "url":        "https://<project>.supabase.co/storage/v1/object/public/system-widgets/taiwan_weather/index.html",
  "bgColor":    "#0f172a",
  "textColor":  "#cccccc",
  "animation":  "fadeIn",
  "params": {
    "locationName": "臺北市",
    "regionName":   "信義區",
    "fontColor":    "#cccccc",
    "wallColor":    "#0f172a",
    "weatherColor": "#ffffff",
    "layoutMode":   "auto"
  },
  "paramsSchema": [
    {
      "key": "locationName",
      "type": "select",
      "label": "County",
      "label_zh": "縣市",
      "default": "臺北市",
      "options": [
        { "value": "臺北市",  "label": "Taipei City",    "label_zh": "臺北市"  },
        { "value": "新北市",  "label": "New Taipei",     "label_zh": "新北市"  },
        { "value": "桃園市",  "label": "Taoyuan",        "label_zh": "桃園市"  },
        { "value": "臺中市",  "label": "Taichung",       "label_zh": "臺中市"  },
        { "value": "臺南市",  "label": "Tainan",         "label_zh": "臺南市"  },
        { "value": "高雄市",  "label": "Kaohsiung",      "label_zh": "高雄市"  },
        { "value": "基隆市",  "label": "Keelung",        "label_zh": "基隆市"  },
        { "value": "新竹縣",  "label": "Hsinchu County", "label_zh": "新竹縣"  },
        { "value": "新竹市",  "label": "Hsinchu City",   "label_zh": "新竹市"  },
        { "value": "苗栗縣",  "label": "Miaoli",         "label_zh": "苗栗縣"  },
        { "value": "彰化縣",  "label": "Changhua",       "label_zh": "彰化縣"  },
        { "value": "南投縣",  "label": "Nantou",         "label_zh": "南投縣"  },
        { "value": "雲林縣",  "label": "Yunlin",         "label_zh": "雲林縣"  },
        { "value": "嘉義縣",  "label": "Chiayi County",  "label_zh": "嘉義縣"  },
        { "value": "嘉義市",  "label": "Chiayi City",    "label_zh": "嘉義市"  },
        { "value": "屏東縣",  "label": "Pingtung",       "label_zh": "屏東縣"  },
        { "value": "宜蘭縣",  "label": "Yilan",          "label_zh": "宜蘭縣"  },
        { "value": "花蓮縣",  "label": "Hualien",        "label_zh": "花蓮縣"  },
        { "value": "臺東縣",  "label": "Taitung",        "label_zh": "臺東縣"  },
        { "value": "澎湖縣",  "label": "Penghu",         "label_zh": "澎湖縣"  },
        { "value": "金門縣",  "label": "Kinmen",         "label_zh": "金門縣"  },
        { "value": "連江縣",  "label": "Lienchiang",     "label_zh": "連江縣"  }
      ]
    },
    {
      "key": "regionName",
      "type": "text",
      "label": "District",
      "label_zh": "鄉鎮區",
      "default": "信義區"
    },
    {
      "key": "layoutMode",
      "type": "select",
      "label": "Layout",
      "label_zh": "版面模式",
      "default": "auto",
      "options": [
        { "value": "auto",      "label": "Auto",      "label_zh": "自動" },
        { "value": "portrait",  "label": "Portrait",  "label_zh": "直式" },
        { "value": "landscape", "label": "Landscape", "label_zh": "橫式" }
      ]
    },
    { "key": "fontColor",    "type": "color", "label": "Text Color",      "label_zh": "文字顏色", "default": "#cccccc" },
    { "key": "weatherColor", "type": "color", "label": "Icon Color",      "label_zh": "圖示顏色", "default": "#ffffff" },
    { "key": "wallColor",    "type": "color", "label": "Background",      "label_zh": "背景顏色", "default": "#0f172a" },
    { "key": "showUV",       "type": "toggle","label": "Show UV Index",   "label_zh": "顯示 UV 指數",  "default": true   },
    { "key": "showAQ",       "type": "toggle","label": "Show Air Quality","label_zh": "顯示空氣品質", "default": true  }
  ]
}
```

---

### 5.11 全球天氣（`weather`）— HTML Widget

```json
{
  "widgetType": "weather",
  "url":        "https://<project>.supabase.co/storage/v1/object/public/system-widgets/global_weather/index.html",
  "bgColor":    "#0f172a",
  "textColor":  "#cccccc",
  "animation":  "fadeIn",
  "params": {
    "city":         "Tokyo",
    "country":      "JP",
    "lat":          "",
    "lon":          "",
    "fontColor":    "#cccccc",
    "wallColor":    "#0f172a",
    "weatherColor": "#ffffff",
    "layoutMode":   "auto"
  },
  "paramsSchema": [
    { "key": "city",    "type": "text",   "label": "City",            "label_zh": "城市",     "default": "Tokyo" },
    { "key": "country", "type": "text",   "label": "Country Code",    "label_zh": "國家代碼", "default": "JP"    },
    { "key": "lat",     "type": "text",   "label": "Latitude (opt)",  "label_zh": "緯度（選填）", "default": "" },
    { "key": "lon",     "type": "text",   "label": "Longitude (opt)", "label_zh": "經度（選填）", "default": "" },
    {
      "key": "layoutMode",
      "type": "select",
      "label": "Layout",
      "label_zh": "版面模式",
      "default": "auto",
      "options": [
        { "value": "auto",      "label": "Auto",      "label_zh": "自動" },
        { "value": "portrait",  "label": "Portrait",  "label_zh": "直式" },
        { "value": "landscape", "label": "Landscape", "label_zh": "橫式" }
      ]
    },
    { "key": "fontColor",    "type": "color",  "label": "Text Color",      "label_zh": "文字顏色", "default": "#cccccc" },
    { "key": "weatherColor", "type": "color",  "label": "Icon Color",      "label_zh": "圖示顏色", "default": "#ffffff" },
    { "key": "wallColor",    "type": "color",  "label": "Background",      "label_zh": "背景顏色", "default": "#0f172a" },
    { "key": "showUV",       "type": "toggle", "label": "Show UV Index",   "label_zh": "顯示 UV 指數",    "default": true },
    { "key": "showAQ",       "type": "toggle", "label": "Show Air Quality","label_zh": "顯示空氣品質",    "default": true }
  ]
}
```

---

### 5.12 公告看板（`announcement`）— HTML Widget + app-scope

```json
{
  "widgetType": "announcement",
  "url":        "https://<project>.supabase.co/storage/v1/object/public/system-widgets/announcement_board/index.html",
  "bgColor":    "#0f172a",
  "textColor":  "#ffffff",
  "accentColor": "#f97316",
  "animation":  "none",
  "params": {
    "orgId":        "",
    "teamId":       "",
    "lang":         "zh",
    "accentColor":  "#f97316",
    "bgColor":      "#0f172a",
    "textColor":    "#ffffff",
    "defaultDwell": 10
  },
  "paramsSchema": [
    {
      "key": "orgId",
      "type": "text",
      "label": "Organisation ID",
      "label_zh": "組織 ID",
      "default": ""
    },
    {
      "key": "lang",
      "type": "select",
      "label": "Language",
      "label_zh": "語言",
      "default": "zh",
      "options": [
        { "value": "zh", "label": "中文",    "label_zh": "中文" },
        { "value": "en", "label": "English", "label_zh": "英文" },
        { "value": "ja", "label": "日本語",  "label_zh": "日文" }
      ]
    },
    { "key": "accentColor",  "type": "color",  "label": "Accent Color",      "label_zh": "強調色",     "default": "#f97316" },
    { "key": "bgColor",      "type": "color",  "label": "Background Color",  "label_zh": "背景顏色",   "default": "#0f172a" },
    { "key": "textColor",    "type": "color",  "label": "Text Color",        "label_zh": "文字顏色",   "default": "#ffffff" },
    { "key": "defaultDwell", "type": "number", "label": "Default Dwell (s)", "label_zh": "預設停留秒數","default": 10, "min": 3 }
  ]
}
```

> **說明：** `orgId` 與 `teamId` 由 Content Studio 的 `AnnouncementScopePicker` 元件填寫，  
> 不需手動輸入。留空則顯示全組織公告。

---

## 6. 外部 Widget（第三方）JSON 範例

外部 Widget 在 App Store 審核通過後，由平台自動寫入 `widgets` 資料表（`scope = "external"`）。

### 6.1 DB 寫入格式（系統自動執行）

```json
{
  "scope":       "external",
  "widget_type": "my-weather-widget",
  "app_id":      "my-weather-widget",
  "name":        "天氣 Widget",
  "name_i18n":   { "zh": "天氣 Widget", "en": "Weather Widget" },
  "config": {
    "url":         "https://widgets.acme.com/weather/v1",
    "widgetType":  "my-weather-widget",
    "widgetScope": "external",
    "widgetAppId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
  },
  "thumbnail":   "",
  "sort_order":  999
}
```

### 6.2 Zone 中的 widgetConfig（Content Studio 存入）

外部 Widget 被拖入 Zone 後，系統自動附加 `widgetScope` 與 `widgetAppId`：

```json
{
  "widgetType":  "my-weather-widget",
  "widgetScope": "external",
  "widgetAppId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "url":         "https://widgets.acme.com/weather/v1",
  "_catalogType": "my-weather-widget"
}
```

### 6.3 iframe 載入時的實際 URL（平台自動簽名）

```
https://widgets.acme.com/weather/v1
  ?orgId=<org_uuid>
  &installToken=<hex64>
  &lang=zh
  &ts=1746480000
  &exp=1746483600
  &sig=<base64url_hmac_sha256>
```

簽名有效期：**1 小時**。Widget HTML 應驗證此簽名後再渲染內容（詳見整合文件）。

---

## 7. Zone 中的 widgetConfig 使用方式

### 7.1 widgetConfig 在頻道設定中的儲存位置

```
channels (DB)
  └── schedules (jsonb array)
        └── blocks[]
              └── zones[]
                    └── content
                          ├── type: "widget"
                          ├── widgetId: "cat-widget-<uuid>"
                          ├── widgetName: "台灣天氣"
                          └── widgetConfig: { ...WidgetConfig JSON... }
```

`widgetConfig` 是 `WidgetConfig` 物件的完整副本，**直接嵌入** 在頻道 JSON 中，播放端不需回查 `widgets` 資料表。

### 7.2 `widget://` 協定（Media Library 內部使用）

Widget 在 Media Library 以虛擬 URL 表示：

```
widget://{"widgetType":"clock","clockStyle":"digital","_catalogType":"clock",...}
```

這個 URL 只在 Media Library 拖拉介面使用；真正儲存時平台會解析為 `widgetConfig` 物件。

### 7.3 渲染決策樹

```
widgetConfig.widgetType
    ├── "clock"         → React 時鐘元件（或 HTML iframe，視是否有 paramsSchema）
    ├── "date"          → React 日期元件
    ├── "marquee"       → React 跑馬燈元件
    ├── "webpage"       → <iframe src={url} />
    ├── "qrcode"        → React QR Code 元件
    ├── "countdown"     → React 倒數元件
    ├── "youtube"       → YouTube iframe embed
    ├── "stream"        → HLS / RTSP 播放器
    ├── "weather"       → HTML iframe（全球天氣）
    ├── "weather_tw"    → HTML iframe（台灣天氣）
    ├── "announcement"  → HTML iframe（公告看板）
    └── 其他            → widgetScope === "external"
                             → ExternalWidgetZonePreview
                                  → sign-widget-params EF
                                  → 已簽名的 HTML iframe
```

---

## 8. 新增自訂 Widget 步驟

### 方式一：系統管理員手動新增（適合 HTML Widget）

1. 將 HTML 檔案上傳至 Supabase Storage `system-widgets` bucket
2. 取得公開 URL：`https://<project>.supabase.co/storage/v1/object/public/system-widgets/<path>`
3. 執行以下 SQL（或透過管理介面）：

```sql
INSERT INTO public.widgets (
  scope, name, name_i18n, widget_type, config, sort_order, created_by
) VALUES (
  'system',
  'My Custom Widget',
  '{"zh":"自訂 Widget","en":"My Custom Widget"}'::jsonb,
  'my-custom-widget',                -- 唯一識別碼
  jsonb_build_object(
    'widgetType', 'my-custom-widget',
    'url',        '<public_url>',
    'bgColor',    '#0f172a',
    'textColor',  '#ffffff',
    'animation',  'fadeIn',
    'params',     jsonb_build_object(
      'title', '預設標題'
    ),
    'paramsSchema', '[
      {"key":"title","type":"text","label":"Title","label_zh":"標題","default":"預設標題"}
    ]'::jsonb
  ),
  100,           -- sort_order
  auth.uid()     -- created_by（或填入管理員 UUID）
);
```

### 方式二：第三方開發者透過 App Store 申請

詳見《SignCMS 第三方應用整合技術文件》。審核通過後平台自動建立 `external` scope Widget。

### 方式三：組織自建 Widget（`user` scope）

透過管理員介面建立，`org_id` 綁定為該組織，只在該組織的 Content Studio 顯示。

---

## 9. 欄位速查表

### 9.1 WidgetConfig 全欄位

| 欄位 | 型別 | 適用 widgetType | 說明 |
|---|---|---|---|
| `widgetType` | string | 全部 | Widget 類型識別碼 |
| `url` | string | HTML-based | HTML 入口 URL |
| `bgColor` | string | 大部分 | 背景色（CSS hex 或 `"transparent"`）|
| `textColor` | string | 大部分 | 主文字色 |
| `animation` | string | 大部分 | 進場動畫 |
| `fontSize` | string | clock/date/marquee/countdown | 字型大小等級 |
| `clockStyle` | string | clock | `"digital"` / `"analog"` |
| `format` | string | clock / date | dayjs 格式字串 |
| `timezone` | string | clock / date | IANA 時區 |
| `showDate` | boolean | clock | 顯示日期 |
| `text` | string | marquee | 跑馬燈文字 |
| `speed` | string | marquee | `"slow"` / `"normal"` / `"fast"` |
| `qrcodeContent` | string | qrcode | QR Code 內容 |
| `qrcodeSize` | number | qrcode | 像素大小（80–400）|
| `countdownTitle` | string | countdown | 標題文字 |
| `targetDate` | string | countdown | 目標時間（ISO 8601）|
| `youtubeUrl` | string | youtube | YouTube 網址 |
| `youtubeMuted` | boolean | youtube | 靜音 |
| `youtubeMuteBgm` | boolean | youtube | 靜音時停止背景音樂 |
| `youtubeVolume` | number | youtube | 音量 0–100 |
| `streamUrl` | string | stream | 串流 URL |
| `streamMuted` | boolean | stream | 靜音 |
| `streamFit` | string | stream | `"cover"` / `"contain"` / `"fill"` |
| `streamProtocol` | string | stream | `"hls"` / `"rtsp"` |
| `params` | object | HTML-based | 執行期參數值 |
| `paramsSchema` | array | HTML-based | 參數描述（自動渲染表單）|
| `widgetScope` | string | 全部 | 由系統寫入（scope 值）|
| `widgetAppId` | string | external | store_apps UUID |
| `_catalogType` | string | 全部 | 由系統寫入（等同 widgetType）|

### 9.2 ParamDef 欄位

| 欄位 | 型別 | 必填 | 說明 |
|---|---|---|---|
| `key` | string | ✓ | params 物件中的鍵名 |
| `type` | string | ✓ | `text` / `select` / `color` / `toggle` / `number` |
| `label` | string | ✓ | 英文標籤 |
| `label_zh` | string | — | 中文標籤 |
| `default` | any | — | 預設值 |
| `options` | array | select 必填 | `[{value, label, label_zh?}]` |
| `min` | number | — | number 類型的最小值 |
| `max` | number | — | number 類型的最大值 |
| `transparent` | boolean | — | color 類型：是否允許透明選項 |

### 9.3 Scope 說明

| scope | 可見對象 | app_id 欄位 | 說明 |
|---|---|---|---|
| `system` | 所有組織 | null | 平台預設 Widget |
| `app` | 已安裝該 App 的組織 | App slug | 內建應用 Widget（如公告看板）|
| `user` | 僅限該組織 | null（org_id 有值）| 組織自建 Widget |
| `external` | 已安裝 store_app 的組織 | store_app slug | 第三方 App Store Widget |

---

## 變更記錄

| 版本 | 日期 | 說明 |
|---|---|---|
| 1.0 | 2026-05-03 | 初版發布；涵蓋所有內建 widgetType 與外部 Widget 規範 |

---

*此文件由 SignCMS 平台技術團隊維護。如有問題請聯繫 [rainer@bizlution.com](mailto:rainer@bizlution.com)*
