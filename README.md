# LockedIn Group: MNQ Homework Tracker

A website for trading accountability groups. Members sign in with Discord, join a group with its join code,
and tick **only their own** homework boxes. Batko is the app owner; each group has its own owner.

| File | What it is |
|---|---|
| `web/` | The whole website (Next.js). GitHub builds it and puts it online by itself; see `web/README.md` |
| `web/src/config.ts` | Your Supabase address + public key (step 3) |
| `supabase/setup.sql` | Creates the database and all security rules (step 2) |
| `supabase/import-old-ticks.sql` | Copies your ticks from the old claude.ai page (step 2) |
| `supabase/make-me-admin.sql` | Makes you the admin (step 8) |
| `supabase/update-2-screenshots.sql` | Adds journal screenshots (run once, after setup.sql) |
| `supabase/update-3-excused.sql` | Adds excused days (run once, after update 2) |
| `supabase/update-4-avatars.sql` | Shows members' Discord profile pictures (run once, after update 3) |
| `supabase/update-5-notrade-reflection.sql` | No-trade days + weekly reflections (run once, after update 4) |
| `supabase/update-6-rulebreaks-settings.sql` | Rule-break tags + personal settings like light/dark mode (run once, after update 5) |
| `supabase/update-7-custom-rulebreaks.sql` | Lets members add their own rule-break tags (run once, after update 6) |
| `supabase/update-8-long-notes.sql` | Removes the 140-character note limit (run once, after update 7) |
| `supabase/update-9-groups.sql` | Many groups: join codes, group owners, group settings (run once, after update 8) |
| `supabase/update-10-reminders.sql` | Reminder notifications (run once, after update 9; see "Reminders" below) |
| `supabase/update-11-your-data.sql` | Download my data and Delete my account (run once, after update 10) |
| `supabase/update-12-lockdown.sql` | Signed-out visitors can't use the database's helper functions (run once, after update 11) |
| `supabase/update-13-accept-terms.sql` | Everyone accepts the Terms once; saves when (run once, after update 12, before pushing) |
| `supabase/update-14-photos-results.sql` | Up to 10 pictures per day, and a day result: win, loss or gamble (run once, after update 13, before pushing) |
| `supabase/update-15-reports-recaps-owner.sql` | Reporting pictures and notes, Discord recaps, moving a group to a new owner (run once, after update 14, before pushing) |
| `supabase/update-16-cleanup-alerts-reactions.sql` | Pictures deleted after 60 days, owner alerts, reactions (run once, after update 15, before pushing; then paste the new `send-reminders` code into Supabase) |
| `supabase/update-17-one-tap-approve.sql` | Approving someone is one tap; their name comes from Discord (run once, after update 16, before pushing) |
| `supabase/update-18-discord-names.sql` | Names follow Discord: a new Discord name updates your name in your groups (run once, after update 17, before pushing) |
| `supabase/update-19-pnl-rr.sql` | P&L and R for each day, optional (run once, after update 18, before pushing) |
| `supabase/update-20-request-alerts.sql` | The app owner gets a notification for new group requests (run once, after update 19; no push needed) |
| `supabase/sign-out-everyone-except-owner.sql` | Signs everyone but you out; no data is removed (run when needed) |
| `web/public/assets/app-day.jpg` | Screenshot of the app with a made-up demo group, shown in the phone on the front page |
| `web/public/vendor/` | Fonts and their licenses, hosted on our own site (see `web/public/vendor/THIRD-PARTY-NOTICES.md`) |
| `supabase/functions/send-reminders/index.ts` | Sends the reminders. Lives in Supabase (Edge Functions), not on the website |
| `web/public/sw.js` | Background helper: the app opens without internet, and shows reminders |
| `web/public/manifest.webmanifest`, `web/public/icons/` | App icon for "Add to Home Screen" |
| `web/public/CNAME` | The site's address: lockedingroup.app (DNS is at Porkbun) |
| `.github/workflows/deploy-web.yml` | Builds `web/` and puts it on GitHub Pages after every push to main |
| Privacy policy and Terms | Pages inside the website (`?p=privacy`, `?p=terms`). The contact email comes from `contactEmail` in `web/src/config.ts` |
| `secrets/` | Your private reminder key. **Never uploaded** (git ignores it). Don't share it |
| `tests/` | Checks every database rule and the reminder sender (see the first line of each file for how to run) |

**Who can do what** (enforced by the database itself, so it can't be bypassed from the website):

- Not signed in: nothing.
- Signed in, in no group: can type a join code, or ask for a group of their own.
- Waiting in a group: sees only that group's name.
- Member: sees only their own group(s). Ticks **only their own row**, **only while the day is open**.
- Group admin (picked by the group owner): approves people, adds/renames names, excuses days, fixes ticks, in that group only.
- Group owner: all of the above, plus that group's settings (name, color, logo, homework boxes, points, cutoff time, time zone),
  its join code, and who its group admins are.
- App owner (you): everything in every group. Approves group requests, creates, pauses and deletes groups, hands a group to a new owner.
- Groups can never see each other's names, ticks, notes, pictures or reflections.

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
2. Copy the **Project URL** (looks like `https://abcd1234.supabase.co`) → paste into `web/src/config.ts` in place of `PASTE_PROJECT_URL_HERE`.
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
3. On github.com, open the repo → **Settings** → **Pages** → Source: **GitHub Actions**. The next push to main builds and publishes the website (watch it under **Actions**).
4. After about a minute the page shows your address: `https://YOUR-GITHUB-NAME.github.io/lockedin-group/`. Copy it.

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
Post the website link (https://lockedingroup.app) in the Discord channel. When someone signs in, they show up in **Admin → Waiting for approval** (with a red number on the Admin tab). Pick their name → **Approve**.

---

## Publishing changes (GitHub Desktop)

This folder is connected to GitHub, with a history of every change. Use this instead of uploading files on github.com.

1. Open **GitHub Desktop** → **File → Add Local Repository** → choose this `mnq-homework` folder → **Add Repository** (only the first time).
2. Saved changes show under **History**. Click **Push origin** (top right). The website updates in about a minute.
3. **Something broke?** **History** → right-click the change that broke it → **Revert Changes in Commit** → **Push origin**. The site goes back to how it was.

If you ever do upload on github.com again, click **Fetch origin** → **Pull origin** in GitHub Desktop afterwards, so both stay the same.

## Reminders (one-time setup)

Members get a notification if their homework isn't done before the day closes (they pick 30 min, 1, 2 or 3 hours before).

1. **Database:** Supabase → **SQL Editor** → **New query** → paste everything from `supabase/update-10-reminders.sql` → **Run**.
   - If it says `pg_cron` or `pg_net` isn't available: **Database → Extensions** → switch on **pg_cron** and **pg_net** → run it again.
2. **The sender:** Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**.
   Name it exactly `send-reminders`, delete the example code, paste everything from `supabase/functions/send-reminders/index.ts` → **Deploy**.
   Then open the function → **Details** (or Settings) → switch **off** "Enforce JWT verification" / "Verify JWT" → **Save**.
   *(Safe: calling it can only send reminders that are due anyway, once.)*
3. **The keys:** Supabase → **Edge Functions** → **Secrets** → add these three, copying name and value from `secrets/reminder-keys.txt` on your computer:
   `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` → **Save**. Never paste the private key anywhere else.
4. **Publish** the website (see above).
5. **Try it:** Me → Settings → Reminders → switch on → **Allow**. You get a "Reminders are on" notification.
   - **iPhone:** reminders only work in the app from the Home Screen (Safari → Share → Add to Home Screen), iOS 16.4 or newer.
   - Check the sender: Supabase → Edge Functions → send-reminders → **Logs**. Every 5 minutes it runs and shows how many were sent.

## Without internet

The app keeps a copy of the website and of the last loaded group on each phone, so it opens without internet.
Ticks made offline are kept on the phone and upload when the connection is back (a yellow bar shows this).
If the day closed before they're back online, the tick can't be saved, and the app says so.
Pictures need internet. Signing out removes the saved copy from that phone.

---

## Day-to-day
- **Switch group:** tap the group name at the top.
- **Invite people:** Admin → Join code → Copy, post it in the group's Discord. They show up under "Waiting for approval".
- **Approve someone:** Admin → choose their name → Approve. One Discord account per name.
- **Someone wants their own group:** they tap "Start your own group". You see it in Admin → All groups → Approve. They become its owner.
- **Pause / delete a group, change its owner:** Admin → All groups (only you see this).
- **Group settings** (owner): Admin → Group settings → Save settings.
- **Remove someone's access:** Admin → Approved → Remove access.
- **Excuse a day** (sick, travelling): open that person's ✎ panel on that day → Admin → switch **Excused** on.
- **Supabase free plan pauses after 7 days with no visits.** Daily use prevents it; if it ever happens, open supabase.com → your project → **Restore**.
- **Free plan storage is 1 GB for pictures.** Plenty for a few groups; check Supabase → Storage now and then.
