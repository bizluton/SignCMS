---
name: License Management
description: Organization licensing with trial, codes, expiry reminders
type: feature
---
## Overview
- Organizations have `license_plan`, `license_expires_at`, `license_reminder_sent` fields
- Default: 試用30日 plan, expires 30 days after creation

## License Codes
- `license_codes` table: code, extend_days, plan_name, status (pending/redeemed)
- System admin generates codes; org_admin redeems via `redeem_license_code()` RPC
- Redemption extends from max(current_expiry, now) + extend_days

## Reminders
- Edge function `license-reminder` runs daily via pg_cron
- Sends notifications at 30/7/1 days before expiry to org_admins
- Tracks sent reminders in `license_reminder_sent` jsonb array

## Access Control
- System admin: full CRUD on license_codes, can change any org expiry
- Org admin: view own org license status, redeem codes
- Regular users: no access to license info
