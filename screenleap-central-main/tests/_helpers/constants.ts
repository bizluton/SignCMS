/**
 * Centralised constants for auth e2e tests.
 * The host is derived from VITE_SUPABASE_URL in .env.
 */
export const SUPABASE_HOST = "narhbpojjtnalyfiwxue.supabase.co";
export const AUTH_TOKEN_KEY = `sb-narhbpojjtnalyfiwxue-auth-token`;

export const VALID_UUID = "11111111-2222-4333-8444-555555555555";
export const VALID_UUID_2 = "22222222-3333-4444-5555-666666666666";

// User IDs for each role type
export const USER_IDS = {
  systemAdmin: "aaaaaaaa-0000-4000-8000-000000000001",
  orgAdmin: "bbbbbbbb-0000-4000-8000-000000000002",
  csAgent: "cccccccc-0000-4000-8000-000000000003",
  regularUser: "dddddddd-0000-4000-8000-000000000004",
  noOrg: "eeeeeeee-0000-4000-8000-000000000005",
} as const;

export const TEST_EMAILS = {
  systemAdmin: "sysadmin@test.local",
  orgAdmin: "orgadmin@test.local",
  csAgent: "csagent@test.local",
  regularUser: "user@test.local",
  noOrg: "noorgnewuser@test.local",
} as const;
