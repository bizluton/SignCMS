import { test, expect, type Page } from "@playwright/test";
import {
  setupOnboardingMocks,
  gotoOnboarding,
  type Lang,
} from "./_helpers/onboarding";

/**
 * Onboarding "Join existing organization" — invite token onBlur validation
 *   1) empty            → required
 *   2) too short        → tooShort
 *   3) non-UUID garbage → badFormat
 *   4) valid UUID       → no error
 */

const VALID_UUID = "11111111-2222-4333-8444-555555555555";

const EXPECTED: Record<Lang, { tab: string; required: string; tooShort: string; badFormat: string; pasteNoInvite: string }> = {
  zh: {
    tab: "加入既有組織",
    required: "請輸入邀請碼。",
    tooShort: "邀請碼長度不足",
    badFormat: "邀請碼格式不正確",
    pasteNoInvite: "無法從連結擷取邀請碼",
  },
  en: {
    tab: "Join existing",
    required: "Please enter an invitation code.",
    tooShort: "Invitation code looks too short",
    badFormat: "Invitation code format is invalid",
    pasteNoInvite: "Couldn't extract an invitation code from the link",
  },
  ja: {
    tab: "既存に参加",
    required: "招待コードを入力してください。",
    tooShort: "招待コードが短すぎます",
    badFormat: "招待コードの形式が正しくありません",
    pasteNoInvite: "リンクから招待コードを取得できませんでした",
  },
};

async function gotoJoinTab(page: Page, lang: Lang) {
  await gotoOnboarding(page);
  await page.getByRole("tab", { name: EXPECTED[lang].tab }).click();
  await expect(page.locator("#inviteToken")).toBeVisible();
}

for (const lang of ["zh", "en", "ja"] as const) {
  test.describe(`Onboarding join-token onBlur — ${lang}`, () => {
    test.beforeEach(async ({ page }) => {
      await setupOnboardingMocks(page, lang, {
        userId: "00000000-0000-4000-8000-000000000003",
        email: "e2e-join-onblur@example.com",
      });
    });

    test(`empty / too short / non-UUID / valid UUID (${lang})`, async ({ page }) => {
      await gotoJoinTab(page, lang);

      const input = page.locator("#inviteToken");
      const error = page.locator("#inviteToken-error");
      const expected = EXPECTED[lang];

      // Sanity: no error before any interaction
      await expect(error).toHaveCount(0);

      // (1) empty → required
      await input.focus();
      await input.blur();
      await expect(error).toBeVisible({ timeout: 3_000 });
      await expect(error).toContainText(expected.required);
      await expect(input).toHaveAttribute("aria-invalid", "true");

      // (2) too short → tooShort
      await input.fill("abc123");
      await input.blur();
      await expect(error).toBeVisible();
      await expect(error).toContainText(expected.tooShort);
      await expect(input).toHaveAttribute("aria-invalid", "true");

      // (3) long but non-UUID garbage → badFormat
      await input.fill("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"); // 32 chars, not a UUID
      await input.blur();
      await expect(error).toBeVisible();
      await expect(error).toContainText(expected.badFormat);
      await expect(input).toHaveAttribute("aria-invalid", "true");

      // (4) valid UUID → no error
      await input.fill(VALID_UUID);
      await input.blur();
      await expect(error).toHaveCount(0);
      await expect(input).not.toHaveAttribute("aria-invalid", "true");

      // (5) full invite URL → UUID is auto-extracted AND input value is trimmed to pure UUID
      await input.fill(`https://app.example.com/auth?invite=${VALID_UUID}`);
      await input.blur();
      await expect(error).toHaveCount(0);
      await expect(input).not.toHaveAttribute("aria-invalid", "true");
      await expect(input).toHaveValue(VALID_UUID);

      // Also accept extra query params around the invite token, with auto-trim
      await input.fill(`https://trial.signcms.com/auth?foo=bar&invite=${VALID_UUID}&utm=email`);
      await input.blur();
      await expect(error).toHaveCount(0);
      await expect(input).not.toHaveAttribute("aria-invalid", "true");
      await expect(input).toHaveValue(VALID_UUID);

      // (6) Pasting a URL with NO invite param shows the dedicated inline hint.
      await input.fill("");
      await input.focus();
      await page.evaluate(() => {
        const el = document.getElementById("inviteToken") as HTMLInputElement;
        const dt = new DataTransfer();
        dt.setData("text/plain", "https://example.com/some/page?foo=bar");
        const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
        el.dispatchEvent(ev);
      });
      await expect(error).toBeVisible();
      await expect(error).toContainText(expected.pasteNoInvite);
      await expect(input).toHaveAttribute("aria-invalid", "true");
    });
  });
}
