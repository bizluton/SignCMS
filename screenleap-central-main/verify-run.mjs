import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'http://localhost:8080';
const SS = '/tmp/signcms-verify';
fs.mkdirSync(SS, { recursive: true });

const results = [];
function log(icon, msg) {
  const line = `${icon} ${msg}`;
  console.log(line);
  results.push(line);
}

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: false,
  args: ['--window-size=1440,900'],
});

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', e => log('⚠️', `JS: ${e.message.slice(0,100)}`));

const ss = async (n) => {
  await page.screenshot({ path: `${SS}/${n}.png` });
};

const navTo = async (hash) => {
  const cur = page.url();
  if (!cur.startsWith(BASE)) await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });
  await page.evaluate(h => { window.location.hash = h; }, hash);
  await page.waitForFunction(h => window.location.hash.includes(h), hash, { timeout: 15000 });
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
};

// ── Root / auth ───────────────────────────────────────────────────────────────
log('🔧', 'Loading root…');
await page.goto(BASE, { waitUntil: 'networkidle', timeout: 25000 });
const hash0 = await page.evaluate(() => window.location.hash);
log(hash0.includes('/auth') ? '⚠️' : '✅', `root → ${hash0}`);
await ss('00-root');

if (hash0.includes('/auth')) {
  log('⚠️', 'Not authenticated — cannot test further');
  await browser.close();
  process.exit(1);
}

// ── 1. ContentStudio ─────────────────────────────────────────────────────────
log('\n===', '1. ContentStudio 新建專案');
await navTo('/studio');
await ss('01-studio');
const studioHash = await page.evaluate(() => window.location.hash);
log(studioHash.includes('/studio') ? '✅' : '❌', `studio hash: ${studioHash}`);

const tabNames = await page.locator('[role=tab]').allTextContents();
log(tabNames.length > 0 ? '✅' : '❌', `tabs: ${JSON.stringify(tabNames.slice(0,4))}`);

// Click 新建專案 / New Project tab
const newTab = page.locator('[role=tab]').filter({ hasText: /新建專案|New Project/ }).first();
if (await newTab.count() > 0) {
  await newTab.click();
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
  log('✅', 'Clicked 新建專案 tab');
} else {
  log('⚠️', '新建專案 tab not found');
}
await ss('02-studio-new-tab');

// Check canvas or input area is visible
const canvasArea = page.locator('#stage, [data-canvas], .canvas-area, textarea, [placeholder*="專案"]').first();
const canvasVisible = await canvasArea.isVisible({ timeout: 3000 }).catch(() => false);
log(canvasVisible ? '✅' : '⚠️', `canvas/input area visible: ${canvasVisible}`);

// ── 2 & 3. Schedules ─────────────────────────────────────────────────────────
log('\n===', '2. SchedulesPage 新增排程');
await navTo('/schedules');
await ss('03-schedules');
const schHash = await page.evaluate(() => window.location.hash);
log(schHash.includes('/schedules') ? '✅' : '❌', `schedules hash: ${schHash}`);

// All buttons visible
const btnTexts = await page.locator('button:visible').allTextContents();
log('🔍', `visible buttons: ${JSON.stringify(btnTexts.filter(t => t.trim()).slice(0,10))}`);

const addBtn = page.locator('button').filter({ hasText: /新增排程|新增|Add Schedule/ }).first();
const addExists = await addBtn.count() > 0;

if (addExists) {
  await addBtn.click();
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
  await ss('04-schedule-dialog');
  log('✅', 'Add schedule dialog opened');

  // Tabs in dialog
  const dialogTabTexts = await page.locator('[role=dialog] [role=tab], [role=dialog] button[data-state]')
    .allTextContents().catch(() => []);
  log('🔍', `dialog tabs: ${JSON.stringify(dialogTabTexts)}`);

  // 專案 tab
  const projTab = page.locator('[role=dialog]').locator('[role=tab], button').filter({ hasText: /^專案$|Project/ }).first();
  if (await projTab.count() > 0) {
    await projTab.click();
    await page.waitForTimeout(500);
    log('✅', '專案 tab clicked');
    await ss('05-sched-project');
    
    // Verify project dropdown or list visible
    const projSel = page.locator('[role=dialog]').locator('select, [role=combobox], [role=listbox]').first();
    const projSelVisible = await projSel.isVisible({ timeout: 2000 }).catch(() => false);
    log(projSelVisible ? '✅' : '⚠️', `project selector visible: ${projSelVisible}`);
  } else {
    log('⚠️', '專案 tab not found inside dialog');
    await ss('05-sched-no-proj-tab');
  }

  // 3. 頻道 tab
  log('\n===', '3. SchedulesPage 頻道排程');
  const chTab = page.locator('[role=dialog]').locator('[role=tab], button').filter({ hasText: /^頻道$|Channel/ }).first();
  if (await chTab.count() > 0) {
    await chTab.click();
    await page.waitForTimeout(500);
    log('✅', '頻道 tab clicked');
    await ss('06-sched-channel');
    
    const chSel = page.locator('[role=dialog]').locator('select, [role=combobox], [role=listbox]').first();
    const chSelVisible = await chSel.isVisible({ timeout: 2000 }).catch(() => false);
    log(chSelVisible ? '✅' : '⚠️', `channel selector visible: ${chSelVisible}`);
  } else {
    log('⚠️', '頻道 tab not found inside dialog');
    await ss('06-sched-no-ch-tab');
  }

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
} else {
  log('❌', '新增排程 button NOT found on page');
  await ss('04-no-add-btn');
}

// ── 4. QuickPublish ───────────────────────────────────────────────────────────
log('\n===', '4. QuickPublish');
await navTo('/quick-publish');
await ss('07-quickpublish');
const qpHash = await page.evaluate(() => window.location.hash);
log(qpHash.includes('/quick-publish') ? '✅' : '❌', `hash: ${qpHash}`);

await page.waitForTimeout(1500);
await ss('07b-quickpublish-loaded');

// Check screen list
const screenCheckboxes = page.locator('input[type=checkbox]');
const cbCount = await screenCheckboxes.count();
log(cbCount > 0 ? '✅' : '⚠️', `checkboxes (screen rows): ${cbCount}`);

// Project selector
const projCombo = page.locator('[role=combobox], select').first();
const projComboVis = await projCombo.isVisible({ timeout: 3000 }).catch(() => false);
log(projComboVis ? '✅' : '⚠️', `project selector visible: ${projComboVis}`);

// Publish button
const pubBtns = await page.locator('button').filter({ hasText: /發佈|Publish/ }).all();
for (const btn of pubBtns) {
  const txt = await btn.textContent();
  const dis = await btn.isDisabled();
  log('✅', `  publish btn: "${txt?.trim()}" disabled=${dis}`);
}
log(pubBtns.length > 0 ? '✅' : '❌', `publish button count: ${pubBtns.length}`);
await ss('08-quickpublish-buttons');

// ── 5. PublishingCenter ───────────────────────────────────────────────────────
log('\n===', '5. PublishingCenter');
await navTo('/publishing-center');
await ss('09-pubcenter');
const pcHash = await page.evaluate(() => window.location.hash);
log(pcHash.includes('/publishing-center') ? '✅' : '❌', `hash: ${pcHash}`);

await page.waitForTimeout(2000);
await ss('09b-pubcenter-loaded');

const pcCbCount = await page.locator('input[type=checkbox]').count();
log(pcCbCount > 0 ? '✅' : '⚠️', `checkboxes: ${pcCbCount}`);

const pcPubBtns = await page.locator('button').filter({ hasText: /發佈|Publish/ }).all();
for (const btn of pcPubBtns) {
  const txt = await btn.textContent();
  const dis = await btn.isDisabled();
  log('✅', `  publish btn: "${txt?.trim()}" disabled=${dis}`);
}
log(pcPubBtns.length > 0 ? '✅' : '❌', `publish button count: ${pcPubBtns.length}`);
await ss('10-pubcenter-buttons');

await browser.close();
console.log('\n\n=== SUMMARY ===');
results.forEach(r => console.log(r));
