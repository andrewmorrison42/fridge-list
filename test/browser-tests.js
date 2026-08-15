#!/usr/bin/env node
/*
 * The Fridge List — browser tests
 *
 *   npm install          (once)
 *   npm run test:browser
 *
 * These cover the things run-tests.js deliberately cannot: anything that needs a real
 * DOM, a real service worker, or real print media. That includes the two bugs that
 * actually lost people's ticks in a supermarket, both of which were invisible to unit
 * tests because the merge logic was correct the whole time — it was the DOM that was
 * wrong.
 *
 * Unlike run-tests.js this needs playwright-core and a Chromium build, so it is kept
 * separate: `npm test` stays dependency-free and always runnable.
 *
 * Two suites need to reach inside the app's IIFE (nothing is exposed on window by
 * design). Rather than add test hooks to the shipped file, they publish a temporary
 * instrumented copy under test/.tmp/ and serve that. Production code carries no test
 * surface at all.
 *
 * Each suite gets its own port and its own browser context, so the service worker
 * registered by the offline suite cannot serve a cached page to any other suite.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(__dirname, '.tmp');

/* ---------- dependency check, with a useful message rather than a stack trace ---------- */

let chromium;
try {
  ({ chromium } = require('playwright-core'));
} catch (e) {
  console.error('\nplaywright-core is not installed.\n');
  console.error('  npm install        # then re-run npm run test:browser\n');
  console.error('The dependency-free logic tests still run with: npm test\n');
  process.exit(2);
}

// Find a Chromium. Prefer an explicit override, then a managed browsers directory
// (CI images often set PLAYWRIGHT_BROWSERS_PATH), then playwright's own default.
function findChromium() {
  if (process.env.FRIDGE_TEST_CHROMIUM) return process.env.FRIDGE_TEST_CHROMIUM;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(require('os').homedir(), '.cache/ms-playwright')]
    .filter(Boolean);
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const dir of fs.readdirSync(root)) {
      if (!/^chromium/.test(dir)) continue;
      for (const rel of ['chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
                         'chrome-win/chrome.exe', 'chrome-linux/headless_shell']) {
        const p = path.join(root, dir, rel);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  try { return chromium.executablePath(); } catch (e) { return null; }
}

const EXECUTABLE = findChromium();
if (!EXECUTABLE || !fs.existsSync(EXECUTABLE)) {
  console.error('\nNo Chromium build found.\n');
  console.error('  npx playwright install chromium\n');
  console.error('Or point at an existing one:  FRIDGE_TEST_CHROMIUM=/path/to/chrome npm run test:browser\n');
  process.exit(2);
}

/* ---------- harness ---------- */

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else {
    fail++; failures.push(name);
    console.log('  ✗ ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : ''));
  }
}
function group(name) { console.log('\n' + name); }

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.png': 'image/png',
               '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

/* A static server for one suite. `indexFile` lets a suite serve an instrumented copy
   as "/" while still serving sw.js, icons and the manifest from the real repo. */
function serve(port, indexFile) {
  let up = true;
  const server = http.createServer((req, res) => {
    if (!up) { req.socket.destroy(); return; }           // simulate the network going away
    const rel = req.url === '/' ? null : req.url.split('?')[0].replace(/^\//, '');
    const file = rel === null || rel === 'index.html' ? (indexFile || path.join(ROOT, 'index.html'))
                                                      : path.join(ROOT, rel);
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise(resolve => server.listen(port, () => resolve({
    port,
    pause() { up = false; },
    resume() { up = true; },
    close() { return new Promise(r => server.close(r)); }
  })));
}

/* Publish a copy of index.html with a test hook spliced in just before the app's IIFE
   closes. Keeps every test hook out of the shipped file. */
function instrument(name, hookSource) {
  fs.mkdirSync(TMP, { recursive: true });
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const end = html.lastIndexOf('})();');
  if (end < 0) throw new Error('Could not find the end of the main IIFE in index.html');
  const out = path.join(TMP, name);
  fs.writeFileSync(out, html.slice(0, end) + '\n' + hookSource + '\n' + html.slice(end));
  return out;
}

// Console noise that is environmental rather than a real defect: the MSAL CDN is
// blocked in sandboxes and offline, and the offline suite deliberately kills the server.
const IGNORE = /ERR_TUNNEL|msauth|Failed to load resource|net::|ERR_CONNECTION|ERR_EMPTY_RESPONSE/;

function watchErrors(page, sink) {
  page.on('pageerror', e => sink.push('pageerror: ' + e.message));
  page.on('console', m => {
    const t = m.text();
    if (m.type() === 'error' && !IGNORE.test(t)) sink.push('console: ' + t);
  });
}

// Pick two recipes and land on the shopping list.
async function buildAList(page) {
  await page.click('#mainNav button[data-tab="start"]');
  await page.waitForTimeout(300);
  const boxes = await page.$$('input[type=checkbox]');
  await boxes[0].check();
  await boxes[1].check();
  await page.waitForTimeout(400);
  await page.click('#mainNav button[data-tab="review"]');
  await page.waitForTimeout(600);
}

const readShopping = page => page.evaluate(() => JSON.parse(localStorage.getItem('fma_shopping_v4')));

/* ---------- suites ---------- */

async function suiteTicksSurviveRebuild(browser) {
  group('ticks survive a mid-trip rebuild of the list');
  const srv = await serve(8171);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = []; watchErrors(page, errs);
  try {
    await page.goto('http://localhost:8171/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    await buildAList(page);

    const rows = await page.$$('.shop-row');
    for (let i = 0; i < 3; i++) { await rows[i].$eval('input[type=checkbox]', c => c.click()); await page.waitForTimeout(120); }
    const before = await readShopping(page);
    const tickedBefore = before.shoppingList.filter(l => l.checked).length;
    ok('three ticks recorded', tickedBefore === 3, tickedBefore);
    ok('each tick carries its own stamp', before.shoppingList.filter(l => l.checkedAt).length === 3);
    ok('the trip has an id', !!before.weekPlan.tripId);

    // Adding a Wait List entry changes the signature and triggers a regenerate. Before
    // v21.0 that rebuilt every line with checked:false and wiped the whole trip.
    await page.click('#mainNav button[data-tab="needed"]');
    await page.waitForTimeout(300);
    await page.fill('#app input[type=text]', 'kitchen roll');
    await page.click('#app >> text="Add to wait list"');
    await page.waitForTimeout(400);

    // Assert the trigger really fired. Matching the button by the wrong label once made
    // this suite pass against code that had the bug, because nothing was ever added.
    const mid = await readShopping(page);
    ok('the Wait List entry was actually added',
       mid.neededList.some(n => /kitchen roll/i.test(n.text)), mid.neededList.map(n => n.text));

    await page.click('#mainNav button[data-tab="review"]');
    await page.waitForTimeout(600);

    const after = await readShopping(page);
    ok('the list really was rebuilt (the new item is on it)',
       after.shoppingList.some(l => /kitchen roll/i.test(l.ingredientName)),
       after.shoppingList.map(l => l.ingredientName));
    const tickedAfter = after.shoppingList.filter(l => l.checked).length;
    ok('ticks survive the rebuild', tickedAfter === tickedBefore, { before: tickedBefore, after: tickedAfter });
    const domTicked = await page.evaluate(() => document.querySelectorAll('.shop-row.ticked').length);
    ok('the screen agrees with the saved state', domTicked === tickedAfter, { dom: domTicked, state: tickedAfter });
    ok('no console errors', errs.length === 0, errs);
  } finally { await ctx.close(); await srv.close(); }
}

async function suiteRemoteMergeKeepsTicks(browser) {
  group('a tick still registers after a sync replaces the state');
  // The two-shopper bug: mergeShoppingData returns a fresh object, so swapping
  // shoppingData without repainting left every row wired to an orphaned line.
  const file = instrument('merge-hook.html',
    'window.__t = { apply: applyMergedShopping, merge: mergeShoppingData, sd: () => shoppingData };');
  const srv = await serve(8172, file);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = []; watchErrors(page, errs);
  try {
    await page.goto('http://localhost:8172/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    await buildAList(page);

    const rows = await page.$$('.shop-row');
    await rows[0].$eval('input[type=checkbox]', c => c.click());   // this phone ticks one
    await page.waitForTimeout(200);

    // The other shopper's file arrives: a structurally separate object, same trip,
    // with a different item ticked and a newer lastUpdated.
    const merged = await page.evaluate(() => {
      const sd = JSON.parse(localStorage.getItem('fma_shopping_v4'));
      const remote = JSON.parse(JSON.stringify(sd));
      const target = remote.shoppingList.find(l => !l.checked && !l.removed && !l.atHome);
      const later = new Date(Date.now() + 60000).toISOString();
      target.checked = true; target.checkedAt = later; target.changedAt = later;
      remote.lastUpdated = later;
      window.__t.apply(window.__t.merge(window.__t.sd(), remote));
      return {
        ticked: window.__t.sd().shoppingList.filter(l => l.checked).length,
        dom: document.querySelectorAll('.shop-row.ticked').length
      };
    });
    ok('both shoppers\' ticks are kept', merged.ticked === 2, merged);
    ok('the screen was repainted to match', merged.dom === 2, merged);

    // Now tap a row that was rendered BEFORE the merge swapped the object graph.
    const fresh = await page.$$('.shop-row:not(.ticked)');
    await fresh[0].$eval('input[type=checkbox]', c => c.click());
    await page.waitForTimeout(300);

    const final = await readShopping(page);
    ok('a tap on a pre-merge row still persists', final.shoppingList.filter(l => l.checked).length === 3,
       final.shoppingList.filter(l => l.checked).map(l => l.ingredientName));
    ok('no console errors', errs.length === 0, errs);
  } finally { await ctx.close(); await srv.close(); }
}

async function suiteWriteSplitting(browser) {
  group('only the file that changed is queued for upload');
  // Regression: every tick used to re-upload the ~1MB recipe database.
  const file = instrument('write-hook.html',
    'window.__t = { dirty: () => ({ r: pendingSaveRecipes, s: pendingSaveShopping }),' +
    ' reset: () => { pendingSaveRecipes = false; pendingSaveShopping = false; }, persist };');
  const srv = await serve(8173, file);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = []; watchErrors(page, errs);
  try {
    await page.goto('http://localhost:8173/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    await buildAList(page);

    await page.evaluate(() => window.__t.reset());
    const rows = await page.$$('.shop-row');
    await rows[0].$eval('input[type=checkbox]', c => c.click());
    await page.waitForTimeout(200);
    const afterTick = await page.evaluate(() => window.__t.dirty());
    ok('ticking queues only the shopping list', afterTick.s === true && afterTick.r === false, afterTick);

    await page.evaluate(() => { window.__t.reset(); window.__t.persist('recipes'); });
    const afterRecipe = await page.evaluate(() => window.__t.dirty());
    ok('a recipe edit queues only the recipes', afterRecipe.r === true && afterRecipe.s === false, afterRecipe);

    await page.evaluate(() => { window.__t.reset(); window.__t.persist(); });
    const afterBoth = await page.evaluate(() => window.__t.dirty());
    ok('an unscoped save still queues both', afterBoth.r === true && afterBoth.s === true, afterBoth);
    ok('no console errors', errs.length === 0, errs);
  } finally { await ctx.close(); await srv.close(); }
}

async function suiteStapleQuantities(browser) {
  group('staples carry a quantity onto the list');
  const srv = await serve(8176);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = []; watchErrors(page, errs);
  try {
    await page.goto('http://localhost:8176/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);

    // The staples list is feature-gated. Ensure it ends up ON rather than blindly
    // toggling — it already ships enabled in the seed data, so a click would turn it off.
    await page.click('#mainNav button[data-tab="settings"]');
    await page.waitForTimeout(500);
    const wasOn = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('fma_recipes_v4')).settings.features.staples);
    if (!wasOn) { await page.click('text="Staples list"'); await page.waitForTimeout(600); }
    ok('the staples section is available',
       await page.evaluate(() => [...document.querySelectorAll('button')]
         .some(b => b.textContent.trim() === 'Add staple')));

    // The shopping-unit audit renders on this same tab; make sure it draws and expands
    // against the real recipe data rather than throwing halfway through Settings.
    const audit = await page.evaluate(() => {
      const h = [...document.querySelectorAll('h3')].find(x => /Amounts that look wrong/.test(x.textContent));
      if (!h) return null;
      const strong = h.nextElementSibling.querySelector('strong');
      return { summary: strong ? strong.textContent : null };
    });
    ok('the shopping-unit audit renders', audit !== null, audit);
    ok('and reports a count', audit && /\d+ amount\(s\)/.test(audit.summary || ''), audit);
    await page.click('button:has-text("Show the list")');
    await page.waitForTimeout(300);
    const expanded = await page.evaluate(() => {
      const h = [...document.querySelectorAll('h3')].find(x => /Amounts that look wrong/.test(x.textContent));
      return h.nextElementSibling.querySelectorAll('.checkbox-row').length;
    });
    ok('and lists the offending amounts when expanded', expanded > 0, expanded);

    // Add a staple that no recipe uses, with a free-text quantity.
    await page.fill('input[placeholder="ingredient name…"]', 'Kitchen roll');
    await page.fill('input[placeholder="qty"]', '2 rolls');
    await page.click('button:has-text("Add staple")');
    await page.waitForTimeout(500);

    const stored = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('fma_recipes_v4')).settings;
      return { staples: s.staples, qty: s.stapleQty };
    });
    ok('the staple is stored as a plain string (old builds still parse it)',
       stored.staples.every(s => typeof s === 'string'), stored.staples);
    ok('the quantity is stored alongside, not inside', stored.qty['Kitchen roll'] === '2 rolls', stored.qty);

    // Generate a list and check the quantity reaches it.
    await buildAList(page);
    const line = await page.evaluate(() => {
      const sd = JSON.parse(localStorage.getItem('fma_shopping_v4'));
      return sd.shoppingList.find(l => /kitchen roll/i.test(l.ingredientName)) || null;
    });
    ok('the staple is on the generated list', !!line, line);
    ok('carrying its quantity', line && (line.textQtyParts || []).indexOf('2 rolls') !== -1, line);

    const shown = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.shop-row')]
        .find(r => /kitchen roll/i.test(r.textContent));
      return row ? row.querySelector('.shop-name').textContent : null;
    });
    ok('and showing it on screen', shown && shown.indexOf('2 rolls') !== -1, shown);

    const printed = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.print-shopping-section .item-row')]
        .find(r => /kitchen roll/i.test(r.textContent));
      return rows ? rows.textContent : null;
    });
    ok('and on the printout', printed && printed.indexOf('2 rolls') !== -1, printed);

    // Editing a quantity must reach a list that has already been generated — and must
    // not cost the shopper their ticks doing it.
    const rows = await page.$$('.shop-row');
    await rows[0].$eval('input[type=checkbox]', c => c.click());
    await page.waitForTimeout(200);
    const tickedBefore = (await readShopping(page)).shoppingList.filter(l => l.checked).length;

    await page.click('#mainNav button[data-tab="settings"]');
    await page.waitForTimeout(500);
    const qtyBox = await page.$('input[aria-label="Quantity of Kitchen roll"]');
    ok('the quantity is editable on an existing staple', !!qtyBox);
    await qtyBox.fill('5 rolls');
    await qtyBox.evaluate(e => e.blur());
    await page.waitForTimeout(400);

    await page.click('#mainNav button[data-tab="review"]');
    await page.waitForTimeout(700);
    const after = await readShopping(page);
    const updated = after.shoppingList.find(l => /kitchen roll/i.test(l.ingredientName));
    ok('the edited quantity reaches the existing list',
       updated && (updated.textQtyParts || []).indexOf('5 rolls') !== -1, updated && updated.textQtyParts);
    ok('and the old quantity is gone', updated && (updated.textQtyParts || []).indexOf('2 rolls') === -1,
       updated && updated.textQtyParts);
    ok('ticks survive the staple edit',
       after.shoppingList.filter(l => l.checked).length === tickedBefore,
       { before: tickedBefore, after: after.shoppingList.filter(l => l.checked).length });

    // A staple a recipe also needs shows BOTH amounts, rather than one replacing the other.
    const target = await page.evaluate(() => {
      const sd = JSON.parse(localStorage.getItem('fma_shopping_v4'));
      const l = sd.shoppingList.find(x => x.hasNumeric && x.sources && x.sources.length);
      return l ? l.ingredientName : null;
    });
    if (target) {
      await page.click('#mainNav button[data-tab="settings"]');
      await page.waitForTimeout(500);
      await page.fill('input[placeholder="ingredient name…"]', target);
      await page.fill('input[placeholder="qty"]', '1 extra');
      await page.click('button:has-text("Add staple")');
      await page.waitForTimeout(500);
      await page.click('#mainNav button[data-tab="review"]');
      await page.waitForTimeout(700);
      const merged = await page.evaluate(n => {
        const sd = JSON.parse(localStorage.getItem('fma_shopping_v4'));
        return sd.shoppingList.find(x => x.ingredientName === n) || null;
      }, target);
      ok('a recipe amount and a staple amount are both kept',
         merged && merged.hasNumeric && (merged.textQtyParts || []).indexOf('1 extra') !== -1, merged);
    }
    ok('no console errors', errs.length === 0, errs);
  } finally { await ctx.close(); await srv.close(); }
}

async function suitePrinting(browser) {
  group('printing survives Safari capturing the page late');
  const srv = await serve(8174);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = []; watchErrors(page, errs);
  try {
    // Safari returns from window.print() before it has captured the page. Stubbing it
    // to return immediately reproduces that; the old code then stripped the print class
    // on a 500ms timer and every element was hidden by the time the capture happened.
    await page.addInitScript(() => {
      window.__printCalls = [];
      window.print = function () { window.__printCalls.push(document.body.className); };
    });
    await page.goto('http://localhost:8174/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    await buildAList(page);

    for (const [tab, label, section] of [
      ['menu', /Print weekly menu/, '.print-menu-section'],
      ['review', /^Print shopping list$/, '.print-shopping-section']
    ]) {
      await page.click(`#mainNav button[data-tab="${tab}"]`);
      await page.waitForTimeout(500);
      await page.evaluate(() => { window.__printCalls = []; });
      for (const b of await page.$$('button')) {
        if (label.test((await b.textContent()).trim())) { await b.click(); break; }
      }
      await page.waitForTimeout(300);
      const calls = await page.evaluate(() => window.__printCalls);
      ok(tab + ': the print class is applied before print() runs',
         calls.length === 1 && /printing-/.test(calls[0]), calls);

      await page.waitForTimeout(3000);              // the old code reset at 500ms
      await page.emulateMedia({ media: 'print' });
      const state = await page.evaluate(sel => {
        const visible = n => { for (let e = n; e; e = e.parentElement) { if (getComputedStyle(e).display === 'none') return false; } return true; };
        const el = document.querySelector(sel);
        const texts = [...document.querySelectorAll('main *')]
          .filter(n => visible(n) && n.children.length === 0 && n.innerText && n.innerText.trim());
        return { sectionShown: el ? getComputedStyle(el).display : null, printedNodes: texts.length };
      }, section);
      ok(tab + ': the printable section is still shown at a late capture', state.sectionShown === 'block', state);
      ok(tab + ': the page is not blank', state.printedNodes > 0, state);
      await page.emulateMedia({ media: 'screen' });
    }

    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await page.waitForTimeout(200);
    const cls = await page.evaluate(() => document.body.className.trim());
    ok('print mode is cleared afterwards', !/printing-/.test(cls), cls);
    ok('no console errors', errs.length === 0, errs);
  } finally { await ctx.close(); await srv.close(); }
}

async function suiteOfflineAndSession(browser) {
  group('the app opens with no network, and remembers where you were');
  const srv = await serve(8175);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = []; watchErrors(page, errs);
  try {
    await page.goto('http://localhost:8175/', { waitUntil: 'load' });
    await page.waitForTimeout(2500);

    const sw = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return { registered: !!reg, active: !!(reg && reg.active) };
    });
    ok('the service worker is active', sw.registered && sw.active, sw);

    const cache = await page.evaluate(async () => {
      const keys = await caches.keys();
      if (!keys.length) return { urls: [] };
      const entries = await (await caches.open(keys[0])).keys();
      return { name: keys[0], urls: entries.map(r => new URL(r.url).pathname) };
    });
    ok('the page itself is cached', cache.urls.some(u => u === '/' || u === '/index.html'), cache);

    // Take the network away entirely and open the app in a new tab.
    srv.pause();
    const offlinePage = await ctx.newPage();
    let reached = true;
    try { await offlinePage.goto('http://localhost:8175/', { waitUntil: 'domcontentloaded', timeout: 15000 }); }
    catch (e) { reached = false; }
    await offlinePage.waitForTimeout(2500);
    const offline = reached
      ? await offlinePage.evaluate(() => ({
          tabs: document.querySelectorAll('#mainNav button').length,
          version: (document.body.innerText.match(/v\d+\.\d+/) || [])[0] || null
        }))
      : { tabs: 0, version: null };
    ok('the app loads with the network down', offline.tabs === 6, offline);
    ok('and it is a real build, not a fallback page', /^v\d+\.\d+$/.test(offline.version || ''), offline);
    await offlinePage.close();

    // Back online: the page must come from the network, or a cached copy would pin
    // the family on an old build.
    srv.resume();
    const onlinePage = await ctx.newPage();
    await onlinePage.goto('http://localhost:8175/', { waitUntil: 'load' });
    await onlinePage.waitForTimeout(1500);

    await onlinePage.click('#mainNav button[data-tab="needed"]');
    await onlinePage.waitForTimeout(400);
    await onlinePage.reload({ waitUntil: 'load' });
    await onlinePage.waitForTimeout(2000);
    const tab = await onlinePage.evaluate(() => {
      const b = document.querySelector('#mainNav button.active');
      return b && b.dataset.tab;
    });
    ok('a reload puts you back on the tab you were using', tab === 'needed', tab);
    ok('no console errors', errs.length === 0, errs);
  } finally { await ctx.close(); await srv.close(); }
}

/* ---------- run ---------- */

(async () => {
  console.log('Chromium: ' + EXECUTABLE);
  const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ['--no-sandbox'] });
  try {
    // A suite that throws is a failed suite, not a reason to abandon the run — the
    // remaining suites still have something useful to say about the build.
    for (const suite of [suiteTicksSurviveRebuild, suiteRemoteMergeKeepsTicks,
                         suiteWriteSplitting, suiteStapleQuantities,
                         suitePrinting, suiteOfflineAndSession]) {
      try { await suite(browser); }
      catch (e) {
        fail++; failures.push(suite.name);
        console.log('  ✗ ' + suite.name + ' threw: ' + (e && e.message ? e.message.split('\n')[0] : e));
      }
    }
  } finally {
    await browser.close();
    fs.rmSync(TMP, { recursive: true, force: true });
  }

  console.log('\n' + '-'.repeat(48));
  if (fail) {
    console.log(fail + ' failed, ' + pass + ' passed\n');
    failures.forEach(f => console.log('  FAILED: ' + f));
    process.exit(1);
  }
  console.log('all ' + pass + ' passed');
})().catch(e => { console.error(e); fs.rmSync(TMP, { recursive: true, force: true }); process.exit(1); });
