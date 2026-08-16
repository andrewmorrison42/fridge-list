# Guide 2 — Run your own copy end to end

About an hour. You will end up with your own copy of the app, at your own web address,
with your own Microsoft sign-in registration. Nothing in your setup will depend on
anyone else's account continuing to exist.

**Most people do not need this.** If you just want the app for your family, use
[Guide 1](SETUP-use-the-app.md) — it takes ten minutes and your data is already in
your own OneDrive either way.

## Should you do this?

Do Guide 2 if:

- You want to **change the app** — your own recipes baked in, different features.
- You are uneasy relying on **someone else's sign-in registration**. In Guide 1 the
  sign-in goes through a registration owned by this repository's author. If that were
  ever deleted, everyone using it would be signed out until they moved to their own.
- You want to **give the app to people outside your household**. Asking them to grant
  broad OneDrive access to a stranger's registration is a real thing to ask; asking
  them to run their own copy is not.

Stay with Guide 1 if you just want a shopping list. Your data is in your OneDrive
either way — this changes who owns the *sign-in* and the *hosting*, not the data.

**One thing to know before you start:** the Microsoft registration you create cannot
be transferred to another account later. If you lose access to the account that owns
it, everyone using your copy is signed out and you have to make a new one and tell
them all to sign in again. Use an account you will keep.

You will need:

- A **GitHub account** (free) — [github.com/signup](https://github.com/signup)
- A **Microsoft account** — the same kind as Guide 1
- A laptop or desktop. This part is genuinely awkward on a phone.

---

## Part 1 — Take your own copy of the code ("forking")

A *fork* is your own copy of someone else's project, in your own GitHub account. You
can change it freely; the original is untouched.

1. Sign in to GitHub.
2. Go to **https://github.com/andrewmorrison42/fridge-list**
3. Click **Fork** (top right).
4. Leave the name as `fridge-list` unless you have a reason to change it. **If you do
   rename it, write the new name down** — your web address depends on it, and so does
   a setting in Part 3.
5. Click **Create fork**.

You now have `https://github.com/YOUR-USERNAME/fridge-list`.

> The recipes that come with it are the original author's family recipes. Keep them,
> or delete them from within the app once you are running — Settings has an ingredient
> list, and recipes can be removed on the All Recipes tab.

---

## Part 2 — Publish it as a website (GitHub Pages)

GitHub can host your copy as a real website, free.

1. In **your fork**, click **Settings** (along the top of the repository, not your
   account settings).
2. In the left-hand menu, click **Pages**.
3. Under **Build and deployment**:
   - **Source:** `Deploy from a branch`
   - **Branch:** `main`, folder `/ (root)`
4. Click **Save**.
5. Wait a minute or two, then refresh the page. It will show your address:

   ```
   https://YOUR-USERNAME.github.io/fridge-list/
   ```

6. Open that address. The app should load. **It will not sign in to OneDrive yet** —
   that is Part 3.

**Write this address down exactly, including the trailing slash.** You need it
character for character in Part 3.

> If the page shows a 404 after a few minutes, check that a file called `.nojekyll`
> exists at the top level of your fork. It should have come with the fork. Without it
> GitHub can mangle the site.

---

## Part 3 — Create your own Microsoft sign-in registration

This is the fiddly part. Go slowly and check each screen. Microsoft renames things in
this portal regularly, so menu names may differ slightly from what is written here —
the shape of the task is stable.

1. Go to **https://portal.azure.com** and sign in with the Microsoft account that
   should own this. (This can be the same account whose OneDrive holds the data, or a
   different one — it does not matter, but see the warning above about keeping access
   to it.)

2. In the search bar at the top, type **Microsoft Entra ID** and open it. Older
   accounts may still show this as *Azure Active Directory* — same thing.

3. In the left-hand menu, click **App registrations**, then **New registration**.

4. Fill in the form:

   - **Name:** anything you will recognise, e.g. `Fridge List`.
   - **Supported account types:** choose
     **"Accounts in any organizational directory (Any Microsoft Entra ID tenant –
     Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)"**.

     This matters. Anything narrower and ordinary `outlook.com` / `hotmail.com`
     accounts will not be able to sign in. The app is configured for this setting and
     will not work with the others.
   - **Redirect URI:** leave it blank for now. It has to be added as a specific type,
     which is the next step.

5. Click **Register**.

6. You will land on the **Overview** page. Find **Application (client) ID** — a long
   string like `9d7d9cf4-053d-441c-a4c6-c0a07f6dbae3`. **Copy it somewhere.** You need
   it in Part 4.

   This is not a password. It is fine for it to be visible in your published code —
   it identifies the app, it does not authorise anything on its own.

7. In the left-hand menu, click **Authentication**, then **Add a platform**.

8. Choose **Single-page application**.

   **Not "Web".** This is the most common mistake here. "Web" assumes there is a
   server behind the app, and sign-in will fail with an error about the request being
   from a client-type application. There is no way to convert one into the other — if
   you pick wrong, delete the platform entry and add it again.

9. In **Redirect URIs**, enter your GitHub Pages address from Part 2, exactly,
   **including the trailing slash**:

   ```
   https://YOUR-USERNAME.github.io/fridge-list/
   ```

   Click **Configure**.

10. In the left-hand menu, click **API permissions**, then **Add a permission**.

11. Choose **Microsoft Graph**, then **Delegated permissions**.

    Delegated means "acting as the signed-in person, with what they can already
    reach". *Application permissions* is the other option — that is for background
    services with their own independent access, needs an administrator to approve, and
    is not what this app uses.

12. Search for and tick each of these two:

    - **`Files.ReadWrite.All`**
    - **`User.Read`**

    Click **Add permissions**.

    `User.Read` is used to show which account is signed in.
    `Files.ReadWrite.All` is the broad one — Guide 1 explains
    [why it is needed and what it means](SETUP-use-the-app.md#what-you-are-agreeing-to-when-you-sign-in);
    the same applies to your copy. Now you are the one asking your family for it.

13. You do **not** need to click *Grant admin consent*. Each person consents for
    themselves the first time they sign in.

**Before moving on, check you have:**

- [ ] The **Application (client) ID** copied down
- [ ] Your Pages address registered under **Single-page application**, with the
      trailing slash
- [ ] Both **`Files.ReadWrite.All`** and **`User.Read`** listed as **Delegated**

---

## Part 4 — Point your copy at your registration

Exactly one line changes. You can do this entirely on the GitHub website — no
software to install.

1. Go to your fork: `https://github.com/YOUR-USERNAME/fridge-list`
2. Click on **`index.html`** in the file list.
3. Click the **pencil icon** (top right of the file view) to edit.
4. Press **Ctrl+F** (**⌘F** on a Mac) and search for `MSAL_CLIENT_ID`.

   You are looking for this line, near line 315:

   ```js
   const MSAL_CLIENT_ID = '9d7d9cf4-053d-441c-a4c6-c0a07f6dbae3';
   ```

5. Replace **only the part between the quotes** with your own Application (client) ID
   from Part 3:

   ```js
   const MSAL_CLIENT_ID = 'your-client-id-goes-here';
   ```

   Keep the quotes and the semicolon.

6. Scroll to the bottom, or click **Commit changes**. Add a short note like
   `Use my own app registration` and click **Commit changes** again.

7. Wait a minute or two for GitHub to republish, then open your Pages address.

**That is the only edit needed.** In particular:

- **Do not** change the redirect URI in the code. The app works it out from whatever
  address it is being served at, which is why it works on both your laptop and your
  phone without configuration. It just has to match what you registered in Part 3.
- **Do not** change the `authority` line. It is already set to accept both personal
  and work Microsoft accounts, matching the account type you chose in Part 3.

---

## Part 5 — Set up your household

From here it is identical to Guide 1, using **your** address instead:

```
https://YOUR-USERNAME.github.io/fridge-list/
```

Follow [Guide 1 from Step 1 onwards](SETUP-use-the-app.md#step-1--decide-whose-onedrive-holds-the-data):

- Decide whose OneDrive holds the data
- That person signs in first and lets it create the **FridgeList** folder
- Share the folder with everyone, **with editing allowed**
- Everyone else adds a **shortcut to My files**, then signs in
- Add it to each phone's home screen
  ([iPhone](SETUP-use-the-app.md#iphone--ipad) /
  [Android](SETUP-use-the-app.md#android))

---

## Keeping up with changes to the original

Your fork is frozen at the point you copied it. To pull in later fixes:

1. Go to your fork's main page on GitHub.
2. If the original has moved on, you will see **"This branch is N commits behind"**.
3. Click **Sync fork** → **Update branch**.

Your one-line client ID change is preserved — GitHub merges the incoming changes
around it. If it ever reports a conflict on that line, keep **your** client ID.

There is no obligation to update. The app works offline and does not phone home.

---

## Troubleshooting

**"The redirect URI specified in the request does not match"**

The address registered in Part 3 does not exactly match where the app is served from.
Check for:

- a missing or extra trailing slash
- `http://` instead of `https://`
- a different repository name than the one in the address
- capital letters — GitHub usernames are case-insensitive in the address bar but the
  redirect URI comparison is not forgiving; use lower case throughout

**An error mentioning a "cross-origin token redemption" or client-type problem**

The platform was added as **Web** instead of **Single-page application**. Go to
**Authentication**, delete that platform entry, and add it again as
**Single-page application**.

**Personal Microsoft accounts cannot sign in, work accounts can**

The **Supported account types** in Part 3 step 4 was set too narrowly. On the
registration's **Authentication** page you can change the supported account types; set
it to include personal Microsoft accounts.

**"Need admin approval"**

You are signing in with a work or school account whose administrator restricts which
apps staff may consent to. Use a personal Microsoft account instead, or ask that
administrator.

**GitHub Pages shows a 404**

- Check **Settings → Pages** still shows branch `main`, folder `/ (root)`.
- Check `.nojekyll` exists at the top level of the repository.
- Give it five minutes after the first save; the first publish is the slowest.

**Azure asks for payment details or to upgrade**

App registrations of this kind do not need a paid Azure subscription. That prompt is
about the wider Azure platform, not your registration. Do not delete the directory or
registration in response to it — your published app has the client ID baked in, and
losing it means everyone must sign in again against a new one.

**Everything worked, then stopped for everyone at once**

Almost always the registration. Check you can still sign in to portal.azure.com with
the owning account, and that the app registration still exists with its redirect URI
and permissions intact.

---

## What you now own

- **The code** — your fork. Survives anything happening to the original.
- **The hosting** — your GitHub Pages address.
- **The sign-in** — your Entra registration. Keep access to the account that owns it.
- **The data** — the FridgeList folder in your chosen OneDrive.

Nothing in that list depends on anyone else.
