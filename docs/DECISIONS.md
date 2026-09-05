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
