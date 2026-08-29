# Adversarial Code Review — The Fridge List

**Scope:** `index.html` (single-file app, ~5,650 lines of code plus a bundled
recipe-data blob) and the two test suites under `test/`. **Method:** rather
than taking the invariants documented in `CLAUDE.md` on faith, each one was
traced back to the actual code that is supposed to enforce it, looking for a
counterexample — a call site that bypasses the rule, a comparison that runs
backwards, a comment that has drifted from what the code now does. Findings
below were spot-checked against `index.html` directly (line numbers cited)
before being written up; two are confirmed by direct code reading, the rest
are traced but not exercised against a running app.

## Summary

Most of what `CLAUDE.md` claims holds up well under adversarial reading:
`mergeAuthored`, the single call site for `chooseTripWinner`, the
derived-vs-authored split for shopping lines, tap-time row resolution,
`mergeShoppingData` purity, the `staples`-stays-an-array shape rule, the
`lastCooked`/`atHomeAt` stamp-only-here rules, and the 10s tick-bias window
all check out exactly as documented, and are backed by real test assertions,
not just narrative. Two real defects were found, both in the same family:
quiet exceptions to the "shopping data only moves through the merge
machinery" rule that the project has clearly cared about and tested
carefully everywhere else. That's exactly why they're worth fixing — the
code is otherwise disciplined enough that these stand out as genuine gaps
rather than a symptom of a sloppier area.

## Correctness findings

### 1. `seenRemoteAt` can regress on the ordinary sync path

**`mergeShoppingData`, `index.html:1690-1693`, called from `mergeRemoteShopping`, `index.html:1829-1834`.**

`mergeRemoteShopping` first stamps the live object with the correct, freshly
computed horizon:

```js
shoppingSeenRemoteAt = remote.lastUpdated;
if(shoppingData) shoppingData.seenRemoteAt = shoppingSeenRemoteAt;   // line 1832
```

It then merges that object with `remote` via `mergeShoppingData`, which
picks a `primary` purely by `lastUpdated` and builds the result as
`Object.assign({}, secondary, primary)` (line 1693). Whenever the remote
copy is the newer file — the ordinary case, since that's usually *why* a
merge is happening — `remote` is `primary`, so the merged object's
`seenRemoteAt` is taken from **`remote.seenRemoteAt`**: the *other device's*
own recorded horizon from when it last wrote its file, not the value this
device just computed one line earlier. A device's own `seenRemoteAt` is
always behind its own `lastUpdated` (it reads, then later writes), so this
silently regresses the horizon this device just advanced.

That corrupted object becomes the new `shoppingData` (`applyMergedShopping`)
and typically gets written straight back to OneDrive on the next save,
because `writeShoppingMerged` (`index.html:1914-1954`) re-runs
`mergeRemoteShopping` immediately before every PUT.

**Concrete failure scenario:** Device A reads the shared file at time T2 and
correctly deletes a Wait List item it has genuinely seen. Its own uploaded
file, per the bug above, claims a horizon of only T0 (a stale value
inherited from the remote copy it just merged). Device B later merges A's
file, computes `theirHorizon = T0`, sees the deleted item's `addedAt > T0`,
and — per the "demonstrably saw it" rule — does **not** honor the deletion.
The item reappears on B. The failure direction is the app's documented safe
side (nothing is lost, propagation is just delayed), but it undercuts the
exact mechanism `seenRemoteAt` exists for, on what is the single most common
code path through the merge.

**Not covered by tests:** the existing `seenRemoteAt`/`mergeAuthored` tests
(`test/run-tests.js`, ~lines 1134-1199) feed `seenRemoteAt` in as merge
*input* and check deletion outcomes; nothing asserts what the merged
object's own top-level `seenRemoteAt` is after a round-trip through
`mergeRemoteShopping`.

**Recommendation:** `seenRemoteAt` is not a "whoever's file is newer wins"
field — it's inherently local, per-device state. `mergeShoppingData` should
source `out.seenRemoteAt` from `a` (the local side) unconditionally, not
from whichever side is `primary`. Add a test that merges in a remote copy
whose own `seenRemoteAt` is older than the just-computed local horizon, and
assert the merged result keeps the fresher local value.

### 2. `importData()` reassigns `shoppingData` outside `applyMergedShopping()`

**`index.html:2323-2347`, specifically line 2332: `shoppingData = parsed; saveShoppingLocal();`**

This is the only place in the codebase, besides `applyMergedShopping` itself
and the initial load, that reassigns `shoppingData` — a direct instance of
the pattern the project's own invariant list calls out by name ("Never
assign `shoppingData` outside `applyMergedShopping()`"). Concretely, an
import:

- sets no trip lineage (`supersedes`/`basedOn`), so the imported trip has no
  claim if `chooseTripWinner` has to arbitrate against it later;
- is not gated by `shoppingInProgress()`, unlike every other control that
  touches `weekPlan.selections` since v21.9's freeze;
- never calls `stashReplacedTrip`, so if a shop is mid-trip on this device,
  importing silently discards ticked progress with **no undo path** — a miss
  of the "destructive actions must be recoverable, not merely confirmed"
  rule that bulk-delete and trip-replacement both honor elsewhere.

Because `persist()` is called at the end and the eventual OneDrive write
still runs through `writeShoppingMerged`'s merge-before-PUT logic, this
doesn't corrupt the *shared* file outright — but it can silently blow away
this device's own live trip and any not-yet-synced ticks the moment someone
uses Settings → Import. There is no test coverage for `importData` in
either suite.

**Recommendation:** route the shopping half of `importData()` through the
same discipline as `clearedWeekPlan`/`putBackReplacedList` — a deliberate
replacement with proper lineage, gated the same way a live trip gates every
other control, ideally with the same stash-and-offer-to-restore safety net
bulk delete has.

### 3. Stale comment misattributes what's being persisted (minor)

**`index.html:3017`: `persist('recipes'); // saves the lastCooked stamps set above`**

Nothing above this line sets `lastCooked` — the code a few lines earlier
sets `recipe.lastPlanned`, which is exactly the field v22.0 introduced
*specifically to stop* list-generation from being conflated with cooking.
No functional effect, but the comment reintroduces in prose the exact
confusion the invariant exists to prevent, immediately next to the code it
protects. Worth a one-line fix (`lastPlanned`, not `lastCooked`).

### 4. Theoretical TOCTOU window in the recipe poll swap (low severity)

**`pollOneDriveForChanges`, `index.html:1377-1408` → `loadFromOneDriveOrSeed`, `index.html:1193-1236`.**

The poll checks `document.hidden` / modal-open / focused-input once at
entry, then awaits several network round-trips before unconditionally
assigning `recipesData = incoming` if the content differs. The guard isn't
re-checked immediately before the assignment, so a user could open the
recipe editor during that window. In practice this is low-risk: the editor
looks recipes up by id rather than closing over the old object, and this is
already a documented limitation ("Recipes have no per-item merge") — this
just means the window is slightly wider than the guard implies. Not
confirmed against a running app; flagged for awareness rather than as an
active bug.

## Simplicity / maintainability findings

1. **Recipe load-and-swap logic is duplicated where shopping data has a
   single chokepoint.** `loadFromFolderOrSeed` (`index.html:930-943`) and
   `loadFromOneDriveOrSeed` (`index.html:1193-1236`) each independently
   implement "stringify-compare, swap `recipesData`, save, conditionally
   repaint." Shopping data got exactly one shared, tested chokepoint
   (`applyMergedShopping`) because two divergent copies of this logic caused
   a past bug (v21.0/v21.5); recipes have the same shape of duplication
   today at lower observed risk (last-save-wins, no per-row closures over
   recipe objects). Worth factoring into one `applyRecipesIfChanged(text)`
   helper before it drifts the way the shopping-side one did.

2. **`safeToReload()` (`index.html:5613-5620`) duplicates
   `safeToRepaint()`'s (`index.html:1760-1767`) checks** — both
   independently re-implement "is a modal open / is something being typed
   into / is a print in progress," with `safeToReload` adding two more
   conditions inline. A shared base predicate, extended for the
   reload-specific cases, would remove the risk of the two silently
   diverging — the same class of risk the render-safety invariants exist to
   guard against elsewhere.

3. **Two same-shaped but different "line identity" fields.** Shopping lines
   carry both an index-based `key` (`index.html:2953`, `'line-'+idx`, render
   bookkeeping only) and a content-based `lineMergeKey(line)`
   (`index.html:1420`, used for merge and tap-time row lookup). Nothing
   currently conflates them, but the near-identical names make it easy for a
   future change to grab the wrong one; a short comment at the `key`
   assignment noting it is *not* the merge key would close the gap cheaply.

4. **`mergeRemoteShopping`'s in-place mutation of `shoppingData.seenRemoteAt`
   right before calling the otherwise-pure `mergeShoppingData`** is a quiet
   special case bolted onto an intentionally pure pipeline. It's also the
   direct cause of Finding 1 above. Fixing `mergeShoppingData` to always
   trust `a.seenRemoteAt` (as recommended above) removes the need for this
   mutation entirely, closing the documentation gap and the bug in the same
   change.

## Test coverage relative to the documented invariants

**Solidly covered** by real assertions (not just prose) in
`test/run-tests.js` / `test/browser-tests.js`: `mergeAuthored`,
`effectiveAddedAt`, the merge-grace window, order-independence of the merge;
all four tiers of `chooseTripWinner` plus the `tripIsLive` boundary;
`clearedWeekPlan`'s full-object shape against several competing-copy
shapes; `mergeTripHistory`'s fuller-record-wins/idempotence; the Wait-List
independence of `selectionsSignature`; `persist(which)` write-splitting;
`applyMergedShopping`'s compare-before-apply; Start-tab controls disabling
during a live trip; and the sync-banner wording (`syncAlertState`,
`lastContactText`).

**Gaps worth closing**, in priority order:
- Nothing asserts what a merged shopping object's own `seenRemoteAt` is
  after `mergeRemoteShopping` — the highest-value gap, given how central
  that field is to the whole v23.0 model (Finding 1).
- `importData()` has zero references in either test file (Finding 2).
- `renderReviewTab`'s actual rendered notice-card path when a refresh is
  held back doesn't have an obvious browser-suite assertion beyond the
  underlying `sameTripRebuild`/`shoppingInProgress` unit tests — worth
  confirming against the full browser suite.
- No test simulates a genuine two-writers `If-Match` conflict on the recipe
  save path and asserts the local edit is preserved and reported rather than
  silently lost.

## Top recommendations, in priority order

1. Fix `mergeShoppingData` to always take `seenRemoteAt` from the local
   side, not from whichever side is `primary` — this is the one finding
   here that quietly undermines the sync model's core mechanism on its most
   common path. Add the missing round-trip test alongside it.
2. Bring `importData()`'s shopping-data path under the same discipline as
   every other deliberate replacement of `shoppingData` — lineage, freeze
   gating, and a stash-and-restore safety net — and add a test for it.
3. Fix the stale `lastCooked` comment at `index.html:3017`.
4. Factor the duplicated recipe load-and-swap logic into one helper, mirroring
   what `applyMergedShopping` already does for shopping data.
5. Unify `safeToReload()` and `safeToRepaint()` on a shared base predicate.
