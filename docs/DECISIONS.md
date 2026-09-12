# Decisions, and why

`CLAUDE.md` records the **rules** the code has to keep. This file records the
**decisions** behind them: what was chosen, what was rejected, and what was learned when
a decision turned out to be wrong.

The two are different documents on purpose. A rule tells you what you must not break. A
decision tells you why breaking it was ever tempting — which is what you need when the
same idea comes back around, as several of these have.

Written up after v23.2. Entries carry the release they belong to.

---

## What this app is, and is not

The Fridge List is used by one family, on phones, in a supermarket. Almost every decision
below follows from that sentence rather than from any general view of what a shopping app
should be.

**It does not tell anyone what to cook.** This has come up twice and been rejected twice,
and the second rejection is the one that clarified it.

- *Assign a meal to each day of the week* — rejected: "too rigid for the way the family
  operates."
- *Order the week's recipes so the perishable ones get cooked first* — offered as the
  softer, non-rigid version of the same idea, and rejected too.

The second rejection matters more than the first, because it shows the objection was never
about rigidity. It is that **the app should not be telling anyone what to cook**. It holds
the recipes, works out the shopping, and gets out of the way. Anything that ranks, orders,
nudges or suggests meals is out of scope, however gently it is phrased. If you are about
to propose a feature that ends in a recommendation about dinner, this is the entry to read
first.

**It does not decide what "using the list" means.** *(v23.3)* Pruning the list at home and
ticking it off in the aisle are both real work, done by different people at different
times, sometimes at once. The app protects both and privileges neither, and it does not
lock anyone out of the other while one is happening.

**It does not learn the shop for you.** *(removed in v23.0)* v22.0 shipped a learned aisle
route — the app watched the order things were ticked off across finished shops and reordered
the list to match the way the family walks round. It worked, and it was removed anyway. It
put a layer of inference between the person and the list, and the list is the thing people
trust. The trip archive still records what it needs to; nothing reads it for a route.

**It does not repeat a previous week.** *(removed in v23.0)* v22.0 could put a past week's
picks back as this week's with one tap. Removed on the same grounds and one more: nobody
wanted it. Shops are logged silently and the archive is kept, because there is one possible
future use — *helping someone recall a meal they had a few weeks ago*. That is a memory aid,
not a planner, and the distinction is the point.

**The archive is written but barely read, deliberately.** Four small features come off
`trip-history.json`. That is not an oversight waiting to be corrected; it is the safe order
to do it in. Writing the record is cheap, reversible and no risk to a live shop. Reading it
means putting inference in front of people, which is where the two removed features went
wrong. Candidates worth considering are listed in `CLAUDE.md` under "Open work".

---

## Sync: the long arc, and what it cost

This is where most of the engineering has gone, and most of the mistakes.

### The problem in one paragraph

Two or more phones hold their own copy of the shopping data and reconcile through a folder
polled every 20 seconds. When two copies differ, something has to decide what the merged
truth is. The hard case is not two people editing the same thing — it is telling **"you
added that while I was away"** apart from **"I deleted that while you were away."** Both
look identical in the data: an item present in one copy and absent from the other. Get it
wrong one way and deletions come back from the dead; get it wrong the other way and things
people added silently vanish.

### v21.x — a different answer per screen

Each collection got whatever rule seemed reasonable when it was written: shopping lines
were unioned, the week's picks were taken wholesale from the newer file, Wait List
membership from the newer file. Seven behaviours in total, two of which silently threw away
things people had added. Nobody — including the people who wrote them — could predict which
rule applied to what they had just tapped.

Every release from v21.8 on invented another tiebreaker to guess around the missing fact:
`generatedAt`, then `basedOn`, then `supersedes`, then a live-trip bias. Each one worked on
the case that prompted it. That should have been the signal.

### v23.0 — one rule, and a persisted horizon

The missing fact was **how much of the shared folder's history this device had actually
read**. It existed as `seenRemoteAt`, but only in memory, so it was lost on every reload —
which is precisely why four tiebreakers had to be invented to guess around it. A device
with no horizon cannot prove it ever saw what it is removing, so it may delete nothing.

v23.0 persisted it and collapsed the seven behaviours into one:

> Union by id; each field resolved by its own stamp; an item on only one side is **kept**
> unless the other side demonstrably saw it and no longer has it.

`mergeAuthored` is that rule. Shopping list **lines** are the deliberate exception, because
they are *derived* — regenerated from the picks, the staples and the Wait List — so only
their flags are authored, and those already resolve per flag by their own stamp. That is the
same rule specialised, not an escape from it.

**Recipes are the one collection the rule does not cover.** They are large documents rather
than small stamped items; folding them in would double the diff in the most delicate function
in the app, and they have a working, if blunt, ETag guard. The boundary is deliberate, and
several other known limitations sit on it — do not assume the model is uniform.

### v23.1 — the horizon regressed on the commonest path

Found by adversarial review, a week after v23.0 was built entirely around this field.
`mergeShoppingData` built its result with `Object.assign({}, secondary, primary)`, so
`seenRemoteAt` was taken from whichever file was newer — normally the remote one, since
that is usually why a merge is running. That is the *other* device's record of how far *it*
had read. The horizon went backwards on the most common path in the app.

Fixed by making ownership explicit: `mergeRemoteShopping` works the new horizon out, merges
without touching its inputs, and stamps the result. **`seenRemoteAt` is per-device state and
the merge must never adopt the other side's.**

### v23.2 — a deletion is recorded, not inferred

Reported from a real shop: clearing the week made the picks disappear and come back. Two
defects, both introduced by v23.0, both the same mistake.

- Picks written before v23.0 carry no `addedAt`, so their age fell back to the file's
  `lastUpdated` — which `saveShoppingLocal` bumps on **every** save. A week-old pick in a
  file saved ten seconds ago presented as ten seconds old and could never be shown to have
  been seen. Permanently undeletable; waiting did not help.
- Any removal within about 110 seconds of the addition failed the same test, on every
  deletion path.

The bound itself was sound — a file written at T proves everything in it existed by T at the
latest — but it was then **used as if it were a creation time**, and an upper bound that
moves forward on every save is worthless as evidence that anyone saw anything.

The fix is not a better inference. It is no inference:

> **A deletion is evidence, not a deduction.** When something is removed, record that it
> was removed and when. The merge honours a removal because it can see one.

Every deletion site stamps a tombstone through one helper, `noteRemoved`. `mergeAuthored`
drops an item when a tombstone post-dates that item's own last authored moment, so
re-adding after a removal wins on its fresher stamp. The old inference survives only as the
fallback for copies arriving from builds that write no tombstones.

**Why tombstones were declined in v21.x and accepted now.** The v21.x objection was real:
bolting a tombstone map onto three ad-hoc, divergent deletion rules meant three places to
get it wrong and no shared notion of what "seen" meant. v23.0 made `mergeAuthored` a single
chokepoint and gave the app a persisted horizon. The objection expired; the idea did not.
Worth remembering when rejecting something — record *why*, so you can tell later whether
the reason still holds.

### v23.3 — the family does two things with a list, and the app only knew about one

Not a sync bug, and worth saying because the four releases before it were. The merge did
what it was told. The app modelled one activity — ticking things off in the aisle — and
defined "progress" as ticks. The family does two: they **prune the list at the kitchen
table** ("we already have olive oil", "not chorizo this week") and then they tick it off
in the shop. Pruning was invisible to every mechanism that protects a shopper's work, so
all four stood down at once: the freeze did not engage, the Review tab auto-rebuilt the
list, the undo stash returned early, and `chooseTripWinner` would not defend it. Adding a
single recipe then rebuilt the list from scratch and undid the lot.

Underneath it, a second thing: **adding a recipe was treated as replacing the list rather
than extending it**, even though a Wait List addition — the same kind of act — had been an
extension all along.

Three decisions, taken with the family:

- **Pruning protects, but does not lock.** It earns an undo and holds its ground against
  another phone, but the Start tab stays open. Locking would have blocked exactly what
  they were doing. This is why `tripHasProgress` and `tripIsLive` are two functions.
- **Several people prune at once.** No single-writer restriction, no "one phone at a time"
  mode. The per-flag merge already supported it; what was missing was that anything
  believed it counted as work.
- **At-home and removed decisions carry across even a genuinely new list.** They are facts
  about the cupboard and the week, not about which generation of the list you are looking
  at. Ticks still do not carry — those mean "in the trolley", and v21.8 exists because a
  tick leaking into the wrong trip cost a family a shopping trip.

The general lesson is the one written in "How to review this codebase" below, and this
release is its first real test: **ask what a field means, not just what it does.**
`tripProgress` does exactly what its name says. What it was being *used* to mean — "is
there work here worth protecting" — was wrong, and no amount of checking the code against
the documentation would have found it, because the documentation said ticks too.

### v23.4 — a control that had never existed

Reported: adding a new ingredient never asks for the units. It never could. Every write to
`shoppingUnit` was either the seed migration or a hardcoded `''`, with one exception — the
unit typed on a recipe line, captured when that recipe is saved. Nothing could edit it
afterwards.

It stayed hidden because the seed ships 446 ingredients with units already set (245 `g`,
120 `qty`, 80 `mL`, one blank), so the gap only bites a household adding its own.

Two decisions:

- **The picker offers `g`, `mL` and "each", and nothing else.** Free text would let
  somebody enter `cup`, which the app deliberately refuses as a shopping unit because it
  hard-locks that ingredient's unit box to a kitchen measure forever after. The three
  cover 100% of the real data.
- **`qty` is shown as "each" and still stored as `qty`.** No change to the shape of synced
  JSON, and it closes a separate open item about the editor showing `qty` as if it were a
  unit. The catch is that the editor SAVES what that box displays, so the label lives in
  `.value` and the truth in `dataset.unit` — a detail worth a test of its own, and it has
  one.

The reason this is worth recording rather than just fixing: it is the third defect running
that this repo's own documentation would have concealed. Two strings in the UI assert the
control exists. Reading the docs finds nothing; enumerating every writer of `shoppingUnit`
finds it in a minute. That is the method in "How to review this codebase" below, and this
was its first unprompted success.

### v23.5 — one flag, two lifetimes, and a fork nobody could see

Reported from a shop: two phones, and the items one shopper put in the trolley crossed off
on the other's phone **only where a Wait List entry was behind them**. Recipe ingredients
stayed unticked. The family's reading was that both phones were on the same trip and the
same master list.

The decisive fact is that `neededList` and `shoppingList` travel in the **same file**,
written by the same save — so the data always arrived. The split is the merge, and only one
rule in it treats the two collections differently: `shoppingList` is trip-scoped and a
mismatched `tripId` makes `chooseTripWinner` discard one side wholesale, while `neededList`
is authored data and merges regardless of the trip. A menu ingredient has one channel; a
Wait List item has two. So the symptom is the exact fingerprint of two trip ids, and
nothing else in the code can produce it.

Two things were wrong, and they are worth separating.

**`done` was one flag doing two jobs.** Ticking a line in the aisle and ticking an entry on
the Wait List tab both set `done`, but the first is a tick (belongs to a trip) and the
second is a decision (belongs to the week). The app already knew that distinction — *"a
decision outlives its trip, a tick does not"*, v23.3 — and had simply never applied it to
the Wait List. So a tick was stored on the one collection that outlives trips.

- **Chosen: stamp the trip on the aisle route only** (`doneTripId`), and route every
  reading of "is this done" through `doneCountsHere`. Additive field, absent on older
  copies, which then behave exactly as they did.
- **Rejected: make `neededList` follow the trip winner.** It would fix this symptom and
  reintroduce the v23.0 bug the one rule exists to prevent — a Wait List addition made on
  the losing phone would vanish. Which shopping *list* won says nothing about what somebody
  added to the Wait List, for the same reason it says nothing about the recipe picks.
- **Rejected: clear a foreign trip's `done` on this device.** It would write back, and two
  phones would then fight over the flag. A `doneTripId` that matches nothing here simply
  reads as not done, and self-corrects with no traffic.

The severity was not the strikethrough. `finishShopping` deleted every `done` entry, so the
shop ended by **binning Wait List items nobody had bought** — a silent data loss sitting
behind a cosmetic-looking report. Worth remembering when triaging: the reported symptom was
the harmless half.

**Two identical-looking lists were two trips, and nothing said so.** Both phones opening the
Review tab before either had read the folder is enough: `shoppingListIsStale()` is true
whenever the list is empty (it is, right after "Shopping is done"), and the tab regenerated
silently. `tripId` appears nowhere in the interface.

- **Chosen: say it out loud.** `mergeReport` gets its own sentence for a replaced trip,
  naming the ticks it cost and pointing at "Put back the list that was replaced". That undo
  has existed since v21.8; what was missing was any reason to reach for it.
- **Chosen: do not mint a trip before this device has read the folder** — but only when
  there is no list on screen, because holding back a list somebody can already see would
  replace it with a notice, and hiding what a person is reading is the failure this file
  keeps circling.
- **Rejected: offer a choice between the two lists.** v21.8 tried that and v21.9 removed
  it. Asked to choose between two lists, nobody knew which was which. Waiting one poll is
  not a choice, which is why this is not the same prompt coming back.

A note on method, since "How to review this codebase" is about exactly this: the first
diagnosis here was right about the mechanism and wrong to stop there. What settled it was
driving the real extracted functions with both trip ids and watching the reported symptom
appear on demand — same trip, everything crosses; different trips, only `done` does. The
suite had 322 passing assertions over this merge and none of them asked that question.

### v23.6 — a name, a tap, and an argument that ends

v23.5 fixed what a fork did. This closes the fork itself, and does it by reversing two
earlier decisions rather than fencing them again.

**Reversed: the Review tab refreshing on entry.** *(v21.8)* The idea was that the list
should reflect the current picks "rather than sitting behind a button nobody would think
to press". It was fenced twice — v21.8 for a live trip, v23.5 for a device that had not
read the folder — and the second fence is what gave it away. Two patches on one call are
not a hardening, they are a signal that the call is wrong. Opening a tab is not asking for
a list, and a list minted because somebody opened a tab is precisely how two phones came
to hold a trip each. `generateShoppingList()` now has exactly one caller and a source test
asserts it, because the rule is about *how many ways in there are*, which no runtime test
can see.

The cost is real and worth naming: **"grab shampoo too" no longer lands on the shopper's
list by itself.** A Wait List addition made at home now shows the shopper a line saying
there is something new and a one-tap update. That tap is safe by construction — a
same-trip rebuild, so nothing in the trolley is lost — but it is a tap that did not used
to exist, and it is the one thing in this release that a family might miss. It was chosen
deliberately over keeping an automatic path for same-trip rebuilds only: a rule with an
exception is how the auto-refresh survived two fences, and "nothing builds a list unless
somebody asks" is a sentence anyone can hold in their head.

A smaller thing found while writing it: the staleness card first said "the week's recipes
have changed", which is untrue for the commonest cause. Most staleness is a Wait List
addition or a staple amount. It now checks `lastGeneratedRecipeSignature` and says which.

**Reversed: offering no choice between two lists.** *(v21.9)* v21.8 offered "Make a new
list anyway" and v21.9 removed it, because "asked to choose between two lists, nobody knew
which was which". That objection was correct, and it was about *labelling*, not about
choice — so the fix is to make the two answerable rather than to keep hiding one:

- The card describes each list by what is on it — when it was made, how much is ticked,
  how much was pruned — reusing `replacedTripSummary` rather than asking anyone to tell
  two identical things apart.
- Whichever trip loses is stashed. `stashReplacedTrip` previously ran only when THIS
  device's trip was replaced, so the phone that *won* saw nothing at all — which is the
  side the original report came from and the reason nobody could connect the two halves.
- Both buttons write. "Keep this one" used to drop the local stash and nothing else, which
  settles nothing: the phone holding the other list goes on offering it every poll.
  `keepThisList` mints a superseding trip, exactly as `putBackReplacedList` does. **A
  decision that does not supersede is a pause, not a decision.**
- `syncAlertState` gains a `conflict` kind, above everything but a failed write and on
  every tab. v23.5 said this once in a status line, which scrolls away; being told once in
  passing is not being told.

**Rejected: holding both lists until somebody chooses.** Neither list discarded, the merge
refused, both phones showing the choice. Stronger in principle, and it leaves a phone
sitting on a stale list until a human acts — in a supermarket, with the other shopper
already walking. `chooseTripWinner` still decides immediately so nobody is ever stuck, and
the choice is offered on top of a working list rather than instead of one.

**Rejected: the trip code in the shop toolbar.** Proposed there first, on the grounds that
it is what two people would read to each other mid-shop. It belongs in Sync options next
to the app version — the place you already go to compare two phones — and a code above a
shopping list is clutter ninety-nine weeks in a hundred. The card does not use the code
either: "made 18:42, 12 ticked" answers *which is which* and a hash does not.

### v23.7 — the exception worth making, and what "the list" actually means

Two follow-ups to v23.6, and they pull in opposite directions on purpose.

**Put back one automatic rebuild — the only one that is safe by construction.** v23.6's
rule was "nothing builds a list unless somebody asks", and the price was that a Wait List
addition made at home no longer reached the person already in the aisle. That was the one
automatic behaviour in the app that was doing real work.

The distinction that makes this an exception rather than a relapse: the old auto-refresh
could do *anything the button could*, including mint a trip on a phone that had not caught
up. This can do exactly one thing. Four conditions must hold — stale, `sameTripRebuild()`,
recipe signature unchanged, and a Wait List entry genuinely missing — and together they
mean the rebuild **cannot mint a trip and cannot drop a tick**. That is a guarantee about
what the code is able to do, not a promise about when it will run, which is what both
earlier fences were and why both leaked.

Deliberately not widened to staple amounts. A staple is edited by the person who then
walks to the Review tab, so a tap costs them nothing, and every extra case is a step back
towards "the tab rebuilds when it feels like it".

A subtlety found writing it: **membership has to be checked by the entry's id, not its
name.** A Wait List "milk" added while a recipe already needs Milk folds onto that existing
line. A name check calls that satisfied — but until the line carries the entry's id,
`syncNeededFromLine` cannot find the entry, so ticking it off in the aisle crosses nothing
off and the two stay out of step for the whole shop.

**Make the shared copy canonical — visibly.** Asked whether one version of the list could
be canonical so that a stale one is obvious.

- **Chosen: the folder copy is the list, and each phone holds a cache.** No data-model
  change. It was already true; nothing on screen had ever said so, which is why "am I
  looking at the list?" had no answer — the same gap the two-trip fork came through.
- **Rejected: blessing a trip as canonical.** A new synced field, an answer needed for two
  phones blessing at once, and it largely duplicates `supersedes`, which already expresses
  "this replaces that" and is what `keepThisList` and `putBackReplacedList` write.

Four ways to be wrong were scattered across three places — two cards on the Review tab, one
in the sync banner, and "you are behind the shared copy" said *nowhere at all*.
`listFreshness` ranks them into one strip. `behind` outranks everything, including a picks
change, because rebuilding from a stale base is precisely the act that mints a rival trip:
the most dangerous thing a person can do while behind is press the button that looks like
the fix.

Two details worth keeping:

- The comparison is **mtime against mtime**. `shoppingSeenRemoteAt` is a stamp from inside
  the file and is not comparable with a file's modified time; using it would have invented
  staleness on every write.
- `behind` waits out a 45-second grace. The 5s poll normally closes the gap, and a warning
  every time the other shopper ticks something would be worse than saying nothing — the
  banner would be permanently on during exactly the situation it exists for.

### v23.8 — a threshold that could not be justified, and what that exposed

Two corrections to v23.7's freshness strip, and the second is the interesting one.

**Silence is the in-step state.** The strip always said something, including "In step with
the family's list" when all was well. On a screen people stare at for 45 minutes, a
permanent line of good news earns nothing and dilutes the one case that matters. It now
renders only when something is wrong, and the two sync cases render in red against the
amber the picks cases already used. Red is worth keeping rare.

The `local` line went with it. A phone that shares with nobody is not out of step with
anybody, and the sync banner's `unlinked` case already says so on every tab in the
strongest terms the app has. Two places saying one thing is what the strip was written to
end, so having it say that thing twice over was the feature eating itself.

**A warning follows a failed attempt, never a missing one.** v23.7's `unchecked` case fired
after four minutes without a successful read. Asked to justify that number — a supermarket
has bad signal, would this be on for most of a shop? — the honest answer turned out not to
be about the number at all.

`pollShoppingNow` returns early on `document.hidden`. A phone in a pocket between aisles is
not polling, so the clock kept running, and a phone with perfect signal in someone's pocket
was indistinguishable from one that could not reach the folder. Worse:
`visibilitychange` fires a poll on wake, but the strip renders before that poll completes,
so the shopper got a flash of red **every time they picked their phone up**. No threshold
fixes that; the signal was measuring the wrong thing.

It now counts consecutive *failed* attempts, and requires elapsed time as well — the count
rules out a single blip, the time rules out three fast retries inside one bad second. The
call sites matter as much as the rule: only a non-200 and the `catch` in each poll count,
never the guard returns above them, because those are the pocket.

Worth recording as method rather than as a fix. **A question about a constant is often a
question about the variable it is applied to.** The tuning question ("is four minutes
right?") had no good answer because the quantity being thresholded was not the quantity
anyone cared about. Two of the last four defects in this file have that shape:
`effectiveAddedAt` measured a bound that moved, and this measured a silence that was not a
failure. When a threshold cannot be defended, check what it is measuring before picking a
new number.

A smaller thing the rewrite caught: the old wording read "Not checked for 10 minutes ago."
It had a passing test — which asserted the substring, not the sentence.

### v24.0 — the audit was right and the fixes were the wrong shape

An audit against the invariants in `CLAUDE.md`, asked for because issues were "drifting in".
It found nine defects. The first attempt (v23.9) fixed five of them **at five call sites**,
and was reverted — not because the fixes were wrong, but because the shape was. Its own
write-up called them "three clocks that were not what they claimed" and then fixed each
clock separately, which is the exact move this file already warns about one section down:
*each fix adjusted the guess; the one that ended it removed the guess.*

**What actually generated them.** Two facts about the app lived as loose module variables
that any call site could advance, with no owner and no way to be wrong loudly:

- *how current is this device* — six variables, and of the twelve `graphFetch` call sites,
  **three reported anything to them**;
- *who replaced whom* — `replacedTrip` and a second variable beside it, kept in step by a
  comment saying they had to be.

Every finding was one instance. So was the v23.1 horizon regression, and the v23.8
pocket-phone warning, which is how far back the pattern runs.

**Looking at the shape found two more than hunting for instances had.**
`stampOneDriveTimestamps` issued the *identical* folder request `pollOneDriveForChanges`
makes, succeeded, and reported nothing — and it runs after every autosave. And
`getOneDriveFileText` returned `null` for both "not there" and "did not come back", while
`loadFromOneDriveOrSeed` read that null as an empty folder and PUT this device's whole local
copy over the file: a transient 500 on the way in could overwrite the family's recipes. Two
functions issuing one request and answering differently is the generator; neither would have
turned up by looking for another wrong timestamp.

**The fix is two owners, not a sixth rule.** `makeSyncClock()` and one `replacement`
record. This is the third time this repo has made that move — `applyMergedShopping` ("one
way in and out of `shoppingData`") and `mergeAuthored` ("one rule for every collection a
person authors", replacing seven ad-hoc ones) — so it is a pattern the codebase already
trusts rather than a new idea.

**The part worth keeping: the first API did not work, and the bite check is what said so.**
Its events were `read` / `holds` / `absent` / `failed`. Reverting each old defect against it,
three did not fail a single assertion: nothing stopped a call site from *naming the wrong
event* — calling `holds()` where it had only metadata, or `failed()` on a 404. The claim
"these bugs are now unrepresentable" was false, and it was false in the direction that
flatters the design.

The reshape is the whole lesson. **Make the call site hand over evidence, not a
conclusion:**

- `answered(status, mtime)` — the call site passes the HTTP status and the clock decides
  what it meant, so no function decides locally that a 404 means "cannot reach". One
  decision, in one place, tested once.
- `merged(mtime, remoteCopy)` — takes the **copy**, not a stamp. A function holding only
  metadata has nothing to pass, so it cannot claim a copy it has not got.
- `wrote(mtime)` — separate from `merged()`, because a write teaches this device nothing
  about anybody else and its horizon must not move.

With that shape all nine reverts bite. An API where the caller reports a fact is safer than
one where the caller reports a judgement, and "I could not write the bug against this" is
worth more than any number of assertions about the bug itself.

**And a criterion that had to be met rather than argued with.** The plan said `CLAUDE.md`
must get *shorter* — if the invariants section grew, this was patches again. First pass:
+29 lines. Second: +9, with the rule count unchanged at 41. Both times the honest reading
was that improving three rules is not removing any, and the growth was design rationale
sitting in the file that is supposed to hold rules rather than reasons. Two rules were then
genuinely deleted, because the clock *enforces* what they used to ask a reader to remember:
the guard returns cannot reach it, and the merge cannot touch the horizon. 41 rules → 39.
A refactor that leaves the rule count where it found it has not removed a class of bug; it
has renamed one.

### What the arc actually cost

Four structural sync changes in two days, two of them fixing something the previous one
introduced. The pattern, stated plainly so it is not repeated: **v23.0 made deletion an
inference, and every defect since was that inference being wrong in a new way.** Each fix
adjusted the guess. The one that ended it removed the guess.

The honest test of whether v23.2 is the last of these is not a green suite. It is whether
the family stops reporting it.

---

## Safety: recoverable beats confirmed

**A dialog is not a safety mechanism.** v19.0 removed a bulk ingredient delete that had one.
Destructive actions write a snapshot *first* and proceed only if that write succeeded, keep
an in-session undo, and are documented alongside OneDrive's own version history.

**Replacing a list someone is shopping from is a destructive action.** `stashReplacedTrip`
keeps the displaced list for the session, and putting it back is expressed as a *deliberate
replacement of the list that displaced it* — a new trip id naming what it supersedes — so it
wins on every phone rather than being overwritten on the next poll.

**Import is deliberately not blocked mid-shop**, unlike everything on the Start tab. It is
the recovery tool of last resort, and a household whose data has gone wrong mid-shop is
exactly who needs it. The confirmation names the cost and the stash makes it recoverable —
that is the trade, made in that direction on purpose.

**Freezing the week during a shop replaced offering a choice.** v21.8 let the picks change
and then offered "Make a new list anyway". Asked to choose between two lists mid-shop,
nobody could tell which was which. v21.9 froze the picks instead and said why. Removing the
choice was the fix; a clearer dialog would not have been.

---

## Honesty in the interface

**A device that cannot reach the folder has to say so, and the wording is the feature.**
Two people planned a week nobody else ever saw, while the startup line told them in green
that they were "working from this device's local copy". `syncAlertState` is pure so the
exact sentences can be asserted without a browser — if you reword them, the tests are
asserting the wording **on purpose**.

**A merge that changes anything says so.** The point of one rule is that the outcome is
predictable; the point of the sentence a phone shows when it catches up is that nobody has
to take that on trust.

**Nothing presents a plan as a meal.** `lastCooked` used to be stamped when a list was
generated, so "not cooked recently" really meant "not shopped for recently". `lastPlanned`
carries that meaning now. Anything derived from cooking must keep the two apart.

**Thin data is admitted as thin.** A shop finished on an older build is a gap in the
history, so everything reading the archive is written to be honest about it — the cook rate
says "at least".

---

## How to review this codebase

Written after an adversarial review passed over both v23.2 defects and, worse, cited the
two mechanisms behind them as strengths.

That review's method was to take each invariant in `CLAUDE.md` and trace it back to the code
that enforces it, hunting for a counterexample. That finds code which **contradicts its
stated intent**. Both v23.2 defects were code that **faithfully implemented its stated
intent, where the intent was wrong**. `effectiveAddedAt` did exactly what this repo's own
documentation said it should. The review checked, found they agreed, and moved on.
Agreement was the wrong test.

It also listed `effectiveAddedAt` and the merge-grace window under "solidly covered by real
assertions". They were. The tests were written by the same reasoning that wrote the code, so
they asserted the same false premise back at it. **Coverage measures agreement between test
and code; it is not evidence about the world.**

So, in addition to tracing the invariants:

1. **Follow the data, not the documentation.** For every field the merge treats as
   evidence, find *all* its writers and ask whether it still means what its readers assume.
   One pass over the writers of `lastUpdated` shows `saveShoppingLocal` moving it on every
   save, while `effectiveAddedAt` consumed it as a creation time. That is a data-flow
   question, and no amount of invariant-checking asks it.
2. **Attack the accepted limitations, don't re-read their justifications.** The permanent
   defect lived inside an entry already written down as "deliberately left" and assessed as
   safe. A method that starts from this repo's documentation inherits its blind spots — by
   construction, it cannot see anything the documentation has already dismissed.
3. **Ask what a field means, not just what it does.** "Sound upper bound" and "creation
   time" are different claims. The bug was the slide between them.
4. **Start from the reported symptom.** The clarifying detail from the family — that it
   happened when nobody had picked anything for a week — ruled out the timing window and
   exposed the permanent defect underneath. No amount of reading found that; one sentence
   from someone using it did.

`mergeAuthored`'s tombstone map is now new evidence-bearing state. It deserves treatment 1
above before anything else is built on it.

---

## Process decisions

**Verify a new test fails against the old code.** A test written to catch a specific bug
once passed against the very bug it was meant to catch, because a button was matched by the
wrong label and nothing was ever clicked. Checking out the previous release and running the
suite takes a minute and is the only thing that proves a test bites.

**The regression corpus is the asset, not the current suite.** Every sync bug the family
has reported has a test named after the release that caused it. Four structural rewrites
have gone through that corpus untouched. It is the only thing standing between the next
rewrite and a repeat.

**Tests extract the real functions from `index.html`** rather than keeping a copy that would
drift. A rename fails loudly.

**Never change the shape of synced JSON.** Family devices run different builds at the same
time and a service worker can pin a phone on an old one for a while. Add alongside; do not
restructure. This is why staple quantities live in a separate `settings.stapleQty` map, and
why every field added since is optional.
