// Supabase Edge Function "send-reminders".
// Every 5 minutes Supabase calls this (see update-10-reminders.sql). It does three things:
//   1. Reminders: asks the database who needs a reminder right now and sends each of them a notification.
//   2. Owner alerts (update 16): tells group owners when someone asks to join or something is reported.
//   3. Once an hour: deletes screenshots older than 60 days (update 16), through Supabase Storage so the space is freed.
// Calling it more often can't cause extra notifications: the database only hands out each one once.
//
// Needs three secrets (Supabase > Edge Functions > Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
// Notifications are sent with the standard Web Push protocol (RFC 8291 encryption + RFC 8292 VAPID), using only
// the browser-style crypto built into Supabase, so there's nothing extra to install.

const enc = new TextEncoder();

export function b64u(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64u(str) {
  const s = atob(str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
}
async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

// RFC 8291: encrypt the message so only the receiving phone/browser can read it.
// `salt` and `serverKeys` can be passed in for testing; normally they're random.
export async function encrypt(payload, p256dh, authSecret, salt, serverKeys) {
  const uaPublic = unb64u(p256dh), auth = unb64u(authSecret);
  salt = salt || crypto.getRandomValues(new Uint8Array(16));
  serverKeys = serverKeys || await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", serverKeys.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, serverKeys.privateKey, 256));
  const prkKey = await hmac(auth, shared);
  const ikm = await hmac(prkKey, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic, new Uint8Array([1])));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const plain = concat(enc.encode(payload), new Uint8Array([2]));   // 2 = last (and only) record
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plain));
  const header = concat(salt, new Uint8Array([0, 0, 16, 0]), new Uint8Array([asPublic.length]), asPublic);   // record size 4096
  return concat(header, cipher);
}

// RFC 8292: a signed note that says which server is sending, so the push service accepts it.
export async function vapidAuth(endpoint, publicKey, privateKey, subject) {
  const pub = unb64u(publicKey);
  const jwk = { kty: "EC", crv: "P-256", d: privateKey, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: true };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(head + "." + body));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${publicKey}`;
}

export async function sendPush(sub, message, vapid) {
  const body = await encrypt(JSON.stringify(message), sub.p256dh, sub.auth);
  return fetch(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuth(sub.endpoint, vapid.publicKey, vapid.privateKey, vapid.subject),
      "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream",
      TTL: "3600", Urgency: "high",
    },
    body,
  });
}

const list = a => a.length > 1 ? a.slice(0, -1).join(", ") + " and " + a[a.length - 1] : a[0] || "";
export function reminderText(r) {
  const m = r.minutes_left;
  const left = m < 60 ? `${m} min` : m < 90 ? "1 hour" : `${Math.round(m / 60)} hours`;
  return { title: `${left} left to finish your homework`, body: `${r.group_name}: still to do ${list(r.missing)}.`, tag: "reminder", url: "./" };
}

// Sends one notification; forgets the device if the phone turned notifications off or the app was removed.
async function deliver(r, message, vapid, url, headers, count) {
  try {
    const out = await sendPush(r, message, vapid);
    if (out.ok) count.sent++;
    else if (out.status === 404 || out.status === 410) {
      await fetch(`${url}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(r.endpoint)}`, { method: "DELETE", headers });
      count.removed++;
    } else { count.failed++; console.log("push failed", out.status, await out.text()); }
  } catch (e) { count.failed++; console.log("push error", String(e)); }
}

async function rpc(url, headers, fn, args = {}) {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(args) });
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${await res.text()}`);
  return res.json();
}

// Screenshots older than 60 days: delete the files, then remove them from their days. At most 200 per run.
export async function cleanPictures(url, headers) {
  const rows = await rpc(url, headers, "old_pictures", { max_count: 200 });
  const paths = (rows || []).map(x => typeof x === "string" ? x : x.old_pictures).filter(Boolean);
  if (!paths.length) return 0;
  const del = await fetch(`${url}/storage/v1/object/screenshots`, { method: "DELETE", headers, body: JSON.stringify({ prefixes: paths }) });
  if (!del.ok) throw new Error(`storage delete: ${del.status} ${await del.text()}`);
  await rpc(url, headers, "forget_pictures", { paths });
  return paths.length;
}

async function run() {
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapid = { publicKey: Deno.env.get("VAPID_PUBLIC_KEY"), privateKey: Deno.env.get("VAPID_PRIVATE_KEY"), subject: Deno.env.get("VAPID_SUBJECT") };
  if (!vapid.publicKey || !vapid.privateKey || !vapid.subject) return { error: "VAPID secrets are missing" };
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (key.startsWith("eyJ")) headers.Authorization = "Bearer " + key;
  const result: Record<string, unknown> = {}, problems: string[] = [];

  // 1. reminders
  try {
    const due = await rpc(url, headers, "due_reminders");
    const count = { sent: 0, removed: 0, failed: 0 };
    await Promise.all(due.map(r => deliver(r, reminderText(r), vapid, url, headers, count)));
    result.reminders = { due: due.length, ...count };
  } catch (e) { problems.push(String(e)); }

  // 2. owner alerts (only once database update 16 has been run)
  try {
    const alerts = await rpc(url, headers, "due_owner_alerts");
    const count = { sent: 0, removed: 0, failed: 0 };
    await Promise.all(alerts.map(a => deliver(a, { title: a.title, body: a.body, tag: a.tag, url: "./" }, vapid, url, headers, count)));
    result.owner_alerts = { due: alerts.length, ...count };
  } catch (e) { problems.push(String(e)); }

  // 3. old pictures, once an hour
  if (new Date().getUTCMinutes() < 5) {
    try { result.old_pictures_deleted = await cleanPictures(url, headers); } catch (e) { problems.push(String(e)); }
  }

  if (problems.length) { console.log("problems", problems); result.problems = problems; }
  if (problems.length && !result.reminders) result.error = problems[0];
  return result;
}

if (typeof Deno !== "undefined") {
  Deno.serve(async () => {
    const result = await run();
    return new Response(JSON.stringify(result), { status: result.error ? 500 : 200, headers: { "Content-Type": "application/json" } });
  });
}
