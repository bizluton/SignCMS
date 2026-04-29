# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Layout

The actual application lives inside the `screenleap-central-main/` subdirectory. All commands below must be run from that directory.

```
SignCMS/
├── screenleap-central-main/   ← main project (work here)
│   ├── src/
│   │   ├── components/        ← feature components + shadcn/ui primitives (src/components/ui/)
│   │   ├── contexts/          ← React contexts (auth, org, language, profiles, installed-apps)
│   │   ├── hooks/             ← custom hooks, many wrapping Supabase queries
│   │   ├── lib/               ← pure logic, loggers, helpers
│   │   ├── pages/             ← top-level route components
│   │   └── integrations/supabase/  ← auto-generated client + DB types
│   ├── supabase/
│   │   ├── functions/         ← Deno edge functions
│   │   └── migrations/        ← SQL migration files
│   └── tests/                 ← Playwright e2e tests
└── .github/workflows/deploy.yml  ← staging/production CI deploy
```

## Commands

From `screenleap-central-main/`:

```bash
npm run dev            # dev server on :8080
npm run build          # production build
npm run lint           # ESLint
npm run lint:activity-log  # detect legacy logActivity calls (see Logging section)
npm run lint:screen-log    # detect legacy logScreenEvent calls
npm test               # vitest unit tests (run once)
npm run test:watch     # vitest interactive watch mode
npm run test:e2e       # Playwright e2e (requires dev server)
npm run commit         # interactive Conventional Commits CLI (commitizen, prompts in zh-TW)
```

Run a single unit test file:
```bash
npx vitest run src/lib/mediaFormat.test.ts
```

Unit test files live in `src/` alongside source (e.g. `src/lib/inviteToken.test.ts`); Playwright tests live in `tests/`.

## Architecture

### Tech Stack

React 18 + TypeScript, Vite + SWC, Tailwind CSS, shadcn/ui (Radix primitives), TanStack Query v5, React Router v6, Supabase (auth + Postgres + storage + edge functions).

### Context Layer (Provider order matters)

`App.tsx` nests providers in this order (inner-most first): `InstalledAppsProvider → ActiveOrgProvider → AuthProvider → ProfilesProvider`. Key contexts:

- **`AuthContext`** – Supabase session, `user`, `signOut`. Handles remember-me vs session-only persistence via `localStorage.signcms_remember_me`.
- **`ActiveOrgContext`** – persists the selected org ID in `localStorage.signcms_active_org_id`. Almost every data hook reads this.
- **`LanguageProvider`** – app language (`zh` / `en` / `ja`). Translations are a flat key→`{zh,en,ja}` record in `src/contexts/translations.ts`. Use the `t(key)` function from `useLanguage()` everywhere.
- **`InstalledAppsContext`** – per-org localStorage for the App Store toggle state.

### Route Guards

Three guard components wrap routes in `App.tsx`:
- `ProtectedRoute` – must be authenticated + have at least one `team_members` row (org membership). Redirects to `/onboarding` when no org.
- `AdminRoute` – requires `user_roles.role` of `admin` or `org_admin`.
- `CSRoute` – requires `is_system_admin` flag or active `cs_agents` row.
- `SystemAdminRoute` – requires `is_system_admin` only.

Role state comes from `useUserRole()` (queries `user_roles` and `cs_agents`) and `useIsSystemAdmin()`.

### Data Fetching Pattern

TanStack Query is configured with `staleTime: 5min`, `gcTime: 10min`, `refetchOnWindowFocus: false`, `refetchOnMount: false` — pages feel instant on tab switch. Most feature hooks (e.g. `useChannels`, `useWidgets`, `useKnowledgeFiles`) follow the pattern: read `activeOrgId` from `ActiveOrgContext`, query Supabase, return `{ data, loading, refetch }`.

Import the Supabase client as:
```ts
import { supabase } from "@/integrations/supabase/client";
```

The generated DB types are in `src/integrations/supabase/types.ts`. When Supabase's type inference is too strict for dynamic table access, cast with `(supabase as any).from(...)`.

### Plan / License Limits

`useOrgPlan()` (hook) exposes `tier`, `limits`, and `usage` for the active org. `PLAN_LIMITS` in `src/hooks/useOrgPlan.ts` defines per-tier caps (screens, media bytes, apps). Plan-limit Postgres exceptions are translated with `detectPlanLimitKind` / `translatePlanLimitError` from `src/lib/planLimitError.ts`.

### Logging System

Two structured loggers must be used for all auditable operations:

**Activity log** (`src/lib/activityLogger.ts`) — records user actions to the `activity_logs` table. Always use `actionParams` (structured, i18n-renderable) rather than the legacy `detail: buildDetail(...)` form. The `lint:activity-log` script enforces this.

```ts
await logActivity({
  action: "create_schedule",
  category: "schedule",
  targetId: id, targetName: name,
  actionParams: { name, screenCount: 3 },
  orgId: activeOrgId,
});
```

**Screen log** (`src/lib/screenLogger.ts`) — records device-level events to `screen_logs`. Use structured `eventCode` + `eventParams` (templates in `src/lib/screenLogI18n.ts`) rather than plain `eventTitle`/`eventDetail`. The `lint:screen-log` script enforces this.

Valid `category` values for activity logs: `auth`, `screen`, `media`, `schedule`, `publish`, `admin`, `studio`, `customer-service`.

### i18n Conventions

All user-facing strings must be added to `src/contexts/translations.ts` as a trilingual `{ zh, en, ja }` object and accessed via `t("key")`. Do not hardcode UI strings. Activity-log and screen-log i18n templates live in `src/lib/activityLogI18n.ts` and `src/lib/screenLogI18n.ts` respectively.

### Content Studio

Studio design data lives in `src/lib/studioPresets.ts` (layout / template definitions) and `src/lib/studioData.ts` (cache + lookup helpers). Designs are stored as zone arrays in Supabase; the first zone with `_meta: true` is a metadata carrier (BGM, etc.) not rendered visually.

### Smart Triggers

`src/lib/smartTriggerResolver.ts` resolves the effective set of trigger rules for a screen: org-scoped rules minus per-screen overrides, unioned with screen-specific rules. The `smart-trigger-webhook` edge function handles incoming webhook payloads.

### Edge Functions

All Deno edge functions are under `supabase/functions/`. Shared utilities (CORS headers, auth helpers) are in `supabase/functions/_shared/`.

## Commit Conventions

This project enforces Conventional Commits via husky + commitlint on every commit. Use `npm run commit` for the interactive Chinese-prompt CLI.

**Format:** `<type>(<scope>): <subject>` (subject: 8–72 chars, no trailing period)

**Valid scopes** (defined in `.commit-scopes.cjs`, single source of truth):  
`auth`, `media`, `screens`, `schedules`, `publishing`, `content-studio`, `knowledge`, `cs`, `admin`, `iot`, `i18n`, `ui`, `db`, `edge-fn`, `ci`, `deps`, `docs`

To add a new scope, edit `.commit-scopes.cjs` only — commitlint, commitizen, and the PR title workflow all read from it.

**Semver impact:** `fix:` → patch, `feat:` → minor, `feat!:` / `BREAKING CHANGE:` footer → major. `chore`, `docs`, `ci`, `refactor`, `test` do not trigger a release.

## CI / CD

- `lint.yml` runs on every push to `main` and all PRs: ESLint, activity-log lint, screen-log lint, vitest, and a Vite production build.
- `pr-title.yml` validates PR titles against Conventional Commits.
- `release-please.yml` auto-manages the Release PR and changelog on `main`.
- `deploy.yml` (repo root `.github/`) builds and deploys: staging on push to `master`, production on version tags (`v*.*.*`).

## Environment

Required env vars (already populated in `screenleap-central-main/.env` for local dev):

```
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_BFF_URL
```

The dev server runs on `http://localhost:8080`. Playwright e2e tests point at this base URL and require the dev server to be running.
