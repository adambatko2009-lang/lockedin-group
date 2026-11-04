# MNQ Homework Tracker

A website where each member signs in with Discord and ticks **only their own** homework boxes.
Batko approves new people and is the only admin.

| File | What it is |
|---|---|
| `index.html` | The whole website |
| `config.js` | Your Supabase address + public key (step 3) |
| `supabase/setup.sql` | Creates the database and all security rules (step 2) |
| `supabase/import-old-ticks.sql` | Copies your ticks from the old claude.ai page (step 2) |
| `supabase/make-me-admin.sql` | Makes you the admin (step 8) |

**Who can do what** (enforced by the database itself, so it can't be bypassed from the website):

- Not signed in: nothing.
- Signed in but not approved: sees only "Waiting for approval".
- Approved member: sees everything. Ticks **only their own row**, and **only while the day is open** (until 09:00 New York on the next trading day).
- Admin (you): approves people, adds/renames/removes members, can fix anyone's ticks on any day.

**Nobody but you can change the website or its rules.** The code is in your GitHub account and the database is in your Supabase account; members can't edit either, and neither can their Claude.

---

## Setup checklist (about 20–30 minutes, do in order)

### 1. Create the database (Supabase)
1. Go to <https://supabase.com> → **Start your project** → sign up (easiest: **Continue with GitHub**).
2. **New project** → Name: `mnq-homework` → **Generate a password** (save it in your password manager; you won't need it day to day) → Region: **Central EU (Frankfurt)** or **North EU (Stockholm)** → **Create new project**. Wait ~2 minutes.

### 2. Load the security rules and your old ticks
1. Left menu → **SQL Editor** → **New query**.
2. Open `supabase/setup.sql` from this folder, copy everything, paste it in → **Run**. You should see "Success. No rows returned".
3. **New query** again → paste everything from `supabase/import-old-ticks.sql` → **Run**.

### 3. Connect the website to the database
1. Left menu → **Project Settings** (gear) → **API Keys** (or **Data API**).
2. Copy the **Project URL** (looks like `https://abcd1234.supabase.co`) → paste into `config.js` in place of `PASTE_PROJECT_URL_HERE`.
3. Copy the **Publishable key** (starts with `sb_publishable_`), or if you only see **anon public**, copy that → paste in place of `PASTE_ANON_PUBLIC_KEY_HERE`. Save the file.
   - This key is *meant* to be public. The **secret / service_role** key must **never** go in any file.

### 4. Create the Discord login
1. Supabase: left menu → **Authentication** → **Sign In / Providers** → **Discord**. Copy the **Callback URL** shown there (ends in `/auth/v1/callback`). Leave this tab open.
2. New tab: <https://discord.com/developers/applications> → **New Application** → name `MNQ Homework` → tick the box → **Create**.
3. Left menu **OAuth2**:
   - Copy **Client ID**.
   - **Reset Secret** → **Yes, do it!** → copy the **Client Secret**.
   - Under **Redirects** → **Add Redirect** → paste the Callback URL from step 4.1 → **Save Changes**.
   *(No bot, no server invite. This only lets people prove who they are.)*
4. Back in Supabase (Discord provider): switch **Enable Sign in with Discord** on → paste **Client ID** and **Client Secret** → **Save**.

### 5. Put the website online (GitHub Pages)
1. GitHub Desktop → **File → Add Local Repository** → choose this `mnq-homework` folder → if asked, **create a repository** here.
2. Summary: `First version` → **Commit to main** → **Publish repository** → untick **Keep this code private** → **Publish**.
3. On github.com, open the repo → **Settings** → **Pages** → Source: **Deploy from a branch** → Branch: **main**, folder **/ (root)** → **Save**.
4. After about a minute the page shows your address: `https://YOUR-GITHUB-NAME.github.io/mnq-homework/`. Copy it.

### 6. Tell Supabase your website's address
Supabase → **Authentication** → **URL Configuration**:
- **Site URL**: paste your website address → **Save**.
- **Redirect URLs** → **Add URL** → paste the same address → **Save**.

### 7. Sign in yourself FIRST
Open your website → **Sign in with Discord** → **Authorize**. You'll see "Waiting for approval". That's expected.
**Do this before you share the link**: the next step makes the *first* account that signed in the admin.

### 8. Make yourself admin
Supabase → **SQL Editor** → **New query** → paste everything from `supabase/make-me-admin.sql` → **Run**.
The result should show one row with your Discord name. Reload the website: you're in, with an **Admin** tab.

### 9. Share it
Post the website link in the Discord channel. When someone signs in, they show up in **Admin → Waiting for approval** (with a red number on the Admin tab). Pick their name → **Approve**.

---

## Day-to-day
- **Approve someone:** Admin → choose their name → Approve. One Discord account per name.
- **Remove someone's access:** Admin → Approved → Remove access.
- **Add / rename / remove a member:** Admin → Members. Removing hides them but keeps their history.
- **Fix a mistake:** as admin you can tick or untick anyone on any day.
- **Change the rules or points:** edit the top of the `<script>` in `index.html` (RULES, POINTS) on GitHub, or ask Claude in this project.
- **Supabase free plan pauses after 7 days with no visits.** Daily use prevents it; if it ever happens, open supabase.com → your project → **Restore**.
