/*
 * The Fridge List — bite cases
 *
 * Each entry reintroduces a defect this project has actually shipped, as the smallest
 * edit to index.html that brings it back. `node test/bite.js` applies each one to a
 * throwaway copy and runs the logic suite against it. A case that does NOT make the
 * suite fail is a test that does not bite, which is the only thing that proves a test
 * is about the world rather than about the code it was written beside.
 *
 * Why this file exists. Twice in one session a fix was claimed to be structural and was
 * not, and both times the only thing that caught it was reverting the change by hand and
 * re-running. In v23.9 two new tests passed against the very bugs they were written for —
 * one because the hand-rolled revert was wrong, one because the assertion passed vacuously
 * on missing code. In v24.0 three of the first sync-clock API's guarantees turned out not
 * to be guarantees at all: nothing stopped a call site from naming the wrong event, so the
 * reverts sailed through. "I could not write the bug against this" is worth more than any
 * number of assertions about the bug, and it is worth nothing at all if nobody runs it.
 *
 * Writing a case:
 *
 *   name    what the defect was, in the words somebody would use to report it
 *   find    a string that occurs EXACTLY ONCE in index.html
 *   replace what the code said before the fix (or '' to delete the line)
 *
 * A case whose `find` no longer matches exactly once is reported as STALE and fails the
 * run. That is deliberate and it is the same bargain the rest of the suite makes by
 * extracting real functions out of index.html: when the code moves, the check that
 * guarded it says so out loud instead of quietly guarding nothing.
 *
 * When a case is genuinely obsolete — the code it describes is gone for good, not merely
 * moved — delete it and say why in docs/DECISIONS.md. Do not rewrite a case so it matches
 * again without checking it still reintroduces the defect; a case that applies cleanly and
 * changes nothing is worse than no case, because it reports success.
 */
'use strict';

module.exports = [
  /* ---- v24.0: the sync clock ---- */
  {
    name: 'a write stops claiming the copy it sent, so the phone reports itself behind ' +
          'its own write for ever',
    find: '          syncClock.wrote(wrote.lastModifiedDateTime);\n',
    replace: ''
  },
  {
    name: 'the metadata poll claims to have MERGED a copy it has only heard about',
    find: '    syncClock.answered(200, meta.lastModifiedDateTime);\n    if(!force && shoppingFastPollStamp',
    replace: '    syncClock.merged(meta.lastModifiedDateTime, null);\n    if(!force && shoppingFastPollStamp'
  },
  {
    name: 'the metadata poll claims to have WRITTEN a copy it has only heard about',
    find: '    syncClock.answered(200, meta.lastModifiedDateTime);\n    if(!force && shoppingFastPollStamp',
    replace: '    syncClock.wrote(meta.lastModifiedDateTime);\n    if(!force && shoppingFastPollStamp'
  },
  {
    name: 'a 404 counted as "cannot reach the folder" rather than "not created yet"',
    find: '      if(status === 404){ contact(); settle(); return; }',
    replace: '      if(status === 404){ failures++; return; }'
  },
  {
    name: 'a write advances the horizon, so it claims to have learnt something about ' +
          'the other phones',
    find: '    wrote(mtime){ contact(); if(mtime) take(mtime); settle(); },',
    replace: '    wrote(mtime){ this.merged(mtime, shoppingData); },'
  },
  {
    name: 'basedOn falls back to a local save clock, so the phone that has read nothing ' +
          'makes the freshest claim in the household',
    find: '    shoppingData.weekPlan.basedOn = syncClock.horizon();',
    replace: '    shoppingData.weekPlan.basedOn = syncClock.horizon() || shoppingData.lastUpdated || null;'
  },
  {
    name: 'the folder listing goes back to being two requests that answer differently ' +
          'about what just happened',
    find: '  const items = await fetchFolderListing(token);\n' +
          '  (items || []).forEach(i=>{ oneDriveLastModified[i.name] = i.lastModifiedDateTime; });',
    replace: '  if(!oneDriveFolderRef) return;\n' +
             '  const { driveId, itemId } = oneDriveFolderRef;\n' +
             "  const res = await graphFetch('/drives/' + driveId + '/items/' + itemId + '/children?$select=name,lastModifiedDateTime', token);\n" +
             '  if(res.status !== 200) return;\n' +
             '  const j = await res.json();\n' +
             '  (j.value || []).forEach(i=>{ oneDriveLastModified[i.name] = i.lastModifiedDateTime; });'
  },
  {
    name: 'a recipe read that did not come back is read as an empty folder, so a ' +
          'transient error overwrites the family’s recipes',
    find: '    } else if(rRead && rRead.absent){',
    replace: '    } else if(rRead === null || rRead.absent){'
  },

  {
    name: 'a merge that lands out of order drags `held` backwards, so the device reports ' +
          'itself behind a copy it is holding',
    find: '    if(!held || tsOf(mtime) >= tsOf(held)) held = mtime;',
    replace: '    held = mtime;'
  },

  /* ---- v24.0: the replacement record ---- */
  {
    name: '"Keep this one" mints a superseding trip whatever the stash is, so a phone ' +
          'that LOST supersedes its own dead trip',
    find: '  const rival = replacement.rival;',
    replace: '  const rival = true;'
  }
];
