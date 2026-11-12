# LockedIn: how Claude works on this project

LockedIn (lockedingroup.app) is a homework tracker for small Discord trading groups, made by Batko (17).
The website is the Next.js static export in `web/`; GitHub Actions publishes it on every push to main.
The database is Supabase (Discord sign-in, strict row-level security). See `README.md` for the full file list.

## The team: plan, build, review, test
Every change, however small, goes through these steps in order.

1. **Plan** (main session). Say in plain words what will change and in which files. For anything bigger than a
   one-line fix, wait for Batko to approve the plan before writing code.
2. **Build** (main session). Make the change. Keep the look and copy rules below.
3. **Review**: run the `reviewer` agent on the change. If it says "Fix first", fix every problem and run it again.
4. **Test**: run the `tester` agent. If it says "Fail", fix and go back to step 3. For visual changes, also check
   the page yourself in the browser pane at 375px and 1280px.
5. **Commit** on main. Never push: Batko pushes with GitHub Desktop.

Then tell Batko what changed in one sentence and give him a short numbered list of his next steps
(for example: run this SQL in Supabase, then click Push origin). No long technical reports.

## Rules that never bend
- Database changes go in a new `supabase/update-N-*.sql` file. Never edit an old one. Put the new SQL on Batko's
  clipboard with `pbcopy` and tell him to paste it in the Supabase SQL Editor.
- Never put the Supabase service_role or secret key in any file. Never open anything in `secrets/`.
- Members only tick their own boxes; only owners change settings and approve people; groups never see each other.
- Don't loosen the Content-Security-Policy in `web/src/app/layout.tsx`. Fonts stay self-hosted in `web/public/vendor`.
- When files the service worker caches change, raise `VERSION` in `web/public/sw.js`.

## Look and copy
No purple gradients, pill-shaped buttons, fake reviews or numbers, vague hero text, emoji icons, em dashes,
over-the-top scroll or cursor animations, AI stock photos, AI-sounding filler, or small caps labels above headings.
Headings are sentence case. Fonts: Schibsted Grotesk, JetBrains Mono, Instrument Serif.
