import { test, expect } from "@playwright/test";
import { setupAuthMocks, clearLoginLockStorage } from "./_helpers/auth";
import { USER_IDS, TEST_EMAILS } from "./_helpers/constants";

/**
 * Route guard tests: verify that each guard (ProtectedRoute, AdminRoute,
 * CSRoute, SystemAdminRoute) redirects unauthenticated or under-privileged
 * users to the correct fallback route.
 */

test.describe("ProtectedRoute — unauthenticated", () => {
  test("/ redirects to /auth when no session", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL("/auth", { timeout: 10_000 });
  });

  test("/screens redirects to /auth when no session", async ({ page }) => {
    await page.goto("/screens");
    await page.waitForURL("/auth", { timeout: 10_000 });
  });

  test("/media redirects to /auth when no session", async ({ page }) => {
    await page.goto("/media");
    await page.waitForURL("/auth", { timeout: 10_000 });
  });
});

test.describe("ProtectedRoute — user without org", () => {
  test.beforeEach(async ({ page }) => {
    await clearLoginLockStorage(page);
    await setupAuthMocks(page, {
      userId: USER_IDS.noOrg,
      email: TEST_EMAILS.noOrg,
      hasOrg: false,
    });
  });

  test("redirects to /onboarding when user has no org", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL("/onboarding", { timeout: 10_000 });
  });

  test("/screens also redirects to /onboarding", async ({ page }) => {
    await page.goto("/screens");
    await page.waitForURL("/onboarding", { timeout: 10_000 });
  });
});

test.describe("ProtectedRoute — regular user with org", () => {
  test.beforeEach(async ({ page }) => {
    await clearLoginLockStorage(page);
    await setupAuthMocks(page, {
      userId: USER_IDS.regularUser,
      email: TEST_EMAILS.regularUser,
      hasOrg: true,
    });
  });

  test("/ is accessible with org membership", async ({ page }) => {
    await page.goto("/");
    // Should NOT redirect to /auth or /onboarding
    await page.waitForLoadState("networkidle");
    expect(page.url()).not.toContain("/auth");
    expect(page.url()).not.toContain("/onboarding");
  });
});

test.describe("AdminRoute — access control", () => {
  test("regular user at /admin is redirected to /", async ({ page }) => {
    await clearLoginLockStorage(page);
    await setupAuthMocks(page, {
      userId: USER_IDS.regularUser,
      email: TEST_EMAILS.regularUser,
      hasOrg: true,
    });

    await page.goto("/admin");
    await page.waitForURL("/", { timeout: 10_000 });
  });

  test("unauthenticated user at /admin is redirected to /auth", async ({ page }) => {
    await page.goto("/admin");
    await page.waitForURL("/auth", { timeout: 10_000 });
  });

  test("org admin at /admin can access the page", async ({ page }) => {
    await clearLoginLockStorage(page);
    await setupAuthMocks(page, {
      userId: USER_IDS.orgAdmin,
      email: TEST_EMAILS.orgAdmin,
      roles: ["admin"],
      hasOrg: true,
    });

    await page.goto("/admin");
    await page.waitForLoadState("networkidle");
    expect(page.url()).not.toContain("/auth");
    expect(page.url()).toContain("/admin");
  });
});

test.describe("SystemAdminRoute — access control", () => {
  test("regular user at /system-admin is redirected to /", async ({ page }) => {
    await clearLoginLockStorage(page);
    await setupAuthMocks(page, {
      userId: USER_IDS.regularUser,
      email: TEST_EMAILS.regularUser,
      hasOrg: true,
    });

    await page.goto("/system-admin");
    await page.waitForURL("/", { timeout: 10_000 });
  });

  test("org admin at /system-admin is redirected to /", async ({ page }) => {
    await clearLoginLockStorage(page);
    await setupAuthMocks(page, {
      userId: USER_IDS.orgAdmin,
      email: TEST_EMAILS.orgAdmin,
      roles: ["admin"],
      hasOrg: true,
    });

    await page.goto("/system-admin");
    await page.waitForURL("/", { timeout: 10_000 });
  });

  test("unauthenticated user at /system-admin is redirected to /auth", async ({ page }) => {
    await page.goto("/system-admin");
    await page.waitForURL("/auth", { timeout: 10_000 });
  });

  test("system admin at /system-admin can access the page", async ({ page }) => {
    await clearLoginLockStorage(page);
    await setupAuthMocks(page, {
      userId: USER_IDS.systemAdmin,
      email: TEST_EMAILS.systemAdmin,
      isSystemAdmin: true,
      hasOrg: true,
    });

    await page.goto("/system-admin");
    await page.waitForLoadState("networkidle");
    expect(page.url()).not.toContain("/auth");
    expect(page.url()).toContain("/system-admin");
  });

  test("system admin can also access /org-management", async ({ page }) => {
    await clearLoginLockStorage(page);
    await setupAuthMocks(page, {
      userId: USER_IDS.systemAdmin,
      email: TEST_EMAILS.systemAdmin,
      isSystemAdmin: true,
      hasOrg: true,
    });

    await page.goto("/org-management");
    await page.waitForLoadState("networkidle");
    expect(page.url()).not.toContain("/auth");
    expect(page.url()).toContain("/org-management");
  });
});

test.describe("CSRoute — access control", () => {
  test("regular user at /customer-service is redirected to /", async ({ page }) => {
    await clearLoginLockStorage(page);
    await setupAuthMocks(page, {
      userId: USER_IDS.regularUser,
      email: TEST_EMAILS.regularUser,
      hasOrg: true,
    });

    await page.goto("/customer-service");
    await page.waitForURL("/", { timeout: 10_000 });
  });

  test("unauthenticated user at /customer-service is redirected to /auth", async ({ page }) => {
    await page.goto("/customer-service");
    await page.waitForURL("/auth", { timeout: 10_000 });
  });

  test("active CS agent at /customer-service can access the page", async ({ page }) => {
    await clearLoginLockStorage(page);
    await setupAuthMocks(page, {
      userId: USER_IDS.csAgent,
      email: TEST_EMAILS.csAgent,
      isCsAgent: true,
    });

    await page.goto("/customer-service");
    await page.waitForLoadState("networkidle");
    expect(page.url()).not.toContain("/auth");
    expect(page.url()).toContain("/customer-service");
  });

  test("system admin at /customer-service can access the page", async ({ page }) => {
    await clearLoginLockStorage(page);
    await setupAuthMocks(page, {
      userId: USER_IDS.systemAdmin,
      email: TEST_EMAILS.systemAdmin,
      isSystemAdmin: true,
      hasOrg: true,
    });

    await page.goto("/customer-service");
    await page.waitForLoadState("networkidle");
    expect(page.url()).not.toContain("/auth");
    expect(page.url()).toContain("/customer-service");
  });

  test("regular user at /cs-dashboard is redirected to /", async ({ page }) => {
    await clearLoginLockStorage(page);
    await setupAuthMocks(page, {
      userId: USER_IDS.regularUser,
      email: TEST_EMAILS.regularUser,
      hasOrg: true,
    });

    await page.goto("/cs-dashboard");
    await page.waitForURL("/", { timeout: 10_000 });
  });

  test("regular user at /knowledge-base is redirected to /", async ({ page }) => {
    await clearLoginLockStorage(page);
    await setupAuthMocks(page, {
      userId: USER_IDS.regularUser,
      email: TEST_EMAILS.regularUser,
      hasOrg: true,
    });

    await page.goto("/knowledge-base");
    await page.waitForURL("/", { timeout: 10_000 });
  });
});
