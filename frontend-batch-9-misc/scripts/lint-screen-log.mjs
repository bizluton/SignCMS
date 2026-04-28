#!/usr/bin/env node
/**
 * Lint: detect legacy `logScreenEvent` / `logScreenEvents` call sites
 * that don't carry both `eventCode` and `eventParams` (the structured i18n
 * fields used by the screen_logs display layer).
 *
 * Exit code 0 = clean, 1 = violations found.
 *
 * Usage:
 *   node scripts/lint-screen-log.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const EXTS = new Set([".ts", ".tsx"]);
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "components/ui"]);
// Don't lint the logger implementation itself.
const SKIP_FILES = new Set(["src/lib/screenLogger.ts"]);

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

/**
 * Walk `src` from index `start` (must point at an opening bracket char in
 * `open`/`close`) and return the index just past the matching closer,
 * respecting nested brackets and string literals.
 */
function matchBracket(src, start, open, close) {
  let depth = 0;
  let inStr = null;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (ch === "\\") { i++; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}

/** Split the body of an array literal into top-level object-literal entries. */
function splitObjectEntries(arrayBody) {
  const items = [];
  let depthCurly = 0;
  let depthBracket = 0;
  let depthParen = 0;
  let inStr = null;
  let start = -1;
  for (let i = 0; i < arrayBody.length; i++) {
    const ch = arrayBody[i];
    if (inStr) {
      if (ch === "\\") { i++; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
    if (ch === "{") {
      if (depthCurly === 0 && depthBracket === 0 && depthParen === 0) start = i;
      depthCurly++;
    } else if (ch === "}") {
      depthCurly--;
      if (depthCurly === 0 && depthBracket === 0 && depthParen === 0 && start !== -1) {
        items.push({ body: arrayBody.slice(start, i + 1), offset: start });
        start = -1;
      }
    } else if (ch === "[") depthBracket++;
    else if (ch === "]") depthBracket--;
    else if (ch === "(") depthParen++;
    else if (ch === ")") depthParen--;
  }
  return items;
}

function checkObject(body) {
  return {
    hasEventCode: /\beventCode\s*:/.test(body),
    hasEventParams: /\beventParams\s*:/.test(body),
  };
}

const violations = [];
const files = walk(SRC);

for (const file of files) {
  const relFile = relative(ROOT, file);
  if (SKIP_FILES.has(relFile.replaceAll("\\", "/"))) continue;
  const src = readFileSync(file, "utf8");
  if (!src.includes("logScreenEvent")) continue;

  // Match both `logScreenEvent(` and `logScreenEvents(` (singular + bulk).
  const re = /\blogScreenEvents?\s*\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const fnName = src.slice(m.index, m.index + m[0].length - 1).trim();
    const parenStart = m.index + m[0].length - 1;
    const parenEnd = matchBracket(src, parenStart, "(", ")");
    if (parenEnd < 0) continue;
    const argsRaw = src.slice(parenStart + 1, parenEnd - 1).trimStart();

    const lineNo = src.slice(0, m.index).split("\n").length;

    // Singular form: argument is a single object literal.
    if (fnName === "logScreenEvent") {
      const objStart = argsRaw.indexOf("{");
      if (objStart === -1) continue;
      const absStart = parenStart + 1 + (argsRaw.length - argsRaw.trimStart().length) + objStart;
      const realStart = src.indexOf("{", parenStart);
      const objEnd = matchBracket(src, realStart, "{", "}");
      if (objEnd < 0) continue;
      const body = src.slice(realStart, objEnd);
      const { hasEventCode, hasEventParams } = checkObject(body);
      if (!hasEventCode || !hasEventParams) {
        violations.push({
          file: relFile,
          line: lineNo,
          fn: fnName,
          missing: [!hasEventCode && "eventCode", !hasEventParams && "eventParams"].filter(Boolean).join(", "),
          snippet: body.split("\n").slice(0, 4).join("\n").trim(),
        });
      }
      continue;
    }

    // Bulk form: argument may be an array literal OR an identifier (built elsewhere).
    // Only inspect array literals where we can statically see each entry.
    const arrStart = src.indexOf("[", parenStart);
    if (arrStart === -1 || arrStart > parenEnd) continue;
    const arrEnd = matchBracket(src, arrStart, "[", "]");
    if (arrEnd < 0 || arrEnd > parenEnd) continue;
    const arrayBody = src.slice(arrStart + 1, arrEnd - 1);
    for (const item of splitObjectEntries(arrayBody)) {
      const { hasEventCode, hasEventParams } = checkObject(item.body);
      if (!hasEventCode || !hasEventParams) {
        const itemLine = lineNo + src.slice(m.index, arrStart + 1 + item.offset).split("\n").length - 1;
        violations.push({
          file: relFile,
          line: itemLine,
          fn: fnName,
          missing: [!hasEventCode && "eventCode", !hasEventParams && "eventParams"].filter(Boolean).join(", "),
          snippet: item.body.split("\n").slice(0, 4).join("\n").trim(),
        });
      }
    }
  }
}

if (violations.length === 0) {
  console.log("✓ screen-log lint: every logScreenEvent[s] call carries eventCode + eventParams.");
  process.exit(0);
}

console.error(`✗ screen-log lint: found ${violations.length} call site(s) missing structured i18n fields.\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  (${v.fn}, missing: ${v.missing})`);
  console.error(`    ${v.snippet.replace(/\n/g, "\n    ")}\n`);
}
console.error("Migrate these to include both `eventCode` and `eventParams` (see mem://features/system-logs).");
process.exit(1);
