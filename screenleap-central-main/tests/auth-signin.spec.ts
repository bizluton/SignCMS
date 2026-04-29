import { test, expect, type Page } from "@playwright/test";
import {
  setupAuthMocks,
  buildFakeSession,
  fillSignIn,
  clearLoginLockStorage,
} from "./_helpers/auth";
import { SUPABASE_HOST, USER_IDS, TEST_EMAILS } from "./_helpers/constants";

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * Set up all mocks needed for a fresh sign-in flow.
 * Does NOT pre-seed localStorage — we want to test the actual login path.
 */
async function setupSignInFlow(
  page: Page,
  opts: {
    userId: string;
    email: string;
    roles?: string[];
    isSystemAdmin?: boolean;
    isCsAgent?: boolean;
    hasOrg?: boolean;
    signInError?: { status: number; message: string };
  },
) {
  const session = buildFakeSession({ userId: opts.userId, email: opts.email });

  // Token endpoint (password grant)
  await page.route(
    `**/${SUPABASE_HOST}/auth/v1/token?grant_type=password**`,
    (route) => {
      if (opts.signInError) {
        return route.fulfill({
          status: opts.signInError.status,
          contentType: "application/json",
          body: JSON.stringify({
            error: "invalid_grant",
            error_description: opts.signInError.message,
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(session),
      });
    },
  );

  // Auth user check (called by Supabase SDK on init + after sign-in)
  await page.route(`**/${SUPABASE_HOST}/auth/v1/user**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(session.user),
    }),
  );

  const roles = opts.roles ?? [];
  await page.route(`**/${SUPABASE_HOST}/rest/v1/profiles**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": "0-1/1" },
      body: JSON.stringify([
        { user_id: opts.userId, display_name: "Test User", preferred_lang: "zh" },
      ]),
    }),
  );

  await page.route(`**/${SUPABASE_HOST}/rest/v1/user_roles**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(roles.map((r) => ({ role: r, user_id: opts.userId }))),
    }),
  );

  await page.route(`**/${SUPABASE_HOST}/rest/v1/system_admins**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: opts.isSystemAdmin
        ? JSON.stringify([{ user_id: opts.userId }])
        : JSON.stringify([]),
    }),
  );

  await page.route(`**/${SUPABASE_HOST}/rest/v1/cs_agents**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: opts.isCsAgent
        ? JSON.stringify([{ id: "cs-agent-id", user_id: opts.userId, status: "active" }])
        : JSON.stringify([]),
    }),
  );

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

  await page.route(`**/${SUPABASE_HOST}/rest/v1/organizations**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: "org-001", name: "Test Org", plan_tier: "business" }]),
    }),
  );
}

// ── tests ──────────────────────────────────────────────────────────────────

test.describe("Auth page — initial render", () => {
  test.beforeEach(async ({ page }) => {
    await clearLoginLockStorage(page);
  });

  test("shows sign-in form by default", async ({ page }) => {
    await page.route(`**/${SUPABASE_HOST}/**`, (route) => route.fulfill({ status: 200, body: "[]", contentType: "application/json" }));
    await page.goto("/auth");
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    // No displayName or confirmPassword in sign-in mode
    await expect(page.locator("#displayName")).toHaveCount(0);
    await expect(page.locator("#confirmPassword")).toHaveCount(0);
  });

  test("shows sign-up form when ?invite= UUID is provided", async ({ page }) => {
    await page.route(`**/${SUPABASE_HOST}/**`, (route) => route.fulfill({ status: 200, body: "[]", contentType: "application/json" }));
    await page.goto("/auth?invite=11111111-2222-4333-8444-555555555555");
    await expect(page.locator("#displayName")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("#confirmPassword")).toBeVisible();
  });

  test("shows sign-up form when ?cs_agent= is provided", async ({ page }) => {
    await page.route(`**/${SUPABASE_HOST}/**`, (route) => route.fulfill({ status: 200, body: "[]", contentType: "application/json" }));
    await page.goto("/auth?cs_agent=some-agent-id");
    await expect(page.locator("#displayName")).toBeVisible({ timeout: 5_000 });
  });

  test("shows invalid invite banner for malformed invite param", async ({ page }) => {
    await page.route(`**/${SUPABASE_HOST}/**`, (route) => route.fulfill({ status: 200, body: "[]", contentType: "application/json" }));
    await page.goto("/auth?invite=not-a-uuid");
    // Shows sign-in form (no displayName), but invalid invite alert visible
    await expect(page.locator("#displayName")).toHaveCount(0);
    await expect(page.locator('[role="alert"]')).toBeVisible({ timeout: 5_000 });
  });

  test("can toggle to sign-up form", async ({ page }) => {
    await page.route(`**/${SUPABASE_HOST}/**`, (route) => route.fulfill({ status: 200, body: "[]", contentType: "application/json" }));
    await page.goto("/auth");
    await page.locator('button:has-text("Sign Up"), button:has-text("註冊")').click();
    await expect(page.locator("#displayName")).toBeVisible({ timeout: 3_000 });
    await expect(page.locator("#confirmPassword")).toBeVisible();
  });
});

test.describe("Sign-in — regular user", () => {
  test.beforeEach(async ({ page }) => {
    await clearLoginLockStorage(page);
    await setupSignInFlow(page, {
      userId: USER_IDS.regularUser,
      email: TEST_EMAILS.regularUser,
      hasOrg: true,
    });
  });

  test("signs in and redirects to /", async ({ page }) => {
    await page.goto("/auth");
    await fillSignIn(page, TEST_EMAILS.regularUser, "password123");
    await page.waitForURL("/", { timeout: 10_000 });
    expect(page.url()).toContain("/");
  });

  test("remember me is checked by default", async ({ page }) => {
    await page.goto("/auth");
    const checkbox = page.locator("#rememberMe");
    await expect(checkbox).toBeChecked();
  });
});

test.describe("Sign-in — org admin", () => {
  test.beforeEach(async ({ page }) => {
    await clearLoginLockStorage(page);
    await setupSignInFlow(page, {
      userId: USER_IDS.orgAdmin,
      email: TEST_EMAILS.orgAdmin,
      roles: ["admin"],
      hasOrg: true,
    });
  });

  test("signs in and redirects to /", async ({ page }) => {
    await page.goto("/auth");
    await fillSignIn(page, TEST_EMAILS.orgAdmin, "password123");
    await page.waitForURL("/", { timeout: 10_000 });
  });
});

test.describe("Sign-in — system admin", () => {
  test.beforeEach(async ({ page }) => {
    await clearLoginLockStorage(page);
    await setupSignInFlow(page, {
      userId: USER_IDS.systemAdmin,
      email: TEST_EMAILS.systemAdmin,
      isSystemAdmin: true,
      hasOrg: true,
    });
  });

  test("signs in and redirects to /", async ({ page }) => {
    await page.goto("/auth");
    await fillSignIn(page, TEST_EMAILS.systemAdmin, "password123");
    await page.waitForURL("/", { timeout: 10_000 });
  });
});

test.describe("Sign-in — CS agent", () => {
  test.beforeEach(async ({ page }) => {
    await clearLoginLockStorage(page);
    await setupSignInFlow(page, {
      userId: USER_IDS.csAgent,
      email: TEST_EMAILS.csAgent,
      isCsAgent: true,
    });
  });

  test("signs in and redirects to /", async ({ page }) => {
    await page.goto("/auth");
    await fillSignIn(page, TEST_EMAILS.csAgent, "password123");
    await page.waitForURL("/", { timeout: 10_000 });
  });
});

test.describe("Sign-in — failure", () => {
  test.beforeEach(async ({ page }) => {
    await clearLoginLockStorage(page);
  });

  test("invalid credentials shows error toast and failure warning", async ({ page }) => {
    await setupSignInFlow(page, {
      userId: USER_IDS.regularUser,
      email: TEST_EMAILS.regularUser,
      hasOrg: true,
      signInError: { status: 400, message: "Invalid login credentials" },
    });

    await page.goto("/auth");
    await fillSignIn(page, TEST_EMAILS.regularUser, "wrongpassword");

    // Toast with error message appears
    await expect(page.locator('[data-sonner-toast]')).toBeVisible({ timeout: 5_000 });
  });

  test("failure count warning appears after first failed attempt", async ({ page }) => {
    await setupSignInFlow(page, {
      userId: USER_IDS.regularUser,
      email: TEST_EMAILS.regularUser,
      hasOrg: true,
      signInError: { status: 400, message: "Invalid login credentials" },
    });

    await page.goto("/auth");
    await fillSignIn(page, TEST_EMAILS.regularUser, "wrongpassword");

    // Wait for the failure warning to appear (shows fail count)
    await expect(
      page.locator('p.text-destructive, [class*="destructive"]').first()
    ).toBeVisible({ timeout: 5_000 });
  });

  test("locked-out user cannot submit form", async ({ page }) => {
    // Seed a lockout state directly in localStorage
    await page.addInitScript(() => {
      const until = String(Date.now() + 10 * 60 * 1000);
      localStorage.setItem("signcms_login_lock", until);
    });

    await page.route(`**/${SUPABASE_HOST}/**`, (route) =>
      route.fulfill({ status: 200, body: "[]", contentType: "application/json" }),
    );

    await page.goto("/auth");

    // Submit button should be disabled
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeDisabled({ timeout: 5_000 });

    // Lockout alert should be visible
    await expect(page.locator('[role="alert"]')).toBeVisible({ timeout: 5_000 });
  });
});

test.describe("Sign-in — no org redirect", () => {
  test("user without org is redirected to /onboarding after sign-in", async ({ page }) => {
    await clearLoginLockStorage(page);
    await setupSignInFlow(page, {
      userId: USER_IDS.noOrg,
      email: TEST_EMAILS.noOrg,
      hasOrg: false,
    });

    await page.goto("/auth");
    await fillSignIn(page, TEST_EMAILS.noOrg, "password123");
    await page.waitForURL("/onboarding", { timeout: 10_000 });
  });
});
