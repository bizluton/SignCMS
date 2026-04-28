import { expect, type Page } from "@playwright/test";

/**
 * Shared helpers for onboarding e2e tests.
 * Mocks Supabase auth/REST so a logged-in user with NO organization lands
 * on /onboarding, and pre-seeds localStorage with a fake session + language.
 */

export const SUPABASE_HOST = "pgbpmgqxtkaheqcmgwwj.supabase.co";
export const AUTH_TOKEN_KEY = "sb-pgbpmgqxtkaheqcmgwwj-auth-token";

export type Lang = "zh" | "en" | "ja";

export const FORBIDDEN_ORG_WORDS = ["公司", "会社", "會社", "company", "Company"];

export interface FakeSessionOptions {
  userId?: string;
  email?: string;
}

export function buildFakeSession(opts: FakeSessionOptions = {}) {
  const userId = opts.userId ?? "00000000-0000-4000-8000-000000000001";
  const email = opts.email ?? "e2e-onboarding@example.com";
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  return {
    access_token: "fake-access-token",
    refresh_token: "fake-refresh-token",
    expires_in: 3600,
    expires_at: expiresAt,
    token_type: "bearer",
    user: {
      id: userId,
      aud: "authenticated",
      role: "authenticated",
      email,
      email_confirmed_at: new Date().toISOString(),
      phone: "",
      confirmed_at: new Date().toISOString(),
      last_sign_in_at: new Date().toISOString(),
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {},
      identities: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };
}

export interface SetupMocksOptions extends FakeSessionOptions {
  /** Stub the bootstrap_user_organization RPC. Defaults to false (only some tests need it). */
  stubBootstrapRpc?: boolean;
}

export async function setupOnboardingMocks(
  page: Page,
  lang: Lang,
  opts: SetupMocksOptions = {},
) {
  await page.route(`**/${SUPABASE_HOST}/auth/v1/user**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildFakeSession(opts).user),
    }),
  );
  await page.route(`**/${SUPABASE_HOST}/rest/v1/team_members**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": "0-0/0" },
      body: "[]",
    }),
  );
  await page.route(`**/${SUPABASE_HOST}/rest/v1/profiles**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": "0-0/0" },
      body: "[]",
    }),
  );

  if (opts.stubBootstrapRpc) {
    await page.route(
      `**/${SUPABASE_HOST}/rest/v1/rpc/bootstrap_user_organization**`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: false, error: "invalid_name" }),
        }),
    );
  }

  await page.addInitScript(
    ([tokenKey, sessionJson, langValue]) => {
      const session = JSON.parse(sessionJson as string);
      localStorage.setItem(tokenKey as string, JSON.stringify(session));
      localStorage.setItem("signcms_remember_me", "true");
      localStorage.setItem("signboard-lang", langValue as string);
      sessionStorage.setItem("signcms_session_active", "true");
    },
    [AUTH_TOKEN_KEY, JSON.stringify(buildFakeSession(opts)), lang] as const,
  );
}

/**
 * Navigate to /onboarding and wait for the create-tab to render.
 * The page first shows a Loader2 while it checks team_members; once that
 * resolves to [] the form renders.
 */
export async function gotoOnboarding(page: Page) {
  await page.goto("/onboarding");
  await expect(page.getByRole("tab", { name: /Create|建立|新規/ })).toBeVisible({
    timeout: 10_000,
  });
}
