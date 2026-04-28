# Project Memory

## Core
- SignCMS Enterprise. SaaS style. Dark mode uses `logo-light.png`, light mode uses `logo.png`.
- 3-tier auth (Org -> Team -> User). Strict RLS via `org_id` isolates tenant data.
- Media is stored as Base64 in DB. Uploads MUST use Supabase Edge Function (50MB max).
- i18n (zh, en, ja). All UI translated. Tooltip keys MUST start with `tip`.
- Dashboard relies on 30s auto-refresh for real-time data.

## Memories
- [Branding](mem://style/branding) — System name, logo theme logic, and specific component heights
- [i18n & Localization](mem://style/i18n-localization) — Language support and tooltip translation key requirements
- [Database & Persistence](mem://technical/database-persistence) — Media storage constraints and Supabase Edge Function usage
- [Multi-Tenancy](mem://auth/multi-tenancy) — Org/Team/User hierarchy and RLS data isolation
- [Content Studio](mem://features/content-studio) — Overlay blocks, content picker features, and canvas ratios
- [Widgets](mem://features/widgets) — Supported dynamic HTML widgets and configurations
- [Playlist Scheduling](mem://features/playlist-scheduling) — Scheduling logic and auto-duration calculation for design projects
- [Screen Management](mem://features/screen-management) — Device grouping, firmware tracking, and fallback behaviors
- [Media Library](mem://features/media-library) — Asset protection and strict usage reference checking
- [Publishing Center](mem://features/publishing-center) — Publishing modes and emergency broadcast workflow
- [System Logs](mem://features/system-logs) — Audit trail details, color coding, and playback exports
- [Audit Log Events](mem://features/audit-log-events) — Structured event_code + event_params catalogue for screen_logs i18n; how to add new events
- [Activity Log Events](mem://features/activity-log-events) — Structured action_code + action_params catalogue for activity_logs (admin audit) i18n; how to add new events
- [License Management](mem://features/license-management) — Org licensing with trial, codes, expiry reminders, and access control
