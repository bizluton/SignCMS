/**
 * ContentStudio (`/studio`) — smoke tests.
 *
 * Scope: page rendering + route guard. Does NOT cover the deep editor flow
 * (drag-drop, multi-output, save/load round-trip) — those need real Supabase
 * + meaningful media fixtures, which is a separate larger task.
 *
 * What this catches:
 *   - Route guard regressions (unauth users leaking into /studio)
 *   - Build-time exceptions (the 9925-line page silently throwing on mount)
 *   - Major UI elements missing (tabs / sidebar / canvas placeholder)
 *
 * The app uses HashRouter (`src/App.tsx`), so all in-app routes are addressed
 * via `#/route`. We assert URL hash, not path.
 *
 * Auth + Supabase REST are mocked via `_helpers/auth.ts` + `_helpers/studio.ts`
 * — no real backend needed.
 */
import { test, expect, type Page } from "@playwright/test";
import { setupAuthMocks, clearLoginLockStorage } from "./_helpers/auth";
import { setupStudioMocks } from "./_helpers/studio";
import { USER_IDS, TEST_EMAILS } from "./_helpers/constants";

/** Wait for `window.location.hash` to match (exact substring). */
async function waitForHash(page: Page, hashFragment: string, timeout = 10_000) {
  await page.waitForFunction(
    (frag) => window.location.hash.includes(frag),
    hashFragment,
    { timeout },
  );
}

test.describe("/studio — route guard", () => {
  test("unauthenticated → redirected to #/auth", async ({ page }) => {
    await page.goto("/#/studio");
    await waitForHash(page, "/auth");
  });

  test("authenticated user without org → redirected to #/onboarding", async ({ page }) => {
    await clearLoginLockStorage(page);
    await setupAuthMocks(page, {
      userId: USER_IDS.noOrg,
      email:  TEST_EMAILS.noOrg,
      hasOrg: false,
    });

    await page.goto("/#/studio");
    await waitForHash(page, "/onboarding");
  });
});

test.describe("/studio — smoke render", () => {
  test.beforeEach(async ({ page }) => {
    await clearLoginLockStorage(page);
    // Use orgAdmin (not systemAdmin) — Index.tsx auto-redirects sysadmins
    // away from `/` to `/system-admin`, which would race the initial
    // HashRouter `#/studio` navigation and break the test.
    await setupAuthMocks(page, {
      userId: USER_IDS.orgAdmin,
      email:  TEST_EMAILS.orgAdmin,
      roles:  ["org_admin"],
      hasOrg: true,
    });
    await setupStudioMocks(page);
  });

  /**
   * Navigate to /studio via in-app hash change.
   *
   * `page.goto("/#/studio")` doesn't reliably trigger HashRouter — initial
   * navigation can land on the dashboard (`/`) before the hash is applied,
   * and the page never re-routes. The workaround is to load the app at root,
   * wait for it to settle, then update `window.location.hash` to fire the
   * `hashchange` event that HashRouter listens on.
   */
  async function navigateToStudio(page: Page) {
    await page.goto("/");
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
    await page.evaluate(() => { window.location.hash = "/studio"; });
    await waitForHash(page, "/studio", 5_000);
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
  }

  test("stays on #/studio after auth + org checks pass", async ({ page }) => {
    await navigateToStudio(page);

    const url = page.url();
    expect(url).toContain("#/studio");
    expect(url).not.toContain("#/auth");
    expect(url).not.toContain("#/onboarding");
  });

  test("loads without page-level JS exceptions", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await navigateToStudio(page);

    // pageerror only fires for *uncaught* exceptions. Network 401s and
    // console.error() calls don't trigger it — those are intentionally
    // separate signals.
    expect(
      pageErrors,
      `Uncaught page exceptions: ${JSON.stringify(pageErrors, null, 2)}`,
    ).toEqual([]);
  });

  test("renders the sidebar tabs (新建專案 / 我的專案)", async ({ page }) => {
    await navigateToStudio(page);

    // Two copies render (desktop + mobile responsive layout). `.first()`
    // is intentional. Generous timeout — 9925-line page; first paint can lag.
    // Note the zh translation key value is "新建專案" (not "新專案"); regex
    // tolerates the en / ja variants too.
    await expect(page.getByRole("tab", { name: /新建專案|new project|新規プロジェクト/i }).first())
      .toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("tab", { name: /我的專案|my project|マイプロジェクト/i }).first())
      .toBeVisible({ timeout: 10_000 });
  });
});
