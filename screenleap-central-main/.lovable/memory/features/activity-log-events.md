---
name: Activity log events
description: Structured action_code + action_params catalogue for activity_logs (admin audit trail i18n)
type: feature
---

# Activity Log Event Catalogue

`activity_logs` rows use **structured i18n** via two columns:

- `action_code` (text) — stable identifier, e.g. `change_org_plan_tier`
  (mirrors the legacy `action` column on every write)
- `action_params` (jsonb) — placeholder values, e.g. `{ "from": "starter", "to": "business" }`

Display layer renders them through `localizeActivityDetail(row, language)` in
`src/lib/activityLogI18n.ts`, which fills `{paramName}` placeholders into
language-specific templates from `DETAIL_TPL`.

Legacy columns `action` (often the same code; sometimes Chinese for very old
rows) and `detail` (plain text or `{tpl, params}` JSON) are **kept on every
write** so:
- historical rows without `action_code` still render via `localizeDetail`
- server-side `LIKE` search on `detail` keeps working for new rows too

---

## Writing a log

Use `logActivity` from `src/lib/activityLogger.ts`. Prefer the new
`actionParams` field; do NOT pass `detail: buildDetail(...)` for new code.

```ts
logActivity({
  action: "change_org_plan_tier",          // stored as both `action` AND `action_code`
  category: "admin",
  targetName: orgName,
  targetId: orgId,
  actionParams: { from: oldTier, to: newTier },
});
```

The logger automatically:
- writes `action_code = action`
- writes `action_params = actionParams ?? {}`
- writes `detail = JSON.stringify({ tpl: action, params: actionParams })`
  for back-compat search (only when `detail` is not explicitly provided)

If you have a literal-text detail (e.g. localized via `t(...)` inside the call
site), keep passing `detail` — that path is still supported and bypasses the
JSON envelope. It just won't be language-switched at display time.

---

## Adding a new event

1. Pick an `action_code` (a.k.a. `action`). Conventions:
   - English snake_case (`delete_user`, `reset_password_email`)
   - Or `namespace.action` (`delegation.grant`, `delegation.end`)
2. Add the verb label to `ACTION` in `src/lib/activityLogI18n.ts`
   (`{ zh, en, ja }`).
3. If the row needs a parameterized detail line:
   - Add a template to `DETAIL_TPL` keyed by either the action code itself
     (zero-config) or a separate tpl name
   - If the tpl name differs from the action code, register the mapping in
     `ACTION_CODE_TO_DETAIL_TPL`
4. Add a call site using `logActivity({ action, category, actionParams })`.
5. Pick the right `category` for badge color: `admin` | `auth` | `media` |
   `screen` | `schedule` | `publish` | `studio` | `customer-service`
   (`auth` & `security` show red shield treatment in the UI).

Auto-localized params (handled inside `localizeActivityDetail`):
- `org` → also exposes `{orgClause}` like `（組織：xxx）` / ` (Org: xxx)`
- `from` / `to` / `tier` → run through `PLAN_TIER` map if value matches a tier

---

## Current catalogue (with params)

| action_code | category | actionParams | Used by |
|---|---|---|---|
| `sign_in` | `auth` | `email` | AuthPage login |
| `sign_out` | `auth` | (none) | AuthContext signOut |
| `delete_user` | `admin` | (none) | AdminPage delete |
| `reset_password_email` | `admin` | (none, uses `detail = t(...)`) | AdminPage reset email |
| `reset_password_manual` | `admin` | (none, uses `detail = t(...)`) | AdminPage temp password |
| `change_role` | `admin` | `role` | AdminPage role change |
| `create_org` | `admin` | `tier` | OrgManagement create |
| `edit_org` | `admin` | (none) | OrgManagement edit |
| `delete_org` | `admin` | (none) | OrgManagement delete |
| `change_org_plan_tier` | `admin` | `from, to` | OrgManagement plan tier change |
| `send_invitation` | `admin` | `org` | InvitationManagement send |
| `resend_invitation` | `admin` | `org` | InvitationManagement resend |
| `delete_invitation` | `admin` | (none) | InvitationManagement delete |
| `invite_cs_agent` | `customer-service` | (none) | CSAgentManagement invite |
| `resend_cs_invitation` | `customer-service` | (none) | CSAgentManagement resend |
| `remove_cs_agent` | `customer-service` | (none) | CSAgentManagement delete |
| `create_team` / `edit_team` / `delete_team` | `admin` | (none) | TeamManagement |
| `create_screen` / `edit_screen` / `delete_screen` | `screen` | (none) | ScreensPage |
| `create_schedule` / `edit_schedule` / `delete_schedule` | `schedule` | (none) | SchedulesPage |
| `upload_media` / `delete_media` | `media` | (none) | MediaPage |
| `publish_now` | `publish` | `count` | PublishingCenter immediate |
| `publish_scheduled` | `publish` | `count` | PublishingCenter scheduled |
| `delegation.grant` | `admin` | `scope, expires_at` | DelegationDialog grant |
| `delegation.revoke` | `admin` | (none) | DelegationDialog revoke |
| `delegation.end` | `admin` | (none) | DelegationBanner end-by-grantee |
| `onboarding_create_*` / `onboarding_join_*` | `auth` | varies (org name etc.) | OnboardingPage |

---

## Display surfaces

- **`src/components/admin/ActivityLogPanel.tsx`** — admin audit log page
  (filter, search, infinite scroll, security stat card)
- **`src/components/admin/activity-log/ActivityLogList.tsx`** — list rows
  use `localizeAction` + `localizeCategory` + `localizeActivityDetail`

Search note: search currently does `LIKE` against `target_name`/`detail`/
`display_name`. Because the logger keeps `detail` populated as a JSON envelope
even for new rows, search continues to match (e.g. searching for an email
still hits the `{ "params": { "email": "..." } }` substring).
