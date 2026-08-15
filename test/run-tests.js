#!/usr/bin/env node
/*
 * The Fridge List — sync logic tests
 *
 *   node test/run-tests.js
 *
 * No dependencies, no build, no browser. Node 14+ is all it needs.
 *
 * The app ships as one self-contained index.html, so there is nothing to import.
 * Rather than keep a second copy of the merge logic here (which would drift and then
 * quietly stop testing anything), these tests EXTRACT the real function source out of
 * index.html by brace-matching and run it in a VM sandbox. If a function is renamed or
 * deleted, extraction fails loudly instead of silently passing.
 *
 * Scope: the pure logic — the shopping merge, per-flag conflict resolution, trip
 * identity, and the staleness signature. That is where the bugs that lost people's
 * ticks actually lived. Anything needing a DOM (rendering, print behaviour, the
 * detached-closure fix) is not covered here and still needs a browser.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(INDEX, 'utf8');

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

/* Pull `function <name>(...) { ... }` out of index.html by matching braces. */
function extract(name) {
  const start = html.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('Could not find function ' + name + '() in index.html');
  let depth = 0, started = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (c === '{') { depth++; started = true; }
    else if (c === '}') { depth--; if (started && depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error('Unbalanced braces while extracting ' + name + '() from index.html');
}

// Keep this in step with the constant in index.html; asserted below so it can't drift.
const TICK_TIE_WINDOW_MS = 10000;

const FUNCS = ['tsOf', 'tripIdOf', 'mergeFlag', 'flagStamp', 'mergeShoppingLine',
               'mergeShoppingData', 'lineMergeKey', 'selectionsSignature',
               'recipeSelectionsSignature', 'shoppingListIsStale'];

const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(
  'const TICK_TIE_WINDOW_MS = ' + TICK_TIE_WINDOW_MS + ';\n' +
  'let shoppingData = null;\n' +
  FUNCS.map(extract).join('\n\n') + '\n' +
  'this.api = { mergeShoppingData, selectionsSignature, shoppingListIsStale, lineMergeKey,' +
  '             tripIdOf, setShoppingData: d => { shoppingData = d; } };',
  sandbox
);
const { mergeShoppingData, selectionsSignature, shoppingListIsStale, setShoppingData } = sandbox.api;

/* ---------- fixtures ---------- */

const BASE = Date.parse('2026-08-15T10:00:00Z');
const T = ms => new Date(BASE + ms).toISOString();
const TRIP = 'trip:test';

const line = (name, o) => Object.assign(
  { ingredientName: name, source: 'recipe', checked: false, removed: false, atHome: false }, o || {});

const listFor = (lines, lastUpdated, weekPlanExtra) => ({
  weekPlan: Object.assign({ selections: [], generatedAt: T(0), tripId: TRIP }, weekPlanExtra || {}),
  shoppingList: lines, neededList: [], lastUpdated
});

const byName = (data, n) => data.shoppingList.find(l => l.ingredientName === n);
const names = data => data.shoppingList.map(l => l.ingredientName).sort();

/* ---------- the constant really is what the tests assume ---------- */

group('constants');
{
  const m = html.match(/const\s+TICK_TIE_WINDOW_MS\s*=\s*(\d+)/);
  ok('TICK_TIE_WINDOW_MS in index.html matches the tests', m && Number(m[1]) === TICK_TIE_WINDOW_MS,
     m && m[1]);
}

/* ---------- two shoppers, the case this all exists for ---------- */

group('two shoppers ticking in different aisles');
{
  const A = listFor([line('milk', { checked: true, checkedAt: T(1000), changedAt: T(1000) }), line('bread')], T(1000));
  const B = listFor([line('milk'), line('bread', { checked: true, checkedAt: T(2000), changedAt: T(2000) })], T(2000));
  const r = mergeShoppingData(A, B);
  ok('their tick survives', byName(r, 'milk').checked === true);
  ok('my tick survives', byName(r, 'bread').checked === true);

  const flipped = mergeShoppingData(B, A);
  ok('merge is order-independent',
     JSON.stringify(flipped.shoppingList.map(l => [l.ingredientName, l.checked]).sort()) ===
     JSON.stringify(r.shoppingList.map(l => [l.ingredientName, l.checked]).sort()));
}

group('one flag must not clobber another on the same item');
{
  // Regression: checked/removed/atHome used to share a single changedAt and were copied
  // as a block, so marking something "at home" wiped the other shopper's tick.
  const A = listFor([line('eggs', { checked: true, checkedAt: T(1000), changedAt: T(1000) })], T(1000));
  const B = listFor([line('eggs', { atHome: true, atHomeAt: T(2000), changedAt: T(2000) })], T(2000));
  const eggs = byName(mergeShoppingData(A, B), 'eggs');
  ok('tick survives an at-home from the other phone', eggs.checked === true, eggs);
  ok('at-home is applied too', eggs.atHome === true, eggs);
}

group('clock skew between two phones');
{
  const tick = listFor([line('rice', { checked: true, checkedAt: T(5000), changedAt: T(5000) })], T(5000));
  const near = listFor([line('rice', { checked: false, checkedAt: T(8000), changedAt: T(8000) })], T(8000));
  ok('a tick beats an untick inside the skew window',
     byName(mergeShoppingData(tick, near), 'rice').checked === true);

  const later = listFor([line('rice', { checked: false, checkedAt: T(60000), changedAt: T(60000) })], T(60000));
  ok('a deliberate untick outside the window still wins',
     byName(mergeShoppingData(tick, later), 'rice').checked === false);
}

group('list composition');
{
  // Regression: the merge used to iterate only the newer file's lines, so an extra
  // added by one shopper vanished if the other's save landed second.
  const A = listFor([line('milk'), line('batteries', { source: 'manual', changedAt: T(1000) })], T(1000));
  const B = listFor([line('milk', { checked: true, checkedAt: T(3000), changedAt: T(3000) })], T(3000));
  const r = mergeShoppingData(A, B);
  ok('a manual extra survives a newer save from the other phone',
     names(r).indexOf('batteries') !== -1, names(r));
  ok('and the newer tick is still applied', byName(r, 'milk').checked === true);
}

group('finishing the shop');
{
  const stillShopping = listFor([line('milk', { checked: true, checkedAt: T(1000) })], T(1000));
  const finished = listFor([], T(2000), { shoppingDoneAt: T(2000) });
  ok('a finish on one phone clears the list', mergeShoppingData(stillShopping, finished).shoppingList.length === 0);
  ok('and does so whichever way round it merges', mergeShoppingData(finished, stillShopping).shoppingList.length === 0);
  ok('the finish timestamp is kept', !!mergeShoppingData(stillShopping, finished).weekPlan.shoppingDoneAt);
}

group('a genuinely new trip');
{
  const oldTrip = listFor([line('milk', { checked: true, checkedAt: T(1000), changedAt: T(1000) })], T(9000));
  const newTrip = {
    weekPlan: { selections: [], generatedAt: T(5000), tripId: 'trip:newer' },
    shoppingList: [line('milk'), line('jam')], neededList: [], lastUpdated: T(5000)
  };
  const r = mergeShoppingData(oldTrip, newTrip);
  ok('the newer trip\'s list wins outright', r.shoppingList.length === 2, names(r));
  ok('last trip\'s ticks do not leak into it', r.shoppingList.every(l => !l.checked));
  ok('the trip id follows the winner', r.weekPlan.tripId === 'trip:newer', r.weekPlan.tripId);
}

group('selections follow the winning trip');
{
  // v21.2: the different-trip branch took the winner's line set but the *other* side's
  // recipe picks, so the merged menu could describe a different week from the list.
  const older = {
    weekPlan: { selections: [{ recipeId: 'stale' }], generatedAt: T(1000), tripId: 'trip:old' },
    shoppingList: [line('milk')], neededList: [], lastUpdated: T(9000)   // newer lastUpdated
  };
  const newer = {
    weekPlan: { selections: [{ recipeId: 'current' }], generatedAt: T(5000), tripId: 'trip:new' },
    shoppingList: [line('jam')], neededList: [], lastUpdated: T(2000)
  };
  const r = mergeShoppingData(older, newer);
  ok('list comes from the newer trip', names(r).join() === 'jam', names(r));
  ok('selections come from the same trip as the list',
     r.weekPlan.selections.map(s => s.recipeId).join() === 'current',
     r.weekPlan.selections.map(s => s.recipeId));
}

group('purity and convergence');
{
  const A = listFor([line('milk', { checked: true, checkedAt: T(1000), changedAt: T(1000) })], T(1000));
  const B = listFor([line('milk')], T(2000));
  const snapA = JSON.stringify(A), snapB = JSON.stringify(B);
  mergeShoppingData(A, B);
  ok('inputs are not mutated (a)', JSON.stringify(A) === snapA);
  ok('inputs are not mutated (b)', JSON.stringify(B) === snapB);

  const C = listFor([line('milk', { checked: true, checkedAt: T(1000), changedAt: T(1000) }), line('bread')], T(1000));
  const D = listFor([line('milk'), line('bread', { checked: true, checkedAt: T(2000), changedAt: T(2000) }),
                     line('jam', { changedAt: T(2000) })], T(2000));
  const norm = x => JSON.stringify(x.shoppingList.map(l => [l.ingredientName, l.checked, l.removed, l.atHome]).sort());
  const m1 = mergeShoppingData(C, D);
  ok('re-merging the same remote copy changes nothing', norm(mergeShoppingData(m1, D)) === norm(m1));
  ok('merging back the other side changes nothing', norm(mergeShoppingData(m1, C)) === norm(m1));
  ok('every line is present once', m1.shoppingList.length === 3, names(m1));
}

group('data written by older builds');
{
  // Pre-v21: one changedAt for all three flags. Pre-v15: no stamps at all.
  const A = listFor([line('milk', { checked: true, changedAt: T(1000) })], T(1000));
  const B = listFor([line('milk', { checked: false, changedAt: T(500) })], T(2000));
  ok('a legacy tick beats an older legacy untick', byName(mergeShoppingData(A, B), 'milk').checked === true);

  const C = listFor([line('milk', { checked: true })], T(1000));
  const D = listFor([line('milk', { checked: false })], T(2000));
  ok('unstamped data is additive', byName(mergeShoppingData(C, D), 'milk').checked === true);

  // No tripId at all: both sides derive one from generatedAt and agree.
  const E = { weekPlan: { selections: [], generatedAt: T(0) },
              shoppingList: [line('milk', { checked: true, changedAt: T(1000) })], neededList: [], lastUpdated: T(1000) };
  const F = { weekPlan: { selections: [], generatedAt: T(0) },
              shoppingList: [line('milk'), line('jam', { changedAt: T(2000) })], neededList: [], lastUpdated: T(2000) };
  const r = mergeShoppingData(E, F);
  ok('legacy files agree on the trip and union their lines', r.shoppingList.length === 2, names(r));
  ok('the legacy tick is preserved', byName(r, 'milk').checked === true);
}

/* ---------- the staleness signature: the original tick-wiping bug ---------- */

group('shopping must not invalidate the list it is shopping from');
{
  const data = {
    weekPlan: { selections: [{ recipeId: 'r1', servings: 4 }], generatedAt: T(0), tripId: TRIP },
    shoppingList: [], neededList: [{ id: 'n1', text: 'onions', done: false }, { id: 'n2', text: 'milk', done: false }],
    lastUpdated: T(0)
  };
  setShoppingData(data);
  const before = selectionsSignature();

  // Ticking a Wait List-backed line sets done (syncNeededFromLine). That used to change
  // the signature, mark the list stale, and trigger a rebuild that wiped every tick.
  data.neededList[0].done = true;
  setShoppingData(data);
  ok('ticking an item does not change the signature', selectionsSignature() === before);

  data.neededList.push({ id: 'n3', text: 'rice', done: false });
  setShoppingData(data);
  ok('adding a Wait List entry does change it', selectionsSignature() !== before);
}

group('a trip in progress is not treated as stale');
{
  const data = {
    weekPlan: { selections: [{ recipeId: 'r1', servings: 4 }], generatedAt: T(0), tripId: TRIP, shoppingDoneAt: null },
    shoppingList: [line('onions')],
    neededList: [{ id: 'n1', text: 'onions', done: false }],
    lastUpdated: T(0)
  };
  setShoppingData(data);
  data.weekPlan.lastGeneratedSignature = selectionsSignature();
  data.weekPlan.lastGeneratedRecipeSignature = vm.runInContext('recipeSelectionsSignature()', sandbox);
  setShoppingData(data);
  ok('not stale before shopping starts', shoppingListIsStale() === false);

  data.neededList[0].done = true;
  data.shoppingList[0].checked = true;
  setShoppingData(data);
  ok('still not stale once items are ticked', shoppingListIsStale() === false);
}

/* ---------- result ---------- */

console.log('\n' + '-'.repeat(48));
if (fail) {
  console.log(fail + ' failed, ' + pass + ' passed\n');
  failures.forEach(f => console.log('  FAILED: ' + f));
  process.exit(1);
}
console.log('all ' + pass + ' passed');
