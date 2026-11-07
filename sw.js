// LockedIn's background helper (a "service worker").
// 1. Keeps a copy of the website on the phone, so the app opens without internet.
// 2. Shows the reminder notifications sent by supabase/functions/send-reminders.
// Change VERSION when you change this file's list of files, so phones throw the old copy away.
const VERSION = "lockedin-2";
const FILES = ["./", "index.html", "config.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "icons/favicon-64.png", "icons/favicon-128.png",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/dist/umd/supabase.js"];

self.addEventListener("install", e => {
  // One missing file shouldn't stop the rest from being saved.
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(FILES.map(f => c.add(f).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;
  const ours = url.origin === self.location.origin;
  const shared = ["cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname);
  if (!ours && !shared) return;   // Supabase (sign-in, ticks, pictures) always goes straight to the internet
  if (ours && (req.mode === "navigate" || /\.(html|js|webmanifest)$/.test(url.pathname))) {
    // The website itself: the newest version from the internet, the saved copy when offline.
    const key = req.mode === "navigate" ? "./" : url.pathname.split("/").pop();
    // no-cache: always ask GitHub if there's a newer version (otherwise browsers reuse a copy for up to 10 minutes).
    e.respondWith(fetch(req.url, { cache: "no-cache", credentials: "same-origin" }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(key, copy)); }
      return res;
    }).catch(() => caches.match(key).then(r => r || caches.match("./"))));
    return;
  }
  // Icons, fonts and the Supabase library don't change: use the saved copy, fetch once if missing.
  e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => {
    if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return res;
  })));
});

self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "LockedIn", {
    body: d.body || "", icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: d.tag || "lockedin", renotify: true,
    data: { url: d.url || "./" },
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.startsWith(self.registration.scope));
    return open ? open.focus() : self.clients.openWindow(url);
  }));
});
