// After the build: Next.js puts its own script and style tags at the top of <head>, before our
// Content-Security-Policy tag. The browser only applies the policy to what comes after it, so move it
// right below <meta charset> in every page, where the old index.html had it covering everything.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../out/", import.meta.url));
let moved = 0;
for (const name of readdirSync(dir).filter(f => f.endsWith(".html"))) {
  const file = join(dir, name);
  let html = readFileSync(file, "utf8");
  const csp = html.match(/<meta http-equiv="Content-Security-Policy"[^>]*\/>/);
  const charset = html.match(/<meta charSet="utf-8"\/>/);
  if (!csp || !charset) continue;
  html = html.replace(csp[0], "").replace(charset[0], charset[0] + csp[0]);
  writeFileSync(file, html);
  moved++;
}
if (!moved) { console.error("csp-first: no page with a Content-Security-Policy tag found"); process.exit(1); }
console.log(`csp-first: policy moved to the top of ${moved} page(s)`);
