/**
 * Auth load / stress test
 *
 * Simulates concurrent sign-in and sign-up requests against the
 * Supabase auth endpoints via the local Vite dev server proxy.
 *
 * Usage:
 *   node tests/load/auth-load.mjs
 *   CONCURRENCY=50 ITERATIONS=200 node tests/load/auth-load.mjs
 *
 * Environment variables:
 *   BASE_URL    – base URL of the running app (default: http://localhost:8080)
 *   SUPABASE_URL – Supabase project URL (default: read from .env)
 *   SUPABASE_ANON_KEY – anon/publishable key (default: read from .env)
 *   CONCURRENCY  – simultaneous users (default: 20)
 *   ITERATIONS   – total requests per scenario (default: 100)
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "../../");

// ── Load env ────────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = join(ROOT, ".env");
  if (!existsSync(envPath)) return {};
  const raw = readFileSync(envPath, "utf8");
  const vars = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) vars[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return vars;
}

const env = loadEnv();
const SUPABASE_URL =
  process.env.SUPABASE_URL || env.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || "";
const CONCURRENCY = parseInt(process.env.CONCURRENCY || "20", 10);
const ITERATIONS = parseInt(process.env.ITERATIONS || "100", 10);

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    "❌  Missing SUPABASE_URL or SUPABASE_ANON_KEY.\n" +
      "   Either set env vars or ensure .env exists with VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.",
  );
  process.exit(1);
}

// ── Metrics ──────────────────────────────────────────────────────────────────
class Metrics {
  #success = 0;
  #failure = 0;
  #durations = [];

  record(durationMs, ok) {
    this.#durations.push(durationMs);
    if (ok) this.#success++;
    else this.#failure++;
  }

  summary(label) {
    const total = this.#durations.length;
    const sorted = [...this.#durations].sort((a, b) => a - b);
    const sum = sorted.reduce((s, v) => s + v, 0);
    const p50 = sorted[Math.floor(total * 0.5)] ?? 0;
    const p95 = sorted[Math.floor(total * 0.95)] ?? 0;
    const p99 = sorted[Math.floor(total * 0.99)] ?? 0;

    console.log(`\n── ${label} ──────────────────────────`);
    console.log(`  Total requests : ${total}`);
    console.log(`  Success        : ${this.#success}`);
    console.log(`  Failure        : ${this.#failure}`);
    console.log(
      `  Error rate     : ${((this.#failure / total) * 100).toFixed(1)}%`,
    );
    console.log(`  Mean latency   : ${(sum / total).toFixed(0)} ms`);
    console.log(`  p50 latency    : ${p50} ms`);
    console.log(`  p95 latency    : ${p95} ms`);
    console.log(`  p99 latency    : ${p99} ms`);
    console.log(`  Min / Max      : ${sorted[0]} / ${sorted[total - 1]} ms`);
  }

  get errorRate() {
    return this.#failure / (this.#success + this.#failure);
  }
}

// ── Request helpers ───────────────────────────────────────────────────────────
async function signIn(email, password) {
  const start = Date.now();
  let ok = false;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    // 200 = success, 400 = invalid credentials (expected in load test), anything else = infra issue
    ok = res.status === 200 || res.status === 400;
  } catch {
    ok = false;
  }
  return { durationMs: Date.now() - start, ok };
}

async function signUp(email, password) {
  const start = Date.now();
  let ok = false;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        email,
        password,
        data: { full_name: "Load Test User" },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    // 200 = queued for verification, 422 = already exists (both count as "server responded")
    ok = res.status === 200 || res.status === 422;
  } catch {
    ok = false;
  }
  return { durationMs: Date.now() - start, ok };
}

// ── Concurrency runner ────────────────────────────────────────────────────────
/**
 * Run `total` tasks with at most `concurrency` in flight at once.
 * `factory(index)` returns a Promise<{durationMs, ok}>.
 */
async function runConcurrent(label, total, concurrency, factory) {
  const metrics = new Metrics();
  let index = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (index < total) {
      const i = index++;
      const result = await factory(i);
      metrics.record(result.durationMs, result.ok);
      process.stdout.write(result.ok ? "." : "X");
    }
  });
  await Promise.all(workers);
  console.log(); // newline after dots
  metrics.summary(label);
  return metrics;
}

// ── Scenarios ─────────────────────────────────────────────────────────────────
console.log(
  `\n🔧  Config: concurrency=${CONCURRENCY}, iterations=${ITERATIONS}, target=${SUPABASE_URL}\n`,
);

// Scenario 1: Concurrent sign-in attempts (with intentionally wrong credentials
// to avoid polluting real accounts — we just measure endpoint responsiveness).
const signinMetrics = await runConcurrent(
  "Sign-in (invalid-credentials baseline)",
  ITERATIONS,
  CONCURRENCY,
  (i) => signIn(`loadtest-user-${i % 20}@loadtest.invalid`, "wrong-password"),
);

// Scenario 2: Concurrent sign-up attempts (each with a unique email to avoid
// rate-limiting from duplicate submissions — uses loadtest.invalid domain).
const signupMetrics = await runConcurrent(
  "Sign-up (unique emails)",
  ITERATIONS,
  CONCURRENCY,
  (i) =>
    signUp(
      `loadtest-signup-${Date.now()}-${i}@loadtest.invalid`,
      "Load@Test123!",
    ),
);

// ── Pass / Fail ────────────────────────────────────────────────────────────────
console.log("\n── Results ───────────────────────────────────");
const signInPass = signinMetrics.errorRate < 0.05;
const signUpPass = signupMetrics.errorRate < 0.05;
console.log(`  Sign-in scenario : ${signInPass ? "✅ PASS" : "❌ FAIL"} (error rate < 5%)`);
console.log(`  Sign-up scenario : ${signUpPass ? "✅ PASS" : "❌ FAIL"} (error rate < 5%)`);

if (!signInPass || !signUpPass) {
  console.error(
    "\n⚠️  One or more scenarios exceeded the 5% error-rate threshold.\n" +
      "   This may indicate Supabase rate limiting, network issues, or infra problems.\n" +
      "   Review the metrics above for p95/p99 latency spikes.",
  );
  process.exit(1);
}

console.log("\n✅  All load-test scenarios passed.\n");
