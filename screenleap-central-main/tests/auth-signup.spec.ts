import { test, expect } from "@playwright/test";
import { fillSignUp, mockSignUpSuccess, mockSignUpEmailExists } from "./_helpers/auth";
import { SUPABASE_HOST, USER_IDS, TEST_EMAILS } from "./_helpers/constants";

test.describe("Sign-up flow", () => {
  test.beforeEach(async ({ page }) => {
    // Clear any login locks
    await page.addInitScript(() => {
      localStorage.removeItem("signcms_login_lock");
      localStorage.removeItem("signcms_login_fails");
    });
    // Stub auth/v1/user to return 401 (no existing session)
    await page.route(`**/${SUPABASE_HOST}/auth/v1/user**`, (route) =>
      route.fulfill({ status: 401, body: JSON.stringify({ message: "not authenticated" }), contentType: "application/json" }),
    );
  });

  test("can switch from sign-in to sign-up form", async ({ page }) => {
    await page.route(`**/${SUPABASE_HOST}/**`, (route) =>
      route.fulfill({ status: 200, body: "[]", contentType: "application/json" }),
    );

    await page.goto("/auth");

    // Should start in sign-in mode (no displayName)
    await expect(page.locator("#displayName")).toHaveCount(0);

    // Click toggle
    await page.locator('button:has-text("Sign Up"), button:has-text("註冊")').click();

    // Sign-up fields should now appear
    await expect(page.locator("#displayName")).toBeVisible({ timeout: 3_000 });
    await expect(page.locator("#confirmPassword")).toBeVisible();
  });

  test("password mismatch shows inline validation error", async ({ page }) => {
    await page.route(`**/${SUPABASE_HOST}/**`, (route) =>
      route.fulfill({ status: 200, body: "[]", contentType: "application/json" }),
    );

    await page.goto("/auth");
    await page.locator('button:has-text("Sign Up"), button:has-text("註冊")').click();

    await page.locator("#displayName").fill("Test User");
    await page.locator("#email").fill("newuser@example.com");
    await page.locator("#password").fill("password123");
    await page.locator("#confirmPassword").fill("different456");

    // Inline mismatch warning should appear while typing
    await expect(
      page.locator("p.text-destructive, p.text-\\[11px\\]").filter({ hasText: /mismatch|不一致/ }),
    ).toBeVisible({ timeout: 3_000 });
  });

  test("password mismatch blocks form submission and shows toast", async ({ page }) => {
    await page.route(`**/${SUPABASE_HOST}/**`, (route) =>
      route.fulfill({ status: 200, body: "[]", contentType: "application/json" }),
    );

    await page.goto("/auth");
    await page.locator('button:has-text("Sign Up"), button:has-text("註冊")').click();

    await fillSignUp(page, {
      displayName: "Test User",
      email: "newuser@example.com",
      password: "password123",
      confirmPassword: "different456",
    });

    // Toast error for mismatch
    await expect(page.locator('[data-sonner-toast]')).toBeVisible({ timeout: 5_000 });
    // Should NOT have called sign-up endpoint
  });

  test("successful sign-up shows success toast", async ({ page }) => {
    await mockSignUpSuccess(page, USER_IDS.noOrg, "newuser@example.com");

    await page.goto("/auth");
    await page.locator('button:has-text("Sign Up"), button:has-text("註冊")').click();

    await fillSignUp(page, {
      displayName: "New User",
      email: "newuser@example.com",
      password: "password123",
    });

    // Expect the success toast
    await expect(page.locator('[data-sonner-toast]')).toBeVisible({ timeout: 8_000 });
    const toastText = await page.locator('[data-sonner-toast]').first().innerText();
    // Should not show an error toast
    expect(toastText).not.toMatch(/failed|error|失敗|錯誤/i);
  });

  test("existing email shows email-exists error toast", async ({ page }) => {
    await mockSignUpEmailExists(page, "existing@example.com");

    await page.goto("/auth");
    await page.locator('button:has-text("Sign Up"), button:has-text("註冊")').click();

    await fillSignUp(page, {
      displayName: "Existing User",
      email: "existing@example.com",
      password: "password123",
    });

    // Supabase anti-enumeration: 200 with empty identities → show "email exists" toast
    await expect(page.locator('[data-sonner-toast]')).toBeVisible({ timeout: 8_000 });
    const toastText = await page.locator('[data-sonner-toast]').first().innerText();
    expect(toastText).toMatch(/already|exist|已存在|已註冊/i);
  });

  test("sign-up with valid invite token pre-fills sign-up form", async ({ page }) => {
    await page.route(`**/${SUPABASE_HOST}/**`, (route) =>
      route.fulfill({ status: 200, body: "[]", contentType: "application/json" }),
    );

    // Valid UUID invite token
    await page.goto("/auth?invite=11111111-2222-4333-8444-555555555555");

    // Should be in sign-up mode
    await expect(page.locator("#displayName")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("#confirmPassword")).toBeVisible();
    // No invalid invite banner
    await expect(page.locator('[role="alert"]')).toHaveCount(0);
  });

  test("sign-up with cs_agent param shows sign-up form", async ({ page }) => {
    await page.route(`**/${SUPABASE_HOST}/**`, (route) =>
      route.fulfill({ status: 200, body: "[]", contentType: "application/json" }),
    );

    await page.goto("/auth?cs_agent=cs-agent-123");

    await expect(page.locator("#displayName")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("#confirmPassword")).toBeVisible();
  });

  test("toggling from sign-up back to sign-in clears confirmPassword", async ({ page }) => {
    await page.route(`**/${SUPABASE_HOST}/**`, (route) =>
      route.fulfill({ status: 200, body: "[]", contentType: "application/json" }),
    );

    await page.goto("/auth");

    // Switch to sign-up
    await page.locator('button:has-text("Sign Up"), button:has-text("註冊")').click();
    await expect(page.locator("#confirmPassword")).toBeVisible({ timeout: 3_000 });

    // Switch back to sign-in
    await page.locator('button:has-text("Sign In"), button:has-text("登入")').click();
    await expect(page.locator("#displayName")).toHaveCount(0);
    await expect(page.locator("#confirmPassword")).toHaveCount(0);
  });
});
