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

test.describe("/studio — save flow (deep)", () => {
  // Captured PATCH bodies — populated by the request interceptor in beforeEach.
  let updates: Array<Record<string, unknown>>;

  // Seed project that the studio will "open" so we exercise the update path
  // (handleSave → PATCH). This avoids the empty-zones save block that
  // handleSaveClick enforces for brand-new designs.
  const SEED_PROJECT = {
    id:           "proj-e2e-001",
    name:         "E2E Test Project",
    aspect:       "16:9",
    org_id:       "org-001",
    created_by:   USER_IDS.orgAdmin,
    team_id:      null,
    collab_scope: "creator",
    created_at:   "2026-05-01T00:00:00Z",
    updated_at:   "2026-05-01T00:00:00Z",
    zones: [
      {
        _meta:        true,
        resolution:   { id: "fhd-landscape", width: 1920, height: 1080 },
        outputMode:   "mirror",
        outputCount:  1,
        activeOutput: 1,  // handleLoad clamps to [1, outputCount]; default = 1
        pages: [{
          id: "p1", name: "版型 1",
          zones: [{
            id: "z1", x: 5, y: 5, w: 90, h: 90, label: "Z-01",
            content: { type: "text", value: "hello", textColor: "#fff", bgColor: "transparent" },
          }],
          overlays: [],
        }],
        outputPages: { "1": [{
          id: "p1", name: "版型 1",
          zones: [{
            id: "z1", x: 5, y: 5, w: 90, h: 90, label: "Z-01",
            content: { type: "text", value: "hello", textColor: "#fff", bgColor: "transparent" },
          }],
          overlays: [],
        }] },
        outputActivePageId: { "1": "p1" },
        activePageId: "p1",
        bgm:          { items: [], volume: 30, audioSource: "bgm" },
      },
    ],
  };

  test.beforeEach(async ({ page }) => {
    updates = [];
    await clearLoginLockStorage(page);
    await setupAuthMocks(page, {
      userId: USER_IDS.orgAdmin,
      email:  TEST_EMAILS.orgAdmin,
      roles:  ["org_admin"],
      hasOrg: true,
    });
    await setupStudioMocks(page);

    // Override design_projects: GET returns our seed project; PATCH captures
    // the body for assertion. Playwright matches the most-recently-registered
    // route first, so this beats the empty mock from setupStudioMocks.
    await page.route(
      "**/narhbpojjtnalyfiwxue.supabase.co/rest/v1/design_projects**",
      (route) => {
        const req    = route.request();
        const method = req.method();
        if (method === "PATCH") {
          try {
            const body = JSON.parse(req.postData() ?? "{}");
            updates.push(Array.isArray(body) ? body[0] : body);
          } catch { /* ignore */ }
          return route.fulfill({ status: 204, body: "" });
        }
        // GET / SELECT — return our seed project
        return route.fulfill({
          status:      200,
          contentType: "application/json",
          headers:     { "content-range": "0-1/1" },
          body:        JSON.stringify([SEED_PROJECT]),
        });
      },
    );
  });

  test("save existing project — PATCH /design_projects with current state", async ({ page }) => {
    // Land on /studio (via the same hash workaround used by smoke tests).
    await page.goto("/");
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
    await page.evaluate(() => { window.location.hash = "/studio"; });
    await waitForHash(page, "/studio", 5_000);
    await page.waitForLoadState("networkidle", { timeout: 15_000 });

    // Load the seed project via the "開啟" (Open) dialog so currentProject
    // is set — this is what unlocks the direct-PATCH path in handleSaveClick
    // (no save dialog) and bypasses the empty-zones save block.
    await page.getByRole("button", { name: /^開啟$|^Open$/i }).first().click();

    const loadDialog = page.getByRole("dialog");
    await expect(loadDialog).toBeVisible({ timeout: 5_000 });
    // Click the project row (rendered as a button inside the load dialog)
    await loadDialog.getByRole("button", { name: /E2E Test Project/ }).click();

    // Dialog closes; project is now loaded. Wait for state to settle.
    await expect(loadDialog).not.toBeVisible({ timeout: 5_000 });
    await page.waitForLoadState("networkidle", { timeout: 5_000 });

    // Click the toolbar "儲存" button. With currentProject loaded and a
    // non-empty zone in the seed, this should fire handleSave directly
    // (no dialog).
    const toolbarSave = page.getByRole("button", { name: /^儲存$/ }).first();
    await expect(toolbarSave).toBeVisible({ timeout: 10_000 });
    await toolbarSave.click();

    // PATCH should land within a few hundred ms.
    await expect.poll(() => updates.length, { timeout: 5_000 }).toBeGreaterThan(0);

    // Assert payload shape — the bug fix in commit 6e4b632 added
    // outputCount + outputMode to the closure deps; verify they ride
    // along in the PATCH body's zones[0] meta entry.
    const patched = updates[0];
    expect(patched.name,   "name preserved").toBe("E2E Test Project");
    expect(patched.aspect, "aspect preserved").toBe("16:9");
    expect(Array.isArray(patched.zones), "zones array").toBe(true);

    const meta = (patched.zones as Array<Record<string, unknown>>)[0];
    expect(meta?._meta,        "_meta marker present").toBe(true);
    expect(meta?.outputMode,   "outputMode in meta (deps fix)").toBeTruthy();
    expect(meta?.outputCount,  "outputCount in meta (deps fix)").toBeGreaterThanOrEqual(1);
    expect(meta?.resolution,   "resolution object present").toBeTruthy();
    expect(meta?.pages,        "pages array in meta").toBeTruthy();
  });
});
