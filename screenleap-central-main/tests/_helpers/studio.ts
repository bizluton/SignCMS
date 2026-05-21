/**
 * Studio-specific Supabase REST mocks.
 *
 * Layered on top of `setupAuthMocks` from `./auth.ts`. Adds empty / minimal
 * responses for the tables `ContentStudioPage` queries on mount:
 *   - design_projects   (project list)
 *   - media_items       (media picker)
 *   - teams             (save dialog dropdown)
 *   - widgets           (widget catalog)
 *   - profiles          (creator name lookups for project cards)
 *
 * All routes default to empty arrays so the page renders cleanly without
 * needing real data. Callers can override individual routes by registering
 * `page.route()` later — Playwright matches the most-recently-registered route
 * first.
 */
import type { Page } from "@playwright/test";
import { SUPABASE_HOST } from "./constants";

export async function setupStudioMocks(page: Page) {
  // design_projects — empty list; insert returns a fabricated row.
  await page.route(`**/${SUPABASE_HOST}/rest/v1/design_projects**`, (route) => {
    const req    = route.request();
    const method = req.method();

    if (method === "POST") {
      // Insert: echo body + assigned id + timestamps
      let parsed: Record<string, unknown> = {};
      try { parsed = JSON.parse(req.postData() ?? "{}"); } catch { /* ignore */ }
      const row = Array.isArray(parsed) ? parsed[0] : parsed;
      const inserted = {
        id:         "proj-test-001",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...row,
      };
      return route.fulfill({
        status:      201,
        contentType: "application/json",
        body:        JSON.stringify([inserted]),
      });
    }

    if (method === "PATCH") {
      // Update: 204 No Content is fine
      return route.fulfill({ status: 204, body: "" });
    }

    if (method === "DELETE") {
      return route.fulfill({ status: 204, body: "" });
    }

    // GET / SELECT — empty list by default
    return route.fulfill({
      status:      200,
      contentType: "application/json",
      headers:     { "content-range": "0-0/0" },
      body:        "[]",
    });
  });

  // media_items — empty by default
  await page.route(`**/${SUPABASE_HOST}/rest/v1/media_items**`, (route) =>
    route.fulfill({
      status:      200,
      contentType: "application/json",
      headers:     { "content-range": "0-0/0" },
      body:        "[]",
    }),
  );

  // teams — empty by default
  await page.route(`**/${SUPABASE_HOST}/rest/v1/teams**`, (route) =>
    route.fulfill({
      status:      200,
      contentType: "application/json",
      body:        "[]",
    }),
  );

  // widgets — empty by default
  await page.route(`**/${SUPABASE_HOST}/rest/v1/widgets**`, (route) =>
    route.fulfill({
      status:      200,
      contentType: "application/json",
      headers:     { "content-range": "0-0/0" },
      body:        "[]",
    }),
  );

  // design_project_team_collaborators (P3-1 collab feature) — empty by default
  await page.route(
    `**/${SUPABASE_HOST}/rest/v1/design_project_team_collaborators**`,
    (route) =>
      route.fulfill({
        status:      200,
        contentType: "application/json",
        body:        "[]",
      }),
  );

  // Realtime websocket — accept but immediately close (page doesn't crash)
  await page.route(`**/${SUPABASE_HOST}/realtime/v1/**`, (route) =>
    route.abort("aborted"),
  );

  // sign-widget-params edge function — not needed for smoke tests
  await page.route(
    `**/${SUPABASE_HOST}/functions/v1/sign-widget-params**`,
    (route) =>
      route.fulfill({
        status:      200,
        contentType: "application/json",
        body:        JSON.stringify({ ok: false }),
      }),
  );
}
