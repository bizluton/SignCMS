# Widget 技術規範 (Widget Technical Specification)

> 版本：**v1.0**  
> 適用範圍：System Widget 定義、Catalog Widget 管理、新增 Widget 類型的完整 SOP。

---

## 1. 概念與分類 (Concepts & Scopes)

Widget 依來源分三個 scope：

| Scope | ID 前綴 | 儲存位置 | 說明 |
|-------|---------|---------|------|
| `system` | `sys-widget-{type}` | `src/lib/systemWidgets.ts`（不入 DB） | 內建，唯讀，每個 org 皆可見 |
| `app` | DB UUID | `widgets` table，`scope = 'app'` | App Store 應用程式附帶 |
| `user` | `cat-widget-{uuid}`（前端虛擬） | `widgets` table，`scope = 'user'` | 組織自建，可刪除 |

前端透過 `useWidgets()` hook（`src/hooks/useWidgets.ts`）取得 DB 中的 catalog widget，再由 `getSystemWidgetMediaRows()` / `getSystemWidgetStudioRows()`（`src/lib/systemWidgets.ts`）注入 system widget 虛擬列，最終合併為統一的清單。

---

## 2. 資料結構 (Data Structures)

### 2.1 SystemWidgetConfig

用於 system widget 定義，亦是 `widget://` URL scheme 的序列化格式（MediaPage、ContentStudio）。

```ts
// src/lib/systemWidgets.ts
interface SystemWidgetConfig {
  widgetType: SystemWidgetSubType;   // 必填，決定渲染分支

  // ── 通用外觀 ──────────────────────────────
  bgColor?: string;                  // 背景色，hex，預設 "#1a1a2e"
  textColor?: string;                // 前景色，hex，預設 "#ffffff"
  fontSize?: "small" | "medium" | "large" | "xlarge";  // 預設 "medium"
  animation?: "none" | "fadeIn" | "slideUp" | "bounce" | "zoomIn" | "flipIn"; // 預設 "none"

  // ── clock ─────────────────────────────────
  clockStyle?: "digital" | "analog"; // 預設 "digital"
  format?: "12" | "24";              // 預設 "24"
  showDate?: boolean;                // 預設 true
  timezone?: string;                 // IANA timezone，預設系統時區

  // ── marquee ───────────────────────────────
  text?: string;
  speed?: "slow" | "normal" | "fast"; // 預設 "normal"

  // ── webpage ───────────────────────────────
  url?: string;                      // 完整 URL，含 https://

  // ── qrcode ────────────────────────────────
  qrcodeContent?: string;            // URL 或任意文字
  qrcodeSize?: number;               // px，預設 128，上限 512

  // ── countdown ─────────────────────────────
  targetDate?: string;               // ISO 8601，例："2030-01-01T00:00:00"
  countdownTitle?: string;           // 顯示於計時器上方的標題

  // ── youtube ───────────────────────────────
  youtubeUrl?: string;               // 完整 YouTube URL（MediaPage 表單輸入）
  // youtubeId 由 MediaPage 解析後存入 config（DesignStage 讀取 youtubeId 渲染）

  // ── weather ───────────────────────────────
  city?: string;                     // 城市英文名，例："Taipei"
}
```

> **注意**：`DesignStage.tsx` 的 `WidgetRender` 讀取 `config.youtubeId`（非 `youtubeUrl`），因此 MediaPage 在儲存前必須將 YouTube URL 解析為 video ID 並以 `youtubeId` 寫入 config。

### 2.2 DB widgets Row

Supabase table `widgets`（型別定義：`src/integrations/supabase/types.ts`）：

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | `uuid` | 主鍵 |
| `scope` | `"system" \| "app" \| "user"` | Widget 分類 |
| `name` | `text` | 英文預設名稱 |
| `name_i18n` | `jsonb` | `{ zh, en, ja }` 三語翻譯 |
| `widget_type` | `text` | widget slug，例：`"clock"` |
| `config` | `jsonb` | 同 `SystemWidgetConfig` |
| `thumbnail` | `text` | base64 data URL 或空字串 |
| `app_id` | `uuid?` | app-scope 時填入 |
| `org_id` | `uuid?` | user-scope 時填入 |
| `sort_order` | `int4` | 同類型內顯示順序 |
| `created_by` | `uuid` | 建立者 user ID |

### 2.3 WidgetRow vs CatalogWidget

`useWidgets()` 內部使用完整的 `WidgetRow`（含 `created_by`、`updated_at`）；對外暴露的 `CatalogWidget` 已移除 PII 欄位，供 MediaPage、ContentStudio 使用。

```ts
// src/hooks/useWidgets.ts
interface CatalogWidget {
  id: string;
  scope: WidgetScope;
  name: string;         // 已依 useLanguage() 選取語系
  config: Record<string, unknown>;
  thumbnail: string;
  app_id: string | null;
  org_id: string | null;
  created_at: string;
}
```

---

## 3. 命名規則 (Naming Conventions)

| 項目 | 規則 | 範例 |
|------|------|------|
| Widget type slug | 全小寫，無分隔符 | `clock` `qrcode` `countdown` |
| System widget ID | `sys-widget-{slug}` | `sys-widget-clock` |
| Catalog widget ID（前端） | `cat-widget-{uuid}` | `cat-widget-3fa...` |
| i18n nameKey | `widget{PascalCase}` | `widgetClock` `widgetQrcode` |
| i18n descKey | `widget{PascalCase}Desc` | `widgetClockDesc` |
| Lucide icon 對應 | 語意最接近的圖示 | `clock → Clock`, `qrcode → QrCode` |

---

## 4. 縮圖規格 (Thumbnail Spec)

| 項目 | 規格 |
|------|------|
| 格式 | PNG（首選）/ JPG / WebP |
| 尺寸 | **320 × 180 px**（16:9） |
| 大小上限 | **200 KB**（`THUMBNAIL_MAX_BYTES = 200 * 1024`，`WidgetManagement.tsx:48`） |
| 儲存 | base64 data URL，存入 `widgets.thumbnail` |
| 無縮圖時 | 自動顯示深色漸層（`from-slate-800 to-slate-900`）+ widget 類型 Lucide icon |

---

## 5. i18n 規格 (i18n Spec)

- 三語必填：`zh`（繁中）、`en`（英文）、`ja`（日文）
- nameKey 加入 `src/contexts/translations.ts`（flat key-value 格式）
- Fallback 順序：用戶語系 → `en` → `zh`
- 範例：

```ts
// src/contexts/translations.ts
widgetClock:     { zh: "時鐘",    en: "Clock",    ja: "時計" },
widgetClockDesc: { zh: "顯示即時時鐘", en: "Display real-time clock", ja: "リアルタイム時計を表示" },
```

---

## 6. ZIP 匯入 Manifest 格式

Admin → Widget Management 支援從 `.zip` 匯入 widget：

```json
{
  "name": "My Widget",
  "widget_type": "clock",
  "name_i18n": { "zh": "我的時鐘", "en": "My Clock", "ja": "マイ時計" },
  "config": { "widgetType": "clock", "clockStyle": "digital" },
  "html_file": "widget.html",
  "params": [
    { "key": "title", "label": "Title", "type": "text", "default": "Hello" }
  ],
  "sort_order": 0
}
```

ZIP 內可包含：
- `manifest.json`（必填，位於根目錄或一層子目錄）
- `thumbnail.png` / `thumbnail.jpg` / `thumbnail.webp`（選填，自動讀取）
- `widget.html`（HTML widget 時必填，路徑對應 `html_file`）

---

## 7. 新增 Widget 類型 SOP

新增一個 widget 類型需依序修改以下 **7 個位置**：

### Step 1 — 型別與系統定義 (`src/lib/systemWidgets.ts`)

1. 在 `SystemWidgetSubType` union 加入新 slug：
   ```ts
   export type SystemWidgetSubType =
     | "date" | "clock" | "webpage" | "marquee"
     | "qrcode" | "countdown" | "youtube" | "weather"
     | "newtype";  // ← 新增
   ```
2. 在 `SYSTEM_WIDGETS` 陣列加入定義：
   ```ts
   {
     id: "sys-widget-newtype",
     name: "New Type",
     nameKey: "widgetNewtype",
     config: {
       widgetType: "newtype",
       bgColor: "#1e293b",
       textColor: "#ffffff",
       fontSize: "large",
       animation: "fadeIn",
       // ...類型專屬欄位預設值
     },
   },
   ```

### Step 2 — i18n (`src/contexts/translations.ts`)

加入 `widgetNewtype` 和 `widgetNewtypeDesc` 兩個 key：
```ts
widgetNewtype:     { zh: "中文名", en: "English Name", ja: "日本語名" },
widgetNewtypeDesc: { zh: "說明文字", en: "Description", ja: "説明" },
```

### Step 3 — 執行期渲染 (`src/components/player/DesignStage.tsx`)

在 `WidgetRender` 函式的 if/else 分支中加入新渲染邏輯（位於 fallback `return` 之前）：
```tsx
if (config.widgetType === "newtype") {
  return (
    <div className="w-full h-full flex items-center justify-center"
         style={{ background: bg, color: fg }}>
      {/* 渲染邏輯 */}
    </div>
  );
}
```

時間相關 widget 需在 `useEffect` 的 widget type 條件中加入 `"newtype"` 以啟動 1s interval。

### Step 4 — 縮圖預覽與設定表單 (`src/pages/MediaPage.tsx`)

1. **`WidgetPreviewCard`**（~L218）：加入新類型的縮圖預覽分支。
2. **`defaultWidgetConfig`**（~L195）：補齊新欄位的預設值。
3. **Widget picker 自訂建立 tab**（~L2445）：
   - 加入類型選擇按鈕（icon + 名稱）
   - 加入對應的設定表單欄位

### Step 5 — Admin 管理介面 (`src/components/admin/WidgetManagement.tsx`)

```ts
// 在 WIDGET_TYPES 陣列加入 slug
const WIDGET_TYPES = [
  "clock", "date", "webpage", "marquee",
  "qrcode", "countdown", "youtube", "weather",
  "newtype",  // ← 新增
];

// 在 WIDGET_ICONS map 加入對應 Lucide icon
const WIDGET_ICONS = {
  // ...現有
  newtype: SomeLucideIcon,
};
```

### Step 6 — 縮圖

準備 320 × 180 px PNG，< 200 KB。可透過 Admin → Widget Management → 匯入 ZIP 時一併上傳。

### Step 7 — 測試驗證

| 測試點 | 確認方式 |
|--------|---------|
| Media Library 顯示新 widget | 在素材庫「Widget」tab 確認出現新類型卡片 |
| Widget picker 設定表單 | 點擊「＋新增 Widget」→「自訂建立」tab，確認能選取並設定 |
| Content Studio 預覽 | 在 Studio zone 選取新 widget，確認縮圖預覽正確渲染 |
| DesignStage 播放器 | 將含新 widget 的設計加入排程播放，確認全螢幕渲染正確 |
| 三語 i18n | 切換語系為 zh / en / ja，確認 widget 名稱正確顯示 |

---

## 8. 現有 Widget 類型參考

| Slug | nameKey | 說明 | 時間更新 | 類型專屬欄位 |
|------|---------|------|----------|-------------|
| `clock` | `widgetClock` | 數位/類比時鐘 | ✓ 1s | `clockStyle` `format` `showDate` `timezone` |
| `date` | `widgetDate` | 當前日期 | ✓ 1s | — |
| `webpage` | `widgetWebpage` | 嵌入網頁（iframe srcDoc） | — | `url` `paramsSchema` `params` |
| `marquee` | `widgetMarquee` | 滾動文字 | — | `text` `speed` |
| `qrcode` | `widgetQrcode` | QR Code（qrcode.react） | — | `qrcodeContent` `qrcodeSize` |
| `countdown` | `widgetCountdown` | 倒數計時 | ✓ 1s | `countdownTitle` `targetDate` |
| `youtube` | `widgetYoutube` | YouTube 嵌入（nocookie） | — | `youtubeId`（儲存時由 URL 解析） |
| `weather` | `widgetWeather` | 天氣預報 | — | `city` |
