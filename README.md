# The Fridge List

A family recipe book, weekly menu planner and shopping list that works on a phone in
a supermarket. One self-contained web page, no server to run, and your data lives in
your own OneDrive.

**The app lives here:** https://andrewmorrison42.github.io/fridge-list/

- Pick recipes for the week, and it builds the shopping list for you, grouped by aisle.
- Two people can shop at once and tick items off — each phone sees the other's ticks
  within a few seconds.
- Add regular items ("staples") that go on every list automatically.
- A Wait List anyone can add to the moment they notice you're low on something.
- Print the shopping list, or a weekly menu for the fridge door.
- Works offline once it has loaded, which matters when the signal in the shop is poor.

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

Your recipes and shopping list are stored as two files, `recipes-data.json` and
`shopping-list.json`, inside a folder called **FridgeList** in the OneDrive of
whoever sets it up. They are not sent anywhere else, and there is no server or
database behind this app.

The one thing to understand before you start is what you are agreeing to when you
sign in. Both guides explain it in the same place, in plain language — see
**"What you are agreeing to when you sign in"** in
[Guide 1](docs/SETUP-use-the-app.md#what-you-are-agreeing-to-when-you-sign-in).

---

## For developers

The whole app is a single `index.html` — HTML, CSS, JavaScript and the seed recipe
data, with no build step and no dependencies at runtime beyond the Microsoft sign-in
library loaded from a CDN.

```
npm install                # once, only needed for the browser tests
npm test                   # logic tests: no dependencies, no browser
npm run test:browser       # browser tests: needs Chromium
npm run test:all
```

See [`test/README.md`](test/README.md) for what each suite covers and why they are
split.
