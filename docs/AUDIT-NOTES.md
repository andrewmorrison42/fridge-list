# Addendum for the audit of v23.5–v23.8

Written by the agent that wrote those four releases, for whoever audits them. It is a map
of where the churn is, not a defence of it. `CLAUDE.md` says what must hold and
`docs/DECISIONS.md` says why; this says **where to look first, and what I already know is
wrong**.

## What happened

One bug report — two phones shopping, Wait List items crossing off and menu ingredients
not — produced four releases in a single session, all merged together in
[#23](https://github.com/andrewmorrison42/fridge-list/pull/23):

| | |
|---|---|
| v23.5 | a Wait List `done` set in the aisle is a tick, not a decision |
| v23.6 | trip label, deliberate list-building, a fork surfaced on both phones |
| v23.7 | the Wait List exception, and one strip saying where this list stands |
| v23.8 | silence when in step, red when not |

**Most of what v23.6–v23.8 "found" was introduced by v23.5–v23.7.** The honest tally:

- `waitingForFirstSync` — added in v23.5 as a guard, deleted in v23.6 as the wrong shape.
- The pocketed-phone red flash — introduced in v23.7, fixed in v23.8. `pollShoppingNow`
  returns early on `document.hidden`, so a time-since-last-success measure could not tell a
  phone in a pocket from one that could not reach the folder.
- `"Not checked for 10 minutes ago."` — shipped in v23.7 under a test I wrote that asserted
  a substring rather than the sentence.
- The `sw.js` CACHE bump — missed four releases running, because the release checklist named
  only `APP_VERSION`. Fixed, and the checklist now names both.
- Two ordering bugs in `renderReviewTab` caught before commit, not by a test.

So the pattern is not "the codebase kept yielding problems". It is that defects were being
introduced at roughly the rate they were fixed.

## Why, as best I can tell

Each release had its code and its tests written by the same reasoning in one sitting. That
is the exact failure `docs/DECISIONS.md` already names under "Green is not evidence about
the world" — it just landed on this session's work rather than on v23.2's. Nothing was used
by a human between releases, so there was no signal except my own.

**The practical consequence for the audit: a passing test is weak evidence here.** Every
assertion in `test/run-tests.js` for these four releases was written alongside the code it
covers. Ask whether the thing they agree on is *true*, not whether it is covered.

## Ranked targets

### 1. `renderReviewTab` — highest churn
Rewritten in three of the four releases. It is ordering-sensitive: which cards get appended
before which early return. One bug of exactly that kind was found late in v23.7 (an import
lands on an empty list, which is the branch that returns, and the undo card was appended
after it). That ordering is asserted only in the browser suite, indirectly.

Worth tracing by hand: for each of the four `listFreshness` kinds plus `noListYet` plus a
live `replacedTrip`, what actually renders, and in what order.

### 2. The freshness state — five variables, no single owner test
`shoppingRemoteModifiedSeen`, `shoppingRemoteModifiedLatest`, `shoppingBehindSince`,
`shoppingLastCheckedAt`, `shoppingCheckFailures`. Mutated from `pollShoppingNow`,
`pollOneDriveForChanges` and `mergeRemoteShopping`. `noteRemoteShoppingStamp` and
`noteRemoteCheckFailed` are meant to be the only writers — **check nothing bypasses them**,
and check the two are not both reachable for one attempt.

`listFreshness` itself is pure and well covered; the state feeding it is neither.

### 3. `mergeRemoteShopping` — the caller grew
It now works out the horizon, detects a trip conflict, stashes the losing trip, merges,
records the mtime and reports. `mergeShoppingData` stayed pure and that invariant holds, but
its caller went from two responsibilities to six across two releases.

### 4. The v23.7 auto-rebuild uploads the 992 KB recipe file — known, unfixed
`generateShoppingList` stamps `recipe.lastPlanned` and calls `persist('recipes')`. The
v23.7 Wait List exception calls `generateShoppingList` from a render, so **a Wait List
addition landing on a shopper's phone triggers a full recipe upload over supermarket mobile
data** — the exact scenario `CLAUDE.md`'s `persist(which)` invariant exists to prevent.

Not a regression: the pre-v23.6 auto-refresh did the same. But v23.7 reintroduced that
automatic path deliberately and I did not think about the upload. v23.9 shrinks the bundled
file; it does **not** fix this, because the file being uploaded is the family's own recipe
data, not the seed.

The fix is probably to split the `lastPlanned` stamp out of the rebuild, or to defer the
recipe write — both touch `persist`, which is why it was not done in passing.

### 5. `keepThisList` / `putBackReplacedList` — untested interaction
Both mint a superseding trip. Two people tapping opposite buttons within one poll interval
is not tested, and the resolution depends on `chooseTripWinner`'s first rule seeing a
`supersedes` that names a trip the other side still holds.

### 6. Wording assertions
`syncAlertState`, `listFreshness`, `mergeReport` and `replacedTripSummary` all have tests
that assert substrings. The `"Not checked for 10 minutes ago."` defect passed one of those.
Substring assertions on generated sentences are weak; read the sentences.

## What I would treat as settled

Not to steer the audit away from them, but so effort goes where the churn is:

- `mergeShoppingData`, `mergeAuthored`, `mergeShoppingLine`, `chooseTripWinner` — unchanged
  in substance across these four releases, and covered by tests that predate them.
- `doneCountsHere` and `doneTripId` (v23.5) — the smallest of the four changes, and the one
  with a reproduction that was run against the old code before the fix was written.

## On the test evidence

Each release's new tests were run against the previous build with the new names stubbed to
the old behaviour, and confirmed to fail: 7, 22, 31 and 14 assertions respectively. That
shows the tests bite. It does **not** show the premise behind them is right — which is the
distinction that let `"Not checked for 10 minutes ago."` through, under an assertion that
failed correctly against v23.6 and passed happily against a sentence with a double "ago".
