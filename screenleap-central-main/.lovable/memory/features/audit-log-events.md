---
name: Audit log events
description: Structured event_code + event_params catalogue for screen_logs (audit trail i18n)
type: feature
---

# Audit Log Event Catalogue

`screen_logs` rows use **structured i18n** via two columns:

- `event_code` (text) — stable identifier, e.g. `schedule.updated`
- `event_params` (jsonb) — placeholder values, e.g. `{ "name": "Lobby", "itemCount": 5 }`

Display layer renders them through `renderScreenLog(row, language)` in
`src/lib/screenLogI18n.ts`, which fills `{paramName}` placeholders into
language-specific templates.

Legacy columns `event_title` / `event_detail` (plain text, usually zh) are
**kept on every write** so historical rows without `event_code` still show
something, and so server-side `LIKE` search keeps working.

---

## Writing a log

Use `logScreenEvent` / `logScreenEvents` from `src/lib/screenLogger.ts`. ALWAYS
pass `eventCode` + `eventParams` for new code. Also fill `eventTitle` /
`eventDetail` (Chinese) for back-compat search.

```ts
logScreenEvent({
  screenId, orgId,
  eventType: "schedule",
  eventCode: "schedule.updated",
  eventParams: { name, startTime, endTime, itemCount: items.length },
  eventTitle: "排程已更新",
  eventDetail: `名稱：${name}｜時段：${startTime}-${endTime}｜項目數：${items.length}`,
});
```

---

## Adding a new event

1. Pick a `event_code` in **`namespace.action`** form (lowercase, snake_case for
   action). Namespaces in use: `schedule`, `screen`, `system`.
2. Add a template entry in `src/lib/screenLogI18n.ts` under `EVENTS`:
   - `title.{zh,en,ja}` — short verb phrase, no params
   - `detail.{zh,en,ja}` — optional, may contain `{placeholders}`
3. Add a call site using `logScreenEvent({ eventCode, eventParams, ... })`.
4. Pick the right `eventType` for the row's color/icon in the UI:
   `status` | `config` | `schedule` | `system`.

Missing placeholder values render as `-`. Missing language falls back to `zh`.
Unknown `event_code` falls back to legacy `event_title` / `event_detail`.

---

## Current catalogue

| event_code | eventType | params | Used by |
|---|---|---|---|
| `schedule.created` | `schedule` | `name, startTime, endTime, itemCount` | SchedulesPage create |
| `schedule.updated` | `schedule` | `name, startTime, endTime, itemCount` | SchedulesPage edit |
| `schedule.deleted` | `schedule` | `name` | SchedulesPage delete |
| `schedule.enabled` | `schedule` | `name` | SchedulesPage toggle on |
| `schedule.disabled` | `schedule` | `name` | SchedulesPage toggle off |
| `schedule.published_now` | `schedule` | `scheduleName, scheduledAt` | PublishingCenter immediate publish |
| `schedule.published_scheduled` | `schedule` | `scheduleName, scheduledAt` | PublishingCenter queued publish |
| `screen.created` | `system` | `name, branch` | ScreensPage create |
| `screen.deleted` | `system` | `name` | ScreensPage delete |
| `screen.config_updated` | `config` | `name, branch, location, resolution` | ScreensPage edit |
| `screen.group_renamed` | `config` | `oldName, newName` | ScreensPage rename group (bulk) |
| `screen.group_deleted` | `config` | `oldName` | ScreensPage delete group (bulk) |
| `system.emergency_broadcast` | `system` | `message` | PublishingCenter emergency broadcast |
| `system.restore_normal` | `system` | (none) | PublishingCenter restore |

---

## Display surfaces

- **`src/components/ScreenLogPanel.tsx`** — per-screen sidebar log feed
- **`src/pages/DeviceLogsPage.tsx`** — admin device log page (filter, search,
  Excel export — all use `renderScreenLog`)

Both auto-update when the user switches language; old rows missing
`event_code` continue to display the legacy Chinese text.
