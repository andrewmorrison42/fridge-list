# Working on The Fridge List

A family shopping-list app used on phones in a supermarket. One self-contained
`index.html`, no build step, published by GitHub Pages, data synced through OneDrive.

Most of the rules below exist because breaking them caused a real bug that a family
noticed mid-shop. They are worth reading before changing sync, rendering or storage.

## Commands

```
npm test                # 118 logic assertions — no dependencies, no browser, ~1s
npm run test:browser    # 91 browser assertions — needs playwright-core + Chromium
npm run test:all
```

Both suites must pass before pushing. The logic suite is cheap enough to run
constantly; run the browser suite before any commit that touches rendering, sync or
the service worker.

## Working in a 1.3 MB file

`index.html` holds the whole application *and* the bundled recipe seed. About 80% of
the file is a single `<script type="application/json">` block roughly a million
characters long, on one line.

Consequences:

- Plain `grep` over patterns that also occur in recipe data floods the terminal.
  Search the code with `awk 'length($0)<600 {print NR": "$0}' index.html | grep '…'`.
- `git diff` on this file is awkward. Keep edits surgical; never reformat.
- Reading the whole file into context is wasteful. Locate first, then read the region.

## Architecture in brief

- **No framework.** `el(tag, attrs, children)` builds DOM; `render()` rebuilds the
  current tab from scratch.
- **Two data objects.** `recipesData` (recipes, ingredient master, settings) and
  `shoppingData` (week's picks, generated list, Wait List). Each is persisted to
  localStorage and to a JSON file in the OneDrive `FridgeList` folder.
- **Sync is polling, not push.** A 20s folder poll, plus a 5s poll while the Review
  tab is open. All writes are debounced 600 ms.
- **Auth** is MSAL against a public client ID, redirect flow, scopes
  `Files.ReadWrite.All` and `User.Read`. The redirect URI is computed from
  `window.location` — never hardcode it.

## Invariants

Each of these has a bug behind it.

**Never call `render()` from a background path.** Use `repaintWhenSafe()`, which
refuses while a field is focused, a modal is open, or a print is being captured, and
remembers the repaint for when the moment passes. An unguarded render tears down the
tab and destroys whatever the user is typing. *(v21.5)*

**Never assign `shoppingData` outside `applyMergedShopping()`.** Every rendered row
closes over its line object; swapping the object graph without repainting leaves the
whole screen wired to orphans, so ticks appear to register and are then silently
dropped. `applyMergedShopping` also compares before applying, so an identical copy is
not swapped in at all. *(v21.0, v21.5)*

**Row handlers resolve their line at tap time** via `lineMergeKey` and
`findShoppingLine`, never by closing over the object they were drawn from. Same cause
as above, different symptom. *(v21.0)*

**`mergeShoppingData` must stay pure.** It builds a new object and mutates neither
input. Callers depend on comparing before and after to decide whether anything
changed. *(v21.0)*

**Always pass `which` to `persist()`** — `'recipes'`, `'shopping'`, or omitted for
both. It is threaded through to the writers so a tick does not re-upload the 992 KB
recipe file over supermarket mobile data. *(v21.2)*

**Never change the shape of synced JSON.** Family devices run different builds at the
same time, and the service worker means a phone can sit on an old one for a while. Add
alongside; do not restructure. Staple quantities live in a separate `settings.stapleQty`
map for exactly this reason — turning entries of the `staples` array into objects would
have broken every device still on the previous build. *(v21.3)*

**Sharing exports the chosen recipes and nothing else.** `buildShareBundle` takes
recipe ids and emits only those recipes plus the ingredient-master entries they
reference — never the shopping list, the Wait List, settings, staples or cooking
history. A share is a copy that stays unconnected to the sender's data; keep it that
way when extending it. *(v21.7)*

**Destructive actions must be recoverable, not merely confirmed.** A dialog is not a
safety mechanism — v19.0 removed a bulk ingredient delete that had one. Bulk recipe
delete writes a snapshot *first* and proceeds only if that write succeeded, keeps an
in-session undo, and is documented alongside OneDrive's version history. *(v21.6)*

## The sync model

Shopping data merges per item; recipes do not.

- **Trip id** (`weekPlan.tripId`) distinguishes "the same list edited by two people"
  from "a genuinely newer list". Same trip → union of both line sets. Different trip →
  the newer trip wins outright, and last trip's ticks must not leak in.
- **Per-flag timestamps.** `checked`, `removed` and `atHome` each carry their own
  stamp. They used to share one `changedAt`, so marking something "at home" wiped the
  other shopper's tick.
- **Tick bias.** Within `TICK_TIE_WINDOW_MS` (10s) a tick beats an untick, because two
  phones are never perfectly in sync and losing a tick is worse than briefly keeping
  one. Deliberate unticks outside the window still work.
- **Regeneration reconciles, it does not rebuild.** `generateShoppingList` carries
  per-line progress and stamps across a same-trip rebuild.
- **`selectionsSignature` must never depend on anything shopping mutates.** It once
  keyed off the Wait List `done` flags, which ticking sets — so shopping invalidated
  the list it was shopping from and wiped every tick.
- **Recipes are last-save-wins** with an `If-Match` ETag guard: on a genuine conflict
  the write is refused and reported rather than clobbering.

## Testing

Tests **extract the real functions out of `index.html`** by brace-matching and run them
in a VM sandbox, rather than keeping a second copy that would drift. A rename fails
loudly. Shared constants are pulled from the source the same way.

**Verify a new test fails against the old code.** A test written for this session
passed against the very bug it was meant to catch, because a button was matched by the
wrong label and nothing was ever clicked. Checking out the previous version and running
the suite takes a minute and is the only thing that proves a test bites.

Browser suites needing internals serve a temporary instrumented copy from `test/.tmp/`.
Production code carries no test hooks.

## Releasing

1. Bump `APP_VERSION` — it shows in Settings and is how two phones get compared.
2. Both suites green.
3. Open a PR naming the rollback commit.
4. Merge to `main`; GitHub Pages publishes it.

**Check for stranded commits before merging.** `git log origin/main..HEAD`. During one
session three separate commits were pushed after their PR had already been merged and
sat unmerged on the branch. A merged PR cannot pick up new commits — open a new one.

**Watch for control characters.** A NUL byte once reached `main` inside a string
literal. It was inert at runtime but made `index.html` read as binary to grep and git.
If tooling starts calling a text file binary, look for stray control characters rather
than working around it.

## Known limitations, deliberately left

- **Wait List membership is last-writer-wins.** An addition that has not yet reached
  OneDrive can be lost if someone else's addition lands first — the merge takes the
  newer file's list wholesale and drops entries only present in the older one.

  Considered and **declined**: tombstones. They change the file shape (breaking older
  devices), need a purge window that resurrects entries when a device is offline longer
  than it, and add code to the most delicate function in the app. If it ever becomes a
  nuisance, the cheap fix is to union the lists and use each entry's existing `addedAt`
  against the other file's `lastUpdated` to tell "not seen yet" from "deliberately
  deleted" — no new fields, no growth, no version hazard.

  Judged low value: the Wait List is filled in during the week, usually one person at a
  time, and the cost of the bug is a forgotten bottle of shampoo.

- **Recipes have no per-item merge.** Concurrent edits to different recipes on two
  devices can lose one side. The ETag guard prevents silent clobbering but does not
  merge.

- **Every open downloads the full recipe file**, changed or not. Gating it on an ETag
  would cut a megabyte off each launch, but it trades away a self-healing property:
  today any local corruption is repaired by the next open. If done, it needs a sanity
  check on the local copy and a periodic forced refresh.

## Open work worth considering

- **Ship a small starter seed.** The bundled 635 recipes are one family's collection.
  A dozen generic recipes instead would make forking sensible and drop `index.html`
  from 1.3 MB to roughly 200 KB — the largest single win available on load time, and it
  narrows the sync window that caused the typing bug. The full collection would live in
  OneDrive like anyone else's data.

- **`qty` in the recipe editor.** The shopping list no longer prints "1 qty Banana",
  but the editor still shows `qty` as a unit for the 120 ingredients that use it to
  mean "each".

- **Wait List additions are not visibly confirmed.** Making an unsent addition obvious
  on the Wait List tab would address the limitation above without touching the merge.
