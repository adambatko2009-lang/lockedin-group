# LockedIn: how to work on this project

Read this whole file before changing anything. It is written so that any model can pick up the work
and do it the way it has been done so far.

## 1. What this is

LockedIn (https://lockedingroup.app) is a free homework tracker for small Discord trading groups
(about 3 to 15 friends). Each group picks its daily boxes (by default chart with execution, journal, HTF),
every member ticks their own boxes before the group's cutoff, and the whole group sees who did.
It is group accountability, not a trading journal. `PRODUCT.md` has the full product description.

The owner is Batko (Adam, 17). He is not a programmer. He reads what you write, runs SQL by pasting it
into Supabase, and publishes by clicking Push origin in GitHub Desktop. Real groups use the live site
every trading day, so a mistake reaches real people within a minute of his push.

## 2. How it is built

- **Website:** Next.js 16 + React 19 + TypeScript in `web/`, built as a static export (`output: "export"`).
  There is no server. GitHub Pages serves the plain files in `web/out`.
- **The app is one file.** `web/src/engine/engine.ts` (about 3,800 lines) is the whole app. React only puts an
  empty skeleton on the page (`page.tsx`); `Boot.tsx` then imports the engine once, and the engine draws
  every screen itself by building HTML strings and patching them into `#app`, `#rail`, `#topbar` and `#tabbar`.
  There are no React components for app screens and no React state.
- **Database:** Supabase (Postgres) project `awpyovkucwteyzsqcazl`. Sign-in is Discord only. Every rule about who
  may see or change what is enforced in the database with row-level security, never only in the website.
- **Publishing:** every push to `main` runs `.github/workflows/deploy-web.yml` (`npm ci`, `npm run build`,
  publish `web/out`). Nobody builds or uploads by hand.
- **Offline:** `web/public/sw.js` keeps a copy of the site on the phone. The engine keeps the last loaded group in
  IndexedDB and ticks made offline in a localStorage "outbox" that uploads later.
- **Background job:** the Supabase Edge Function `supabase/functions/send-reminders/index.ts` runs every 5 minutes.
  Notifications were removed (update 22), but the job still deletes pictures older than 60 days, which the
  privacy policy promises. Do not remove the function, its schedule, the `VAPID_*` keys or the push tables.

## 3. Map

The session usually starts in the parent folder `/Users/adambatko/claude code/`. It holds:

| Path | What it is |
|---|---|
| `mnq-homework/` | **The project.** The only git repository (GitHub `adambatko2009-lang/lockedin-group`) |
| `.claude/launch.json` | Preview servers. `lockedin-web-dev` (port 8773) is the one to use. The others are old |
| `.claude/hooks/block-secrets.sh`, `.claude/settings.json` | Blocks every tool call that touches a `secrets/` folder |
| `.claude/skills/sql-update/SKILL.md` | The exact recipe for a database update. Follow it for every SQL change |
| `lockedin-support/` | `faq.md` and instructions for the email-draft agent. Not part of the website |
| `mnq-homework-preview/` | Old screenshots, and `seed.js` (a pretend group written for the old single-file site) |

Inside `mnq-homework/`:

| Path | What it is |
|---|---|
| `web/src/engine/engine.ts` | The whole app. Sections are marked with `// ------ name` lines; search for those |
| `web/src/app/globals.css` | Every style. Color and font variables are at the top |
| `web/src/app/layout.tsx` | The `<head>`: Content-Security-Policy, icons, fonts, the theme script |
| `web/src/app/page.tsx` | The page skeleton. The engine looks elements up by these ids, so never rename them |
| `web/src/config.ts` | Supabase address, the public key, the contact email. The public key is meant to be public |
| `web/public/` | `sw.js`, icons, `manifest.webmanifest`, `CNAME`, self-hosted fonts and licenses in `vendor/` |
| `web/scripts/csp-first.mjs` | Runs after the build: moves the security policy to the top of each page |
| `web/out/`, `web/.next/` | Build output. Ignored by git. Never edit or commit |
| `supabase/setup.sql`, `supabase/update-N-*.sql` | The database, as numbered updates Batko has already run (2 to 23) |
| `supabase/functions/send-reminders/index.ts` | The every-5-minutes job (see above) |
| `tests/security-test.mjs` | Loads every SQL file into an in-memory Postgres and tries to break the rules |
| `tests/push-test.mjs` | Tests the Edge Function |
| `.claude/agents/reviewer.md`, `tester.md` | The review and test steps (see section 5) |
| `README.md` | Batko's guide: file table, who can do what, setup and day-to-day steps |
| `PRODUCT.md`, `.impeccable/` | Product notes and past design reviews. Local only, ignored by git |
| `secrets/` | Private keys. Off limits. Never open, list, search or mention its contents |

## 4. Commands

Run these from `mnq-homework/`. All four passed on 13 November 2026 (423 and 14 checks).

```bash
cd web && npx tsc --noEmit        # type check, about 1 second
cd web && npm run build           # build + csp-first; must end with "csp-first: policy moved to the top of 3 page(s)"
cd tests && node security-test.mjs 2>&1 | tail -25    # database rules; must end with "N passed, 0 failed"
cd tests && node push-test.mjs    # Edge Function; must end with "14 passed, 0 failed"
```

- If `web/node_modules` is missing: `cd web && npm ci`.
- If `tests/node_modules` is missing: `cd tests && npm install --no-save @electric-sql/pglite@0.2.17 http_ece@1.2.0`.
- **See the site:** start the preview server named `lockedin-web-dev` (http://localhost:8773). Without a preview
  tool: `cd web && npx next dev -p 8773`. Never start a second copy if one is running.
- There is no lint command and no unit-test framework. Do not add one unasked.
- The GitHub CLI is at `~/.local/bin/gh` (use the full path). After Batko says "Pushed", one
  `~/.local/bin/gh run list -R adambatko2009-lang/lockedin-group -L 3` shows the build. Check once. Never poll in a loop.

**What the local preview can and cannot show.** Signed out, it shows the front page, its "try it yourself" demo,
and the legal pages (`?p=privacy`, `?p=terms`, `?p=why`, `?p=how`, `?p=features`). You cannot sign in locally:
Supabase only allows sign-in redirects to lockedingroup.app, and you must not change that or type anyone's
credentials. So signed-in screens (Today, Week, Ranking, Me, Admin) cannot be opened locally. When a change is
there, check it by reading the code path carefully, say plainly that you could not see it live, and tell Batko
exactly what to look at after he pushes.

## 5. How a task goes

1. **Plan.** Say in plain words what will change and in which files. For anything bigger than a one-line fix,
   wait for Batko to say yes before writing code.
2. **Build.** Make the smallest change that does the job. Do not tidy, rename or restructure nearby code.
3. **Review and test.** How much depends on the size:
   - **Small** (style, copy or layout in one or two files, nothing about data or security): run the type check and
     the build yourself and look at the page once.
   - **Big** (anything in `supabase/`, sign-in, who can see or change what, a new feature, more than a few files):
     run the `reviewer` agent, fix everything it finds, run it again, then run the `tester` agent. If those agents
     are not available in your session, read `.claude/agents/reviewer.md` and `tester.md` and do every step in
     them yourself, or hand each file's text to a general subagent.
   - Unsure which? Treat it as big.
4. **Commit** on `main` with a message like the existing ones: `Area: what changed` in plain words, a short
   plain body if needed, then the attribution line your session gives you. **Never push.** Batko pushes.
5. **Report.** One sentence on what changed, then "Your steps:" as a short numbered list (for example: paste the
   SQL in Supabase and run it, then click Push origin). No long technical report.

Keep it cheap: read pages as text instead of taking screenshots where you can, do not re-check that a push went
live unless asked, and suggest a new chat when a task is finished.

## 6. Coding rules

**The engine**
- Screens are functions that return an HTML string (`renderDay`, `renderWeek`, `renderAdmin`, ...). `render()`
  picks one and `morph()` patches the page, so pictures and focus do not flicker. Add to that pattern. Do not add
  React components, hooks, a state library or a router for app screens.
- **Every piece of text that came from a person or the database goes through `esc()`** before it enters an HTML
  string: names, group names, notes, comments, error messages. Notes with links use `linkify()`. Forgetting this
  lets one member run code in another member's browser.
- Clicks are handled by the one `document.addEventListener("click", ...)` in the "events" section, keyed by
  `data-*` attributes and ids on buttons. Add a branch there. Listeners attached to elements inside `#app` are
  lost on the next redraw.
- State is the module-level variables in the "state" section (`ticks`, `members`, `gid`, `tab`, `screen`, ...).
  Change the state, then call `render()`. For redraws nobody asked for (live updates, timers) call
  `scheduleRender()` or `autoRender()`, which will not wipe a form an owner is typing in.
- Change a tick only through `editTick(day, key, row => ...)`. It checks `canEdit`, combines quick taps into one
  save, and falls back to the offline outbox. Never write to the `ticks` table another way.
- Dates: use the helpers in the "dates" section (`currentTradingDay`, `isTradingDay`, `nextTrading`, `closesAt`,
  `isFinal`, `nyMoment`, `fmtDay`). Day keys are `"YYYY-MM-DD"` strings in the group's time zone. Never use the
  device's local date. These helpers must agree with `current_trading_day(group)` in the SQL, or the app and the
  database disagree about which day is open.
- Supabase returns at most 1,000 rows per request. Lists that can grow use `fetchAll()`.
- Wrap `localStorage` use in `try/catch` (private mode throws). Existing keys: `accent`, `group`, `tab`,
  `mnq-settings`, `outbox`, `lockedin.intent`, `draft:*`, `badges:*`.
- Constants that mirror the database: `SLOTS` (six fixed box columns) and `BREAKS` (must match update 6).
- `canEdit`, `isAdmin` and friends only decide what to show. They are not security. See section 7.
- TypeScript is loose here on purpose (`strict: false`, `dom-loose.d.ts`) because the engine was moved over from
  plain JavaScript. Do not switch `strict` on or retype old code. Give new code real types.
- Comments say why, in plain words Batko can follow, like the ones already there.

**The website shell**
- Static export only: no API routes, server actions, middleware, `next/headers`, or new routes. Pages are
  `?p=name` views drawn by the engine (`LAND_PAGES`).
- Asset paths are relative with no leading slash (`icons/icon-192.png`, `vendor/fonts.css`), so the site also
  works inside a sub-folder.
- **Never loosen the Content-Security-Policy** in `layout.tsx`. That means no CDN scripts, Google Fonts,
  analytics, embeds or remote images beyond Supabase and Discord avatars. Fonts stay in `web/public/vendor`.
- Dependencies are pinned to exact versions. Do not add or upgrade a package without asking. A new one also needs
  its license in `web/public/vendor/licenses` and a line in `THIRD-PARTY-NOTICES.md`.
- If the `FILES` list in `web/public/sw.js` or a file in it changes, raise `VERSION` (`lockedin-12` now), or
  phones keep the old copy.
- If the wording of the Privacy policy or Terms changes, ask Batko whether to change `TERMS_VERSION` in the
  engine. Changing it makes every member accept again.

## 7. Database rules

- **Use the recipe in `.claude/skills/sql-update/SKILL.md`** (in the parent folder) for every database change.
  In short: a new file `supabase/update-<N+1>-<short-name>.sql` that is safe to run twice, a new row in
  `README.md`, a new block in `tests/security-test.mjs`, all tests passing, then `pbcopy < file` so the SQL is on
  Batko's clipboard. The next number is 24. Sort by number (`ls supabase | sort -V`), not by text.
- **Never edit `setup.sql` or an existing `update-N` file.** They have already run on the real database, so an
  edit changes nothing there and makes the tests lie.
- **Never run SQL against the real database**, and never put the `service_role` or secret key in any file.
  Only the public key in `web/src/config.ts` exists in this project.
- The rules that must always hold, each one enforced in SQL and proven by a test:
  signed-out visitors can do nothing; members see only their own group; a member changes only their own row and
  only while that day is open; only the group owner (and admins the owner picked) approves people and changes
  settings; nobody joins without approval; groups never see each other's names, ticks, notes, pictures,
  comments or reflections.
- New tables: row-level security on, with policies. New functions: `set search_path = public`, check the caller
  with `auth.uid()`, `revoke` from `public, anon`, grant to `authenticated` only where members need it.
- Test what must be refused as well as what must work: a normal member, a member of another group, a signed-out
  visitor, and running the file a second time.
- If Batko must run SQL before the website change works, say so in his steps, in the right order
  (SQL first, then push). If there are two things to paste, copy the second only after he says the first is done.

## 8. Design and copy rules

Batko's rule: the site must look hand-made and trustworthy, never "vibe-coded".

**Never use:** purple gradients, pill-shaped buttons, fake reviews, fake numbers or customer counters, invented
quotes, vague hero text, emoji as icons, em dashes, exclamation marks in the interface, over-the-top scroll
animations, anything that follows the cursor, glows, confetti, AI stock photos, AI-sounding filler, small capital
labels above headings, a "Made with AI" tag.

**Do:**
- Use the variables at the top of `globals.css` (`--bg`, `--card`, `--line`, `--text`, `--text-2`, `--muted`,
  `--accent`, `--accent-text`, `--good`, `--warn`, `--crit`, `--crit-text`, `--good-text`). No new hard-coded
  colors. Everything must work in dark (the default) and light, and with all seven group colors.
- Text contrast at least 4.5:1 on its background in both themes.
- Cards are flat and solid with one thin border. Glass (`.glass`) is only for the navigation bars.
- Corners come from the sizes already used (10, 12, 14, 16px). A button's corner radius must stay well under
  half its height. Only round icon buttons and avatars are circles.
- Fonts: Schibsted Grotesk for text, JetBrains Mono for digits only (`.num`), Instrument Serif on the front page.
- Icons are the drawn SVGs from `ic("name")`, `SYM` and `SVG` in the engine. Add a path there if one is missing.
- Phones first: check at 375px and 1280px wide. The layout switches at 960px (`isWide()`). Tap targets are at
  least 44px. Respect the safe-area insets already used by the bars.
- Motion is short and optional: wrap it in `prefers-reduced-motion` like the existing code.
- Headings are sentence case. Copy is plain, short and specific, in the words the app already uses: boxes,
  cutoff, pictures, group owner, join code. Error messages say what happened and what to do next.
- Demo content uses made-up names (Taylor, Alex, Sam, ...), never real members. `BETA_QUOTES` stays empty until
  Batko supplies a real quote with that person's permission.
- Nothing may read as financial advice.

If you spot an existing break of these rules, tell Batko. Do not quietly add more and do not fix unrelated ones
inside another task.

## 9. Mistakes a weaker model makes here

| The mistake | Do this instead |
|---|---|
| Building a new screen as React components with `useState` | Write a `render...()` function that returns an HTML string in `engine.ts` |
| Splitting, "modernizing" or reformatting `engine.ts` | Leave its structure alone. Change only the lines the task needs |
| Putting a name or note into HTML without `esc()` | Always `esc()`. Search your diff for every `${` that holds user or database text |
| Adding `onclick` or `addEventListener` to drawn elements | Add a `data-*` attribute and a branch in the one click handler |
| Hiding a button and calling that security | Add the rule in a new SQL update and a test that proves a member cannot do it |
| Editing an old `update-N` file, or "fixing" `setup.sql` | New numbered file, every time |
| Changing a test so it passes | Fix the SQL. Change a test only when the test itself is wrong, and say so |
| Seeing the dev-mode console error "eval() is not supported" and adding `'unsafe-eval'` to the policy | Ignore it. It only appears in `next dev`. The policy never gets looser |
| Loading a font, icon set or script from a CDN | Self-host in `web/public/vendor`, or draw the icon as an SVG path |
| Using `/icons/...` with a leading slash, or `next/image` for remote pictures | Relative paths and plain `<img>` like the rest of the code |
| Adding an API route, server action or middleware | It is a static export: there is no server. Database work goes in SQL |
| Editing `web/out` or `.next`, or committing them | Edit `web/src` and `web/public` only |
| Using `new Date()` and local time to decide the trading day | Use the date helpers; they follow the group's time zone and cutoff |
| Fetching a growing list with one `select` | Use `fetchAll()` (1,000-row limit) |
| Forgetting to raise `VERSION` in `sw.js` | Raise it whenever the cached file list or those files change |
| Deleting the "unused" reminder function, cron job or push tables | Keep them: picture cleanup and "Download my data" depend on them |
| Trying to read `secrets/` or work around the hook that blocks it | Stop. Nothing in a task needs it. Even a command that mentions the folder is blocked |
| Running `git push`, opening a pull request, or branching | Commit on `main` and ask Batko to push |
| Saying "works" about a signed-in screen that was never opened | Say what you ran, what you saw, and what could not be checked locally |
| Inventing a quote, a user count or a rating for the front page | No proof exists yet. Leave it out |
| Writing copy with em dashes, emoji, hype or exclamation marks | Plain sentences. Use a comma, a colon or a full stop |
| Pill corners (`999px`, or a radius of half the height) on a button | A radius from the existing scale |
| A new hard-coded color that only works in dark mode | Use the variables and check light mode too |
| Adding a package, a linter, a test framework or a refactor nobody asked for | Ask first. Smallest change wins |
| Changing app behaviour and leaving the docs behind | Update `README.md`, and `lockedin-support/faq.md` when members would notice the change |
| Ending with a long technical report | One sentence, then Batko's numbered steps |
| Polling GitHub or the live site in a loop | One check, only when asked or when something looks wrong |

## 10. Before you say a task is done

Go through every line. If one is not true, the task is not done.

- [ ] The change does what Batko asked, and nothing he did not ask for.
- [ ] `cd web && npx tsc --noEmit` prints nothing.
- [ ] `cd web && npm run build` ends with `csp-first: policy moved to the top of 3 page(s)`.
- [ ] The Content-Security-Policy in `layout.tsx` is unchanged.
- [ ] If anything in `supabase/` changed: it is a new numbered file, safe to run twice, with a `README.md` row
      and new tests, and `node security-test.mjs` ends with `0 failed`. If the Edge Function changed,
      `node push-test.mjs` passes too.
- [ ] Every user or database text in new HTML strings goes through `esc()`.
- [ ] You opened the changed page in the preview at 375px and 1280px, in dark and light, and the browser console
      shows no new errors. For screens that need sign-in, you said that you could not open them.
- [ ] The design and copy list in section 8 holds for everything you added. Search your diff for the em dash character, emoji,
      `999px`, `!` in interface text and capital-letter labels.
- [ ] `VERSION` in `sw.js` was raised if the cached file list or those files changed.
- [ ] `README.md` (and `lockedin-support/faq.md` if members would notice) still tells the truth.
- [ ] `git status` shows only files you meant to change. Nothing from `secrets/`, `web/out` or `.next`.
- [ ] Big change: the reviewer said "Ready" and the tester said "Pass".
- [ ] Committed on `main`. Not pushed.
- [ ] New SQL is on Batko's clipboard (`pbcopy < file`).
- [ ] Your reply is one sentence on what changed, then "Your steps:" as a short numbered list in the order he
      must do them, then only the warnings he really needs.

## 11. Talking with Batko

Write in plain words, short sentences, no jargon. If you must use a technical word, explain it in a few words.
Be honest about what you did not verify. When something is his decision (a design choice, new wording for the
legal pages, a new dependency, anything that deletes data), ask one clear question and wait.
