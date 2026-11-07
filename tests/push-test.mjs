// Test for the reminder sender (supabase/functions/send-reminders/index.ts). Run:
//   cd tests && npm install --no-save @electric-sql/pglite@0.2.17 http_ece@1.2.0 && node push-test.mjs
// Sends a reminder to a pretend push service on this computer, then checks it with an independent library.
import ece from "http_ece";
import crypto from "node:crypto";
import http from "node:http";
import { copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// Node runs the TypeScript file directly, but only with an .mts name, so test a copy.
const copy = join(tmpdir(), "send-reminders-test.mts");
copyFileSync(fileURLToPath(new URL("../supabase/functions/send-reminders/index.ts", import.meta.url)), copy);
const { sendPush, reminderText, b64u } = await import(copy);
let pass = 0, fail = 0; const ok = (c, l) => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", l); };

// The phone's keys
const ua = crypto.createECDH("prime256v1"); ua.generateKeys();
const auth = crypto.randomBytes(16);
const sub = { p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) };
// Our server's VAPID keys
const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pj = privateKey.export({ format: "jwk" });
const vapid = { publicKey: b64u(Buffer.concat([Buffer.from([4]), Buffer.from(pj.x, "base64url"), Buffer.from(pj.y, "base64url")])), privateKey: pj.d, subject: "https://example.github.io/app/" };

const msg = reminderText({ minutes_left: 45, group_name: "LockedIn", missing: ["Journal", "HTF"] });
ok(msg.title === "45 min left to finish your homework" && msg.body === "LockedIn: still to do Journal and HTF.", "reminder text: " + msg.title + " / " + msg.body);
ok(reminderText({ minutes_left: 60, group_name: "G", missing: ["A"] }).title.startsWith("1 hour left"), "60 min reads as 1 hour");
ok(reminderText({ minutes_left: 180, group_name: "G", missing: ["A"] }).title.startsWith("3 hours left"), "180 min reads as 3 hours");

let got = null;
const server = http.createServer((req, res) => {
  const chunks = []; req.on("data", c => chunks.push(c)); req.on("end", () => { got = { headers: req.headers, body: Buffer.concat(chunks) }; res.writeHead(201); res.end(); });
}).listen(0);
const port = server.address().port;
const out = await sendPush({ ...sub, endpoint: `http://127.0.0.1:${port}/push/abc` }, msg, vapid);
ok(out.status === 201, "push service accepted the request");
const h = got.headers;
ok(h["content-encoding"] === "aes128gcm" && h.ttl === "3600", "aes128gcm encoding and TTL headers");
const plain = ece.decrypt(got.body, { version: "aes128gcm", privateKey: ua, authSecret: auth });
ok(JSON.stringify(JSON.parse(plain.toString())) === JSON.stringify(msg), "the phone can decrypt the message (checked with the http_ece library)");
const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h.authorization);
ok(!!m && m[4] === vapid.publicKey, "VAPID header has the public key");
const claims = JSON.parse(Buffer.from(m[2], "base64url"));
ok(claims.aud === `http://127.0.0.1:${port}` && claims.sub === vapid.subject && claims.exp > Date.now() / 1000, "VAPID claims: audience, subject, expiry");
const valid = crypto.verify("sha256", Buffer.from(m[1] + "." + m[2]), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(m[3], "base64url"));
ok(valid, "VAPID signature verifies with the public key");
// A tampered message must not decrypt
const bad = Buffer.from(got.body); bad[bad.length - 1] ^= 1;
let threw = false; try { ece.decrypt(bad, { version: "aes128gcm", privateKey: ua, authSecret: auth }); } catch { threw = true; }
ok(threw, "a changed message is rejected");
server.close();
console.log(`${pass} passed, ${fail} failed`);
