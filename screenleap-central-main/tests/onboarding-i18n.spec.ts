import { test, expect } from "@playwright/test";
import {
  setupOnboardingMocks,
  gotoOnboarding,
  FORBIDDEN_ORG_WORDS,
  type Lang,
} from "./_helpers/onboarding";

/**
 * Onboarding i18n e2e
 * --------------------
 * Verifies that the onboarding form uses "organization / 組織" wording in
 * zh / en / ja — never "公司 / company / 会社" — for label, placeholder,
 * empty-submit error, and inline onBlur error.
 */

const EXPECTED: Record<Lang, { label: string; placeholder: string; required: string; tab: string; tabJoin: string; mustContain: string }> = {
  zh: {
    label: "組織名稱",
    placeholder: "請輸入組織名稱",
    required: "請輸入組織名稱",
    tab: "建立新組織",
    tabJoin: "加入既有組織",
    mustContain: "組織",
  },
  en: {
    label: "Organization name",
    placeholder: "Enter organization name",
    required: "Please enter an organization name",
    tab: "Create new",
    tabJoin: "Join existing",
    mustContain: "organization",
  },
  ja: {
    label: "組織名",
    placeholder: "組織名を入力",
    required: "組織名を入力してください",
    tab: "新規作成",
    tabJoin: "既存に参加",
    mustContain: "組織",
  },
};

for (const lang of ["zh", "en", "ja"] as const) {
  test.describe(`Onboarding i18n — ${lang}`, () => {
    test.beforeEach(async ({ page }) => {
      await setupOnboardingMocks(page, lang, {
        userId: "00000000-0000-4000-8000-000000000001",
        email: "e2e-onboarding@example.com",
        stubBootstrapRpc: true,
      });
    });

    test(`label & placeholder use organization wording (${lang})`, async ({ page }) => {
      await gotoOnboarding(page);

      const expected = EXPECTED[lang];

      // Tab labels
      await expect(page.getByRole("tab", { name: expected.tab })).toBeVisible();
      await expect(page.getByRole("tab", { name: expected.tabJoin })).toBeVisible();

      // Form label
      const label = page.locator('label[for="orgName"]');
      await expect(label).toHaveText(expected.label);

      // Input placeholder
      const input = page.locator("#orgName");
      await expect(input).toHaveAttribute("placeholder", expected.placeholder);

      // Forbidden words MUST NOT appear anywhere on the page
      const bodyText = await page.locator("body").innerText();
      for (const word of FORBIDDEN_ORG_WORDS) {
        expect(bodyText, `Found forbidden word "${word}" in ${lang} onboarding page`).not.toContain(word);
      }
      expect(bodyText.toLowerCase()).toContain(expected.mustContain.toLowerCase());
    });

    test(`empty-submit shows organization-name required message (${lang})`, async ({ page }) => {
      await gotoOnboarding(page);

      const expected = EXPECTED[lang];

      // Click submit without typing anything
      await page.locator('form button[type="submit"]').first().click();

      // Inline error appears under the input (also surfaced as a toast).
      const inlineError = page.locator("#orgName-error");
      await expect(inlineError).toBeVisible({ timeout: 5_000 });
      await expect(inlineError).toContainText(expected.required);

      const errorText = await inlineError.innerText();
      for (const word of FORBIDDEN_ORG_WORDS) {
        expect(errorText).not.toContain(word);
      }
    });

    test(`focus → blur shows inline error under the input, not just a toast (${lang})`, async ({ page }) => {
      await gotoOnboarding(page);

      const expected = EXPECTED[lang];
      const input = page.locator("#orgName");
      const inlineError = page.locator("#orgName-error");

      // No error before any interaction
      await expect(inlineError).toHaveCount(0);

      // Focus then blur with empty value → inline error appears under the input
      await input.focus();
      await input.blur();

      await expect(inlineError).toBeVisible({ timeout: 3_000 });
      await expect(inlineError).toContainText(expected.required);
      await expect(input).toHaveAttribute("aria-invalid", "true");

      // The error must live in the form, directly after the input wrapper —
      // i.e. it's truly a field-level error, not just a floating toast.
      const errorInForm = page.locator('form:has(#orgName) #orgName-error');
      await expect(errorInForm).toBeVisible();

      // Forbidden wording check on the inline error itself
      const errorText = await inlineError.innerText();
      for (const word of FORBIDDEN_ORG_WORDS) {
        expect(errorText, `Forbidden word "${word}" in ${lang} inline error`).not.toContain(word);
      }
    });
  });
}
