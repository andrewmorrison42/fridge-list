#!/usr/bin/env node
/*
 * The Fridge Door — sync logic tests
 *
 *   node test/door-tests.js
 *
 * No dependencies, no build, no browser — same contract as test/run-tests.js.
 *
 * Functions are EXTRACTED from door/index.html by brace-matching rather than copied,
 * so a rename fails loudly instead of quietly testing a stale duplicate. Shared
 * constants are pulled from the source the same way.
 *
 * Scope: the family merge. The Fridge Door's data file is new, with no older readers,
 * so unlike the Fridge List's Wait List it can carry deletion tombstones — meaning an
 * addition made offline is never lost AND a deletion still propagates. These tests
 * exist mostly to hold that property in place.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'door', 'index.html');
const html = fs.readFileSync(SRC, 'utf8');

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

function extract(name) {
  const start = html.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('Could not find function ' + name + '() in door/index.html');
  let depth = 0, started = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (c === '{') { depth++; started = true; }
    else if (c === '}') { depth--; if (started && depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error('Unbalanced braces while extracting ' + name + '()');
}

function extractConst(name) {
  const m = html.match(new RegExp('const\\s+' + name + '\\s*=\\s*([^;]+);'));
  if (!m) throw new Error('Could not find const ' + name + ' in door/index.html');
  return m[0];
}

const FUNCS = ['tsOf', 'mergeFlag', 'mergeChore', 'mergeNotice', 'mergeList',
               'mergeFamilyData', 'purgeTombstones', 'defaultFamilyData'];

const sandbox = { console, Date };
vm.createContext(sandbox);
vm.runInContext(
  extractConst('TICK_TIE_WINDOW_MS') + '\n' +
  extractConst('TOMBSTONE_TTL_MS') + '\n' +
  FUNCS.map(extract).join('\n\n') + '\n' +
  'this.api = { tsOf, mergeFlag, mergeChore, mergeNotice, mergeList, mergeFamilyData,' +
  '             purgeTombstones, defaultFamilyData,' +
  '             TICK_TIE_WINDOW_MS, TOMBSTONE_TTL_MS };',
  sandbox
);
const { mergeFamilyData, mergeChore, purgeTombstones, defaultFamilyData,
        TICK_TIE_WINDOW_MS, TOMBSTONE_TTL_MS } = sandbox.api;

/* ---------- fixtures ---------- */

const BASE = Date.parse('2026-08-16T10:00:00Z');
const T = ms => new Date(BASE + ms).toISOString();

const chore = (id, o) => Object.assign(
  { id, text: id, assignee: '', done: false, addedAt: T(0), changedAt: T(0) }, o || {});
const notice = (id, o) => Object.assign(
  { id, text: id, author: '', pinned: false, addedAt: T(0), changedAt: T(0) }, o || {});

const data = (o, lastUpdated) => Object.assign(
  { chores: [], notices: [], people: [], lastUpdated: lastUpdated || T(0) }, o || {});

const ids = list => list.map(x => x.id).sort();
const byId = (list, id) => list.find(x => x.id === id);

/* ---------- constants really come from the source ---------- */

group('constants');
{
  ok('the tick window is read from door/index.html', TICK_TIE_WINDOW_MS === 10000, TICK_TIE_WINDOW_MS);
  ok('the tombstone lifetime is 30 days', TOMBSTONE_TTL_MS === 30*24*60*60*1000, TOMBSTONE_TTL_MS);
  ok('a fresh file has the expected shape',
     JSON.stringify(Object.keys(defaultFamilyData()).sort()) ===
     JSON.stringify(['chores','lastUpdated','notices','people']));
}

/* ---------- the property this whole design exists for ---------- */

group('an addition can never be lost');
{
  // The Fridge List's Wait List drops entries present only in the older file. This
  // must not: a chore added offline has to survive the other phone saving first.
  const mine   = data({ chores: [chore('c1', { text: 'Bins' })] }, T(1000));
  const theirs = data({ chores: [chore('c2', { text: 'Recycling' })] }, T(9000));
  const r = mergeFamilyData(mine, theirs);
  ok('both chores survive', ids(r.chores).join() === 'c1,c2', ids(r.chores));

  const flipped = mergeFamilyData(theirs, mine);
  ok('and in either order', ids(flipped.chores).join() === 'c1,c2', ids(flipped.chores));

  const n = mergeFamilyData(
    data({ notices: [notice('n1')] }, T(1000)),
    data({ notices: [notice('n2')] }, T(9000)));
  ok('notices too', ids(n.notices).join() === 'n1,n2', ids(n.notices));
}

group('a deletion still propagates');
{
  // Union alone would resurrect anything deleted. The tombstone is what stops that.
  const deleted = data({ chores: [chore('c1', { deletedAt: T(5000), changedAt: T(5000) })] }, T(5000));
  const stale   = data({ chores: [chore('c1')] }, T(9000));   // never saw the deletion
  const r = mergeFamilyData(stale, deleted);
  ok('the entry is still present as a tombstone', !!byId(r.chores, 'c1'));
  ok('and is marked deleted', !!byId(r.chores, 'c1').deletedAt, byId(r.chores, 'c1'));
  ok('order does not matter', !!byId(mergeFamilyData(deleted, stale).chores, 'c1').deletedAt);
}

group('finishing a chore');
{
  const undone = data({ chores: [chore('c1')] }, T(1000));
  const done   = data({ chores: [chore('c1', { done: true, doneAt: T(5000), changedAt: T(5000) })] }, T(5000));
  ok('done wins over not-yet-done', byId(mergeFamilyData(undone, done).chores, 'c1').done === true);

  // Two phones are never perfectly in sync; losing a completed chore is worse than
  // briefly keeping one, so a "done" inside the window beats an "undone".
  const reopened = data({ chores: [chore('c1', { done: false, doneAt: T(8000), changedAt: T(8000) })] }, T(8000));
  ok('done beats a near-simultaneous undo', byId(mergeFamilyData(done, reopened).chores, 'c1').done === true);

  const muchLater = data({ chores: [chore('c1', { done: false, doneAt: T(60000), changedAt: T(60000) })] }, T(60000));
  ok('a deliberate undo well afterwards still wins',
     byId(mergeFamilyData(done, muchLater).chores, 'c1').done === false);
}

group('pinning a notice');
{
  const plain  = data({ notices: [notice('n1')] }, T(1000));
  const pinned = data({ notices: [notice('n1', { pinned: true, pinnedAt: T(5000), changedAt: T(5000) })] }, T(5000));
  ok('a pin applies', byId(mergeFamilyData(plain, pinned).notices, 'n1').pinned === true);

  const unpinned = data({ notices: [notice('n1', { pinned: false, pinnedAt: T(9000), changedAt: T(9000) })] }, T(9000));
  ok('and unpinning wins when it is later — no tick bias here',
     byId(mergeFamilyData(pinned, unpinned).notices, 'n1').pinned === false);
}

group('family names');
{
  const a = data({ people: ['Andy', 'Sam'] }, T(1000));
  const b = data({ people: ['Sam', 'Kit'] }, T(9000));
  const r = mergeFamilyData(a, b);
  ok('names are unioned, not replaced', r.people.join() === 'Andy,Kit,Sam', r.people);
  ok('and deduplicated', new Set(r.people).size === r.people.length);
}

group('purity and convergence');
{
  const a = data({ chores: [chore('c1', { done: true, doneAt: T(1000) })] }, T(1000));
  const b = data({ chores: [chore('c1')], notices: [notice('n1')] }, T(2000));
  const snapA = JSON.stringify(a), snapB = JSON.stringify(b);
  const m1 = mergeFamilyData(a, b);
  ok('neither input is mutated', JSON.stringify(a) === snapA && JSON.stringify(b) === snapB);

  const norm = x => JSON.stringify([ids(x.chores), ids(x.notices), x.people]);
  ok('re-merging the same copy changes nothing', norm(mergeFamilyData(m1, b)) === norm(m1));
  ok('merging the other side back changes nothing', norm(mergeFamilyData(m1, a)) === norm(m1));
}

group('tombstones are purged eventually');
{
  const fresh = { chores: [chore('c1', { deletedAt: new Date().toISOString() })],
                  notices: [], people: [] };
  purgeTombstones(fresh);
  ok('a recent deletion is kept, so offline devices cannot resurrect it', fresh.chores.length === 1);

  const old = { chores: [chore('c1', { deletedAt: new Date(Date.now() - TOMBSTONE_TTL_MS - 1000).toISOString() })],
                notices: [notice('n1', { deletedAt: new Date(Date.now() - TOMBSTONE_TTL_MS - 1000).toISOString() })],
                people: [] };
  purgeTombstones(old);
  ok('an expired one is dropped so the file cannot grow forever',
     old.chores.length === 0 && old.notices.length === 0);

  const live = { chores: [chore('c1')], notices: [], people: [] };
  purgeTombstones(live);
  ok('live entries are untouched', live.chores.length === 1);
}

group('missing or malformed input');
{
  ok('a missing side returns the other', mergeFamilyData(null, data({})) !== null);
  const r = mergeFamilyData(data({ chores: [chore('c1')] }), data({}));
  ok('an empty side loses nothing', ids(r.chores).join() === 'c1');
  const noIds = mergeFamilyData(
    data({ chores: [chore('c1'), { text: 'no id' }] }),
    data({}));
  ok('an entry with no id is skipped rather than throwing', ids(noIds.chores).join() === 'c1');
}

/* ---------- result ---------- */

console.log('\n' + '-'.repeat(48));
if (fail) {
  console.log(fail + ' failed, ' + pass + ' passed\n');
  failures.forEach(f => console.log('  FAILED: ' + f));
  process.exit(1);
}
console.log('all ' + pass + ' passed');
