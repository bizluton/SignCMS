---
name: Permission Model
description: Four-tier permission model - system admin, org_admin, cs_agent, user
type: feature
---
## Roles
- **System admin** (hardcoded UUID): full access to everything
- **org_admin** (user_roles enum): manage own org users/teams/invitations, access /admin (org-scoped), NO customer service access
- **active cs_agent** (cs_agents table): access /customer-service and all CS sub-pages, NO admin access
- **user**: basic features only

## Route Guards
- `AdminRoute`: admin OR org_admin
- `CSRoute`: system admin OR active cs_agent
- `ProtectedRoute`: any authenticated user

## Key Functions
- `is_active_cs_agent(_user_id)`: checks cs_agents table
- `is_org_admin(_user_id)`: checks user_roles table
- `has_role(_user_id, _role)`: checks user_roles table