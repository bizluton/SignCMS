import { test, expect } from "@playwright/test";
import {
  setupOnboardingMocks,
  gotoOnboarding,
  FORBIDDEN_ORG_WORDS,
  type Lang,
} from "./_helpers/onboarding";

/**
 * Onboarding onBlur live-validation e2e
 * --------------------------------------
 *   1) focus the org-name input then blur with no input  → red error appears
 *   2) start typing again                                 → red error disappears
 *   3) zh / en / ja each render the correct localized text and never use 公司/company/会社
 */

const EXPECTED_REQUIRED: Record<Lang, string> = {
  zh: "請輸入組織名稱",
  en: "Please enter an organization name",
  ja: "組織名を入力してください",
};

for (const lang of ["zh", "en", "ja"] as const) {
  test.describe(`Onboarding onBlur validation — ${lang}`, () => {
    test.beforeEach(async ({ page }) => {
      await setupOnboardingMocks(page, lang, {
        userId: "00000000-0000-4000-8000-000000000002",
        email: "e2e-onblur@example.com",
      });
    });

    test(`focus → blur shows inline error; typing clears it (${lang})`, async ({ page }) => {
      await gotoOnboarding(page);

      const input = page.locator("#orgName");
      const inlineError = page.locator("#orgName-error");

      // Sanity: error is NOT visible before any interaction
      await expect(inlineError).toHaveCount(0);

      // (1) focus then blur with no input → error appears
      await input.focus();
      await input.blur();

      await expect(inlineError).toBeVisible({ timeout: 3_000 });
      await expect(inlineError).toContainText(EXPECTED_REQUIRED[lang]);

      // Input should also be marked invalid for assistive tech
      await expect(input).toHaveAttribute("aria-invalid", "true");

      // Forbidden wording check on the inline error itself
      const errorText = await inlineError.innerText();
      for (const word of FORBIDDEN_ORG_WORDS) {
        expect(errorText, `Forbidden word "${word}" in ${lang} inline error`).not.toContain(word);
      }

      // (2) typing again → error disappears
      await input.fill("Acme Inc.");
      await expect(inlineError).toHaveCount(0);
      await expect(input).not.toHaveAttribute("aria-invalid", "true");
    });
  });
}
