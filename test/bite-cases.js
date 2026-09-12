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
  },

  /* ---- v24.1: one parser, one unit table ---- */
  {
    name: 'the shopping parser divides by a user-supplied denominator, so "1/0" sums as ' +
          'Infinity and is then stored as null by JSON.stringify',
    find: '    if(!den) return null;             // "1/0" is not Infinity; it is not a number at all\n',
    replace: ''
  },
  {
    name: 'the shopping side keeps its own thinner parser, so a mixed fraction is not ' +
          'summable and "1 1/2 tsp" twice prints as text instead of "3 tsp"',
    find: 'function parseQty(q){ return parseAmount(q); }',
    replace: 'function parseQty(q){\n' +
             '  if(q === null || q === undefined || q === \'\') return null;\n' +
             '  if(typeof q === \'number\') return q;\n' +
             '  const s = String(q).trim();\n' +
             '  const fracMap = {\'½\':0.5,\'¼\':0.25,\'¾\':0.75,\'⅓\':1/3,\'⅔\':2/3,\'⅛\':0.125};\n' +
             '  if(fracMap[s] !== undefined) return fracMap[s];\n' +
             '  const m = s.match(/^(\\d+)\\s*[½¼¾⅓⅔⅛]$/);\n' +
             '  if(m && fracMap[s.slice(-1)] !== undefined) return parseInt(m[1],10) + fracMap[s.slice(-1)];\n' +
             '  if(/^(\\d+(\\.\\d*)?|\\.\\d+)$/.test(s)) return parseFloat(s);\n' +
             '  if(/^\\d+\\/\\d+$/.test(s)){ const [a,b] = s.split(\'/\'); return parseFloat(a)/parseFloat(b); }\n' +
             '  return null;\n' +
             '}'
  },
  {
    name: 'the 1 g = 1 mL basis is not applied at all, so a kitchen measure typed for a ' +
          'gram-shopped staple is dropped with no message',
    find: '    if(!ua.measure || !massVolume) return null;',
    replace: '    return null;'
  },
  {
    name: 'the fraction tolerance is a whole 5 mL of a cup again, so "0.35" is accepted ' +
          'as ⅓ and shopped as 88 mL under a label that says 83',
    find: 'const MEASURE_SNAP_TOLERANCE = 0.005;',
    replace: 'const MEASURE_SNAP_TOLERANCE = 0.02;'
  },
  {
    name: 'the stored amount is derived from the raw input again, so the recipe reads ' +
          '"⅓ cup" for ever while the list is built from a different number',
    find: '    quantity: measureToShoppingQty(snapped.n, measureUnit, meta && meta.shoppingUnit),',
    replace: '    quantity: measureToShoppingQty(parseMeasureQty(qtyStr), measureUnit, ' +
             'meta && meta.shoppingUnit),'
  },
  {
    name: 'the measure conversion rounds to whole millilitres again, so half a teaspoon ' +
          'is saved as 3 and an eighth as 1',
    find: '  return convertAmount(num, measureUnit, shopUnit || \'mL\');\n}',
    replace: '  const n = convertAmount(num, measureUnit, shopUnit || \'mL\');\n' +
             '  return n === null ? null : Math.round(n);\n}'
  },
  {
    name: 'the glyph table is walked with no reference to the unit, so a TBsp value is ' +
          'labelled with a fraction TBsp does not allow',
    find: '    const glyph = FRACTION_GLYPHS.find(g=> Math.abs(g[0] - f) < 1e-9);\n' +
          '    if(!glyph) continue;                     // a fraction with no glyph cannot be shown\n' +
          '    return { n: whole + f, label: (whole ? whole + \' \' : \'\') + glyph[1] };\n' +
          '  }\n' +
          '  return null;',
    replace: '    const glyph = FRACTION_GLYPHS.find(g=> Math.abs(g[0] - f) < 1e-9);\n' +
             '    if(!glyph) continue;\n' +
             '    return { n: whole + f, label: (whole ? whole + \' \' : \'\') + glyph[1] };\n' +
             '  }\n' +
             '  for(const [v,g] of FRACTION_GLYPHS){\n' +
             '    if(Math.abs(rem - v) <= MEASURE_SNAP_TOLERANCE) ' +
             'return { n: whole + v, label: (whole ? whole + \' \' : \'\') + g };\n' +
             '  }\n' +
             '  return null;'
  },
  {
    name: 'the allowed-amounts message is hand-written prose again, so it agrees with ' +
          'the rule only until somebody changes one of them',
    find: '\'. Allowed: \'+allowedMeasureText(measureUnit)+\' (e.g. 1 ½).\' };',
    replace: '\'. Allowed: \'+(measureUnit===\'cup\' ? \'whole numbers and ⅛ ¼ ⅓ ½ ⅔ ¾\' : ' +
             'measureUnit===\'tsp\' ? \'whole numbers and ⅛ ¼ ½ ¾\' : \'whole numbers and ¼ ½\')+' +
             '\' (e.g. 1 ½).\' };'
  },
  {
    name: 'the staple path converts units itself again, so the measure table is reached ' +
          'from the mL branch only and "1 Cup" is matched case-sensitively',
    find: '  return convertAmount(n, m[2], unit);',
    replace: '  const suffix = (m[2] || \'\').toLowerCase();\n' +
             '  if(unit === \'mL\'){\n' +
             '    if(suffix === \'ml\') return n;\n' +
             '    if(suffix === \'l\')  return n * 1000;\n' +
             '    if(UNITS[m[2]] && UNITS[m[2]].measure) return n * UNITS[m[2]].per;\n' +
             '  }\n' +
             '  if(unit === \'g\'){\n' +
             '    if(suffix === \'g\')  return n;\n' +
             '    if(suffix === \'kg\') return n * 1000;\n' +
             '  }\n' +
             '  return null;'
  }
];
