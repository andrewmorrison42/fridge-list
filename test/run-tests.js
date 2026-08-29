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

/* Pull `const NAME = <single-line value>;` out of index.html, so shared constants are
   read from the source rather than duplicated here where they could drift. */
function extractConst(name){
  const m = html.match(new RegExp('const\\s+' + name + '\\s*=\\s*([^;]+);'));
  if (!m) throw new Error('Could not find const ' + name + ' in index.html');
  return m[0];
}

// Keep this in step with the constant in index.html; asserted below so it can't drift.
const TICK_TIE_WINDOW_MS = 10000;

const FUNCS = ['tsOf', 'tripIdOf', 'tripProgress', 'tripHasProgress', 'tripIsLive',
               'chooseTripWinner', 'mergeFlag', 'flagStamp', 'mergeShoppingLine',
               'mergeShoppingData', 'lineMergeKey', 'selectionsSignature',
               'recipeSelectionsSignature', 'shoppingListIsStale',
               'featureOn', 'stapleQtyFor', 'stapleQtyToShopping', 'parseQty', 'fmtQty',
               'displayUnit', 'lineQtyText', 'findIngredientMeta', 'rollUpQty', 'fmtExactQty',
               'ingredientLineText', 'recipeToPlainText', 'recipeToHtml', 'buildShareBundle',
               'tripRecordFromShopping', 'mergeTripHistory', 'pruneTripHistory',
               'recipeHistoryLabel', 'recipeHistoryTime', 'daysSinceStamp', 'daysSinceCooked',
               'daysSincePlanned', 'migrateCookedStamps',
               'cookRateSummary', 'atHomeStreaks', 'clearedWeekPlan',
               'mergeAuthored', 'resolveAuthoredItem', 'otherSideDropped',
               'effectiveAddedAt', 'authoredHorizons', 'describeMerge', 'mergeReport',
               'syncAlertState', 'lastContactText'];

const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(
  'const TICK_TIE_WINDOW_MS = ' + TICK_TIE_WINDOW_MS + ';\n' +
  'let shoppingData = null;\n' +
  'let recipesData = { recipes: [], ingredients: [], settings: { features: {}, staples: [], stapleQty: {} } };\n' +
  extractConst('COUNT_UNITS') + '\n' +
  extractConst('MEASURE_ML') + '\n' +
  extractConst('UNIT_ROLLUP') + '\n' +
  extractConst('TRIP_LIVE_WINDOW_MS') + '\n' +
  extractConst('SHARE_MARKER') + '\n' +
  extractConst('APP_VERSION') + '\n' +
  extractConst('TRIP_HISTORY_MAX') + '\n' +
  extractConst('SYNC_STALE_MS') + '\n' +
  extractConst('MERGE_GRACE_MS') + '\n' +
  extractConst('SELECTION_FIELDS') + '\n' +
  extractConst('WAITLIST_FIELDS') + '\n' +
  extractConst('SYNC_UNLINKED_GRACE_MS') + '\n' +
  FUNCS.map(extract).join('\n\n') + '\n' +
  'this.api = { mergeShoppingData, selectionsSignature, shoppingListIsStale, lineMergeKey,' +
  '             tripIdOf, parseQty, lineQtyText, displayUnit, stapleQtyToShopping, stapleQtyFor,' +
  '             ingredientLineText, recipeToPlainText, recipeToHtml, buildShareBundle, SHARE_MARKER,' +
  '             tripProgress, tripHasProgress, tripIsLive, chooseTripWinner, TRIP_LIVE_WINDOW_MS,' +
  '             tripRecordFromShopping, mergeTripHistory, pruneTripHistory, TRIP_HISTORY_MAX,' +
  '             recipeHistoryLabel, recipeHistoryTime, migrateCookedStamps,' +
  '             cookRateSummary, atHomeStreaks, clearedWeekPlan,' +
  '             mergeAuthored, otherSideDropped, MERGE_GRACE_MS, SELECTION_FIELDS, WAITLIST_FIELDS,' +
  '             describeMerge, mergeReport,' +
  '             syncAlertState, lastContactText, SYNC_STALE_MS, SYNC_UNLINKED_GRACE_MS,' +
  '             setShoppingData: d => { shoppingData = d; },' +
  '             setRecipesData: d => { recipesData = d; } };',
  sandbox
);
const { mergeShoppingData, selectionsSignature, shoppingListIsStale, tripIdOf,
        parseQty, lineQtyText, displayUnit, stapleQtyToShopping, stapleQtyFor,
        ingredientLineText, recipeToPlainText, recipeToHtml, buildShareBundle, SHARE_MARKER,
        tripProgress, tripHasProgress, tripIsLive, chooseTripWinner, TRIP_LIVE_WINDOW_MS,
        tripRecordFromShopping, mergeTripHistory, pruneTripHistory, TRIP_HISTORY_MAX,
        recipeHistoryLabel, recipeHistoryTime, migrateCookedStamps,
        cookRateSummary, atHomeStreaks, clearedWeekPlan,
        mergeAuthored, otherSideDropped, MERGE_GRACE_MS, SELECTION_FIELDS, WAITLIST_FIELDS,
        describeMerge, mergeReport,
        syncAlertState, lastContactText, SYNC_STALE_MS, SYNC_UNLINKED_GRACE_MS,
        setShoppingData, setRecipesData } = sandbox.api;

// Most tests don't care about staples; give them an inert default.
const noStaples = () => setRecipesData(
  { recipes: [], ingredients: [], settings: { features: { staples: false }, staples: [], stapleQty: {} } });
noStaples();

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

group('the list follows the winning trip; the picks are not thrown away with it');
{
  /* v21.2 fixed a genuine incoherence here — the different-trip branch took the winner's
     lines but the OTHER side's picks, so the menu described a different week from the
     list. Its fix was to take the winner's picks, which cured the mismatch by deleting
     somebody's choices.
     v23.0 keeps the winner's LIST, because a trip is a generation of the list, and keeps
     BOTH sides' picks, because a pick is authored and nobody's should vanish. The pairing
     is then a superset rather than a mismatch, and the app reconciles it the way it
     already reconciles any other edit to the picks: the list reads as stale and is
     regenerated. The assertion at the end is the one that makes this coherent rather
     than merely permissive. */
  const older = {
    weekPlan: { selections: [{ recipeId: 'stale', addedAt: T(900) }], generatedAt: T(1000), tripId: 'trip:old' },
    shoppingList: [line('milk')], neededList: [], lastUpdated: T(9000)   // newer lastUpdated
  };
  const newer = {
    weekPlan: { selections: [{ recipeId: 'current', addedAt: T(4900) }], generatedAt: T(5000), tripId: 'trip:new' },
    shoppingList: [line('jam')], neededList: [], lastUpdated: T(2000)
  };
  const r = mergeShoppingData(older, newer);
  ok('list comes from the newer trip, as it always did', names(r).join() === 'jam', names(r));
  ok('but neither side loses the recipes it picked',
     r.weekPlan.selections.map(s => s.recipeId).sort().join() === 'current,stale',
     r.weekPlan.selections.map(s => s.recipeId));

  // And the mismatch does not just sit there: the list no longer matches the picks, so
  // the app's existing staleness path takes over and regenerates.
  setShoppingData(newer);
  const signatureWhenGenerated = selectionsSignature();
  const merged = Object.assign({}, r);
  merged.weekPlan = Object.assign({}, r.weekPlan, { lastGeneratedSignature: signatureWhenGenerated });
  setShoppingData(merged);
  ok('and the list is marked stale, so the app reconciles instead of leaving a mismatch',
     shoppingListIsStale() === true);
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

group('changing a staple refreshes the list without ending the trip');
{
  const withStaples = qty => setRecipesData({
    recipes: [], ingredients: [],
    settings: { features: { staples: true }, staples: ['Milk'], stapleQty: { Milk: qty } }
  });
  const data = {
    weekPlan: { selections: [{ recipeId: 'r1', servings: 4 }], generatedAt: T(0), tripId: TRIP, shoppingDoneAt: null },
    shoppingList: [line('Milk', { checked: true, checkedAt: T(1000) })],
    neededList: [], lastUpdated: T(0)
  };
  setShoppingData(data);

  withStaples(2000);
  const before = selectionsSignature();
  withStaples(3000);
  ok('editing a quantity changes the signature', selectionsSignature() !== before);

  // ...but not the recipe signature, so it is a same-trip refresh and the carry-forward
  // in generateShoppingList keeps the shopper's ticks.
  const recipeSig = vm.runInContext('recipeSelectionsSignature()', sandbox);
  withStaples(2000);
  ok('and never the recipe signature (so the trip continues)',
     vm.runInContext('recipeSelectionsSignature()', sandbox) === recipeSig);

  data.weekPlan.lastGeneratedSignature = selectionsSignature();
  data.weekPlan.lastGeneratedRecipeSignature = recipeSig;
  setShoppingData(data);
  ok('not stale once regenerated', shoppingListIsStale() === false);
  withStaples(4000);
  setShoppingData(data);
  ok('stale again after another quantity edit', shoppingListIsStale() === true);

  // With the feature off, staples must not influence the signature at all.
  setRecipesData({ recipes: [], ingredients: [],
                   settings: { features: { staples: false }, staples: ['Milk'], stapleQty: { Milk: 9000 } } });
  const off = selectionsSignature();
  setRecipesData({ recipes: [], ingredients: [],
                   settings: { features: { staples: false }, staples: [], stapleQty: {} } });
  ok('staples are ignored while the feature is off', selectionsSignature() === off);
  noStaples();
}

group('quantities read the way the ingredient is ordinarily called');
{
  // 'qty' is the master's way of recording "each"; nobody says "1 qty Banana".
  ok('a count unit is not printed', displayUnit('qty') === '');
  ok('...case-insensitively', displayUnit('Qty') === '' && displayUnit('EACH') === '');
  ok('a real unit is left alone', displayUnit('g') === 'g' && displayUnit('mL') === 'mL');
  ok('a blank unit stays blank', displayUnit('') === '' && displayUnit(undefined) === '');

  ok('counted items show just the number',
     lineQtyText({ hasNumeric: true, totalQty: 6, unit: 'qty' }) === '6');
  ok('weighed items keep their unit',
     lineQtyText({ hasNumeric: true, totalQty: 850, unit: 'g' }) === '850 g');
  ok('a staple amount is appended after a plus',
     lineQtyText({ hasNumeric: true, totalQty: 125, unit: 'mL', textQtyParts: ['2 L'] }) === '125 mL + 2 L');
  ok('a staple-only line shows just its own amount',
     lineQtyText({ hasNumeric: false, textQtyParts: ['1 loaf'] }) === '1 loaf');
  ok('an amountless line shows nothing',
     lineQtyText({ hasNumeric: false, textQtyParts: [] }) === '');
}

group('quantity parsing');
{
  // Regression: ".5" failed the old pattern, so it was never summed into the
  // ingredient's total and showed on the list as a bare ".5".
  ok('a leading decimal point parses', parseQty('.5') === 0.5);
  ok('a trailing decimal point parses', parseQty('1.') === 1);
  ok('plain numbers still parse', parseQty('2') === 2 && parseQty(3) === 3 && parseQty('0.25') === 0.25);
  ok('fraction characters still parse', parseQty('½') === 0.5 && parseQty('1½') === 1.5);
  ok('written fractions still parse', parseQty('1/2') === 0.5);
  ok('a lone point is not a number', parseQty('.') === null);
  ok('non-numeric amounts stay text', parseQty('to taste') === null && parseQty('1-2') === null);
  ok('empty stays empty', parseQty('') === null && parseQty(null) === null && parseQty(undefined) === null);
}

group('staple amounts are numbers in the shopping unit');
{
  // A bare number is already in the ingredient's unit.
  ok('a plain number passes through', stapleQtyToShopping('2000', 'mL') === 2000);
  ok('decimals are kept', stapleQtyToShopping('1.5', 'g') === 1.5);

  // The everyday larger units convert rather than being rejected.
  ok('litres become millilitres', stapleQtyToShopping('2 L', 'mL') === 2000);
  ok('...case-insensitively', stapleQtyToShopping('2l', 'mL') === 2000);
  ok('millilitres stay put', stapleQtyToShopping('500 mL', 'mL') === 500);
  ok('kilograms become grams', stapleQtyToShopping('1 kg', 'g') === 1000);
  ok('grams stay put', stapleQtyToShopping('250 g', 'g') === 250);
  ok('kitchen measures convert for volumes', stapleQtyToShopping('2 cup', 'mL') === 500);

  // A unit that makes no sense for the ingredient has no numeric reading, and
  // guessing one would put a wrong number on the shopping list.
  ok('litres on a weighed ingredient are rejected', stapleQtyToShopping('2 L', 'g') === null);
  ok('a pack name is rejected', stapleQtyToShopping('1 loaf', 'g') === null);
  ok('blank is rejected', stapleQtyToShopping('', 'g') === null && stapleQtyToShopping(null, 'g') === null);
  ok('zero and negatives are rejected',
     stapleQtyToShopping('0', 'g') === null && stapleQtyToShopping('-2', 'g') === null);

  // v21.3 wrote free text into this map; it has to survive the upgrade.
  const migrated = { recipes: [], ingredients: [
      { name: 'Milk', shoppingUnit: 'mL', aisle: 'Dairy' },
      { name: 'Flour', shoppingUnit: 'g', aisle: 'Baking' },
      { name: 'Banana', shoppingUnit: 'qty', aisle: 'Fruit' },
      { name: 'Bread', shoppingUnit: 'g', aisle: 'Bakery' }
    ],
    settings: { features: { staples: true }, staples: ['Milk','Flour','Banana','Bread'],
                stapleQty: { Milk: '2 L', Flour: '1 kg', Banana: '6', Bread: '1 loaf' } } };
  setRecipesData(migrated);
  ok('an old "2 L" reads as 2000 mL', stapleQtyFor('Milk') === 2000, stapleQtyFor('Milk'));
  ok('an old "1 kg" reads as 1000 g', stapleQtyFor('Flour') === 1000);
  ok('an old bare count is unchanged', stapleQtyFor('Banana') === 6);
  ok('an old "1 loaf" has no numeric reading', stapleQtyFor('Bread') === null);
  ok('a name never set returns null', stapleQtyFor('Nothing') === null);
  ok('lookup is case-insensitive', stapleQtyFor('milk') === 2000);
  noStaples();
}

group('kilos and litres above a thousand');
{
  const q = (total, unit) => lineQtyText({ hasNumeric: true, totalQty: total, unit: unit });
  ok('under a kilo stays in grams', q(850, 'g') === '850 g');
  ok('under a litre stays in millilitres', q(125, 'mL') === '125 mL');
  ok('exactly a kilo rolls up', q(1000, 'g') === '1 kg', q(1000, 'g'));
  ok('exactly a litre rolls up', q(1000, 'mL') === '1 L', q(1000, 'mL'));
  ok('over a kilo rolls up', q(1500, 'g') === '1.5 kg', q(1500, 'g'));
  ok('over a litre rolls up', q(2125, 'mL') === '2.125 L', q(2125, 'mL'));

  // "No rounding": these are the cases fmtQty would have quietly flattened.
  ok('1001 g is not "1 kg"', q(1001, 'g') === '1.001 kg', q(1001, 'g'));
  ok('1250 g keeps both decimals', q(1250, 'g') === '1.25 kg', q(1250, 'g'));
  ok('2001 mL is not "2 L"', q(2001, 'mL') === '2.001 L', q(2001, 'mL'));
  ok('no floating-point tail is shown', q(1100, 'g') === '1.1 kg', q(1100, 'g'));

  // Only weights and volumes roll up.
  ok('counts never roll up', q(2000, 'qty') === '2000', q(2000, 'qty'));
  ok('unitless amounts never roll up', q(5000, '') === '5000', q(5000, ''));
  ok('the unit match is case-insensitive', q(1500, 'ML') === '1.5 L', q(1500, 'ML'));

  // A rolled-up amount still sits in front of any free-text part.
  ok('free-text parts still follow',
     lineQtyText({ hasNumeric: true, totalQty: 1500, unit: 'g', textQtyParts: ['a splash'] })
       === '1.5 kg + a splash');
}

/* ---------- sharing one recipe on its own ----------
   The promise the share panel makes is that one recipe goes and nothing else
   does, and that what the recipient reads is what the cook sees on screen. */

group('sharing a single recipe');
{
  const pie = {
    id: 'apple-pie', name: 'Apple Pie', category: 'Dessert', servings: 6,
    lastCooked: '2026-08-01T00:00:00.000Z',
    ingredients: [
      { ingredientName: 'Apple', quantity: 6 },
      { ingredientName: 'Butter', quantity: 100, descriptor: 'cold, cubed' },
      { ingredientName: 'Milk', quantity: 250, displayQty: '1', displayUnit: 'cup', section: 'Pastry' },
      { ingredientName: 'Flour', quantity: 200, section: 'Pastry' }
    ],
    method: ['Peel the apples.', 'Bake for 40 minutes.', '\u2014 Topping', 'Rub in the butter.'],
    sourceUrl: 'https://example.com/apple-pie'
  };
  const stew = { id: 'stew', name: 'Stew', category: 'Meat', servings: 4,
                 ingredients: [{ ingredientName: 'Beef', quantity: 500 }], method: [] };
  setRecipesData({
    recipes: [pie, stew],
    ingredients: [
      { name: 'Apple', shoppingUnit: 'qty', aisle: 'Fruit' },
      { name: 'Butter', shoppingUnit: 'g', aisle: 'Dairy' },
      { name: 'Milk', shoppingUnit: 'mL', aisle: 'Dairy' },
      { name: 'Flour', shoppingUnit: 'g', aisle: 'Baking' },
      { name: 'Beef', shoppingUnit: 'g', aisle: 'Meat' }
    ],
    settings: { features: {}, staples: [], stapleQty: {} }
  });

  // --- the ingredient line, shared with the recipe screen ---
  ok('a counted ingredient drops the "qty" unit',
     ingredientLineText(pie.ingredients[0]) === '6 Apple', ingredientLineText(pie.ingredients[0]));
  ok('an ingredient takes its unit from the master list',
     ingredientLineText(pie.ingredients[1]) === '100g Butter, cold, cubed', ingredientLineText(pie.ingredients[1]));
  ok('a kitchen measure is shown as it was typed',
     ingredientLineText(pie.ingredients[2]) === '1 cup Milk', ingredientLineText(pie.ingredients[2]));
  ok('no quantity means just the name',
     ingredientLineText({ ingredientName: 'Salt' }) === 'Salt');

  // --- the plain text a non-user receives ---
  const text = recipeToPlainText(pie);
  const lines = text.split('\n');
  ok('it starts with the recipe name', lines[0] === 'Apple Pie');
  ok('the second line summarises it', lines[1] === 'Dessert \u00b7 serves 6', lines[1]);
  ok('ingredients are listed', text.indexOf('100g Butter, cold, cubed') !== -1);
  ok('a section heading appears once, above its lines',
     lines.indexOf('Pastry') !== -1 && lines.indexOf('Pastry') < lines.indexOf('1 cup Milk'));
  ok('the heading is not repeated for every line in the section',
     lines.filter(l => l === 'Pastry').length === 1);
  ok('the first step is numbered 1', text.indexOf('1. Peel the apples.') !== -1);
  ok('the second step is numbered 2', text.indexOf('2. Bake for 40 minutes.') !== -1);
  ok('a method heading loses its dash',
     lines.indexOf('Topping') !== -1 && text.indexOf('\u2014 Topping') === -1);
  ok('numbering restarts after a method heading', text.indexOf('1. Rub in the butter.') !== -1);
  ok('the source website comes along', text.indexOf('From: https://example.com/apple-pie') !== -1);
  ok('slow cooker is only mentioned when it applies', text.indexOf('slow cooker') === -1);
  ok('slow cooker is mentioned when it applies',
     recipeToPlainText(Object.assign({}, pie, { slowCooker: true })).split('\n')[1]
       === 'Dessert \u00b7 serves 6 \u00b7 slow cooker');
  ok('a recipe with no method says so, rather than ending mid-air',
     recipeToPlainText(stew).indexOf('(no method written down yet)') !== -1);
  ok('a recipe with no ingredients says so',
     recipeToPlainText({ name: 'Toast', ingredients: [], method: ['Toast it.'] })
       .indexOf('(none listed)') !== -1);

  // --- the formatted version, for pasting into an email or a document ---
  const htm = recipeToHtml(pie);
  ok('the name is a heading', htm.indexOf('<h2>Apple Pie</h2>') !== -1);
  ok('ingredients are a bulleted list',
     htm.indexOf('<ul>') !== -1 && htm.indexOf('<li>100g Butter, cold, cubed</li>') !== -1);
  ok('the method is a numbered list',
     htm.indexOf('<ol>') !== -1 && htm.indexOf('<li>Peel the apples.</li>') !== -1);
  ok('an ingredient section becomes a sub-heading', htm.indexOf('<strong>Pastry</strong>') !== -1);
  ok('a method heading breaks the numbering into a second list',
     htm.indexOf('<strong>Topping</strong>') !== -1 && htm.split('<ol>').length === 3, htm.split('<ol>').length);
  ok('every list it opens, it closes',
     htm.split('<ul>').length === htm.split('</ul>').length
       && htm.split('<ol>').length === htm.split('</ol>').length);
  ok('the source website is a link', htm.indexOf('<a href="https://example.com/apple-pie">') !== -1);
  ok('it carries no styling of its own, so it takes the document\'s',
     htm.indexOf('style=') === -1 && htm.indexOf('font') === -1);
  ok('markup in a recipe is escaped, not pasted as markup',
     recipeToHtml({ name: 'Fish & <b>Chips</b>', ingredients: [], method: [] })
       .indexOf('<h2>Fish &amp; &lt;b&gt;Chips&lt;/b&gt;</h2>') !== -1,
     recipeToHtml({ name: 'Fish & <b>Chips</b>', ingredients: [], method: [] }).slice(0, 80));

  // --- the recipe file a fellow user receives ---
  const bundle = buildShareBundle(['apple-pie']);
  ok('the file is marked as a share file', bundle[SHARE_MARKER] === 1);
  ok('only the chosen recipe travels',
     bundle.recipes.length === 1 && bundle.recipes[0].id === 'apple-pie');
  ok('only the ingredients that recipe uses travel',
     bundle.ingredients.map(i => i.name).sort().join(',') === 'Apple,Butter,Flour,Milk',
     bundle.ingredients.map(i => i.name));
  ok('nothing else from the book is in the file',
     JSON.stringify(bundle).indexOf('Stew') === -1 && JSON.stringify(bundle).indexOf('Beef') === -1);
  ok('no shopping list, week plan or settings ride along',
     Object.keys(bundle).sort().join(',') === 'appVersion,exportedAt,fridgeListRecipeShare,ingredients,recipes',
     Object.keys(bundle).sort());
  bundle.recipes[0].name = 'Tampered';
  ok('the file is a copy — editing it cannot touch the book', pie.name === 'Apple Pie');

  noStaples();
}

/* ---------- v21.8: a stale list must not dump on a live one ----------
   The bug behind all of this: a phone that had not caught up regenerated from last
   week's picks, its trip was newer by the clock, and the merge handed it the trip
   wholesale — throwing away a half-ticked trolley in a supermarket. */

const NOW = Date.now();
const ago = ms => new Date(NOW - ms).toISOString();
const MIN = 60 * 1000, HOUR = 60 * MIN;

// A trip: its own id, when it was generated, what it knew when it was, and its lines.
const trip = (id, o) => listFor((o && o.lines) || [], (o && o.lastUpdated) || ago(MIN), {
  tripId: id,
  generatedAt: (o && o.generatedAt) || ago(HOUR),
  supersedes: (o && o.supersedes),
  basedOn: (o && o.basedOn)
});
const ticked = (name, at) => line(name, { checked: true, checkedAt: at, changedAt: at });

group('is anyone actually shopping from this list?');
{
  ok('a list nobody has ticked is not live',
     tripIsLive(trip('t1', { lines: [line('milk'), line('bread')] }), NOW) === false);
  ok('a list ticked minutes ago is live',
     tripIsLive(trip('t1', { lines: [ticked('milk', ago(3 * MIN)), line('bread')] }), NOW) === true);
  ok('a list last ticked seven hours ago is not',
     tripIsLive(trip('t1', { lines: [ticked('milk', ago(7 * HOUR))] }), NOW) === false);
  ok('the window is the one the app defines',
     tripIsLive(trip('t1', { lines: [ticked('milk', ago(TRIP_LIVE_WINDOW_MS - MIN))] }), NOW) === true
     && tripIsLive(trip('t1', { lines: [ticked('milk', ago(TRIP_LIVE_WINDOW_MS + MIN))] }), NOW) === false);
  ok('a finished trip is never live, however recently it was ticked',
     tripIsLive(listFor([ticked('milk', ago(MIN))], ago(MIN),
                        { tripId: 't1', shoppingDoneAt: ago(30 * 1000) }), NOW) === false);
  ok('a tick from a pre-v21 build, stamped only with changedAt, still counts',
     tripIsLive(listFor([{ ingredientName: 'milk', checked: true, changedAt: ago(MIN) }], ago(MIN),
                        { tripId: 't1' }), NOW) === true);
  ok('an unstamped tick is treated as live rather than assumed abandoned',
     tripIsLive(listFor([{ ingredientName: 'milk', checked: true }], ago(MIN), { tripId: 't1' }), NOW) === true);
  ok('progress counts the ticks and finds the newest',
     tripProgress(trip('t1', { lines: [ticked('milk', ago(9 * MIN)), ticked('bread', ago(2 * MIN)), line('jam')] })).ticks === 2);
}

group('a stale phone must not wipe a trolley');
{
  // The incident. Someone is shopping. A phone that never saw their list regenerates
  // from its own out-of-date picks, so its trip is newer by the clock.
  const live = trip('trip:live', {
    lines: [ticked('milk', ago(4 * MIN)), ticked('bread', ago(2 * MIN)), line('jam')],
    generatedAt: ago(40 * MIN), basedOn: ago(45 * MIN), lastUpdated: ago(2 * MIN)
  });
  const stale = trip('trip:stale', {
    lines: [line('flour'), line('rice')],
    generatedAt: ago(30 * 1000), basedOn: ago(3 * 24 * HOUR), lastUpdated: ago(20 * 1000)
  });

  const r = mergeShoppingData(live, stale);
  ok('the trolley survives a newer list from a phone that never saw it',
     tripIdOf(r) === 'trip:live', tripIdOf(r));
  ok('and the ticks are still on it', r.shoppingList.filter(l => l.checked).length === 2);
  ok('the stale list does not leak its lines in',
     r.shoppingList.every(l => l.ingredientName !== 'flour'));
  ok('which way round the two files merge makes no difference',
     tripIdOf(mergeShoppingData(stale, live)) === 'trip:live');
}

group('a deliberate replacement still replaces');
{
  // Someone looked at the live list and chose to start a new one anyway — on this
  // build that tap came with a dialog naming the ticks it would cost.
  const live = trip('trip:live', { lines: [ticked('milk', ago(5 * MIN))], generatedAt: ago(30 * MIN) });
  const chosen = trip('trip:new', {
    lines: [line('flour')], generatedAt: ago(MIN), supersedes: 'trip:live', basedOn: ago(2 * MIN)
  });
  const r = mergeShoppingData(live, chosen);
  ok('a trip that names the live one as the one it replaces wins',
     tripIdOf(r) === 'trip:new', tripIdOf(r));
  ok('and last trip\'s ticks do not leak into it',
     r.shoppingList.every(l => !l.checked));
  ok('order-independent', tripIdOf(mergeShoppingData(chosen, live)) === 'trip:new');
}

group('stale loses even before anyone has ticked anything');
{
  // 09:00 the right list is made. 09:05 a phone asleep since Tuesday makes its own from
  // last week's picks. Neither has a tick on it, so progress cannot separate them.
  const fresh = trip('trip:fresh', {
    lines: [line('milk')], generatedAt: ago(20 * MIN), basedOn: ago(21 * MIN), lastUpdated: ago(20 * MIN)
  });
  const stale = trip('trip:stale', {
    lines: [line('flour')], generatedAt: ago(MIN), basedOn: ago(4 * 24 * HOUR), lastUpdated: ago(MIN)
  });
  ok('the list built from fresher data wins, though it is the older of the two',
     tripIdOf(mergeShoppingData(fresh, stale)) === 'trip:fresh',
     tripIdOf(mergeShoppingData(fresh, stale)));
  ok('order-independent', tripIdOf(mergeShoppingData(stale, fresh)) === 'trip:fresh');
}

group('a genuinely new week still takes over');
{
  const lastWeek = trip('trip:lastweek', {
    lines: [ticked('milk', ago(4 * 24 * HOUR)), ticked('bread', ago(4 * 24 * HOUR))],
    generatedAt: ago(5 * 24 * HOUR), basedOn: ago(5 * 24 * HOUR), lastUpdated: ago(4 * 24 * HOUR)
  });
  const thisWeek = trip('trip:new', {
    lines: [line('flour')], generatedAt: ago(MIN), supersedes: 'trip:lastweek', basedOn: ago(2 * MIN)
  });
  const r = mergeShoppingData(lastWeek, thisWeek);
  ok('last week\'s ticked-but-cold list does not block it', tripIdOf(r) === 'trip:new', tripIdOf(r));
  ok('and none of last week\'s ticks come with it', r.shoppingList.every(l => !l.checked));

  // Same thing for a trip that was properly marked done.
  const finished = listFor([], ago(HOUR), { tripId: 'trip:done', generatedAt: ago(3 * HOUR),
                                            shoppingDoneAt: ago(HOUR) });
  const next = trip('trip:next', { lines: [line('rice')], generatedAt: ago(MIN), supersedes: 'trip:done' });
  ok('a finished trip is replaced without argument',
     tripIdOf(mergeShoppingData(finished, next)) === 'trip:next');
}

group('copies written by builds that know none of this');
{
  // No supersedes, no basedOn — the fields simply are not there.
  const oldA = listFor([line('milk')], ago(2 * HOUR), { tripId: 'trip:a', generatedAt: ago(2 * HOUR) });
  const oldB = listFor([line('flour')], ago(MIN), { tripId: 'trip:b', generatedAt: ago(MIN) });
  ok('the old rule still decides between two old copies',
     tripIdOf(mergeShoppingData(oldA, oldB)) === 'trip:b', tripIdOf(mergeShoppingData(oldA, oldB)));

  // An old build cannot say "I meant to replace this", so progress protects the shopper.
  const liveNew = trip('trip:live', { lines: [ticked('milk', ago(3 * MIN))], generatedAt: ago(HOUR) });
  const oldNewer = listFor([line('flour')], ago(MIN), { tripId: 'trip:old', generatedAt: ago(MIN) });
  ok('an old build\'s newer trip does not wipe a trolley',
     tripIdOf(mergeShoppingData(liveNew, oldNewer)) === 'trip:live',
     tripIdOf(mergeShoppingData(liveNew, oldNewer)));
}

group('two live trolleys, which should not happen but must still converge');
{
  const one = trip('trip:one', { lines: [ticked('milk', ago(2 * MIN))], generatedAt: ago(2 * HOUR) });
  const two = trip('trip:two', { lines: [ticked('flour', ago(MIN))], generatedAt: ago(HOUR) });
  const ab = mergeShoppingData(one, two), ba = mergeShoppingData(two, one);
  ok('both devices land on the same trip', tripIdOf(ab) === tripIdOf(ba), [tripIdOf(ab), tripIdOf(ba)]);
  ok('and it is the later-generated one, the old rule as last resort',
     tripIdOf(ab) === 'trip:two', tripIdOf(ab));
}

group('the merge is still pure with the new rules in it');
{
  const live = trip('trip:live', { lines: [ticked('milk', ago(MIN))] });
  const other = trip('trip:other', { lines: [line('flour')], generatedAt: ago(30 * 1000) });
  const beforeA = JSON.stringify(live), beforeB = JSON.stringify(other);
  mergeShoppingData(live, other);
  ok('input a is untouched', JSON.stringify(live) === beforeA);
  ok('input b is untouched', JSON.stringify(other) === beforeB);
}

/* ---------- v22.0: the trip archive ---------- */

group('a finished trip is reduced to a record worth keeping');
{
  const sd = {
    weekPlan: { tripId: 'trip:a', generatedAt: T(0), shoppingDoneAt: T(9000),
                selections: [{recipeId:'risotto', servings:4, cooked:true},
                             {recipeId:'curry', servings:2}] },
    shoppingList: [
      line('Milk', {aisle:'Dairy', shoppingCategory:'Cold', unit:'mL', totalQty:2000,
                    hasNumeric:true, checked:true, checkedAt:T(100), source:'staple'}),
      line('Salt', {aisle:'Spices', shoppingCategory:'Pantry', atHome:true}),
      line('Rice', {aisle:'Dry goods', shoppingCategory:'Pantry',
                    totalQty:500, hasNumeric:false})
    ]
  };
  const rec = tripRecordFromShopping(sd, 'phone-1');
  ok('carries the trip id', rec.tripId === 'trip:a');
  ok('carries who finished it', rec.doneBy === 'phone-1');
  ok('keeps the cooked flag on each pick',
     rec.selections[0].cooked === true && rec.selections[1].cooked === false);
  ok('keeps the tick and its stamp — the walking order lives here',
     rec.lines[0].checked === true && rec.lines[0].checkedAt === T(100));
  ok('keeps the at-home decision', rec.lines[1].atHome === true);
  ok('keeps a real quantity', rec.lines[0].qty === 2000 && rec.lines[0].unit === 'mL');
  ok('drops a quantity that was never numeric', rec.lines[2].qty === null);
  ok('drops the bulk it does not need',
     rec.lines[0].sources === undefined && rec.lines[0].textQtyParts === undefined);
  ok('a trip with no id is not archivable',
     tripRecordFromShopping({weekPlan:{selections:[]}, shoppingList:[]}, 'x') === null);
}

group('trip history merges as a union, because a trip is written once');
{
  const trip1 = { tripId:'t1', doneAt: T(1000), lines:[{name:'Milk'}], selections:[] };
  const trip2 = { tripId:'t2', doneAt: T(2000), lines:[{name:'Rice'}], selections:[] };
  const mine = { version:1, trips:[trip1] };
  const theirs = { version:1, trips:[trip2] };

  const m = mergeTripHistory(mine, theirs);
  ok('both trips survive', m.trips.length === 2);
  ok('oldest first', m.trips[0].tripId === 't1' && m.trips[1].tripId === 't2');
  ok('order of arguments makes no difference',
     JSON.stringify(mergeTripHistory(theirs, mine)) === JSON.stringify(m));
  ok('merging with itself changes nothing',
     JSON.stringify(mergeTripHistory(m, m)) === JSON.stringify(m));
  ok('merging with nothing changes nothing',
     JSON.stringify(mergeTripHistory(m, null)) === JSON.stringify(m));

  const beforeA = JSON.stringify(mine), beforeB = JSON.stringify(theirs);
  mergeTripHistory(mine, theirs);
  ok('and the merge is pure', JSON.stringify(mine) === beforeA && JSON.stringify(theirs) === beforeB);

  const short = { version:1, trips:[{tripId:'t1', doneAt:T(1000), lines:[], selections:[]}] };
  const full  = { version:1, trips:[{tripId:'t1', doneAt:T(1000), lines:[{name:'Milk'},{name:'Eggs'}], selections:[]}] };
  ok('the same trip from two files resolves to the fuller record',
     mergeTripHistory(short, full).trips[0].lines.length === 2);
  ok('and resolves the same way round the other way',
     mergeTripHistory(full, short).trips[0].lines.length === 2);
  ok('an entry with no trip id is dropped rather than archived',
     mergeTripHistory({version:1, trips:[{doneAt:T(1)}]}, null).trips.length === 0);
}

group('the archive is capped, so it cannot grow without bound');
{
  const many = { version:1, trips: [] };
  for(let i = 0; i < TRIP_HISTORY_MAX + 10; i++){
    many.trips.push({ tripId:'t'+i, doneAt:T(i*1000), lines:[], selections:[] });
  }
  const pruned = pruneTripHistory(many, TRIP_HISTORY_MAX);
  ok('kept at the cap', pruned.trips.length === TRIP_HISTORY_MAX);
  ok('and it is the NEWEST that are kept',
     pruned.trips[pruned.trips.length - 1].tripId === 't' + (TRIP_HISTORY_MAX + 9));
  ok('the merge applies the cap too', mergeTripHistory(many, null).trips.length === TRIP_HISTORY_MAX);
  ok('an empty history prunes to an empty history', pruneTripHistory(null, 5).trips.length === 0);
}

/* ---------- v22.0: cooked means cooked ---------- */

group('a recipe history badge does not call a plan a meal');
{
  setRecipesData({ recipes: [], ingredients: [], settings: { notCookedRecentlyDays: 60, features: {} } });
  const daysAgo = n => new Date(Date.now() - n*24*60*60*1000).toISOString();

  ok('nothing known reads as never cooked',
     recipeHistoryLabel({}).text === 'Never cooked');
  ok('a cook is reported as a cook',
     recipeHistoryLabel({lastCooked: daysAgo(3)}).text === 'Cooked 3 days ago');
  ok('a plan with no cook is reported as a plan, not a cook',
     recipeHistoryLabel({lastPlanned: daysAgo(3)}).text === 'Planned 3 days ago');
  ok('a cook outranks a plan',
     recipeHistoryLabel({lastCooked: daysAgo(2), lastPlanned: daysAgo(9)}).text === 'Cooked 2 days ago');
  ok('an old plan still counts as stale',
     recipeHistoryLabel({lastPlanned: daysAgo(90)}).stale === true);
  ok('a recent plan is not stale',
     recipeHistoryLabel({lastPlanned: daysAgo(2)}).stale === false);

  // daysAgo() reads the clock, so the two stamps must be the SAME value, not two calls
  // that happen to land in the same millisecond. This passed by luck until it didn't.
  const oneDayAgo = daysAgo(1);
  ok('the sort reads whichever stamp is fresher',
     recipeHistoryTime({lastCooked: daysAgo(9), lastPlanned: oneDayAgo}) ===
     recipeHistoryTime({lastPlanned: oneDayAgo}));
  ok('and a recipe with neither sorts first',
     recipeHistoryTime({}) === 0);
}

group('old lastCooked stamps are moved to where they were true');
{
  const data = { recipes: [ {id:'a', lastCooked: T(0)}, {id:'b'} ], meta: {} };
  migrateCookedStamps(data);
  ok('the old stamp is copied to lastPlanned, which is what it recorded',
     data.recipes[0].lastPlanned === T(0));
  ok('and lastCooked is left alone, so nothing on screen changes on update day',
     data.recipes[0].lastCooked === T(0));
  ok('a recipe with no history gains none', data.recipes[1].lastPlanned === undefined);
  ok('the migration marks itself done', data.meta.cookedStampsSplit === true);

  // Second run must not overwrite a genuine cook recorded since the first.
  data.recipes[0].lastCooked = T(5000);
  migrateCookedStamps(data);
  ok('and it never runs twice over a real cook', data.recipes[0].lastPlanned === T(0));
}







/* ---------- v22.0: what the memory tells you ---------- */

group('the cook rate is the overlap of what was bought and what was cooked');
{
  const trips = [
    { tripId:'t1', doneAt:T(0),     lines:[], selections:[{recipeId:'a'},{recipeId:'b'}] },
    { tripId:'t2', doneAt:T(100000), lines:[], selections:[{recipeId:'a'},{recipeId:'c'}] }
  ];
  // 'a' cooked during the first week, 'c' during the second, 'b' never.
  const book = [ {id:'a', lastCooked:T(50000)}, {id:'b'}, {id:'c', lastCooked:T(150000)} ];

  const r = cookRateSummary(trips, book, 6);
  ok('every pick across both shops is counted', r.picked === 4);
  ok('two shops', r.shops === 2);
  ok('a cook inside a shop’s own week counts for that shop', r.cooked === 2, r);

  ok('a recipe never cooked never counts',
     cookRateSummary([trips[0]], [{id:'a'},{id:'b'}], 6).cooked === 0);
  ok('a cooked tick recorded at archive time is believed without a stamp',
     cookRateSummary([{tripId:'x', doneAt:T(0), selections:[{recipeId:'a', cooked:true}]}], [], 6).cooked === 1);
  ok('no history is not a divide by zero',
     cookRateSummary([], [], 6).picked === 0 && cookRateSummary(null, null, 6).shops === 0);

  // The window must not let the oldest visible trip claim later cooks.
  const windowed = cookRateSummary(trips, book, 1);
  ok('only the last shop is in view', windowed.shops === 1 && windowed.picked === 2);
  // 'b' was only ever picked on the first shop. A cook stamped after the SECOND shop
  // belongs to that week, and must not be credited backwards to the first.
  ok('a cook after the next shop does not count backwards to the earlier one',
     cookRateSummary(trips, [{id:'b', lastCooked:T(150000)}], 6).cooked === 0);
  ok('but the same cook inside the first shop’s own week does count',
     cookRateSummary(trips, [{id:'b', lastCooked:T(50000)}], 6).cooked === 1);
}

group('what the family already has in is learnt from the times they said so');
{
  const at = (name, stamped) => ({ name: name, atHome: true, atHomeAt: stamped ? T(1) : null });
  const buy = name => ({ name: name, atHome: false });
  const shop = (id, lines, t) => ({ tripId:id, doneAt:T(t), lines: lines, selections: [] });

  const trips = [
    shop('t1', [at('Olive oil', true), buy('Milk'), at('Flour', true)], 1000),
    shop('t2', [at('Olive oil', true), buy('Milk'), buy('Flour')],      2000),
    shop('t3', [at('Olive oil', true), buy('Milk'), at('Flour', true)], 3000)
  ];
  const s = atHomeStreaks(trips, 3);
  const names = s.map(x=> x.name);
  ok('an item at home every time it came up is suggested', names.indexOf('Olive oil') >= 0);
  ok('and the run length is reported', s[0].runs === 3);
  ok('an item that was genuinely needed once is not a pantry item — it ran out',
     names.indexOf('Flour') < 0);
  ok('an item always bought is never suggested', names.indexOf('Milk') < 0);
  ok('a shorter run than asked for is not suggested', atHomeStreaks(trips, 4).length === 0);

  const auto = [1,2,3].map(n=> shop('a'+n, [at('Salt', false)], n*1000));
  ok('the pantry rule setting the flag by category does NOT count as saying so',
     atHomeStreaks(auto, 3).length === 0);

  ok('an empty history suggests nothing',
     atHomeStreaks([], 3).length === 0 && atHomeStreaks(null, 3).length === 0);
}

/* ---------- v22.1: clearing the week has to survive the sync ---------- */

group('a cleared week beats a copy that still holds the old one');
{
  // The week as another phone still has it: a real trip, generated an hour ago.
  const oldWeek = () => ({
    weekPlan: { tripId: 'trip:old', generatedAt: T(0), basedOn: T(0),
                selections: [{recipeId:'a'},{recipeId:'b'},{recipeId:'c'},
                             {recipeId:'d'},{recipeId:'e'},{recipeId:'f'}] },
    shoppingList: [line('Milk'), line('Rice')],
    neededList: [], lastUpdated: T(0)
  });

  /* What this phone holds after tapping "Clear all selections". seenRemoteAt is how far
     it had read the shared copy — v23.0 persists it into the file, and it is what proves
     this device had actually seen the week it is clearing. */
  const cleared = () => {
    const before = oldWeek();
    // Read the shared copy 5 minutes after that week was written, then cleared a minute
    // later. Comfortably outside MERGE_GRACE_MS, which is what a real gap looks like.
    return { weekPlan: clearedWeekPlan(before, T(6*60*1000), 'phone-1', T(5*60*1000)),
             shoppingList: [], neededList: [], lastUpdated: T(6*60*1000), seenRemoteAt: T(5*60*1000) };
  };

  ok('the cleared week keeps an identity of its own', !!tripIdOf(cleared()));
  ok('and names the week it is replacing',
     cleared().weekPlan.supersedes === 'trip:old');
  ok('and carries a real generatedAt, not null',
     cleared().weekPlan.generatedAt === T(6*60*1000));
  ok('a finished shop does not come back with it',
     cleared().weekPlan.shoppingDoneAt === null);

  const both = (a, b) => [mergeShoppingData(a, b), mergeShoppingData(b, a)];

  both(cleared(), oldWeek()).forEach((m, i) => {
    ok('the week stays cleared, whichever way round the merge runs [' + i + ']',
       m.weekPlan.selections.length === 0, m.weekPlan.selections);
    ok('and the old list does not come back with it [' + i + ']',
       m.shoppingList.length === 0, m.shoppingList.length);
    ok('the merged trip is the cleared one [' + i + ']',
       tripIdOf(m) === tripIdOf(cleared()), tripIdOf(m));
  });
}

group('and it beats every shape of copy the household can be holding');
{
  const clearedAgainst = other => {
    const c = { weekPlan: clearedWeekPlan(other, T(6*60*1000), 'phone-1', T(5*60*1000)),
                shoppingList: [], neededList: [], lastUpdated: T(6*60*1000), seenRemoteAt: T(5*60*1000) };
    return [mergeShoppingData(c, other), mergeShoppingData(other, c)];
  };

  // 1. Someone had already ticked things off — a LIVE trip, which normally wins
  //    outright and is exactly what rule 2 exists to protect.
  const live = {
    weekPlan: { tripId: 'trip:live', generatedAt: T(0), basedOn: T(0),
                selections: [{recipeId:'a'},{recipeId:'b'}] },
    shoppingList: [line('Milk', {checked:true, checkedAt: new Date().toISOString()})],
    neededList: [], lastUpdated: T(0)
  };
  ok('a deliberate clear outranks even a live trip — rule 1 is above rule 2',
     clearedAgainst(live).every(m => m.weekPlan.selections.length === 0));

  // 2. A phone on v21.8+ whose copy carries basedOn.
  const based = {
    weekPlan: { tripId: 'trip:based', generatedAt: T(0), basedOn: T(50000),
                selections: [{recipeId:'a'}] },
    shoppingList: [line('Rice')], neededList: [], lastUpdated: T(0)
  };
  ok('a fresher basedOn on the other side does not resurrect it',
     clearedAgainst(based).every(m => m.weekPlan.selections.length === 0));

  // 3. A phone on a build old enough to have neither supersedes nor basedOn, where the
  //    only rule is "later generatedAt wins". The clear now has one, so it still wins.
  const ancient = {
    weekPlan: { tripId: 'trip:ancient', generatedAt: T(30000),
                selections: [{recipeId:'a'}] },
    shoppingList: [line('Flour')], neededList: [], lastUpdated: T(30000)
  };
  ok('nor does an older build with no lineage fields at all',
     clearedAgainst(ancient).every(m => m.weekPlan.selections.length === 0));

  // 4. Picks made but never generated, so there was no trip to supersede.
  const never = {
    weekPlan: { selections: [{recipeId:'a'}] },
    shoppingList: [], neededList: [], lastUpdated: T(0)
  };
  ok('a week that was never generated has nothing to supersede',
     clearedWeekPlan(never, T(60000), 'phone-1', null).supersedes === null);
  ok('and the clear still wins, on generatedAt alone',
     clearedAgainst(never).every(m => m.weekPlan.selections.length === 0));
}

group('the clear does not disturb anything it was not asked to');
{
  const other = {
    weekPlan: { tripId: 'trip:old', generatedAt: T(0), selections: [{recipeId:'a'}] },
    shoppingList: [line('Milk')],
    neededList: [{id:'n1', text:'shampoo', addedAt: T(0), done:false}],
    lastUpdated: T(0)
  };
  const c = { weekPlan: clearedWeekPlan(other, T(60000), 'phone-1', T(0)),
              shoppingList: [],
              neededList: [{id:'n1', text:'shampoo', addedAt: T(0), done:false}],
              lastUpdated: T(60000) };
  const m = mergeShoppingData(c, other);
  ok('the Wait List survives a clear, as the dialog promises',
     m.neededList.length === 1 && m.neededList[0].text === 'shampoo', m.neededList);

  const before = JSON.stringify(other);
  clearedWeekPlan(other, T(60000), 'phone-1', T(0));
  ok('and building the replacement mutates nothing',
     JSON.stringify(other) === before);
}

/* ---------- v22.2: a phone that is not synced has to say so ---------- */

group('a phone with nowhere to sync to is told, in as many words');
{
  const NOW = Date.parse('2026-08-29T12:00:00Z');
  const state = o => syncAlertState(Object.assign(
    { backend: null, signedIn: false, lastWriteError: null, pendingSince: null,
      seenRemoteAt: null, startedAt: NOW - 60000, now: NOW }, o || {}));

  const unlinked = state();
  ok('an unconnected phone raises the alarm', unlinked && unlinked.kind === 'unlinked', unlinked);
  ok('and says what it costs, which is the whole point',
     /stays on this phone/i.test(unlinked.hint) && /nobody else will see it/i.test(unlinked.hint),
     unlinked.hint);
  ok('and says it has never reached the folder',
     /never/i.test(unlinked.last), unlinked.last);
  ok('and offers the way out', !!unlinked.action, unlinked);

  ok('a phone still starting up is not accused',
     state({ startedAt: NOW - 1000 }) === null);
  ok('but it is, once startup has had its chance',
     state({ startedAt: NOW - SYNC_UNLINKED_GRACE_MS - 1 }).kind === 'unlinked');

  ok('a healthy OneDrive phone is left alone',
     state({ backend: 'onedrive', signedIn: true }) === null);
  ok('and so is a desktop on a shared folder',
     state({ backend: 'folder' }) === null);
}

group('signed in once, signed out now, and idle, is not silent either');
{
  const NOW = Date.parse('2026-08-29T12:00:00Z');
  const st = syncAlertState({ backend: 'onedrive', signedIn: false, lastWriteError: null,
                              pendingSince: null, seenRemoteAt: null,
                              startedAt: NOW - 60000, now: NOW });
  ok('an expired sign-in is reported with nothing pending', st && st.kind === 'signedout', st);
  ok('and carries the same consequence', /stays on this phone/i.test(st.hint));
}

group('the more serious problem is the one that gets shown');
{
  const NOW = Date.parse('2026-08-29T12:00:00Z');
  const base = { backend: null, signedIn: false, lastWriteError: null, pendingSince: null,
                 seenRemoteAt: null, startedAt: NOW - 60000, now: NOW };
  const with_ = o => syncAlertState(Object.assign({}, base, o));

  ok('a failed write outranks everything, and is never delayed by the grace period',
     with_({ lastWriteError: {status:507, name:'x'}, startedAt: NOW }).kind === 'error');
  ok('being unconnected outranks having changes pending',
     with_({ pendingSince: NOW - SYNC_STALE_MS - 1 }).kind === 'unlinked');
  ok('and a connected phone with stale changes still gets the old warning',
     with_({ backend:'onedrive', signedIn:true, pendingSince: NOW - SYNC_STALE_MS - 1 }).kind === 'pending');
  ok('a connected phone with recent changes gets nothing',
     with_({ backend:'onedrive', signedIn:true, pendingSince: NOW - 1000 }) === null);
}

group('the last-contact line reports what actually happened');
{
  const NOW = Date.parse('2026-08-29T12:00:00Z');
  const at = ms => new Date(NOW - ms).toISOString();
  ok('never is said plainly', /never/.test(lastContactText(null, NOW)));
  ok('and a device that has reached it says when',
     /2 hours ago/.test(lastContactText(at(2*60*60*1000), NOW)), lastContactText(at(2*60*60*1000), NOW));
  ok('minutes are singular where they should be',
     /1 minute ago/.test(lastContactText(at(60000), NOW)), lastContactText(at(60000), NOW));
  ok('a long gap rolls up to days',
     /3 days ago/.test(lastContactText(at(3*24*60*60*1000), NOW)), lastContactText(at(3*24*60*60*1000), NOW));
  ok('and rubbish in does not produce a confident answer',
     /never/.test(lastContactText('not a date', NOW)));
}

group('the grace window is what stops a fresh addition being read as a deletion');
{
  const NOW = 10*60*1000;
  const other = { weekPlan:{ tripId:'t', generatedAt:T(0), selections:[] },
                  shoppingList:[], neededList:[], lastUpdated:T(NOW), seenRemoteAt:T(NOW) };
  const mineWith = addedAt => ({
    weekPlan:{ tripId:'t', generatedAt:T(0), selections:[] },
    shoppingList:[], neededList:[{id:'n1', text:'shampoo', addedAt: addedAt, done:false}],
    lastUpdated:T(NOW+1000), seenRemoteAt:T(0) });

  ok('an entry added well before the other side last read is a deletion',
     mergeShoppingData(mineWith(T(NOW - 5*60*1000)), other).neededList.length === 0);
  ok('an entry added inside the grace window is kept — they may not have seen it yet',
     mergeShoppingData(mineWith(T(NOW - 10*1000)), other).neededList.length === 1);
  ok('and one added after they last read is certainly kept',
     mergeShoppingData(mineWith(T(NOW + 500)), other).neededList.length === 1);
  ok('a device that has never read the shared copy cannot delete anything',
     mergeShoppingData(Object.assign({}, other, { seenRemoteAt: null }),
                       mineWith(T(NOW - 5*60*1000))).neededList.length === 1);
}

group('one rule, the same answer whichever collection you touched');
{
  /* The whole point of v23.0: a person cannot be expected to know which of seven merge
     rules applied to the thing they just tapped. These assert the SAME outcomes for a
     recipe pick and a Wait List entry, side by side, because that is the contract. */
  const HOUR = 60*60*1000;
  const away = { weekPlan:{ tripId:'t', generatedAt:T(0),
                   selections:[{recipeId:'mine', addedAt:T(3*HOUR), changedAt:T(3*HOUR)}] },
                 shoppingList:[], neededList:[{id:'n-mine', text:'shampoo', addedAt:T(3*HOUR), done:false}],
                 lastUpdated:T(3*HOUR), seenRemoteAt:T(0) };            // last read hours ago
  const home = { weekPlan:{ tripId:'t', generatedAt:T(0),
                   selections:[{recipeId:'theirs', addedAt:T(2*HOUR), changedAt:T(2*HOUR)}] },
                 shoppingList:[], neededList:[{id:'n-theirs', text:'bread', addedAt:T(2*HOUR), done:false}],
                 lastUpdated:T(2*HOUR), seenRemoteAt:T(HOUR) };

  [ ['a recipe picked on a phone that was out of contact', away, home],
    ['the same, merged the other way round',                home, away] ].forEach(([what, x, y])=>{
    const r = mergeShoppingData(x, y);
    const picks = r.weekPlan.selections.map(s=>s.recipeId).sort().join();
    const wait  = r.neededList.map(n=>n.id).sort().join();
    ok(what + ': both picks survive', picks === 'mine,theirs', picks);
    ok(what + ': and both Wait List items survive', wait === 'n-mine,n-theirs', wait);
  });

  // A deletion the other side demonstrably saw is honoured, in both collections alike.
  const sawEverything = Object.assign({}, home, { seenRemoteAt: T(5*HOUR), lastUpdated: T(5*HOUR) });
  const r2 = mergeShoppingData(away, sawEverything);
  ok('a pick the other side saw and dropped stays dropped',
     r2.weekPlan.selections.map(s=>s.recipeId).join() === 'theirs',
     r2.weekPlan.selections.map(s=>s.recipeId));
  ok('and a Wait List item behaves identically',
     r2.neededList.map(n=>n.id).join() === 'n-theirs', r2.neededList.map(n=>n.id));

  // Same item edited on both sides: the later edit wins, per field, in both collections.
  const mk = (servings, at, done) => ({
    weekPlan:{ tripId:'t', generatedAt:T(0),
               selections:[{recipeId:'r', servings:servings, addedAt:T(0), changedAt:at}] },
    shoppingList:[], neededList:[{id:'n', text:'x', addedAt:T(0), done:done, changedAt:at}],
    lastUpdated:at, seenRemoteAt:T(0) });
  const later = mergeShoppingData(mk(4, T(HOUR), false), mk(8, T(2*HOUR), true));
  ok('the later edit to a pick wins', later.weekPlan.selections[0].servings === 8);
  ok('and the later edit to a Wait List entry wins', later.neededList[0].done === true);
  ok('whichever way round it merges',
     mergeShoppingData(mk(8, T(2*HOUR), true), mk(4, T(HOUR), false)).weekPlan.selections[0].servings === 8);

  // Purity and convergence, which the old wholesale rules could not offer.
  const a1 = JSON.stringify(away), h1 = JSON.stringify(home);
  const ab = mergeShoppingData(away, home), ba = mergeShoppingData(home, away);
  ok('the merge mutates neither input',
     JSON.stringify(away) === a1 && JSON.stringify(home) === h1);
  ok('and the two orders agree exactly',
     JSON.stringify(ab.weekPlan.selections) === JSON.stringify(ba.weekPlan.selections)
     && JSON.stringify(ab.neededList) === JSON.stringify(ba.neededList));
}

group('a phone that reconnects is told what changed');
{
  const before = { weekPlan:{ selections:[{recipeId:'a'}] }, shoppingList:[], neededList:[] };
  const after  = { weekPlan:{ selections:[{recipeId:'a'},{recipeId:'b'}] },
                   shoppingList:[{ingredientName:'Milk', checked:true}],
                   neededList:[{id:'n1'}] };
  const d = describeMerge(before, after);
  ok('it counts what arrived', d.picksArrived === 1 && d.waitArrived === 1 && d.ticksArrived === 1, d);
  ok('and knows something happened', d.changed === true);
  const line = mergeReport(d);
  ok('and says so in one sentence',
     /1 recipe added to the week/.test(line) && /1 Wait List item added/.test(line)
     && /1 item ticked off/.test(line), line);

  const quiet = describeMerge(before, before);
  ok('an unchanged merge reports nothing', quiet.changed === false && mergeReport(quiet) === null);
  ok('plurals read properly',
     /2 recipes added/.test(mergeReport({changed:true, picksArrived:2})), mergeReport({changed:true, picksArrived:2}));
  ok('and a removal is reported as a removal',
     /1 recipe taken off the week/.test(mergeReport({changed:true, picksRemoved:1})));
}

/* ---------- result ---------- */

console.log('\n' + '-'.repeat(48));
if (fail) {
  console.log(fail + ' failed, ' + pass + ' passed\n');
  failures.forEach(f => console.log('  FAILED: ' + f));
  process.exit(1);
}
console.log('all ' + pass + ' passed');
