import { test, expect } from "@playwright/test";
import { fillSignIn, clearLoginLockStorage } from "./_helpers/auth";
import { SUPABASE_HOST, USER_IDS, TEST_EMAILS } from "./_helpers/constants";

const LOGIN_MAX_FAILS = 5;
const LOCKOUT_MS = 10 * 60 * 1000;

test.describe("Brute-force lockout — UI behavior", () => {
  test.beforeEach(async ({ page }) => {
    await clearLoginLockStorage(page);
  });

  test("shows failure warning after first failed attempt", async ({ page }) => {
    await page.route(
      `**/${SUPABASE_HOST}/auth/v1/token?grant_type=password**`,
      (route) =>
        route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            error: "invalid_grant",
            error_description: "Invalid login credentials",
          }),
        }),
    );
    await page.route(`**/${SUPABASE_HOST}/**`, (route) =>
      route.fulfill({ status: 200, body: "[]", contentType: "application/json" }),
    );

    await page.goto("/auth");
    await fillSignIn(page, TEST_EMAILS.regularUser, "wrongpassword");

    // Failure warning (showing attempt count) should appear
    await expect(
      page.locator("p").filter({ hasText: /1|一次|attempted|warning/i }).first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test(`shows lockout alert after ${LOGIN_MAX_FAILS} failed attempts`, async ({ page }) => {
    await page.route(
      `**/${SUPABASE_HOST}/auth/v1/token?grant_type=password**`,
      (route) =>
        route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            error: "invalid_grant",
            error_description: "Invalid login credentials",
          }),
        }),
    );
    await page.route(`**/${SUPABASE_HOST}/**`, (route) =>
      route.fulfill({ status: 200, body: "[]", contentType: "application/json" }),
    );

    await page.goto("/auth");

    // Submit 5 bad logins
    for (let i = 0; i < LOGIN_MAX_FAILS; i++) {
      await page.locator("#email").fill(TEST_EMAILS.regularUser);
      await page.locator("#password").fill(`wrongpassword${i}`);
      await page.locator('button[type="submit"]').click();
      // Wait for toast to appear then settle before next attempt
      await page.waitForTimeout(300);
    }

    // After 5 failures: lockout alert with title
    await expect(page.locator('[role="alert"]')).toBeVisible({ timeout: 8_000 });
  });

  test("submit button shows countdown text when locked", async ({ page }) => {
    // Seed a lockout directly
    await page.addInitScript(() => {
      localStorage.setItem(
        "signcms_login_lock",
        String(Date.now() + 10 * 60 * 1000),
      );
    });

    await page.route(`**/${SUPABASE_HOST}/**`, (route) =>
      route.fulfill({ status: 200, body: "[]", contentType: "application/json" }),
    );

    await page.goto("/auth");

    const submitBtn = page.locator('button[type="submit"]');

    // Button should be disabled
    await expect(submitBtn).toBeDisabled({ timeout: 5_000 });

    // Button text should contain a countdown (MM:SS pattern)
    const btnText = await submitBtn.innerText();
    expect(btnText).toMatch(/\d+:\d{2}/);
  });

  test("lockout alert displays countdown timer", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "signcms_login_lock",
        String(Date.now() + 10 * 60 * 1000),
      );
    });

    await page.route(`**/${SUPABASE_HOST}/**`, (route) =>
      route.fulfill({ status: 200, body: "[]", contentType: "application/json" }),
    );

    await page.goto("/auth");

    // Lockout alert visible
    const alert = page.locator('[role="alert"]');
    await expect(alert).toBeVisible({ timeout: 5_000 });

    // Should contain countdown value
    const alertText = await alert.innerText();
    expect(alertText).toMatch(/\d+:\d{2}/);
  });

  test("countdown decrements over time", async ({ page }) => {
    // Set lock expiring 65 seconds from now
    await page.addInitScript(() => {
      localStorage.setItem("signcms_login_lock", String(Date.now() + 65_000));
    });

    await page.route(`**/${SUPABASE_HOST}/**`, (route) =>
      route.fulfill({ status: 200, body: "[]", contentType: "application/json" }),
    );

    await page.goto("/auth");

    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeDisabled({ timeout: 5_000 });

    // Read initial countdown
    const initialText = await submitBtn.innerText();

    // Wait 2 seconds for the tick
    await page.waitForTimeout(2_000);

    const laterText = await submitBtn.innerText();

    // The countdown text should have changed (decremented)
    expect(initialText).not.toBe(laterText);
  });

  test("clearing lockout re-enables the form", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "signcms_login_lock",
        String(Date.now() + 10 * 60 * 1000),
      );
    });

    await page.route(`**/${SUPABASE_HOST}/**`, (route) =>
      route.fulfill({ status: 200, body: "[]", contentType: "application/json" }),
    );

    await page.goto("/auth");

    // Confirm button is initially disabled
    await expect(page.locator('button[type="submit"]')).toBeDisabled({ timeout: 5_000 });

    // Programmatically clear the lock from within the page
    await page.evaluate(() => {
      localStorage.removeItem("signcms_login_lock");
      localStorage.removeItem("signcms_login_fails");
    });

    // Reload to pick up the cleared state
    await page.reload();

    // Button should now be enabled
    await expect(page.locator('button[type="submit"]')).toBeEnabled({ timeout: 5_000 });
    // No lockout alert
    await expect(page.locator('[role="alert"]')).toHaveCount(0);
  });

  test("expired lock is auto-cleared: page loads without lockout", async ({ page }) => {
    // Seed an already-expired lock (expired 1 s ago)
    await page.addInitScript(() => {
      localStorage.setItem("signcms_login_lock", String(Date.now() - 1_000));
    });

    await page.route(`**/${SUPABASE_HOST}/**`, (route) =>
      route.fulfill({ status: 200, body: "[]", contentType: "application/json" }),
    );

    await page.goto("/auth");

    // Submit button should be enabled (no lockout)
    await expect(page.locator('button[type="submit"]')).toBeEnabled({ timeout: 5_000 });
    await expect(page.locator('[role="alert"]')).toHaveCount(0);
  });

  test("stale failures (beyond 15-min window) do not count", async ({ page }) => {
    // Seed 4 old failures (beyond the 15-min window)
    await page.addInitScript(() => {
      const oldState = {
        count: 4,
        firstAt: Date.now() - 16 * 60 * 1000,
      };
      localStorage.setItem("signcms_login_fails", JSON.stringify(oldState));
    });

    await page.route(`**/${SUPABASE_HOST}/**`, (route) =>
      route.fulfill({ status: 200, body: "[]", contentType: "application/json" }),
    );

    await page.goto("/auth");

    // Old failures are ignored — button should be enabled, no lockout alert
    await expect(page.locator('button[type="submit"]')).toBeEnabled({ timeout: 5_000 });
    await expect(page.locator('[role="alert"]')).toHaveCount(0);
  });
});
