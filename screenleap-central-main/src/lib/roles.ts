/**
 * Role string constants.
 *
 * Why this exists: ~24 places across the codebase compare role strings as
 * inline literals ("admin", "org_admin", "cs_agent", "user"). A typo is a
 * silent privilege bug; a rename touches every site. Use the constants
 * below so the compiler enforces the spelling.
 *
 * IMPORTANT: these strings MUST match the values in:
 *   - public.user_roles.role (app_role enum)
 *   - public.team_members.role (text)
 *   - public.cs_agents.status (for "active" only)
 *   - public.delegation_grants.grantee_scope
 *
 * The DB-side enum is authoritative. If you change a name here, update the
 * migration that defines `app_role` too.
 */

// app_role enum values (public.user_roles.role) — global roles.
export const ROLE_ADMIN      = "admin"      as const;
export const ROLE_ORG_ADMIN  = "org_admin"  as const;
export const ROLE_CS_AGENT   = "cs_agent"   as const;
export const ROLE_USER       = "user"       as const;

export type AppRole =
  | typeof ROLE_ADMIN
  | typeof ROLE_ORG_ADMIN
  | typeof ROLE_CS_AGENT
  | typeof ROLE_USER;

// delegation_grants.grantee_scope
export const DELEGATION_SCOPE_ORG_ADMIN = "org_admin" as const;
export const DELEGATION_SCOPE_CS_AGENT  = "cs_agent"  as const;

export type DelegationScope =
  | typeof DELEGATION_SCOPE_ORG_ADMIN
  | typeof DELEGATION_SCOPE_CS_AGENT;

// Helpful predicates — wrap a role Set to keep `.has()` typed.
export function isAdminLike(roles: Set<string>): boolean {
  return roles.has(ROLE_ADMIN) || roles.has(ROLE_ORG_ADMIN);
}

export function isOrgAdmin(roles: Set<string>): boolean {
  return roles.has(ROLE_ORG_ADMIN);
}
