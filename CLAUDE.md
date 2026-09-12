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
npm test                # 490 logic assertions — no dependencies, no browser, ~1s
npm run test:bite       # puts 10 shipped defects back; the suite must notice every one
npm run test:browser    # 210 browser assertions — needs playwright-core + Chromium
npm run test:all
```

All three must pass before pushing. The logic suite is cheap enough to run constantly;
run the browser suite before any commit that touches rendering, sync or the service
worker. `test:bite` runs the logic suite ten times over, so it takes about ten seconds —
run it before pushing, and whenever you have just written a test.

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

**A Wait List `done` set in the aisle is a TICK, and carries `doneTripId`.** `done` was one
flag doing two jobs with different lifetimes: `syncNeededFromLine` writes it when somebody
ticks a line in a shop ("it is in the trolley on this trip"), and the Wait List tab writes
it when somebody decides they do not need the thing ("a statement about the week"). Nothing
recorded which was which — and because `neededList` is authored data it merges
trip-independently while `shoppingList` does not, the two came apart the moment two phones
held different `tripId`s: one phone's aisle ticks were discarded wholesale with its list,
while those same ticks crossed the Wait List entries off everywhere. The family sees the
Wait List items struck through and the recipe ingredients untouched, which is exactly the
bug as reported. `finishShopping` then deleted every `done` entry, so the shop ended by
binning Wait List items nobody had bought. `doneCountsHere` is now the single reading of
"is this done, here, now" — every display, the regeneration filter and the finish sweep go
through it — and the aisle route stamps `doneTripId` while the Wait List tab deliberately
does not. Absent means a decision, which is also what every build before v23.5 wrote.
Do not read `n.done` directly. *(v23.5)*

**A merge that swaps the trip is not "catching up".** `describeMerge` reports
`tripReplaced` and `ticksLost`, and `mergeReport` gives that its own sentence pointing at
"Put back the list that was replaced". Two lists generated from the same picks look
identical and are two different trips; `chooseTripWinner` then discards one of them
wholesale on every poll, and until v23.5 nothing on screen ever said so. The undo has
existed since v21.8 — what was missing was any reason to reach for it. v23.6 adds the
surface a status line could not be: `syncAlertState` returns a `conflict` kind, above
every case but a failed write and on every tab, whose action goes to the Review tab rather
than the sync modal. A line that scrolls away is not the same as being told. *(v23.5,
v23.6)*

**An ingredient's shopping unit must be settable, and `SHOPPING_UNIT_OPTIONS` is the whole
vocabulary.** Until v23.4 nothing in the app could set `shoppingUnit`: every creation site
wrote `''` and the master-list row offered name, category, aisle and delete — while the
recipe editor's unit box told people to "change it via Settings › Ingredients", where the
control did not exist, and the delete dialog claimed to be clearing a unit nobody could
have set. The picker offers `''`, `g`, `mL`, `qty` and nothing else: a kitchen measure
(cup/TBsp/tsp) must NEVER become a shopping unit — it hard-locks the recipe editor's unit
box to that measure forever after, which is why `saveRecipeFromForm` converts such lines to
mL. A unit already on an ingredient that is not in the list came off a recipe line; the row
keeps it as an "(off-list)" option rather than rewriting it the next time somebody edits
the aisle. *(v23.4)*

**The locked unit box shows a LABEL and stores the truth in `dataset.unit`.**
`collectRecipeIngredients` reads that box back as the recipe line's unit, so displaying
"each" for a `qty` ingredient without the dataset writes `"each"` into every recipe that
uses one. `unitLabel` is the single rule for what a unit is called — blank and `qty` both
read as "each" — and `stapleUnitLabel` calls it rather than keeping a second copy. If you
touch either, the test to keep green is the one asserting what is SAVED, not what is
rendered. *(v23.4)*

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

**A decision outlives its trip. A tick does not.** This is the rule `doneTripId` exists to
extend to the Wait List — see the v23.5 invariant above, which is what happens when a tick
is stored on an authored collection. `checked` means "in the trolley" and
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

**Two things build a shopping list: a tap, and a Wait List addition.**
`generateShoppingList()` has exactly two callers and a source test asserts the count and
the guards. The Review tab used to rebuild on entry; that was fenced in v21.8 for a live
trip and again in v23.5 for a device that had not read the folder, and both fences were
patches on the same mistake — opening a tab is not asking for a list, and a list minted
because somebody opened a tab is how two phones ended up holding a trip each for what
everyone thought was one shop. v23.6 removed it; v23.7 put back the single case that is
safe by CONSTRUCTION rather than by a fence. All four conditions must hold:
`shoppingListIsStale()`, `sameTripRebuild()` (so the trip and every tick survive, and a
finished shop is not quietly restarted), an unchanged recipe signature, and
`pendingWaitListLines()` non-empty. Together they mean this rebuild cannot mint a trip and
cannot drop a tick — where the old auto-refresh could do anything the button could. Do not
widen it: a staple amount is edited by the person who then walks to this tab. The tab
otherwise says which state the list is in and what the button would cost, and says what
arrived when the exception fires — something appearing under a shopper's thumb unexplained
is the v21.5 failure in a different coat. *(v21.8, v21.9, v23.6, v23.7)*

**A Wait List entry is "on the list" when a LINE CARRIES ITS ID, not when its name is
there.** `pendingWaitListLines` checks `neededIds`. A Wait List "milk" added while a recipe
already needs Milk folds onto that existing line, and until the line carries the entry's id
`syncNeededFromLine` has nothing to look the entry up by — so ticking it off in the aisle
crosses nothing off. A name check calls that case satisfied and leaves the two permanently
out of step. *(v23.7)*

**`syncClock` owns "how current is this device", and call sites report what happened
rather than which field to move.** Six loose module variables used to hold this, any call
site could move any of them, and between v21.8 and v23.9 that produced the same bug five
times — the merge adopting the other side's horizon; guard returns counted as failed reads;
a write leaving the device permanently behind itself; a 404 read as "cannot reach"; and
`basedOn` falling back to a local save clock. v23.9 fixed all five where they stood, which
is why they kept arriving somewhere new. Four events: `answered(status, mtime)` — the call site hands over the status and the clock
maps it, so nobody decides locally what a 404 means; `merged(mtime, remoteCopy)`, which
takes the COPY so a function holding only metadata cannot claim one; `wrote(mtime)`, kept
separate because a write teaches this device nothing about anybody else; and
`unreachable()`. Both holders move `held` and `latest` together and **neither goes
backwards** — the two merge paths are not mutually excluded (`syncInFlight` guards the
pollers, but `writeShoppingMerged` merges from the autosave timer and checks nothing), so an
out-of-order merge would otherwise leave a device reporting itself behind a copy it holds.
`horizon()` is the only reader, and no local save clock is in scope to fall back to. Every folder request reports
exactly one event on every exit path; a source test counts the call sites, so a new one
fails the suite rather than silently under-reporting. `listFreshness` and `syncAlertState`
both read one `snapshot()` instead of each assembling the same list by hand.

Two rules that used to stand on their own are now things the clock enforces. The guard
returns (hidden tab, wrong tab, no account, a poll in flight) are not attempts and never
reach it — they return above every event, which is why `unreachable` needs
`FRESHNESS_MIN_FAILURES` consecutive failures AND `FRESHNESS_UNREACHABLE_MS` since the last
success, rather than the elapsed-time-alone test that flashed red at a phone in a pocket.
And `seenRemoteAt` is per-device: `mergeShoppingData` builds its result with
`Object.assign({}, secondary, primary)`, which silently took the horizon from whichever
file was newer — normally the remote copy — so this device under-claimed what it had seen
and its deletions went unhonoured elsewhere. The merge never touches it now;
`mergeRemoteShopping` reads it back with `horizon()` afterwards.
The reasoning is in `docs/DECISIONS.md`. *(v23.1, v23.7, v23.8, v23.9, restructured v24.0)*

**Silence is the in-step state, and red means the two sync cases and nothing else.**
`listFreshness` returns null when there is nothing wrong and `renderListFreshness` appends
nothing — v23.7 kept a permanent line above the trolley saying "in step", which earns
nothing on a screen people stare at for 45 minutes and dilutes the cases that matter. It
also had a `local` line for a phone that shares with nobody; that phone is not out of step
with anybody and `syncAlertState`'s `unlinked` already says it on every tab, so two places
were saying one thing. `behind` and `unreachable` render as `.alert-card` (red — something
is wrong with what you are looking at); `frozen` and `picks` stay `.notice-card` (amber —
there is an update available). Keep red rare or it stops meaning anything. *(v23.8)*

**The card that offers a choice between two lists renders before anything that can return
early.** An import lands on an empty list, which is the branch that returns — and the
import is the single path where the undo most needs to be on screen. *(v23.6)*

**`replacement` is one record: the displaced list, and the two facts about how it got
there.** `stashReplacedTrip` used to run only when THIS device's trip was replaced, so the
winning phone had nothing to offer and nothing to say; v23.6 added a second variable beside
the stash saying who had won, and the only thing keeping the two in step was a comment. They
came apart twice: a fork whose loser had no work left a settled argument on screen, and
"Keep this one" minted a superseding trip whatever the stash was — so a phone that had LOST
superseded its own dead trip, left the real winner unsuperseded, and made a third trip id
out of a two-way argument. One record now, one writer (`stashReplacedTrip`), one clearer
(`clearReplacement`). `argued` means a remote fork put this here, so somebody needs telling;
a list this device replaced itself is an undo and nothing more. `rival` means another phone
is still holding the loser and will offer it every poll — true only of a fork this device
WON, and the only thing that makes "Keep this one" a write. `iWon` is for the wording. A
decision that does not supersede is a pause, but only where somebody is still arguing: the
stash and the argument have different lifetimes on purpose, and a clean merge ends the
argument while leaving the undo, which is kept until the page closes. `tripConflict` still
names the disagreement by calling `chooseTripWinner`, so the card can never claim an
outcome the merge did not reach. *(v21.8, v23.6, restructured v24.0)*

**`tripCode` is a label, never an identifier.** Nothing parses it back, nothing stores it,
and it is derived from the whole trip id so it changes exactly when the trip does. It
exists because two lists built from the same picks are identical on screen and are
different trips — the fork a family could not see, and a whole release went into
explaining a symptom that four characters would have made obvious. Shown in Sync options
beside the app version. `tripLabel` takes the device id as an argument rather than reaching
for `deviceId()`, so it stays pure. *(v23.6)*

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

**Verify a new test fails against the old code — `npm run test:bite`.** A test written
for one session passed against the very bug it was meant to catch, because a button was
matched by the wrong label and nothing was ever clicked. In v23.9 it happened twice more:
one hand-rolled revert was wrong, and one assertion passed vacuously on missing code. In
v24.0, three guarantees the first sync-clock API was said to make turned out not to be
guarantees — nothing stopped a call site naming the wrong event, so the reverts sailed
through and the design looked safer than it was.

`test/bite-cases.js` is the list of defects this project has shipped, each expressed as
the smallest edit to `index.html` that brings it back; `test/bite.js` applies them one at
a time and reports any the suite fails to notice. It is the only check here whose passing
result is a FAILURE of the code under test, so it reads back-to-front on purpose.

**Every release adds a case for anything it claims to make impossible.** That claim is the
part most likely to be wrong — it was wrong twice in two releases, and only reverting
caught it both times. A case that does not bite means the test is agreeing with the code
rather than checking it: fix the test, never the case. A case that no longer matches the
source is reported STALE rather than skipped; re-point it and confirm it still bites.

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

1. Bump `APP_VERSION` **and `CACHE` in `sw.js`**. `APP_VERSION` shows in Settings and is
   how two phones get compared; `CACHE` is what drops the previous build's precached
   manifest and icons. `sw.js` has said "bump CACHE on every release" in a comment since
   v21.2 and four releases went past it in one session, because this list only ever named
   `APP_VERSION`. Two version strings, one step.
2. All three green: `npm test`, `npm run test:bite`, `npm run test:browser`.
3. **Every behaviour this release claims to make impossible has a case in
   `test/bite-cases.js`, and it bites.** "This bug cannot happen now" is the claim most
   likely to be wrong — v23.9 and v24.0 each shipped a structural fix that was less
   structural than advertised, and both times a by-hand revert was the only thing that
   noticed. A claim with no case behind it is a comment.
4. **Review the merge candidate as a separate pass, following `docs/DECISIONS.md`,
   "How to review this codebase".** Not the builder re-reading their own diff: the same
   reasoning that wrote the code wrote the tests, and it will find them agreeing. The
   cheapest real version is a **fresh session** — hand it the branch and that section, and
   nothing else. It has now found something both times it has been run: the v23.1 horizon
   regression a week after v23.0 was built around that field, and v24.0.1 within the hour.

   Use the half of the method that does not read documentation. **Follow the data**: for
   every field something treats as evidence, find all its writers and ask whether it still
   means what its readers assume. Tracing invariants finds code that contradicts its stated
   intent; it cannot find code that faithfully implements an intent that is wrong, which is
   what both v23.2 defects were, and what the v24.0.1 one was.

   Step 3 does not substitute for this. **A bite case only covers a defect somebody thought
   of** — it is a ratchet, not a net: it stops a fixed bug coming back and says nothing
   about the one nobody has had yet. Both are needed and neither is the other.

   If a separate pass genuinely is not possible, say so in the PR body rather than skip it
   quietly. A release that went out unreviewed and turned out fine is not evidence; v24.0
   went out unreviewed and did not.
5. Open a PR naming the rollback commit, and what the review found — including "nothing".
6. Merge to `main`; GitHub Pages publishes it.
7. If the release settled a question — chose between approaches, rejected a feature,
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

- **The shared-folder backend is barely synced at all.** Everything above describes the
  OneDrive path. `autoSaveToFolder` writes the whole `shoppingData` blind — no read-back, no
  merge, no concurrency guard — where OneDrive goes through `writeShoppingMerged`, so two
  folder-linked devices overwrite each other's ticks exactly as every device did before v15.
  There is no folder poll either: `loadFromFolderOrSeed` runs at startup and on reconnect
  and that is all. v24.0 at least routes its merge through the sync clock, so such a device
  records contact and advances a horizon; the freshness strip still has no mtimes to compare
  and so can never report `behind` there. Left alone because nobody uses it — the family is
  on OneDrive and the folder link predates that — but do not read the invariants above as
  covering it.

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

- **A phone on v23.4 or earlier still crosses its aisle ticks off everyone's Wait List.**
  It writes no `doneTripId`, so a `done` that arrived from its trolley reads here as a
  decision about the week and keeps the item off the next list. That is the pre-v23.5
  behaviour, and it is the safe half of the bug: the item is left off rather than deleted,
  because `finishShopping` on THIS device now sweeps only what `doneCountsHere` says is
  this trip's. It self-corrects as devices update.

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

- **Wait List additions are not visibly confirmed.** Making an unsent addition obvious
  on the Wait List tab would address the limitation above without touching the merge.
