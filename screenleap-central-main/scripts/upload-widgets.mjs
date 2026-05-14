#!/usr/bin/env node
/**
 * Upload system-widget HTML files from supabase/system-widgets/ to Supabase Storage.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/upload-widgets.mjs
 *
 * The script uploads every index.html found under supabase/system-widgets/<widget>/
 * into the "system-widgets" Storage bucket at the same relative path.
 */

import fs   from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.join(__dirname, '..');

const SUPABASE_URL      = process.env.VITE_SUPABASE_URL
                       || 'https://narhbpojjtnalyfiwxue.supabase.co';
const SERVICE_ROLE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SERVICE_ROLE_KEY) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY env var is required.');
  console.error('  export SUPABASE_SERVICE_ROLE_KEY=<your service role key>');
  console.error('  node scripts/upload-widgets.mjs');
  process.exit(1);
}

const WIDGETS_DIR = path.join(ROOT, 'supabase', 'system-widgets');
const BUCKET      = 'system-widgets';

// Collect all index.html files under supabase/system-widgets/**
function findHtmlFiles(dir, base = dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findHtmlFiles(full, base));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      results.push({ fullPath: full, storagePath: path.relative(base, full).replace(/\\/g, '/') });
    }
  }
  return results;
}

const files = findHtmlFiles(WIDGETS_DIR);
console.log(`Uploading ${files.length} widget file(s) to storage bucket "${BUCKET}"…\n`);

for (const { fullPath, storagePath } of files) {
  const content = fs.readFileSync(fullPath);
  const url     = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`;

  const res = await fetch(url, {
    method:  'PUT',
    headers: {
      'Authorization':  `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type':   'text/html; charset=utf-8',
      'Cache-Control':  'no-cache',
      'x-upsert':       'true',
    },
    body: content,
  });

  const body = await res.text();
  if (res.ok) {
    console.log(`  ✓ ${storagePath}`);
  } else {
    console.error(`  ✗ ${storagePath}  →  ${res.status} ${body}`);
    process.exitCode = 1;
  }
}

console.log('\nDone.');
