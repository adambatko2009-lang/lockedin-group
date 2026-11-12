# LockedIn website (Next.js version)

The same website as `../index.html`, built with Next.js and TypeScript. It looks and works the same.

- `src/app/layout.tsx`: the `<head>` (security policy, icons, fonts) and the script that sets your theme before the page is drawn.
- `src/app/page.tsx`: the page skeleton (menus, panel, picture viewer, report form, tutorial).
- `src/app/globals.css`: all the styles, copied from the old `index.html`.
- `src/engine/engine.ts`: the app itself (sign-in, pages, ticking, notes, pictures, admin, reminders), moved from the old `index.html` script.
- `src/config.ts`: the Supabase address and public keys (was `config.js`). Never put the secret key here.
- `public/`: icons, fonts and their licenses, `sw.js` (offline copy and reminders), `manifest.webmanifest`, `CNAME`.

GitHub builds and publishes it by itself (`.github/workflows/deploy-web.yml`). Nothing is built by hand.

To try it on this Mac (needs Node.js): `npm install`, then
`LOCKEDIN_BASE_PATH=/web/out npm run build` and open http://localhost:8766/web/out/ with the local test server running.
