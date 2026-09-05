# Working on The Fridge List

A family shopping-list app used on phones in a supermarket. One self-contained
`index.html`, no build step, published by GitHub Pages, data synced through OneDrive.

Most of the rules below exist because breaking them caused a real bug that a family
noticed mid-shop. They are worth reading before changing sync, rendering or storage.

This file is the rules. [`docs/DECISIONS.md`](docs/DECISIONS.md) is the reasoning: what was
chosen, what was rejected and why, what the sync rewrites cost, and how to review this
codebase given that an adversarial review passed over two real defects. Read that one
before proposing a feature or starting a review; read this one before changing code.

## Commands

```
npm test                # 309 logic assertions — no dependencies, no browser, ~1s
npm run test:browser    # 191 browser assertions — needs playwright-core + Chromium
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
- **Two data objects, plus an archive.** `recipesData` (recipes, ingredient master,
  settings) and `shoppingData` (week's picks, generated list, Wait List). Each is
  persisted to localStorage and to a JSON file in the OneDrive `FridgeList` folder.
  Since v22.0 there is a third file, `trip-history.json` — one record per finished shop,
  written once, read lazily. It is not a third live object: nothing renders from it
  directly, and it never touches the merge.
- **Sync is polling, not push.** A 20s folder poll, plus a 5s poll while the Review
  tab is open. All writes are debounced 600 ms.
- **Auth** is MSAL against a public client ID, redirect flow, scopes
  `Files.ReadWrite.All` and `User.Read`. The redirect URI is computed from
  `window.location` — never hardcode it.

## Invariants

Each of these has a bug behind it.

**"Is there work here worth keeping" and "is somebody in a shop right now" are two
different questions.** They were one — `tripProgress`, counting ticks — and that single
answer drove the freeze, the Review tab's auto-refresh, the undo stash and
`chooseTripWinner`. But a family does two things with a list: they prune it at the kitchen
table ("we have olive oil", "not chorizo this week") and they tick it off in the aisle.
Only the second counted, so a carefully pruned list looked untouched to all four, and
adding one recipe threw the lot away. `tripHasProgress` now asks `tripDecisions` — any
STAMPED removal or at-home, plus ticks — and is what earns an undo and defends a list in
the merge. `tripIsLive` still counts ticks only, because it freezes the week's recipes and
pruning must not do that: people prune and then carry on planning. Stamped only, or the
pantry default would count as a decision. Two functions on purpose; do not tidy them back
into one. *(v23.3)*

**A decision outlives its trip. A tick does not.** `checked` means "in the trolley" and
belongs to the trip being shopped — v21.8's rule that last trip's ticks must not leak in
still holds exactly. `removed` and `atHome` are statements about the week and the cupboard,
still true whichever generation of the list is on screen. `generateShoppingList` carried
both across only on a same-trip rebuild, which is why adding a recipe undid every
deselection. The carry-forward is now split: decisions cross any rebuild, ticks cross only
their own trip, and a shop marked done carries nothing. *(v23.3)*

**Adding a recipe extends the shop; taking one off replaces it.** Any change to the picks
used to mint a new trip, so "we'll do a curry too" discarded the trolley, undid the
pruning, and had two phones minting rival trip ids for what everyone thought was one list —
a Wait List addition, which is the same kind of act, was a same-trip rebuild all along.
`sameTripRebuild` now also returns true when the picks changed only by ADDING, tested
against `weekPlan.lastGeneratedRecipeSelections`; a removal or a serving change still
starts a new trip. The new field is optional and additive: a file from an older build has
none, `picksOnlyAdded` says no, and the old signature test alone decides. *(v23.3)*

**A deletion is recorded, never inferred.** v23.0 decided deletions by comparing an item's
`addedAt` against this device's horizon, and that was wrong twice: items written before
v23.0 carry no `addedAt`, so `effectiveAddedAt` fell back to the file's `lastUpdated` —
which `saveShoppingLocal` bumps on EVERY save, so a week-old pick in a freshly saved file
presented as seconds old and was permanently undeletable; and any removal within ~110s of
the addition failed the same test on every path. `noteRemoved` stamps the removal at each
deletion site, `mergeAuthored` honours a record that post-dates the item's own
`lastAuthoredAt`, and a re-add wins because it stamps a later time. `otherSideDropped`
survives only as the fallback for copies from builds that write no records. If you add a way
to delete something, it records the removal or it does not work. *(v23.2)*

**Never let the merge emit an empty tombstone map.** `applyMergedShopping` decides "did
anything change" by stringify-comparing, so a `selectionsRemoved: {}` that was not in the
input makes every identical sync look like a change — swapping the object graph and
repainting over whoever is typing, which is the v21.0/v21.5 bug. The map appears only once
something has actually been removed. Caught by the browser corpus, not by review. *(v23.2)*

**`seenRemoteAt` is per-device state and the merge must never adopt the other side's.**
`mergeShoppingData` builds its result with `Object.assign({}, secondary, primary)`, so the
horizon was silently taken from whichever file was newer — normally the remote copy, since
that is usually why a merge is running. That value is the other device's record of how far
IT had read, always behind what this device has just read, so the horizon regressed on the
commonest path in the app and this device then under-claimed what it had seen, meaning its
deletions went unhonoured elsewhere. `mergeRemoteShopping` owns the value: it works the new
horizon out, merges without touching its inputs, and stamps the result. Found by adversarial
review of v23.0, a week after v23.0 was built entirely around this field. *(v23.1)*

**Import is a deliberate replacement, and goes through `applyMergedShopping` like every
other one.** `importData` used to do `shoppingData = parsed`, the one thing the invariant
above forbids by name: no trip lineage, so the copy it replaced won the next poll and the
import undid itself; and no stash, so importing over a live trolley destroyed ticks with no
way back. It is deliberately NOT blocked while a shop is live, unlike the Start tab's
controls — import is the recovery tool of last resort and a household whose data has gone
wrong mid-shop is exactly who needs it. The confirmation names the cost instead, and the
stash makes it recoverable. *(v23.1)*

**One rule for every collection a person authors.** Union by id; each field resolved by
its own stamp; an item on only one side is KEPT unless the other side demonstrably saw it
and no longer has it. `mergeAuthored` is that rule, and `weekPlan.selections` and
`neededList` both go through it. Before v23.0 there were seven different answers — lines
unioned, picks taken wholesale from the newer file, Wait List membership from the newer
file — and two of the three silently threw away things people had added. Nobody could
predict which applied to what they had just tapped. If you add a collection, it goes
through this function or it is derived; there is no third option. *(v23.0)*

**"Demonstrably saw it" is `seenRemoteAt`, and it has to be in the file.** It records how
far into the shared folder's history this device had read when it wrote its copy, and it
is the only thing that separates "you added that while I was away" from "I deleted it
while you were away". It lived in memory until v23.0 and was lost on every reload, which
is why every release from v21.8 on had to invent another tiebreaker — `generatedAt`, then
`basedOn`, then `supersedes`, then a live-trip bias — to guess around a fact the app was
throwing away. A device with no horizon can delete nothing: it cannot prove it ever saw
what it is removing. *(v23.0)*

**Items from before v23.0 are bounded by their file's `lastUpdated`, and the bound is
frozen on arrival.** They carry no `addedAt`, and with no creation time at all they could
never be shown to have been seen. A file written at T proves everything in it existed by T
at the latest — `effectiveAddedAt` — which never invents a time earlier than the truth.
But that is an upper BOUND, not a creation time, and v23.0 then used it as one: because
`saveShoppingLocal` bumps `lastUpdated` on every save, the bound moved forward forever and
the item was permanently undeletable. `backfillAuthoredStamps` stamps the file's current
`lastUpdated` onto such an item once, so the bound stops moving. Do not reintroduce a
reader that recomputes it live. *(v23.0, corrected v23.2)*

**Shopping list lines are DERIVED, and that is why they do not go through `mergeAuthored`.**
They are regenerated from the picks, the staples and the Wait List; the authored part of a
line is its flags, which `mergeShoppingLine` already resolves per flag by its own stamp.
That is the same rule specialised, not an exception to it — and it is the one part of the
merge nobody has ever lost work to. *(v23.0)*

**`chooseTripWinner` governs `shoppingList` and nothing else.** It used to drag the week's
picks along with whichever list won, which is how a superseding clear could delete recipes
added on a phone that had not caught up. Which generation of the LIST won says nothing
about whose recipes are right. *(v23.0)*

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

**A list someone is shopping from is not replaced by one nobody has touched.**
`chooseTripWinner` decides between two different trips, and "generated later" is only
its last resort. First a trip that names the other in `weekPlan.supersedes` wins — that
is a person deliberately replacing a list they could see. Then a trip with recent ticks
beats one with none. Then the one whose `weekPlan.basedOn` is newer — generated from
fresher shared data — beats the one generated by a device that had not caught up. Both
new fields are optional: a copy from an older build has neither and is judged on
progress alone, which is the safe side. *(v21.8)*

**The week's picks are frozen while a shop is under way.** `shoppingInProgress()` — one
definition, `tripIsLive(shoppingData)` — disables every control on the Start tab that
changes `weekPlan.selections`, and the tab says why. v23.3 deliberately left this reading
TICKS, not decisions: locking the tab the moment somebody prunes would block the very
thing the family was doing when they reported the bug. v21.8 instead let the picks change
and then offered "Make a new list anyway", which confused the people it was there to
protect: asked to choose between two lists, nobody knew which was which. There is
nothing to choose now. The Wait List is the way to add something mid-shop (a same-trip
rebuild, so ticks survive), and "Shopping is done" is the way to free the picks again.
Anything switched off must also LOOK switched off — see `.btn:disabled`. *(v21.9)*

**Opening the Review tab must not rebuild a live list.** The auto-refresh on entry runs
because somebody opened a tab, and a refresh that starts a new trip discards every tick
on the current one — that is how a phone that had not caught up wiped a trolley
mid-shop. `renderReviewTab` refreshes on its own only when the rebuild stays on the same
trip (which carries ticks across) or there is no progress to lose; otherwise it leaves
the list alone and says so. `sameTripRebuild()` is shared with `generateShoppingList` so
the two can never disagree about what is about to happen. Since v21.9 froze the picks,
reaching that state at all means another device changed them — an older build, or one
that was offline — so the note explains and offers no button. *(v21.8, v21.9)*

**A device that cannot reach the folder has to say so, and the wording is the feature.**
The sync banner covered a sync that *broke* and could not cover one that was never there:
its pending case runs off `syncPendingSince`, which `persist()` sets only when the OneDrive
flag is on, so a phone that had never signed in never marked anything pending and was never
warned — while the startup line told it, in green, that it was "working from this device's
local copy". Two people planned a week nobody else ever saw. `syncAlertState` is pure so
the sentences can be asserted without a browser; if you reword them, the tests are asserting
the wording on purpose. `lastContactText` reads `shoppingSeenRemoteAt`, which advances only
on a real remote read, so "never" cannot be flattered into something softer. *(v22.2)*

**Never replace `weekPlan` with a bare object.** Emptying the week is not the same as
erasing it. `{ selections: [], generatedAt: null }` discards `tripId`, `supersedes`,
`basedOn` and `generatedAt` — the four fields `chooseTripWinner` decides on — so the
cleared week reached the merge with no claim to make and any surviving copy of the old
one won outright and put the recipes back on the next poll. It survived four releases
because a single device settles: both sides of that merge are the cleared state. A
household with two phones does not. Clearing the week is a deliberate replacement and is
expressed like every other one — `clearedWeekPlan` mints a new trip naming the one it
supersedes, the same shape `putBackReplacedList` uses. *(v22.1)*

**A deliberate clear outranks a live trip, and that is rule 1 doing its job.** Superseding
sits above "somebody is shopping from this" on purpose. v21.9's freeze closes the ordinary
case — the button is disabled as soon as this device has seen the live trip — and
`stashReplacedTrip` covers the 20-second window where it has not. Don't add a second
mechanism for that race; it is the one `generateShoppingList` already carries. *(v22.1)*

**The trip archive is append-only, and nothing edits a closed record.** `finishShopping`
writes the trip to localStorage *before* clearing `shoppingList` — that clear is where a
week of ticks used to go for good, so a failed archive must not be discovered afterwards.
The remote copy is best-effort and owed. `mergeTripHistory` is a union keyed by `tripId`
with the fuller record winning, which is total and conflict-free precisely because a trip
is written once by the device that finished it; the moment something starts amending
trips after the fact, that guarantee is gone and so is the reason this feature does not
touch `mergeShoppingData`. *(v22.0)*

**The archive does not go through `persist()`.** `which` is `'recipes' | 'shopping' |
both, and squeezing a third value into those two `!==` tests is exactly how a tick starts
re-uploading something it should not. `pushTripHistory` is its own writer. The archive is
also never read at startup — the localStorage mirror is what every feature reads, and the
remote copy is folded in on sign-in, on "Sync now", and after this device archives a shop
of its own. *(v22.0)*

**`lastCooked` means somebody said they cooked it.** It used to be stamped in
`generateShoppingList`, so "not cooked recently" really meant "not shopped for recently".
`lastPlanned` carries that meaning now; `lastCooked` is written only by the Menu tab's
cooked tick. Anything derived from cooking — the badge, the history sort, `cookRateSummary`
— must keep the two apart, and must not quietly present a plan as a meal. *(v22.0)*

**`atHomeAt` is what separates a decision from an assumption.** The `pantryAtHome` rule
sets `atHome` from a category and never stamps it; the "At home" button stamps. Anything
learning from at-home behaviour (`atHomeStreaks`) must require the stamp, or it is
learning from its own defaults. *(v22.0)*

**Destructive actions must be recoverable, not merely confirmed.** A dialog is not a
safety mechanism — v19.0 removed a bulk ingredient delete that had one. Bulk recipe
delete writes a snapshot *first* and proceeds only if that write succeeded, keeps an
in-session undo, and is documented alongside OneDrive's version history. *(v21.6)*
Replacing a trip somebody is shopping from is the same kind of act: `stashReplacedTrip`
keeps the displaced list for the session, and "Put back the list that was replaced"
restores it *as a deliberate replacement of the list that displaced it* — a new trip id
with `supersedes` set — so it wins on every phone instead of being overwritten again on
the next poll. *(v21.8)*

## The sync model

Shopping data merges per item; recipes do not. Since v23.0 there is one rule for the
collections a person authors — see the invariant above — and the notes below are the
details that rule is built on.

- **Trip id** (`weekPlan.tripId`) distinguishes "the same list edited by two people"
  from "a genuinely newer list". Same trip → union of both line sets. Different trip →
  one wins outright and last trip's ticks must not leak in — see `chooseTripWinner`,
  which no longer decides that on `generatedAt` alone.
- **Trips carry their lineage.** `weekPlan.supersedes` is the trip a new one was built
  on top of, and `weekPlan.basedOn` is how caught-up the generating device was. Together
  they separate "I replaced this deliberately" from "I had never seen it". Both are set
  in `generateShoppingList` only when a NEW trip is minted. *(v21.8)*
- **`shoppingSeenRemoteAt`** advances only when a remote copy is actually read, which is
  why every merge site goes through `mergeRemoteShopping`. `shoppingData.lastUpdated`
  cannot be used for this: local saves move it forward without the device having learnt
  anything.
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
  the write is refused and reported rather than clobbering. **This is the one collection
  the single rule does not cover** — recipes are large documents rather than small stamped
  items, and folding them in would double the diff in the most delicate function in the
  app. The boundary is deliberate; do not assume the model is uniform.
- **A merge that changes anything says so.** `describeMerge` and `mergeReport` are pure and
  produce the line a phone shows when it catches up. The point of one rule is that the
  outcome is predictable; the point of the sentence is that nobody has to take that on
  trust.
- **Trips are write-once**, so `trip-history.json` needs no conflict rule at all — see the
  invariant above. It is capped at `TRIP_HISTORY_MAX` (52) and pruned on every merge.

## Testing

Tests **extract the real functions out of `index.html`** by brace-matching and run them
in a VM sandbox, rather than keeping a second copy that would drift. A rename fails
loudly. Shared constants are pulled from the source the same way.

**Verify a new test fails against the old code.** A test written for this session
passed against the very bug it was meant to catch, because a button was matched by the
wrong label and nothing was ever clicked. Checking out the previous version and running
the suite takes a minute and is the only thing that proves a test bites.

**Green is not evidence about the world.** Both v23.2 defects sat under assertions that
passed — `effectiveAddedAt` and the merge grace window were among the best covered things
in the suite, and an adversarial review cited that coverage as a strength. The tests were
written by the same reasoning that wrote the code, so they asserted the same false premise
back at it. Coverage measures agreement between test and code. When a test and the code it
covers were written together, ask separately whether the thing they agree on is true —
`docs/DECISIONS.md`, "How to review this codebase", says how.

Browser suites needing internals serve a temporary instrumented copy from `test/.tmp/`.
Production code carries no test hooks.

**Never wait a fixed time after `goto()` — use `waitForApp(page)`.** Startup begins at
DOMContentLoaded, which waits on the MSAL script from a CDN that sandboxes block, so how
long that request takes to *fail* decides how long startup takes. Worse, on a fresh
context the service worker takes control just after the first paint and
`controllerchange` reloads the page once: a click landing in that gap talks to a
document about to be discarded. Three suites flaked on `waitForTimeout(1800)` in one
session before this was traced. `waitForApp` waits for the worker to be in control, then
for the app to have painted.

## Releasing

1. Bump `APP_VERSION` — it shows in Settings and is how two phones get compared.
2. Both suites green.
3. Open a PR naming the rollback commit.
4. Merge to `main`; GitHub Pages publishes it.
5. If the release settled a question — chose between approaches, rejected a feature,
   reversed an earlier decision — add it to `docs/DECISIONS.md`. An invariant here says
   what must hold; that file says why, which is what stops the same idea being rebuilt.
   Two features were built and removed inside one week for want of this.

**Check for stranded commits before merging.** `git log origin/main..HEAD`. During one
session three separate commits were pushed after their PR had already been merged and
sat unmerged on the branch. A merged PR cannot pick up new commits — open a new one.

**Watch for control characters.** A NUL byte once reached `main` inside a string
literal. It was inert at runtime but made `index.html` read as binary to grep and git.
If tooling starts calling a text file binary, look for stray control characters rather
than working around it.

## Known limitations, deliberately left

- **A mixed fleet is the transition cost of v23.0, and it is bounded.** A phone on v23.1
  or earlier writes no removal records, so its deletions fall back to `otherSideDropped` —
  the v23.0 inference, with everything v23.2 says is wrong with it. A phone on v22.2 or
  earlier additionally writes picks with no `addedAt` and a file with no `seenRemoteAt`;
  `backfillAuthoredStamps` freezes the first the moment such a file is read here, and a
  device with no horizon simply cannot delete anything. So the failure mode is that an old
  phone's deletions may not propagate until it updates. Its additions always arrive. It
  keeps rather than loses, which is the side to err on. This replaces the two entries that
  used to sit here, which recorded that the picks and the Wait List were last-writer-wins;
  they no longer are.

- **A mixed fleet pollutes `lastCooked` for as long as it lasts.** A phone still on v21.9
  goes on stamping `lastCooked` when it generates a list, so on a household running both
  builds some recipes will claim to have been cooked when they were only planned. It
  self-corrects as devices update, and the failure mode is the one the app had all along.
  Not worth defending against: the fix costs a field on the synced file, which is exactly
  the kind of shape change the invariants above exist to prevent.

- **A shop finished on an older build is not archived at all.** v21.9 knows nothing about
  `trip-history.json`, so that week is a gap in the history rather than a corruption of
  it. Everything reading the archive is written to be honest about thin data — the route
  needs three sightings of an aisle, the cook rate says "at least".

- **The recipe load-and-swap logic is duplicated, and the poll's guard is checked early.**
  `loadFromFolderOrSeed` and `loadFromOneDriveOrSeed` each implement "stringify-compare,
  swap `recipesData`, save, conditionally repaint" independently — the same shape of
  duplication that gave the shopping side two divergent copies and two bugs before
  `applyMergedShopping` became its one chokepoint. Related: `pollOneDriveForChanges` checks
  `document.hidden` and the modal/typing guards at entry, then awaits several round-trips
  before assigning, so the window is wider than the guard implies. Both raised by
  adversarial review of v23.0 and deliberately left for the change that gives recipes a
  proper merge, rather than being half-done alongside a sync fix. Recipes are the one
  collection the single rule does not cover, so this is the same boundary.

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

- **The archive is written but barely read.** Four features come off it so far. The
  obvious next ones, in rough order of value per line: a spend figure typed in at the
  checkout (one number, no per-item prices, and the trend is the whole point — needs a
  currency decision first); "you buy this every week, make it a staple"; and the
  never-bought and never-cooked lists that would make a clear-out an informed one.

- **`qty` in the recipe editor.** The shopping list no longer prints "1 qty Banana",
  but the editor still shows `qty` as a unit for the 120 ingredients that use it to
  mean "each".

- **Wait List additions are not visibly confirmed.** Making an unsent addition obvious
  on the Wait List tab would address the limitation above without touching the merge.
