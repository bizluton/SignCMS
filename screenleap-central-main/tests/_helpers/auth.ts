import { expect, type Page } from "@playwright/test";
import { SUPABASE_HOST, AUTH_TOKEN_KEY } from "./constants";

export type UserRole = "systemAdmin" | "orgAdmin" | "csAgent" | "regularUser" | "noOrg";

export interface FakeUserOptions {
  userId: string;
  email: string;
  /** If true, the auth/user endpoint returns this user */
  emailConfirmed?: boolean;
  /** Metadata passed to auth.signUp — mirrors invite flow */
  metadata?: Record<string, string>;
}

/** Build a structurally valid fake JWT (3 base64url parts) so Supabase JS client
 *  doesn't throw "Expected 3 parts in JWT; got 1" when it decodes the token. */
function fakeJwt(userId: string, email: string, expiresAt: number): string {
  const header  = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    sub: userId, email, aud: "authenticated", role: "authenticated",
    exp: expiresAt, iat: Math.floor(Date.now() / 1000),
  })).toString("base64url");
  // 43 chars = 32 zero-bytes in base64url (4*10+3 → passes BASE64URL_REGEX)
  return `${header}.${payload}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
}

export function buildFakeSession(opts: FakeUserOptions) {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  return {
    access_token:  fakeJwt(opts.userId, opts.email, expiresAt),
    refresh_token: fakeJwt(opts.userId, opts.email, expiresAt + 86_400),
    expires_in: 3600,
    expires_at: expiresAt,
    token_type: "bearer",
    user: {
      id: opts.userId,
      aud: "authenticated",
      role: "authenticated",
      email: opts.email,
      email_confirmed_at: opts.emailConfirmed !== false ? new Date().toISOString() : null,
      phone: "",
      confirmed_at: new Date().toISOString(),
      last_sign_in_at: new Date().toISOString(),
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: opts.metadata ?? {},
      identities: [{ id: opts.userId, provider: "email" }],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };
}

export interface MockOptions {
  userId: string;
  email: string;
  /** Roles in user_roles table */
  roles?: string[];
  /** Whether user is a system admin */
  isSystemAdmin?: boolean;
  /** Whether user is an active CS agent */
  isCsAgent?: boolean;
  /** Whether user has org membership (team_members row) */
  hasOrg?: boolean;
  /** Language to seed in localStorage */
  lang?: "zh" | "en" | "ja";
}

/**
 * Seed localStorage with a valid Supabase session and route all
 * Supabase API calls to in-memory mock responses.
 */
export async function setupAuthMocks(page: Page, opts: MockOptions) {
  const session = buildFakeSession({ userId: opts.userId, email: opts.email });

  // --- Auth endpoints ---
  await page.route(`**/${SUPABASE_HOST}/auth/v1/user**`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session.user) }),
  );
  await page.route(`**/${SUPABASE_HOST}/auth/v1/token**`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) }),
  );

  // --- Profiles ---
  await page.route(`**/${SUPABASE_HOST}/rest/v1/profiles**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": "0-1/1" },
      body: JSON.stringify([{ user_id: opts.userId, display_name: "Test User", preferred_lang: opts.lang ?? "zh" }]),
    }),
  );

  // --- user_roles ---
  const roles = opts.roles ?? [];
  await page.route(`**/${SUPABASE_HOST}/rest/v1/user_roles**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(roles.map((r) => ({ role: r, user_id: opts.userId }))),
    }),
  );

  // --- system_admins ---
  await page.route(`**/${SUPABASE_HOST}/rest/v1/system_admins**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: opts.isSystemAdmin
        ? JSON.stringify([{ user_id: opts.userId }])
        : JSON.stringify([]),
    }),
  );

  // --- cs_agents ---
  await page.route(`**/${SUPABASE_HOST}/rest/v1/cs_agents**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: opts.isCsAgent
        ? JSON.stringify([{ id: "cs-agent-id", user_id: opts.userId, status: "active" }])
        : JSON.stringify([]),
    }),
  );

  // --- team_members (org membership) ---
  await page.route(`**/${SUPABASE_HOST}/rest/v1/team_members**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": opts.hasOrg ? "0-1/1" : "0-0/0" },
      body: opts.hasOrg
        ? JSON.stringify([{ team_id: "team-001", user_id: opts.userId }])
        : JSON.stringify([]),
    }),
  );

  // --- organizations ---
  await page.route(`**/${SUPABASE_HOST}/rest/v1/organizations**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: "org-001", name: "Test Org", plan_tier: "business" }]),
    }),
  );

  // Seed session into localStorage before the page loads
  await page.addInitScript(
    ([tokenKey, sessionJson, lang]) => {
      localStorage.setItem(tokenKey as string, JSON.stringify(JSON.parse(sessionJson as string)));
      localStorage.setItem("signcms_remember_me", "true");
      if (lang) localStorage.setItem("signboard-lang", lang as string);
    },
    [AUTH_TOKEN_KEY, JSON.stringify(session), opts.lang ?? "zh"] as const,
  );
}

/**
 * Helper: fill and submit the sign-in form.
 */
export async function fillSignIn(page: Page, email: string, password: string) {
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.locator('button[type="submit"]').click();
}

/**
 * Helper: fill and submit the sign-up form.
 */
export async function fillSignUp(
  page: Page,
  opts: { displayName: string; email: string; password: string; confirmPassword?: string },
) {
  await page.locator("#displayName").fill(opts.displayName);
  await page.locator("#email").fill(opts.email);
  await page.locator("#password").fill(opts.password);
  await page.locator("#confirmPassword").fill(opts.confirmPassword ?? opts.password);
  await page.locator('button[type="submit"]').click();
}

/**
 * Mock a Supabase signInWithPassword response.
 * Call BEFORE navigating to /auth.
 */
export async function mockSignInSuccess(page: Page, userId: string, email: string) {
  const session = buildFakeSession({ userId, email });
  await page.route(`**/${SUPABASE_HOST}/auth/v1/token?grant_type=password**`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) }),
  );
}

export async function mockSignInFailure(page: Page, message = "Invalid login credentials") {
  await page.route(`**/${SUPABASE_HOST}/auth/v1/token?grant_type=password**`, (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: "invalid_grant", error_description: message }),
    }),
  );
}

export async function mockSignUpSuccess(page: Page, userId: string, email: string) {
  const session = buildFakeSession({ userId, email });
  await page.route(`**/${SUPABASE_HOST}/auth/v1/signup**`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) }),
  );
}

export async function mockSignUpEmailExists(page: Page, email: string) {
  // Supabase anti-enumeration: returns 200 with empty identities
  const session = buildFakeSession({ userId: "dummy-id", email });
  session.user.identities = [];
  await page.route(`**/${SUPABASE_HOST}/auth/v1/signup**`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) }),
  );
}

export async function clearLoginLockStorage(page: Page) {
  await page.addInitScript(() => {
    localStorage.removeItem("signcms_login_lock");
    localStorage.removeItem("signcms_login_fails");
  });
}
