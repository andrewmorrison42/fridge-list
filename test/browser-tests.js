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

/* Wait until the app is up AND is going to stay up.

   Two things make a fixed wait after goto() a gamble, and three suites flaked on
   1800ms during one session:

     - startup begins at DOMContentLoaded, which waits on the MSAL script from a CDN
       that sandboxes and CI machines block, so how long that request takes to FAIL
       decides how long startup takes;
     - on a fresh context the service worker takes control a moment after the first
       paint, and `controllerchange` reloads the page once. A click landing in that
       gap talks to a document that is about to be thrown away — which is what the
       flakes actually were.

   So: wait for the worker to be in control (it cannot reload for that reason again),
   then for the app to have painted. If no worker ever takes control, fall through and
   just wait for paint. */
async function waitForApp(page) {
  await page.waitForFunction(
    () => !('serviceWorker' in navigator) || !!navigator.serviceWorker.controller,
    null, { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(
    () => { const a = document.getElementById('app'); return !!a && a.children.length > 0; },
    null, { timeout: 30000 });
}

// Pick two recipes and land on the shopping list.
async function buildAList(page) {
  await page.click('#mainNav button[data-tab="start"]');
  // Wait for the grid rather than guessing at it: 635 recipe cards do not always
  // render inside a fixed 300ms on a loaded machine, and this helper is shared by
  // most of the suites below — a miss here failed a suite that was working fine.
  await page.waitForSelector('#app input[type=checkbox]', { timeout: 15000 });
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
    await waitForApp(page);
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
    await waitForApp(page);
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
    await waitForApp(page);
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
  group('staple amounts add into the shopping list');
  const srv = await serve(8176);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = []; watchErrors(page, errs);
  try {
    await page.goto('http://localhost:8176/', { waitUntil: 'domcontentloaded' });
    await waitForApp(page);

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

    // Add a staple that no recipe uses. Amounts are numbers in the ingredient's own
    // shopping unit; "Kitchen roll" is new, so it is counted and the number stands alone.
    await page.fill('input[placeholder="ingredient name…"]', 'Kitchen roll');
    await page.fill('input[placeholder="qty"]', '2');
    await page.click('button:has-text("Add staple")');
    await page.waitForTimeout(500);

    const stored = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('fma_recipes_v4')).settings;
      return { staples: s.staples, qty: s.stapleQty };
    });
    ok('the staple is stored as a plain string (old builds still parse it)',
       stored.staples.every(s => typeof s === 'string'), stored.staples);
    ok('the amount is stored alongside as a number', stored.qty['Kitchen roll'] === 2, stored.qty);

    // Generate a list and check the amount reaches it as a real quantity.
    await buildAList(page);
    const line = await page.evaluate(() => {
      const sd = JSON.parse(localStorage.getItem('fma_shopping_v4'));
      return sd.shoppingList.find(l => /kitchen roll/i.test(l.ingredientName)) || null;
    });
    ok('the staple is on the generated list', !!line, line);
    ok('counted as a numeric amount, not free text',
       line && line.hasNumeric === true && line.totalQty === 2 && (line.textQtyParts || []).length === 0, line);

    const shown = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.shop-row')]
        .find(r => /kitchen roll/i.test(r.textContent));
      return row ? row.querySelector('.shop-name').textContent : null;
    });
    ok('and showing on screen', shown && /^2 Kitchen roll/.test(shown.trim()), shown);

    const printed = await page.evaluate(() => {
      const r = [...document.querySelectorAll('.print-shopping-section .item-row')]
        .find(x => /kitchen roll/i.test(x.textContent));
      return r ? r.textContent : null;
    });
    ok('and on the printout', printed && printed.indexOf('2') !== -1, printed);

    // Editing an amount must reach a list that has already been generated — and must
    // not cost the shopper their ticks doing it.
    const rows = await page.$$('.shop-row');
    await rows[0].$eval('input[type=checkbox]', c => c.click());
    await page.waitForTimeout(200);
    const tickedBefore = (await readShopping(page)).shoppingList.filter(l => l.checked).length;

    await page.click('#mainNav button[data-tab="settings"]');
    await page.waitForTimeout(500);
    const qtyBox = await page.$('input[aria-label="Quantity of Kitchen roll"]');
    ok('the amount is editable on an existing staple', !!qtyBox);
    await qtyBox.fill('5');
    await qtyBox.evaluate(e => e.blur());
    await page.waitForTimeout(400);

    await page.click('#mainNav button[data-tab="review"]');
    await page.waitForTimeout(700);
    const after = await readShopping(page);
    const updated = after.shoppingList.find(l => /kitchen roll/i.test(l.ingredientName));
    ok('the edited amount reaches the existing list', updated && updated.totalQty === 5, updated);
    ok('ticks survive the staple edit',
       after.shoppingList.filter(l => l.checked).length === tickedBefore,
       { before: tickedBefore, after: after.shoppingList.filter(l => l.checked).length });

    // A staple on an ingredient a recipe also needs must ADD to the recipe amount,
    // producing one figure rather than two sitting side by side.
    const target = await page.evaluate(() => {
      const sd = JSON.parse(localStorage.getItem('fma_shopping_v4'));
      const l = sd.shoppingList.find(x => x.hasNumeric && x.sources && x.sources.length && !x.fromStaples);
      return l ? { name: l.ingredientName, total: l.totalQty } : null;
    });
    ok('a recipe-derived line was available to test against', !!target, target);
    if (target) {
      await page.click('#mainNav button[data-tab="settings"]');
      await page.waitForTimeout(500);
      await page.fill('input[placeholder="ingredient name…"]', target.name);
      await page.fill('input[placeholder="qty"]', '100');
      await page.click('button:has-text("Add staple")');
      await page.waitForTimeout(500);
      await page.click('#mainNav button[data-tab="review"]');
      await page.waitForTimeout(700);
      const merged = await page.evaluate(n => {
        const sd = JSON.parse(localStorage.getItem('fma_shopping_v4'));
        return sd.shoppingList.find(x => x.ingredientName === n) || null;
      }, target.name);
      ok('the staple amount is added to the recipe amount',
         merged && Math.abs(merged.totalQty - (target.total + 100)) < 0.001,
         { was: target.total, now: merged && merged.totalQty });
      ok('and it stays a single figure', merged && (merged.textQtyParts || []).length === 0, merged);
    }

    ok('no console errors', errs.length === 0, errs);
  } finally { await ctx.close(); await srv.close(); }
}

async function suiteTypingIsNotInterrupted(browser) {
  group('a background sync never interrupts typing');
  // Regression: the OneDrive load that runs on every open finished with an
  // unconditional render(), landing a couple of seconds in — exactly when someone has
  // opened the app, tapped a field and started typing. The field was rebuilt empty.
  const file = instrument('repaint-hook.html',
    'window.__t = { repaintWhenSafe, applyMergedShopping, mergeShoppingData,' +
    ' sd: () => shoppingData, owed: () => deferredRepaint };');
  const srv = await serve(8177, file);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = []; watchErrors(page, errs);
  try {
    await page.goto('http://localhost:8177/', { waitUntil: 'domcontentloaded' });
    await waitForApp(page);

    for (const [tab, sel, label] of [['needed', '#app input[type=text]', 'wait list box'],
                                     ['recipes', '#app input[type=search]', 'recipe search']]) {
      await page.click(`#mainNav button[data-tab="${tab}"]`);
      await page.waitForTimeout(400);
      const field = await page.$(sel);
      await field.click();
      await page.keyboard.type('half typed');

      const repainted = await page.evaluate(() => window.__t.repaintWhenSafe());
      await page.waitForTimeout(120);
      const state = await page.evaluate(s => {
        const e = document.querySelector(s);
        return { value: e.value, focused: document.activeElement === e };
      }, sel);
      ok(label + ': the repaint is held back', repainted === false);
      ok(label + ': the text survives', state.value === 'half typed', state);
      ok(label + ': focus is kept', state.focused === true, state);
      ok(label + ': the repaint is owed, not dropped',
         await page.evaluate(() => window.__t.owed()) === true);

      // Leaving the field is when it becomes safe to run.
      await page.evaluate(() => document.activeElement.blur());
      await page.waitForTimeout(200);
      ok(label + ': it runs once the field is left',
         await page.evaluate(() => window.__t.owed()) === false);
    }

    // Most opens change nothing; those must not repaint at all.
    await page.click('#mainNav button[data-tab="needed"]');
    await page.waitForTimeout(400);
    const field = await page.$('#app input[type=text]');
    await field.click();
    await page.keyboard.type('still here');
    const noop = await page.evaluate(() => {
      const identical = JSON.parse(JSON.stringify(window.__t.sd()));
      return { changed: window.__t.applyMergedShopping(window.__t.mergeShoppingData(window.__t.sd(), identical)),
               owed: window.__t.owed() };
    });
    ok('a sync returning identical data reports no change', noop.changed === false, noop);
    ok('and does not even owe a repaint', noop.owed === false, noop);
    ok('so the text is untouched',
       await page.evaluate(() => document.querySelector('#app input[type=text]').value) === 'still here');
    ok('no console errors', errs.length === 0, errs);
  } finally { await ctx.close(); await srv.close(); }
}

async function suiteBulkDelete(browser) {
  group('bulk delete, and the safety net under it');
  // Deleting recipes in bulk syncs to every device within seconds, so the guard that
  // matters is not the dialog — it is that the delete cannot happen unless a snapshot
  // was written first, and that it can be put straight back.
  const file = instrument('bulk-hook.html',
    'window.__t = { breakSnapshot: () => { writeRecipesSnapshot = async () =>' +
    ' ({ ok:false, where:"OneDrive", name:"x.json", why:"forced by test" }); },' +
    ' recipeCount: () => recipesData.recipes.length };');
  const srv = await serve(8178, file);
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const errs = []; watchErrors(page, errs);
  const openPicker = async () => {
    await page.click('#mainNav button[data-tab="settings"]');
    await page.waitForTimeout(600);
    await page.click('button:has-text("Choose recipes")');
    await page.waitForTimeout(400);
  };
  const goButton = () => page.evaluate(() =>
    [...document.querySelectorAll('#modalRoot button')].find(b => /snapshot/i.test(b.textContent)).disabled);
  try {
    await page.goto('http://localhost:8178/', { waitUntil: 'domcontentloaded' });
    await waitForApp(page);
    const total = await page.evaluate(() => window.__t.recipeCount());
    ok('the seed has recipes to work with', total > 100, total);

    await openPicker();
    ok('both actions are disabled with nothing ticked',
       await page.evaluate(() => [...document.querySelectorAll('button')]
         .filter(b => /ticked/i.test(b.textContent)).every(b => b.disabled)));

    await page.fill('#app input[type=search]', 'chicken');
    await page.waitForTimeout(300);
    const boxes = await page.$$('#app .checkbox-row input[type=checkbox]');
    for (let i = 0; i < 3; i++) await boxes[i].check();
    await page.waitForTimeout(200);

    // Guard 1, the one that matters: a failed snapshot must stop the delete dead.
    await page.evaluate(() => window.__t.breakSnapshot());
    await page.click('button:has-text("Delete the 3 ticked")');
    await page.waitForTimeout(300);
    await page.fill('#modalRoot input[type=text]', '3');
    await page.waitForTimeout(120);
    await page.click('#modalRoot button:has-text("snapshot")');
    await page.waitForTimeout(600);
    ok('a failed snapshot deletes nothing',
       await page.evaluate(() => window.__t.recipeCount()) === total,
       await page.evaluate(() => window.__t.recipeCount()));
    ok('and says so rather than failing silently',
       /nothing has been deleted/i.test(await page.evaluate(() =>
         document.querySelector('#modalRoot').innerText)));
    await page.click('#modalRoot .close-x');
    await page.waitForTimeout(300);

    // Now the real path, on a fresh load so the snapshot function is restored.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForApp(page);
    await openPicker();
    await page.fill('#app input[type=search]', 'chicken');
    await page.waitForTimeout(300);
    const boxes2 = await page.$$('#app .checkbox-row input[type=checkbox]');
    for (let i = 0; i < 3; i++) await boxes2[i].check();
    await page.waitForTimeout(200);
    await page.click('button:has-text("Delete the 3 ticked")');
    await page.waitForTimeout(300);

    const dialog = await page.evaluate(() => {
      const m = document.querySelector('#modalRoot .modal');
      return { names: [...m.querySelectorAll('li')].map(l => l.textContent) };
    });
    ok('the dialog names what is going, not just a count', dialog.names.length === 3, dialog.names);
    ok('the delete button starts disabled', await goButton() === true);
    await page.fill('#modalRoot input[type=text]', '2');
    await page.waitForTimeout(120);
    ok('the wrong number leaves it disabled', await goButton() === true);
    await page.fill('#modalRoot input[type=text]', '3');
    await page.waitForTimeout(120);
    ok('the right number enables it', await goButton() === false);

    const pending = page.waitForEvent('download').catch(() => null);
    await page.click('#modalRoot button:has-text("snapshot")');
    const download = await Promise.race([pending, new Promise(r => setTimeout(() => r(null), 5000))]);
    await page.waitForTimeout(900);
    ok('a timestamped snapshot is produced',
       !!download && /^recipes-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/.test(download.suggestedFilename()),
       download && download.suggestedFilename());
    ok('exactly the ticked recipes are gone',
       await page.evaluate(() => window.__t.recipeCount()) === total - 3);

    await page.click('#mainNav button[data-tab="settings"]');
    await page.waitForTimeout(600);
    const undo = await page.$('button:has-text("Put back")');
    ok('an undo button appears afterwards', !!undo);
    if (undo) {
      await undo.click();
      await page.waitForTimeout(600);
      ok('undo restores every recipe',
         await page.evaluate(() => window.__t.recipeCount()) === total);
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
    await waitForApp(page);
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

async function suiteShareOneRecipe(browser) {
  group('sharing one recipe out of the book');
  // The point of the feature is that ONE recipe leaves, laid out properly. Both
  // halves are browser work the logic tests cannot see: what actually lands on the
  // clipboard (two flavours of it), and the one-recipe file for another copy of
  // the app.
  const srv = await serve(8179);
  const ctx = await browser.newContext({ acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:8179' });
  const page = await ctx.newPage();
  const errs = []; watchErrors(page, errs);
  try {
    // No OS share sheet in headless Chromium anyway; removed explicitly so the
    // file route is deterministically the download one.
    await page.addInitScript(() => {
      try { delete Navigator.prototype.share; } catch (e) {}
      try { delete Navigator.prototype.canShare; } catch (e) {}
    });
    await page.goto('http://localhost:8179/', { waitUntil: 'domcontentloaded' });
    await waitForApp(page);

    await page.click('#mainNav button[data-tab="recipes"]');
    await page.waitForTimeout(400);
    await page.fill('#app input[type=search]', 'Mushroom Risotto');
    await page.waitForTimeout(300);
    await page.click('#app .recipe-card');
    await page.waitForTimeout(300);

    const shareBtn = await page.$('#modalRoot button:has-text("Share")');
    ok('every recipe has a Share button at the bottom', !!shareBtn);
    ok('the share options stay out of the way until asked for',
       await page.evaluate(() => !!document.querySelector('#modalRoot .card[hidden]')));

    await shareBtn.click();
    await page.waitForTimeout(200);
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll('#modalRoot .card button')].map(b => b.textContent));
    ok('opening it offers both ways of sending', labels.join('|') === 'Copy recipe|Send as a recipe file',
       labels);

    /* --- the clipboard, which is the whole point --- */
    await page.click('#modalRoot button:has-text("Copy recipe")');
    await page.waitForTimeout(500);
    const clip = await page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      const out = { types: [], html: '', text: '' };
      for (const item of items) {
        for (const type of item.types) {
          out.types.push(type);
          const body = await (await item.getType(type)).text();
          if (type === 'text/html') out.html = body;
          if (type === 'text/plain') out.text = body;
        }
      }
      return out;
    });
    ok('both a formatted and a plain version are on the clipboard',
       clip.types.indexOf('text/html') !== -1 && clip.types.indexOf('text/plain') !== -1, clip.types);
    ok('the formatted one has the name as a heading', /<h2>Mushroom Risotto<\/h2>/.test(clip.html),
       clip.html.slice(0, 120));
    ok('the ingredients paste as a bulleted list', /<ul>[\s\S]*<li>/.test(clip.html));
    ok('the method pastes as a numbered list', /<ol>[\s\S]*<li>/.test(clip.html));
    ok('the plain version is readable on its own', /^Mushroom Risotto\n/.test(clip.text));
    ok('the plain version numbers the steps', /\n1\. /.test(clip.text));
    ok('no other recipe travels with it',
       clip.html.indexOf('Apple Crumble') === -1 && clip.text.indexOf('Apple Crumble') === -1);
    ok('the status bar says where it went',
       /paste it into an email or a document/i.test(await page.evaluate(() =>
         document.getElementById('statusBar').textContent)));

    // Pasting it back into a real document: the browser's own parser is the judge
    // of whether the markup is sound.
    const pasted = await page.evaluate(html => {
      const d = document.createElement('div');
      d.innerHTML = html;
      return { h2: d.querySelectorAll('h2').length, uls: d.querySelectorAll('ul').length,
               ols: d.querySelectorAll('ol').length, lis: d.querySelectorAll('li').length,
               text: d.innerText || d.textContent };
    }, clip.html);
    ok('it parses back into a real heading and real lists',
       pasted.h2 === 1 && pasted.uls >= 1 && pasted.ols >= 1 && pasted.lis > 3, pasted);
    ok('and reads as the same recipe', /Mushroom Risotto/.test(pasted.text));

    /* --- the recipe file, for another copy of the app --- */
    const pending = page.waitForEvent('download').catch(() => null);
    await page.click('#modalRoot button:has-text("Send as a recipe file")');
    const download = await Promise.race([pending, new Promise(r => setTimeout(() => r(null), 5000))]);
    ok('a one-recipe file is produced',
       !!download && download.suggestedFilename() === 'fridge-list-mushroom-risotto.json',
       download && download.suggestedFilename());
    const bundle = download ? JSON.parse(fs.readFileSync(await download.path(), 'utf8')) : null;
    ok('it is a share file, not a backup', !!bundle && bundle.fridgeListRecipeShare === 1);
    ok('it holds exactly the one recipe',
       !!bundle && bundle.recipes.length === 1 && bundle.recipes[0].name === 'Mushroom Risotto',
       bundle && bundle.recipes.length);
    ok('it carries the ingredients that recipe needs',
       !!bundle && bundle.ingredients.length > 0 && bundle.ingredients.length < 30,
       bundle && bundle.ingredients.length);
    ok('and none of the rest of the book',
       !!bundle && !('shoppingList' in bundle) && !('settings' in bundle));

    // Closing the panel again leaves the reading screen as it was.
    await page.click('#modalRoot button:has-text("Hide share options")');
    await page.waitForTimeout(150);
    ok('it can be put away again',
       await page.evaluate(() => !!document.querySelector('#modalRoot .card[hidden]')));
    ok('no console errors', errs.length === 0, errs);
  } finally { await ctx.close(); await srv.close(); }
}

async function suiteLiveListNotWiped(browser) {
  group('the week\'s recipes are fixed while a shop is under way');
  // v21.9 replaced a negotiation with a rule. Changing the week's picks mid-shop was
  // the only ordinary way to end up with two lists, so the picks are simply frozen
  // until the shop is finished; the Wait List remains the way to add something. What
  // needs a browser is that the freeze is real, that the Wait List still gets through
  // with the ticks intact, and that finishing the shop lifts it.
  const file = instrument('live-list-hook.html',
    'window.__t = { trip: () => tripIdOf(shoppingData), data: () => JSON.parse(JSON.stringify(shoppingData)),' +
    '               mergeRemote: d => mergeRemoteShopping(d) };');
  const srv = await serve(8180, file);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = []; watchErrors(page, errs);
  page.on('dialog', d => d.accept());
  const ticks = () => page.evaluate(() => window.__t.data().shoppingList.filter(l => l.checked).length);
  const trip = () => page.evaluate(() => window.__t.trip());
  const startTabState = async () => {
    await page.click('#mainNav button[data-tab="start"]');
    await page.waitForSelector('#app input[type=checkbox]', { timeout: 15000 });
    return page.evaluate(() => ({
      notice: (([...document.querySelectorAll('#app .notice-card')]
        .find(n => /shop is under way/i.test(n.innerText)) || {}).innerText) || null,
      pickDisabled: [...document.querySelectorAll('#app .recipe-card input[type=checkbox]')].every(c => c.disabled),
      clearDisabled: !![...document.querySelectorAll('#app button')]
        .find(b => /Clear all selections/.test(b.textContent) && b.disabled)
    }));
  };
  try {
    await page.goto('http://localhost:8180/', { waitUntil: 'domcontentloaded' });
    await waitForApp(page);
    await buildAList(page);
    const rows = await page.$$('.shop-row');
    for (let i = 0; i < 3; i++) { await rows[i].$eval('input[type=checkbox]', c => c.click()); await page.waitForTimeout(120); }
    const liveTrip = await trip();
    ok('three items are in the trolley', await ticks() === 3, await ticks());

    /* --- the picks are frozen, and the tab says why --- */
    const locked = await startTabState();
    ok('the week\'s recipes cannot be changed mid-shop', locked.pickDisabled === true);
    ok('nor cleared', locked.clearDisabled === true);
    ok('and the tab explains it rather than just refusing', !!locked.notice, locked.notice);
    ok('naming what is in the trolley', !!locked.notice && /3 item\(s\)/.test(locked.notice), locked.notice);
    ok('and pointing at the Wait List instead',
       !!locked.notice && /Wait List/i.test(locked.notice), locked.notice);
    ok('with the way out named too',
       !!locked.notice && /Shopping is done/i.test(locked.notice), locked.notice);

    /* --- the Wait List is still the way to add something --- */
    await page.click('#mainNav button[data-tab="needed"]');
    await page.waitForTimeout(300);
    await page.fill('#app input[type=text]', 'kitchen roll');
    await page.click('#app >> text="Add to wait list"');
    await page.waitForTimeout(400);
    await page.click('#mainNav button[data-tab="review"]');
    await page.waitForTimeout(700);
    ok('a Wait List item still reaches the list mid-shop',
       await page.evaluate(() => window.__t.data().shoppingList.some(l => /kitchen roll/i.test(l.ingredientName))));
    ok('without ending the trip', await trip() === liveTrip, { was: liveTrip, now: await trip() });
    ok('and without costing a single tick', await ticks() === 3, await ticks());

    /* --- a phone that never saw this list still cannot take it over --- */
    const afterStale = await page.evaluate(() => {
      const stale = window.__t.data();
      stale.weekPlan.tripId = 'trip:stale-phone';
      stale.weekPlan.generatedAt = new Date(Date.now() + 1000).toISOString();
      stale.weekPlan.supersedes = 'trip:from-last-week';
      stale.weekPlan.basedOn = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
      stale.lastUpdated = new Date(Date.now() + 1000).toISOString();
      stale.shoppingList = stale.shoppingList.map(l => Object.assign({}, l, { checked: false, checkedAt: undefined }));
      window.__t.mergeRemote(stale);
      return { trip: window.__t.trip(), ticks: window.__t.data().shoppingList.filter(l => l.checked).length };
    });
    ok('a stale copy from another phone does not take the trip over', afterStale.trip === liveTrip, afterStale.trip);
    ok('and the trolley is untouched by it', afterStale.ticks === 3, afterStale.ticks);

    /* --- one that deliberately replaces it does, and can be put back --- */
    await page.evaluate(() => {
      const other = window.__t.data();
      other.weekPlan.tripId = 'trip:replacement';
      other.weekPlan.supersedes = window.__t.trip();     // a device that could see ours
      other.weekPlan.generatedAt = new Date().toISOString();
      other.weekPlan.basedOn = new Date().toISOString();
      other.lastUpdated = new Date(Date.now() + 1000).toISOString();
      other.shoppingList = other.shoppingList.map(l => Object.assign({}, l, { checked: false, checkedAt: undefined }));
      window.__t.mergeRemote(other);
    });
    await page.waitForTimeout(500);
    ok('a deliberate replacement from another phone is taken', await trip() === 'trip:replacement', await trip());
    ok('which is what clears the ticks', await ticks() === 0, await ticks());
    const undo = await page.evaluate(() => {
      const c = [...document.querySelectorAll('#app .notice-card')]
        .find(n => /had your ticks on it was replaced/i.test(n.innerText));
      return c ? c.innerText : null;
    });
    ok('and the replaced list is offered back', !!undo && /3 item\(s\) ticked/.test(undo), undo);
    ok('with no offer anywhere to build yet another list',
       await page.evaluate(() => ![...document.querySelectorAll('#app button')]
         .some(b => /make a new list/i.test(b.textContent))));

    await page.click('#app .notice-card button:has-text("Put back the list that was replaced")');
    await page.waitForTimeout(600);
    ok('putting it back brings the ticks with it', await ticks() === 3, await ticks());
    ok('as a trip that deliberately replaces the one that displaced it',
       await page.evaluate(() => window.__t.data().weekPlan.supersedes) === 'trip:replacement');

    /* --- finishing the shop is what frees the recipes again --- */
    await page.click('#app button:has-text("Shopping is done")');
    await page.waitForTimeout(700);
    const unlocked = await startTabState();
    ok('finishing the shop unfreezes the week\'s recipes', unlocked.pickDisabled === false);
    ok('and the notice goes with it', unlocked.notice === null, unlocked.notice);
    ok('Clear all selections works again', unlocked.clearDisabled === false);

    const boxes = await page.$$('#app .recipe-card input[type=checkbox]');
    await boxes[2].check();
    await page.waitForTimeout(400);
    await page.click('#mainNav button[data-tab="review"]');
    await page.waitForTimeout(700);
    ok('and the next list is generated from the new picks',
       await page.evaluate(() => window.__t.data().shoppingList.length) > 0);
    ok('on a trip of its own', await trip() !== 'trip:replacement');
    ok('no console errors', errs.length === 0, errs);
  } finally { await ctx.close(); await srv.close(); }
}

/* ---------- run ---------- *//* ---------- run ---------- */

/* ---------- v22.0: the memory ---------- */

const readTrips = page => page.evaluate(() => {
  const raw = localStorage.getItem('fma_trips_v1');
  return raw ? JSON.parse(raw) : null;
});

async function suiteTripHistory(browser) {
  group('finishing a shop leaves a record behind');
  const srv = await serve(8181);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = []; watchErrors(page, errs);
  page.on('dialog', d => d.accept());
  try {
    await page.goto('http://localhost:8181/', { waitUntil: 'domcontentloaded' });
    await waitForApp(page);
    await buildAList(page);

    ok('nothing is archived before a shop is finished', (await readTrips(page)) === null);

    // Tick three items, one at a time, so their checkedAt stamps are genuinely ordered —
    // that order IS the walking route the archive exists to keep.
    const rows = await page.$$('.shop-row');
    const tickedNames = [];
    for (let i = 0; i < 3; i++) {
      tickedNames.push((await rows[i].$eval('.item-name, .shop-name, label', e => e.textContent) || '').trim());
      await rows[i].$eval('input[type=checkbox]', c => c.click());
      await page.waitForTimeout(150);
    }
    const live = await readShopping(page);
    const liveTripId = live.weekPlan.tripId;
    const picked = live.weekPlan.selections.map(s => s.recipeId);
    ok('the live list has ticks to lose', live.shoppingList.filter(l => l.checked).length === 3);

    await page.click('#app >> text="Shopping is done"');
    await page.waitForTimeout(800);

    const after = await readShopping(page);
    ok('the shopping list is cleared, as it always was', after.shoppingList.length === 0);

    const hist = await readTrips(page);
    ok('but the shop itself is now kept', !!hist && hist.trips.length === 1, hist && hist.trips.length);
    const trip = hist.trips[0];
    ok('under the id of the trip it was', trip.tripId === liveTripId);
    ok('with the lines the list had', trip.lines.length > 0, trip.lines.length);
    ok('the ticks are in the record', trip.lines.filter(l => l.checked).length === 3);
    ok('and so are their stamps — this is the walking order',
       trip.lines.filter(l => l.checked && l.checkedAt).length === 3);
    ok('the ticks are in the order they were made',
       (() => {
         const t = trip.lines.filter(l => l.checked).map(l => Date.parse(l.checkedAt));
         return t.slice().sort((a, b) => a - b).join() === t.sort((a, b) => a - b).join() && t.length === 3;
       })());
    ok('the week the shop was for is in the record too',
       trip.selections.length === picked.length && trip.selections.every(s => picked.includes(s.recipeId)),
       trip.selections);
    ok('and the record is lean — no bulk carried into the archive',
       trip.lines.every(l => l.sources === undefined && l.textQtyParts === undefined));

    /* The archive is written but nothing replays it — the Start tab must NOT offer to
       put a past week back. Removed in v23.0; the record is kept for the cook rate and
       the at-home suggestions, and for looking a past week up. */
    await page.click('#mainNav button[data-tab="start"]');
    await page.waitForSelector('#app input[type=checkbox]', { timeout: 15000 });
    ok('the Start tab does not offer to replay a past week',
       await page.evaluate(() => !/Weeks you have shopped before/i.test(document.getElementById('app').innerText)));
    ok('and offers no way to reinstate one',
       await page.evaluate(() => ![...document.querySelectorAll('#app button')]
         .some(b => /use these again/i.test(b.textContent))));
    ok('no console errors', errs.length === 0, errs);
  } finally { await ctx.close(); await srv.close(); }
}

async function suiteClearSurvivesSync(browser) {
  group('a cleared week is not put back by the other phone');
  /* The reported bug: "Clear all selections" wiped the whole weekPlan, so the cleared
     week had no tripId, no supersedes, no basedOn and generatedAt: null — nothing
     chooseTripWinner could rule for. Any phone still holding the old week won outright
     and the recipes came back on the next poll. */
  const file = instrument('clear-hook.html',
    'window.__t = { apply: applyMergedShopping, merge: mergeShoppingData, sd: () => shoppingData };');
  const srv = await serve(8184, file);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = []; watchErrors(page, errs);
  page.on('dialog', d => d.accept());
  try {
    await page.goto('http://localhost:8184/', { waitUntil: 'domcontentloaded' });
    await waitForApp(page);
    await buildAList(page);   // picks two recipes and generates the list

    /* Snapshot the week as the OTHER phone holds it, and put the ticks only on that
       copy — that phone has started shopping, this one has not polled yet. Ticking here
       instead would freeze this device's own Start tab (v21.9 disables every control on
       it during a live shop), so the clear could not be reached at all. The scenario
       under test is the one that can actually happen. */
    const held = await page.evaluate(() => {
      const sd = JSON.parse(localStorage.getItem('fma_shopping_v4'));
      const remote = JSON.parse(JSON.stringify(sd));
      const now = new Date().toISOString();
      remote.shoppingList.slice(0, 2).forEach(l => { l.checked = true; l.checkedAt = now; });
      window.__held = remote;
      return { trip: sd.weekPlan.tripId, picks: sd.weekPlan.selections.length,
               lines: sd.shoppingList.length,
               remoteTicks: remote.shoppingList.filter(l => l.checked).length };
    });
    ok('the other phone is mid-shop, which normally wins outright',
       held.remoteTicks === 2, held);
    ok('there is a week to clear', held.picks === 2 && held.lines > 0 && !!held.trip, held);

    await page.click('#mainNav button[data-tab="start"]');
    await page.waitForSelector('#app input[type=checkbox]', { timeout: 15000 });
    await page.click('#app >> text="Clear all selections"');
    await page.waitForTimeout(500);

    const cleared = await readShopping(page);
    ok('the clear empties the week', cleared.weekPlan.selections.length === 0);
    ok('and the list with it', cleared.shoppingList.length === 0);
    ok('but the week keeps an identity, rather than being erased',
       !!cleared.weekPlan.tripId && cleared.weekPlan.tripId !== held.trip,
       cleared.weekPlan.tripId);
    ok('and it names the week it replaced',
       cleared.weekPlan.supersedes === held.trip, cleared.weekPlan);

    // The other phone's copy arrives, exactly as a poll would deliver it.
    const after = await page.evaluate(() => {
      const remote = window.__held;
      remote.lastUpdated = new Date(Date.now() + 60000).toISOString();  // and it is "newer"
      window.__t.apply(window.__t.merge(window.__t.sd(), remote));
      return { picks: window.__t.sd().weekPlan.selections.length,
               lines: window.__t.sd().shoppingList.length,
               trip: window.__t.sd().weekPlan.tripId };
    });
    ok('the recipes do NOT come back', after.picks === 0, after);
    ok('nor does the shopping list', after.lines === 0, after);
    ok('the cleared week is what survives the merge',
       after.trip === cleared.weekPlan.tripId, after);
    ok('a deliberate clear outranks a live trip — rule 1 sits above rule 2',
       after.picks === 0 && after.lines === 0);

    await page.waitForTimeout(300);
    ok('and the Start tab agrees with the saved state',
       await page.evaluate(() => /Nothing picked yet/i.test(document.getElementById('app').innerText)));
    ok('no console errors', errs.length === 0, errs);
  } finally { await ctx.close(); await srv.close(); }
}

async function suiteUnsyncedPhoneSaysSo(browser) {
  group('a phone with nowhere to sync to says so, on screen');
  /* The reported failure: two people picked a week on a phone that was never signed in.
     Everything they did was local, and the app's only comment was a green line reading
     "Working from this device's local copy". The banner could not help — its pending
     case runs off syncPendingSince, which persist() sets only when the OneDrive flag is
     on, so the one device that needed telling was the only one that could not be told.
     The harness is itself an unsynced device, which is what makes this testable. */
  const srv = await serve(8185);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = []; watchErrors(page, errs);
  try {
    await page.goto('http://localhost:8185/', { waitUntil: 'domcontentloaded' });
    await waitForApp(page);

    ok('the startup line no longer calls it good news',
       /not connected/i.test(await page.textContent('#statusBar')),
       await page.textContent('#statusBar'));
    ok('and it is styled as a warning, not as ok',
       (await page.getAttribute('#statusBar', 'class') || '').includes('warn'));

    // Nothing while startup might still be connecting.
    ok('the banner holds off while startup could still succeed',
       await page.evaluate(() => document.getElementById('syncAlert').hidden));

    // Past the grace period, it has to speak up. The app schedules its own repaint;
    // wait for the outcome rather than for a duration.
    await page.waitForFunction(
      () => !document.getElementById('syncAlert').hidden, null, { timeout: 30000 });

    const banner = await page.evaluate(() => {
      const b = document.getElementById('syncAlert');
      return { text: b.innerText, cls: b.className,
               buttons: [...b.querySelectorAll('button')].map(x => x.textContent) };
    });
    ok('the banner appears once startup has had its chance', !!banner.text, banner);
    ok('it names the phone as disconnected',
       /not connected to the family/i.test(banner.text), banner.text);
    ok('it says what that costs — the sentence is the feature',
       /stays on this phone/i.test(banner.text) && /nobody else will see it/i.test(banner.text),
       banner.text);
    ok('it says the folder has never been reached',
       /never/i.test(banner.text), banner.text);
    ok('it is styled as a problem, not as a note', /\berr\b/.test(banner.cls), banner.cls);
    ok('and it offers the way out in one tap',
       banner.buttons.some(t => /connect this phone/i.test(t)), banner.buttons);

    // It is sticky, so it cannot be scrolled away from while somebody picks a week.
    await page.click('#mainNav button[data-tab="start"]');
    await page.waitForSelector('#app input[type=checkbox]', { timeout: 15000 });
    await page.evaluate(() => window.scrollTo(0, 1200));
    await page.waitForTimeout(250);
    ok('it survives changing tab and scrolling down the recipe grid',
       await page.evaluate(() => {
         const b = document.getElementById('syncAlert');
         return !b.hidden && b.getBoundingClientRect().top < 80;
       }));

    // "Not now" is for this session only.
    await page.click('#syncAlert button:has-text("Not now")');
    await page.waitForTimeout(250);
    ok('it can be put aside', await page.evaluate(() => document.getElementById('syncAlert').hidden));

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForApp(page);
    await page.waitForFunction(
      () => !document.getElementById('syncAlert').hidden, null, { timeout: 30000 });
    ok('but it comes back on the next open — the mute is never persisted',
       await page.evaluate(() => !document.getElementById('syncAlert').hidden));
    ok('no console errors', errs.length === 0, errs);
  } finally { await ctx.close(); await srv.close(); }
}

(async () => {
  console.log('Chromium: ' + EXECUTABLE);
  const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ['--no-sandbox'] });
  try {
    // A suite that throws is a failed suite, not a reason to abandon the run — the
    // remaining suites still have something useful to say about the build.
    for (const suite of [suiteTicksSurviveRebuild, suiteRemoteMergeKeepsTicks,
                         suiteWriteSplitting, suiteStapleQuantities, suiteTypingIsNotInterrupted,
                         suiteBulkDelete, suiteShareOneRecipe, suiteLiveListNotWiped,
                         suiteTripHistory, suiteClearSurvivesSync,
                         suiteUnsyncedPhoneSaysSo,
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
