# Guide 1 — Use the app as it is, with your own OneDrive

**This is the guide almost everyone wants.** About ten minutes.

You do **not** need a GitHub account. You do not need to copy any code, install
anything, or understand what GitHub is. You open a web address, sign in with a
Microsoft account, and your recipes and shopping list live in your own OneDrive.

You will need:

- A **Microsoft account** — any `outlook.com`, `hotmail.com`, `live.com` address, or
  a work Microsoft account. This is the same account you would use for OneDrive.
- A few minutes on a laptop for the first-time setup. You *can* do it entirely on a
  phone, but the first run is easier on a bigger screen.

---

## What you are agreeing to when you sign in

Read this bit properly — it is short, and it is the only decision that matters here.

The app signs you in using Microsoft's standard sign-in screen. It never sees your
password. But to read and write your shopping list, it asks for a permission called
**Files.ReadWrite.All**, and Microsoft will show you that on the consent screen.

That permission means: **while you have the app open, it can reach any file in your
OneDrive** — not just the FridgeList folder.

It is asked for because of how OneDrive sharing works. A narrower permission
(`Files.ReadWrite`) only covers files you personally own, which would mean everyone
but the folder's owner could read the shopping list but never tick anything off.

In practice the app only ever touches one folder, called **FridgeList**. You can read
the code — it is a single file, and every OneDrive call is in it. But you are taking
that on trust, and you should know that.

**What this means for you:**

- **Setting this up for your own household — fine.** You are trusting the same person
  whose recipes you are about to use.
- **Sharing this app with people outside your household — think first.** They would be
  granting that access on their own account, to a registration they don't control. If
  they want it, point them at
  [Guide 2](SETUP-own-azure-registration.md) so they run their own copy, or have them
  make a brand-new Microsoft account used only for this, so there is nothing else in
  the OneDrive to reach.

Nothing you enter goes anywhere except your own OneDrive. There is no server behind
this app, no database, and no account with the author.

---

## Step 1 — Decide whose OneDrive holds the data

Pick **one person** in the household. Their OneDrive will hold the two data files,
and everyone else will share the folder from them.

It does not need to be a new or dedicated account — an ordinary family member's
account is fine, and avoids the hassle of creating a new Microsoft account (which
fails surprisingly often; see Troubleshooting).

Two practical notes:

- Pick someone whose account is not about to be deleted or handed on. Moving the data
  later is possible but annoying.
- Check they have OneDrive space free. If their OneDrive fills up, saving silently
  stops working while reading keeps working, which is a confusing failure. The app
  will show a warning banner when this happens.

**Everything in Step 2 is done by that person, on that account.**

---

## Step 2 — First run (the folder owner)

1. Open **https://andrewmorrison42.github.io/fridge-list/** in a browser.

   Use a normal browser window, not private/incognito — the app remembers your
   sign-in, and private windows throw that away every time.

2. Tap **Sync options** in the top right.

3. Choose the option to sign in to OneDrive. You will be sent to Microsoft's sign-in
   page. Sign in with the account you chose in Step 1.

4. Microsoft will ask you to approve the permissions described above. Accept.

5. You will land back in the app. It will look for a folder called **FridgeList** in
   your OneDrive, not find one, and ask whether to create it. **Say yes.**

6. Give it a moment. The status line under the menu should say it has saved to
   OneDrive, with a time.

That is the setup done. To check it worked, open **onedrive.com** and look for a
**FridgeList** folder containing `recipes-data.json` and `shopping-list.json`.

> **Don't save the page to your computer and open the saved copy.** Sign-in only works
> from the real web address, and a saved copy never gets updates. Always use the link.

---

## Step 3 — Share the folder with the rest of the household

Still as the folder owner:

1. Go to **onedrive.com** and sign in.
2. Find the **FridgeList** folder.
3. Right-click it (or tap the ⋯ menu) → **Share**.
4. Enter each family member's Microsoft account email address.
5. **Make sure it is set to allow editing, not view-only.** This is the single most
   common setup mistake. If it is view-only, they will see the list but every tick
   they make will silently fail to save.
6. Send the invitations.

---

## Step 4 — Everyone else joins

Each other person does this once, on their own account.

**First, add a shortcut to the shared folder.** This is the step people miss, and
without it the app cannot find the folder.

1. Open **onedrive.com** and sign in with your own Microsoft account.
2. Click **Shared** in the left-hand menu.
3. Find the **FridgeList** folder that was shared with you.
4. Click it, then choose **Add shortcut to My files**.

   This does not copy anything or use your storage. It makes the shared folder appear
   in your own OneDrive so the app can find it.

**Then sign in to the app.**

5. Open **https://andrewmorrison42.github.io/fridge-list/**
6. **Sync options** → sign in to OneDrive → use your own account.
7. Approve the permissions.

You should see the household's recipes appear. If instead it offers to create a new
FridgeList folder, **say no** — that means the shortcut in step 4 is missing or the
share has not been accepted. Go back and do step 4 properly, then try again.

---

## Step 5 — Put it on your phone

The app works in a normal browser, but adding it to your home screen makes it open
like a proper app — full screen, no address bar, and it keeps working when the shop's
signal is bad.

Do this on every phone that will use it.

### iPhone / iPad

**Safari only.** Chrome on iPhone cannot add web apps to the home screen.

1. Open **https://andrewmorrison42.github.io/fridge-list/** in **Safari**.
2. Tap the **Share** button (the square with an arrow, at the bottom).
3. Scroll down and tap **Add to Home Screen**.
4. Name it *Fridge List* and tap **Add**.
5. Open it from the home screen and sign in there — the home screen version has its
   own separate sign-in from Safari's, so you will need to sign in once more.

### Android

1. Open **https://andrewmorrison42.github.io/fridge-list/** in **Chrome**.
2. Tap the **⋮** menu (top right).
3. Tap **Add to Home screen** or **Install app**.
4. Confirm.
5. Open it from the home screen. You may need to sign in again the first time.

### Laptop or desktop

You can just bookmark the address. If you want it as a proper window:

- **Chrome or Edge:** click the install icon in the address bar (a screen with a down
  arrow), or **⋮** → **Cast, save and share** → **Install page as app**.
- **Safari on Mac:** **File** → **Add to Dock**.

---

## Step 6 — Before the first real shop

Two minutes now saves a lot of irritation later.

1. **Open the app once on every phone while on wifi.** The first load fetches the app
   and stores it for offline use. Do this at home, not in the shop car park.
2. **Check everyone can tick something.** Have one person tick an item, and confirm it
   appears ticked on another phone within about five seconds. If it does not, see
   Troubleshooting.
3. **Check the version matches.** The version (e.g. `v21.5`) shows at the top of the
   Settings tab. If one phone is behind, close the app fully and reopen it.

---

## Everyday use

- **Start New Shopping List** — pick this week's recipes.
- **Review Shopping List** — the generated list, grouped by aisle. Tick as you shop.
  Two people can do this at once.
- **Wait List** — anything anyone notices you are low on. It joins the next list.
- **Menu list** — the week's meals; print it for the fridge.
- **Settings** — staples (things bought every week), and the ingredient list.

Ticks sync every few seconds while the Review tab is open. If you lose signal in the
shop, keep ticking anyway — it catches up when the signal returns.

---

---

## Getting things back when something goes wrong

Worth reading once now, so you know it exists before you need it.

There are **three** ways to recover, from quickest to most thorough.

### 1. "Put back", straight after a bulk delete

If you have just deleted a batch of recipes and immediately regretted it, go to
**Settings** and look under *Delete several recipes at once* — there is a **Put back**
button. One tap and they are all restored.

This only lasts while the app stays open. Close it or reload, and the button is gone —
use one of the two below instead.

### 2. The snapshot file

Every bulk delete writes a complete copy of your recipes into your FridgeList folder
first, named like `recipes-backup-2026-08-16-1432.json`. **If that snapshot cannot be
saved, the deletion does not happen at all** — the app tells you and stops.

To restore from one:

1. In the app, open **Sync options** → **Import data**.
2. Choose the backup file.
3. It replaces your recipes with the contents of that snapshot.

You can also just open **onedrive.com**, go to the **FridgeList** folder, and see the
snapshots sitting there. Tidy up old ones whenever you like — the app does not need
them.

### 3. OneDrive's own version history

This is the strongest one, and it covers **everything**, not just bulk deletes — a
recipe edited wrongly, an ingredient renamed by mistake, a shopping list that went
strange. OneDrive quietly keeps a copy of every version of every file.

1. Open **onedrive.com** and sign in as the person whose OneDrive holds the data.
2. Go into the **FridgeList** folder.
3. Right-click **`recipes-data.json`** (or tap the ⋯ menu) → **Version history**.
4. You will see a list of dated versions. Click one to look at it, or choose
   **Restore** to put it back.
5. Reopen the app on each device. It will pick the restored copy up within a few
   seconds.

> Restoring affects everyone, since it is the shared file. Tell the household before
> you do it, or you will confuse whoever is mid-shop.

`shopping-list.json` has its own version history in the same way, though that one
matters less — it is rebuilt every week anyway.

---

## Deleting a lot of recipes at once

**Settings → Delete several recipes at once.**

Deleting one at a time from the recipe editor is still the right tool for one or two.
This is for clearing out a batch, or for keeping only a handful.

1. Tap **Choose recipes**.
2. Search or filter by category, and tick the ones you mean.
3. Then either:
   - **Delete the ticked ones** — normal pruning.
   - **Keep ONLY the ticked ones** — for when you want a dozen out of hundreds. Tick
     the keepers, not the hundreds you are removing.
4. A confirmation appears listing the first ten recipes about to go and how many in
   total. **Type the number shown** to enable the button — this is deliberate, so a
   large delete cannot happen on a mis-tap.
5. The app saves a snapshot first. **If the snapshot fails, nothing is deleted.**

Two things to know:

- **It applies to everyone.** Recipes are shared, so a bulk delete reaches every
  device in the household within a few seconds.
- **It waits for saves to finish.** If a save is still going out, the app asks you to
  try again in a moment, rather than risk losing someone else's edit.

---

## Troubleshooting

**"It offers to create a new FridgeList folder, but one already exists"**

The shortcut from Step 4 is missing, or the share invitation was never accepted. Say
**no** to creating a folder, then go to onedrive.com → **Shared** → FridgeList → **Add
shortcut to My files**, and sign in to the app again.

If you accidentally said yes, you now have your own empty FridgeList folder that is
shadowing the shared one. Delete *your* FridgeList folder in onedrive.com (check it is
the empty one first), then add the shortcut properly.

**Ticks are not appearing on the other phone**

- Check both phones are signed in to the app, on the Review tab.
- Check the folder owner's OneDrive is not full. When it is, saving fails while
  reading still works, which looks exactly like one-way sync. The app shows a warning
  banner when a save fails — do not ignore it.
- Check the share is set to **allow editing**, not view-only.

**"Sign-in has expired" or it keeps asking me to sign in**

Open Sync options and sign in again. If it happens constantly, check you are not in a
private/incognito window, and that your browser is not set to clear site data on
close.

**Making a new Microsoft account keeps failing**

This is a Microsoft problem, not an app one, but it is common enough to be worth
listing:

- Try without a VPN.
- Try on mobile data rather than home broadband.
- Use a real mobile number for verification — internet phone numbers and some prepaid
  numbers are rejected without saying so.
- If it fails repeatedly, wait 24 hours. Repeated attempts from one address can
  trigger a temporary block that looks identical to the original error.

Or avoid it entirely: use an existing family member's account, as suggested in Step 1.

**The app will not load at all in the shop**

Once it has loaded successfully at least once on that phone, it should open offline.
If it never loaded on that phone before, it cannot. Open it at home on wifi first.

**Everything looks empty / my recipes have gone**

Don't add everything again. Check the top of the screen — if it says it is working
from this device's local copy and there is a sync warning, it has not reached OneDrive
yet. Check your connection and reopen. The data is still in OneDrive.

---

## If you later want your own independent copy

If you decide you would rather not depend on this deployment or its sign-in
registration continuing to exist, [Guide 2](SETUP-own-azure-registration.md) walks
through running the whole thing yourself. Your OneDrive data carries over — it is the
same folder and the same two files.
