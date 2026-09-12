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

const FUNCS = ['tsOf', 'tripIdOf', 'tripProgress', 'tripDecisions', 'tripHasProgress',
               'tripIsLive', 'tripIsWorkedOn', 'recipeSelectionsList', 'picksOnlyAdded',
               'chooseTripWinner', 'mergeFlag', 'flagStamp', 'mergeShoppingLine',
               'mergeShoppingData', 'lineMergeKey', 'selectionsSignature',
               'recipeSelectionsSignature', 'shoppingListIsStale',
               'featureOn', 'stapleQtyFor', 'stapleQtyToShopping', 'parseQty', 'fmtQty',
               'displayUnit', 'unitLabel', 'stapleUnitLabel', 'lineQtyText', 'findIngredientMeta', 'rollUpQty', 'fmtExactQty',
               'ingredientLineText', 'recipeToPlainText', 'recipeToHtml', 'buildShareBundle',
               'tripRecordFromShopping', 'mergeTripHistory', 'pruneTripHistory',
               'recipeHistoryLabel', 'recipeHistoryTime', 'daysSinceStamp', 'daysSinceCooked',
               'daysSincePlanned', 'migrateCookedStamps',
               'cookRateSummary', 'atHomeStreaks', 'clearedWeekPlan',
               'sameTripRebuild', 'stashReplacedTrip', 'clearReplacement', 'generateShoppingList',
               'mergeAuthored', 'resolveAuthoredItem', 'otherSideDropped',
               'effectiveAddedAt', 'authoredHorizons', 'describeMerge', 'mergeReport',
               'lastAuthoredAt', 'noteRemoved', 'mergeTombstones', 'pruneTombstones',
               'backfillAuthoredStamps',
               'syncAlertState', 'lastContactText',
               'doneCountsHere', 'syncNeededFromLine',
               'tripParts', 'tripCode', 'tripLabel', 'tripConflict', 'keepThisList',
               'pendingWaitListLines', 'listFreshness', 'agoText',
               // v24.0: the one owner of "how current is this device". A factory, so a
               // test can build its own and drive event sequences — which is what turns
               // v23.9's three source assertions into behaviour assertions.
               'makeSyncClock'];

const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(
  'const TICK_TIE_WINDOW_MS = ' + TICK_TIE_WINDOW_MS + ';\n' +
  'let shoppingData = null;\n' +
  'let replacement = null;\n' +
  // v24.0: the app's single instance. Tests that need their own build one with
  // makeSyncClock(nowFn); everything extracted from index.html shares this one.
  'const syncClock = makeSyncClock();\n' +
  // The two genuine I/O calls on the rebuild path. Everything that DECIDES anything is
  // still the real function out of index.html.
  'function persist(){}\n' +
  'function deviceId(){ return "test-device"; }\n' +
  // v23.6: keepThisList decides, writes and then repaints. The deciding is the part worth
  // testing; the repaint and the status line are the same kind of I/O as persist().
  'function render(){}\n' +
  'function setStatus(){}\n' +
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
  extractConst('TOMBSTONE_MAX_AGE_MS') + '\n' +
  extractConst('TOMBSTONE_MAX') + '\n' +
  extractConst('SELECTION_FIELDS') + '\n' +
  extractConst('SHOPPING_UNIT_OPTIONS') + '\n' +
  extractConst('WAITLIST_FIELDS') + '\n' +
  extractConst('SYNC_UNLINKED_GRACE_MS') + '\n' +
  extractConst('FRESHNESS_GRACE_MS') + '\n' +
  extractConst('FRESHNESS_UNREACHABLE_MS') + '\n' +
  extractConst('FRESHNESS_MIN_FAILURES') + '\n' +
  FUNCS.map(extract).join('\n\n') + '\n' +
  'this.api = { mergeShoppingData, selectionsSignature, shoppingListIsStale, lineMergeKey,' +
  '             tripIdOf, parseQty, lineQtyText, displayUnit, stapleQtyToShopping, stapleQtyFor,' +
  '             ingredientLineText, recipeToPlainText, recipeToHtml, buildShareBundle, SHARE_MARKER,' +
  '             unitLabel, stapleUnitLabel, SHOPPING_UNIT_OPTIONS, MEASURE_ML,' +
  '             tripProgress, tripDecisions, tripHasProgress, tripIsLive, tripIsWorkedOn,' +
  '             chooseTripWinner, TRIP_LIVE_WINDOW_MS,' +
  '             sameTripRebuild, stashReplacedTrip, generateShoppingList,' +
  '             getReplacedTrip: () => replacement, setReplacedTrip: t => { replacement = t; },' +
  '             currentShopping: () => shoppingData,' +
  '             currentLines: () => (shoppingData && shoppingData.shoppingList) || [],' +
  '             tripRecordFromShopping, mergeTripHistory, pruneTripHistory, TRIP_HISTORY_MAX,' +
  '             recipeHistoryLabel, recipeHistoryTime, migrateCookedStamps,' +
  '             cookRateSummary, atHomeStreaks, clearedWeekPlan,' +
  '             mergeAuthored, otherSideDropped, MERGE_GRACE_MS, SELECTION_FIELDS, WAITLIST_FIELDS,' +
  '             describeMerge, mergeReport,' +
  '             noteRemoved, mergeTombstones, pruneTombstones, lastAuthoredAt, TOMBSTONE_MAX_AGE_MS,' +
  '             backfillAuthoredStamps,' +
  '             syncAlertState, lastContactText, SYNC_STALE_MS, SYNC_UNLINKED_GRACE_MS,' +
  '             doneCountsHere, syncNeededFromLine,' +
  '             tripParts, tripCode, tripLabel, tripConflict, keepThisList,' +
  '             pendingWaitListLines, listFreshness, agoText,' +
  '             FRESHNESS_GRACE_MS, FRESHNESS_UNREACHABLE_MS, FRESHNESS_MIN_FAILURES,' +
  '             makeSyncClock, syncClock,' +
  '             setShoppingData: d => { shoppingData = d; },' +
  '             setRecipesData: d => { recipesData = d; } };',
  sandbox
);
const { mergeShoppingData, selectionsSignature, shoppingListIsStale, tripIdOf,
        parseQty, lineQtyText, displayUnit, stapleQtyToShopping, stapleQtyFor,
        ingredientLineText, recipeToPlainText, recipeToHtml, buildShareBundle, SHARE_MARKER,
        unitLabel, stapleUnitLabel, SHOPPING_UNIT_OPTIONS, MEASURE_ML,
        tripProgress, tripDecisions, tripHasProgress, tripIsLive, tripIsWorkedOn,
        chooseTripWinner, TRIP_LIVE_WINDOW_MS,
        sameTripRebuild, stashReplacedTrip, generateShoppingList,
        getReplacedTrip, setReplacedTrip,
        tripRecordFromShopping, mergeTripHistory, pruneTripHistory, TRIP_HISTORY_MAX,
        recipeHistoryLabel, recipeHistoryTime, migrateCookedStamps,
        cookRateSummary, atHomeStreaks, clearedWeekPlan,
        mergeAuthored, otherSideDropped, MERGE_GRACE_MS, SELECTION_FIELDS, WAITLIST_FIELDS,
        describeMerge, mergeReport,
        noteRemoved, mergeTombstones, pruneTombstones, lastAuthoredAt, TOMBSTONE_MAX_AGE_MS,
        backfillAuthoredStamps,
        syncAlertState, lastContactText, SYNC_STALE_MS, SYNC_UNLINKED_GRACE_MS,
        doneCountsHere, syncNeededFromLine,
        tripParts, tripCode, tripLabel, tripConflict, keepThisList,
        pendingWaitListLines, listFreshness, agoText,
        FRESHNESS_GRACE_MS, FRESHNESS_UNREACHABLE_MS, FRESHNESS_MIN_FAILURES,
        makeSyncClock, syncClock,
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

group('the knowledge horizon is this device’s, and the merge never adopts another’s');
{
  /* Found by adversarial review of v23.0. mergeShoppingData builds its result with
     Object.assign({}, secondary, primary), so seenRemoteAt was taken from whichever file
     was NEWER — normally the remote copy, since that is usually why a merge is running.
     That value is the other device's record of how far IT had read, always behind what
     this device has just read, so the horizon silently regressed on the commonest path in
     the app. A device that under-claims what it has seen cannot have its deletions
     honoured by anyone else. Nothing asserted this before: the existing tests fed
     seenRemoteAt in as input and checked deletion outcomes, never what came back out. */
  const MIN = 60*1000;
  const remote = { weekPlan:{tripId:'t', generatedAt:T(0), selections:[]},
                   shoppingList:[], neededList:[],
                   lastUpdated: T(10*MIN), seenRemoteAt: T(5*MIN) };   // newer file, older horizon
  const local  = { weekPlan:{tripId:'t', generatedAt:T(0), selections:[]},
                   shoppingList:[], neededList:[],
                   lastUpdated: T(2*MIN), seenRemoteAt: T(10*MIN) };   // just advanced by the read

  const merged = mergeShoppingData(local, remote);
  ok('the local horizon survives a merge with a newer remote file',
     merged.seenRemoteAt === T(10*MIN), merged.seenRemoteAt);
  ok('and is not the other device’s record of what IT had read',
     merged.seenRemoteAt !== remote.seenRemoteAt);

  // The same when the local file happens to be the newer one — the answer must not depend
  // on whose clock ran fastest.
  const localNewer = Object.assign({}, local, { lastUpdated: T(20*MIN) });
  ok('and it survives when the local file is the newer one too',
     mergeShoppingData(localNewer, remote).seenRemoteAt === T(10*MIN));

  // A device that has never read anything still reports never having read anything.
  const virgin = Object.assign({}, local, { seenRemoteAt: null });
  ok('a device with no horizon does not inherit one from the file it merges',
     mergeShoppingData(virgin, remote).seenRemoteAt === null,
     mergeShoppingData(virgin, remote).seenRemoteAt);

  /* And the consequence the bug actually had: a device whose horizon regressed would fail
     to have its deletions honoured. This is the same scenario one step on. */
  const deleter = { weekPlan:{tripId:'t', generatedAt:T(0), selections:[]},
                    shoppingList:[], neededList:[],          // it deleted the entry
                    lastUpdated: T(11*MIN), seenRemoteAt: T(10*MIN) };
  const holder  = { weekPlan:{tripId:'t', generatedAt:T(0), selections:[]},
                    shoppingList:[],
                    neededList:[{id:'n1', text:'shampoo', addedAt:T(1*MIN), done:false}],
                    lastUpdated: T(10*MIN), seenRemoteAt: T(0) };
  ok('a deletion made by a device with a true horizon is honoured',
     mergeShoppingData(deleter, holder).neededList.length === 0);
  ok('but the same deletion is NOT honoured once that horizon has regressed',
     mergeShoppingData(Object.assign({}, deleter, { seenRemoteAt: T(0) }), holder)
       .neededList.length === 1);
}

group('a deletion sticks because it was recorded, not because it was inferred');
{
  /* Reported on v23.1: clear the week and the picks come back within a poll. Two defects
     behind it, both introduced by v23.0's decision to infer deletions from timestamps.

     A. Items made before v23.0 carry no addedAt, so effectiveAddedAt falls back to the
        file's lastUpdated — which saveShoppingLocal bumps on EVERY save. A pick made a
        week ago, in a file saved seconds ago, presents as seconds old and can never be
        shown to have been seen. Permanently undeletable; waiting does not help.
     B. Any removal within roughly 110s of the addition fails the same test, on all three
        deletion paths.

     A recorded removal answers both, because it never consults addedAt at all. */
  const DAY = 86400*1000, S = 1000;
  const pick = (id, addedAt) => addedAt ? {recipeId:id, servings:4, addedAt:addedAt, changedAt:addedAt}
                                        : {recipeId:id, servings:4};      // pre-v23.0 shape
  const held = (picks, lastUpdated) => ({
    weekPlan:{ tripId:'trip:old', generatedAt:T(-7*DAY), selections:picks },
    shoppingList:[], neededList:[], lastUpdated:lastUpdated, seenRemoteAt:T(-DAY) });
  const cleared = (removedIds, at) => ({
    weekPlan:{ tripId:'trip:new', generatedAt:at, supersedes:'trip:old', selections:[],
               selectionsRemoved: removedIds.reduce((m,id)=>{ m[id]=at; return m; }, {}) },
    shoppingList:[], neededList:[], lastUpdated:at, seenRemoteAt:T(-60*S) });

  // Defect A, exactly as reported: a week untouched, then a clear that will not stick.
  const legacy = [pick('r1'), pick('r2'), pick('r3')];
  const both = (a,b) => [mergeShoppingData(a,b), mergeShoppingData(b,a)];
  both(cleared(['r1','r2','r3'], T(0)), held(legacy, T(-5*S))).forEach((m,i)=>{
    ok('a week-old pick with no addedAt, in a freshly-saved file, stays cleared [' + i + ']',
       m.weekPlan.selections.length === 0, m.weekPlan.selections);
  });

  // Defect B: the same, at every delay that used to matter.
  [10*S, 60*S, 110*S, DAY].forEach(delay=>{
    const picks = [pick('r1', T(0)), pick('r2', T(0))];
    const m = mergeShoppingData(cleared(['r1','r2'], T(delay)), held(picks, T(S)));
    ok('cleared ' + Math.round(delay/1000) + 's after picking, and it stays cleared',
       m.weekPlan.selections.length === 0, m.weekPlan.selections);
  });

  // Removing ONE pick sticks too — the path a per-collection watermark would have missed.
  {
    const keep = pick('keep', T(0)), drop = pick('drop', T(0));
    const after = { weekPlan:{ tripId:'trip:old', generatedAt:T(0), selections:[keep],
                               selectionsRemoved:{ drop: T(30*S) } },
                    shoppingList:[], neededList:[], lastUpdated:T(30*S), seenRemoteAt:T(0) };
    const ids = mergeShoppingData(after, held([keep, drop], T(S)))
                  .weekPlan.selections.map(x=>x.recipeId);
    ok('removing a single pick 30s after choosing it sticks',
       ids.join() === 'keep', ids);
  }

  // A removal must not outrank a later re-add, or a recipe could never be picked again.
  {
    const readded = { weekPlan:{ tripId:'t', generatedAt:T(0),
                                 selections:[pick('r1', T(60*S))],
                                 selectionsRemoved:{ r1: T(30*S) } },
                      shoppingList:[], neededList:[], lastUpdated:T(60*S), seenRemoteAt:T(0) };
    ok('re-adding after a removal wins, because the re-add is later',
       mergeShoppingData(readded, held([pick('r1', T(0))], T(S)))
         .weekPlan.selections.length === 1);
  }

  // And a tombstone must not reach across to something the other phone added afterwards.
  {
    const clearedEarly = cleared(['r1'], T(10*S));
    const addedLater = held([pick('r1', T(300*S))], T(300*S));
    ok('a removal does not delete an addition made after it',
       mergeShoppingData(clearedEarly, addedLater).weekPlan.selections.length === 1);
  }

  // The Wait List behaves identically — one rule, still.
  {
    const entry = { id:'n1', text:'shampoo', addedAt:T(0), done:false };
    const holder = { weekPlan:{tripId:'t',generatedAt:T(0),selections:[]},
                     shoppingList:[], neededList:[entry], lastUpdated:T(S), seenRemoteAt:T(0) };
    const emptied = { weekPlan:{tripId:'t',generatedAt:T(0),selections:[]},
                      shoppingList:[], neededList:[], neededRemoved:{ n1: T(30*S) },
                      lastUpdated:T(30*S), seenRemoteAt:T(0) };
    ok('clearing the Wait List 30s after adding to it sticks',
       mergeShoppingData(emptied, holder).neededList.length === 0);
  }

  // The record itself has to survive the merge, or it only works once.
  {
    const m = mergeShoppingData(cleared(['r1'], T(0)), held([pick('r1', T(-DAY))], T(-DAY)));
    ok('and the record of the removal is carried into the merged copy',
       !!(m.weekPlan.selectionsRemoved && m.weekPlan.selectionsRemoved.r1),
       m.weekPlan.selectionsRemoved);
  }
}

group('the record of a removal is itself well behaved');
{
  const DAY = 86400*1000;
  ok('a removal is stamped', noteRemoved({}, ['a'], T(0)).a === T(0));
  ok('a later removal of the same thing replaces the earlier',
     noteRemoved({a: T(0)}, ['a'], T(1000)).a === T(1000));
  ok('and an earlier one does not', noteRemoved({a: T(1000)}, ['a'], T(0)).a === T(1000));
  ok('noteRemoved does not mutate what it is given',
     (()=>{ const m={}; noteRemoved(m,['a'],T(0)); return Object.keys(m).length===0; })());

  const merged = mergeTombstones({a:T(0), b:T(5000)}, {b:T(9000), c:T(0)}, T(9000));
  ok('two records merge, later stamp winning',
     merged.a===T(0) && merged.b===T(9000) && merged.c===T(0), merged);
  ok('and the merge is order-independent',
     JSON.stringify(mergeTombstones({b:T(9000)}, {b:T(5000)}, T(9000)))
     === JSON.stringify(mergeTombstones({b:T(5000)}, {b:T(9000)}, T(9000))));

  const old = { ancient: T(-90*DAY), recent: T(-1*DAY) };
  const pruned = pruneTombstones(old, T(0));
  ok('a record too old to matter is dropped', pruned.ancient === undefined, pruned);
  ok('and a recent one is kept', pruned.recent === T(-1*DAY));

  ok('a legacy item with no stamps reads as authored at the dawn of time, so any record beats it',
     lastAuthoredAt({recipeId:'r'}) === 0);
  ok('and an edited item reads by its changedAt',
     lastAuthoredAt({addedAt:T(0), changedAt:T(5000)}) === Date.parse(T(5000)));
}

group('legacy items get a creation time that stops moving');
{
  const sd = { weekPlan:{ selections:[{recipeId:'r1'}, {recipeId:'r2', addedAt:T(0)}] },
               neededList:[{id:'n1', text:'x'}], lastUpdated:T(5000) };
  backfillAuthoredStamps(sd);
  ok('an unstamped pick is stamped with the file it arrived in',
     sd.weekPlan.selections[0].addedAt === T(5000));
  ok('one that already had a stamp is left alone',
     sd.weekPlan.selections[1].addedAt === T(0));
  ok('and the Wait List is treated the same', sd.neededList[0].addedAt === T(5000));

  // The point of it: a second pass with a newer lastUpdated must NOT move the stamp on.
  sd.lastUpdated = T(999999);
  backfillAuthoredStamps(sd);
  ok('a later save does not push the stamp forward — that was the bug',
     sd.weekPlan.selections[0].addedAt === T(5000));

  ok('a file with no lastUpdated is left alone rather than guessed at',
     backfillAuthoredStamps({ weekPlan:{selections:[{recipeId:'r'}]}, neededList:[] })
       .weekPlan.selections[0].addedAt === undefined);
}

/* ---------- v23.3: pruning the list is work, and a rebuild must not throw it away ----------

   Reported from a real shop on v23.2: someone marks items "at home" or removes them with
   the X on the Review tab, somebody else adds another recipe, and every one of those
   decisions is undone. The cause is not the merge — it is that `tripProgress` counts only
   TICKS, so a carefully pruned list looks untouched to every mechanism that exists to
   protect a shopper's work, and `generateShoppingList` carried the flags across only on a
   same-trip rebuild. Adding a recipe changes recipeSelectionsSignature(), so it was never
   the same trip. */

// A pantry and two recipes sharing one ingredient, so the rebuild has something to roll up.
function pruningWorld(){
  setRecipesData({
    recipes: [
      { id:'r1', name:'Chorizo stew', servings:4, ingredients:[
        { ingredientName:'Chorizo', quantity:'200', unit:'g' },
        { ingredientName:'Olive oil', quantity:'2', unit:'tbsp' },
        { ingredientName:'Onion', quantity:'1', unit:'' } ] },
      { id:'r2', name:'Pancakes', servings:4, ingredients:[
        { ingredientName:'Flour', quantity:'200', unit:'g' },
        { ingredientName:'Milk', quantity:'300', unit:'ml' },
        { ingredientName:'Olive oil', quantity:'1', unit:'tbsp' } ] }
    ],
    ingredients: [
      { name:'Chorizo',   shoppingUnit:'g',  aisle:'Meat',   shoppingCategory:'Meat' },
      { name:'Olive oil', shoppingUnit:'ml', aisle:'Pantry', shoppingCategory:'Pantry' },
      { name:'Onion',     shoppingUnit:'',   aisle:'Veg',    shoppingCategory:'Veg' },
      { name:'Flour',     shoppingUnit:'g',  aisle:'Pantry', shoppingCategory:'Pantry' },
      { name:'Milk',      shoppingUnit:'ml', aisle:'Dairy',  shoppingCategory:'Dairy' }
    ],
    settings: { features:{}, staples:[], stapleQty:{}, alwaysAtHome:[] }
  });
  setReplacedTrip(null);
  setShoppingData({
    weekPlan: { selections:[{ recipeId:'r1', servings:4, addedAt:T(0) }] },
    shoppingList: [], neededList: [], lastUpdated: T(0)
  });
  generateShoppingList();
}

const lineNamed = n => shoppingDataLines().find(l => l.ingredientName === n);
function shoppingDataLines(){
  // The sandbox owns shoppingData; read it back through a function the app itself uses.
  return sandbox.api.currentLines();
}

group('v23.3 — two people pruning at once');
{
  /* The family's own requirement: several phones must be able to prune the same list at
     the same time. Nothing here is new code — mergeShoppingLine already resolves removed
     and atHome per flag by their own stamps — but nothing asserted it either, and the
     whole point of v23.3 is that this is now the common case rather than a curiosity. */
  const A = listFor([
    line('chorizo', { removed: true, removedAt: T(1000), changedAt: T(1000) }),
    line('olive oil', { atHome: true, atHomeAt: T(1100), changedAt: T(1100) }),
    line('flour'), line('milk')
  ], T(1100));
  const B = listFor([
    line('chorizo'), line('olive oil'),
    line('flour', { removed: true, removedAt: T(2000), changedAt: T(2000) }),
    line('milk', { atHome: true, atHomeAt: T(2100), changedAt: T(2100) })
  ], T(2100));

  const r = mergeShoppingData(A, B);
  ok('my removal survives their copy', byName(r, 'chorizo').removed === true);
  ok('my "at home" survives their copy', byName(r, 'olive oil').atHome === true);
  ok('their removal survives mine', byName(r, 'flour').removed === true);
  ok('their "at home" survives mine', byName(r, 'milk').atHome === true);

  const flipped = mergeShoppingData(B, A);
  const shape = d => JSON.stringify(d.shoppingList
    .map(l => [l.ingredientName, !!l.removed, !!l.atHome]).sort());
  ok('and it does not matter whose phone merged first', shape(flipped) === shape(r));
}

group('v23.3 — a pruned list is not thrown away by a phone that has done nothing');
{
  // The other half of "protects but does not lock": with nothing ticked, the old rule
  // judged these two forks on generatedAt alone, so the phone that had merely opened the
  // tab could replace an evening of pruning with a clean list.
  const pruned = listFor([
    line('chorizo', { removed: true, removedAt: T(1000), changedAt: T(1000) }),
    line('olive oil', { atHome: true, atHomeAt: T(1000), changedAt: T(1000) })
  ], T(1000), { tripId: 'trip:pruned', generatedAt: T(1000) });
  const untouched = listFor([
    line('chorizo'), line('olive oil')
  ], T(9000), { tripId: 'trip:fresh', generatedAt: T(9000) });

  ok('the pruned list counts as worked on', tripIsWorkedOn(pruned, BASE + 2000) === true);
  ok('the untouched one does not', tripIsWorkedOn(untouched, BASE + 9500) === false);
  ok('so the pruning wins even though the other list is newer',
     chooseTripWinner(pruned, untouched, T(1000), T(9000), untouched, BASE + 9500) === pruned);
  ok('and it is decided the same way round the other way',
     chooseTripWinner(untouched, pruned, T(9000), T(1000), untouched, BASE + 9500) === pruned);

  // But it still lapses: six hours after the last decision nobody is working on it.
  ok('a pruned list nobody has touched for six hours stops defending itself',
     tripIsWorkedOn(pruned, BASE + 1000 + TRIP_LIVE_WINDOW_MS + 1) === false);
}

group('v23.3 — pruning is work: decisions survive somebody adding a recipe');
{
  pruningWorld();
  const now = new Date().toISOString();

  // What a person actually does at the kitchen table before leaving.
  lineNamed('Olive oil').atHome = true;  lineNamed('Olive oil').atHomeAt = now;
  lineNamed('Onion').atHome    = true;   lineNamed('Onion').atHomeAt    = now;
  lineNamed('Chorizo').removed = true;   lineNamed('Chorizo').removedAt = now;

  ok('pruning alone is not a tick, so the trip is not "live" — the Start tab stays open',
     tripIsLive(sandbox.api.currentShopping()) === false);

  // ...and then somebody adds a second recipe to the week.
  sandbox.api.currentShopping().weekPlan.selections.push({ recipeId:'r2', servings:4, addedAt:now });
  generateShoppingList();

  ok('an ingredient marked "at home" is still at home after a recipe is added',
     lineNamed('Olive oil') && lineNamed('Olive oil').atHome === true);
  ok('an at-home ingredient only the first recipe used is still at home',
     lineNamed('Onion') && lineNamed('Onion').atHome === true);
  ok('an ingredient removed with the X is still removed',
     lineNamed('Chorizo') && lineNamed('Chorizo').removed === true);
  ok('the stamps survive too, or the other phone would win with its stale copy',
     lineNamed('Olive oil').atHomeAt === now && lineNamed('Chorizo').removedAt === now);
  ok('the recipe that was added did arrive on the list',
     !!lineNamed('Flour') && !!lineNamed('Milk'));
  ok('a line the new recipe contributes to is not silently at home',
     lineNamed('Flour').atHome !== true);
}

group('v23.3 — ticks still belong to their trip');
{
  pruningWorld();
  const now = new Date().toISOString();
  lineNamed('Chorizo').checked = true; lineNamed('Chorizo').checkedAt = now;
  const before = tripIdOf(sandbox.api.currentShopping());

  // Adding a recipe EXTENDS the shop; it is the same trip, so the trolley survives.
  sandbox.api.currentShopping().weekPlan.selections.push({ recipeId:'r2', servings:4, addedAt:now });
  generateShoppingList();
  ok('adding a recipe keeps the same trip, so a tick is not thrown away',
     tripIdOf(sandbox.api.currentShopping()) === before && lineNamed('Chorizo').checked === true);

  // Taking one back OFF is a different list, and a new trip starts clean of ticks.
  sandbox.api.currentShopping().weekPlan.selections =
    sandbox.api.currentShopping().weekPlan.selections.filter(x => x.recipeId !== 'r1');
  generateShoppingList();
  /* Not asserted on the trip id: it is minted from new Date(), and this whole block runs
     inside one millisecond, so two genuinely different trips can share an id here. What
     a new trip demonstrably does is name the one it supersedes. */
  ok('removing a recipe does start a new trip',
     !!sandbox.api.currentShopping().weekPlan.supersedes);
  ok('and last trip’s ticks do not leak into it',
     shoppingDataLines().every(l => !l.checked));
}

group('v23.3 — a pruned list is worth protecting, even with nothing ticked');
{
  pruningWorld();
  const now = new Date().toISOString();
  lineNamed('Chorizo').removed = true; lineNamed('Chorizo').removedAt = now;
  const sd = sandbox.api.currentShopping();

  ok('a pruned list counts as work worth keeping', tripHasProgress(sd) === true);
  ok('but it does not lock the week’s recipes — that needs a tick', tripIsLive(sd) === false);

  setReplacedTrip(null);
  sd.weekPlan.selections = [{ recipeId:'r2', servings:4, addedAt:now }];   // a genuine replacement
  generateShoppingList();
  ok('replacing the week stashes the pruned list, so there is an undo',
     !!getReplacedTrip());
}

group('v23.3 — a decision has to be a decision, not a default');
{
  pruningWorld();
  const sd = sandbox.api.currentShopping();
  sd.shoppingList.forEach(l => { l.atHome = true; });   // as the pantry rule would leave it
  ok('an unstamped "at home" is a default and does not count as work',
     tripHasProgress(sd) === false);
}

/* ---------- v23.4: an ingredient you add yourself can be given a unit ----------

   Reported: adding a new ingredient never asks for the units. It never could — every
   creation site wrote shoppingUnit:'' and no control anywhere in the app could set it,
   while the recipe editor's unit box told people to change it in Settings, where the
   control did not exist. */

group('v23.4 — one rule for what a shopping unit is called');
{
  ok('a unit that was never set reads as "each"', unitLabel('') === 'each');
  ok('so does one that is missing altogether', unitLabel(undefined) === 'each');
  ok('"qty" reads as "each" — it is stored, not shown', unitLabel('qty') === 'each');
  ok('so does any other counted token', unitLabel('each') === 'each' && unitLabel('pcs') === 'each');
  ok('a real unit reads as itself', unitLabel('g') === 'g' && unitLabel('mL') === 'mL');
  ok('and whitespace does not make a new unit', unitLabel('  g  ') === 'g');

  // The staples row had the only correct version of this rule. It must now BE that rule,
  // not a second copy of it that can drift.
  setRecipesData({ recipes: [], ingredients: [
      { name:'Banana', shoppingUnit:'qty' }, { name:'Flour', shoppingUnit:'g' },
      { name:'Nduja', shoppingUnit:'' } ],
    settings:{ features:{}, staples:[], stapleQty:{} } });
  ok('the staples label agrees with it for a counted ingredient',
     stapleUnitLabel('Banana') === unitLabel('qty'));
  ok('...for a weighed one', stapleUnitLabel('Flour') === unitLabel('g'));
  ok('...for one with no unit yet', stapleUnitLabel('Nduja') === unitLabel(''));
  ok('...and for a name that is not an ingredient at all',
     stapleUnitLabel('nothing by this name') === 'each');
  noStaples();
}

group('v23.4 — the picker offers only units the app can work with');
{
  const vals = SHOPPING_UNIT_OPTIONS.map(o => o.value);
  ok('it offers exactly the three the data uses, plus "not set"',
     JSON.stringify(vals) === JSON.stringify(['', 'g', 'mL', 'qty']), vals);
  /* A kitchen measure must never become a shopping unit: it hard-locks the recipe
     editor's unit box to that measure forever after, which is why saveRecipeFromForm
     converts such lines to mL instead. */
  ok('and never a kitchen measure',
     !vals.some(v => Object.prototype.hasOwnProperty.call(MEASURE_ML, v)), Object.keys(MEASURE_ML));
  ok('every option has a label a person can read',
     SHOPPING_UNIT_OPTIONS.every(o => typeof o.label === 'string' && o.label.trim().length > 0));
}

/* ================= v23.5: a tick on the Wait List is still a tick =================

   The bug this group exists for, reported from a real shop: two phones, and the items
   one shopper put in the trolley crossed off on the other's phone ONLY where a Wait List
   entry was behind them. Recipe ingredients stayed unticked.

   Both collections travel in the same file, so the data always arrived. The split is the
   merge: shoppingList is trip-scoped and a mismatched tripId makes chooseTripWinner throw
   one side's list away wholesale, while neededList is authored data and merges regardless
   of the trip. `done` therefore crossed and `checked` did not. And because finishShopping
   deleted every done entry, the shop then binned Wait List items nobody had bought.

   The discarded ticks are deliberate and stay that way. What is fixed is that a `done`
   set in the aisle now records the trip it belonged to, so a phone on another trip stops
   treating somebody else's trolley as a decision about the week. */

const waitItem = (o) => Object.assign(
  { id: 'n1', text: 'Milk', done: false, addedAt: T(0) }, o || {});

group('v23.5 — a done that came from the aisle knows which trip it came from');
{
  setShoppingData(listFor([], T(0), { tripId: 'trip:here' }));
  ok('an entry nobody has ticked is not done',
     doneCountsHere(waitItem()) === false);
  ok('a Wait List decision counts — no trip, because it is about the week',
     doneCountsHere(waitItem({ done: true })) === true);
  ok('so does a copy from a build before v23.5, which stamped no trip',
     doneCountsHere(waitItem({ done: true, changedAt: T(10) })) === true);
  ok('a tick made on THIS trip counts',
     doneCountsHere(waitItem({ done: true, doneTripId: 'trip:here' })) === true);
  ok('a tick made on ANOTHER phone’s trip does not',
     doneCountsHere(waitItem({ done: true, doneTripId: 'trip:elsewhere' })) === false);
  ok('and the trip can be named explicitly rather than read off shoppingData',
     doneCountsHere(waitItem({ done: true, doneTripId: 'trip:elsewhere' }),
                    { weekPlan: { tripId: 'trip:elsewhere' } }) === true);
}

group('v23.5 — ticking a line in the aisle stamps the trip, unticking clears it');
{
  const sd = listFor([line('Milk', { neededIds: ['n1'] })], T(0), { tripId: 'trip:here' });
  sd.neededList = [waitItem()];
  setShoppingData(sd);
  syncNeededFromLine(sd.shoppingList[0], true);
  ok('the Wait List entry is done', sd.neededList[0].done === true);
  ok('and carries the trip it was ticked on', sd.neededList[0].doneTripId === 'trip:here');
  syncNeededFromLine(sd.shoppingList[0], false);
  ok('unticking clears the flag', sd.neededList[0].done === false);
  ok('and the trip with it, so nothing stale is left behind',
     Object.prototype.hasOwnProperty.call(sd.neededList[0], 'doneTripId') === false);

  // A recipe-only line has no Wait List entry behind it and must not touch one.
  const other = listFor([line('Rice')], T(0), { tripId: 'trip:here' });
  other.neededList = [waitItem({ done: false })];
  setShoppingData(other);
  syncNeededFromLine(other.shoppingList[0], true);
  ok('a line with no Wait List entry behind it changes nothing',
     other.neededList[0].done === false);
}

group('v23.5 — the reported shop: two phones, two trips');
{
  // Phone 2 ticks Onions (recipe only) and Milk (a Wait List entry folded into the
  // ingredient line) on ITS trip. Phone 1 is on a different one.
  const mk = (trip) => {
    const d = listFor([line('Onions'), line('Milk', { neededIds: ['n1'] })], T(0),
                      { tripId: trip, basedOn: T(0) });
    d.neededList = [waitItem()];
    d.seenRemoteAt = T(0);
    return d;
  };
  const mine = mk('trip:phone-1');
  const theirs = mk('trip:phone-2');
  theirs.shoppingList.forEach(l => { l.checked = true; l.checkedAt = T(9000); l.changedAt = T(9000); });
  theirs.neededList[0] = waitItem({ done: true, changedAt: T(9000), doneTripId: 'trip:phone-2' });
  mine.lastUpdated = T(9500);   // phone 1's copy is the newer file, and its trip wins
  theirs.lastUpdated = T(9000);

  const r = mergeShoppingData(mine, theirs);
  ok('phone 1 keeps its own list, as chooseTripWinner intends',
     tripIdOf(r) === 'trip:phone-1');
  ok('the other trip’s ticks do not leak onto it — the rule this all rests on',
     r.shoppingList.every(l => !l.checked));
  // The bug: the same tick used to cross the Wait List entry off here anyway.
  ok('the Wait List entry still carries the other phone’s done flag',
     r.neededList[0].done === true);
  setShoppingData(r);
  ok('but it does NOT read as done on this phone',
     doneCountsHere(r.neededList[0]) === false);
  ok('and the trip it belonged to travelled with it',
     r.neededList[0].doneTripId === 'trip:phone-2');
}

group('v23.5 — on ONE trip, both kinds of tick still cross as they always did');
{
  const mk = () => {
    const d = listFor([line('Onions'), line('Milk', { neededIds: ['n1'] })], T(0),
                      { tripId: 'trip:shared' });
    d.neededList = [waitItem()];
    d.seenRemoteAt = T(0);
    return d;
  };
  const mine = mk(); mine.lastUpdated = T(1000);
  const theirs = mk(); theirs.lastUpdated = T(9000);
  theirs.shoppingList.forEach(l => { l.checked = true; l.checkedAt = T(9000); l.changedAt = T(9000); });
  theirs.neededList[0] = waitItem({ done: true, changedAt: T(9000), doneTripId: 'trip:shared' });

  const r = mergeShoppingData(mine, theirs);
  ok('the recipe ingredient is ticked', byName(r, 'Onions').checked === true);
  ok('the Wait List line is ticked', byName(r, 'Milk').checked === true);
  setShoppingData(r);
  ok('and the Wait List entry reads as done here', doneCountsHere(r.neededList[0]) === true);
}

group('v23.5 — a foreign trip’s tick does not keep an item off the next list');
{
  setRecipesData({
    recipes: [{ id: 'r1', name: 'Curry', servings: 2,
                ingredients: [{ ingredientName: 'Onions', quantity: '2', unit: 'qty' }] }],
    ingredients: [{ name: 'Onions', aisle: 'Veg', shoppingCategory: 'Fresh', shoppingUnit: 'qty' },
                  { name: 'Milk', aisle: 'Dairy', shoppingCategory: 'Dairy', shoppingUnit: 'mL' }],
    settings: { features: { staples: false, pantryAtHome: false }, staples: [], stapleQty: {} }
  });
  const sd = listFor([], T(0), { tripId: 'trip:here', selections: [{ recipeId: 'r1', servings: 2 }] });
  sd.neededList = [waitItem({ done: true, changedAt: T(9000), doneTripId: 'trip:elsewhere' })];
  setShoppingData(sd);
  generateShoppingList();
  ok('the Wait List item is back on the list, unbought',
     !!sandbox.api.currentLines().find(l => l.ingredientName === 'Milk'));
  ok('and it is not ticked',
     sandbox.api.currentLines().every(l => !l.checked));

  // A decision — ticked on the Wait List tab, no trip — still keeps it off.
  const sd2 = listFor([], T(0), { tripId: 'trip:here', selections: [{ recipeId: 'r1', servings: 2 }] });
  sd2.neededList = [waitItem({ done: true, changedAt: T(9000) })];
  setShoppingData(sd2);
  generateShoppingList();
  ok('a Wait List decision still keeps the item off',
     !sandbox.api.currentLines().find(l => l.ingredientName === 'Milk'));
  noStaples();
}

group('v23.5 — a replaced list says so, in its own words');
{
  const before = listFor([line('Onions', { checked: true, checkedAt: T(9000) })], T(9000),
                         { tripId: 'trip:phone-1' });
  const after  = listFor([line('Onions')], T(9500), { tripId: 'trip:phone-2' });
  const d = describeMerge(before, after);
  ok('the swap is noticed', d.tripReplaced === true);
  ok('and the ticks it cost are counted', d.ticksLost === 1);
  ok('it counts as a change even when nothing else moved', d.changed === true);
  const line1 = mergeReport(d);
  ok('the sentence does not pretend this is catching up',
     line1.indexOf('Caught up') === -1, line1);
  ok('it says another phone’s list replaced this one',
     line1.indexOf('replaced the one on this device') !== -1, line1);
  ok('it names the ticks that are not on it', line1.indexOf('1 item ticked off here') !== -1, line1);
  ok('and points at the undo that already exists',
     line1.indexOf('Put back the list that was replaced') !== -1, line1);

  const same = describeMerge(before, listFor([line('Onions', { checked: true, checkedAt: T(9000) })],
                                             T(9500), { tripId: 'trip:phone-1' }));
  ok('an ordinary merge on one trip is not reported as a replacement',
     same.tripReplaced === false && mergeReport(same) === null);
}

/* ================= v23.6: a name, a tap, and an argument that ends =================

   v23.5 fixed the damage a fork did. These three close the fork itself: the trip has a
   name two people can compare, nothing builds a list without somebody asking, and a
   disagreement is raised on BOTH phones and settled by whichever one acts. */

group('v23.6 — a trip id somebody can read out');
{
  const A = 'trip:2026-08-15T10:00:00.000Z:d-phone1';
  const B = 'trip:2026-08-15T10:00:00.001Z:d-phone1';
  ok('a code is four characters', tripCode(A).length === 4, tripCode(A));
  ok('the same id always gives the same code', tripCode(A) === tripCode(A));
  ok('a different trip gives a different code — one millisecond apart',
     tripCode(A) !== tripCode(B), [tripCode(A), tripCode(B)]);
  ok('no id at all still returns something printable', tripCode(null) === '----');
  ok('the code is upper case and unambiguous to read out',
     /^[0-9A-Z-]{4}$/.test(tripCode(A)), tripCode(A));

  // The id embeds an ISO timestamp, which contains colons of its own.
  ok('the device is what follows the LAST colon', tripParts(A).device === 'd-phone1');
  ok('and the timestamp survives intact', tripParts(A).at === '2026-08-15T10:00:00.000Z');
  ok('a pre-v21 gen: id has a time and no device',
     tripParts('gen:2026-08-15T10:00:00.000Z').at === '2026-08-15T10:00:00.000Z'
     && tripParts('gen:2026-08-15T10:00:00.000Z').device === null);
  ok('and nothing at all is handled', tripParts(null).device === null);
}

group('v23.6 — the label says whose phone made the list');
{
  const sd = listFor([], T(0), { tripId: 'trip:2026-08-15T10:00:00.000Z:d-mine' });
  const label = tripLabel(sd, 'd-mine');
  ok('it leads with the code', label.indexOf('List ' + tripCode(tripIdOf(sd))) === 0, label);
  ok('it says this phone when the device matches',
     label.indexOf('on this phone') !== -1, label);
  ok('and another phone when it does not',
     tripLabel(sd, 'd-theirs').indexOf('on another phone') !== -1, tripLabel(sd, 'd-theirs'));
  ok('a phone with no list says so rather than showing a code',
     tripLabel(listFor([], T(0), { tripId: null, generatedAt: null }), 'd-mine')
       .indexOf('No shopping list') === 0);
  ok('a pre-v21 file gets a code and no phone claim',
     tripLabel({ weekPlan: { generatedAt: '2026-08-15T10:00:00.000Z' } }, 'd-mine')
       .indexOf('phone') === -1);
}

/* The card must never claim an outcome the merge did not reach, so tripConflict decides
   by calling chooseTripWinner rather than by reasoning about it a second time. These
   assert the agreement directly, across every case chooseTripWinner distinguishes. */
group('v23.6 — a disagreement is named, and names the same winner the merge will');
{
  const trip = (id, o) => listFor((o && o.lines) || [line('milk')], (o && o.at) || T(0),
    Object.assign({ tripId: id }, o && o.wp));
  ok('one trip is not a disagreement',
     tripConflict(trip('t1'), trip('t1')) === null);
  ok('nor is a copy with no trip at all',
     tripConflict(trip('t1'), listFor([], T(0), { tripId: null, generatedAt: null })) === null);

  // 1. a deliberate replacement
  {
    const mine = trip('t1', { wp: { supersedes: 't2' }, at: T(100) });
    const theirs = trip('t2', { at: T(200) });
    const c = tripConflict(mine, theirs);
    ok('superseding wins even from the older file', c.iWon === true);
    ok('and the loser handed back is the other copy', c.loser === theirs);
  }
  // 2. work beats no work
  {
    const mine = trip('t1', { at: T(200) });
    const theirs = trip('t2', { lines: [line('milk', { checked: true, checkedAt: T(150) })],
                                at: T(100) });
    const c = tripConflict(mine, theirs, BASE + 1000);
    ok('a list somebody has worked on beats an untouched newer one', c.iWon === false);
    ok('and this side is what would be lost', c.loser === mine);
  }
  // 3. neither worked on: the fresher basedOn
  {
    const mine = trip('t1', { wp: { basedOn: T(50) }, at: T(100) });
    const theirs = trip('t2', { wp: { basedOn: T(10) }, at: T(200) });
    ok('the device that had caught up wins', tripConflict(mine, theirs).iWon === true);
  }
  ok('both trip ids are reported so the caller can tell them apart',
     tripConflict(trip('t1', { at: T(200) }), trip('t2')).mineTrip === 't1'
     && tripConflict(trip('t1', { at: T(200) }), trip('t2')).theirsTrip === 't2');
}

group('v23.6 — keeping a list settles it, rather than pausing the argument');
{
  const mine = listFor([line('milk', { checked: true, checkedAt: T(100) })], T(200),
                       { tripId: 'trip:mine', basedOn: T(0) });
  setShoppingData(mine);
  /* The state this button exists for: a fork this phone WON, so the other phone is still
     holding the losing trip and offering it on every poll. `rival` is that fact. */
  setReplacedTrip({ tripId: 'trip:theirs', ticks: 3, decisions: 3, argued: true, iWon: true,
                    rival: true, weekPlan: { tripId: 'trip:theirs' }, shoppingList: [] });
  keepThisList();
  const after = sandbox.api.currentShopping();
  ok('a new trip is minted', tripIdOf(after) !== 'trip:mine');
  ok('and it names the list it replaces', after.weekPlan.supersedes === 'trip:theirs');
  ok('the lines and their ticks are untouched',
     after.shoppingList.length === 1 && after.shoppingList[0].checked === true);
  ok('the stash is cleared', getReplacedTrip() === null);
  // The point of minting rather than dismissing: it now WINS, so the other phone stops
  // offering its copy on every poll.
  const theirs = listFor([line('milk')], T(300), { tripId: 'trip:theirs', basedOn: T(0) });
  const c = tripConflict(after, theirs);
  ok('and it beats the other list outright, even from the older file', c.iWon === true);
  setReplacedTrip(null);
}

/* v24.0. v23.6 minted in every case; superseding is right in one of the three ways a
   stash appears, and `rival` is the fact that tells them apart. */
group('v24.0 — keeping a list that nothing is arguing with does not mint a trip');
{
  /* This phone LOST: the list on screen IS the other phone's, and the stash is this
     device's own dead trip. Minting superseded a trip nobody holds, left the real winner
     unsuperseded, and made a third id out of a two-way argument. */
  const theirsHeldHere = listFor([line('milk', { checked: true, checkedAt: T(100) })], T(200),
                                 { tripId: 'trip:theirs', basedOn: T(0) });
  setShoppingData(theirsHeldHere);
  setReplacedTrip({ tripId: 'trip:mine-dead', ticks: 2, decisions: 2, argued: true,
                    iWon: false, rival: false,
                    weekPlan: { tripId: 'trip:mine-dead' }, shoppingList: [] });
  keepThisList();
  const after = sandbox.api.currentShopping();
  ok('the trip on screen is left exactly as it is', tripIdOf(after) === 'trip:theirs');
  ok('nothing is superseded — the winner was never in question',
     after.weekPlan.supersedes === undefined);
  ok('and the stash still goes', getReplacedTrip() === null);

  /* A local replacement — generate, clear, import. The trip on screen already names what
     it replaced, so there is nothing for this button to add. */
  const localGen = listFor([line('flour')], T(300),
                           { tripId: 'trip:new', supersedes: 'trip:old', basedOn: T(0) });
  setShoppingData(localGen);
  setReplacedTrip({ tripId: 'trip:old', ticks: 0, decisions: 4,
                    weekPlan: { tripId: 'trip:old' }, shoppingList: [] });
  keepThisList();
  const after2 = sandbox.api.currentShopping();
  ok('a locally replaced list keeps the lineage generateShoppingList already wrote',
     tripIdOf(after2) === 'trip:new' && after2.weekPlan.supersedes === 'trip:old');
  setReplacedTrip(null);
}

/* The other half of the record: an undo and an argument have different lifetimes, and
   two module variables could never keep that straight. */
group('v24.0 — the stash outlives the argument, on one record');
{
  const sd = listFor([line('milk', { checked: true, checkedAt: T(100) })], T(200),
                     { tripId: 'trip:mine' });
  setShoppingData(sd);
  stashReplacedTrip(sd, { argued: true, iWon: true, rival: true });
  const r = getReplacedTrip();
  ok('a fork raises the banner', !!(r && r.argued));
  ok('and marks the other phone as still offering its list', r.rival === true);

  // What a clean merge does: the argument ends, the undo does not.
  r.argued = false; r.rival = false;
  ok('a settled fork stops the banner', getReplacedTrip().argued === false);
  ok('but the list is still there to put back', !!getReplacedTrip().shoppingList);

  // A bare stash claims nothing at all.
  stashReplacedTrip(sd, {});
  const bare = getReplacedTrip();
  ok('a stash with no argument attached never raises the banner', bare.argued === false);
  ok('and never asks for a write', bare.rival === false);
  setReplacedTrip(null);
}

/* A source assertion, not a behaviour one, and deliberately so: the rule is about how
   many ways there are to reach generateShoppingList, which no runtime test can see. The
   auto-refresh was added in v21.8 and fenced twice before it was removed; a third fence
   would be somebody re-adding the call, and this is what notices. */
group('v23.7 — exactly two things build a shopping list: a tap, and the Wait List');
{
  const calls = (html.match(/(?<!function )\bgenerateShoppingList\(\)/g) || []).length;
  ok('generateShoppingList() is called from exactly two places', calls === 2, calls);
  const btn = html.slice(html.indexOf('function generateNowButton('));
  ok('one is the button\u2019s click handler',
     btn.slice(0, btn.indexOf('\n}')).indexOf("addEventListener('click'") !== -1);
  /* v23.7: and the other is the Wait List exception, fenced by all four conditions. A
     third caller, or this one losing a guard, is the auto-refresh coming back. */
  const exc = html.slice(html.indexOf('const arrivedFromWaitList'),
                         html.indexOf('const noListYet'));
  ok('the other is the Wait List exception', exc.indexOf('generateShoppingList()') !== -1);
  ok('fenced by staleness, the same trip, and an unchanged recipe signature',
     /listIsStale && keepsTicks && !recipesChanged/.test(exc));
  ok('and by a Wait List entry actually being missing',
     exc.indexOf('pendingWaitListLines(shoppingData)') !== -1);
}

group('v23.6 — the banner puts a disagreement above everything but a failed write');
{
  const base = { backend: 'onedrive', signedIn: true, startedAt: 0, now: 10 * 60 * 1000 };
  const won = syncAlertState(Object.assign({}, base, { tripConflict: { iWon: true } }));
  ok('it fires', won && won.kind === 'conflict');
  ok('and says two phones disagree', won.head.indexOf('different shopping lists') !== -1, won.head);
  ok('the winning side is told the other list is being dropped',
     won.hint.indexOf('is being dropped') !== -1, won.hint);
  const lost = syncAlertState(Object.assign({}, base, { tripConflict: { iWon: false } }));
  ok('the losing side is told its own list went',
     lost.hint.indexOf('has been replaced') !== -1, lost.hint);
  ok('the action goes to the list, not the sync modal', lost.actionKind === 'review');

  ok('a failed write still outranks it',
     syncAlertState(Object.assign({}, base, {
       tripConflict: { iWon: true }, lastWriteError: { status: 412, name: 'x' } })).kind === 'error');
  ok('an unconnected phone is still told that first when there is no conflict',
     syncAlertState(Object.assign({}, base, { backend: null })).kind === 'unlinked');
  ok('and no conflict means the old cases are untouched',
     syncAlertState(base) === null);
}

/* ================= v23.7: the one exception, and where this list stands ================= */

group('v23.7 — a Wait List entry is "on the list" only when a line carries its id');
{
  setRecipesData({
    recipes: [], settings: { features: {}, staples: [], stapleQty: {} },
    ingredients: [{ name: 'Milk', aisle: 'Dairy', shoppingCategory: 'Dairy', shoppingUnit: 'mL' }]
  });
  const sd = (lines, needed) => Object.assign(listFor(lines, T(0), { tripId: 'trip:here' }),
                                              { neededList: needed });

  ok('an entry with no line at all is pending',
     pendingWaitListLines(sd([], [waitItem({ text: 'Shampoo' })])).length === 1);
  ok('an entry whose line carries its id is not',
     pendingWaitListLines(sd([line('Milk', { neededIds: ['n1'] })], [waitItem()])).length === 0);
  /* The case name-matching gets wrong: "milk" added to the Wait List while a recipe
     already needs Milk. The line exists, so a name check calls it done — but until that
     line carries the entry's id, ticking it off in the aisle crosses nothing off. */
  ok('an entry folded onto an existing line is pending until that line carries its id',
     pendingWaitListLines(sd([line('Milk', { neededIds: [] })], [waitItem()])).length === 1);
  ok('an entry already done here is not pending',
     pendingWaitListLines(sd([], [waitItem({ done: true })])).length === 0);
  ok('but one ticked on ANOTHER phone’s trip is — that tick is not this list’s',
     pendingWaitListLines(sd([], [waitItem({ done: true, doneTripId: 'trip:elsewhere' })])).length === 1);
  ok('nothing at all is handled', pendingWaitListLines(null).length === 0);
  noStaples();
}

group('v23.8 — the strip is silent unless something is wrong');
{
  const shared = { backend: 'onedrive', signedIn: true, lastCheckedAt: BASE, now: BASE };
  const at = (o) => listFreshness(Object.assign({}, shared, o));

  /* v23.7 always said something, including "in step". A permanent line above the trolley
     on a screen people stare at for 45 minutes earns nothing when the news is good, and
     it dilutes the cases that do. */
  ok('a phone in step says nothing at all', at({}) === null);
  ok('and a phone that shares with nobody says nothing here either — the banner has it',
     listFreshness({ backend: null, now: BASE }) === null);
  ok('nor a signed-out OneDrive phone',
     listFreshness({ backend: 'onedrive', signedIn: false, now: BASE }) === null);

  /* Being behind for a moment is normal — the 5s poll fixes it. Warning inside the grace
     would cry wolf every time the other shopper ticked something. */
  ok('a copy that has just fallen behind is not yet worth saying',
     at({ behindSince: BASE - (FRESHNESS_GRACE_MS - 1000) }) === null);
  const behind = at({ behindSince: BASE - 5 * 60 * 1000 });
  ok('one that has stayed behind is', behind.kind === 'behind');
  ok('it says plainly that this is not the family\u2019s list',
     behind.head.indexOf('not the family\u2019s latest list') !== -1, behind.head);
  ok('it warns that acting on it forks the list',
     behind.hint.indexOf('second list') !== -1, behind.hint);
  ok('and the button says what it does', behind.action === 'Catch up now');

  /* Order matters: behind outranks everything, because rebuilding from a stale base is
     the act that mints a rival trip. */
  ok('behind outranks a picks change',
     at({ behindSince: BASE - 5 * 60 * 1000, picksChanged: true, keepsTicks: true }).kind === 'behind');
  ok('and outranks a frozen week',
     at({ behindSince: BASE - 5 * 60 * 1000, picksChanged: true, shopLive: true }).kind === 'behind');

  const frozen = at({ picksChanged: true, keepsTicks: false, shopLive: true });
  ok('a live shop with changed recipes is frozen, not offered a rebuild', frozen.kind === 'frozen');
  ok('and is given no button at all', !frozen.action);

  const upd = at({ picksChanged: true, keepsTicks: true, recipesChanged: true });
  ok('a same-trip picks change offers an update', upd.action === 'Update the list');
  ok('and promises the ticks survive', upd.hint.indexOf('already ticked off') !== -1, upd.hint);
  const fresh = at({ picksChanged: true, keepsTicks: false, recipesChanged: true });
  ok('a new-trip one says it costs the ticks', fresh.action === 'Make a new list');
  ok('and that the old list is recoverable', fresh.hint.indexOf('put back') !== -1, fresh.hint);
  ok('a staple change is not reported as a recipe change',
     at({ picksChanged: true, keepsTicks: true, recipesChanged: false }).head.indexOf('recipes') === -1);
  ok('a picks change on an unshared phone is still worth saying — it is actionable here',
     listFreshness({ backend: null, picksChanged: true, keepsTicks: true, now: BASE }).kind === 'picks');
}

/* v23.8. The v23.7 version of this counted time since the last SUCCESSFUL read, and
   pollShoppingNow returns early while the screen is off — so a phone in a pocket between
   aisles was indistinguishable from one that could not reach the folder, and flashed a
   warning every time somebody picked it up. A warning follows a failed attempt, never a
   missing one. */
group('v23.8 — "cannot reach" counts failed attempts, not elapsed time');
{
  const stale = BASE - 10 * 60 * 1000;   // well past FRESHNESS_UNREACHABLE_MS
  const at = (o) => listFreshness(Object.assign(
    { backend: 'onedrive', signedIn: true, now: BASE }, o));

  ok('a long silence with no failed attempt says nothing — the phone was in a pocket',
     at({ lastCheckedAt: stale, checkFailures: 0 }) === null);
  ok('nor does one failure', at({ lastCheckedAt: stale, checkFailures: 1 }) === null);
  ok('nor two', at({ lastCheckedAt: stale, checkFailures: 2 }) === null);

  const gone = at({ lastCheckedAt: stale, checkFailures: FRESHNESS_MIN_FAILURES });
  ok('three failures and a real gap does', gone.kind === 'unreachable');
  ok('it says what is actually wrong', gone.head.indexOf('reach the family') !== -1, gone.head);
  ok('and both directions of the cost', gone.hint.indexOf('not on here') !== -1
     && gone.hint.indexOf('reaching them') !== -1, gone.hint);
  ok('with a button worth pressing', gone.action === 'Try again');

  /* The other half of the pair: three failures inside one bad second is a blip, not an
     outage. */
  ok('three failures without a real gap is still a blip',
     at({ lastCheckedAt: BASE - 1000, checkFailures: 5 }) === null);

  ok('behind still outranks it',
     at({ lastCheckedAt: stale, checkFailures: 5, behindSince: BASE - 5 * 60 * 1000 }).kind === 'behind');
  ok('but it outranks a picks change',
     at({ lastCheckedAt: stale, checkFailures: 5, picksChanged: true, keepsTicks: true }).kind === 'unreachable');
  ok('and an unshared phone never reports it — there is nothing to reach',
     listFreshness({ backend: null, lastCheckedAt: stale, checkFailures: 9, now: BASE }) === null);
}

/* ---- v24.0: the sync clock ----

   v23.9 found five defects in "how current is this device" and fixed them at five call
   sites. Three of its assertions had to be SOURCE assertions — grep index.html for a call
   shape — because the state was module-global and the I/O async. The clock is a factory,
   so those are ordinary behaviour assertions now: build one, drive events, read the
   snapshot. That change is the point; the fixes are what falls out of it. */
group('v24.0 — an answer says what is out there, and nothing about what this device has');
{
  const c = makeSyncClock(()=> BASE);
  c.merged('M0', { lastUpdated: T(0) });
  ok('holding a copy is not being behind it', c.snapshot().behindSince === null);

  c.answered(200, 'M1');
  ok('a newer copy out there does put this device behind', c.snapshot().behindSince !== null);
  // The regression v23.9's first attempt nearly shipped: recognising an mtime is not
  // having the copy, so no number of answers can clear this.
  c.answered(200, 'M1'); c.answered(200, 'M1');
  ok('and no amount of hearing about it clears that — only holding it does',
     c.snapshot().behindSince !== null);
  c.merged('M1', { lastUpdated: T(100) });
  ok('holding it does', c.snapshot().behindSince === null);
}

/* v24.0.1. Every test above drives its events in increasing mtime order, which is how the
   code was written and therefore how the tests were written. Out of order is not
   hypothetical: syncInFlight guards the two pollers, but writeShoppingMerged also merges,
   from the 600 ms autosave timer, and checks nothing — so a write-path merge can land
   after a poll-path one carrying an older copy. v24.0 guarded `latest` against going
   backwards and not `held`, one line above it. */
group('v24.0.1 — neither mtime goes backwards, whatever order the merges land in');
{
  const c = makeSyncClock(()=> BASE);
  c.merged('2026-09-12T10:00:02Z', { lastUpdated: T(2000) });   // the 5s poll, newest copy
  ok('in step after merging the newest copy', c.snapshot().behindSince === null);

  c.merged('2026-09-12T10:00:01Z', { lastUpdated: T(1000) });   // the write path, older
  ok('an out-of-order merge does not make it behind itself',
     c.snapshot().behindSince === null);
  ok('and the horizon still does not go backwards', c.horizon() === T(2000));

  // A genuinely newer copy out there must still register, or the guard would have bought
  // silence rather than correctness.
  c.answered(200, '2026-09-12T10:00:09Z');
  ok('a real newer copy still reports behind', c.snapshot().behindSince !== null);

  // Same rule for the write path: an out-of-order write echo must not regress it either.
  const d = makeSyncClock(()=> BASE);
  d.merged('2026-09-12T10:00:02Z', { lastUpdated: T(2000) });
  d.wrote('2026-09-12T10:00:01Z');
  ok('nor does an out-of-order write echo', d.snapshot().behindSince === null);
}

group('v24.0 — a write is not a way to fall behind yourself');
{
  // The v23.9 A scenario, end to end, as behaviour rather than as a grep.
  const c = makeSyncClock(()=> BASE);
  c.merged('M0', { lastUpdated: T(0) });   // read and merged the shared copy
  c.wrote('M1');                           // this device wrote; the folder's mtime moved
  c.answered(200, 'M1');                   // the next poll sees its own write
  ok('a phone in step with its own write stays in step', c.snapshot().behindSince === null);
  ok('and the strip says nothing at all',
     listFreshness(Object.assign({ backend: 'onedrive', signedIn: true, now: BASE + 60000 },
                                 c.snapshot())) === null);
  // A write teaches this device nothing about anybody else, so the horizon must not move.
  ok('but writing does not advance the horizon', c.horizon() === T(0));
}

group('v24.0 — the folder answering is not the folder failing');
{
  /* The call site hands over the status and this decides what it meant, so 404 cannot be
     "not created yet" in one function and "cannot reach the folder" in another. */
  const c = makeSyncClock(()=> BASE);
  c.answered(500, null); c.answered(503, null); c.unreachable();
  ok('failed reads accumulate', c.snapshot().checkFailures === 3);
  ok('and with no contact at all there is nothing to date the warning from',
     c.snapshot().lastCheckedAt === null);

  // A 404 is an answer: fetchRemoteShopping has always read it as "not created yet".
  c.answered(404, null);
  ok('a file that is not there yet clears the failure count',
     c.snapshot().checkFailures === 0);
  ok('and counts as contact', c.snapshot().lastCheckedAt === BASE);
  ok('so the strip stays quiet',
     listFreshness(Object.assign({ backend: 'onedrive', signedIn: true,
                                  now: BASE + 60 * 60 * 1000 }, c.snapshot())) === null);
}

group('v24.0 — the horizon is a fact about the shared folder, or it is nothing');
{
  const c = makeSyncClock(()=> BASE);
  ok('a device that has read nothing claims nothing', c.horizon() === null);

  // Restoring from localStorage is not reaching the folder — lastContactText's "never"
  // must stay unflattered.
  c.restore(T(500));
  ok('a restored horizon is remembered', c.horizon() === T(500));
  ok('but restoring is not contact', c.snapshot().lastCheckedAt === null);
  ok('and lastContactText still says never',
     lastContactText(null, BASE).indexOf('never') !== -1);

  c.merged('M1', { lastUpdated: T(100) });
  ok('and the horizon never goes backwards', c.horizon() === T(500));
  c.merged('M2', { lastUpdated: T(900) });
  ok('only forwards', c.horizon() === T(900));
  c.wrote('M3');
  ok('and a write never moves it at all — it taught this device nothing',
     c.horizon() === T(900));
}

/* The consequence in the rule that reads it. Every pre-v24.0 test handed basedOn in as a
   literal, so nothing ever asked where the value came from — and it came from a local save
   clock that ratchets on every save, so the phone that had read NOTHING wrote the freshest
   claim in the household and won chooseTripWinner's third rule against every phone that
   had read something. */
group('v24.0 — a device with no horizon makes no claim about how caught-up it is');
{
  setRecipesData({ recipes: [{ id: 'r1', name: 'Soup', servings: 4, ingredients: [] }],
                   ingredients: [], settings: { features: {}, staples: [], stapleQty: {} } });
  const weekOf = trip => ({ lastUpdated: T(9e6), seenRemoteAt: null, neededList: [], shoppingList: [],
    weekPlan: { selections: [{ recipeId: 'r1', servings: 4, addedAt: T(0), changedAt: T(0) }],
                tripId: trip, generatedAt: T(0) } });

  setShoppingData(weekOf('trip:before'));
  generateShoppingList();
  ok('a phone that has never read the folder claims nothing',
     sandbox.api.currentShopping().weekPlan.basedOn === null);

  // Note what is NOT reachable from generateShoppingList any more: there is no
  // shoppingData.lastUpdated fallback to reach for, because syncClock.horizon() is the
  // only way to ask and lastUpdated is not in its scope.
  syncClock.merged('M9', { lastUpdated: T(5000) });
  setShoppingData(weekOf('trip:before2'));
  generateShoppingList();
  ok('and one that has claims exactly what it read',
     sandbox.api.currentShopping().weekPlan.basedOn === T(5000));
  noStaples();

  /* Neither trip is worked on, so chooseTripWinner's rule 3 decides. The caught-up phone
     must win; with the old fallback the stale one carried `now` and took it. */
  const staleDevice = { lastUpdated: T(9e6), shoppingList: [],
    weekPlan: { tripId: 'trip:stale', generatedAt: T(9e6), basedOn: null, selections: [] } };
  const caughtUp = { lastUpdated: T(1000), shoppingList: [],
    weekPlan: { tripId: 'trip:caught', generatedAt: T(1000), basedOn: T(900), selections: [] } };
  ok('a fork between a stale phone and a caught-up one goes to the caught-up one',
     chooseTripWinner(staleDevice, caughtUp, Date.parse(T(9e6)), Date.parse(T(1000)),
                      staleDevice, BASE + 9e6) === caughtUp);
}

/* ---- v24.0: the structure, not the instances ----

   Source assertions, and deliberately so: the rule is about how many places can touch this
   state and whether every folder request reports what it meant — which no runtime test can
   see. v23.9 fixed five call sites; these are what stop a sixth appearing. */
group('v24.0 — nothing owns this state but the clock');
{
  const gone = ['shoppingSeenRemoteAt', 'shoppingRemoteModifiedSeen',
                'shoppingRemoteModifiedLatest', 'shoppingBehindSince',
                'shoppingLastCheckedAt', 'shoppingCheckFailures', 'tripDisagreement'];
  gone.forEach(name=>{
    ok(name + ' is not a module variable any more',
       !(new RegExp('\\blet\\s+' + name + '\\b').test(html)));
  });
  // The clock's own fields live in its closure; nothing outside can name them.
  ok('the clock keeps its fields to itself',
     !/\bsyncClock\.(horizon|held|latest|behindSince|failures)\s*=/.test(html));
  /* A function that has only metadata in hand cannot claim to hold a copy: merged() wants
     the copy itself. That is the v23.9-A regression made awkward to write rather than
     forbidden in a comment — and the reason the poll reports through answered(). */
  ok('nothing claims to hold a copy it has not got',
     (html.match(/syncClock\.merged\(/g) || []).length === 1);
  ok('and only the write says it wrote',
     (html.match(/syncClock\.wrote\(/g) || []).length === 1);
  ok('and there is exactly one instance of it',
     (html.match(/=\s*makeSyncClock\(/g) || []).length === 1);
}

group('v24.0 — every folder request says what it meant');
{
  /* Split index.html into top-level functions and check the ones that actually talk to the
     folder about the shopping file. A thirteenth call site added later without a clock
     event fails here rather than silently under-reporting, which is how all five v23.9
     defects got in. */
  const fns = {};
  const re = /\n(?:async )?function ([a-zA-Z_][\w]*)\s*\(/g;
  let m, marks = [];
  while((m = re.exec(html))) marks.push({ name: m[1], at: m.index });
  marks.forEach((mark, i)=>{
    fns[mark.name] = html.slice(mark.at, i + 1 < marks.length ? marks[i + 1].at : html.length);
  });

  const talksToFolder = Object.keys(fns).filter(n=>
    /graphFetch\(/.test(fns[n]) && /shopping-list\.json/.test(fns[n]));
  ok('the shopping file is reached from a known, small set of functions',
     talksToFolder.length >= 3 && talksToFolder.length <= 5, talksToFolder);
  talksToFolder.forEach(n=>{
    ok(n + '() reports to the clock',
       /syncClock\.(answered|merged|wrote|unreachable)\(/.test(fns[n]));
  });

  /* The folder listing is one request with one reporting rule. stampOneDriveTimestamps
     and pollOneDriveForChanges used to issue it separately and answer differently about
     what had just happened — and the stamp, which runs after every autosave, answered
     nothing at all. */
  ok('the folder listing has exactly one caller of graphFetch',
     (html.match(/children\?\$select=name,lastModifiedDateTime/g) || []).length === 1);
  ok('and both pollers go through it',
     /fetchFolderListing\(token\)/.test(fns['stampOneDriveTimestamps'])
     && /fetchFolderListing\(token\)/.test(fns['pollOneDriveForChanges']));

  /* absent and failed are different answers on the two files the clock does not govern
     too: reading null for both is what let a transient 500 overwrite the family's recipes
     with whatever this phone happened to hold. */
  ok('a read that did not come back is not read as an empty folder',
     /if\(res\.status === 404\) return \{ absent: true \};/.test(fns['getOneDriveFileText']));
  ok('and the recipe load only creates the file when the folder says it is not there',
     /rRead && rRead\.absent/.test(fns['loadFromOneDriveOrSeed']));
}

group('v23.7 — the "how long ago" wording is coarse on purpose');
{
  ok('seconds read as just now', agoText(8000) === 'just now');
  ok('so does anything inside the poll grace', agoText(44000) === 'just now');
  ok('a minute is a minute', agoText(60 * 1000) === '1 minute ago');
  ok('and plurals are respected', agoText(90 * 1000) === '2 minutes ago');
  ok('hours', agoText(3 * 60 * 60 * 1000) === '3 hours ago');
  ok('and days', agoText(72 * 60 * 60 * 1000) === '3 days ago');
}

/* ---------- result ---------- */


console.log('\n' + '-'.repeat(48));
if (fail) {
  console.log(fail + ' failed, ' + pass + ' passed\n');
  failures.forEach(f => console.log('  FAILED: ' + f));
  process.exit(1);
}
console.log('all ' + pass + ' passed');
