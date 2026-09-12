#!/usr/bin/env node
/*
 * The Fridge List — does the suite bite?
 *
 *   node test/bite.js            every case in test/bite-cases.js
 *   node test/bite.js horizon    only cases whose name matches
 *
 * Runs the logic suite against a copy of index.html with a shipped defect put BACK, once
 * per case, and reports any case the suite failed to notice.
 *
 * `npm test` going green says the code and the tests agree. It says nothing about whether
 * the thing they agree on is true — CLAUDE.md, "Green is not evidence about the world".
 * This asks the other question: if the bug came back, would anything shout? It is the only
 * check in the repo whose passing result is a FAILURE of the code under test, which is why
 * it reads back-to-front and why the output says "bit" rather than "passed".
 *
 * No dependencies, no browser. Each case gets a throwaway tree under test/.tmp/bite/
 * (gitignored, same as the browser suite's instrumented copies), so the working file is
 * never touched — this only ever reads index.html.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const TMP = path.join(__dirname, '.tmp', 'bite');
const cases = require('./bite-cases.js');

const filter = process.argv[2];
const chosen = filter
  ? cases.filter(c => c.name.toLowerCase().includes(filter.toLowerCase()))
  : cases;

if (!chosen.length) {
  console.log(filter ? 'No bite case matches "' + filter + '".' : 'No bite cases defined.');
  process.exit(1);
}

const html = fs.readFileSync(INDEX, 'utf8');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(path.join(TMP, 'test'), { recursive: true });
fs.copyFileSync(path.join(__dirname, 'run-tests.js'), path.join(TMP, 'test', 'run-tests.js'));

console.log('Putting ' + chosen.length + ' shipped defect(s) back, one at a time.\n');

const toothless = [];   // the suite did not notice
const stale = [];       // the case no longer describes any code in the file

chosen.forEach(c => {
  const hits = html.split(c.find).length - 1;
  if (hits !== 1) {
    stale.push({ name: c.name, hits });
    console.log('  ? STALE  ' + c.name);
    console.log('           its `find` matches ' + hits + ' times, not once — the code moved.');
    return;
  }

  fs.writeFileSync(path.join(TMP, 'index.html'), html.replace(c.find, c.replace));

  let out = '';
  let bit = false;
  try {
    out = execFileSync(process.execPath, ['test/run-tests.js'],
                       { cwd: TMP, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    // A non-zero exit is the suite reporting failures, which is what we are hoping for.
    out = (e.stdout || '') + (e.stderr || '');
    bit = true;
  }

  const named = out.split('\n')
    .filter(l => l.trim().startsWith('FAILED:'))
    .map(l => l.trim().replace(/^FAILED:\s*/, ''));

  if (bit) {
    console.log('  ✓ bit    ' + c.name);
    named.slice(0, 3).forEach(n => console.log('           — ' + n));
    if (named.length > 3) console.log('           — …and ' + (named.length - 3) + ' more');
  } else {
    toothless.push(c.name);
    console.log('  ✗ SILENT ' + c.name);
  }
});

console.log('\n' + '-'.repeat(48));
if (stale.length || toothless.length) {
  if (toothless.length) {
    console.log(toothless.length + ' defect(s) the suite did not notice:\n');
    toothless.forEach(n => console.log('  ✗ ' + n));
    console.log('\nA test written for one of these is agreeing with the code rather than');
    console.log('checking it. Fix the test, not this file.');
  }
  if (stale.length) {
    console.log((toothless.length ? '\n' : '') + stale.length + ' case(s) no longer match the source:\n');
    stale.forEach(c => console.log('  ? ' + c.name));
    console.log('\nRe-point the case at where the code went, then confirm it still bites.');
    console.log('If the defect is genuinely impossible now, delete the case and say so in');
    console.log('docs/DECISIONS.md.');
  }
  process.exit(1);
}
console.log('all ' + chosen.length + ' bit');
