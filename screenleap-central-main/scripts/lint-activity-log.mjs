#!/usr/bin/env node
/**
 * Lint: detect legacy `logActivity({ ... detail: buildDetail(...) ... })`
 * call sites that have NOT been migrated to `actionParams`.
 *
 * Exit code 0 = clean, 1 = violations found.
 *
 * Usage:
 *   node scripts/lint-activity-log.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const EXTS = new Set([".ts", ".tsx"]);
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "components/ui"]);

/** Recursively walk a directory and return matching files. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = relative(SRC, full);
    if (SKIP_DIRS.has(entry) || SKIP_DIRS.has(rel)) continue;
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (EXTS.has(full.slice(full.lastIndexOf(".")))) out.push(full);
  }
  return out;
}

/** Find balanced `logActivity({ ... })` blocks starting at index `start`. */
function extractCallBlocks(src) {
  const blocks = [];
  const re = /logActivity\s*\(\s*\{/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const startBrace = m.index + m[0].length - 1;
    let depth = 0;
    let i = startBrace;
    let inStr = null;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (inStr) {
        if (ch === "\\") { i++; continue; }
        if (ch === inStr) inStr = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
      if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) { i++; break; } }
    }
    const body = src.slice(startBrace, i);
    const lineNo = src.slice(0, m.index).split("\n").length;
    blocks.push({ body, lineNo, index: m.index });
  }
  return blocks;
}

const violations = [];
const files = walk(SRC);

for (const file of files) {
  const src = readFileSync(file, "utf8");
  if (!src.includes("logActivity")) continue;
  const blocks = extractCallBlocks(src);
  for (const b of blocks) {
    const hasBuildDetail = /\bdetail\s*:\s*buildDetail\s*\(/.test(b.body);
    const hasActionParams = /\bactionParams\s*:/.test(b.body);
    if (hasBuildDetail && !hasActionParams) {
      violations.push({
        file: relative(ROOT, file),
        line: b.lineNo,
        snippet: b.body.split("\n").slice(0, 6).join("\n").trim(),
      });
    }
  }
}

if (violations.length === 0) {
  console.log("✓ activity-log lint: no legacy `detail: buildDetail(...)` call sites found.");
  process.exit(0);
}

console.error(`✗ activity-log lint: found ${violations.length} legacy call site(s).\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}`);
  console.error(`    ${v.snippet.replace(/\n/g, "\n    ")}\n`);
}
console.error("Migrate these to `actionParams: { ... }` (see .lovable/memory/features/activity-log-events.md).");
process.exit(1);
