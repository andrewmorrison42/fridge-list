# The Fridge List

A family recipe book, weekly menu planner and shopping list that works on a phone in
a supermarket. One self-contained web page, no server to run, and your data lives in
your own OneDrive.

**The app lives here:** https://andrewmorrison42.github.io/fridge-list/

- Pick recipes for the week, and it builds the shopping list for you, grouped by aisle.
- Two people can shop at once and tick items off — each phone sees the other's ticks
  within a few seconds. Once a shop starts the week's recipes are fixed, so nobody's
  list changes underneath them — anything extra goes on the Wait List and arrives in
  seconds.
- A Wait List anyone can add to the moment they notice you're low on something.
- Print the shopping list, or a weekly menu for the fridge door.
- Remembers each finished shop, so a previous week can be put back as this week's picks
  with one tap instead of going through the whole book again — and so the Menu tab can
  tell you how many of the meals you planned actually got cooked.
- Copy one recipe to the clipboard, laid out and ready to paste into an email or a
  document — or send it as a file another copy of the app can import. One recipe,
  not the whole book.
- Delete recipes in bulk when you want a clear-out, with a snapshot taken first and an
  undo button afterwards.
- Works offline once it has loaded, which matters when the signal in the shop is poor.

Some capabilities ship switched **off**, so the app stays simple until you want them.
Turn them on under **Settings → Features**:

- **Staples** — regular items (milk, bread) added to every generated list, with the
  quantity you normally buy.
- **Pantry items start as "at home"** — flour, oil and spices begin in an "already
  have this" group rather than on the buy list.
- **Order aisles the way you walk the shop** — works the route out from the order things
  were ticked off on previous shops, instead of listing the aisles alphabetically. It
  needs a few finished shops first, and Settings shows you the route it has worked out
  before you switch it on.

Comes with a few hundred family recipes to start from. You can cook from them, add
your own, or [clear them out](docs/SETUP-use-the-app.md#deleting-a-lot-of-recipes-at-once)
and keep only what you want.

---

## Setting it up for your family

There are two ways to do this. **Almost everyone wants the first one.**

### → [Guide 1: Use the app as it is](docs/SETUP-use-the-app.md)

You open the web address above, sign in with a Microsoft account, and the app keeps
your recipes and shopping list in **your own OneDrive**. Your family shares one folder.

- Takes about ten minutes.
- **No GitHub account needed. No copying the code. Nothing to install.**
- Nothing you enter is visible to anyone else — your data never leaves your OneDrive.

Start here unless you have a specific reason not to.

### → [Guide 2: Run your own copy end to end](docs/SETUP-own-azure-registration.md)

You take your own copy of the code, publish it at your own web address, and create
your own Microsoft sign-in registration, so no part of your setup depends on this
account.

- Takes about an hour, and involves the Microsoft Azure portal.
- Worth doing if you want to change the app, or you don't want to rely on someone
  else's sign-in registration continuing to exist.

Guide 2 explains the trade-off in plain terms so you can decide.

---

## Is my data private?

Your recipes and shopping list are stored as three files — `recipes-data.json`,
`shopping-list.json`, and `trip-history.json` (a short record of each finished shop,
which is what the app remembers things from) — inside a folder called **FridgeList** in
the OneDrive of whoever sets it up. They are not sent anywhere else, and there is no server or
database behind this app.

The one thing to understand before you start is what you are agreeing to when you
sign in. Both guides explain it in the same place, in plain language — see
**"What you are agreeing to when you sign in"** in
[Guide 1](docs/SETUP-use-the-app.md#what-you-are-agreeing-to-when-you-sign-in).

## Can I undo a mistake?

Yes, three ways: an in-app **Put back** button straight after a bulk delete, an
automatic **snapshot file** written before anything is deleted, and **OneDrive's own
version history**, which covers every change the app has ever saved — not only
deletions. See
[Getting things back when something goes wrong](docs/SETUP-use-the-app.md#getting-things-back-when-something-goes-wrong).

## Why can't the others see what I added?

Almost always because that phone is not connected to the shared folder. From **v22.2** it
says so itself: a red bar across the top reading *"This phone is not connected to the
family's list"*, with a button that takes you straight to sign-in. If you see that bar,
nothing you add is reaching anyone else until you connect it.

## Which version am I on?

The build number shows at the top of the **Settings** tab, and in the startup message
under the menu. When two phones behave differently, this is the first thing to compare
— close the app fully and reopen it to pick up the newest build.

---

## For developers

The whole app is a single `index.html` — markup, styles, JavaScript and the seed
recipe data — with no build step, no framework, and no runtime dependency beyond the
Microsoft sign-in library loaded from a CDN. Deployment is GitHub Pages: merging to
`main` publishes it.

```
npm install                # once, only needed for the browser tests
npm test                   # logic tests: no dependencies, no browser, ~1s
npm run test:browser       # browser tests: needs Chromium
npm run test:all
```

See [`test/README.md`](test/README.md) for what each suite covers and why they are
split, and [`CLAUDE.md`](CLAUDE.md) for the architectural rules worth knowing before
changing anything — several of them exist because breaking them caused real bugs.

### What's in the repo

| | |
|---|---|
| `index.html` | The entire application, plus the bundled recipe data |
| `sw.js` | Service worker. Network-first for the page, so a cached copy can never pin a device on an old build |
| `manifest.webmanifest` | Lets the app install to a phone's home screen |
| `.nojekyll` | Stops GitHub Pages running the site through Jekyll, which breaks it |
| `docs/` | The two setup guides |
| `test/` | Both test suites and their own README |

### One surprise worth knowing up front

`index.html` is about 1.2 MB, and **roughly 80% of that is the recipe seed** — 992 KB
of JSON inside a `<script type="application/json">` block. The application itself is
around 250 KB.

That matters when you search the file. The seed sits on a **single line of about a
million characters**, so any pattern that also appears in the recipe data dumps the
whole megabyte into your terminal — `quantity`, for instance, matches 5,550 times on
24 lines. To search only the application code:

```
awk 'length($0)<600 {print NR": "$0}' index.html | grep 'yourPattern'
```

The same line length is why `git diff` on `index.html` can be unwieldy, and why edits
are best kept surgical rather than reformatting.

### Known limitations

- **Wait List membership is last-writer-wins.** If an addition has not yet reached
  OneDrive and someone else adds something in the meantime, the unsynced one can be
  lost. Rare in practice — the Wait List is filled in during the week, usually by one
  person at a time — and deliberately left alone; see `CLAUDE.md` for the reasoning and
  the cheaper fix if it ever becomes a nuisance.
- **Recipes are last-save-wins**, with no per-item merge. Concurrent edits to *different*
  recipes on two devices can lose one side. An ETag guard stops a stale copy silently
  overwriting a newer one, and reports the clash instead.
- **Every open downloads the full recipe file**, whether or not anything changed.
- **A shop finished on a phone running an older build is not recorded**, so it leaves a
  gap in the history. Nothing breaks; the features that read it are written to be honest
  about thin data.
