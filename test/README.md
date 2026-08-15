# Tests

Two suites, split by what they need to run.

## `npm test` — logic tests

```
node test/run-tests.js
```

No dependencies, no browser, no build step. Node 14+ and nothing else. Run this one
freely; it takes well under a second.

Covers the pure sync logic: the shopping merge, per-flag conflict resolution, clock-skew
handling, trip identity, the staleness signature, purity and convergence, and data
written by older builds.

It does not keep its own copy of that logic. It **extracts the real functions out of
`index.html`** by brace-matching and runs them in a VM sandbox, so a rename or deletion
fails loudly instead of quietly testing a stale duplicate. It also asserts that
`TICK_TIE_WINDOW_MS` in the tests still matches the constant in the app.

## `npm run test:browser` — browser tests

```
npm install
npx playwright install chromium     # once, downloads a browser
npm run test:browser
```

Needs `playwright-core` and a Chromium build. Takes about half a minute.

Covers what the logic tests deliberately cannot — anything needing a real DOM, a real
service worker, or real print media:

- **Ticks survive a mid-trip rebuild.** Adding a Wait List item regenerates the list;
  before v21.0 that wiped every tick on the trip.
- **A tick still registers after a sync replaces the state.** The two-shopper bug: the
  merge returns a fresh object, and swapping it in without repainting left every row
  wired to a discarded line, so taps went nowhere. Invisible to unit tests — the merge
  logic was correct the whole time; the DOM was wrong.
- **Only the changed file is queued for upload.** Every tick used to re-upload the
  ~1 MB recipe database.
- **Printing survives a late capture.** Safari returns from `window.print()` before it
  captures the page, which is what made it print a blank sheet.
- **The app opens with no network**, still gets fresh builds when online, and remembers
  which tab you were on.

If Chromium lives somewhere unusual:

```
FRIDGE_TEST_CHROMIUM=/path/to/chrome npm run test:browser
```

Both suites exit non-zero on failure. `npm run test:all` runs them in order.

### A note on the test hooks

Two browser suites need to reach inside the app's IIFE, which exposes nothing on
`window` by design. Rather than add test hooks to the shipped file, they write a
temporary instrumented copy to `test/.tmp/` and serve that instead. The published
`index.html` carries no test surface at all, and `test/.tmp/` is cleaned up on exit.
