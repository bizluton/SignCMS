// Tests for smart-trigger-webhook authentication errors.
// Verifies 401 (missing token), 404 (unknown org), 403 (wrong token), 400 (bad body).
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const ENDPOINT = `${SUPABASE_URL}/functions/v1/smart-trigger-webhook`;

const baseHeaders = (extra: Record<string, string> = {}) => ({
  "Content-Type": "application/json",
  // anon key required by Supabase Gateway; the function does its own X-Webhook-Token auth.
  apikey: ANON_KEY,
  Authorization: `Bearer ${ANON_KEY}`,
  ...extra,
});

const sampleBody = (org_id: string) => JSON.stringify({
  org_id,
  trigger_source: "webhook",
  trigger_key: "test",
  payload: {},
});

// Fetch a real org id + its webhook_token via service role (only used for 403 test).
async function getRealOrg(): Promise<{ id: string; webhook_token: string } | null> {
  if (!SERVICE_KEY) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/organizations?select=id,webhook_token&limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) { await res.text(); return null; }
  const arr = await res.json();
  return Array.isArray(arr) && arr[0] ? arr[0] : null;
}

Deno.test("401 when X-Webhook-Token header is missing", async () => {
  // No X-Webhook-Token; Authorization holds anon key (gateway requirement) and is NOT used as token.
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: baseHeaders(),
    body: sampleBody("00000000-0000-0000-0000-000000000000"),
  });
  const json = await res.json();
  assertEquals(res.status, 401, `expected 401, got ${res.status}: ${JSON.stringify(json)}`);
  assertEquals(json.error, "missing_webhook_token");
  assert(typeof json.message === "string" && json.message.length > 0);
});

Deno.test("404 when org_id does not exist", async () => {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: baseHeaders({ "X-Webhook-Token": "any-nonempty-token-value" }),
    body: sampleBody("00000000-0000-0000-0000-000000000000"),
  });
  const json = await res.json();
  assertEquals(res.status, 404, `expected 404, got ${res.status}: ${JSON.stringify(json)}`);
  assertEquals(json.error, "org_not_found");
});

Deno.test("403 when token does not match the org's webhook_token", async () => {
  const org = await getRealOrg();
  if (!org) {
    console.warn("⚠ Skipping 403 test: no organizations available or SUPABASE_SERVICE_ROLE_KEY missing.");
    return;
  }
  // Use a token guaranteed not to equal the real one.
  const wrongToken = org.webhook_token === "definitely-wrong-zzz" ? "definitely-wrong-aaa" : "definitely-wrong-zzz";
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: baseHeaders({ "X-Webhook-Token": wrongToken }),
    body: sampleBody(org.id),
  });
  const json = await res.json();
  assertEquals(res.status, 403, `expected 403, got ${res.status}: ${JSON.stringify(json)}`);
  assertEquals(json.error, "invalid_webhook_token");
});

Deno.test("400 when body is missing required fields", async () => {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: baseHeaders({ "X-Webhook-Token": "x" }),
    body: JSON.stringify({}),
  });
  const json = await res.json();
  assertEquals(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(json)}`);
});

Deno.test("403 with VALID org_id but wrong token (explicit case)", async () => {
  const org = await getRealOrg();
  if (!org) {
    console.warn("⚠ Skipping: no organizations available or SUPABASE_SERVICE_ROLE_KEY missing.");
    return;
  }
  // Sanity: confirm org_id is real (distinct from placeholder) so 404 path cannot be reached.
  assert(
    org.id && org.id !== "00000000-0000-0000-0000-000000000000",
    "expected a real org_id distinct from placeholder",
  );

  // Token guaranteed to differ from the stored one.
  const wrongToken = `${org.webhook_token}-tampered`;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: baseHeaders({ "X-Webhook-Token": wrongToken }),
    body: sampleBody(org.id),
  });
  const json = await res.json();

  assertEquals(
    res.status,
    403,
    `expected 403 for valid org + wrong token, got ${res.status}: ${JSON.stringify(json)}`,
  );
  assertEquals(json.error, "invalid_webhook_token");
  assert(
    typeof json.message === "string" && json.message.toLowerCase().includes("token"),
    `expected message to mention 'token', got: ${json.message}`,
  );
});

// ===== Cooldown tests =====
// These need SERVICE_KEY to seed/cleanup a temp rule and read smart_trigger_logs.

const REST = `${SUPABASE_URL}/rest/v1`;
const svcHeaders = (extra: Record<string, string> = {}) => ({
  apikey: SERVICE_KEY!,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
  ...extra,
});

async function createCooldownRule(orgId: string, cooldown: number, key: string): Promise<string | null> {
  const res = await fetch(`${REST}/smart_trigger_rules`, {
    method: "POST",
    headers: svcHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({
      org_id: orgId,
      name: `__cooldown_test_${key}`,
      mode: "automation",
      scope: "org",
      trigger_source: "webhook",
      trigger_key: key,
      enabled: true,
      cooldown_seconds: cooldown,
      duration_seconds: 5,
      priority: 100,
    }),
  });
  if (!res.ok) { console.warn("create rule failed:", res.status, await res.text()); return null; }
  const arr = await res.json();
  return Array.isArray(arr) && arr[0]?.id ? arr[0].id : null;
}

async function deleteRule(ruleId: string) {
  // Clean up the rule and any logs it produced.
  await fetch(`${REST}/smart_trigger_logs?rule_id=eq.${ruleId}`, { method: "DELETE", headers: svcHeaders() })
    .then((r) => r.text());
  await fetch(`${REST}/smart_trigger_rules?id=eq.${ruleId}`, { method: "DELETE", headers: svcHeaders() })
    .then((r) => r.text());
}

async function getLogs(ruleId: string) {
  const res = await fetch(
    `${REST}/smart_trigger_logs?rule_id=eq.${ruleId}&select=success,error_message,trigger_payload,created_at&order=created_at.asc`,
    { headers: svcHeaders() },
  );
  if (!res.ok) { await res.text(); return []; }
  return await res.json() as Array<{ success: boolean; error_message: string | null; trigger_payload: any; created_at: string }>;
}

Deno.test("cooldown_seconds blocks repeat firing and writes cooldown_active log", async () => {
  const org = await getRealOrg();
  if (!org || !SERVICE_KEY) {
    console.warn("⚠ Skipping cooldown test: need SUPABASE_SERVICE_ROLE_KEY and an existing org.");
    return;
  }

  const key = `cd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const ruleId = await createCooldownRule(org.id, 60, key);
  if (!ruleId) { console.warn("⚠ Skipping: could not create test rule"); return; }

  try {
    const headers = baseHeaders({ "X-Webhook-Token": org.webhook_token });
    const body = JSON.stringify({
      org_id: org.id,
      trigger_source: "webhook",
      trigger_key: key,
      payload: {},
    });

    // 1st call: should fire
    const r1 = await fetch(ENDPOINT, { method: "POST", headers, body });
    const j1 = await r1.json();
    assertEquals(r1.status, 200, `1st call expected 200, got ${r1.status}: ${JSON.stringify(j1)}`);
    assertEquals(j1.matched_count, 1, `1st call should fire 1 rule, got ${JSON.stringify(j1)}`);
    assertEquals(j1.skipped_count ?? 0, 0);

    // 2nd call (immediate): should be blocked by cooldown
    const r2 = await fetch(ENDPOINT, { method: "POST", headers, body });
    const j2 = await r2.json();
    assertEquals(r2.status, 200, `2nd call expected 200, got ${r2.status}: ${JSON.stringify(j2)}`);
    assertEquals(j2.matched_count, 0, `2nd call should NOT fire (cooldown), got ${JSON.stringify(j2)}`);
    assertEquals(j2.skipped_count, 1, `2nd call should report 1 skip, got ${JSON.stringify(j2)}`);
    assertEquals(j2.skipped_rules?.[0]?.reason, "cooldown_active");
    assert(j2.skipped_rules?.[0]?.remaining_seconds > 0, "remaining_seconds should be > 0");

    // Allow eventual write, then verify smart_trigger_logs entries
    await new Promise((r) => setTimeout(r, 500));
    const logs = await getLogs(ruleId);

    const successLogs = logs.filter((l) => l.success === true);
    const cooldownLogs = logs.filter(
      (l) => l.success === false && (l.error_message ?? "").startsWith("cooldown_active"),
    );
    assertEquals(successLogs.length, 1, `expected 1 success log, got ${successLogs.length}: ${JSON.stringify(logs)}`);
    assertEquals(cooldownLogs.length, 1, `expected 1 cooldown_active log, got ${cooldownLogs.length}: ${JSON.stringify(logs)}`);

    // Cooldown log payload should carry the diagnostic _cooldown block
    const cd = cooldownLogs[0].trigger_payload?._cooldown;
    assert(cd && typeof cd === "object", "cooldown log payload missing _cooldown block");
    assertEquals(cd.cooldown_seconds, 60);
    assert(cd.remaining_seconds > 0, "_cooldown.remaining_seconds should be > 0");
    assert(typeof cd.last_fired_at === "string" && cd.last_fired_at.length > 0);
  } finally {
    await deleteRule(ruleId);
  }
});

// Explicit per-screen cooldown isolation: an org-scope rule must apply to
// every screen in the org, but its cooldown timer must be tracked
// independently per screen_id. Re-firing on the same screen is blocked,
// while a different screen can still fire.
Deno.test("org-scope rule with screen_id: cooldown blocks ONLY the same screen, not other screens", async () => {
  const org = await getRealOrg();
  if (!org || !SERVICE_KEY) {
    console.warn("⚠ Skipping per-screen cooldown isolation test: need SUPABASE_SERVICE_ROLE_KEY and an existing org.");
    return;
  }
  const screens = await getOrCreateScreens(org.id);
  if (!screens) { console.warn("⚠ Skipping: could not obtain two screens"); return; }

  const key = `cdiso_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  // Org-scope rule (scope=org), 60s cooldown.
  const ruleId = await createCooldownRule(org.id, 60, key);
  if (!ruleId) { console.warn("⚠ Skipping: could not create test rule"); return; }

  try {
    const headers = baseHeaders({ "X-Webhook-Token": org.webhook_token });
    const post = (screen_id: string) => fetch(ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({
        org_id: org.id,
        screen_id,
        trigger_source: "webhook",
        trigger_key: key,
        payload: {},
      }),
    }).then(async (r) => ({ status: r.status, json: await r.json() }));

    // 1) Screen A first fire -> success
    const a1 = await post(screens.a);
    assertEquals(a1.status, 200);
    assertEquals(a1.json.matched_count, 1, `A1 should fire: ${JSON.stringify(a1.json)}`);
    assertEquals(a1.json.skipped_count ?? 0, 0);

    // 2) Screen A immediate re-fire -> blocked by cooldown
    const a2 = await post(screens.a);
    assertEquals(a2.status, 200);
    assertEquals(a2.json.matched_count, 0, `A2 should be blocked: ${JSON.stringify(a2.json)}`);
    assertEquals(a2.json.skipped_count, 1);
    assertEquals(a2.json.skipped_rules?.[0]?.id, ruleId);
    assertEquals(a2.json.skipped_rules?.[0]?.reason, "cooldown_active");
    assert(a2.json.skipped_rules?.[0]?.remaining_seconds > 0);

    // 3) Screen B first fire -> success (cooldown is per-screen, not global)
    const b1 = await post(screens.b);
    assertEquals(b1.status, 200);
    assertEquals(
      b1.json.matched_count, 1,
      `B1 should fire independently of A's cooldown: ${JSON.stringify(b1.json)}`,
    );
    assertEquals(b1.json.skipped_count ?? 0, 0);

    // 4) Screen B immediate re-fire -> blocked by its own cooldown
    const b2 = await post(screens.b);
    assertEquals(b2.status, 200);
    assertEquals(b2.json.matched_count, 0, `B2 should be blocked: ${JSON.stringify(b2.json)}`);
    assertEquals(b2.json.skipped_count, 1);
    assertEquals(b2.json.skipped_rules?.[0]?.reason, "cooldown_active");

    // 5) Screen A again -> still blocked (its 60s window is unaffected by B's activity)
    const a3 = await post(screens.a);
    assertEquals(a3.status, 200);
    assertEquals(a3.json.matched_count, 0, `A3 should still be blocked: ${JSON.stringify(a3.json)}`);
    assertEquals(a3.json.skipped_count, 1);

    // Verify the persisted log breakdown per screen.
    await new Promise((r) => setTimeout(r, 500));
    const detail = await fetch(
      `${REST}/smart_trigger_logs?rule_id=eq.${ruleId}&select=success,screen_id,error_message&order=created_at.asc`,
      { headers: svcHeaders() },
    );
    const rows = await detail.json() as Array<{ success: boolean; screen_id: string | null; error_message: string | null }>;

    const aRows = rows.filter((r) => r.screen_id === screens.a);
    const bRows = rows.filter((r) => r.screen_id === screens.b);
    const otherRows = rows.filter((r) => r.screen_id !== screens.a && r.screen_id !== screens.b);

    assertEquals(otherRows.length, 0, `unexpected logs for other screens: ${JSON.stringify(otherRows)}`);

    // Screen A: 1 success + 2 cooldown_active (a2 and a3)
    assertEquals(
      aRows.filter((r) => r.success).length, 1,
      `expected 1 success log for A, got ${JSON.stringify(aRows)}`,
    );
    assertEquals(
      aRows.filter((r) => !r.success && (r.error_message ?? "").startsWith("cooldown_active")).length, 2,
      `expected 2 cooldown_active logs for A, got ${JSON.stringify(aRows)}`,
    );

    // Screen B: 1 success + 1 cooldown_active (b2)
    assertEquals(
      bRows.filter((r) => r.success).length, 1,
      `expected 1 success log for B, got ${JSON.stringify(bRows)}`,
    );
    assertEquals(
      bRows.filter((r) => !r.success && (r.error_message ?? "").startsWith("cooldown_active")).length, 1,
      `expected 1 cooldown_active log for B, got ${JSON.stringify(bRows)}`,
    );
  } finally {
    await deleteRule(ruleId);
    await deleteScreensIfTemp([screens.a, screens.b]);
  }
});

Deno.test("zero cooldown_seconds allows back-to-back firing", async () => {
  const org = await getRealOrg();
  if (!org || !SERVICE_KEY) {
    console.warn("⚠ Skipping zero-cooldown test: need SUPABASE_SERVICE_ROLE_KEY and an existing org.");
    return;
  }

  const key = `nocd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const ruleId = await createCooldownRule(org.id, 0, key);
  if (!ruleId) { console.warn("⚠ Skipping: could not create test rule"); return; }

  try {
    const headers = baseHeaders({ "X-Webhook-Token": org.webhook_token });
    const body = JSON.stringify({
      org_id: org.id,
      trigger_source: "webhook",
      trigger_key: key,
      payload: {},
    });

    const r1 = await fetch(ENDPOINT, { method: "POST", headers, body });
    const j1 = await r1.json();
    const r2 = await fetch(ENDPOINT, { method: "POST", headers, body });
    const j2 = await r2.json();

    assertEquals(j1.matched_count, 1, `1st: ${JSON.stringify(j1)}`);
    assertEquals(j2.matched_count, 1, `2nd should also fire when cooldown=0: ${JSON.stringify(j2)}`);
    assertEquals(j2.skipped_count ?? 0, 0);
  } finally {
    await deleteRule(ruleId);
  }
});

// ===== Schema validation tests =====

Deno.test("400 invalid_screen_id when screen_id is not a UUID", async () => {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: baseHeaders({ "X-Webhook-Token": "x" }),
    body: JSON.stringify({
      org_id: "00000000-0000-0000-0000-000000000000",
      screen_id: "not-a-uuid",
      trigger_source: "webhook",
      trigger_key: "test",
      payload: {},
    }),
  });
  const json = await res.json();
  assertEquals(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(json)}`);
  assertEquals(json.error, "invalid_screen_id");
});

Deno.test("400 invalid_screen_id when screen_id is empty string", async () => {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: baseHeaders({ "X-Webhook-Token": "x" }),
    body: JSON.stringify({
      org_id: "00000000-0000-0000-0000-000000000000",
      screen_id: "",
      trigger_source: "webhook",
      trigger_key: "test",
      payload: {},
    }),
  });
  const json = await res.json();
  assertEquals(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(json)}`);
  assertEquals(json.error, "invalid_screen_id");
});

// ===== Cooldown scoping by screen_id =====
// Helpers to fetch / create a screen we can use.

async function getOrCreateScreens(orgId: string): Promise<{ a: string; b: string } | null> {
  // Try to find two existing screens in the org.
  const existing = await fetch(
    `${REST}/screens?org_id=eq.${orgId}&select=id&limit=2`,
    { headers: svcHeaders() },
  );
  if (existing.ok) {
    const arr = await existing.json() as Array<{ id: string }>;
    if (arr.length >= 2) return { a: arr[0].id, b: arr[1].id };
  } else {
    await existing.text();
  }
  // Otherwise create two temp screens (cleaned up at end of test).
  const mk = async (name: string) => {
    const r = await fetch(`${REST}/screens`, {
      method: "POST",
      headers: svcHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify({ org_id: orgId, name }),
    });
    if (!r.ok) { console.warn("create screen failed:", r.status, await r.text()); return null; }
    const a = await r.json();
    return Array.isArray(a) && a[0]?.id ? a[0].id as string : null;
  };
  const a = await mk(`__cdscope_a_${Date.now()}`);
  const b = await mk(`__cdscope_b_${Date.now()}`);
  if (!a || !b) return null;
  return { a, b };
}

async function deleteScreensIfTemp(ids: string[]) {
  for (const id of ids) {
    await fetch(`${REST}/screens?id=eq.${id}&name=like.__cdscope_*`, {
      method: "DELETE", headers: svcHeaders(),
    }).then((r) => r.text());
  }
}

Deno.test("cooldown is scoped by screen_id when provided (different screens don't block each other)", async () => {
  const org = await getRealOrg();
  if (!org || !SERVICE_KEY) {
    console.warn("⚠ Skipping screen-scoped cooldown test: need SUPABASE_SERVICE_ROLE_KEY and an existing org.");
    return;
  }
  const screens = await getOrCreateScreens(org.id);
  if (!screens) { console.warn("⚠ Skipping: could not obtain two screens"); return; }

  const key = `cdscope_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const ruleId = await createCooldownRule(org.id, 60, key);
  if (!ruleId) { console.warn("⚠ Skipping: could not create test rule"); return; }

  try {
    const headers = baseHeaders({ "X-Webhook-Token": org.webhook_token });
    const mkBody = (screen_id: string) => JSON.stringify({
      org_id: org.id, screen_id, trigger_source: "webhook", trigger_key: key, payload: {},
    });

    // Fire on screen A
    const r1 = await fetch(ENDPOINT, { method: "POST", headers, body: mkBody(screens.a) });
    const j1 = await r1.json();
    assertEquals(j1.matched_count, 1, `A 1st should fire: ${JSON.stringify(j1)}`);

    // Same screen A again -> blocked
    const r2 = await fetch(ENDPOINT, { method: "POST", headers, body: mkBody(screens.a) });
    const j2 = await r2.json();
    assertEquals(j2.matched_count, 0, `A 2nd should be blocked by cooldown: ${JSON.stringify(j2)}`);
    assertEquals(j2.skipped_count, 1);

    // Different screen B should NOT be blocked (cooldown is scoped per screen)
    const r3 = await fetch(ENDPOINT, { method: "POST", headers, body: mkBody(screens.b) });
    const j3 = await r3.json();
    assertEquals(
      j3.matched_count, 1,
      `B should fire independently of A's cooldown: ${JSON.stringify(j3)}`,
    );
    assertEquals(j3.skipped_count ?? 0, 0);

    // Verify log scoping
    await new Promise((r) => setTimeout(r, 500));
    const logs = await getLogs(ruleId);
    const aSuccess = logs.filter((l) => l.success && (l as any).screen_id === undefined).length; // shape note
    // Re-fetch with screen_id projected
    const detail = await fetch(
      `${REST}/smart_trigger_logs?rule_id=eq.${ruleId}&select=success,screen_id,error_message&order=created_at.asc`,
      { headers: svcHeaders() },
    );
    const rows = await detail.json() as Array<{ success: boolean; screen_id: string | null; error_message: string | null }>;
    const successByScreen = rows.filter((r) => r.success);
    assertEquals(
      successByScreen.filter((r) => r.screen_id === screens.a).length, 1,
      `expected 1 success log for screen A, got rows=${JSON.stringify(rows)}`,
    );
    assertEquals(
      successByScreen.filter((r) => r.screen_id === screens.b).length, 1,
      `expected 1 success log for screen B, got rows=${JSON.stringify(rows)}`,
    );
    const cdRows = rows.filter((r) => !r.success && (r.error_message ?? "").startsWith("cooldown_active"));
    assertEquals(cdRows.length, 1, `expected exactly 1 cooldown_active log (for screen A), got ${JSON.stringify(rows)}`);
    assertEquals(cdRows[0].screen_id, screens.a);
    void aSuccess;
  } finally {
    await deleteRule(ruleId);
    await deleteScreensIfTemp([screens.a, screens.b]);
  }
});

Deno.test("cooldown without screen_id is global (omitting screen_id blocks repeat regardless of source)", async () => {
  const org = await getRealOrg();
  if (!org || !SERVICE_KEY) {
    console.warn("⚠ Skipping no-screen cooldown test: need SUPABASE_SERVICE_ROLE_KEY and an existing org.");
    return;
  }

  const key = `cdnoscreen_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const ruleId = await createCooldownRule(org.id, 60, key);
  if (!ruleId) { console.warn("⚠ Skipping: could not create test rule"); return; }

  try {
    const headers = baseHeaders({ "X-Webhook-Token": org.webhook_token });
    const body = JSON.stringify({
      org_id: org.id, trigger_source: "webhook", trigger_key: key, payload: {},
      // screen_id intentionally omitted
    });

    const r1 = await fetch(ENDPOINT, { method: "POST", headers, body });
    const j1 = await r1.json();
    assertEquals(j1.matched_count, 1, `1st (no screen) should fire: ${JSON.stringify(j1)}`);

    const r2 = await fetch(ENDPOINT, { method: "POST", headers, body });
    const j2 = await r2.json();
    assertEquals(j2.matched_count, 0, `2nd (no screen) should be blocked: ${JSON.stringify(j2)}`);
    assertEquals(j2.skipped_count, 1);
    assertEquals(j2.skipped_rules?.[0]?.reason, "cooldown_active");

    // Verify both logs are written with screen_id = NULL
    await new Promise((r) => setTimeout(r, 500));
    const detail = await fetch(
      `${REST}/smart_trigger_logs?rule_id=eq.${ruleId}&select=success,screen_id,error_message&order=created_at.asc`,
      { headers: svcHeaders() },
    );
    const rows = await detail.json() as Array<{ success: boolean; screen_id: string | null; error_message: string | null }>;
    assert(rows.every((r) => r.screen_id === null), `expected all logs screen_id=null, got ${JSON.stringify(rows)}`);
    assertEquals(rows.filter((r) => r.success).length, 1);
    assertEquals(
      rows.filter((r) => !r.success && (r.error_message ?? "").startsWith("cooldown_active")).length, 1,
    );
  } finally {
    await deleteRule(ruleId);
  }
});
