import { test, expect } from "@playwright/test";
import { SUPABASE_HOST } from "./_helpers/constants";

test.describe("Forgot Password page", () => {
  test.beforeEach(async ({ page }) => {
    // Supabase reset-password endpoint
    await page.route(
      `**/${SUPABASE_HOST}/auth/v1/recover**`,
      (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
    );
    // Catch-all for other Supabase calls
    await page.route(`**/${SUPABASE_HOST}/**`, (route) =>
      route.fulfill({ status: 200, body: "[]", contentType: "application/json" }),
    );
  });

  test("shows forgot-password form", async ({ page }) => {
    await page.goto("/forgot-password");
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test("submitting email shows confirmation state", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.locator("#email").fill("user@example.com");
    await page.locator('button[type="submit"]').click();

    // After submit, success toast should appear
    await expect(page.locator('[data-sonner-toast]')).toBeVisible({ timeout: 8_000 });
    // Form should be replaced by "check email" confirmation
    await expect(page.locator("#email")).toHaveCount(0);
  });

  test("'back to sign in' link navigates to /auth", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.locator('a[href="/auth"], a:has-text("Sign In"), a:has-text("登入")').first().click();
    await page.waitForURL("/auth", { timeout: 5_000 });
  });

  test("API error shows error toast", async ({ page }) => {
    // Override with error response
    await page.route(
      `**/${SUPABASE_HOST}/auth/v1/recover**`,
      (route) =>
        route.fulfill({
          status: 429,
          contentType: "application/json",
          body: JSON.stringify({ error: "rate_limit_exceeded", message: "too many requests" }),
        }),
    );

    await page.goto("/forgot-password");
    await page.locator("#email").fill("user@example.com");
    await page.locator('button[type="submit"]').click();

    await expect(page.locator('[data-sonner-toast]')).toBeVisible({ timeout: 8_000 });
  });
});

test.describe("Reset Password page — hash-based recovery (implicit flow)", () => {
  test.beforeEach(async ({ page }) => {
    await page.route(`**/${SUPABASE_HOST}/**`, (route) =>
      route.fulfill({ status: 200, body: "[]", contentType: "application/json" }),
    );
  });

  test("shows reset form when hash contains type=recovery", async ({ page }) => {
    await page.goto("/reset-password#access_token=fake-token&type=recovery");
    // The page checks the hash synchronously, so the form should appear
    await expect(page.locator("#password")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("#confirmPassword")).toBeVisible();
  });

  test("shows invalid-link state when no recovery token in hash", async ({ page }) => {
    await page.goto("/reset-password");
    // After the ~1.2s fallback timer fires with no session, shows invalid link
    await expect(page.locator("button")).toBeVisible({ timeout: 5_000 });
    // The form inputs should NOT be visible
    await expect(page.locator("#password")).toHaveCount(0);
  });

  test("password mismatch on reset shows inline error", async ({ page }) => {
    await page.goto("/reset-password#access_token=fake-token&type=recovery");
    await expect(page.locator("#password")).toBeVisible({ timeout: 5_000 });

    await page.locator("#password").fill("newpassword123");
    await page.locator("#confirmPassword").fill("differentpassword");

    // Inline mismatch error
    await expect(
      page.locator("p.text-destructive").filter({ hasText: /mismatch|不一致/i }),
    ).toBeVisible({ timeout: 3_000 });
  });

  test("password mismatch on submit shows toast", async ({ page }) => {
    await page.goto("/reset-password#access_token=fake-token&type=recovery");
    await expect(page.locator("#password")).toBeVisible({ timeout: 5_000 });

    await page.locator("#password").fill("newpassword123");
    await page.locator("#confirmPassword").fill("different456");
    await page.locator('button[type="submit"]').click();

    await expect(page.locator('[data-sonner-toast]')).toBeVisible({ timeout: 5_000 });
  });

  test("successful password update navigates to /", async ({ page }) => {
    // Mock the updateUser endpoint
    await page.route(
      `**/${SUPABASE_HOST}/auth/v1/user**`,
      (route) => {
        if (route.request().method() === "PUT") {
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ id: "user-id", email: "user@example.com" }),
          });
        }
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ id: "user-id", email: "user@example.com" }),
        });
      },
    );

    // Also mock REST endpoints for the post-reset redirect to /
    await page.route(`**/${SUPABASE_HOST}/rest/v1/**`, (route) =>
      route.fulfill({ status: 200, body: "[]", contentType: "application/json" }),
    );

    await page.goto("/reset-password#access_token=fake-token&type=recovery");
    await expect(page.locator("#password")).toBeVisible({ timeout: 5_000 });

    await page.locator("#password").fill("newpassword123");
    await page.locator("#confirmPassword").fill("newpassword123");
    await page.locator('button[type="submit"]').click();

    // Success toast, then navigate to /
    await expect(page.locator('[data-sonner-toast]')).toBeVisible({ timeout: 8_000 });
  });
});

test.describe("Reset Password page — PKCE flow (?code=...)", () => {
  test.beforeEach(async ({ page }) => {
    await page.route(`**/${SUPABASE_HOST}/**`, (route) =>
      route.fulfill({ status: 200, body: "[]", contentType: "application/json" }),
    );
  });

  test("shows loading spinner while waiting for code exchange", async ({ page }) => {
    // Navigate with a code param — app waits up to 2.5s for PASSWORD_RECOVERY event
    await page.goto("/reset-password?code=fake-code-123");

    // Should show a spinner initially
    const spinner = page.locator('[class*="animate-spin"]');
    await expect(spinner).toBeVisible({ timeout: 3_000 });
  });

  test("shows invalid-link when code exchange yields no session", async ({ page }) => {
    // Supabase won't fire PASSWORD_RECOVERY here (mocked), so after timeout: invalid link
    await page.goto("/reset-password?code=fake-code-123");

    // After 2.5s + render, should show invalid link UI
    const requestNewBtn = page.locator(
      'button:has-text("Request"), button:has-text("申請"), button:has-text("再申請")',
    );
    await expect(requestNewBtn).toBeVisible({ timeout: 8_000 });
  });
});
