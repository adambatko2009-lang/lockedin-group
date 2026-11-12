// LockedIn's app: everything the old index.html did in its big <script>, moved here unchanged apart from
// the imports below. It draws the pages itself (into #app, #rail, #topbar and #tabbar from page.tsx),
// so the look and behaviour stay exactly as before. Started once by Boot.tsx after the page has loaded.
import { createClient } from "@supabase/supabase-js";
import { CONFIG } from "../config";

// ---------------------------------------------------------------- rules (change these here, on GitHub)
// Each group sets its own homework boxes, points, cutoff hour and time zone (Admin → Group settings).
// There are six box slots in the database; a group names them and makes each required, bonus or off.
const SLOTS = ["chart", "journal", "review", "social", "box5", "box6"];
const DEFAULT_BOXES = { chart: { label: "Chart with execution", kind: "req" }, journal: { label: "Journal", kind: "req" },
  review: { label: "HTF", kind: "req" }, social: { label: "Social", kind: "bonus" }, box5: { label: "Extra 1", kind: "off" }, box6: { label: "Extra 2", kind: "off" } };
let RULES = [], REQUIRED = [];
// Rule breaks members can tag on their day (honest self-reporting, never costs points). Must match update-6 SQL.
const BREAKS = [["moved_stop", "Moved stop"], ["revenge", "Revenge trade"], ["oversized", "Oversized"], ["fomo", "FOMO entry"],
                ["no_plan", "No plan"], ["overtraded", "Overtraded"], ["early_exit", "Cut winner early"], ["ignored_htf", "Ignored HTF"]];
const BREAK_LABEL = Object.fromEntries(BREAKS);
let POINTS = { COMPLETE: 2, PARTIAL: 1, MISSING: 0, bonus: 1 };
let CUTOFF_HOUR = 9, TZ = "America/New_York";   // the group's own; must match current_trading_day(group) in the database
function applyGroupRules(g) {
  const b = (g && g.boxes) || DEFAULT_BOXES;
  const on = SLOTS.filter(k => b[k] && b[k].kind !== "off").map(k => [k, b[k].label, b[k].kind]);
  RULES = [...on.filter(r => r[2] === "req"), ...on.filter(r => r[2] === "bonus")];
  REQUIRED = RULES.filter(r => r[2] === "req").map(r => r[0]);
  const p = (g && g.points) || { complete: 2, partial: 1, bonus: 1 };
  POINTS = { COMPLETE: p.complete, PARTIAL: p.partial, MISSING: 0, bonus: p.bonus };
  CUTOFF_HOUR = g ? g.cutoff_hour : 9;
  TZ = g ? g.timezone : "America/New_York";
  let saved = null;
  try { saved = localStorage.getItem("accent"); if (g) localStorage.setItem("accent", g.color); } catch (e) {}
  document.documentElement.dataset.accent = g ? g.color : saved || "blue";   // remembered, so the intro matches your group
}
applyGroupRules(null);
const tzCity = tz => tz.split("/").pop().replace(/_/g, " ");
const hh = h => String(h).padStart(2, "0") + ":00";

// Small drawn icons (no emoji or symbol characters, which look different on every phone).
const SYM = {
  check: `<svg class="sym" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 8.4 6.4 11.4 12.8 4.8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  x: `<svg class="sym" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  half: `<svg class="sym" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 2.4a5.6 5.6 0 0 1 0 11.2z" fill="currentColor"/></svg>`,
};
const ICON = { COMPLETE: SYM.check, PARTIAL: SYM.half, MISSING: SYM.x, WAITING: "", UNLOGGED: "?", EXCUSED: "E" };
const LABEL = { COMPLETE: "Complete", PARTIAL: "Partial", MISSING: "Missing", WAITING: "Waiting", UNLOGGED: "Not logged", EXCUSED: "Excused" };
// Outline icons (no emoji): decorative next to text, so hidden from screen readers.
const ICON_PATHS = {
  book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19"/><path d="M9 7.5h6"/>',
  layers: '<path d="M12 3 3 8l9 5 9-5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  alert: '<path d="M12 4 2.8 20h18.4L12 4z"/><path d="M12 10v4.5M12 17.4v.1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/>',
  pause: '<rect x="6.5" y="5" width="3.5" height="14" rx="1"/><rect x="14" y="5" width="3.5" height="14" rx="1"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  chat: '<path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>',
  flame: '<path d="M12 3c1 4 5.5 5.6 5.5 10.2A5.5 5.5 0 0 1 6.5 13c0-2.6 1.5-4.2 2.6-5.1.3 1.7 1.1 2.8 2.5 3.2C11 8 11.6 5.4 12 3z"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12.3 2.8 2.8L16.2 9"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  megaphone: '<path d="M4 10.5v3a1 1 0 0 0 1 1h2.5l6.5 4V5.5l-6.5 4H5a1 1 0 0 0-1 1z"/><path d="M17.5 9a4 4 0 0 1 0 6"/>',
  diamond: '<path d="M6.5 4h11l3.5 5-9 11L3 9l3.5-5z"/><path d="M3 9h18"/>',
  repeat: '<path d="M17 3l3 3-3 3"/><path d="M4 11.5V10a4 4 0 0 1 4-4h12"/><path d="M7 21l-3-3 3-3"/><path d="M20 12.5V14a4 4 0 0 1-4 4H4"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.6a6 6 0 0 1 3.5 5.4"/>',
  sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h12M20 18h0"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
  more: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.9.8c0 1.7-2.5 2.1-2.5 3.8"/><path d="M12 17.1v.2"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 6 8-6"/>',
  "chevron-left": '<path d="m14.5 6-6 6 6 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
};
const ic = (name, px = 16) => `<svg class="ic" viewBox="0 0 24 24" width="${px}" height="${px}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ""}</svg>`;
// Settings gear adapted from Feather Icons (MIT, Cole Bemis); full license in vendor/licenses. All other icons were drawn for LockedIn.
const SVG = {
  note: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>`,
  day: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 6"/></svg>`,
  week: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>`,
  board: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 20V11M12 20V5M18 20v-6"/></svg>`,
  me: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="10" r="3.2"/><path d="M6.2 18.6c1.4-2.2 3.4-3.3 5.8-3.3s4.4 1.1 5.8 3.3"/></svg>`,
  admin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M17 11l2 2 4-4"/></svg>`,
  gear: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`,
  camera: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>`,
  discord: `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M20.3 4.4A19.6 19.6 0 0 0 15.4 3l-.6 1.3a18 18 0 0 0-5.5 0L8.7 3a19.6 19.6 0 0 0-4.9 1.5C.7 9.1-.2 13.6.3 18a19.8 19.8 0 0 0 6 3l1.3-2.1a12.8 12.8 0 0 1-2-1l.5-.4a14 14 0 0 0 12 0l.5.4-2 1 1.3 2.1a19.7 19.7 0 0 0 6-3c.6-5.1-.8-9.6-3.6-13.6ZM8.1 15.3c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4Zm7.8 0c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4Z"/></svg>`,
};

// ---------------------------------------------------------------- dates (New York trading days)
let HOLIDAYS = new Set();
const parse = k => new Date(k + "T12:00:00Z");
const keyOf = d => d.toISOString().slice(0, 10);
const addDays = (k, n) => { const d = parse(k); d.setUTCDate(d.getUTCDate() + n); return keyOf(d); };
const isTradingDay = k => { const w = parse(k).getUTCDay(); return w > 0 && w < 6 && !HOLIDAYS.has(k); };
const prevTrading = k => { do k = addDays(k, -1); while (!isTradingDay(k)); return k; };
// Asked thousands of times while counting streaks, so the answers are remembered (forgotten when holidays reload).
const dateMemo = { next: new Map(), monday: new Map() };
const nextTrading = k => { let v = dateMemo.next.get(k); if (!v) { v = k; do v = addDays(v, 1); while (!isTradingDay(v)); dateMemo.next.set(k, v); } return v; };
const mondayOf = k => { let v = dateMemo.monday.get(k); if (!v) { v = addDays(k, -((parse(k).getUTCDay() + 6) % 7)); dateMemo.monday.set(k, v); } return v; };
const fmtDay = (k, o?) => parse(k).toLocaleDateString("en-GB", Object.assign({ weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }, o));

const tzFormats = {};   // making a date formatter is slow, so one per time zone is reused
function nyParts(ms) {
  const f = tzFormats[TZ] || (tzFormats[TZ] = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }));
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { key: `${p.year}-${p.month}-${p.day}`, hour: +p.hour, minute: +p.minute };
}
// The real moment of HH:00 New York time on a given date (handles daylight saving).
const momentCache = new Map();   // the answer never changes for the same time zone, day and hour
function nyMoment(k, hour): any {
  const ck = TZ + "|" + k + "|" + hour;
  let ms = momentCache.get(ck);
  if (ms === undefined) {
    const guess = Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10), hour);
    const p = nyParts(guess);
    const seen = Date.UTC(+p.key.slice(0, 4), +p.key.slice(5, 7) - 1, +p.key.slice(8, 10), p.hour, p.minute);
    ms = guess - (seen - guess);
    momentCache.set(ck, ms);
  }
  return new Date(ms);
}
function currentTradingDay() {
  const p = nyParts(Date.now());
  let k = p.key;
  if (p.hour < CUTOFF_HOUR) k = addDays(k, -1);
  while (!isTradingDay(k)) k = addDays(k, -1);
  return k;
}
const opensAt = k => nyMoment(k, CUTOFF_HOUR);
const closesAt = k => nyMoment(nextTrading(k), CUTOFF_HOUR);
const isFinal = k => Date.now() >= closesAt(k).getTime();

// Never run inside another website's frame (stops "clickjacking": a fake page tricking you into clicking).
if (window.top !== window.self) {
  const link = document.createElement("a");
  link.href = location.href; link.target = "_top"; link.textContent = "Open LockedIn directly";
  document.body.replaceChildren(link);
  throw new Error("LockedIn won't run inside another website");
}

// ---------------------------------------------------------------- state
const cfg: any = CONFIG;
const configured = cfg.supabaseUrl && !cfg.supabaseUrl.startsWith("PASTE") && cfg.supabaseAnonKey && !cfg.supabaseAnonKey.startsWith("PASTE");
// The login library normally coordinates tabs with a browser lock, which can hang forever ("stuck on Loading")
// when the site is open twice or opened from Discord. Running without it: worst case someone signs in again.
const sb = configured ? createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
  auth: { lock: async (name, acquireTimeout, fn) => await fn() },
}) : null;

// The date of the current Terms and Privacy policy. Change it when they change, and everyone is asked to accept again.
const TERMS_VERSION = "2026-11-12";
let screen = "loading";          // loading | setup | signin | waiting | rejected | app
let session = null, profile = null;
let isAdmin = false;             // can manage the open group: its owner, a group admin, or the app owner
let isAppOwner = false;          // you (the "admins" table): every group, every setting
let groups = [], myMemberships = [], requests = [], gid = null;
let allMemberships = [], allProfiles = [];   // app owner only: for the All groups list
try { gid = localStorage.getItem("group"); } catch (e) {}
let members = [];                // [{key, name, sort, active}]
let ticks: Record<string, any> = {};                  // "day|member" -> row
let people = [];                 // managers only: everyone in (or waiting for) the open group
let discordCfg = null;           // group owner: this group's Discord recap settings (the webhook link is secret)
let reports = [];                // group owners and the app owner: open reports (the database only returns the ones you may see)
let today = currentTradingDay();
let selected = today, weekStart = mondayOf(today), editing = null;   // editing = {day, key} while the edit panel is open
let tab = "day";
let profileKey = null;   // whose profile page is open
try { const t = localStorage.getItem("tab"); if (t) tab = t; } catch (e) {}
let error = "", saving = 0, loaded = false, channel = null;
let reflections: Record<string, any> = {};           // "monday|member" -> {week_start, member_key, went_well, to_fix}

const group = () => groups.find(g => g.id === gid) || null;
const myMembership = (g = gid) => myMemberships.find(m => m.group_id === g) || null;
const myKey = () => { const m = myMembership(); return m && m.status === "approved" ? m.member_key : null; };
const isGroupOwner = (g = group()) => !!g && !!session && (isAppOwner || (g.owner_id === session.user.id && g.status === "active"));
function canManageGroup(g = group()) {
  if (!g) return false;
  if (isGroupOwner(g)) return true;
  const m = myMembership(g.id);
  return g.status === "active" && !!m && m.status === "approved" && m.role === "admin";
}
const canOpen = g => isAppOwner || (session && g.owner_id === session.user.id) || (myMembership(g.id) || {}).status === "approved";
const roleOf = (g = group()) => !g ? "" : session && g.owner_id === session.user.id ? "Owner"
  : (myMembership(g.id) || {}).role === "admin" ? "Admin" : (myMembership(g.id) || {}).status === "approved" ? "Member" : isAppOwner ? "App owner" : "";
const activeMembers = () => members.filter(m => m.active).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
const tickOf = (k, key) => ticks[k + "|" + key] || null;
// Days where anyone logged anything. Built once per screen update (scanning every tick for every
// person and day made big groups freeze); ticksChanged() throws it away after any change.
let dayAny = null, tickDays = null;
const statsCache = new Map();
function ticksChanged() { dayAny = null; tickDays = null; statsCache.clear(); }
function dayHasAny(k) {
  if (!dayAny) { dayAny = new Set(); for (const id in ticks) if (!ticks[id].excused) dayAny.add(id.slice(0, 10)); }
  return dayAny.has(k);
}
const canEdit = (k, key) => isAdmin || (key === myKey() && k === today && !isFinal(k) && !!group() && group().status === "active");

function statusOf(k, key) {
  const rec = tickOf(k, key);
  if (rec && rec.excused) return "EXCUSED";   // set by the admin: sick, travelling...
  const req = rec ? REQUIRED.filter(r => rec[r]).length : 0;
  if (req === REQUIRED.length) return "COMPLETE";
  if (req > 0) return "PARTIAL";
  if (!isFinal(k)) return "WAITING";       // the day is still open, nothing yet isn't a fail
  if (!dayHasAny(k)) return "UNLOGGED";      // nobody logged anything that day: don't count it
  return "MISSING";
}

// ---------------------------------------------------------------- data
let loadStep = "checking your sign-in";
async function loadAll() {
  loadStep = "your account";
  const [{ data: prof }, { data: adm }] = await Promise.all([
    sb.from("profiles").select("*").eq("user_id", session.user.id).maybeSingle(),
    sb.from("admins").select("user_id").eq("user_id", session.user.id),
  ]);
  profile = prof; isAppOwner = !!(adm && adm.length);
  // Everyone accepts the current Terms and Privacy policy once (only after database update 13 has added the record).
  if (profile && "terms_accepted_at" in profile && profile.terms_version !== TERMS_VERSION) {
    screen = "terms"; loaded = false; clearTimeout(loadTimer); return render();
  }
  loadSettings();
  const invited = await useInvite();
  await loadGroups();
  const usable = groups.filter(canOpen);
  let intent = "";
  try { intent = localStorage.getItem("lockedin.intent") || ""; localStorage.removeItem("lockedin.intent"); } catch (err) { /* private mode */ }
  if (!usable.length) { screen = "lobby"; lobbyMode = intent === "create" ? "create" : "join"; loaded = false; return render(); }
  if (!usable.some(g => g.id === gid)) gid = (usable.find(g => (myMembership(g.id) || {}).status === "approved") || usable[0]).id;
  await openGroup(gid);
  if (invited && screen === "app") openGroupsPanel();   // shows how the invite went
}

// Your groups, your memberships, and group requests (yours; the app owner sees all).
async function loadGroups() {
  loadStep = "your groups";
  const [g, m, r] = await Promise.all([
    sb.from("groups").select("*").order("created_at"),
    sb.from("memberships").select("*").eq("user_id", session.user.id),
    sb.from("group_requests").select("*").order("created_at", { ascending: false }),
  ]);
  if (g.error) throw new Error("Couldn't load groups: " + g.error.message + ". Has database update 9 been run?");
  groups = g.data || []; myMemberships = m.data || []; requests = r.data || [];
}

// Supabase sends at most 1000 rows per request, so bigger lists come in pages (all at once, after the first).
const PAGE = 1000;
// build(options) must return a fresh query: sb.from(...).select("*", options)...
async function fetchAll(build) {
  const first = await build({ count: "exact" }).range(0, PAGE - 1);
  if (first.error) return { data: [], error: first.error };
  const total = first.count == null ? (first.data || []).length : first.count, rest = [];
  if (!first.data || first.data.length >= total) return { data: first.data || [], error: null };
  for (let from = PAGE; from < total; from += PAGE) rest.push(build().range(from, from + PAGE - 1));
  const pages = await Promise.all(rest);
  const bad = pages.find(x => x.error);
  return { data: first.data.concat(...pages.map(x => x.data || [])), error: bad ? bad.error : null };
}
// A group's ticks. With a saved copy on this device only what changed since then is downloaded
// (a whole year for 100 people is ~20,000 rows; downloading that on every open would use up the free plan).
let syncedAt = null;   // newest change time the server has sent us
const maxStamp = (rows, start?) => rows.reduce((a, r) => (r.updated_at && r.updated_at > a ? r.updated_at : a), start || "");
async function loadTicks(id, snap) {
  const q = o => sb.from("ticks").select("*", o).eq("group_id", id).order("day", { ascending: false }).order("member_key");
  const toMap = rows => { const o = {}; rows.forEach(r => { o[r.day + "|" + r.member_key] = r; }); return o; };
  if (snap && snap.syncedAt && Date.now() - snap.at < 30 * 86400000) {
    const since = new Date(new Date(snap.syncedAt).getTime() - 10 * 60000).toISOString();   // 10 min margin
    const [d, c] = await Promise.all([
      fetchAll(o => q(o).gte("updated_at", since)),
      sb.from("ticks").select("day", { count: "exact", head: true }).eq("group_id", id),
    ]);
    if (!d.error && !c.error) {
      const map = toMap(snap.ticks || []);
      d.data.forEach(r => { map[r.day + "|" + r.member_key] = r; });
      // Same number of rows as the server: nothing was deleted, the copy is complete.
      if (Object.keys(map).length === c.count) return { ticks: map, syncedAt: maxStamp(d.data, snap.syncedAt) };
    }
  }
  const all = await fetchAll(q);
  if (all.error) return { ticks: snap ? toMap(snap.ticks || []) : {}, syncedAt: snap ? snap.syncedAt : null, error: all.error };
  return { ticks: toMap(all.data), syncedAt: maxStamp(all.data) };
}

// Load one group's names, ticks and reflections, and switch the app to it.
async function openGroup(id) {
  const changed = id !== gid || !loaded;
  gid = id;
  try { localStorage.setItem("group", id); } catch (e) {}
  const g = group();
  applyGroupRules(g);
  isAdmin = canManageGroup(g);
  loadStep = "members and ticks";
  const snap = await readSnapshot(id);
  const [m, h, t] = await Promise.all([
    sb.from("members").select("*").eq("group_id", id),
    sb.from("holidays").select("day"),
    loadTicks(id, snap),
  ]);
  const failed = [m, h, t].find(r => r.error);
  if (failed) { error = "Couldn't load data: " + failed.error.message; }
  members = m.data || (snap ? snap.members : []);
  HOLIDAYS = new Set((h.data || []).map(r => r.day)); dateMemo.next.clear();
  ticks = t.ticks;
  syncedAt = t.syncedAt;
  applyOutbox();
  today = currentTradingDay();
  if (changed || selected > today || !isTradingDay(selected)) selected = today;
  weekStart = mondayOf(selected);
  loadStep = "weekly reflections";
  const rf = await fetchAll(o => sb.from("reflections").select("*", o).eq("group_id", id).order("week_start", { ascending: false }).order("member_key"));
  reflections = {};
  ((rf.error && snap ? snap.reflections : rf.data) || []).forEach(r => { reflections[r.week_start + "|" + r.member_key] = r; });
  await loadReactions(id);
  await loadComments(id);
  loadStep = "admin list";
  people = [];
  if (isAdmin) await loadPeople();
  if (isAppOwner) await loadOwnerData();
  loadStep = "done";
  if (changed) profileKey = null;
  if (!isAdmin && tab === "admin") tab = "day";
  openFaqLink();
  loaded = true; screen = "app";
  offlineSince = null;
  subscribe();
  render();
  if (faqOpenSlug) { const d = document.getElementById("faq-" + faqOpenSlug); faqOpenSlug = null; if (d) d.scrollIntoView({ block: "center" }); }
  if (!failed) saveSnapshot();
  flushOutbox();
  maybeStartTour();
}

async function switchGroup(id) {
  if (id === gid) return closePanel();
  closePanel();
  screen = "loading"; render(); watchLoading();
  await openGroup(id);
  window.scrollTo(0, 0);
}

// Everyone in (or waiting for) the open group, with their Discord name and picture.
async function loadPeople() {
  const { data, error: e } = await sb.from("memberships").select("*").eq("group_id", gid).order("created_at");
  if (e) { error = e.message; return; }
  const ids = (data || []).map(x => x.user_id);
  const pr = ids.length ? await sb.from("profiles").select("user_id, discord_name, avatar_url").in("user_id", ids) : { data: [] };
  people = (data || []).map(x => Object.assign({ discord_name: "Unknown", avatar_url: null }, (pr.data || []).find(p => p.user_id === x.user_id) || {}, x));
  if (isGroupOwner()) {
    const [rp, dc] = await Promise.all([
      sb.from("reports").select("*").eq("status", "open").order("created_at", { ascending: false }).limit(100),
      sb.from("group_discord").select("*").eq("group_id", gid).maybeSingle(),
    ]);
    reports = rp.error ? [] : rp.data || [];
    discordCfg = dc.error ? null : dc.data;
  } else { reports = []; discordCfg = null; }
}

// App owner: everybody's memberships and Discord names, for the All groups list.
async function loadOwnerData() {
  const [m, p] = await Promise.all([
    sb.from("memberships").select("group_id, user_id, status, role, member_key"),
    sb.from("profiles").select("user_id, discord_name, avatar_url"),
  ]);
  allMemberships = m.data || []; allProfiles = p.data || [];
}
const profileName = uid => ((allProfiles.find(p => p.user_id === uid) || people.find(p => p.user_id === uid) || {}).discord_name) || "Unknown";

// When many people tick at once (near the cutoff), redraw at most a few times a second.
let renderTimer = null;
function scheduleRender() {
  if (renderTimer) return;
  renderTimer = setTimeout(() => { renderTimer = null; autoRender(); }, 250);
}
// Redraws nobody asked for (live updates, the clock) skip the Admin page while you're typing in it,
// so a member ticking a box can't wipe the group name you're halfway through changing.
let adminDirty = false;
function autoRender() {
  if (screen !== "app") return;
  const f = document.activeElement, typing = f && f.closest && f.closest("#app") && /^(INPUT|TEXTAREA|SELECT)$/.test(f.tagName);
  if (tab === "admin" && (typing || adminDirty)) { renderTop(); renderTabbar(); return; }
  render();
}
// In the background the live connection is closed after 2 minutes (saves Supabase's free limits);
// coming back downloads only what changed and reconnects.
let idleTimer = null, sleeping = false;
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (channel) { sb.removeChannel(channel); channel = null; sleeping = true; } }, 120000);
  } else {
    clearTimeout(idleTimer);
    if (sleeping && screen === "app" && session) { sleeping = false; refreshNow().catch(() => subscribe()); }
  }
});
function subscribe() {
  if (channel) { sb.removeChannel(channel); channel = null; }
  const filter = `group_id=eq.${gid}`, here = gid;
  channel = sb.channel("group-" + gid)
    .on("postgres_changes", { event: "*", schema: "public", table: "ticks", filter }, (payload: any) => {
      const row = payload.new && payload.new.day ? payload.new : payload.old;
      if (!row || !row.day || here !== gid || (row.group_id && row.group_id !== gid)) return;
      const id = row.day + "|" + row.member_key;
      if (payload.eventType === "DELETE") delete ticks[id];
      else if (!pending[id] && !getOutbox()[id]) ticks[id] = payload.new;   // don't overwrite a tick you're still saving
      ticksChanged();
      scheduleRender();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "reflections", filter }, (payload: any) => {
      const row = payload.new && payload.new.week_start ? payload.new : payload.old;
      if (!row || !row.week_start || here !== gid || (row.group_id && row.group_id !== gid)) return;
      const id = row.week_start + "|" + row.member_key;
      if (payload.eventType === "DELETE") delete reflections[id];
      else if (!pendingRefl[id]) reflections[id] = payload.new;
      scheduleRender();
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "reactions", filter }, payload => {
      if (here !== gid || !payload.new || payload.new.group_id !== gid) return;
      addReactionLocal(payload.new);
      scheduleRender();
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "comments", filter }, (payload: any) => {
      if (here !== gid || !payload.new || payload.new.group_id !== gid) return;
      addCommentLocal(payload.new);
      scheduleRender();
    })
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "comments" }, (payload: any) => {
      // Deletes only carry the comment's number, never its text.
      if (here !== gid || !payload.old || payload.old.id == null) return;
      if (dropCommentLocal(payload.old.id)) scheduleRender();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "memberships", filter }, () => {
      // Someone typed the join code (managers see them appear in Admin right away).
      if (isAdmin && here === gid) loadPeople().then(autoRender);
    })
    .subscribe();
}

// One save at a time per row; quick taps are combined into one save.
const pending = {}, timers = {};
// ---------------------------------------------------------------- reactions on someone's post (note or pictures)
let reactions: Record<string, any> = {};   // "day|member" -> [{ reactor_key, user_id, kind }]
const REACTIONS = [["fire", "flame", "Fire"], ["clean", "target", "Clean execution"], ["respect", "check", "Respect"]];
function addReactionLocal(x) {
  const k = x.day + "|" + x.member_key, l = reactions[k] || (reactions[k] = []);
  if (!l.some(y => y.user_id === x.user_id && y.kind === x.kind)) l.push(x);
}
async function loadReactions(id) {
  const r = await sb.from("reactions").select("day, member_key, reactor_key, user_id, kind").eq("group_id", id).gte("day", addDays(today, -70)).limit(5000);
  reactions = {};
  if (!r.error) (r.data || []).forEach(addReactionLocal);   // before database update 16 there's simply nothing
}
function reactBarHtml(day, key) {
  const list = reactions[day + "|" + key] || [], uid = session ? session.user.id : null;
  const canReact = !!uid && !!myKey() && key !== myKey();
  const chips = REACTIONS.map(([kind, icon, label]) => {
    const who = list.filter(x => x.kind === kind), mine = who.some(x => x.user_id === uid);
    if (!who.length && !canReact) return "";
    const names = who.map(x => (members.find(m => m.key === x.reactor_key) || {}).name).filter(Boolean);
    const tip = names.length ? `${label}: ${names.join(", ")}` : label;
    const inner = `${ic(icon, 15)}${who.length ? `<span>${who.length}</span>` : ""}`;
    return canReact
      ? `<button class="react${mine ? " on" : ""}" data-react="${kind}|${day}|${key}" aria-pressed="${mine}" title="${esc(tip)}" aria-label="${esc(tip)}">${inner}</button>`
      : `<span class="react" title="${esc(tip)}" role="img" aria-label="${esc(tip)}">${inner}</span>`;
  }).join("") + commentToggleHtml(day, key);
  return chips ? `<div class="reacts">${chips}</div>` : "";
}
async function toggleReaction(kind, day, key) {
  if (!session || !myKey() || key === myKey()) return;
  const uid = session.user.id, k = day + "|" + key, mineNow = (reactions[k] || []).some(x => x.user_id === uid && x.kind === kind);
  const drop = () => { reactions[k] = (reactions[k] || []).filter(x => !(x.user_id === uid && x.kind === kind)); };
  const add = () => addReactionLocal({ day, member_key: key, user_id: uid, reactor_key: myKey(), kind });
  if (mineNow) { drop(); render(); } else { add(); render(); }
  const { error: e } = mineNow
    ? await sb.from("reactions").delete().eq("day", day).eq("member_key", key).eq("user_id", uid).eq("kind", kind)
    : await sb.from("reactions").insert({ day, member_key: key, kind });
  if (e && !/duplicate/i.test(e.message)) { if (mineNow) add(); else drop(); error = e.message; render(); }
}

// ---------------------------------------------------------------- comments and replies on someone's post
let comments: Record<string, any[]> = {};   // "day|member" -> comments, oldest first
const commentsOpen = new Set<string>();     // posts whose comments are showing
const commentDrafts: Record<string, string> = {}, replyTo: Record<string, number> = {};
let commentSending = "";
function addCommentLocal(c) {
  const k = c.day + "|" + c.member_key, l = comments[k] || (comments[k] = []);
  if (!l.some(x => x.id === c.id)) { l.push(c); l.sort((a, b) => a.created_at.localeCompare(b.created_at)); }
}
// Removes a comment and its replies; true if it was here.
function dropCommentLocal(id) {
  let found = false;
  for (const k of Object.keys(comments)) {
    const before = comments[k].length;
    comments[k] = comments[k].filter(x => x.id !== id && x.reply_to !== id);
    if (comments[k].length !== before) found = true;
  }
  return found;
}
const findComment = id => { for (const l of Object.values(comments)) { const c = l.find(x => x.id === id); if (c) return c; } return null; };
async function loadComments(id) {
  const r = await sb.from("comments").select("id, day, member_key, author_key, user_id, reply_to, body, created_at")
    .eq("group_id", id).order("created_at").limit(5000);
  comments = {};
  if (!r.error) (r.data || []).forEach(addCommentLocal);   // before database update 21 there's simply nothing
}
const canComment = () => !!session && !!myKey();
function commentToggleHtml(day, key) {
  const k = day + "|" + key, n = (comments[k] || []).length, open = commentsOpen.has(k);
  if (!n && !canComment()) return "";
  const label = n ? `${n} comment${n === 1 ? "" : "s"}` : "Comment";
  return `<button class="react cmt-toggle${open ? " on" : ""}" data-comments="${k}" aria-expanded="${open}">${ic("chat", 15)}<span>${label}</span></button>`;
}
const commentTime = iso => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
function commentHtml(c) {
  const m = members.find(x => x.key === c.author_key) || { key: c.author_key, name: "Former member" };
  const mine = !!session && c.user_id === session.user.id;
  const acts = [
    canComment() ? `<button class="clink" data-creply="${c.id}">Reply</button>` : "",
    mine || isAdmin ? `<button class="clink" data-cdel="${c.id}">Delete</button>` : "",
    !mine && !isAdmin && canComment() && c.author_key !== myKey() ? `<button class="clink" data-creport="${c.id}">Report</button>` : "",
  ].join("");
  return `<li class="cmt${c.reply_to ? " reply" : ""}">
    <div class="chead">${avatarHtml(m, 20)}<b>${esc(m.name)}</b><span class="ctime">${esc(commentTime(c.created_at))}</span></div>
    <p>${linkify(c.body)}</p>${acts ? `<div class="cacts">${acts}</div>` : ""}</li>`;
}
function commentsPanelHtml(day, key) {
  const k = day + "|" + key;
  if (!commentsOpen.has(k)) return "";
  const list = comments[k] || [], top = list.filter(c => !c.reply_to);
  const items = top.map(c => commentHtml(c) + list.filter(x => x.reply_to === c.id).map(commentHtml).join("")).join("");
  if (replyTo[k] && !findComment(replyTo[k])) delete replyTo[k];   // the comment you were answering was deleted
  const replying = replyTo[k] ? findComment(replyTo[k]) : null;
  const rname = replying ? (members.find(x => x.key === replying.author_key) || { name: "this comment" }).name : "";
  const fid = "cbox-" + k.replace(/[^a-z0-9]/gi, "-");
  const form = canComment() ? `<div class="cform">
      ${replying ? `<div class="creplying">Replying to <b>${esc(rname)}</b> <button class="clink" data-creply-cancel="${k}">Cancel</button></div>` : ""}
      <textarea class="field cbox" id="${fid}" data-cbox="${k}" rows="2" maxlength="500" placeholder="${replying ? "Write a reply" : "Write a comment"}" aria-label="${replying ? "Write a reply" : "Write a comment"}">${esc(commentDrafts[k] || "")}</textarea>
      <button class="btn primary small" data-csend="${k}" ${commentSending === k ? "disabled" : ""}>${commentSending === k ? "Sending…" : "Send"}</button></div>` : "";
  return `<div class="cmts">${items ? `<ul class="clist">${items}</ul>` : `<p class="empty">No comments yet.</p>`}${form}</div>`;
}
async function sendComment(k) {
  const body = (commentDrafts[k] || "").trim();
  if (!body || !canComment() || commentSending) return;
  const i = k.indexOf("|"), day = k.slice(0, i), key = k.slice(i + 1);
  if (replyTo[k] && !findComment(replyTo[k])) delete replyTo[k];
  commentSending = k; render();
  const { data, error: e } = await sb.from("comments").insert({ day, member_key: key, body, reply_to: replyTo[k] || null })
    .select("id, day, member_key, author_key, user_id, reply_to, body, created_at").single();
  commentSending = "";
  if (e) { error = isNetErr(e) ? "No connection. Your comment wasn't sent; try again." : e.message; return render(); }
  addCommentLocal(data);
  delete commentDrafts[k]; delete replyTo[k];
  render();
}
async function deleteComment(id) {
  const c = findComment(id);
  if (!c) return;
  const { error: e } = await sb.from("comments").delete().eq("id", id);
  if (e) { error = e.message; return render(); }
  dropCommentLocal(id);
  render();
}

// ---------------------------------------------------------------- setup guide for a new group owner
// Progress is saved with your settings: og[group] holds "b" (boxes saved), "s" (invite shared), "x" (hidden).
const guideFlags = () => ((settings.og || {})[gid] || "");
function setGuideFlag(f) {
  if (!gid || guideFlags().includes(f)) return;
  settings.og = Object.assign({}, settings.og || {}, { [gid]: guideFlags() + f });
  saveSettings();
}
function guideSteps() {
  const g = group();
  if (!g || !session || g.owner_id !== session.user.id || guideFlags().includes("x")) return null;
  const steps = [
    ["Set your homework boxes, points and cutoff time", guideFlags().includes("b"), "group"],
    ["Share your invite link in your Discord", guideFlags().includes("s"), "people"],
    ["Approve your first member", people.some(p => p.status === "approved" && p.user_id !== g.owner_id), "people"],
    ["Turn on notifications, so you hear about join requests", !!push.sub, "notif"],
    ["Connect Discord recaps (optional)", !!discordCfg, "group"],
  ];
  return steps.every(x => x[1]) ? null : steps;
}
function ownerGuideHtml() {
  const steps = guideSteps();
  if (!steps) return "";
  const done = steps.filter(x => x[1]).length;
  return `<div class="card guide"><div class="cardhead"><h2>Set up ${esc(group().name)}</h2><span class="guide-n">${done} of ${steps.length} done</span></div>
    <ol class="guide-list">${steps.map(([label, ok, go]) => `<li class="${ok ? "ok" : ""}">${ok ? ic("check", 18) : `<span class="guide-dot" aria-hidden="true"></span>`}
      ${ok ? `<span>${esc(label)}</span>` : `<button class="linkbtn" data-guide="${go}">${esc(label)}</button>`}</li>`).join("")}</ol>
    <button class="btn plain small" id="guide-hide">Hide this</button></div>`;
}
function guideNudgeHtml() {
  const steps = guideSteps();
  if (!steps) return "";
  return `<button class="guide-nudge" data-guide="people">${ic("target", 16)}Finish setting up your group · ${steps.filter(x => x[1]).length} of ${steps.length} done</button>`;
}

// Phones: member rows show the first word of a box name ("Chart" for "Chart with execution").
const shortLabel = l => { const w = String(l).trim().split(/\s+/)[0] || l; return w.length > 11 ? w.slice(0, 10) + "…" : w; };

// A day's result: one of these, or nothing picked yet. "No trade" uses the no_trade column.
const RESULTS = [["win", "Win"], ["loss", "Loss"], ["notrade", "No trade"], ["gamble", "Gamble"]];
const resultOf = rec => rec && rec.no_trade ? "notrade" : (rec && rec.result) || null;
const resultBtnsHtml = rec => RESULTS.map(([v, l]) => `<button data-result="${v}" class="r-${v}" aria-pressed="${resultOf(rec) === v}">${l}</button>`).join("");
const resultHint = rec => ({
  win: "Marked as a win. Tap again to clear.",
  loss: "Marked as a loss. Losses are part of it, the homework still counts.",
  notrade: "You sat out on purpose. Chart with executions, journal and HTF are still required.",
  gamble: "Marked as a gamble: a trade outside your plan. Being honest here helps you spot it.",
}[resultOf(rec)] || "Pick one. Tap it again to clear.");
// P&L in dollars and R. Typed freely ("+1,250", "-150.5", "2R"); empty means not filled in.
const parseNum = (v, max) => {
  const t = String(v || "").replace(/[\s,$R]/gi, "").replace(/^\+/, "");
  if (t === "") return null;
  if (t === "-" || /^-?\d+\.$/.test(t)) return undefined;   // still typing
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return NaN;
  const n = +t;
  return Math.abs(n) > max ? NaN : n;
};
const fmtPnl = n => (n > 0 ? "+" : n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
const fmtR = n => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 }) + "R";
const hasNum = v => v !== null && v !== undefined && v !== "";
function pnlChipHtml(rec) {
  const p = hasNum(rec.pnl) ? +rec.pnl : null, r = hasNum(rec.rr) ? +rec.rr : null;
  if (p === null && r === null) return "";
  const sign = p !== null ? Math.sign(p) : Math.sign(r);
  return `<span class="pnlchip ${sign > 0 ? "up" : sign < 0 ? "down" : ""}">${[p !== null ? fmtPnl(p) : "", r !== null ? fmtR(r) : ""].filter(Boolean).join(" · ")}</span>`;
}
const resultTag = rec => {
  const r = resultOf(rec); if (!r) return "";
  const label = RESULTS.find(x => x[0] === r)[1];
  return r === "notrade"
    ? `<span class="ntag" title="No trade today: sat out on purpose">${ic("pause", 13)}<span class="ntag-text">No trade</span></span>`
    : `<span class="ntag rtag r-${r}" title="${label}"><i aria-hidden="true"></i><span class="ntag-text">${label}</span></span>`;
};

function editTick(k, key, mutate, quiet?) {
  if (!key || !canEdit(k, key)) return;
  const id = k + "|" + key;
  const row = Object.assign({ day: k, member_key: key, chart: false, journal: false, review: false, social: false, box5: false, box6: false, note: "", images: [], no_trade: false, result: null, pnl: null, rr: null, rule_breaks: [] }, tickOf(k, key));
  row.images = [...(row.images || [])];
  row.rule_breaks = [...(row.rule_breaks || [])];
  mutate(row);
  ticks[id] = row; pending[id] = true; noteState[id] = "saving"; ticksChanged();
  if (quiet) renderTop(); else render();
  clearTimeout(timers[id]);
  timers[id] = setTimeout(() => saveTick(id), quiet ? 1200 : 450);   // quiet = typing a note
}
async function saveTick(id) {
  const row = ticks[id];
  const body = { day: row.day, member_key: row.member_key, chart: !!row.chart, journal: !!row.journal, review: !!row.review, social: !!row.social, box5: !!row.box5, box6: !!row.box6, note: row.note || "", images: row.images || [], excused: !!row.excused, no_trade: !!row.no_trade, result: row.no_trade ? null : (row.result || null), pnl: row.pnl ?? null, rr: row.rr ?? null, rule_breaks: row.rule_breaks || [] };
  saving++; noteState[id] = "saving"; renderTop();
  let e;
  if (!navigator.onLine) e = { message: "offline" };
  else try { ({ error: e } = await sb.from("ticks").upsert(body, { onConflict: "day,member_key" })); }
  catch (err) { e = { message: "network: " + err.message }; }
  saving--;
  delete pending[id];
  if (e && isNetErr(e)) {
    // No internet: keep it on this device and upload it when the connection is back.
    const o = getOutbox(); o[id] = body; putOutbox(o);
    noteState[id] = "offline"; offline = !navigator.onLine;
    return render();
  }
  if (e) {
    error = e.code === "42501" || /row-level security/i.test(e.message)
      ? "Not saved: this day is closed or the row isn't yours."
      : "Not saved: " + e.message;
    noteState[id] = "error";
    // Reload the real row, but your typed note stays in the box and in the backup on this device.
    const { data } = await sb.from("ticks").select("*").eq("day", row.day).eq("member_key", row.member_key).maybeSingle();
    if (data) ticks[id] = data; else delete ticks[id];
  } else {
    error = "";
    const o = getOutbox();
    if (o[id]) { delete o[id]; putOutbox(o); }   // this newer save replaces one that waited offline
    flushOutbox();
    // If you kept typing while this was saving, the next save is already queued.
    noteState[id] = ticks[id] && (ticks[id].note || "") !== body.note ? "saving" : "saved";
    const d = getDraft(id);
    if (d && d.text === body.note) dropDraft(id);
  }
  render();
}

// ---------------------------------------------------------------- note backup on this device
// Every keystroke is also kept in this browser until the database confirms it, so a failed save,
// a closed tab or a dead battery never loses what you wrote. Reopening the ✎ panel brings it back.
const noteState = {};   // id -> saving | saved | error
const draftKey = id => "draft:" + id;
function getDraft(id) { try { return JSON.parse(localStorage.getItem(draftKey(id)) || "null"); } catch (e) { return null; } }
function putDraft(id, text) { try { localStorage.setItem(draftKey(id), JSON.stringify({ text, t: Date.now() })); } catch (e) {} }
function dropDraft(id) { try { localStorage.removeItem(draftKey(id)); } catch (e) {} }
// Throw away backups older than 10 days.
try { Object.keys(localStorage).filter(k => k.startsWith("draft:")).forEach(k => {
  const d = JSON.parse(localStorage.getItem(k) || "null"); if (!d || Date.now() - d.t > 10 * 864e5) localStorage.removeItem(k); }); } catch (e) {}

function renderNoteStatus() {
  const el = document.getElementById("note-status");
  if (!el || !editing) return;
  const id = editing.day + "|" + editing.key, st = noteState[id];
  el.className = "note-status " + (st === "error" ? "bad" : st === "saved" || st === "offline" ? "ok" : "");
  el.innerHTML = st === "saving" ? "Saving…"
    : st === "saved" ? `${ic("check", 14)}Saved`
    : st === "offline" ? `${ic("check", 14)}Saved on this device. Uploads when you're back online.`
    : st === "error" ? `Not saved yet. Your text is kept on this device. <button id="note-retry">Try again</button>`
    : "";
}

// ---------------------------------------------------------------- rule-break picker (standard + your own)
function tagPickHtml(rec) {
  const on = rec.rule_breaks || [], mine = settings.customBreaks || [], hidden = settings.hiddenBreaks || [];
  // standard tags you haven't hidden, then your own, then any tag still on this day that's no longer in your list
  const all = [...BREAKS.filter(([b]) => !hidden.includes(b) || on.includes(b)), ...mine.map(t => [t, t]),
               ...on.filter(t => !BREAK_LABEL[t] && !mine.includes(t)).map(t => [t, t])];
  return `<div class="tagpick">${all.map(([b, label]) => `<button data-break="${esc(b)}" aria-pressed="${on.includes(b)}">${esc(label)}</button>`).join("")}
    <button id="show-add-break" aria-label="Add your own rule break" style="border-style:dashed;color:var(--accent-text)">+ Add your own</button></div>
    <div class="addrow" id="add-break-row" hidden><input class="field" id="newbreak" maxlength="30" placeholder="e.g. Traded the news" aria-label="Your own rule break">
      <button class="btn primary small" id="add-break">Add</button></div>
    <p class="sub-hint" id="add-break-msg" style="margin-top:6px"></p>`;
}
function renderTagPick() {
  const box = document.getElementById("panel-tags");
  if (box && editing) box.innerHTML = tagPickHtml(tickOf(editing.day, editing.key) || {});
}
function addCustomBreak() {
  const input = document.getElementById("newbreak"), msg = document.getElementById("add-break-msg");
  const text = input.value.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 30);
  if (!text || !editing) return;
  const lower = text.toLowerCase(), mine = settings.customBreaks || [];
  // If it already exists (standard or yours), just tick that one instead of making a duplicate.
  const existing = BREAKS.find(([b, label]) => label.toLowerCase() === lower || b === lower)?.[0] || mine.find(t => t.toLowerCase() === lower);
  if (!existing) {
    if (mine.length >= MAX_CUSTOM_BREAKS) { msg.textContent = `You can have ${MAX_CUSTOM_BREAKS} of your own. Remove one in Settings first.`; return; }
    settings.customBreaks = [...mine, text];
    saveSettings();
  }
  const tag = existing || text;
  editTick(editing.day, editing.key, row => { if (!row.rule_breaks.includes(tag)) row.rule_breaks = [...row.rule_breaks, tag]; });
  renderTagPick();
}

// ---------------------------------------------------------------- personal settings
// Saved to your account (user_settings table) and cached in this browser so the right colors show instantly.
const DEFAULT_SETTINGS: Record<string, any> = { theme: "dark", customBreaks: [], hiddenBreaks: [], tutorialDone: false };
const MAX_CUSTOM_BREAKS = 12;
let settings = { ...DEFAULT_SETTINGS }, settingsOpen = false;
try { settings = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem("mnq-settings") || "{}") }; } catch (e) {}
function applyTheme() {
  const t = settings.theme;
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  const dark = t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => { m.removeAttribute("media"); m.content = dark ? "#17181c" : "#f5f5f7"; });
}
applyTheme();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
async function loadSettings() {
  const { data, error: e } = await sb.from("user_settings").select("settings").eq("user_id", session.user.id).maybeSingle();
  if (e) return;
  if (data) {
    settings = { ...DEFAULT_SETTINGS, ...data.settings };
    try { localStorage.setItem("mnq-settings", JSON.stringify(settings)); } catch (err) {}
    applyTheme();
  }
  settingsLoaded = true;
  maybeStartTour();
}
let settingsLoaded = false;
async function saveSettings() {
  try { localStorage.setItem("mnq-settings", JSON.stringify(settings)); } catch (e) {}
  applyTheme();
  if (session) await sb.from("user_settings").upsert({ user_id: session.user.id, settings, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
}
function customBreaksListHtml() {
  const mine = settings.customBreaks || [], hidden = settings.hiddenBreaks || [];
  const row = (label, btn) => `<div class="mem"><span style="flex:1;display:inline-flex;align-items:center;gap:6px">${ic("alert", 14)}${esc(label)}</span>${btn}</div>`;
  const shown = BREAKS.filter(([b]) => !hidden.includes(b)).map(([b, label]) => row(label, `<button class="btn plain small" data-hide-break="${b}">Hide</button>`)).join("");
  const own = mine.map(t => row(t + " (yours)", `<button class="btn danger small" data-remove-custom="${esc(t)}">Remove</button>`)).join("");
  const gone = BREAKS.filter(([b]) => hidden.includes(b));
  return shown + own
    + (gone.length ? `<p class="sub-hint" style="margin:12px 0 6px">Hidden:</p><div class="tagpick">${gone.map(([b, label]) =>
        `<button data-unhide-break="${b}" aria-label="Show ${esc(label)} again">+ ${esc(label)}</button>`).join("")}</div>` : "")
    + `<p class="sub-hint" style="margin-top:10px">Add your own in your note panel. Hiding or removing a tag only changes your list; days where you used it keep the tag.</p>`;
}
// ---------------------------------------------------------------- app icon on your home screen
let installPrompt = null;   // Android / Chrome / Edge give us an "Install" button; iPhone needs Share → Add to Home Screen
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installPrompt = e; });
const isInstalled = () => matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
function installHtml() {
  if (isInstalled()) return "";
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const how = installPrompt ? `<button class="btn primary small" id="install-app">Install LockedIn</button>`
    : ios ? `<p class="sub-hint" style="margin:0">In Safari: tap <b>Share</b> (the square with the arrow) → <b>Add to Home Screen</b> → <b>Add</b>.</p>`
    : `<p class="sub-hint" style="margin:0">Android (Chrome): tap <b>⋮</b> → <b>Add to Home screen</b>. Computer (Chrome / Edge): the install icon at the right of the address bar.</p>`;
  return `<h3>App on your phone</h3><p class="sub-hint">Get a LockedIn icon on your home screen. It opens full screen, like a normal app.</p>${how}`;
}
// ---------------------------------------------------------------- help & support page
const FAQ: any[] = [
  ["How do I join a group?", "Ask the group's owner for the join code (it looks like ABCD-1234) or their invite link. Sign in with Discord, choose <b>Join with a code</b>, and type it. You land on the group's waiting list until the owner approves you."],
  ["I'm waiting for approval. What now?", "Only the group's owner (or their admins) can let you in. Message them in Discord. Once they tap Approve, you're in with your Discord name."],
  ["How do I start my own group?", "Open <b>Groups</b> → <b>Start your own group</b>, type a name and send the request. Once it's approved you're the owner: your own join code, boxes, points, cutoff time, color and logo."],
  ["When does the day close?", "Each group has a cutoff time and time zone (by default 09:00 New York time). You can tick a day's boxes until the cutoff on the next trading day. After that the day is closed."],
  ["I missed the cutoff or ticked the wrong box", "Closed days can't be changed by members. Ask your group's owner or an admin: they can correct ticks, and excuse a day (sick, travelling) so it doesn't break your streak."],
  ["How do I get reminders on my iPhone?", "Notifications only work in the app from your Home Screen. In Safari tap <b>Share</b> → <b>Add to Home Screen</b>, open LockedIn from there, then <b>Settings</b> → <b>Remind me</b> and tap <b>Allow</b>."],
  ["What do Win, Loss, No trade and Gamble mean?", "Pick how your day went in your note panel. Gamble is a trade outside your plan. P&amp;L and R are optional; if you type a P&amp;L and haven't picked anything yet, it picks Win or Loss for you."],
  ["How long are my pictures kept?", "Up to 10 pictures per day. They're deleted automatically 60 days after the day, so save any you want to keep."],
  ["Who can see my notes, pictures and P&amp;L?", "Only the people in your group. Your group's owner and admins, and the app owner, can also see them to run the group and the app. Other groups never see anything of yours."],
  ["How do I change my name?", "Your name is your Discord display name. Change it in Discord and it updates in LockedIn the next time you sign in."],
  ["How do I leave a group?", "Open <b>Groups</b>, pick the group, and tap <b>Leave this group</b>."],
  ["How do I download or delete my data?", "<b>Settings</b> → <b>Your data</b>. Download my data gives you a copy of everything; Delete my account removes your account and everything in it."],
  ["Is LockedIn free?", "Yes, completely. There's nothing to buy. Nothing in LockedIn is financial or investment advice."],
];
// Help search: every word typed must appear in the question or the answer.
let faqQuery = "", faqOpenSlug = null;
const faqText = html => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const faqSlug = q => faqText(q).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/, "");
const faqWords = (q): string[] => [...new Set<string>(q.toLowerCase().split(/\s+/).filter(Boolean))];
const reEsc = w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// marks the typed words in the text between tags (P&amp;L is matched as P&L)
function faqMark(html, words) {
  if (!words.length) return html;
  const re = new RegExp("(" + words.map(reEsc).sort((a, b) => b.length - a.length).join("|") + ")", "gi");
  return html.split(/(<[^>]+>)/).map(part => part.startsWith("<") ? part : faqText(part).split(re).map((bit, i) => i % 2 ? `<mark>${esc(bit)}</mark>` : esc(bit)).join("")).join("");
}
function faqSnippet(text, words, radius = 44) {
  const low = text.toLowerCase(), at = Math.min(...words.map(w => low.indexOf(w)).filter(i => i >= 0));
  const from = Math.max(0, at - radius), to = Math.min(text.length, at + radius * 2);
  return (from > 0 ? "…" : "") + text.slice(from, to).trim() + (to < text.length ? "…" : "");
}
const faqLink = slug => location.origin + "/?faq=" + slug;
// a question link (lockedingroup.app/?faq=...) is remembered through the Discord sign-in
const FAQ_KEY = "lockedin.faq";
(function readFaqLink() {
  try {
    const u = new URL(location.href);
    if (!u.searchParams.has("faq")) return;
    const slug = u.searchParams.get("faq") || "";
    if (FAQ.some(([q]) => faqSlug(q) === slug)) sessionStorage.setItem(FAQ_KEY, slug);
    u.searchParams.delete("faq");
    history.replaceState(history.state, "", u.pathname + u.search + u.hash);
  } catch (err) { /* private mode: the link still opens the site */ }
})();
function openFaqLink() {
  let slug = "";
  try { slug = sessionStorage.getItem(FAQ_KEY) || ""; sessionStorage.removeItem(FAQ_KEY); } catch (err) { return; }
  if (!slug) return;
  tab = "help"; profileKey = null; faqQuery = ""; faqOpenSlug = slug;
}
function faqListHtml() {
  const words = faqWords(faqQuery);
  const hits = FAQ.filter(([q, a]) => { const t = (faqText(q) + " " + faqText(a)).toLowerCase(); return words.every(w => t.includes(w)); });
  if (!hits.length) {
    const mail = cfg.contactEmail;
    return `<div class="faq-none"><p>Nothing here matches "${esc(faqQuery.trim())}".</p>
      <div class="datarow"><button class="btn plain small" data-faq-clear>Show every question</button>${mail ? `<a class="btn plain small" href="mailto:${esc(mail)}?subject=${encodeURIComponent("LockedIn question")}">${ic("mail", 16)}Ask us instead</a>` : ""}</div></div>`;
  }
  return hits.map(([q, a]) => {
    const slug = faqSlug(q), qLow = faqText(q).toLowerCase();
    const snip = words.length && !words.every(w => qLow.includes(w)) ? `<span class="faq-snip">${faqMark(esc(faqSnippet(faqText(a), words)), words)}</span>` : "";
    return `<details id="faq-${slug}"${faqOpenSlug === slug ? " open" : ""}><summary><span><span class="faq-q">${faqMark(q, words)}</span>${snip}</span></summary>
      <p>${faqMark(a, words)}</p><button class="faq-link" data-faq-copy="${slug}">${ic("link", 14)}<span>Copy link to this answer</span></button></details>`;
  }).join("");
}
function faqCountText() {
  if (!faqWords(faqQuery).length) return "";
  const words = faqWords(faqQuery);
  const n = FAQ.filter(([q, a]) => { const t = (faqText(q) + " " + faqText(a)).toLowerCase(); return words.every(w => t.includes(w)); }).length;
  return n ? `${n} of ${FAQ.length} questions` : "";
}

function renderHelp() {
  const mail = cfg.contactEmail;
  const contact = `<div class="card help-contact"><div class="cardhead"><h2>Contact support</h2></div>
    <p class="empty">Questions, problems or ideas? Email us and we'll get back to you.</p>
    ${mail ? `<div class="datarow"><a class="btn primary small" href="mailto:${esc(mail)}?subject=${encodeURIComponent("LockedIn question")}">${ic("mail", 16)}Email support</a>
      <button class="btn plain small" id="copy-support">Copy address</button></div>
    <p class="support-mail">${esc(mail)}</p>` : `<p class="empty">The support address is coming soon.</p>`}
    <p class="empty help-note">Waiting to get into a group? Only that group's owner can approve you, so message them in Discord.</p></div>`;
  const install = installHtml();
  const start = `<div class="card help-start"><div class="cardhead"><h2>Getting started</h2></div>
    <button class="btn plain small" id="start-tour">${ic("target", 16)}Show the tutorial again</button>
    ${install ? `<div class="help-install">${install}</div>` : `<p class="empty" style="margin-top:12px">You're using LockedIn as an app. Nice.</p>`}</div>`;
  const legal = `<div class="card"><div class="cardhead"><h2>Your data and the rules</h2></div>
    <p class="empty">Download or delete your data in <button class="linkbtn" data-rail="settings">Settings</button>.</p>
    <p class="help-legal"><a href="?p=privacy" data-land="privacy">Privacy policy</a><a href="?p=terms" data-land="terms">Terms</a></p>
    <p class="empty help-copy">© 2026 Adam Batko</p></div>`;
  const faq = `<div class="card faq"><div class="cardhead"><h2>Questions</h2></div>
    <div class="faq-search" role="search">${ic("search", 18)}<input class="field" type="search" id="faq-search" value="${esc(faqQuery)}" placeholder="Search the questions" aria-label="Search the questions" autocomplete="off" enterkeyhint="search"></div>
    <p class="faq-count" aria-live="polite">${faqCountText()}</p>
    <div id="faq-list">${faqListHtml()}</div></div>`;
  return isWide()
    ? `<div class="desk"><div class="maincol">${faq}</div><div class="side">${contact}${start}${legal}</div></div>`
    : contact + faq + start + legal;
}

// Settings and Groups are normal pages (no side window).
function openSettings() { if (editing) closePanel(); setTab("settings"); loadPush(); }
function renderSettings() {
  const opt = (v, label) => `<button data-theme-set="${v}" aria-pressed="${settings.theme === v}">${label}</button>`;
  const look = `<section class="card setpage"><div class="cardhead"><h2>Appearance</h2></div>
    <div class="segset" role="group" aria-label="Appearance">${opt("system", "System")}${opt("light", "Light")}${opt("dark", "Dark")}</div>
    <p class="sub-hint" style="margin-top:8px">Dark is the default. System follows your phone or computer.</p>
</section>`;
  const remind = VAPID ? `<section class="card setpage"><div class="cardhead"><h2>Reminders</h2></div><div id="remind-box">${remindHtml()}</div></section>` : "";
  const breaks = `<section class="card setpage"><div class="cardhead"><h2>My rule breaks</h2></div><div id="settings-breaks">${customBreaksListHtml()}</div></section>`;
  const data = `<section class="card setpage"><div class="cardhead"><h2>Your data</h2></div>
    <p class="sub-hint">Download a copy of everything LockedIn stores about you, or delete your account.</p>
    <div class="datarow"><button class="btn plain small" id="export-data">Download my data</button>
      <button class="btn plain small danger" id="delete-account">Delete my account</button></div>
    <p class="sub-hint" id="data-msg" role="status" aria-live="polite"></p>
    <p class="sub-hint legal-links"><a href="?p=privacy" data-land="privacy">Privacy policy</a> · <a href="?p=terms" data-land="terms">Terms</a></p></section>`;
  const help = `<button class="helprow" data-nav="help">${ic("help", 20)}<span><b>Help &amp; support</b><small>Questions, contact, the app on your phone</small></span><span class="chev" aria-hidden="true">›</span></button>`;
  const intro = `<p class="page-intro">Only for you. Changes save to your account right away.</p>`;
  return isWide()
    ? intro + `<div class="desk"><div class="maincol">${look}${remind}${breaks}</div><div class="side">${data}${help}</div></div>`
    : intro + look + remind + breaks + data + help;
}

// ---------------------------------------------------------------- weekly reflection
// Each member writes their own for the current week (Friday's day stays open until Monday 09:00 New York).
const pendingRefl = {}, reflTimers = {};
// The weekly reflection is written on the last trading day of the week (Friday, or earlier if Friday is a holiday).
const isRecapDay = k => isTradingDay(k) && mondayOf(nextTrading(k)) !== mondayOf(k);
const canEditReflection = (week, key) => !!key && (isAdmin || (key === myKey() && week === mondayOf(today)));
function editReflection(week, key, field, value) {
  if (!canEditReflection(week, key)) return;
  const id = week + "|" + key;
  reflections[id] = Object.assign({ week_start: week, member_key: key, went_well: "", to_fix: "" }, reflections[id], { [field]: value });
  pendingRefl[id] = true;
  renderTop();
  clearTimeout(reflTimers[id]);
  reflTimers[id] = setTimeout(() => saveReflection(id), 700);
}
async function saveReflection(id) {
  const r = reflections[id];
  saving++; renderTop();
  const { error: e } = await sb.from("reflections").upsert(
    { week_start: r.week_start, member_key: r.member_key, went_well: r.went_well || "", to_fix: r.to_fix || "" }, { onConflict: "week_start,member_key" });
  saving--;
  delete pendingRefl[id];
  error = e ? "Reflection not saved: " + (/row-level security|42501/.test(e.message + e.code) ? "this week is closed." : e.message) : "";
  renderTop();
}

function renderReflections() {
  const week = weekStart, me = myKey(), editable = canEditReflection(week, me);
  const label = `${fmtDay(week, { weekday: undefined })} – ${fmtDay(addDays(week, 4), { weekday: undefined })}`;
  const mineRow = reflections[week + "|" + me] || {};
  // You write it in your ✎ panel; this card is for reading everyone's.
  const form = editable && canEdit(today, me) && isRecapDay(today) ? `<button class="reflect-nudge" id="goto-reflect" style="margin:0 0 6px">${ic("pen", 16)}${mineRow.went_well || mineRow.to_fix ? "Edit" : "Write"} your reflection</button>` : "";
  const entries = activeMembers().map(m => {
    const r = reflections[week + "|" + m.key];
    if (!r || !(r.went_well || r.to_fix)) return "";
    return `<div class="rentry"><div class="who">${avatarHtml(m, 24)}<button class="namebtn" data-profile="${m.key}">${esc(m.name)}</button>${m.key === me ? `<span class="you">YOU</span>` : ""}</div>
      ${r.went_well ? `<h3 class="rh">Went well</h3><p>${linkify(r.went_well)}</p>` : ""}${r.to_fix ? `<h3 class="rh">To fix</h3><p>${linkify(r.to_fix)}</p>` : ""}</div>`;
  }).join("");
  if (!form && !entries) return "";   // nothing to read yet, and it's not the day to write one
  return `<div class="card reflect" id="reflect"><div class="cardhead"><h2>Weekly reflection · ${label}</h2></div>
    ${form}${entries || `<p class="empty">No reflections for this week yet.</p>`}</div>`;
}

// ---------------------------------------------------------------- screenshots
// Stored privately in Supabase Storage as <day>/<member>/<time>.jpg; shown through short-lived signed links.
const MAX_SHOTS = 10;
const shotUrls = {}, shotRequested = new Set(), uploading = {};
let shotTarget = null, viewing = null;

function ensureShotUrls(paths) {
  const missing = paths.filter(p => !shotUrls[p] && !shotRequested.has(p));
  if (!missing.length) return;
  missing.forEach(p => shotRequested.add(p));
  sb.storage.from("screenshots").createSignedUrls(missing, 3600).then(({ data }) => {
    (data || []).forEach(d => { if (d.signedUrl) shotUrls[d.path] = d.signedUrl; });
    missing.forEach(p => { if (!shotUrls[p]) setTimeout(() => shotRequested.delete(p), 20000); });   // try again later
    scheduleRender();
  }).catch(() => missing.forEach(p => setTimeout(() => shotRequested.delete(p), 20000)));
}
// Signed links last an hour; refresh them before they run out.
setInterval(() => { Object.keys(shotUrls).forEach(p => delete shotUrls[p]); shotRequested.clear(); autoRender(); }, 50 * 60000);

// Shrink to max 1600px and JPEG, so a screenshot is ~200-300 KB instead of several MB.
async function shrink(file): Promise<any> {
  const src = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("couldn't read this image (try a PNG or JPG)"));
      img.src = src;
    });
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", 0.82));
    if (!blob) throw new Error("couldn't read this image");
    return blob;
  } finally { URL.revokeObjectURL(src); }
}

async function uploadShot(day, key, file) {
  if (!canEdit(day, key) || !file) return;
  if (((tickOf(day, key) || {}).images || []).length + (uploading[key] || 0) >= MAX_SHOTS) { error = `Max ${MAX_SHOTS} screenshots per day.`; return render(); }
  if (file.type && !file.type.startsWith("image/")) { error = "That file isn't a picture."; return render(); }
  uploading[key] = (uploading[key] || 0) + 1; render();
  try {
    const blob = await shrink(file);
    const path = `${day}/${key}/${Date.now()}.jpg`;
    const { error: e } = await sb.storage.from("screenshots").upload(path, blob, { contentType: "image/jpeg", upsert: false });
    if (e) throw e;
    shotUrls[path] = URL.createObjectURL(blob);
    error = "";
    editTick(day, key, row => { row.images = [...row.images, path]; });
  } catch (e) {
    error = "Screenshot not saved: " + (/row-level security|unauthorized|403/i.test(e.message || "") ? "this day is closed or the row isn't yours." : (e.message || e));
  } finally {
    uploading[key]--; render();
  }
}

// ---------------------------------------------------------------- full-screen picture viewer
// Shows every picture of that person's day. Swipe / arrow keys / ‹ › to move, pinch, double-tap or scroll to zoom.
const V = { s: 1, x: 0, y: 0 };          // zoom + pan of the current picture
function openViewer(day, key, path) {
  const list = ((tickOf(day, key) || {}).images || []).slice();
  if (!list.includes(path)) list.push(path);
  ensureShotUrls(list);
  viewing = { day, key, list, i: list.indexOf(path) };
  showViewerImage();
  const dlg = document.getElementById("viewer");
  if (!dlg.open) dlg.showModal();
}
function showViewerImage() {
  if (!viewing) return;
  const { day, key, list, i } = viewing, path = list[i], m = members.find(x => x.key === key);
  viewing.path = path;
  const img = document.getElementById("viewer-img");
  img.src = shotUrls[path] || "";
  img.alt = `Picture ${i + 1} from ${m ? m.name : key}`;
  document.getElementById("viewer-cap").innerHTML = `<b>${esc(m ? m.name : key)}</b> · ${esc(fmtDay(day))}`;
  document.getElementById("viewer-n").textContent = list.length > 1 ? `${i + 1} / ${list.length}` : "";
  document.getElementById("viewer-prev").hidden = i === 0;
  document.getElementById("viewer-next").hidden = i >= list.length - 1;
  const del = document.getElementById("viewer-delete");
  del.hidden = !canEdit(day, key); del.textContent = "Delete"; del.dataset.confirm = "";
  document.getElementById("viewer-report").hidden = !canReport(day, key);
  document.getElementById("viewer-hint").textContent = matchMedia("(hover: none)").matches
    ? (list.length > 1 ? "Swipe for more · pinch to zoom" : "Pinch or double-tap to zoom") : "Click or scroll to zoom";
  setZoom(1, 0, 0);
}
function stepViewer(dir) {
  if (!viewing) return;
  const n = viewing.i + dir;
  if (n < 0 || n >= viewing.list.length) return setZoom(1, 0, 0);
  viewing.i = n; showViewerImage();
}
// Keep the picture from sliding off screen while zoomed.
function setZoom(s, x, y) {
  const img = document.getElementById("viewer-img"), stage = document.getElementById("viewer-stage");
  s = Math.min(5, Math.max(1, s));
  const w = img.offsetWidth, h = img.offsetHeight;
  x = Math.min(0, Math.max(w - w * s, x)); y = Math.min(0, Math.max(h - h * s, y));
  if (s === 1) { x = 0; y = 0; }
  Object.assign(V, { s, x, y });
  img.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
  stage.classList.toggle("zoomed", s > 1);
}
// Zoom so the point under (cx, cy) on screen stays put.
function zoomAt(newS, cx, cy) {
  const r = document.getElementById("viewer-img").getBoundingClientRect();
  const left = r.left - V.x, top = r.top - V.y;          // where the unzoomed picture sits
  const px = (cx - left - V.x) / V.s, py = (cy - top - V.y) / V.s;
  const s = Math.min(5, Math.max(1, newS));
  setZoom(s, cx - left - px * s, cy - top - py * s);
}
(function viewerGestures() {
  const stage = document.getElementById("viewer-stage"), pts = new Map();
  let start = null, pinch = null, lastTap = 0;
  stage.addEventListener("pointerdown", e => {
    stage.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) start = { x: e.clientX, y: e.clientY, vx: V.x, vy: V.y, t: Date.now(), moved: false };
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: V.s };
    }
  });
  stage.addEventListener("pointermove", e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && pinch) {
      const [a, b] = [...pts.values()];
      zoomAt(pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
      if (start) start.moved = true;
      return;
    }
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (Math.abs(dx) + Math.abs(dy) > 8) start.moved = true;
    const img = document.getElementById("viewer-img");
    if (V.s > 1) setZoom(V.s, start.vx + dx, start.vy + dy);              // pan the zoomed picture
    else img.style.transform = `translateX(${dx}px)`;                      // follow the finger before a swipe
  });
  const end = e => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size > 0 || !start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y, s0 = start;
    start = null;
    if (V.s === 1 && s0.moved) {
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) return stepViewer(dx < 0 ? 1 : -1);
      if (dy > 110 && Math.abs(dy) > Math.abs(dx)) return document.getElementById("viewer").close();   // swipe down to close
      return setZoom(1, 0, 0);
    }
    if (s0.moved || e.type === "pointercancel") return;
    // A tap: double-tap (or a click with a mouse) zooms in / out; a tap beside the picture closes.
    const r = document.getElementById("viewer-img").getBoundingClientRect(), now = Date.now();
    const onImg = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (e.pointerType === "mouse") { if (onImg) zoomAt(V.s > 1 ? 1 : 2.5, e.clientX, e.clientY); else document.getElementById("viewer").close(); return; }
    if (now - lastTap < 300) { lastTap = 0; zoomAt(V.s > 1 ? 1 : 2.5, e.clientX, e.clientY); return; }
    lastTap = now;
    if (!onImg && V.s === 1) setTimeout(() => { if (lastTap === now) document.getElementById("viewer").close(); }, 300);
  };
  stage.addEventListener("pointerup", end);
  stage.addEventListener("pointercancel", end);
  stage.addEventListener("wheel", e => { e.preventDefault(); zoomAt(V.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY); }, { passive: false });
  document.getElementById("viewer").addEventListener("close", () => { viewing = null; setZoom(1, 0, 0); });
  document.addEventListener("keydown", e => {
    if (!document.getElementById("viewer").open) return;
    if (e.key === "ArrowRight") stepViewer(1);
    if (e.key === "ArrowLeft") stepViewer(-1);
  });
})();

// ---------------------------------------------------------------- reports
// Members can report someone else's picture or note. People who can already delete it (owners, group admins) don't need to.
const canReport = (day, key) => !!session && !!myKey() && key !== myKey() && !canEdit(day, key);
let reporting = null;
function openReport(kind, day, key, image?) {
  if (!canReport(day, key)) return;
  const m = members.find(x => x.key === key);
  reporting = { kind, day, key, image: image || "" };
  document.getElementById("report-title").textContent = kind === "picture" ? "Report this picture" : kind === "comment" ? "Report this comment" : "Report this note";
  document.getElementById("report-what").textContent = `From ${m ? m.name : key} · ${fmtDay(day)}`;
  document.querySelectorAll('input[name="rep-reason"]').forEach(r => { r.checked = false; });
  document.getElementById("report-detail").value = "";
  document.getElementById("report-msg").textContent = "";
  const send = document.getElementById("report-send"); send.disabled = false; send.textContent = "Send report";
  document.getElementById("reportdlg").showModal();
}
async function sendReport() {
  const msg = document.getElementById("report-msg"), send = document.getElementById("report-send");
  const pick = document.querySelector('input[name="rep-reason"]:checked');
  if (!reporting) return;
  if (!pick) { msg.textContent = "Pick what's wrong with it first."; return; }
  send.disabled = true; send.textContent = "Sending…";
  const { error: e } = await sb.rpc("report_content", { r_day: reporting.day, r_key: reporting.key, r_kind: reporting.kind,
    r_image: reporting.image, r_reason: pick.value, r_detail: document.getElementById("report-detail").value.trim() });
  if (e) { msg.textContent = e.message; send.disabled = false; send.textContent = "Send report"; return; }
  msg.textContent = "Thanks. The group owner will look at it.";
  send.textContent = "Sent";
  setTimeout(() => { const d = document.getElementById("reportdlg"); if (d.open) d.close(); }, 1400);
}
const REASON_LABEL = { inappropriate: "Inappropriate or explicit", harassment: "Harassment or hate", spam: "Spam", other: "Something else" };
// Open reports for the owner. withGroup: the app owner's list across all groups.
function reportsCardHtml(list, withGroup) {
  if (!list.length) return "";
  ensureShotUrls(list.filter(r => r.kind === "picture").map(r => r.image));
  const rows = list.map(r => {
    const who = (members.find(x => x.key === r.member_key) || {}).name || r.member_key;
    const g = groups.find(x => x.id === r.group_id);
    const thumb = r.kind === "picture"
      ? `<button class="repthumb" data-report-view="${r.id}" aria-label="Open the reported picture" style="${shotUrls[r.image] ? `background-image:url('${shotUrls[r.image]}')` : ""}"></button>`
      : `<span class="repnote" aria-hidden="true">${ic("book", 22)}</span>`;
    return `<div class="reprow">${thumb}<div>
      <b>${r.kind === "picture" ? "Picture" : r.kind === "comment" ? "Comment" : "Note"} from ${esc(who)}</b>
      <span class="sub">${esc(REASON_LABEL[r.reason] || r.reason)} · ${esc(fmtDay(r.day))}${withGroup && g ? ` · ${esc(g.name)}` : ""}</span>
      ${r.detail ? `<span class="sub">“${esc(r.detail)}”</span>` : ""}
      ${r.excerpt ? `<blockquote>${esc(r.excerpt)}</blockquote>` : ""}
      <div class="actions"><button class="btn danger small" data-report-remove="${r.id}">Remove ${r.kind === "picture" ? "picture" : r.kind === "comment" ? "comment" : "note"}</button>
        <button class="btn plain small" data-report-keep="${r.id}">Keep it</button></div></div></div>`;
  }).join("");
  return `<div class="card"><div class="cardhead"><h2>Reports <span class="count">${list.length}</span></h2></div>
    <p class="empty" style="margin:-4px 0 6px">Members reported these. Remove it, or keep it if it's fine. Either way the report is closed.</p>${rows}</div>`;
}
// Remove the reported picture or note (straight from the database, so it also works for groups you don't have open), then close the report.
async function resolveReport(id, remove) {
  const r = reports.find(x => x.id === id);
  if (!r) return;
  if (remove && r.kind === "comment") {
    const del = await sb.from("comments").delete().eq("id", Number(r.image));
    if (del.error) { error = del.error.message; return render(); }
    dropCommentLocal(Number(r.image));
    const same = reports.filter(x => x.kind === "comment" && x.image === r.image).map(x => x.id);
    return adminDo(sb.from("reports").update({ status: "handled" }).in("id", same), "Comment removed.");
  }
  if (remove) {
    const cur = await sb.from("ticks").select("images, note").eq("day", r.day).eq("member_key", r.member_key).maybeSingle();
    if (cur.error) { error = cur.error.message; return render(); }
    if (cur.data) {
      if (r.kind === "picture") {
        const st = await sb.storage.from("screenshots").remove([r.image]);
        if (st.error) { error = "Couldn't delete the picture: " + st.error.message; return render(); }
        const up = await sb.from("ticks").update({ images: (cur.data.images || []).filter(p => p !== r.image) }).eq("day", r.day).eq("member_key", r.member_key);
        if (up.error) { error = up.error.message; return render(); }
      } else {
        const up = await sb.from("ticks").update({ note: "" }).eq("day", r.day).eq("member_key", r.member_key);
        if (up.error) { error = up.error.message; return render(); }
      }
    }
    // other reports about the same thing are done too
    const same = reports.filter(x => x.day === r.day && x.member_key === r.member_key && x.kind === r.kind && x.image === r.image).map(x => x.id);
    return adminDo(sb.from("reports").update({ status: "handled" }).in("id", same), r.kind === "picture" ? "Picture removed." : "Note removed.");
  }
  return adminDo(sb.from("reports").update({ status: "handled" }).eq("id", id), "Report closed. The post stays.");
}

async function removeShot(day, key, path) {
  if (!canEdit(day, key)) return;
  const { error: e } = await sb.storage.from("screenshots").remove([path]);
  if (e) { error = "Couldn't delete: " + e.message; return render(); }
  editTick(day, key, row => { row.images = row.images.filter(p => p !== path); });
}

// ---------------------------------------------------------------- edit panel (note + pictures for one row)
function openPanel(day, key) {
  if (!canEdit(day, key)) return;
  if (!inlineOK(day)) { tab = "day"; profileKey = null; selected = day; weekStart = mondayOf(day); window.scrollTo(0, 0); }
  editing = { day, key };
  const m = members.find(x => x.key === key), rec = tickOf(day, key) || {};
  const panel = document.getElementById("panel");
  // Unsaved text from earlier (failed save, closed tab): bring it back and save it now.
  const id = day + "|" + key, draft = getDraft(id);
  let noteText = rec.note || "";
  if (draft && draft.text !== noteText && !pending[id]) {
    noteText = draft.text;
    setTimeout(() => editTick(day, key, row => { row.note = draft.text; }, true), 0);
  } else if (draft) dropDraft(id);
  if (noteState[id] === "saved") delete noteState[id];
  panel.innerHTML = `<div class="grab" aria-hidden="true"></div>
    <header><div><b id="panel-title" role="heading" aria-level="2">${inlineOK(day) ? "Note &amp; pictures" : esc(m ? m.name : key)}</b><span>${fmtDay(day, { weekday: "long", month: "long" })}</span></div>
      <button class="round" id="panel-close" aria-label="Close">${SYM.x}</button></header>
    <h3 class="result-h">How did the day go?</h3>
    <div class="segset four result-set" role="group" aria-label="How did the day go?">${resultBtnsHtml(rec)}</div>
    <p class="sub-hint" id="result-hint">${resultHint(rec)}</p>
    <div class="numrow">
      <label class="numfield"><span>P&amp;L</span><b aria-hidden="true">$</b><input id="panel-pnl" inputmode="decimal" autocomplete="off" placeholder="0" value="${hasNum(rec.pnl) ? +rec.pnl : ""}" aria-label="P&L in dollars"></label>
      <label class="numfield"><span>R</span><input id="panel-rr" inputmode="decimal" autocomplete="off" placeholder="0" value="${hasNum(rec.rr) ? +rec.rr : ""}" aria-label="Risk-reward in R"></label>
    </div>
    <p class="sub-hint" id="num-hint">Optional. Use a minus for a loss, like -150. Your group sees it.</p>
    <h3>Note</h3>
    <textarea id="panel-note" maxlength="10000" placeholder="What did you trade, what did you learn?">${esc(noteText)}</textarea>
    <p class="note-status" id="note-status" aria-live="polite"></p>
    <h3>Pictures <span id="panel-pics-count"></span></h3>
    <p class="sub-hint" style="margin:-4px 0 8px">Pictures are deleted automatically 60 days after the day.</p>
    <div class="pics" id="panel-pics"></div>
    <h3>Rule breaks today</h3>
    <p class="sub-hint">Be honest: it never costs points, and it helps you spot patterns.</p>
    <div id="panel-tags">${tagPickHtml(rec)}</div>
    ${(wk => canEditReflection(wk, key) && isRecapDay(day) ? `<h3 id="panel-refl">Weekly reflection · ${fmtDay(wk, { weekday: undefined })} – ${fmtDay(addDays(wk, 4), { weekday: undefined })}</h3>
    <div class="reflect">
      <label for="panel-refl-well">What went well</label>
      <textarea id="panel-refl-well" data-refl="went_well" data-week="${wk}" data-key="${key}" maxlength="600" placeholder="Patience on entries, followed the plan…">${esc((reflections[wk + "|" + key] || {}).went_well)}</textarea>
      <label for="panel-refl-fix">What to fix next week</label>
      <textarea id="panel-refl-fix" data-refl="to_fix" data-week="${wk}" data-key="${key}" maxlength="600" placeholder="Stop moving my stop, size down after a loss…">${esc((reflections[wk + "|" + key] || {}).to_fix)}</textarea>
      <p class="hint">Saves automatically · the whole group can read it</p></div>` : "")(mondayOf(day))}
    ${isAdmin ? `<h3>Admin</h3>
    <label class="switchrow"><span><b>Excused</b><small>Sick, travelling… Doesn't count as missed, doesn't break the streak.</small></span>
      <input type="checkbox" id="panel-excused" role="switch" ${rec.excused ? "checked" : ""}></label>` : ""}
    <button class="btn primary done" id="panel-done">Done</button>`;
  panelMode = inlineOK(day) ? "inline" : "drawer";
  setPanelRole();
  panel.hidden = false;
  if (panelMode === "inline") {
    render();   // draws the spot under the row and moves the note section into it
    requestAnimationFrame(() => panelEl.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }));
  } else {
    document.getElementById("scrim").hidden = false;
    document.body.style.overflow = "hidden";
  }
  panelOpened();
  renderPanelPics();
}

// ---------------------------------------------------------------- note section: rolls down inside the row
// On the Day list the note, pictures and rule breaks open right under that person's row (or under
// "Your homework"). Settings, Groups and notes for other days still open as a window.
var panelEl = document.getElementById("panel");
var panelMode = "drawer";   // "inline" | "drawer" (var: render() can run before this line)
const inlineOK = day => day === selected && screen === "app" && !profileKey && tab !== "admin" && tab !== "me" && tab === "day";
const inlineHere = (key, k) => panelMode === "inline" && !!editing && editing.key === key && editing.day === k;
function setPanelRole() {
  panelEl.setAttribute("role", panelMode === "inline" ? "region" : "dialog");
  if (panelMode === "inline") panelEl.removeAttribute("aria-modal"); else panelEl.setAttribute("aria-modal", "true");
}
function dockPanel() {
  if (!panelEl) panelEl = document.getElementById("panel");
  if (panelEl.parentElement !== document.body) document.body.appendChild(panelEl);
  panelEl.classList.remove("inline");
}
// Called by render(): keeps the open note section inside its row, or closes it if the row isn't on screen anymore.
function mountInline() {
  if (!panelEl) panelEl = document.getElementById("panel");
  if (panelMode === "inline" && editing) {
    const slot = document.getElementById("inline-slot");
    if (slot) { if (panelEl.parentElement !== slot) slot.appendChild(panelEl); panelEl.classList.add("inline"); return; }
    editing = null; panelEl.hidden = true;   // another day or page: close it
  }
  dockPanel();
}

function closePanel() {
  if (!editing && !settingsOpen) return;
  editing = null; settingsOpen = false;
  document.getElementById("panel").hidden = true;
  document.getElementById("scrim").hidden = true;
  document.body.style.overflow = "";
  render();
  // keyboard users land back on the button that opened the window
  const back = panelOpener && panelOpener.isConnected ? panelOpener : panelOpener && panelOpener.id && document.getElementById(panelOpener.id);
  if (back && back.focus) back.focus({ preventScroll: true });
  panelOpener = null;
}
// A window (note, Settings, Groups) takes keyboard focus and keeps it inside until it closes.
let panelOpener = null;
function panelOpened() {
  const panel = document.getElementById("panel");
  const a = document.activeElement;
  if (!panelOpener && a && a !== document.body && !panel.contains(a)) panelOpener = a;
  if (!panel.contains(a)) { const c = document.getElementById("panel-close"); if (c) c.focus({ preventScroll: true }); }
}
document.addEventListener("keydown", e => {
  if (e.key !== "Tab") return;
  const panel = document.getElementById("panel");
  if (panel.hidden || panelMode === "inline") return;
  const items = [...panel.querySelectorAll('button, a[href], input, textarea, select, [tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled && x.offsetParent !== null);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (!panel.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

function renderPanelPics() {
  if (!editing) return;
  const { day, key } = editing;
  if (!canEdit(day, key)) return closePanel();   // the day closed while the panel was open
  const images = (tickOf(day, key) || {}).images || [], busy = uploading[key] || 0;
  ensureShotUrls(images);
  const tiles = images.map((p, i) => `<div class="pic">
      <button class="open" data-view-shot="${key}|${esc(p)}" aria-label="Open picture ${i + 1}" style="${shotUrls[p] ? `background-image:url('${shotUrls[p]}')` : ""}"></button>
      <button class="remove" data-remove-shot="${esc(p)}" aria-label="Delete picture ${i + 1}">${SYM.x}</button></div>`).join("")
    + Array.from({ length: busy }, () => `<div class="pic busy">Uploading…</div>`).join("")
    + (images.length + busy < MAX_SHOTS ? `<button class="addpic" data-add-shot="${key}">${SVG.camera}Add picture${matchMedia("(hover: hover)").matches ? `<small>or paste ⌘V / drop here</small>` : ""}</button>` : "");
  document.getElementById("panel-pics").innerHTML = tiles;
  document.getElementById("panel-pics-count").textContent = `· ${images.length}/${MAX_SHOTS}`;
}

// ---------------------------------------------------------------- admin actions
async function adminDo(promise, okMsg) {
  const res = await promise;
  const e = res.error;
  error = e ? e.message : "";
  flash = !e && okMsg ? okMsg : "";
  await refreshAfterAdmin();
  render();
  return res;
}
// Re-read groups, people and names after a change (and leave a group that no longer exists).
// An open actions menu (People) closes when you click anywhere else.
document.addEventListener("click", e => { document.querySelectorAll(".pmenu[open]").forEach(m => { if (!m.contains(e.target as Node)) m.open = false; }); });
// Approve and Reject show the result right away; the server and a refresh follow. If the server says no, it's undone.
async function instantPerson(uid, patch, promise, okMsg) {
  const p = people.find(x => x.user_id === uid), before = p ? { ...p } : null;
  if (p) Object.assign(p, patch);
  flash = okMsg; error = ""; render();
  const res = await promise;
  if (res.error && p) Object.assign(p, before);
  return adminDo(Promise.resolve(res), okMsg);
}
async function refreshAfterAdmin() {
  adminDirty = false;   // saved: the page may redraw again
  await loadGroups();
  if (!group() || !canOpen(group())) { loaded = false; return loadAll(); }
  applyGroupRules(group());
  isAdmin = canManageGroup();
  const [, m] = await Promise.all([
    isAdmin ? loadPeople() : null,
    sb.from("members").select("*").eq("group_id", gid),
    isAppOwner ? loadOwnerData() : null,
  ]);
  if (!m.error) members = m.data;
  today = currentTradingDay();
}
let flash = "";

// ---------------------------------------------------------------- groups: join, request, settings, logo
const memberQ = (patch, uid) => sb.from("memberships").update(patch).eq("group_id", gid).eq("user_id", uid);

// Invite links: lockedingroup.app/?join=ABCD-1234. The code is remembered through the Discord sign-in, then used once.
const INVITE_KEY = "lockedin.invite";
(function readInvite() {
  try {
    const u = new URL(location.href);
    if (!u.searchParams.has("join")) return;
    const c = (u.searchParams.get("join") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (/^[A-Z0-9]{8}$/.test(c)) localStorage.setItem(INVITE_KEY, c.slice(0, 4) + "-" + c.slice(4));
    u.searchParams.delete("join");
    history.replaceState(history.state, "", u.pathname + u.search + u.hash);
  } catch (err) { /* private mode: the link still opens the site */ }
})();
const pendingInvite = () => { try { return localStorage.getItem(INVITE_KEY) || ""; } catch (err) { return ""; } };
const inviteLink = code => location.origin + "/?join=" + encodeURIComponent(code);
async function useInvite() {
  const code = pendingInvite();
  if (!code || !session) return false;
  try { localStorage.removeItem(INVITE_KEY); } catch (err) { /* nothing to clean */ }
  const { data, error: e } = await sb.rpc("join_group", { code });
  joinMsg = e ? `That invite link didn't work: ${e.message}` : data.status === "approved" ? `You're already in ${data.name}.`
    : data.status === "pending" ? `Invite link used. Waiting for the owner of ${data.name} to approve you.` : `${data.name} didn't accept you.`;
  return true;
}

async function joinWithCode() {
  const el = document.getElementById("joincode"), code = el ? el.value.trim() : "";
  if (!code) return;
  const { data, error: e } = await sb.rpc("join_group", { code });
  joinMsg = e ? e.message : data.status === "approved" ? `You're already in ${data.name}.` : data.status === "pending" ? `Sent! Waiting for the owner of ${data.name} to approve you.` : `${data.name} didn't accept you.`;
  await loadGroups();
  if (screen === "app" && settingsOpen) openGroupsPanel(); else render();
}

async function sendGroupRequest() {
  const name = (document.getElementById("req-name").value || "").replace(/[<>]/g, "").trim(), note = (document.getElementById("req-note").value || "").trim();
  if (!name) { joinMsg = "Give your group a name first."; requestOpen = true; }
  else {
    const { error: e } = await sb.from("group_requests").insert({ name, note });
    joinMsg = e ? (/row-level security/i.test(e.message) ? "You already have 3 requests waiting." : e.message) : `Request sent for ${name}. You'll get it as soon as it's approved.`;
    requestOpen = !!e;
    await loadGroups();
  }
  if (screen === "app" && settingsOpen) openGroupsPanel(); else render();
}

async function saveGroupSettings() {
  const msg = document.getElementById("save-group-msg"), val = id => document.getElementById(id).value;
  const boxes = {};
  for (const k of SLOTS) {
    const label = val("box-label-" + k).replace(/[<>]/g, "").trim().slice(0, 30) || DEFAULT_BOXES[k].label;
    boxes[k] = { label, kind: val("box-kind-" + k) };
  }
  if (!SLOTS.some(k => boxes[k].kind === "req")) { msg.textContent = "At least one box has to be Required."; return; }
  const num = id => Math.max(0, Math.min(10, Math.round(+val(id) || 0)));
  const patch = {
    name: val("g-name").replace(/[<>]/g, "").trim().slice(0, 40) || group().name,
    color: (document.querySelector('[data-color][aria-checked="true"]') || {} as any).dataset?.color || group().color,
    boxes, points: { complete: num("pt-complete"), partial: num("pt-partial"), bonus: num("pt-bonus") },
    cutoff_hour: +val("g-cutoff"), timezone: val("g-tz"),
  };
  msg.textContent = "Saving…";
  const saved = await adminDo(sb.from("groups").update(patch).eq("id", gid), "Group settings saved.");
  if (!saved.error) { setGuideFlag("b"); render(); }
  window.scrollTo(0, 0);
}

// Square, 256px, JPEG: small and quick for everyone.
async function uploadLogo(file) {
  if (!file || !isGroupOwner()) return;
  try {
    const src = URL.createObjectURL(file), img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("couldn't read this image")); img.src = src; });
    const c = document.createElement("canvas"), side = Math.min(img.naturalWidth, img.naturalHeight);
    c.width = c.height = 256;
    c.getContext("2d").drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
    URL.revokeObjectURL(src);
    const blob = await new Promise<Blob>(r => c.toBlob(r, "image/jpeg", 0.86));
    const path = `${gid}/${Date.now()}.jpg`, old = group().logo_path;
    const { error: e } = await sb.storage.from("logos").upload(path, blob, { contentType: "image/jpeg", upsert: false });
    if (e) throw e;
    await adminDo(sb.from("groups").update({ logo_path: path }).eq("id", gid), "Logo updated.");
    if (old) sb.storage.from("logos").remove([old]);
  } catch (e) { error = "Logo not saved: " + (e.message || e); render(); }
}

// ---------------------------------------------------------------- rendering helpers
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Text with clickable links (only http/https). Shows a short "instagram.com/p/…" label; the full address is on hover.
function linkify(text) {
  return esc(text).replace(/https?:\/\/[^\s<]+/g, raw => {
    const trail = raw.match(/[.,;:!?)\]]+$/), url = trail ? raw.slice(0, -trail[0].length) : raw;
    let label = url.replace(/^https?:\/\/(www\.)?/, "");
    if (label.length > 34) label = label.slice(0, 32) + "…";
    return `<a href="${url}" target="_blank" rel="noopener noreferrer nofollow" title="${url}">${label}</a>${trail ? trail[0] : ""}`;
  });
}
const dot = (st, name?) => `<span class="dot ${st}" role="img" aria-label="${name ? esc(name) + ": " : ""}${LABEL[st]}" title="${LABEL[st]}">${ICON[st]}</span>`;
const wideQuery = window.matchMedia("(min-width: 960px)");
const isWide = () => wideQuery.matches;
const pendingCount = () => people.filter(p => p.status === "pending").length + (isAppOwner ? requests.filter(r => r.status === "pending").length : 0);

function tabsList() { return isAdmin ? ["day", "week", "board", "admin", "me"] : ["day", "week", "board", "me"]; }

// "17h 07m left", or "42m left" in the last hour. With html, only the digits are in the mono face.
function leftText(mins, html = false) {
  const n = v => html ? `<span class="num">${v}</span>` : String(v);
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${n(h)}h ${n(String(m).padStart(2, "0"))}m left` : `${n(m)}m left`;
}
// Phones: once the summary card has scrolled away, the top bar shows the time left and how many are still open
// in place of the group name, so the cutoff never leaves the screen.
function topClockHtml() {
  if (tab !== "day" || selected !== today || isFinal(today)) return "";
  const list = activeMembers(), mins = Math.max(0, Math.round((closesAt(today) - Date.now()) / 60000));
  const open = list.filter(m => !["COMPLETE", "EXCUSED"].includes(statusOf(today, m.key))).length;
  const time = leftText(mins);
  return `<span class="topclock ${mins <= 60 ? "urgent" : ""}" aria-hidden="true">${time} · ${open ? `${open} open` : "all done"}</span>`;
}
let sumWatchOn = false;
function watchSummary() {
  const check = () => {
    const el = document.querySelector("#app .daysum"), top = document.getElementById("topbar");
    const off = !!el && !isWide() && !!top && el.getBoundingClientRect().bottom < top.getBoundingClientRect().bottom;
    document.body.classList.toggle("sum-off", off);
  };
  if (!sumWatchOn) {
    sumWatchOn = true;
    let queued = false;
    addEventListener("scroll", () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; check(); }); } }, { passive: true });
    addEventListener("resize", check);
  }
  requestAnimationFrame(check);
}

function statusText() {
  if (error) return `<small class="err">${esc(error.length > 48 ? "Not saved" : error)}</small>`;
  return saving || Object.keys(pending).length ? `<small>Saving…</small>` : "";
}

// The date in the top bar opens the phone's / browser's own calendar to jump to any day.
function datePickHtml() {
  const first = Object.keys(ticks).reduce((a, id) => id.slice(0, 10) < a ? id.slice(0, 10) : a, today);
  return `<span class="datepick"><b>${fmtDay(selected)}</b><input type="date" id="daypick" value="${selected}" min="${first}" max="${today}" aria-label="Jump to a day"></span>`;
}
function goToDay(k) {
  if (!k) return;
  if (k > today) k = today;
  while (!isTradingDay(k)) k = addDays(k, -1);
  selected = k; weekStart = mondayOf(k);
  render();
}
// Group logo (or a colored initial) and the group-name button that opens the Groups sheet.
function logoUrl(g) { return g && g.logo_path ? sb.storage.from("logos").getPublicUrl(g.logo_path).data.publicUrl : ""; }
function groupLogo(g, px) {
  const url = logoUrl(g);
  return `<span class="glogo acc-${esc(g ? g.color : "blue")}" style="width:${px}px;height:${px}px;font-size:${Math.round(px * 0.48)}px" aria-hidden="true">${esc(((g && g.name) || "?").trim()[0].toUpperCase())}${url ? `<img src="${esc(url)}" alt="" onerror="this.remove()">` : ""}</span>`;
}
function groupButton(px) {
  const g = group();
  return `<button class="gname" id="open-groups" aria-label="Groups: ${esc(g ? g.name : "")}">${groupLogo(g, px)}<span>${esc(g ? g.name : "Groups")}</span>${pendingElsewhere() ? `<i class="gdot" aria-hidden="true"></i>` : ""}<svg class="chev" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
}
const XMARK = `<span class="x" aria-hidden="true">${SYM.x}</span>`;
// Your Discord profile picture (or the person icon if there isn't one).
function myAvatarUrl() {
  const m = members.find(x => x.key === myKey()), meta = session && session.user.user_metadata;
  return (profile && profile.avatar_url) || (m && m.avatar_url) || (meta && meta.avatar_url) || "";
}
function meIcon() {
  const url = myAvatarUrl();
  const src = url ? url + (url.includes("?") ? "&" : "?") + "size=64" : "";
  return `<span class="meav" aria-hidden="true">${src ? `<img src="${esc(src)}" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith(document.createRange().createContextualFragment(SVG.me))">` : SVG.me}</span>`;
}
// App owner: group requests waiting. (People waiting in the open group show on the Admin tab.)
const pendingElsewhere = () => isAppOwner && requests.some(r => r.status === "pending") && tab !== "admin" ? 1 : 0;
// ---------------------------------------------------------------- updating the page in place
// Instead of rebuilding the page (which made every profile picture flicker when you ticked a box),
// compare the new page with what's on screen and change only what's different.
function morph(el, html) {
  const next = document.createElement(el.tagName === "MAIN" ? "div" : el.tagName);
  next.innerHTML = html;
  morphKids(el, next);
}
const sameKind = (a, b) => a.nodeType === b.nodeType && a.nodeName === b.nodeName && (a.nodeType !== 1 || (a.id || "") === (b.id || ""));
function morphKids(from, to) {
  let a = from.firstChild, b = to.firstChild;
  while (b) {
    const nb = b.nextSibling;
    if (!a) from.appendChild(b);
    else if (sameKind(a, b)) { morphNode(a, b); a = a.nextSibling; }
    else { const na = a.nextSibling; from.replaceChild(b, a); a = na; }
    b = nb;
  }
  while (a) { const na = a.nextSibling; from.removeChild(a); a = na; }
}
function morphNode(a, b) {
  if (a.nodeType !== 1) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return; }
  if (a.hasAttribute("data-persist")) return;   // holds the open note section
  // a picture whose address changed is swapped whole, so it never shows the old picture
  if (a.tagName === "IMG" && a.getAttribute("src") !== b.getAttribute("src")) { a.replaceWith(b); return; }
  for (const { name } of [...a.attributes]) if (!b.hasAttribute(name) && !(name === "open" && a.tagName === "DETAILS")) a.removeAttribute(name);
  for (const { name, value } of [...b.attributes]) if (a.getAttribute(name) !== value) a.setAttribute(name, value);
  const field = /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName), typing = field && document.activeElement === a;
  if (a.tagName === "INPUT") {
    if (!typing && a.value !== b.value) a.value = b.value;
    if (a.checked !== b.checked) a.checked = b.checked;
    return;
  }
  if (a.tagName === "TEXTAREA") { if (!typing && a.value !== b.value) a.value = b.value; return; }
  morphKids(a, b);
  if (a.tagName === "SELECT" && !typing) a.value = b.value;
}

const PAGE_TITLE = { day: "Today", week: "Week", board: "Ranking", journal: "Journal", me: "Me", admin: "Admin", help: "Help & support", settings: "Settings", groups: "Groups" };
function renderTop() {
  renderNoteStatus();
  const top = document.getElementById("topbar");
  top.hidden = screen !== "app";
  if (screen !== "app") return;
  if (profileKey && tab !== "admin") {
    const m = members.find(x => x.key === profileKey);
    morph(top, isWide()
      ? `${groupButton(24)}<div class="center"><b>${esc(m ? m.name : "Profile")}</b></div><div class="end"><button id="profile-back" class="gearbtn" aria-label="Close profile" title="Close">${XMARK}</button></div>`
      : `<span></span><div class="mid"><b>${esc(m ? m.name : "")}</b></div><button class="round" id="profile-back" aria-label="Close profile">${SYM.x}</button>`);
    return;
  }
  if (isWide()) {
    const status = error ? `<span class="err">${esc(error)}</span>` : saving || Object.keys(pending).length ? "Saving…" : "";
    morph(top, `${groupButton(24)}
      <div class="center">${tab === "day" ? `
        <button class="round" id="prev" aria-label="Previous trading day">‹</button>
        ${datePickHtml()}
        <button class="round" id="next" aria-label="Next trading day" ${selected >= today ? "disabled" : ""}>›</button>` : tab === "week" ? `
        <button class="round" id="pw" aria-label="Previous week">‹</button>
        <b>${fmtDay(weekStart, { weekday: undefined })} – ${fmtDay(addDays(weekStart, 4), { weekday: undefined })}</b>
        <button class="round" id="nw" aria-label="Next week" ${weekStart >= mondayOf(today) ? "disabled" : ""}>›</button>`
        : `<b>${tab === "admin" ? (adminViews().find(v => v[0] === adminView) || ["", "Admin"])[1] : tab === "me" ? "Profile" : PAGE_TITLE[tab] || ""}</b>`}
      </div>
      <div class="end"><span>${status}</span>${tab === "day" && selected !== today ? `<button id="gotoday">Today</button>` : tab === "week" && weekStart !== mondayOf(today) ? `<button id="thisweek">This week</button>` : ""}
        </div>`);
    return;
  }
  let prev = `<span></span>`, next = `<span></span>`, mid;
  if (tab === "day") {
    prev = `<button class="round" id="prev" aria-label="Previous trading day">‹</button>`;
    next = `<button class="round" id="next" aria-label="Next trading day" ${selected >= today ? "disabled" : ""}>›</button>`;
    mid = `${datePickHtml()}${selected !== today ? `<button id="gotoday">Today</button>` : statusText()}`;
  } else if (tab === "week") {
    prev = `<button class="round" id="pw" aria-label="Previous week">‹</button>`;
    next = `<button class="round" id="nw" aria-label="Next week" ${weekStart >= mondayOf(today) ? "disabled" : ""}>›</button>`;
    mid = `<b>${fmtDay(weekStart, { weekday: undefined })} – ${fmtDay(addDays(weekStart, 4), { weekday: undefined })}</b>${statusText()}`;
  } else {
    mid = `<b>${PAGE_TITLE[tab] || ""}</b>${statusText()}`;
    if (tab === "admin" || tab === "me" || tab === "journal") next = `<button class="round" id="close-admin" aria-label="Close ${PAGE_TITLE[tab]}">${SYM.x}</button>`;
  }
  morph(top, prev + `<div class="mid">${groupButton(16)}${topClockHtml()}${mid}</div>` + next);
  watchSummary();
}

// Computers: the sidebar on the left. One page per thing, grouped: your group, you, and (for admins) running the group.
function adminViews() {
  return [["people", "People"], isGroupOwner() && ["group", "Group settings"], isAppOwner && ["all", "All groups"]].filter(Boolean);
}
function fixAdminView() { if (!adminViews().some(v => v[0] === adminView)) adminView = "people"; }
function renderRail() {
  const rail = document.getElementById("rail");
  const on = screen === "app" && isWide() && !legalOpen();
  rail.hidden = !on; document.body.classList.toggle("has-rail", on);
  if (!on) return;
  fixAdminView();
  const here = (t, v) => !profileKey && tab === t && (!v || adminView === v);
  const item = (t, v, icon, label, extra = "", id = "") => `<button ${id ? `id="${id}" ` : ""}data-nav="${t}${v ? ":" + v : ""}"${here(t, v) ? ' aria-current="page"' : ""}>${icon}<span>${label}</span>${extra}</button>`;
  const badge = n => n ? `<span class="count" aria-label="${n} waiting">${n}</span>` : "";
  const reqs = isAppOwner ? requests.filter(r => r.status === "pending").length : 0;
  const g = group();
  morph(rail, `<span class="rail-ind" aria-hidden="true"></span>
    <div class="rail-brand"><img class="rail-logo" src="icons/icon-192.png" alt="">LockedIn</div>
    <p class="rail-h">${esc(g ? g.name : "Group")}</p>
    ${item("day", "", SVG.day, "Today")}
    ${item("week", "", SVG.week, "Week")}
    ${item("board", "", SVG.board, "Ranking")}
    <p class="rail-h">You</p>
    ${item("me", "", meIcon(), "Profile", "", "toggleme")}
    ${item("journal", "", ic("book", 19), "Journal")}
    ${isAdmin ? `<p class="rail-h">Admin</p>
    ${item("admin", "people", SVG.admin, "People", badge(pendingCount()), "toggleadmin")}
    ${isGroupOwner() ? item("admin", "group", SVG.gear, "Group settings") : ""}
    ${isAppOwner ? item("admin", "all", ic("layers", 19), "All groups", badge(reqs)) : ""}` : ""}
    <span class="rail-sep"></span>
    ${item("groups", "", ic("users", 19), "Groups")}
    ${item("settings", "", ic("sliders", 19), "Settings")}
    ${item("help", "", ic("help", 19), "Help")}`);
  const ind = rail.querySelector(".rail-ind"), cur2 = rail.querySelector('[aria-current="page"]');
  if (ind) { ind.style.opacity = cur2 ? "1" : "0"; if (cur2) ind.style.transform = `translateY(${cur2.offsetTop + cur2.offsetHeight / 2 - 10}px)`; }
}
function renderTabbar() {
  const bar = document.getElementById("tabbar");
  bar.hidden = screen !== "app";
  if (screen !== "app") return;
  const list = tabsList(), labels = { day: "Day", week: "Week", board: "Ranking", admin: "Admin", me: "Me" };
  const cur = /^(journal|settings|groups|help)$/.test(tab) ? "me" : tab, i = Math.max(0, list.indexOf(cur));
  morph(bar, `<div class="pill" style="width:calc((100% - 10px) / ${list.length});transform:translateX(${i * 100}%);opacity:${list.includes(cur) ? 1 : 0}" aria-hidden="true"></div>` +
    list.map(t => `<button data-tab="${t}"${t === cur ? ' aria-current="page"' : ""} aria-label="${labels[t]}">${t === "admin" ? SVG.gear : t === "me" ? meIcon() : SVG[t]}<span>${labels[t]}</span>
      ${t === "admin" && pendingCount() ? `<i class="badge">${pendingCount()}</i>` : ""}</button>`).join(""));
}

// Phone bottom bar: press and hold (or just slide sideways), drag the glass lens across, let go to switch.
(function tabLens() {
  const bar = document.getElementById("tabbar");
  let st = null, justDragged = false;
  const tabsIn = () => [...bar.querySelectorAll("button[data-tab]")];
  const tabAt = x => { const b = tabsIn(); if (!b.length) return null;
    const r = bar.getBoundingClientRect(), w = (r.width - 10) / b.length;
    return b[Math.max(0, Math.min(b.length - 1, Math.floor((x - r.left - 5) / w)))]; };
  function begin() {
    const r = bar.getBoundingClientRect(), n = tabsIn().length || 1, w = (r.width - 10) / n;
    const lens = document.createElement("div");
    lens.className = "tablens"; lens.setAttribute("aria-hidden", "true");
    const lw = w + 18, lh = r.height + 16;
    Object.assign(lens.style, { width: lw + "px", height: lh + "px", top: (r.top - 8) + "px" });
    const track = document.createElement("div");
    track.className = "lens-track";
    Object.assign(track.style, { width: r.width + "px", height: r.height + "px", top: "8px" });
    track.innerHTML = tabsIn().map(b => `<div data-k="${b.dataset.tab}">${b.innerHTML}</div>`).join("");
    lens.appendChild(track); document.body.appendChild(lens);
    Object.assign(st, { lens, track, r, w, lw, lh, on: true, hot: null });
    bar.classList.add("lensing");
    try { bar.setPointerCapture(st.id); } catch (_) {}
    place(st.x, 0);
    void lens.offsetWidth;   // start from the small size, then spring up
    lens.classList.add("up");
    if (navigator.vibrate) navigator.vibrate(8);
  }
  function place(x, v) {
    const { lens, track, r, lw } = st;
    const cx = Math.max(r.left + 5 + st.w / 2, Math.min(r.right - 5 - st.w / 2, x));
    const left = cx - lw / 2;
    lens.style.left = left + "px";
    // the magnified copy of the bar inside the lens, centred on the finger
    track.style.left = (r.left - left) + "px";
    track.style.transformOrigin = `${cx - r.left}px 50%`;
    track.style.transform = "scale(1.28, 1.34)";
    lens.style.setProperty("--lx", ((cx - r.left) / r.width).toFixed(3));
    // a little stretch in the direction you move, like a drop of liquid
    const s = Math.min(0.22, Math.abs(v) * 0.016);
    if (lens.classList.contains("up")) lens.style.transform = `scale(${1 + s}, ${1 - s * 0.55})`;
    const hot = tabAt(cx);
    if (hot !== st.hot) {
      tabsIn().forEach(b => b.classList.toggle("hot", b === hot));
      track.querySelectorAll("[data-k]").forEach(d => d.classList.toggle("hot", hot && d.dataset.k === hot.dataset.tab));
      if (st.hot && navigator.vibrate) navigator.vibrate(5);
      st.hot = hot;
    }
  }
  function end(cancel) {
    if (!st) return;
    clearTimeout(st.timer);
    const s0 = st; st = null;
    if (!s0.on) return;
    justDragged = true; setTimeout(() => { justDragged = false; }, 400);
    const target = cancel ? null : s0.hot, b = tabsIn(), i = target ? b.indexOf(target) : -1;
    if (i >= 0) s0.lens.style.left = (s0.r.left + 5 + s0.w * i + s0.w / 2 - s0.lw / 2) + "px";
    s0.lens.style.transform = "";
    s0.lens.classList.add("drop");
    setTimeout(() => { s0.lens.remove(); bar.classList.remove("lensing"); b.forEach(x => x.classList.remove("hot")); }, 320);
    if (target && target.dataset.tab) setTab(target.dataset.tab);
  }
  bar.addEventListener("pointerdown", e => {
    if (e.button !== 0 || bar.hidden || st) return;
    st = { id: e.pointerId, x0: e.clientX, x: e.clientX, t: performance.now(), on: false };
    st.timer = setTimeout(() => { if (st && !st.on) begin(); }, 220);
  });
  bar.addEventListener("pointermove", e => {
    if (!st || e.pointerId !== st.id) return;
    const now = performance.now(), v = (e.clientX - st.x) / Math.max(1, now - st.t) * 16;
    st.x = e.clientX; st.t = now;
    if (!st.on && Math.abs(e.clientX - st.x0) > 8) { clearTimeout(st.timer); begin(); }
    if (st.on) place(e.clientX, v);
  });
  bar.addEventListener("pointerup", () => end(false));
  bar.addEventListener("pointercancel", () => end(true));
  bar.addEventListener("lostpointercapture", () => { if (st && st.on) end(false); });
  // the tap that ends a drag must not also count as a tap on the tab under it
  bar.addEventListener("click", e => { if (justDragged) { e.stopPropagation(); e.preventDefault(); } }, true);
  bar.addEventListener("contextmenu", e => e.preventDefault());
})();

// The row of boxes adapts to the group's boxes: long names get more room; more than 4 wrap on phones.
function togglesStyle() {
  const cols = RULES.map(r => r[1].length > 12 ? "1.6fr" : "1fr").join(" ");
  const n = RULES.length, phone = n <= 4 ? `repeat(${n}, 1fr)` : "repeat(3, 1fr)";
  return `--cols:${cols};--pcols:${phone}`;
}
// ---------------------------------------------------------------- views
// Phones: other people's rows are one short line ("Missing Journal, HTF"). An owner taps it to get the boxes.
let openRow = null;
// a ticked bonus box shows a plus (extra points), a ticked required box a check
const PLUS_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`;
function miniStatus(k, key, rec) {
  const st = statusOf(k, key);
  if (st === "EXCUSED") return "Excused";
  const req = RULES.filter(r => r[2] === "req"), bonus = RULES.filter(r => r[2] === "bonus" && rec[r[0]]);
  if (st === "COMPLETE") return "All done" + (bonus.length ? `, plus ${bonus.map(r => esc(r[1])).join(", ")}` : "");
  const missing = req.filter(r => !rec[r[0]]);
  if (missing.length === req.length && !bonus.length) return "Nothing ticked yet";
  return `Missing ${missing.map(r => esc(r[1])).join(", ")}`;
}
function renderDay() {
  const k = selected, now = Date.now(), list = activeMembers();
  const close = closesAt(k);
  let time, mins = null;
  if (isFinal(k)) time = dayHasAny(k) ? "Closed" : "Not logged";
  else { mins = Math.max(0, Math.round((close - now) / 60000)); time = leftText(mins, true); }
  const urgent = mins !== null && mins <= 60;   // last hour: the timer turns red
  const mine = myKey() && list.some(m => m.key === myKey()) ? statusOf(k, myKey()) : null;
  const banner = urgent && mine && mine !== "COMPLETE" && mine !== "EXCUSED"
    ? `<div class="urgent-banner" role="alert">${ic("clock", 18)}${mins} min left to finish your homework</div>` : "";
  // Fridays: a reminder to write the weekly reflection, until you've written one.
  const ownRefl = myKey() ? reflections[mondayOf(today) + "|" + myKey()] : null;
  const nudge = k === today && isRecapDay(today) && myKey() && !(ownRefl && (ownRefl.went_well || ownRefl.to_fix))
    ? `<button class="reflect-nudge" id="goto-reflect">${ic("pen", 16)}Write your weekly reflection</button>` : "";

  const counts: Record<string, number> = {};
  list.forEach(m => { const s = statusOf(k, m.key); counts[s] = (counts[s] || 0) + 1; });

  // Phones: big buttons for your own homework at the top (today only).
  const me = myKey(), quickOn = !isWide() && k === today && me && list.some(m => m.key === me) && canEdit(k, me);
  let quick = "";
  if (quickOn) {
    const rec = tickOf(k, me) || {};
    quick = `<div class="card quick"><div class="cardhead"><h2>Your homework</h2></div><div class="qgrid">${RULES.map(([r, label, kind]) =>
      `<button class="q ${kind}" data-tick="${me}:${r}" aria-pressed="${!!rec[r]}"><span class="qc">${!rec[r] ? "" : kind === "bonus" ? PLUS_SVG : ic("check", 18).replace('<circle cx="12" cy="12" r="9"/>', "")}</span>
        <span><b>${label}</b><small>${kind === "bonus" ? (rec[r] ? "Bonus, +" + POINTS.bonus : "Bonus") : "Required"}</small></span></button>`).join("")}</div>
      <button class="qnote" data-edit="${me}" aria-expanded="${inlineHere(me, k)}">${SVG.note.replace("<svg ", '<svg width="18" height="18" ')}${inlineHere(me, k) ? "Close note & pictures" : rec.note || (rec.images || []).length ? "Edit note & pictures" : "Add note & pictures"}</button>
      ${inlineHere(me, k) ? `<div id="inline-slot" data-persist></div>` : ""}</div>`;
  }
  // Your own row first, so you don't have to look for it. Then the people who still have homework open,
  // then the ones who are done, then excused. The question on this page is who isn't done yet.
  const RANK = { WAITING: 0, UNLOGGED: 0, MISSING: 0, PARTIAL: 1, COMPLETE: 2, EXCUSED: 3 };
  const others = list.filter(m => m.key !== myKey()).map((m, i) => ({ m, i, r: RANK[statusOf(k, m.key)] ?? 0 }))
    .sort((a, b) => a.r - b.r || a.i - b.i).map(x => x.m);
  const ordered = [...list.filter(m => m.key === myKey()), ...others];
  const allShots = [];
  const rows = ordered.map(m => {
    const st = statusOf(k, m.key), rec = tickOf(k, m.key) || {}, editable = canEdit(k, m.key);
    const toggles = RULES.map(([r, label, kind]) =>
      `<button class="t ${kind}${editable && m.key !== myKey() ? " guard" : ""}" data-tick="${m.key}:${r}" aria-pressed="${!!rec[r]}" ${editable ? "" : "disabled"}
        aria-label="${esc(m.name)}: ${label}${kind === "bonus" ? " (bonus)" : ""}"><span class="lbl-full">${label}</span><span class="lbl-short" aria-hidden="true">${shortLabel(label)}</span></button>`).join("");
    const note = rec.note ? `<p>${linkify(rec.note)}</p>` : "";
    const images = rec.images || [];
    allShots.push(...images);
    const open = inlineHere(m.key, k) && !(quickOn && m.key === me);
    const editBtn = editable ? `<button class="icon ${rec.note || images.length ? "has" : ""} ${open ? "on" : ""}" data-edit="${m.key}" aria-expanded="${open}" aria-label="Note and pictures for ${esc(m.name)}" title="Note &amp; pictures">${SVG.note}</button>` : `<span class="nb-space"></span>`;
    const shots = images.map((p, i) => `<button class="shot" data-view-shot="${m.key}|${esc(p)}" aria-label="Screenshot ${i + 1} from ${esc(m.name)}"
        style="${shotUrls[p] ? `background-image:url('${shotUrls[p]}')` : ""}"></button>`).join("")
      + Array.from({ length: uploading[m.key] || 0 }, () => `<span class="shot busy">Uploading…</span>`).join("");
    const compact = !isWide() && m.key !== myKey() && openRow !== m.key;
    const showToggles = !(quickOn && m.key === me) && !compact;   // yours is already at the top as big buttons
    const mini = !compact ? "" : editable
      ? `<button class="mini" data-expand="${m.key}" aria-label="${esc(m.name)}: ${miniStatus(k, m.key, rec)}. Change their boxes">${miniStatus(k, m.key, rec)}<span class="mini-edit">Change</span></button>`
      : `<p class="mini">${miniStatus(k, m.key, rec)}</p>`;
    return `<div class="member ${editable ? "" : "locked"}">
      <div class="mrow"><span class="name">${avatarHtml(m, 26)}<button class="namebtn" data-profile="${m.key}">${esc(m.name)}</button>${m.key === myKey() ? `<span class="you">YOU</span>` : ""}${resultTag(rec)}</span>${editBtn}${dot(st, m.name)}</div>
      ${showToggles ? `<div class="toggles" style="${togglesStyle()}">${toggles}</div>` : mini}
      ${(rec.rule_breaks || []).length || pnlChipHtml(rec) ? `<div class="breaks">${pnlChipHtml(rec)}${(rec.rule_breaks || []).map(b => `<span class="bchip">${ic("alert", 13)}${esc(BREAK_LABEL[b] || b)}</span>`).join("")}</div>` : ""}
      ${note ? `<div class="note">${note}${canReport(k, m.key) ? `<button class="reportlink" data-report-note="${k}|${m.key}">Report note</button>` : ""}</div>` : ""}
      ${shots ? `<div class="shots">${shots}</div>` : ""}
      ${rec.note || images.length ? reactBarHtml(k, m.key) + commentsPanelHtml(k, m.key) : ""}
      ${open ? `<div id="inline-slot" data-persist></div>` : ""}
    </div>`;
  }).join("");
  ensureShotUrls(allShots);

  // One block that answers "how long is left, and who still has to do it".
  const due = list.length - (counts.EXCUSED || 0), doneN = counts.COMPLETE || 0;
  // The weekday is only needed when the cutoff isn't today or tomorrow (a Friday closes on Monday).
  const closeDay = nextTrading(k), nearby = closeDay === today || closeDay === addDays(today, 1);
  const at = `<span class="num">${hh(CUTOFF_HOUR)}</span> ${esc(tzCity(TZ))}`;
  const cutoff = nearby ? at : `${fmtDay(closeDay, { day: undefined, month: undefined })} ${at}`;
  const openPeople = ordered.filter(m => !["COMPLETE", "EXCUSED"].includes(statusOf(k, m.key)));
  const openNames = openPeople.map(m => (m.key === myKey() ? "You" : esc(m.name)) + (statusOf(k, m.key) === "PARTIAL" ? " (partly)" : ""));
  const shown = openNames.length > 6 ? openNames.slice(0, 5).join(", ") + ` and ${openNames.length - 5} more` : openNames.join(", ");
  const openLine = !list.length ? "" : openPeople.length
    ? `<p class="open-line"><b>${isFinal(k) ? "Not done" : "Still open"}</b> ${shown}</p>`
    : `<p class="open-line all">${due ? "Everyone is done." : "Everyone is excused."}</p>`;
  // Read top to bottom: how long, until when, how many are done. One bar: the share that is done.
  const pct = due ? Math.round(doneN / due * 100) : 0;
  const progress = due ? `<div class="sum-done">
      <p><span class="num">${doneN}</span> of <span class="num">${due}</span> done</p>
      <div class="donebar" role="progressbar" aria-label="Members done" aria-valuemin="0" aria-valuemax="${due}" aria-valuenow="${doneN}"><i style="width:${pct}%"></i></div>
    </div>` : "";
  const summary = `<div class="card daysum">
    <p class="sum-time ${urgent ? "urgent" : ""}">${time}</p>
    <p class="sum-until">${isFinal(k) ? "Cutoff was" : "until"} ${cutoff}</p>
    ${progress}
    ${openLine}
    ${banner}${nudge}
  </div>`;
  const err = error && !isWide() && error.length > 48 ? `<div class="card"><p class="msg err">${esc(error)}</p></div>` : "";
  return { summary: guideNudgeHtml() + summary + quick, list: err + `<div class="card"><div class="cardhead"><h2>${esc((group() || {}).name || "Your group")} ${k === today ? "today" : "on " + fmtDay(k, { weekday: "short" })}</h2></div>${rows || `<p class="empty">No members yet.</p>`}</div>` };
}

function renderWeek() {
  const days = [0, 1, 2, 3, 4].map(i => addDays(weekStart, i));
  const head = days.map(k => `<th>${fmtDay(k, { day: undefined, month: undefined })}<br>${parse(k).getUTCDate()}</th>`).join("");
  const body = activeMembers().map(m => `<tr><td class="who"><button class="namebtn" data-profile="${m.key}">${esc(m.name)}</button></td>${days.map(k => {
    if (!isTradingDay(k) || k > today) return `<td><div class="cell none">·</div></td>`;
    const st = statusOf(k, m.key), tip = `${m.name}, ${fmtDay(k)}: ${LABEL[st]}`;
    return `<td><button class="cell ${st} ${k === today ? "today" : ""}" data-day="${k}" title="${esc(tip)}" aria-label="${esc(tip)}">${ICON[st]}</button></td>`;
  }).join("")}</tr>`).join("");
  const key = ["COMPLETE", "PARTIAL", "MISSING", "WAITING", "UNLOGGED", "EXCUSED"].map(st => `<li><span class="cell ${st}" aria-hidden="true">${ICON[st]}</span>${st === "WAITING" ? "Today, not done yet" : LABEL[st]}</li>`).join("");
  return `<div class="card"><div class="cardhead"><h2>This week</h2></div>
    <p class="page-hint">Each square is one person's homework for one day. Tap a square to open that day, or a name to see their profile.</p>
    <div class="grid-wrap"><table class="grid"><thead><tr><th class="who"><span class="sr-only">Member</span></th>${head}</tr></thead><tbody>${body}</tbody></table></div>
    <ul class="legend" aria-label="What the squares mean">${key}</ul></div>`;
}

// Everyone's points, streaks and badges. Remembered until the next change (the ranking asks for every member).
function stats(key) {
  if (statsCache.has(key)) return statsCache.get(key);
  const result = computeStats(key);
  statsCache.set(key, result);
  return result;
}
function computeStats(key) {
  const days = tickDays || (tickDays = [...new Set(Object.keys(ticks).map(id => id.slice(0, 10)))].filter(isTradingDay).sort());
  let points = 0, run = 0, best = 0, closed = 0, complete = 0, last = null;
  let noTrades = 0, completeDays = 0, social = 0, notes = 0, pics = 0, comebacks = 0, prevSt = null, since = null;
  let wins = 0, losses = 0, gambles = 0, sitOuts = 0;
  let pnlSum = 0, pnlDays = 0, bestDay = null, rSum = 0, rDays = 0;   // only days where it was filled in   // the day results members pick (excused days included: it's about trading)
  const weeks: Record<string, any> = {};   // monday -> {n: closed days counted, ex: excused days, ok: all Complete, open: has an open day}
  const bonusBoxes = RULES.filter(r => r[2] === "bonus").map(r => r[0]);
  for (const k of days) {
    if (last && nextTrading(last) !== k) run = 0;   // an unlogged trading day in between breaks a streak
    last = k;
    const raw = tickOf(k, key), rec = raw || {}, st = statusOf(k, key);
    const w = weeks[mondayOf(k)] = weeks[mondayOf(k)] || { n: 0, ex: 0, ok: true, open: false };
    if (rec.note) notes++;
    pics += (rec.images || []).length;
    if (hasNum(rec.pnl)) { pnlSum += +rec.pnl; pnlDays++; bestDay = bestDay === null ? +rec.pnl : Math.max(bestDay, +rec.pnl); }
    if (hasNum(rec.rr)) { rSum += +rec.rr; rDays++; }
    const res = resultOf(rec);
    if (res === "win") wins++; else if (res === "loss") losses++; else if (res === "gamble") gambles++; else if (res === "notrade") sitOuts++;
    if (st === "EXCUSED") { w.ex++; continue; }   // no points, no streak change, not counted in %
    if (raw && !since) since = k;
    const bonusTicks = bonusBoxes.filter(b => rec[b]).length;   // the group's bonus boxes
    social += bonusTicks;
    points += (POINTS[st] || 0) + POINTS.bonus * bonusTicks;
    if (st === "COMPLETE") { run++; best = Math.max(best, run); completeDays++; if (prevSt === "MISSING") comebacks++; if (rec.no_trade) noTrades++; }
    else if (isFinal(k)) run = 0;
    if (isFinal(k)) { closed++; if (st === "COMPLETE") complete++; prevSt = st; w.n++; if (st !== "COMPLETE") w.ok = false; }
    else w.open = true;
  }
  if (last && last !== today && nextTrading(last) < today) run = 0;
  // A perfect week: every trading day Mon-Fri closed and Complete (excused days are skipped).
  const perfectWeeks = Object.entries(weeks).filter(([mon, w]) =>
    w.ok && !w.open && w.n > 0 && w.n + w.ex === [0, 1, 2, 3, 4].filter(i => isTradingDay(addDays(mon, i))).length).length;
  return { points, run, best, rate: closed ? Math.round(100 * complete / closed) : null,
           completeDays, social, notes, pics, comebacks, perfectWeeks, noTrades, since,
           pnl: pnlDays ? Math.round(pnlSum * 100) / 100 : null, bestDay, avgR: rDays ? Math.round(rSum / rDays * 100) / 100 : null,
           wins, losses, gambles, sitOuts, winRate: wins + losses ? Math.round(100 * wins / (wins + losses)) : null };
}

// ---------------------------------------------------------------- achievements
const TIERS = ["bronze", "silver", "gold", "diamond", "legend"];
const ACHIEVEMENTS = [
  { id: "streak",   icon: "flame", unit: "day streak",        metric: s => s.best,         goals: [5, 10, 20, 50, 100] },
  { id: "complete", icon: "check", unit: "complete days",     metric: s => s.completeDays, goals: [10, 25, 50, 100, 250] },
  { id: "week",     icon: "calendar", unit: "perfect weeks",     metric: s => s.perfectWeeks, goals: [1, 4, 12], one: "Perfect week" },
  { id: "shots",    icon: "camera", unit: "screenshots",       metric: s => s.pics,         goals: [1, 25, 100], one: "First screenshot" },
  { id: "notes",    icon: "pen", unit: "journal notes",     metric: s => s.notes,        goals: [10, 50, 150] },
  { id: "social",   icon: "megaphone", get unit() { const b = RULES.filter(r => r[2] === "bonus");
      return b.length === 1 ? (b[0][1].toLowerCase() === "social" ? "social posts" : b[0][1] + " days") : "bonus ticks"; },
    metric: s => s.social, goals: [5, 25, 100] },
  { id: "points",   icon: "diamond", unit: "points",            metric: s => s.points,       goals: [100, 500, 1000] },
  { id: "comeback", icon: "repeat", unit: "comebacks",         metric: s => s.comebacks,    goals: [1, 5], one: "Back on track" },
  { id: "patience", icon: "pause", unit: "no-trade days",     metric: s => s.noTrades,     goals: [1, 10, 25], one: "Sat out" },
  { id: "first",    icon: "target", unit: "complete day",      metric: s => s.completeDays, goals: [1], one: "First complete" },
];
function badgesFor(s) {
  return ACHIEVEMENTS.flatMap(a => a.goals.map((goal, i) => {
    const have = a.metric(s);
    return { id: a.id + goal, icon: a.icon, tier: TIERS[i], goal, have: Math.min(have, goal), earned: have >= goal,
             title: goal === 1 && a.one ? a.one : `${goal} ${a.unit}` };
  }));
}
const topStreakBadge = s => badgesFor(s).filter(b => b.id.startsWith("streak") && b.earned).pop();
// Discord picture when we have one; otherwise (or if it fails to load) a colored circle with the initial.
function avatarHtml(m, px) {
  const url = m.avatar_url ? m.avatar_url + (m.avatar_url.includes("?") ? "&" : "?") + "size=" + (px > 40 ? 128 : 64) : "";
  return `<span class="av" style="width:${px}px;height:${px}px;font-size:${Math.round(px * 0.44)}px;background:${avatarColor(m.key)}" aria-hidden="true">${esc((m.name.trim()[0] || "?").toUpperCase())}${url
    ? `<img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}</span>`;
}
const avatarColor = key => `hsl(${[...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)} 45% 42%)`;

function rankOf(key) {
  const rows = activeMembers().map(m => ({ key: m.key, name: m.name, ...stats(m.key) }))
    .sort((a, b) => b.points - a.points || b.run - a.run || a.name.localeCompare(b.name));
  let rank = 0, prev = null;
  for (let i = 0; i < rows.length; i++) {
    if (!prev || rows[i].points !== prev.points || rows[i].run !== prev.run) rank = i + 1;
    prev = rows[i];
    if (rows[i].key === key) return rank;
  }
  return null;
}

// Owner / Admin / Member. Your own is always known; group managers also see everyone else's.
function roleForKey(key) {
  const g = group();
  if (!g) return "";
  if (key === myKey()) return g.owner_id === session.user.id ? "Owner" : (myMembership() || {}).role === "admin" ? "Admin" : "Member";
  const p = people.find(x => x.member_key === key && x.status === "approved");
  if (!p) return "";
  return p.user_id === g.owner_id ? "Owner" : p.role === "admin" ? "Admin" : "Member";
}
let profilePart = "profile";   // someone else's profile: "profile" or "journal"
// Profile and Journal of one person. withTabs adds the small switch between the two (someone else's page, or Me on phones).
function renderProfile(key, part = "profile", withTabs = false) {
  const m = members.find(x => x.key === key);
  if (!m) return `<div class="card"><p class="msg">Member not found.</p></div>`;
  const s = stats(key), badges = badgesFor(s), earned = badges.filter(b => b.earned).length;
  const since = s.since ? parse(s.since).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "–";

  const head = `<div class="card">
    <div class="phead">${avatarHtml(m, 64)}
      <div><h1>${esc(m.name)}${key === myKey() ? `<span class="you">YOU</span>` : ""}${(r => r ? `<span class="rolechip role-${r.toLowerCase()}">${r}</span>` : "")(roleForKey(key))}</h1><p>Rank #${rankOf(key) || "–"} · since ${since}</p></div></div>
    <h3 class="tg-h">Habit</h3>
    <div class="tiles">
      <div class="tile"><b>${s.run}</b><span>Streak</span><small>Best ${s.best}</small></div>
      <div class="tile"><b>${s.rate === null ? "–" : s.rate + "%"}</b><span>Of days done</span></div>
      <div class="tile"><b>${s.points}</b><span>Points</span></div>
    </div>
    ${s.wins + s.losses + s.gambles + s.sitOuts > 0 || s.pnl !== null || s.avgR !== null ? `<h3 class="tg-h">Trading</h3>
    <div class="tiles">
      <div class="tile"><b>${s.winRate === null ? "–" : s.winRate + "%"}</b><span>Win rate</span><small>${s.wins}W ${s.losses}L</small></div>
      <div class="tile"><b class="${s.pnl > 0 ? "up" : s.pnl < 0 ? "down" : ""}">${s.pnl === null ? "–" : fmtPnl(s.pnl)}</b><span>Total P&amp;L</span></div>
      <div class="tile"><b>${s.avgR === null ? "–" : fmtR(s.avgR)}</b><span>Average R</span></div>
    </div>
    <p class="sub-hint tiles-note">Win rate counts only Win and Loss days. P&amp;L and R count only days where they were filled in.</p>` : ""}</div>`;

  // Only the badges you've earned; the rest are folded away. With none earned yet, the 3 closest show instead.
  const locked = badges.filter(b => !b.earned).sort((a, b) => b.have / b.goal - a.have / a.goal);
  const shown = earned ? badges.filter(b => b.earned) : locked.slice(0, 3), rest = earned ? locked : locked.slice(3);
  const badgeHtml = b => `<div class="badge tier-${b.tier} ${b.earned ? "" : "locked"}" title="${esc(b.title)}">
      <div class="medal"><span>${ic(b.icon, 26)}</span></div><b>${esc(b.title)}</b>
      ${b.earned ? `<small>${b.tier}</small>` : `<div class="bar" role="img" aria-label="${b.have} of ${b.goal}"><i style="width:${Math.round(100 * b.have / b.goal)}%"></i></div><small>${b.have}/${b.goal}</small>`}
    </div>`;
  const ach = `<div class="card"><div class="cardhead"><h2>Badges · ${earned} of ${badges.length}</h2></div>
    <div class="badges">${shown.map(badgeHtml).join("")}</div>
    ${rest.length ? `<details class="more-badges"><summary>${earned ? `Show the ${rest.length} still to earn` : `Show all ${badges.length} badges`}</summary><div class="badges">${rest.map(badgeHtml).join("")}</div></details>` : ""}</div>`;

  // Last 12 weeks, one column per week, Mon-Fri rows.
  const firstMon = addDays(mondayOf(today), -77);
  const weeksCols = Array.from({ length: 12 }, (_, i) => addDays(firstMon, i * 7));
  const heatRows = [0, 1, 2, 3, 4].map(d => `<tr><th>${["Mon", `<span class="sr-only">Tue</span>`, "Wed", `<span class="sr-only">Thu</span>`, "Fri"][d]}</th>${weeksCols.map(mon => {
    const k = addDays(mon, d);
    if (!isTradingDay(k) || k > today) return `<td><i class="none"></i></td>`;
    const st = statusOf(k, key);
    return `<td><i class="${st}" title="${fmtDay(k)}: ${LABEL[st]}"></i></td>`;
  }).join("")}</tr>`).join("");
  const heat = `<div class="card"><div class="cardhead"><h2>Last 12 weeks</h2></div><div class="heat-wrap"><table class="heat">${heatRows}</table></div></div>`;

  const entries = Object.values(ticks).filter(r => r.member_key === key && (r.note || (r.images || []).length))
    .sort((a, b) => b.day.localeCompare(a.day)).slice(0, 10);
  const paths = entries.flatMap(r => r.images || []);
  ensureShotUrls(paths);
  const journal = `<div class="card"><div class="cardhead"><h2>Recent journal</h2></div>${entries.length ? entries.map(r => `<div class="jentry">
      <div class="jd"><span>${fmtDay(r.day)}</span>${dot(statusOf(r.day, key))}</div>
      ${r.note ? `<p>${linkify(r.note)}</p>` : ""}
      ${(r.images || []).length ? `<div class="shots">${r.images.map((p, i) => `<button class="shot" data-view-shot="${key}|${esc(p)}" aria-label="Picture ${i + 1}, ${fmtDay(r.day)}"
        style="${shotUrls[p] ? `background-image:url('${shotUrls[p]}')` : ""}"></button>`).join("")}</div>` : ""}
      ${commentToggleHtml(r.day, key) ? `<div class="reacts">${commentToggleHtml(r.day, key)}</div>` : ""}${commentsPanelHtml(r.day, key)}
    </div>`).join("") : `<p class="empty">No notes or pictures yet.</p>`}</div>`;

  const since30 = addDays(today, -30), bcounts: Record<string, number> = {};
  Object.values(ticks).filter(r => r.member_key === key && r.day >= since30).forEach(r => (r.rule_breaks || []).forEach(b => { bcounts[b] = (bcounts[b] || 0) + 1; }));
  const btop = Object.entries(bcounts).sort((a, b) => b[1] - a[1]);
  const breaksCard = `<div class="card"><div class="cardhead"><h2>Rule breaks · last 30 days</h2></div>${btop.length
    ? `<div class="bcount">${btop.map(([b, n]) => `<span class="bchip">${ic("alert", 13)}${esc(BREAK_LABEL[b] || b)} ×${n}</span>`).join("")}</div>`
    : `<p class="empty">None logged in the last 30 days.</p>`}</div>`;
  const refl = Object.values(reflections).filter(r => r.member_key === key && (r.went_well || r.to_fix))
    .sort((a, b) => b.week_start.localeCompare(a.week_start)).slice(0, 4);
  const reflCard = refl.length ? `<div class="card reflect"><div class="cardhead"><h2>Weekly reflections</h2></div>${refl.map(r => `<div class="rentry">
      <div class="who"><small>Week of ${fmtDay(r.week_start, { weekday: undefined })}</small></div>
      ${r.went_well ? `<h3 class="rh">Went well</h3><p>${linkify(r.went_well)}</p>` : ""}${r.to_fix ? `<h3 class="rh">To fix</h3><p>${linkify(r.to_fix)}</p>` : ""}</div>`).join("")}</div>` : "";
  const own = key === myKey() && !profileKey;
  const tabs = withTabs ? `<div class="segset two" role="group" aria-label="Show">
      <button ${own ? 'data-tab="me"' : 'data-part="profile"'} aria-pressed="${part === "profile"}">Profile</button>
      <button ${own ? 'data-tab="journal"' : 'data-part="journal"'} aria-pressed="${part === "journal"}">Journal</button></div>` : "";
  if (part === "journal") return tabs + (isWide()
    ? `<div class="desk"><div class="maincol">${journal}</div><div class="side">${breaksCard}${reflCard}</div></div>`
    : journal + breaksCard + reflCard);
  return tabs + (isWide()
    ? `${head}<div class="desk"><div class="maincol">${ach}</div><div class="side">${heat}</div></div>`
    : head + heat + ach);
}

// Pop up "Achievement unlocked" when you earn a new badge (remembered per browser).
let toastTimer = null;
function checkUnlocks() {
  if (!myKey() || !loaded || !session) return;
  const earned = badgesFor(stats(myKey())).filter(b => b.earned);
  const storeKey = "badges:" + session.user.id;
  let seen = null;
  try { seen = JSON.parse(localStorage.getItem(storeKey) || "null"); } catch (e) { return; }
  const ids = earned.map(b => b.id);
  try { localStorage.setItem(storeKey, JSON.stringify(ids)); } catch (e) {}
  if (!seen) return;   // first visit: just remember what you already have
  const fresh = earned.filter(b => !seen.includes(b.id));
  if (!fresh.length) return;
  const b = fresh[fresh.length - 1], t = document.getElementById("toast");
  t.innerHTML = `<div class="medal tier-${b.tier}"><span>${ic(b.icon, 26)}</span></div><div><b>Badge earned</b><span>${esc(b.title)}${fresh.length > 1 ? ` · +${fresh.length - 1} more` : ""}</span></div>`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4500);
}

function scoringText() {
  const req = RULES.filter(r => r[2] === "req").map(r => r[1]), bonus = RULES.filter(r => r[2] === "bonus").map(r => r[1]);
  return `Complete (${esc(req.join(", "))}) ${POINTS.COMPLETE} pts · Partial ${POINTS.PARTIAL}${bonus.length ? ` · ${esc(bonus.join(", "))} +${POINTS.bonus}` : ""}. `
    + `Streak = Complete days in a row. Excused (E) days don't count. You can tick your own boxes until ${hh(CUTOFF_HOUR)} ${esc(tzCity(TZ))} time on the next trading day.`;
}
function renderBoard() {
  const rows = activeMembers().map(m => ({ name: m.name, key: m.key, m, ...stats(m.key) }))
    .sort((a, b) => b.points - a.points || b.run - a.run || a.name.localeCompare(b.name));
  let rank = 0, prev = null;
  const items = rows.map((r, i) => {
    if (!prev || r.points !== prev.points || r.run !== prev.run) rank = i + 1;
    prev = r;
    const detail = [r.run ? `${r.run}-day streak` : null, r.rate === null ? null : `${r.rate}% of days done`].filter(Boolean).join(" · ") || "–";
    return `<li class="${rank === 1 && r.points ? "top" : ""}"><span class="rk">${rank}</span>${avatarHtml(r.m, 32)}
      <div class="who2"><b><button class="namebtn" data-profile="${r.key}">${esc(r.name)}</button>${(b => b ? `<span class="mini-badge tier-${b.tier}" title="${esc(b.title)}">${ic(b.icon, 13)}</span>` : "")(topStreakBadge(r))}${r.key === myKey() ? `<span class="you">YOU</span>` : ""}</b><span>${detail}</span></div>
      <span class="pts" aria-label="${r.points} points">${r.points}</span></li>`;
  }).join("");
  return `<div class="card"><div class="cardhead"><h2>Points</h2></div>
    <p class="page-hint">Points for finished homework, highest first. Open <b>Scoring</b> at the bottom to see how points work.</p>
    <ol class="lb">${items}</ol>
    <details>
      <summary>Scoring</summary>
      <p>${scoringText()}</p>
    </details>
  </div>`;
}

const COLORS = [["blue", "Blue"], ["green", "Green"], ["orange", "Orange"], ["red", "Red"], ["teal", "Teal"], ["pink", "Pink"], ["gold", "Gold"]];
const COMMON_TZ = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Toronto", "America/Sao_Paulo",
  "Europe/London", "Europe/Oslo", "Europe/Stockholm", "Europe/Berlin", "Europe/Paris", "Europe/Amsterdam", "Europe/Madrid", "Europe/Warsaw",
  "Africa/Lagos", "Africa/Johannesburg", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Hong_Kong", "Asia/Tokyo", "Australia/Sydney"];

function renderAdmin() {
  const g = group(), me = session.user.id;
  const free = activeMembers().filter(m => !people.some(p => p.member_key === m.key && p.status === "approved"));
  const avatar = p => p.avatar_url ? `<img src="${esc(p.avatar_url)}" alt="">` : `<span class="ph"></span>`;

  const isOwnerHere = isGroupOwner(g);

  const waiting = people.filter(p => p.status === "pending");
  const approved = people.filter(p => p.status === "approved");
  const rejected = people.filter(p => p.status === "rejected");

  const waitingHtml = waiting.length ? waiting.map(p => `<div class="person">${avatar(p)}<b>${esc(p.discord_name)}</b>
      <span class="sub">Asked to join ${new Date(p.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} </span>
      <div class="actions">
        <button class="btn primary small" data-approve="${p.user_id}">Approve</button>
        <button class="btn danger small" data-reject="${p.user_id}">Reject</button></div></div>`).join("")
    : `<p class="empty">Nobody is waiting. Share the join code to invite people.</p>`;

  const approvedHtml = approved.length ? approved.map(p => {
    const m = members.find(x => x.key === p.member_key), isOwner = g && p.user_id === g.owner_id, self = p.user_id === me;
    const badge = isOwner ? `<span class="rolechip">Owner</span>` : p.role === "admin" ? `<span class="rolechip">Admin</span>` : "";
    const adminBtn = isOwnerHere && !isOwner ? (p.role === "admin"
        ? `<button class="btn plain small" data-unadmin="${p.user_id}">Remove admin</button>`
        : `<button class="btn plain small" data-makeadmin="${p.user_id}">Make admin</button>`) : "";
    const removeBtn = !isOwner && !self && (isOwnerHere || p.role !== "admin") ? `<button class="btn danger small" data-revoke="${p.user_id}">Remove from group</button>` : "";
    return `<div class="person">${avatar(p)}<b>${esc(m ? m.name : p.discord_name)}${badge}</b>
      <span class="sub">${isOwner ? "Owns the group" : p.role === "admin" ? "Can approve people and excuse days" : "Member"}</span>
      ${adminBtn || removeBtn ? `<details class="pmenu"><summary aria-label="Actions for ${esc(m ? m.name : p.discord_name)}">${ic("more", 20)}</summary>
        <div class="pmenu-list">${adminBtn}${removeBtn}</div></details>` : ""}</div>`;
  }).join("") : `<p class="empty">No one approved yet.</p>`;

  const rejectedHtml = rejected.length ? `<div class="card"><div class="cardhead"><h2>Rejected</h2></div>` + rejected.map(p => `<div class="person">${avatar(p)}<b>${esc(p.discord_name)}</b>
      <span class="sub">Rejected</span>
      <div class="actions"><button class="btn plain small" data-reconsider="${p.user_id}">Move back to waiting</button></div></div>`).join("") + `</div>` : "";

  // Names nobody is signed in as (from before accounts). Everyone else is their Discord name and is managed above.
  const orphanHtml = free.map(m => `<div class="mem"><span class="mem-name">${esc(m.name)}</span>
      <button class="btn danger small" data-hide="${m.key}">Remove</button></div>`).join("");

  const codeCard = g ? `<div class="card"><div class="cardhead"><h2>Join code</h2></div>
      <div class="codebox"><code>${esc(g.join_code)}</code>
        <button class="btn plain small" id="copy-code">Copy</button>
        <button class="btn plain small" id="copy-invite">Copy invite link</button>
        ${isOwnerHere ? `<button class="btn danger small" id="new-code">New code</button>` : ""}</div>
      <p class="empty" style="margin-top:10px">Share the code or the invite link in your Discord. The link fills in the code for them. Either way they land in "Waiting for approval" below.${isOwnerHere ? " A new code makes the old one stop working." : ""}</p></div>` : "";

  const cols = [
    `${codeCard}<div class="card"><div class="cardhead"><h2>Waiting for approval</h2></div>${waitingHtml}</div>${rejectedHtml}`,
    `<div class="card"><div class="cardhead"><h2>Approved</h2></div>${approvedHtml}</div>` + (orphanHtml ? `<div class="card"><div class="cardhead"><h2>Names without an account</h2></div>${orphanHtml}
      <p class="empty" style="margin-top:10px">These names have history but nobody is signed in as them. Remove one to take it off the board; its history is kept.</p></div>` : ""),
  ];
  const note = flash ? `<div class="card"><p class="msg">${esc(flash)}</p></div>` : error ? `<div class="card"><p class="msg err">${esc(error)}</p></div>` : "";
  const paused = g && g.status === "paused" ? `<div class="card"><p class="msg err">This group is paused by the app owner. Nobody can tick or change anything until it's resumed.</p></div>` : "";
  const owner = isAppOwner ? ownerDashboardHtml() : "";
  fixAdminView();
  const views = adminViews(), reqN = requests.filter(r => r.status === "pending").length;
  // Phones: a switch at the top. Computers use the sidebar.
  const segs = !isWide() && views.length > 1 ? `<div class="segset adminseg" style="grid-template-columns:repeat(${views.length},1fr)" role="group" aria-label="Admin view">
      ${views.map(([v, l]) => `<button data-admin-view="${v}" aria-pressed="${adminView === v}">${l === "Group settings" ? "Settings" : l}${v === "people" && pendingCount() ? ` <span class="count">${pendingCount()}</span>` : v === "all" && reqN ? ` <span class="count">${reqN}</span>` : ""}</button>`).join("")}</div>` : "";
  if (adminView === "all") return segs + note + reportsCardHtml(reports, true) + owner;
  const guide = ownerGuideHtml();
  if (adminView === "group") return segs + note + paused + guide + groupSettingsHtml(g);
  const repCard = isOwnerHere ? reportsCardHtml(reports.filter(r => r.group_id === gid), false) : "";
  return segs + note + paused + guide + repCard + (isWide() ? `<div class="admin-grid"><div>${cols[0]}</div><div>${cols[1]}</div></div>` : `<div class="admin-one">${cols.join("")}</div>`);
}
let adminView = "people";

// Group owner: everything about how the group works. Saved together with one button.
function groupSettingsHtml(g) {
  const b = Object.assign({}, DEFAULT_BOXES, g.boxes || {}), p = g.points || {};
  const zones = (Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : COMMON_TZ);
  const zoneList = [...new Set([g.timezone, ...COMMON_TZ, ...zones])];
  const boxRows = SLOTS.map((k, i) => `<div class="boxrow">
      <input class="field" id="box-label-${k}" value="${esc(b[k].label)}" maxlength="30" aria-label="Box ${i + 1} name">
      <select id="box-kind-${k}" aria-label="Box ${i + 1}">${[["req", "Required"], ["bonus", "Bonus"], ["off", "Off"]].map(([v, l]) =>
        `<option value="${v}" ${b[k].kind === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>`).join("");
  const logo = logoUrl(g);
  return `<div class="card gsettings"><div class="cardhead"><h2>Group settings</h2></div>
    <label class="flabel" for="g-name">Name</label>
    <input class="field wide" id="g-name" value="${esc(g.name)}" maxlength="40">
    <span class="flabel">Color <small class="sub-hint" id="color-msg" role="status" aria-live="polite"></small></span>
    <div class="swatches" role="radiogroup" aria-label="Color">${COLORS.map(([c, l]) =>
      `<button class="swatch acc-${c}" role="radio" data-color="${c}" aria-checked="${g.color === c}" aria-label="${l}" title="${l}"></button>`).join("")}</div>
    <span class="flabel">Logo</span>
    <div class="logorow">${groupLogo(g, 52)}
      <button class="btn plain small" id="logo-pick">${logo ? "Change" : "Upload"}</button>
      ${logo ? `<button class="btn danger small" id="logo-remove">Remove</button>` : ""}</div>
    <span class="flabel">Homework boxes</span>
    <p class="empty" style="margin:-2px 0 8px">Complete = all required boxes ticked. Bonus boxes give extra points.</p>
    ${boxRows}
    <span class="flabel">Points</span>
    <div class="pointsrow">
      <label>Complete<input class="field" type="number" id="pt-complete" min="0" max="10" value="${p.complete ?? 2}"></label>
      <label>Partial<input class="field" type="number" id="pt-partial" min="0" max="10" value="${p.partial ?? 1}"></label>
      <label>Each bonus<input class="field" type="number" id="pt-bonus" min="0" max="10" value="${p.bonus ?? 1}"></label></div>
    <span class="flabel">The trading day ends at</span>
    <div class="pointsrow tzrow">
      <select id="g-cutoff" aria-label="Hour">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${g.cutoff_hour === h ? "selected" : ""}>${hh(h)}</option>`).join("")}</select>
      <select id="g-tz" aria-label="Time zone">${zoneList.map(z => `<option value="${esc(z)}" ${g.timezone === z ? "selected" : ""}>${esc(z.replace(/_/g, " "))}</option>`).join("")}</select></div>
    <p class="empty" style="margin-top:6px">Members can tick their boxes until this time on the next trading day.</p>
    <button class="btn primary small" id="save-group" style="margin-top:14px">Save settings</button>
    <p class="sub-hint" id="save-group-msg" style="margin:8px 0 0"></p>
  </div>${discordCardHtml()}${transferCardHtml(g)}`;
}

// Group owner: a short recap posted in the group's Discord, through a webhook link from Discord itself.
const DISCORD_HOOK = /^https:\/\/(ptb\.|canary\.)?(discord|discordapp)\.com\/api\/webhooks\/[0-9]{5,25}\/[A-Za-z0-9_-]{20,100}$/;
function discordCardHtml() {
  const c = discordCfg || { daily: true, weekly: true, lead_minutes: 60 };
  const lead = [[30, "30 min"], [60, "1 hour"], [120, "2 hours"], [180, "3 hours"]];
  return `<div class="card gsettings"><div class="cardhead"><h2>Discord recaps</h2>${discordCfg ? `<span class="okchip">${ic("check", 14)}Connected</span>` : ""}</div>
    <p class="empty" style="margin:-2px 0 10px">LockedIn posts in a channel of your Discord: who's done and who isn't before the cutoff, and a ranking after each week. Nobody gets pinged.</p>
    <details class="howto"${discordCfg ? "" : " open"}><summary>How to get the link</summary>
      <ol><li>In Discord, open <b>Server Settings</b>, then <b>Integrations</b>, then <b>Webhooks</b>.</li>
        <li>Tap <b>New Webhook</b>, pick the channel it should post in, and tap <b>Copy Webhook URL</b>.</li>
        <li>Paste it below. Keep it private: anyone with the link can post in that channel.</li></ol></details>
    <label class="flabel" for="dc-url">Webhook link</label>
    <input class="field wide" id="dc-url" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://discord.com/api/webhooks/…" value="${esc(discordCfg ? discordCfg.webhook_url : "")}">
    <label class="switchrow" style="margin-top:12px"><span><b>Daily recap</b><small>Before the cutoff: how many are done and who still has to finish.</small></span>
      <input type="checkbox" id="dc-daily" role="switch" ${c.daily ? "checked" : ""}></label>
    <label class="flabel" for="dc-lead">Post the daily recap</label>
    <select id="dc-lead" class="field">${lead.map(([v, l]) => `<option value="${v}" ${c.lead_minutes === v ? "selected" : ""}>${l} before the cutoff</option>`).join("")}</select>
    <label class="switchrow" style="margin-top:12px"><span><b>Weekly ranking</b><small>After the last trading day of the week closes: days done, wins and losses.</small></span>
      <input type="checkbox" id="dc-weekly" role="switch" ${c.weekly ? "checked" : ""}></label>
    <div class="dcbtns"><button class="btn primary small" id="dc-save">Save</button>
      ${discordCfg ? `<button class="btn plain small" id="dc-test">Send test message</button><button class="btn danger small" id="dc-remove">Disconnect</button>` : ""}</div>
    <p class="sub-hint" id="dc-msg" role="status" aria-live="polite" style="margin:8px 0 0"></p>
  </div>`;
}
// Hand the group to someone else in it. They get every owner power; you stay in the group as a normal member.
function transferCardHtml(g) {
  if (!g || !session) return "";
  const cands = people.filter(p => p.status === "approved" && p.member_key && p.user_id !== g.owner_id);
  const nameOf = k => (members.find(m => m.key === k) || {}).name || k;
  return `<div class="card gsettings dangerzone"><div class="cardhead"><h2>Move group to a new owner</h2></div>
    <p class="empty" style="margin:-2px 0 10px">The new owner gets everything you can do here: settings, join code, approving people and reports.
      You stay in the group as a normal member and can't undo this yourself. The Discord recap link is removed; the new owner adds their own.</p>
    ${cands.length ? `<label class="flabel" for="xfer-to">New owner</label>
    <select id="xfer-to" class="field"><option value="">Choose someone</option>${cands.map(p =>
      `<option value="${esc(p.user_id)}">${esc(nameOf(p.member_key))} (${esc(p.discord_name)} on Discord)</option>`).join("")}</select>
    <label class="flabel" for="xfer-confirm">Type the group's name to confirm</label>
    <input class="field wide" id="xfer-confirm" autocomplete="off" placeholder="${esc(g.name)}">
    <div class="dcbtns"><button class="btn danger small" id="xfer-go">Move group</button></div>
    <p class="sub-hint" id="xfer-msg" role="status" aria-live="polite" style="margin:8px 0 0"></p>`
    : `<p class="empty">Approve someone first. Only people in the group can become its owner.</p>`}
  </div>`;
}
async function transferGroup() {
  const g = group(), msg = document.getElementById("xfer-msg"), to = document.getElementById("xfer-to").value;
  if (!to) { msg.textContent = "Choose the new owner first."; return; }
  if (document.getElementById("xfer-confirm").value.trim() !== g.name) { msg.textContent = `Type ${g.name} exactly to confirm.`; return; }
  const p = people.find(x => x.user_id === to), who = p ? ((members.find(m => m.key === p.member_key) || {}).name || p.discord_name) : "They";
  const res = await adminDo(sb.rpc("transfer_group", { g: gid, new_owner: to }), `${who} now owns ${g.name}.`);
  if (!res.error) { fixAdminView(); render(); }
}

async function saveDiscord() {
  const msg = document.getElementById("dc-msg"), url = document.getElementById("dc-url").value.trim();
  if (!DISCORD_HOOK.test(url)) { msg.textContent = "That isn't a Discord webhook link. It starts with https://discord.com/api/webhooks/"; return; }
  const row = { group_id: gid, webhook_url: url, daily: document.getElementById("dc-daily").checked,
    weekly: document.getElementById("dc-weekly").checked, lead_minutes: +document.getElementById("dc-lead").value };
  const res = await adminDo(sb.from("group_discord").upsert(row, { onConflict: "group_id" }), "Discord recaps saved. Send a test message to check the channel.");
  return res;
}

// App owner: every group, requests to start one, and the big switches.
function ownerDashboardHtml() {
  const open = requests.filter(r => r.status === "pending");
  const reqHtml = open.length ? open.map(r => `<div class="person"><span class="ph"></span><b>${esc(r.name)}</b>
      <span class="sub">From ${esc(profileName(r.user_id))} · ${new Date(r.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}${r.note ? ` · “${esc(r.note)}”` : ""}</span>
      <div class="actions"><button class="btn primary small" data-approve-req="${r.id}">Approve</button>
        <button class="btn danger small" data-reject-req="${r.id}">Reject</button></div></div>`).join("")
    : `<p class="empty">No requests.</p>`;
  const groupRows = groups.map(x => {
    const inGroup = allMemberships.filter(m => m.group_id === x.id && m.status === "approved");
    const waiting = allMemberships.filter(m => m.group_id === x.id && m.status === "pending").length;
    const ownerOpts = inGroup.map(m => `<option value="${m.user_id}" ${m.user_id === x.owner_id ? "selected" : ""}>${esc(profileName(m.user_id))}</option>`).join("");
    return `<div class="grow ${x.status}">
      <div class="ghead">${groupLogo(x, 36)}<div><b>${esc(x.name)}${x.status === "paused" ? `<span class="rolechip">Paused</span>` : ""}</b>
        <span class="sub">Owner: ${esc(profileName(x.owner_id))} · ${inGroup.length} in group${waiting ? ` · ${waiting} waiting` : ""} · code ${esc(x.join_code)}</span></div></div>
      <div class="actions">
        <button class="btn plain small" data-open-group="${x.id}">Open</button>
        <button class="btn plain small" data-pause-group="${x.id}">${x.status === "paused" ? "Resume" : "Pause"}</button>
        ${inGroup.length > 1 ? `<select id="owner-${x.id}" aria-label="New owner for ${esc(x.name)}">${ownerOpts}</select>
          <button class="btn plain small" data-set-owner="${x.id}">Make owner</button>` : ""}
        <button class="btn danger small" data-delete-group="${x.id}">Delete</button></div></div>`;
  }).join("");
  return `<div class="card"><div class="cardhead"><h2>Requests for a group</h2></div>${reqHtml}</div>
    <div class="card"><div class="cardhead"><h2>All groups · ${groups.length}</h2></div>${groupRows}
      <div class="addrow"><input class="field" id="new-group" placeholder="New group name" maxlength="40" aria-label="New group name">
        <button class="btn primary small" id="create-group">Create</button></div>
      <p class="empty" style="margin-top:10px">Groups you create are owned by you. Hand one to someone with "Make owner" once they're in it.
      Deleting a group removes all its names, ticks, notes and reflections for good.</p></div>`;
}

// The Groups sheet: switch group, join another, ask for your own, leave.
function openGroupsPanel() { if (editing) closePanel(); setTab("groups"); }
function renderGroups() {
  const list = groups.filter(canOpen);
  const row = x => `<button class="gitem" data-switch-group="${x.id}" aria-current="${x.id === gid}">${groupLogo(x, 36)}
      <span><b>${esc(x.name)}</b><small>${esc(roleOf(x))}${x.status === "paused" ? " · paused" : ""}</small></span>${x.id === gid ? ic("check", 18) : ""}</button>`;
  const mine = list.filter(x => (myMembership(x.id) || {}).status === "approved" || x.owner_id === session.user.id);
  const others = list.filter(x => !mine.includes(x));
  const m = myMembership(), g = group();
  const canLeave = m && g && g.owner_id !== session.user.id;
  const yours = `<section class="card setpage"><div class="cardhead"><h2>Your groups</h2></div>
    <p class="sub-hint">Tap a group to switch to it.</p>
    <div class="glist">${mine.map(row).join("") || `<p class="empty">You're not in a group yet.</p>`}</div>
    ${others.length ? `<h3>Other groups (app owner)</h3><div class="glist">${others.map(row).join("")}</div>` : ""}</section>`;
  const join = `<section class="card setpage"><div class="cardhead"><h2>Join another group</h2></div>
    <p class="sub-hint">Ask the owner for their join code, then type it here.</p>${joinHtml()}</section>`;
  const leave = canLeave ? `<section class="card setpage"><div class="cardhead"><h2>Leave ${esc(g.name)}</h2></div>
    <p class="sub-hint">You can only come back if the owner approves you again.</p><button class="btn danger small" id="leave-group">Leave this group</button></section>` : "";
  return isWide()
    ? `<div class="desk"><div class="maincol">${yours}</div><div class="side">${join}${leave}</div></div>`
    : yours + join + leave;
}

// After signing in, with no group yet: two clear choices, join with a code or start a group.
let lobbyMode = "join";
function joinCodeHtml() {
  return `<div class="joinbox">
      <label for="joincode">Join code</label>
      <p class="sub-hint" style="margin:0 0 10px">Ask your group's owner for it. It looks like ABCD-1234.</p>
      <div class="addrow"><input class="field code" id="joincode" placeholder="ABCD-1234" maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false">
        <button class="btn primary small" id="join">Join</button></div>
      <p class="sub-hint" id="join-msg" role="status" style="margin:10px 0 0">${esc(joinMsg)}</p>
      <p class="sub-hint" style="margin:10px 0 0">The owner approves you, and you're in with your Discord name.</p>
    </div>`;
}
function createHtml() {
  return `<div class="reqbox">
      <label class="flabel" for="req-name" style="margin-top:0">Group name</label>
      <input class="field" id="req-name" maxlength="40" placeholder="Group name" style="width:100%">
      <label class="flabel" for="req-note">Who is it for? <span style="text-transform:none;letter-spacing:0">(optional)</span></label>
      <textarea class="field" id="req-note" maxlength="300" placeholder="For example: our NQ group on Discord" style="width:100%;min-height:70px;padding:8px 10px"></textarea>
      <button class="btn primary small" id="send-request" style="margin-top:12px">Send request</button>
      <p class="sub-hint" role="status" style="margin:10px 0 0">${esc(joinMsg)}</p>
      <p class="sub-hint" style="margin:10px 0 0">The app owner checks every new group. Once it's approved you're its owner: you get your own join code, boxes, points, time zone, color and logo, and you decide who gets in.</p>
    </div>`;
}
// Where your join requests and group requests stand.
function lobbyStatus() {
  const waiting = myMemberships.filter(m => m.status !== "approved").map(m => {
    const g = groups.find(x => x.id === m.group_id);
    return `<p class="lobby-line">${m.status === "pending" ? ic("clock", 15) + `Waiting for approval in <b>${esc(g ? g.name : m.group_id)}</b>`
      : ic("alert", 15) + `Not accepted in <b>${esc(g ? g.name : m.group_id)}</b>`}</p>`;
  }).join("");
  const mine = requests.filter(r => session && r.user_id === session.user.id && r.status !== "approved");
  const reqs = mine.map(r => `<p class="lobby-line">${r.status === "pending" ? ic("clock", 15) + `Your request for <b>${esc(r.name)}</b> is waiting for the app owner`
      : ic("alert", 15) + `Your request for <b>${esc(r.name)}</b> wasn't accepted`}</p>`).join("");
  return waiting || reqs ? `<div class="lobby-status">${waiting}${reqs}</div>` : "";
}

// Join a group with a code, or ask for your own. Shown in the Groups sheet.
function joinHtml() {
  const waiting = myMemberships.filter(m => m.status !== "approved").map(m => {
    const g = groups.find(x => x.id === m.group_id);
    return `<p class="lobby-line">${m.status === "pending" ? ic("clock", 15) + `Waiting for approval in <b>${esc(g ? g.name : m.group_id)}</b>`
      : ic("alert", 15) + `Not accepted in <b>${esc(g ? g.name : m.group_id)}</b>`}</p>`;
  }).join("");
  const mine = requests.filter(r => session && r.user_id === session.user.id && r.status !== "approved");
  const reqs = mine.map(r => `<p class="lobby-line">${r.status === "pending" ? ic("clock", 15) + `Your request for <b>${esc(r.name)}</b> is waiting for the app owner`
      : ic("alert", 15) + `Your request for <b>${esc(r.name)}</b> wasn't accepted`}</p>`).join("");
  return `<div class="joinbox">
      <label for="joincode">Join code</label>
      <div class="addrow" style="margin-top:6px"><input class="field code" id="joincode" placeholder="ABCD-1234" maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false">
        <button class="btn primary small" id="join">Join</button></div>
      <p class="sub-hint" id="join-msg" style="margin:8px 0 0">${esc(joinMsg)}</p>
      ${waiting}${reqs}
    </div>
    <details class="reqbox" ${requestOpen ? "open" : ""}><summary>Start your own group</summary>
      <p class="sub-hint" style="margin:8px 0 10px">Ask for a group of your own. Once it's approved you're its owner: you get a join code to share and your own settings.</p>
      <input class="field" id="req-name" maxlength="40" placeholder="Group name" aria-label="Group name" style="width:100%">
      <textarea class="field" id="req-note" maxlength="300" placeholder="Who is it for? (optional)" aria-label="Note" style="width:100%;margin-top:8px;min-height:70px;padding:8px 10px"></textarea>
      <button class="btn plain small" id="send-request" style="margin-top:8px">Send request</button>
    </details>`;
}
let joinMsg = "", requestOpen = false;

function renderGate() {
  const name = profile ? profile.discord_name : (session && session.user.user_metadata && (session.user.user_metadata.full_name || session.user.user_metadata.name)) || "";
  const avatar = session && session.user.user_metadata && session.user.user_metadata.avatar_url;
  if (screen === "setup") return `<div class="gate card"><h1>Almost there</h1><p>Paste your Supabase address and key into <b>web/src/config.ts</b>, then reload.</p></div>`;
  if (screen === "signin") return renderLanding();
  if (screen === "terms") return `<div class="gate card termsgate">
    <h1>Welcome to LockedIn</h1>
    <p>Before you continue, please read and accept the Terms and the Privacy policy. In short:</p>
    <ul>
      <li>LockedIn is free and isn't financial advice.</li>
      <li>Your group sees your ticks, notes and pictures. Other groups don't.</li>
      <li>You can download or delete your data any time in Settings.</li>
    </ul>
    <label class="checkrow"><input type="checkbox" id="terms-ok"><span>I've read and agree to the <a href="?p=terms" data-land="terms">Terms</a> and the <a href="?p=privacy" data-land="privacy">Privacy policy</a>.</span></label>
    <button class="btn primary" id="accept-terms" disabled>Continue</button>
    <p class="msg err" id="terms-msg" role="alert"></p>
    <button class="btn plain small" id="signout">Sign out</button></div>`;
  if (screen === "offline") return `<div class="gate card"><h1>You're offline</h1><p>Connect to the internet once to load your group. After that, LockedIn opens even without internet.</p>
    <button class="btn primary" onclick="location.reload()">Try again</button></div>`;
  if (screen === "lobby") return `<div class="gate lobby">${avatar ? `<img class="avatar" src="${esc(avatar)}" alt="">` : ""}
    <h1>Welcome${name ? ", " + esc(name) : ""}</h1><p>Join your group with a code, or start your own.</p>
    <div class="segset two lobby-switch" role="group" aria-label="Join or start a group">
      <button data-lobby="join" aria-pressed="${lobbyMode === "join"}">${ic("users", 16)}Join with a code</button>
      <button data-lobby="create" aria-pressed="${lobbyMode === "create"}">${ic("target", 16)}Start a group</button></div>
    <div class="card lobby-card" style="text-align:left">${lobbyMode === "create" ? createHtml() : joinCodeHtml()}${lobbyStatus()}</div>
    <button class="btn plain" id="signout" style="margin-top:18px">Sign out</button></div>`;
  return `<div class="card"><p class="msg">Loading…</p></div>`;
}

// The front page for people who aren't signed in. The menu opens separate pages in the same window
// (?p=why / how / features), so the back button works; the logo goes back to the front page.
const LAND_PAGES = { why: "Why", how: "How it works", features: "Features", privacy: "Privacy policy", terms: "Terms" };
const LEGAL = ["privacy", "terms"];
function landPage() { const p = new URLSearchParams(location.search).get("p"); return LAND_PAGES[p] ? p : "home"; }
// The privacy policy and terms open for everyone, signed in or not.
const legalOpen = () => LEGAL.includes(landPage());
function goLandPage(p) {
  const url = new URL(location.href);
  if (p === "home") url.searchParams.delete("p"); else url.searchParams.set("p", p);
  history.pushState(null, "", url.pathname + url.search);
  render();
  window.scrollTo(0, 0);
}
window.addEventListener("popstate", () => { render(); window.scrollTo(0, 0); });
// Real words from beta testers, used only with their permission. Empty means the section doesn't show.
// Each entry: { quote: "What they said", name: "How they want to be named", role: "e.g. NQ trader, LockedIn Beta" }
const BETA_QUOTES: { quote: string; name: string; role?: string }[] = [];
function proofHtml() {
  if (!BETA_QUOTES.length) return "";
  return `<section class="lp-sec proof" aria-label="From the beta group">${BETA_QUOTES.map((q, i) =>
    `<figure class="rv${i ? " d" + Math.min(i, 3) : ""}"><blockquote>${esc(q.quote)}</blockquote><figcaption><b>${esc(q.name)}</b>${q.role ? `<span>${esc(q.role)}</span>` : ""}</figcaption></figure>`).join("")}</section>`;
}
function renderLanding() {
  const page = landPage(), inApp = !!session && screen !== "signin";   // signed in, reading the Privacy or Terms page
  // Buttons look the same as inside the app.
  const signin = (id = "signin", label = "Sign in with Discord") => `<button class="lp-btn white" id="${id}">${SVG.discord}${label}</button>`;
  const link = (p, label, cls = "") => `<a href="${p === "home" ? "./" : "?p=" + p}" data-land="${p}" class="${cls}"${page === p ? ' aria-current="page"' : ""}>${label}</a>`;
  const blink = (p, label) => link(p, label, "lp-btn ghost");
  const person = (name, color, chips, last?) => `<div class="mock-row${last ? " late" : ""}"><span class="av" style="background:${color}">${name[0]}</span><b>${name}</b>
    <span class="chips">${chips.map((c, i) => `<i class="${c ? "on" : ""}${last && i === 1 ? " late-box" : ""}"></i>`).join("")}</span>
    <span class="st">${last ? `<span class="warn">${SYM.half}</span><span class="good late-st">${SYM.check}</span>` : `<span class="good">${SYM.check}</span>`}</span></div>`;
  const row = (title, text) => `<div class="frow rv"><b>${title}</b><p>${text}</p></div>`;
  const li = (mark, text) => `<li><b aria-hidden="true">${mark}</b><span>${text}</span></li>`;
  const errMsg = error ? `<p class="msg err" style="margin-top:16px">${esc(error)}</p>` : "";
  // A page's opening: huge uppercase title, one line under it (the label only names the page for screen readers).
  const head = (label, title, sub) => `<header class="lp-hero pagehead" aria-label="${label}"><div>
      <h1 class="rv in">${title}</h1><p class="lead rv in d2">${sub}</p></div></header>`;
  const rows = `<div class="mock-top"><span><b><span class="count-old">4</span><span class="count-new">5</span></b>/5 done</span><span>1h 12m left</span></div>
      <div class="mock-bar"><i></i></div>
      <div class="mock-legend"><span>Today's homework</span><span>Chart · Journal · HTF</span></div>
      ${person("Alex", "#2563eb", [1, 1, 1])}${person("Sam", "#0e7490", [1, 1, 1])}${person("Riley", "#0d9488", [1, 1, 1])}${person("Morgan", "#ea580c", [1, 1, 1])}${person("Jordan", "#db2777", [1, 0, 1], true)}`;
  // The real app (a demo group) in a tilted 3D phone, with big text behind it.
  const phone = `<div class="stage3d">
      <p class="behind" aria-hidden="true">Tick it.<br>See it.<br>Lock in.</p>
      <div class="phone3d rv in d2"><div class="phone"><div class="phone-screen">
        <img src="assets/app-day.jpg" width="781" height="1690" alt="The LockedIn app with a demo group: today's homework, ticked boxes, notes and chart pictures">
      </div></div></div>
    </div>`;
  const own = `<div class="lp-own rv">
      <div><h2>Start your own group</h2>
        <p>Sign in and tap <b>Start your own group</b>. Once approved you get your own join code, homework boxes, points, time zone, color and logo. You decide who gets in.</p></div>
      ${signin("signin-own", "Sign in to start")}
    </div>`;
  const next = (p, label) => `<div class="lp-next rv">${link(p, `<span class="mono">Next</span><b>${label}</b><span class="arrow" aria-hidden="true">→</span>`, "nextlink")}</div>`;
  const goal = `<section class="lp-sec center">
      <div class="chrome rv" aria-label="5 out of 5">5/5</div>
      <p class="sub rv d1">The daily goal: every member ticks every required box before the cutoff.</p>`;
  let body;
  if (page === "why") body = head("Why LockedIn", `Everyone says they'll journal.<span class="dim">Nobody checks.</span>`,
      "Homework done alone quietly stops by Wednesday. A red circle next to your name, in front of your group, doesn't let it.") + `
    <section class="lp-sec">
      <div class="versus" style="margin-top:0">
        <div class="vcol them rv"><p class="mono">On your own</p><h2>Good intentions</h2><ul>
          ${li(SYM.x, "Skip the journal \"just today\"")}${li(SYM.x, "Nobody notices the missed days")}${li(SYM.x, "Repeat the same revenge trade next week")}${li(SYM.x, "Motivation gone by midweek")}</ul></div>
        <div class="vcol us rv d1"><p class="mono">In a LockedIn group</p><h2>Proof, every day</h2><ul>
          ${li(SYM.check, "Everyone sees who's done before the cutoff")}${li(SYM.check, "Streaks you really don't want to break")}${li(SYM.check, "Notes and charts your group learns from")}${li(SYM.check, "A reminder before the day closes")}</ul></div>
      </div>
    </section>
    ${goal}
      ${next("how", "How it works")}
    </section>`;
  else if (page === "how") body = head("How it works", `Three boxes.<span class="dim">One tap each.</span>`,
      "Your group picks the homework. You tick it off after your session, before the day closes.") + `
    <section class="lp-sec"><div class="ritual">
      <div class="bigsteps">
        <div class="rv"><b>Trade your session.</b><p>Take your setups. Or sit out on purpose: that counts too.</p></div>
        <div class="rv d1"><b>Do the homework.</b><p>Chart with execution, journal, HTF. Add a note and screenshots.</p></div>
        <div class="rv d2"><b>Beat the cutoff.</b><p>All boxes ticked turns your circle green. Your streak grows, and the group sees it.</p></div>
      </div>
      ${phone}
    </div></section>
    <section class="lp-sec">
      <h2 class="rv">Join your group<span class="dim">in a minute</span></h2>
      <div class="bigsteps cols">
        <div class="rv"><b>Sign in with Discord.</b><p>No new password to remember. Your Discord account is your login.</p></div>
        <div class="rv d1"><b>Type the join code.</b><p>Your group's owner gives you a code like LOCK-7K2P.</p></div>
        <div class="rv d2"><b>Get approved.</b><p>The owner lets you in with one tap. You're on the board with your Discord name.</p></div>
      </div>
      ${next("features", "Features")}
    </section>`;
  else if (page === "features") body = head("Features", `Built for traders<span class="dim">who show up.</span>`,
      "What's in the app, from daily ticks to reminders.") + `
    <section class="lp-sec">
      <div class="flist" style="margin-top:0">
        ${row("Daily homework", "One tap per box. Your group decides the boxes: chart with execution, journal, HTF, or your own.")}
        ${row("Notes &amp; chart pictures", "Write what happened and paste screenshots of your trades. Tap any picture to zoom in.")}
        ${row("Streaks, points &amp; badges", "A ranking for your group, streaks for days in a row, and 31 badges to earn.")}
        ${row("Reminders", "A notification on your phone before the day closes, only if your homework isn't done yet.")}
        ${row("Works like an app", "Add it to your home screen. It opens full screen and keeps working with bad signal.")}
        ${row("Kept inside your group", "Other groups can't see your ticks, notes or pictures. Only your group, its owner and the app owner can.")}
      </div>
      ${own}
    </section>`;
  else if (page === "privacy" || page === "terms") {
    const mail = cfg.contactEmail ? `<a href="mailto:${esc(cfg.contactEmail)}">${esc(cfg.contactEmail)}</a>` : "the contact email (added before launch)";
    const sec = (title, html) => `<section class="legal-sec"><h2>${title}</h2>${html}</section>`;
    const updated = `<p class="mono">Last updated ${parse(TERMS_VERSION).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>`;
    const ext = (href, label) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    body = page === "privacy" ? `<article class="legal">${updated}<h1>Privacy policy</h1>
      <p class="legal-lead">This page explains what LockedIn stores about you, why, who can see it, and how to download or delete it.</p>
      ${sec("Who is responsible", `<p>LockedIn is a free, non-commercial project run by Adam Batko, a private individual in Norway. He decides how your data is used (the "data controller"). Contact: ${mail}.</p>`)}
      ${sec("What we store", `<ul>
        <li><b>From Discord, when you sign in:</b> your Discord username, profile picture, email address and Discord account ID. LockedIn doesn't use your email address for anything and never emails you. We never see your Discord password, messages or servers.</li>
        <li><b>What you add:</b> your ticks, notes, rule-break tags, weekly reflections, screenshots, P&amp;L and R if you fill them in, reactions and comments on members' posts, your settings, and requests to join or start a group.</li>
        <li><b>Reports:</b> if you report a picture, note or comment, we store the report, your reason and which post it is about. For notes and comments, the start of the text is kept with the report as evidence.</li>
        <li><b>Reminders, only if you turn them on:</b> a push address for that phone or computer (made by your browser's push service, such as Apple, Google or Mozilla), how long before the cutoff you want a reminder, and a note of which reminders were sent. If you own or help run a group, the same notifications also tell you when someone asks to join or reports something.</li>
      </ul>`)}
      ${sec("Why, and the legal basis", `<ul>
        <li><b>To run the app you signed up for</b> (your account, groups, ticks, notes, pictures, ranking): this is needed to provide the service (GDPR Article 6(1)(b)). Without it you can't use LockedIn.</li>
        <li><b>Reminders:</b> only with your consent, given when you switch them on (Article 6(1)(a)). Switch them off in Settings at any time.</li>
        <li><b>Keeping the service safe and working</b>, for example the technical logs our providers keep: our legitimate interest in a secure service (Article 6(1)(f)).</li>
      </ul><p>We don't sell your data, show ads, build profiles of you, or make automated decisions about you.</p>`)}
      ${sec("Who can see it", `<ul>
        <li><b>Your group</b> sees your name, picture, ticks, notes, screenshots, P&amp;L and R, reflections, streaks, badges, the reactions you give and get, and the comments you write.</li>
        <li><b>Your group's owner and admins</b> can also approve or remove members, excuse days, correct ticks and delete comments.</li>
        <li><b>Reports</b> are seen only by the group's owner and the app owner. The person who was reported isn't told who reported them.</li>
        <li><b>Your group's Discord server, if the group owner turns on Discord recaps:</b> LockedIn then posts each member's name, whether they finished the day's homework, and a weekly count of days done, wins and losses in a channel the owner picks. Everyone who can read that channel sees it. Your group owner decides this, so ask them if you'd rather not be included.</li>
        <li><b>The app owner</b> (Adam Batko) can see every group, to run and support the service.</li>
        <li><b>Other groups</b> can't see anything of yours.</li>
      </ul>`)}
      ${sec("Services that handle data for us", `<ul>
        <li><b>Supabase</b> (database, sign-in, screenshot storage, sending reminders). Your data is stored in Ireland, in the EU. ${ext("https://supabase.com/privacy", "Supabase privacy policy")}</li>
        <li><b>Discord</b> (sign-in, and Discord recaps if your group owner turns them on): ${ext("https://discord.com/privacy", "Discord privacy policy")}</li>
        <li><b>GitHub Pages</b> (hosts the website; receives your IP address when the page loads): ${ext("https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement", "GitHub privacy statement")}</li>
        <li><b>Your browser's push service</b> (delivers reminders, only if you turn them on).</li>
      </ul><p>Some of these companies are based in the United States, so your data may be transferred there. They protect these transfers with the legal safeguards described in their privacy policies, such as the EU Standard Contractual Clauses. Fonts and code are hosted on our own site, so no other companies are contacted when you open LockedIn.</p>`)}
      ${sec("Cookies and storage on your device", `<p>LockedIn doesn't use cookies for tracking, analytics or advertising. It stores only what's needed for features you use, in your browser's storage:</p>
      <ul>
        <li><b>Your sign-in</b>, so you stay signed in.</li>
        <li><b>A copy of your group's data and ticks not uploaded yet</b>, so the app works without internet.</li>
        <li><b>Backups of notes you're typing</b>, so a closed tab doesn't lose them.</li>
        <li><b>Your choices</b>, such as light or dark mode, your last tab and group, reminder timing and which badges you've seen.</li>
        <li><b>A copy of the website's files</b>, so it opens quickly and offline.</li>
      </ul><p>Because all of this is needed for the app to work, we don't ask for cookie consent. Signing out removes your sign-in, the copy of your group and unsent ticks. Deleting your account also removes your note backups and choices from that device.</p>`)}
      ${sec("How long we keep it", `<p>Your data is kept while you have an account. Screenshots are deleted automatically 60 days after the day they belong to, and right away if you delete them. The record of which reminders were sent is deleted after 7 days. Reports are deleted 90 days after they are handled. When you delete your account, your account, ticks, notes, reflections, pictures, settings and reminder devices are deleted. Group owners can also remove members.</p>`)}
      ${sec("Your rights", `<ul>
        <li><b>See and download</b> your data: Settings → Your data → Download my data.</li>
        <li><b>Delete</b> your account and data: Settings → Your data → Delete my account.</li>
        <li><b>Correct, restrict or object</b> to how your data is used, or <b>withdraw consent</b> for reminders: switch reminders off in Settings, or write to ${mail}.</li>
      </ul><p>If you think we handle your data wrongly, you can complain to your data protection authority. In Norway that's ${ext("https://www.datatilsynet.no/en/", "Datatilsynet")}.</p>`)}
      ${sec("Age", `<p>You must be at least 13 to use LockedIn, the same as Discord's minimum age. If you're under 13, don't sign in. If we learn that someone under 13 has an account, we delete it.</p>`)}
      ${sec("Changes", `<p>If this policy changes, we update this page and the date at the top. For big changes we'll also tell you in the app.</p>`)}
    </article>` : `<article class="legal">${updated}<h1>Terms</h1>
      <p class="legal-lead">These terms apply when you use LockedIn. By signing in you agree to them.</p>
      ${sec("What LockedIn is", `<p>LockedIn is a free tool for trading groups to track daily homework (such as charts, journals and higher-timeframe analysis) together. It is a non-commercial project run by Adam Batko, a private individual in Norway. Contact: ${mail}.</p>`)}
      ${sec("Price", `<p>LockedIn is free. There are no payments, subscriptions or hidden fees, so there is nothing to refund. If that ever changes, you'll be told clearly before paying for anything.</p>`)}
      ${sec("Not financial advice", `<p>Nothing in LockedIn is financial or investment advice. Trading carries risk of loss. You are responsible for your own trading decisions.</p>`)}
      ${sec("Your account", `<ul>
        <li>You sign in with your own Discord account and must be at least 13.</li>
        <li>One account per person. Don't use someone else's account or name.</li>
      </ul>`)}
      ${sec("Groups", `<p>Each group's owner decides who joins, which homework counts and the group's settings. Group owners and admins can approve and remove members, excuse days and correct ticks. The app owner can pause or delete any group.</p>`)}
      ${sec("What you post", `<p>You keep ownership of your notes and screenshots. You allow LockedIn to store them and show them to your group so the app works. Don't post anything illegal, other people's private information, harassment, or anything that harms the app or its users. Content or accounts that break these rules can be removed.</p>`)}
      ${sec("Availability", `<p>LockedIn is provided as it is, without guarantees. It may change, have downtime or stop. Keep your own copies of anything important (Settings → Your data → Download my data). As far as the law allows, we are not responsible for losses caused by using the app.</p>`)}
      ${sec("Stopping", `<p>You can stop using LockedIn at any time and delete your account in Settings. We can end access for anyone who breaks these terms.</p>`)}
      ${sec("Changes and contact", `<p>If these terms change, we update this page and the date at the top. Questions: ${mail}.</p>`)}
    </article>`;
  }
  else body = `<header class="lp-hero home">
      <div class="hero-text">
        <h1 class="rv in d1">Daily trading homework<span class="dim">Tracked as a group</span></h1>
        <p class="lead rv in d2">Your Discord group picks the boxes, like chart, journal and HTF. Everyone ticks them off after their session, and everyone can see who did.</p>
        <div class="lp-cta rv in d3">${signin()}${blink("how", "How it works")}</div>
        <button class="hero-own rv in d3" data-jump="start-own">Run a trading group? Start your own</button>
        ${errMsg}
        <p class="fine rv in d3">${pendingInvite() ? "You've been invited to a group. Sign in with Discord and you'll be on its waiting list." : "Free. You'll need a join code from your group's owner."}</p>
        <p class="fine rv in d3">By signing in you agree to the ${link("terms", "Terms")} and the ${link("privacy", "Privacy policy")}.</p>
      </div>
      <figure class="hero-app rv in d2" role="img" aria-label="Example of a group's day in LockedIn: the last member ticks their box and the group reaches 5 of 5 done before the cutoff.">
        <div class="mock">${rows}</div>
      </figure>
    </header>
    <section class="story" id="story" aria-labelledby="story-title">
      <div class="story-pin">
        <div class="floaters bg" id="fl-bg" aria-hidden="true"></div>
        <div class="story-grid">
          <div class="story-text" id="story-text" aria-live="polite">
            <h2 id="story-title">Tick your homework</h2>
            <p class="st-body" id="story-body"></p>
          </div>
          <div class="s-stage" aria-hidden="true">
            <div class="s-phone" id="s-phone"><div class="s-screen" id="s-screen">
              <div class="ma-toast" id="ma-toast"><span class="md">${ic("flame", 20)}</span><div><b>Achievement unlocked</b><span>20 day streak</span></div></div>
              <div class="s-scale" id="s-scale"><div class="s-feed" id="s-feed"></div></div>
              <div class="ma-tabbar" id="ma-tabbar"><i class="hl" id="ma-hl"></i>
                <span class="on">${SVG.day}Day</span><span>${SVG.week}Week</span><span>${SVG.board}Ranking</span><span>${SVG.me}Me</span></div>
            </div></div>
          </div>
          <ol class="st-chapters" id="st-chapters"></ol>
          <div class="st-dots" id="st-dots" aria-hidden="true"><i class="on"></i><i></i><i></i><i></i></div>
        </div>
        <div class="floaters fg" id="fl-fg" aria-hidden="true"></div>
      </div>
    </section>
    <section class="lp-sec tryit" aria-labelledby="try-title">
      <div class="try-text">
        <h2 class="rv" id="try-title">Tick your<span class="dim">own boxes</span></h2>
        <p class="sub rv d2">This is your row in LockedIn. Tick the boxes and watch your circle change. Nothing here is saved.</p>
      </div>
      <div class="try-card rv d1" id="try-card">${tryCardHtml()}</div>
    </section>
    ${proofHtml()}
    <section class="lp-sec" id="start-own">${own}</section>`;
  return `<div class="lp">
    <nav class="lp-nav" aria-label="LockedIn">
      ${link("home", `<img src="icons/icon-192.png" alt="">LockedIn`, "brand")}
      <span class="nav-end">${inApp ? link("home", "Open app", "lp-btn white small") : `<button class="lp-btn white small" id="signin-nav">${SVG.discord}Sign in</button>`}
        <button class="lp-burger" id="lp-menu-btn" aria-label="Menu" aria-expanded="false" aria-controls="lp-menu"><span class="lines"><i></i><i style="margin-top:5px"></i></span><svg class="x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></span>
    </nav>
    <div class="lp-menu" id="lp-menu" role="dialog" aria-modal="true" aria-label="Menu">
      <div class="bg" data-menu-close></div>
      <div class="in">
        <nav aria-label="Pages">${[["home", "Home"], ["why", "Why"], ["how", "How it works"], ["features", "Features"]].map(([p2, l], i) => link(p2, l).replace("<a ", `<a style="--delay:${80 + i * 60}ms" `)).join("")}</nav>
        <div class="mfoot">
          ${inApp ? link("home", "Back to the app", "lp-btn white") : `<button class="lp-btn white" id="signin-menu">${SVG.discord}Sign in with Discord</button>`}
          <span class="small-links">${link("privacy", "Privacy")}${link("terms", "Terms")}${cfg.contactEmail ? `<a href="mailto:${esc(cfg.contactEmail)}">Contact</a>` : ""}</span>
        </div>
      </div>
    </div>
    ${body}
    ${LEGAL.includes(page) || page === "home" ? "" : `<section class="lp-final">
      <h2 class="rv">Stop trading<span class="dim">alone</span></h2>
      <div class="lp-cta rv d2" style="margin-top:30px">${signin("signin-end")}</div>
      ${page !== "home" ? errMsg : ""}
      <p class="fine rv d3">Sign in, type your group's join code, and the owner lets you in.</p>
      <p class="fine rv d3">By signing in you agree to the ${link("terms", "Terms")} and the ${link("privacy", "Privacy policy")}.</p>
    </section>`}
    <footer class="lp-foot">
      <span class="foot-links">${inApp ? link("home", "Back to the app") : link("home", "Home") + link("why", "Why") + link("how", "How it works") + link("features", "Features")}${link("privacy", "Privacy")}${link("terms", "Terms")}</span>
      <p>Signing in with Discord shares your Discord username, profile picture, email address and account ID with LockedIn. We never see your messages, servers or password. LockedIn is a free project run by Adam Batko, Norway.${cfg.contactEmail ? ` Contact: <a href="mailto:${esc(cfg.contactEmail)}">${esc(cfg.contactEmail)}</a>` : ""}</p>
      <p class="foot-copy">© 2026 Adam Batko</p></footer>
  </div>`;
}


// ---------------------------------------------------------------- front page: try it yourself (nothing is saved)
const TRY_BOXES = [["chart", "Chart with execution", "Required"], ["journal", "Journal", "Required"], ["review", "HTF", "Required"], ["social", "Social", "Bonus"]];
const tryState = { chart: false, journal: false, review: false, social: false };
function tryStatus() {
  const req = TRY_BOXES.filter(b => b[2] === "Required"), done = req.filter(b => tryState[b[0]]).length;
  return done === req.length ? "COMPLETE" : done ? "PARTIAL" : "MISSING";
}
// "Fri 6 Nov closes in 2h 14m": the same cutoff as the app (09:00 New York, next trading day)
function tryClock() {
  const day = currentTradingDay(), mins = Math.max(0, Math.round((closesAt(day) - Date.now()) / 60000));
  const open = opensAt(day), close = closesAt(day), frac = Math.min(1, Math.max(0, (Date.now() - open) / (close - open)));
  return { day, text: `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`, frac, urgent: mins <= 60 };
}
function tryCardHtml() {
  const st = tryStatus(), c = tryClock(), req = TRY_BOXES.filter(b => b[2] === "Required");
  const left = req.filter(b => !tryState[b[0]]).length, bonus = tryState.social ? POINTS.bonus : 0;
  const pts = (st === "COMPLETE" ? POINTS.COMPLETE : st === "PARTIAL" ? POINTS.PARTIAL : 0) + bonus;
  const msg = st === "COMPLETE" ? (tryState.social ? "Complete, with the bonus. Your circle is green." : "Complete. Your circle is green.")
    : st === "PARTIAL" ? `${left} more required ${left === 1 ? "box" : "boxes"} to go green.` : "Tick a box to start your day.";
  return `<div class="try-top"><span class="mono">Homework for ${esc(fmtDay(c.day))}</span>
      <span class="try-clock${c.urgent ? " urgent" : ""}" id="try-clock">${ic("clock", 15)}Closes in <b>${c.text}</b></span></div>
    <div class="try-track" aria-hidden="true"><i id="try-fill" style="width:${(c.frac * 100).toFixed(1)}%"></i></div>
    <div class="try-me"><span class="try-av" aria-hidden="true">Y</span><b>You</b>
      <span class="try-st ${st}" role="img" aria-label="Your status: ${LABEL[st] || st}">${ICON[st]}</span></div>
    <div class="try-boxes">${TRY_BOXES.map(([k, l, kind]) => `<button type="button" class="try-box${kind === "Bonus" ? " bonus" : ""}" data-try="${k}" aria-pressed="${tryState[k]}">
        <span class="c" aria-hidden="true">${tryState[k] ? SYM.check : ""}</span><span><b>${l}</b><small>${kind}</small></span></button>`).join("")}</div>
    <div class="try-foot" role="status" aria-live="polite"><span>${msg}</span><span class="try-pts">+${pts} ${pts === 1 ? "point" : "points"}</span></div>
    <p class="try-note">Cutoff: 09:00 New York time on the next trading day. Each group can choose its own time and boxes.</p>`;
}
function tryRender(pop) {
  const card = document.getElementById("try-card");
  if (!card) return;
  morph(card, tryCardHtml());
  if (pop && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const st = card.querySelector(".try-st");
    if (st && st.animate) st.animate([{ transform: "scale(0.7)" }, { transform: "scale(1.15)" }, { transform: "scale(1)" }], { duration: 420, easing: "cubic-bezier(.2,.8,.2,1)" });
  }
}
document.addEventListener("click", e => {
  const b = e.target.closest && e.target.closest("[data-try]");
  if (!b) return;
  const before = tryStatus();
  tryState[b.dataset.try] = !tryState[b.dataset.try];
  const after = tryStatus();
  tryRender(before !== after);
});
// keep the timer live (only while the card is on screen)
setInterval(() => {
  const el = document.getElementById("try-clock");
  if (!el) return;
  const c = tryClock(), fill = document.getElementById("try-fill");
  el.innerHTML = `${ic("clock", 15)}Closes in <b>${c.text}</b>`; el.classList.toggle("urgent", c.urgent);
  if (fill) fill.style.width = (c.frac * 100).toFixed(1) + "%";
}, 15000);

// ---------------------------------------------------------------- front page menu (top right)
function landMenu(open) {
  const m = document.getElementById("lp-menu"), b = document.getElementById("lp-menu-btn");
  if (!m) { document.documentElement.classList.remove("menu-on"); return; }
  m.classList.toggle("open", open); document.documentElement.classList.toggle("menu-on", open);
  if (b) { b.setAttribute("aria-expanded", String(open)); b.setAttribute("aria-label", open ? "Close menu" : "Menu"); }
  if (open) setTimeout(() => { const a = m.querySelector("nav a"); if (a) a.focus({ preventScroll: true }); }, 60);
}
document.addEventListener("click", e => {
  if (e.target.closest("#lp-menu-btn")) return landMenu(!document.getElementById("lp-menu").classList.contains("open"));
  if (e.target.closest("[data-menu-close]")) return landMenu(false);
}, true);
document.addEventListener("keydown", e => { if (e.key === "Escape" && document.documentElement.classList.contains("menu-on")) { landMenu(false); const b = document.getElementById("lp-menu-btn"); if (b) b.focus(); } });


// ---------------------------------------------------------------- front page scroll story
// The phone stays in place while the app inside it plays one day: tick, notes, everyone done, ranking.
// Made-up names only. The phone turns toward the mouse and the floating shapes move out of its way (computers only, not with reduced motion).
let story = null;
const storyMouse = { x: 0, y: 0, px: -9999, py: -9999 };
addEventListener("pointermove", e => {
  if (e.pointerType !== "mouse") return;
  storyMouse.x = e.clientX / innerWidth - 0.5; storyMouse.y = e.clientY / innerHeight - 0.5; storyMouse.px = e.clientX; storyMouse.py = e.clientY;
}, { passive: true });
function initStory() {
  const root = document.getElementById("story");
  if (!root) { story = null; return; }
  if (story && story.root === root) return;
  const q = sel => root.querySelector(sel), qa = sel => [...root.querySelectorAll(sel)];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches, fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const CH = [
    { t: ["Tick your", "homework"], b: "One tap per box after your session. All required boxes ticked turns your circle green.", bg: [2, 8, 23], glow: "rgba(37, 99, 235, 0.5)", hl: 0 },
    { t: ["Show your", "work"], b: "Write what happened and add chart screenshots. Your group reads it and learns from it.", bg: [2, 16, 28], glow: "rgba(14, 165, 233, 0.42)", hl: 0 },
    { t: ["Beat the", "cutoff"], b: "Everyone sees who's done before the day closes. Turn on reminders and your phone nudges you first.", bg: [2, 20, 14], glow: "rgba(34, 197, 94, 0.38)", hl: 1 },
    { t: ["Climb the", "ranking"], b: "Points, streaks for days in a row, and 31 badges to earn. Every day counts.", bg: [10, 10, 16], glow: "rgba(251, 191, 36, 0.28)", hl: 2 },
  ];
  const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>';
  const XS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><path d="M7 7l10 10M17 7 7 17"/></svg>';
  const HALF = '<svg viewBox="0 0 24 24"><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>';
  const LINE = '<svg viewBox="0 0 64 64" preserveAspectRatio="none"><path d="M4 46 L18 40 L28 28 L40 36 L60 18" fill="none" stroke="#4ade80" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const icon = st => st === "ok" ? CHECK : st === "part" ? HALF : st === "miss" ? XS : "";
  const MEM = [["Taylor", "#3b82f6", null, true], ["Alex", "#b45309", "ok"], ["Sam", "#be185d", "ok"], ["Morgan", "#0f766e", "ok"], ["Riley", "#1d4ed8", "part"], ["Jordan", "#15803d", "miss"], ["Casey", "#047857", "miss"]];
  const BOX = [["Chart with execution", "Required"], ["Journal", "Required"], ["HTF", "Required"], ["Social", "Bonus"]];
  const RANK: any[] = [["Alex", "#b45309", 118, "47-day best streak"], ["Taylor", "#3b82f6", 103, "20-day streak"], ["Sam", "#be185d", 81, "68% complete"], ["Morgan", "#0f766e", 60, "12-day streak"], ["Riley", "#1d4ed8", 32, "41% complete"]];
  const NOTE = "Waited for the 9:45 retest and took 1R. Stopped after two trades.";
  const weekRow = (n, cells) => `<span class="n">${n}</span>` + cells.map(c => `<i style="background:${{ o: "#22c55e", p: "#fbbf24", m: "#ef4444", e: "#2a2b31" }[c]}"></i>`).join("");
  q("#s-feed").innerHTML = `
    <div class="ma-card ma-top"><span class="ma-chip"><b>L</b>LockedIn</span><span class="ma-date">Fri 6 Nov</span></div>
    <div class="ma-card"><div class="ma-track"><i></i></div>
      <div class="ma-meta"><span class="ma-count"><span id="ma-done">3</span><small>/7 done</small></span><span class="ma-left">2h 30m left</span></div>
      <div class="ma-stack" id="ma-stack"></div></div>
    <div class="ma-card"><p class="ma-h">Your homework</p><div class="ma-boxes">${BOX.map(([l, k]) => `<div class="ma-box"><span class="c">${CHECK}</span><span><b>${l}</b><small>${k}</small></span></div>`).join("")}</div></div>
    <div class="ma-card">${MEM.map(([n, col, st, you]) => `<div class="ma-mem">
        <span class="ma-av" style="background:${col}">${n[0]}</span><span class="ma-name">${n}${you ? '<span class="ma-you">YOU</span>' : ""}</span>
        <span class="ma-st ${st || ""}">${icon(st)}</span>
        ${you ? `<p class="ma-note" id="ma-note"></p><div class="ma-shots"><span class="ma-shot">${LINE}</span><span class="ma-shot">${LINE}</span></div>` : ""}</div>`).join("")}</div>
    <div class="ma-card"><p class="ma-h">This week</p><div class="ma-week"><span></span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span>
      ${weekRow("Taylor", ["o", "o", "o", "o", "e"])}${weekRow("Alex", ["o", "o", "o", "o", "o"])}${weekRow("Sam", ["o", "p", "o", "o", "o"])}${weekRow("Morgan", ["p", "o", "o", "m", "o"])}${weekRow("Riley", ["m", "o", "p", "o", "e"])}</div></div>
    <div class="ma-card"><p class="ma-h">Ranking</p><ol class="ma-rank">${RANK.map(([n, col, pts, d], i) => `<li><span class="r">${i + 1}</span><span class="ma-av" style="background:${col}">${n[0]}</span><span><b>${n}</b><small>${d}</small></span><span class="pts" data-pts="${pts}">${pts - 6}</span></li>`).join("")}</ol></div>`;
  const feed = q("#s-feed"), scaleBox = q("#s-scale"), screenEl = q("#s-screen"), pin = q(".story-pin"), phoneEl = q("#s-phone");
  const boxes = qa(".ma-box"), mems = qa(".ma-mem"), note = q("#ma-note"), shots = qa(".ma-shot"), pts = qa(".pts");
  const sText = q("#story-text"), sTitle = q("#story-title"), sBody = q("#story-body");
  q("#st-chapters").innerHTML = CH.map((c, i) => `<li><span>0${i + 1}</span>${c.t.join(" ")}<div class="bar"><i></i></div></li>`).join("");
  const chLis = qa("#st-chapters li"), chBars = qa("#st-chapters .bar i"), dots = qa("#st-dots i"), tabs = qa("#ma-tabbar span");
  const S: any = { root, chap: -1, feedY: 0, smoothY: 0, spin: 0, spinV: 0, visible: false, green: false, anchors: [0, 0, 0, 0], cm: { x: 0, y: 0 }, last: performance.now() };
  function measure() {
    const sc = screenEl.clientWidth / 375;
    scaleBox.style.transform = `scale(${sc})`;
    const viewH = screenEl.clientHeight / sc, maxY = Math.max(0, feed.scrollHeight - viewH);
    S.anchors = [0, Math.min(maxY, mems[0].offsetTop - 100), Math.min(maxY, mems[3].offsetTop - 60), maxY];
  }
  // floating shapes. On computers: x is a share of the free space between the text and the chapter list, y a share of the height;
  // "far" ones sit above or below the text (left) and the chapter list (right). On phones they keep to the sides, below the text.
  const SPOTS = [[0.04, 0.17, 60, "fg"], [0.96, 0.83, 56, "fg"], [0.06, 0.82, 70, "fg"], [0.94, 0.2, 64, "fg"], [0.14, 0.47, 38, "bg"], [0.86, 0.55, 42, "bg"],
                 [0.4, 0.11, 34, "bg"], [0.6, 0.93, 36, "bg"], [0.2, 0.14, 52, "far"], [0.8, 0.13, 56, "far"], [0.2, 0.86, 62, "far"], [0.8, 0.88, 58, "far"]];
  const SETS = [
    ["box", "ok", "box", "part", "ok", "box", "ok", "box", "part", "ok", "box", "ok"],
    ["chart", "ok", "chart", "chart", "ok", "chart", "part", "chart", "ok", "chart", "ok", "chart"],
    ["miss", "ok", "miss", "ok", "miss", "ok", "miss", "ok", "ok", "miss", "ok", "miss"],
    ["medal", "ok", "medal", "ok", "medal", "ok", "medal", "ok", "medal", "ok", "medal", "ok"],
  ];
  const look = t => ({
    ok: `<div class="circ" style="background:radial-gradient(circle at 35% 30%,#86efac,#16a34a);color:#052e16">${CHECK}</div>`,
    part: `<div class="circ" style="background:radial-gradient(circle at 35% 30%,#fde68a,#d97706);color:#451a03">${HALF}</div>`,
    miss: `<div class="circ" style="background:radial-gradient(circle at 35% 30%,#fca5a5,#dc2626);color:#fff">${XS}</div>`,
    box: `<div class="tile box" style="background:linear-gradient(160deg,#60a5fa,#1d4ed8);color:#fff">${CHECK}</div>`,
    chart: `<div class="tile" style="background:linear-gradient(160deg,#1e3a5f,#0f1f36)">${LINE}</div>`,
    medal: `<div class="circ" style="background:radial-gradient(circle at 35% 30%,#fde68a,#b45309);color:#451a03">${ic("flame", 24)}</div>`,
  })[t];
  const textEl = q("#story-text"), chapEl = q("#st-chapters");
  let zones = null;   // measured once per frame: where the text and the chapter list are, inside the pinned area
  function measureZones() {
    const pb = pin.getBoundingClientRect(), t = textEl.getBoundingClientRect(), c = chapEl.getBoundingClientRect();
    zones = { W: pb.width, H: pb.height, tl: t.left - pb.left, tr: t.right - pb.left, tt: t.top - pb.top, tb: t.bottom - pb.top,
      cl: c.left - pb.left, cr: c.right - pb.left, ct: c.top - pb.top, cb: c.bottom - pb.top };
  }
  // returns the centre of a shape in pixels
  const spot = f => {
    const z = zones, W = z.W, H = z.H;
    if (W < 900) return [(f.x < 0.5 ? 0.06 + f.x * 0.2 : 0.94 - (1 - f.x) * 0.2) * W, (0.42 + f.y * 0.52) * H];
    if (f.far) {   // above or below the text on the left, the chapter list on the right
      const left = f.x < 0.5, x0 = left ? z.tl : z.cl, x1 = left ? z.tr : z.cr, top = left ? z.tt : z.ct, bot = left ? z.tb : z.cb;
      const x = x0 + (x1 - x0) * (left ? 0.25 : 0.75);
      return f.y < 0.5 ? [x, Math.max(90, top - 60) * (f.y / 0.15)] : [x, Math.min(H - 50, bot + 60 + (H - bot - 110) * ((f.y - 0.85) / 0.15))];
    }
    const L = z.tr + 40, R = z.cl - 40;
    return [L + (R - L) * f.x, 70 + (H - 120) * f.y];
  };
  const setLook = (f, kind) => { f.el.innerHTML = look(kind); f.el.firstElementChild.style.width = f.el.firstElementChild.style.height = (f.sz || f.size) + "px"; };
  const fls = SPOTS.map(([x, y, size, layer], i) => {
    const el = document.createElement("div");
    el.className = "fl" + (layer === "far" ? " far" : "");
    q(layer === "fg" ? "#fl-fg" : "#fl-bg").appendChild(el);
    const f: any = { el, x, y, size, far: layer === "far", angle: Math.random() * 30 - 15, rx: 0, ry: 0, bx: 0, by: 0, s: 1, o: 1, hold: false, extra: 0, depth: layer === "fg" ? 1 : -0.5 };
    setLook(f, SETS[0][i]);
    return f;
  });
  // implode toward the phone, swap, then burst back out to a new spot
  function burst(kinds) {
    fls.forEach((f, i) => {
      if (reduce) return setLook(f, kinds[i]);
      f.hold = true;
      const t0 = performance.now(), d1 = 420, d2 = 260, d3 = 820, nbx = (Math.random() - 0.5) * 120, nby = (Math.random() - 0.5) * 120, sbx = f.bx, sby = f.by;
      if (!zones) measureZones();
      const W = zones.W, H = zones.H, [sx, sy] = spot(f), cx = W / 2 - sx, cy = (W < 900 ? 0.62 : 0.5) * H - sy;
      let swapped = false;
      const step = now => {
        const t = now - t0 - i * 18;
        if (t < 0) return requestAnimationFrame(step);
        if (t < d1) { const k = (t / d1) ** 2; f.bx = sbx + (cx - sbx) * k; f.by = sby + (cy - sby) * k; f.s = 1 - 0.9 * k; f.o = 1 - k; }
        else if (t < d1 + d2) { if (!swapped) { swapped = true; setLook(f, kinds[i]); } }
        else if (t < d1 + d2 + d3) { const u = (t - d1 - d2) / d3, c = 1.5, k = 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2;
          f.bx = cx + (nbx - cx) * k; f.by = cy + (nby - cy) * k; f.s = 0.1 + 0.9 * k; f.o = Math.min(1, u * 2); }
        else { f.bx = nbx; f.by = nby; f.s = 1; f.o = 1; f.hold = false; return; }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }
  function setChapter(i) {
    if (i === S.chap) return;
    const first = S.chap === -1; S.chap = i;
    const c = CH[i];
    sTitle.setAttribute("aria-label", c.t.join(" "));
    sTitle.innerHTML = c.t.map((l, j) => `<span class="st-clip" aria-hidden="true"><span style="--delay:${j * 90}ms">${l}</span></span>`).join("");
    sBody.innerHTML = c.b.split(" ").map((w, j) => `<span class="w" style="--delay:${200 + j * 22}ms">${w}</span>`).join(" ");
    sText.classList.remove("play"); void sText.offsetWidth;
    requestAnimationFrame(() => sText.classList.add("play"));
    chLis.forEach((li, j) => j === i ? li.setAttribute("aria-current", "step") : li.removeAttribute("aria-current"));
    dots.forEach((d, j) => d.classList.toggle("on", j === i));
    q("#ma-hl").style.transform = `translateX(calc(${c.hl * 100}% + ${c.hl * 6}px))`;
    tabs.forEach((t2, j) => t2.classList.toggle("on", j === c.hl));
    if (!first) { S.spinV += 900; burst(SETS[i]); }
  }
  const lerp = (a, b, t) => a + (b - a) * t, clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v)), ease = t => t * t * (3 - 2 * t);
  function apply(p) {
    const ci = Math.min(3, Math.floor(p * 4)), local = clamp(p * 4 - ci);
    setChapter(ci);
    chBars.forEach((b, j) => b.style.transform = `scaleX(${j < ci ? 1 : j === ci ? local : 0})`);
    const nxt = CH[Math.min(3, ci + 1)], mix = ci < 3 ? ease(clamp((local - 0.7) / 0.3)) : 0;
    root.style.setProperty("--st-bg", `rgb(${CH[ci].bg.map((v, j) => Math.round(lerp(v, nxt.bg[j], mix)))})`);
    root.style.setProperty("--st-glow", mix > 0.5 ? nxt.glow : CH[ci].glow);
    S.feedY = ci < 3 ? lerp(S.anchors[ci], S.anchors[ci + 1], ease(clamp((local - 0.75) / 0.25))) : S.anchors[3];
    const ticks = ci > 0 ? 4 : Math.floor(clamp((local - 0.1) / 0.6) * 4.999);
    boxes.forEach((bx, j) => { const on = j < ticks; if (on !== bx.classList.contains("on")) { bx.classList.toggle("on", on); if (on) { bx.classList.add("pop"); setTimeout(() => bx.classList.remove("pop"), 260); } } });
    const youDone = ticks >= 3, fixed = ci > 2 ? 3 : ci === 2 ? Math.floor(clamp((local - 0.15) / 0.55) * 3.999) : 0;
    mems.forEach((m, j) => {
      const st = j === 0 ? (youDone ? "ok" : null) : (j >= 4 && j - 4 < fixed ? "ok" : MEM[j][2]);
      const dot = m.querySelector(".ma-st"), cur = ["ok", "part", "miss"].find(k => dot.classList.contains(k)) || null;
      if (cur !== st) { dot.className = "ma-st " + (st || "") + " flip"; dot.innerHTML = icon(st); setTimeout(() => dot.classList.remove("flip"), 30); }
    });
    const done = 3 + (youDone ? 1 : 0) + fixed;
    q("#ma-done").textContent = done;
    const part = fixed >= 1 ? 0 : 1, miss = Math.max(0, 2 - Math.max(0, fixed - 1)), none = youDone ? 0 : 1;
    q("#ma-stack").innerHTML = [["#22c55e", done], ["#fbbf24", part], ["#ef4444", miss], ["#2a2b31", none]].filter(x => x[1]).map(([c2, n]) => `<i style="flex-grow:${n};background:${c2}"></i>`).join("");
    if (ci === 2 && fixed === 3 && !S.green) { S.green = true; burst(SETS[2].map(() => "ok")); }
    if (ci < 2) S.green = false;
    const chars = ci > 1 ? NOTE.length : ci === 1 ? Math.floor(clamp((local - 0.08) / 0.5) * NOTE.length) : 0;
    note.innerHTML = NOTE.slice(0, chars) + (ci === 1 && chars < NOTE.length ? '<span class="caret"></span>' : "");
    shots.forEach((s2, j) => s2.classList.toggle("on", ci > 1 || (ci === 1 && local > 0.6 + j * 0.08)));
    const k = ci === 3 ? ease(clamp(local / 0.5)) : 0;
    pts.forEach(el => el.textContent = Math.round(+el.dataset.pts - 6 + 6 * k));
    q("#ma-toast").classList.toggle("on", ci === 3 && local > 0.45 && local < 0.95);
  }
  S.frame = now => {
    const dt = Math.min(0.05, (now - S.last) / 1000); S.last = now;
    if (!S.visible) return;
    const r = root.getBoundingClientRect(), total = r.height - innerHeight, pr = clamp(-r.top / total);
    apply(pr);
    S.smoothY += (S.feedY - S.smoothY) * (reduce ? 1 : 0.12);
    feed.style.transform = `translate3d(0, ${(-S.smoothY).toFixed(1)}px, 0)`;
    const mx = fine && !reduce ? storyMouse.x : 0, my = fine && !reduce ? storyMouse.y : 0;
    S.cm.x += (mx - S.cm.x) * 0.05; S.cm.y += (my - S.cm.y) * 0.05;
    S.spinV += (-170 * S.spin - 22 * S.spinV) * dt; S.spin += S.spinV * dt;   // a quick turn at a new chapter, settling back like a spring
    const t = now / 1000, ry = -22 + pr * 34 + S.cm.x * 26 + (reduce ? 0 : S.spin * 0.8), rx = 8 + S.cm.y * -14, bob = reduce ? 0 : Math.sin(t * 1.05) * 8;
    phoneEl.style.transform = `translateY(${bob.toFixed(1)}px) perspective(1600px) rotateY(${ry.toFixed(2)}deg) rotateX(${rx.toFixed(2)}deg) rotateZ(${(3 - pr * 6).toFixed(2)}deg)`;
    phoneEl.style.filter = !reduce && Math.abs(S.spinV) > 150 ? `blur(${Math.min(2.5, Math.abs(S.spinV) / 500).toFixed(2)}px)` : "none";
    measureZones();
    const W = zones.W, pb = pin.getBoundingClientRect();
    fls.forEach((f, i) => {
      const per = 6.2 + (i * 2.9) % 5.3, ph = (t + i * 1.3) * (Math.PI * 2 / per);   // each shape bobs at its own slow pace
      const sz = W < 900 ? f.size * 0.6 : f.size;
      if (f.sz !== sz) { f.sz = sz; f.el.firstElementChild.style.width = f.el.firstElementChild.style.height = sz + "px"; }
      const [sx, sy] = spot(f), baseX = sx - sz / 2, baseY = sy - sz / 2;
      let tx = 0, ty = 0, spd = 1;
      if (fine && !reduce && !f.hold) {
        const ex = pb.left + baseX + f.bx + sz / 2, ey = pb.top + baseY + f.by + sz / 2, dx = storyMouse.px - ex, dy = storyMouse.py - ey, dist = Math.hypot(dx, dy);
        if (dist < 260 && dist > 0) { const force = (260 - dist) / 260; tx = dx / dist * force * -70; ty = dy / dist * force * -70; spd = 1 + force * 4; }
      }
      f.rx += (tx - f.rx) * 0.1; f.ry += (ty - f.ry) * 0.1;
      f.extra = (f.extra + (spd - 1) * 0.8 * (i % 2 ? 1 : -1)) * 0.97;
      const fy = reduce ? 0 : Math.sin(ph) * 12, fa = reduce ? 0 : Math.cos(ph) * 6, par = S.cm.x * 50 * f.depth, par2 = S.cm.y * 50 * f.depth;
      f.el.style.transform = `translate3d(${(baseX + f.bx + f.rx + par).toFixed(1)}px, ${(baseY + f.by + f.ry + fy + par2).toFixed(1)}px, 0) rotate(${(f.angle + fa + f.extra).toFixed(1)}deg) scale(${f.s.toFixed(3)})`;
      f.el.style.opacity = f.o.toFixed(3);
    });
  };
  if ("IntersectionObserver" in window) new IntersectionObserver(l => l.forEach(e => { S.visible = e.isIntersecting; })).observe(root); else S.visible = true;
  S.measure = measure;
  measure(); if (document.fonts) document.fonts.ready.then(() => story === S && measure());
  apply(0);
  story = S;
}
addEventListener("resize", () => { if (story && story.root.isConnected) story.measure(); });
(function storyLoop(now) { if (story && story.root.isConnected) story.frame(now); else if (story) story = null; requestAnimationFrame(storyLoop); })(performance.now());

// Fade sections in as they scroll into view (everything shows at once if motion is reduced).
function revealLanding() {
  landMenu(false);
  initStory();
  const els = document.querySelectorAll(".lp .rv:not(.in), .lp .stage:not(.in)");
  if (!("IntersectionObserver" in window) || matchMedia("(prefers-reduced-motion: reduce)").matches) { els.forEach(el => el.classList.add("in")); return; }
  const io = new IntersectionObserver(list => list.forEach(x => { if (x.isIntersecting) { x.target.classList.add("in"); io.unobserve(x.target); } }), { threshold: 0.18 });
  els.forEach(el => io.observe(el));
}

// The Me tab: your own profile with badges, then your account (groups, settings, tutorial, sign out) at the bottom.
function renderMe(part = "profile") {
  const g = group(), m = members.find(x => x.key === myKey());
  const chev = `<svg class="chev" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const tile = name => `<span class="meicon">${ic(name, 18)}</span>`;
  const row = (id, icon, title, sub) => `<button class="merow" id="${id}">${icon}<span><b>${title}</b><small>${sub}</small></span>${chev}</button>`;
  const who = profile ? profile.discord_name : "";
  const account = `<div class="card"><div class="cardhead"><h2>Account</h2></div><div class="melist">
      ${row("open-groups", groupLogo(g, 34), "Groups", `${esc(g ? g.name : "")}${roleOf() ? " · " + esc(roleOf()) : ""} · switch, join or start one`)}
      ${row("open-settings", tile("gear"), "Settings", "Reminders, light / dark mode, rule-break tags, app icon")}
      ${row("start-tour", tile("target"), "Tutorial", "A one-minute tour of the app")}
    </div>
    <div class="account"><span>Signed in as <b>${esc(who)}</b></span><button class="linkbtn" id="signout">Sign out</button></div></div>`;
  if (!m) return `<div class="card"><p class="msg">You don't have a name in ${esc(g ? g.name : "this group")}, so there's no profile${part === "journal" ? " or journal" : ""} here.</p></div>` + (part === "profile" ? account : "");
  // On computers the sidebar switches between Profile and Journal; on phones a small switch at the top does.
  const prof = renderProfile(m.key, part, !isWide());
  return part === "profile" ? prof + account : prof;
}

function render() {
  ticksChanged();
  renderTop(); renderTabbar(); renderRail();
  if (screen !== "loading") hideSplash();
  const app = document.getElementById("app");
  const legal = legalOpen() && screen !== "loading" && screen !== "setup";
  const landingNow = screen === "signin" || legal;
  if (landingNow !== document.body.classList.contains("landing")) {
    document.body.classList.toggle("landing", landingNow);
    if (landingNow) document.querySelectorAll('meta[name="theme-color"]').forEach(m => { m.removeAttribute("media"); m.content = "#000000"; });
    else applyTheme();
  }
  if (legal) { document.getElementById("topbar").hidden = true; document.getElementById("tabbar").hidden = true; app.innerHTML = renderLanding(); revealLanding(); return; }
  if (screen !== "app") { app.innerHTML = renderGate(); if (screen === "signin") revealLanding(); return; }
  let html;
  if (tab === "admin" && isAdmin) html = renderAdmin();
  else if ((tab === "me" || tab === "journal") && !profileKey) html = renderMe(tab === "journal" ? "journal" : "profile");
  else if (profileKey) html = renderProfile(profileKey, profilePart, true);
  else if (tab === "week") html = renderWeek() + renderReflections();
  else if (tab === "board") html = renderBoard();
  else if (tab === "help") html = renderHelp();
  else if (tab === "settings") html = renderSettings();
  else if (tab === "groups") html = renderGroups();
  else { const d = renderDay(); html = d.summary + d.list; }
  if (/^(settings|groups|help)$/.test(tab) && !profileKey && !isWide()) html = `<button class="backrow" data-nav="me">${ic("chevron-left", 18)}<span>Me</span></button>` + html;
  const pageName = profileKey ? ((members.find(x => x.key === profileKey) || {}).name || "Profile") : PAGE_TITLE[tab] || "Today";
  morph(app, `<h1 class="sr-only">${esc(pageName)}, ${esc((group() || {}).name || "LockedIn")}</h1>` + offlineBar() + html);
  mountInline();
  renderPanelPics();
  checkUnlocks();
  // A picture's link may arrive after the viewer opened.
  if (viewing) { const img = document.getElementById("viewer-img"); if (!img.getAttribute("src") && shotUrls[viewing.path]) img.src = shotUrls[viewing.path]; }
  if (tour) requestAnimationFrame(placeTour);
}

// A short fade-up when you open another page, and the profile numbers count up (skipped if you prefer less motion).
function pageEnter() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const app = document.getElementById("app");
  if (!app.animate) return;
  // cards: one after another, from blurry to sharp
  const cards = [...app.querySelectorAll(":scope > .card, :scope > .desk .card, :scope > .offline-bar")].slice(0, 14);
  cards.forEach((el, i) => el.animate(
    [{ opacity: 0, filter: "blur(10px)", transform: "translateY(14px) scale(0.985)" }, { opacity: 1, filter: "blur(0px)", transform: "none" }],
    { duration: 520, delay: i * 70, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" }));
  // bars grow into place
  app.querySelectorAll(".track .fill, .bar i").forEach((el, i) => {
    const w = el.style.width;
    if (w && w !== "0%") el.animate([{ width: "0%" }, { width: w }], { duration: 750, delay: 180 + Math.min(i, 20) * 15, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" });
  });
  // numbers count up
  app.querySelectorAll(".tile b, .meta .count .num:first-child, .pts").forEach(el => {
    const node = [...el.childNodes].find(n => n.nodeType === 3 && /\d/.test(n.nodeValue));
    const m = node && /^(\s*)(\d+)(%?)(\s*)$/.exec(node.nodeValue);
    if (!m || +m[2] === 0) return;
    const end = +m[2], start = performance.now(), dur = 700;
    const step = now => {
      const k = Math.min(1, (now - start) / dur), v = Math.round(end * (1 - Math.pow(1 - k, 3)));
      if (!node.isConnected) return;
      node.nodeValue = m[1] + v + m[3] + m[4];
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    setTimeout(() => { if (node.isConnected) node.nodeValue = m[1] + end + m[3] + m[4]; }, dur + 150);   // always ends on the real number
  });
}
// The opening screen goes away (with the growing circle) once the first page is ready.
const splashStart: number = (window as any).__liStart ?? performance.now();   // set by the first script in layout.tsx
function hideSplash() {
  const sp = document.getElementById("splash");
  if (!sp || sp.dataset.going) return;
  sp.dataset.going = "1";
  setTimeout(() => {
    sp.classList.add("opening");
    setTimeout(() => sp.remove(), 950);
    requestAnimationFrame(pageEnter);
  }, Math.max(0, 750 - (performance.now() - splashStart)));
}
setTimeout(hideSplash, 3500);   // never longer than this, whatever happens
function setTab(t) {
  adminDirty = false;
  if (t === tab && !profileKey) { selected = today; weekStart = mondayOf(today); }
  tab = t; requestAnimationFrame(pageEnter); profileKey = null; flash = ""; try { localStorage.setItem("tab", t); } catch (e) {} render(); window.scrollTo(0, 0); }

// ---------------------------------------------------------------- events
document.addEventListener("click", async e => {
  const landLink = e.target.closest("a[data-land]");
  if (landLink && !e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); if (editing || settingsOpen) closePanel(); return goLandPage(landLink.dataset.land); }
  // Tap a long note (not a link inside it) to show all of it.
  const longNote = e.target.closest(".note p");
  if (longNote && !e.target.closest("a")) { longNote.classList.add("open"); return; }
  const t = e.target.closest("button");
  if (!t) return;
  const d = t.dataset;
  if (d.jump) {   // scroll on the same page (a #link would count as a page change and jump back to the top)
    const to = document.getElementById(d.jump);
    if (to) to.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    return;
  }
  if (d.tab) return setTab(d.tab);
  if (d.lobby) { lobbyMode = d.lobby; joinMsg = ""; render(); const f = document.getElementById(d.lobby === "create" ? "req-name" : "joincode"); if (f) f.focus(); return; }
  if (d.nav) { const [t2, v] = d.nav.split(":"); if (v) { adminView = v; error = ""; } if (settingsOpen || editing) closePanel(); setTab(t2); if (t2 === "settings") loadPush(); return; }   // the sidebar
  if (d.part) { profilePart = d.part; render(); requestAnimationFrame(pageEnter); return; }
  if (d.expand) { openRow = openRow === d.expand ? null : d.expand; render(); return; }
  if (d.profile) { profileKey = d.profile; profilePart = "profile"; if (tab === "admin") tab = "day"; render(); requestAnimationFrame(pageEnter); return window.scrollTo(0, 0); }
  if (t.id === "goto-reflect") {
    openPanel(today, myKey());
    const el = document.getElementById("panel-refl");
    if (el) el.scrollIntoView({ block: "start" });
    return;
  }
  if (t.id === "profile-back") { profileKey = null; render(); return window.scrollTo(0, 0); }
  if (d.tick) {
    const [key, r] = d.tick.split(":");
    // Owners and admins changing someone else's box: the first tap only asks, so a careless tap while scrolling does nothing.
    if (t.classList.contains("guard") && t.dataset.armed !== "1") {
      const disarm = b => { b.classList.remove("armed"); b.dataset.armed = ""; b.innerHTML = b.dataset.label; b.setAttribute("aria-label", b.dataset.aria); };
      document.querySelectorAll(".t.armed").forEach(disarm);
      t.dataset.armed = "1"; t.dataset.label = t.innerHTML; t.dataset.aria = t.getAttribute("aria-label"); t.classList.add("armed");
      const who = (members.find(m => m.key === key) || {}).name || "them";
      t.textContent = "Tap again";
      t.setAttribute("aria-label", `Tap again to change this box for ${who}`);
      clearTimeout(t._arm); t._arm = setTimeout(() => { if (t.isConnected && t.dataset.armed === "1") disarm(t); }, 2500);
      return;
    }
    if (t.animate && !matchMedia("(prefers-reduced-motion: reduce)").matches) t.animate([{ transform: "scale(0.94)" }, { transform: "scale(1.04)" }, { transform: "scale(1)" }], { duration: 280, easing: "ease-out" });
    return editTick(selected, key, row => { row[r] = !row[r]; });
  }
  if (d.edit) return editing && panelMode === "inline" && editing.key === d.edit && editing.day === selected ? closePanel() : openPanel(selected, d.edit);
  if (t.id === "open-settings" || d.rail === "settings") return openSettings();
  if (d.rail === "groups") return openGroupsPanel();
  if (t.id === "export-data") return exportMyData();
  if (t.id === "accept-terms") {
    if (!document.getElementById("terms-ok").checked) return;
    t.disabled = true;
    const { error: e2 } = await sb.rpc("accept_terms", { terms_v: TERMS_VERSION });
    if (e2) { t.disabled = false; document.getElementById("terms-msg").textContent = "Couldn't save: " + e2.message; return; }
    screen = "loading"; render(); watchLoading(); return startLoad();
  }
  if (t.id === "delete-account") return deleteMyAccount(t);
  if (d.remind) {
    remindMins = +d.remind;
    try { localStorage.setItem("remindMins", d.remind); } catch (e) {}
    renderRemind();
    return savePushSub().catch(err => { push.msg = err.message; renderRemind(); });
  }
  if (t.id === "retry-load") { t.disabled = true; try { await refreshNow(); } catch (err) { render(); } return; }
  if (t.id === "install-app" && installPrompt) { installPrompt.prompt(); installPrompt = null; t.remove(); return; }
  if (t.id === "show-add-break") { const row = document.getElementById("add-break-row"); row.hidden = false; document.getElementById("newbreak").focus(); return; }
  if (t.id === "add-break") return addCustomBreak();
  if (d.hideBreak || d.unhideBreak) {
    const b = d.hideBreak || d.unhideBreak, hidden = settings.hiddenBreaks || [];
    settings.hiddenBreaks = d.hideBreak ? [...new Set([...hidden, b])] : hidden.filter(x => x !== b);
    saveSettings();
    document.getElementById("settings-breaks").innerHTML = customBreaksListHtml();
    return;
  }
  if (d.removeCustom) {
    settings.customBreaks = (settings.customBreaks || []).filter(x => x !== d.removeCustom);
    saveSettings();
    document.getElementById("settings-breaks").innerHTML = customBreaksListHtml();
    return;
  }
  if (d.result && editing) {
    const { day, key } = editing, cur = resultOf(tickOf(day, key));
    const next = cur === d.result ? null : d.result;   // tapping the picked one clears it
    editTick(day, key, row => { row.no_trade = next === "notrade"; row.result = next && next !== "notrade" ? next : null; });
    const rec = tickOf(day, key) || {};
    document.querySelectorAll("[data-result]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.result === resultOf(rec))));
    const h = document.getElementById("result-hint"); if (h) h.textContent = resultHint(rec);
    return;
  }
  if (d.themeSet) {
    settings.theme = d.themeSet; saveSettings();
    document.querySelectorAll("[data-theme-set]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.themeSet === settings.theme)));
    return;
  }
  if (d.break && editing) {
    const b = d.break, on = t.getAttribute("aria-pressed") !== "true";
    t.setAttribute("aria-pressed", String(on));
    return editTick(editing.day, editing.key, row => { row.rule_breaks = on ? [...new Set([...row.rule_breaks, b])] : row.rule_breaks.filter(x => x !== b); });
  }
  if (t.id === "panel-close" || t.id === "panel-done") return closePanel();
  if (d.removeShot) {
    if (t.dataset.confirm !== "1") { t.dataset.confirm = "1"; t.textContent = "Delete?"; return; }
    return removeShot(editing.day, editing.key, d.removeShot);
  }
  if (d.addShot) { shotTarget = { day: selected, key: d.addShot }; const inp = document.getElementById("shotinput"); inp.value = ""; inp.click(); return; }
  if (d.viewShot) { const i = d.viewShot.indexOf("|"), path = d.viewShot.slice(i + 1); return openViewer(path.split("/")[0], d.viewShot.slice(0, i), path); }
  if (t.id === "viewer-close") return document.getElementById("viewer").close();
  if (t.id === "viewer-prev") return stepViewer(-1);
  if (t.id === "viewer-next") return stepViewer(1);
  if (t.id === "note-retry" && editing) { const v = document.getElementById("panel-note").value; return editTick(editing.day, editing.key, row => { row.note = v; }, true); }
  if (d.react) { const [kind, day, key] = d.react.split("|"); return toggleReaction(kind, day, key); }
  if (d.comments) { if (commentsOpen.has(d.comments)) commentsOpen.delete(d.comments); else commentsOpen.add(d.comments); return render(); }
  if (d.creply) {
    const c = findComment(Number(d.creply));
    if (!c) return;
    const k = c.day + "|" + c.member_key;
    replyTo[k] = c.reply_to || c.id; commentsOpen.add(k); render();
    const box = document.querySelector(`[data-cbox="${CSS.escape(k)}"]`) as HTMLTextAreaElement;
    if (box) box.focus();
    return;
  }
  if (d.creplyCancel) { delete replyTo[d.creplyCancel]; return render(); }
  if (d.csend) return sendComment(d.csend);
  if (d.cdel) {
    if (t.dataset.confirm !== "1") { t.dataset.confirm = "1"; t.textContent = "Delete?"; return; }
    return deleteComment(Number(d.cdel));
  }
  if (d.creport) { const c = findComment(Number(d.creport)); return c && openReport("comment", c.day, c.author_key, String(c.id)); }
  if (d.guide) {
    if (d.guide === "notif") return openSettings();
    tab = "admin"; profileKey = null; adminView = d.guide; flash = ""; error = ""; fixAdminView();
    return render();
  }
  if (t.id === "viewer-report") { const v = viewing; return v && openReport("picture", v.day, v.key, v.path); }
  if (t.id === "report-cancel") return document.getElementById("reportdlg").close();
  if (t.id === "report-send") return sendReport();
  if (d.reportNote) { const [day, key] = d.reportNote.split("|"); return openReport("note", day, key); }
  if (d.reportRemove) {
    if (t.dataset.confirm !== "1") { t.dataset.confirm = "1"; t.textContent = "Sure? Tap again"; return; }
    return resolveReport(+d.reportRemove, true);
  }
  if (d.reportKeep) return resolveReport(+d.reportKeep, false);
  if (d.reportView) { const r = reports.find(x => x.id === +d.reportView); if (r) window.open(shotUrls[r.image] || "about:blank", "_blank", "noopener"); return; }
  if (t.id === "viewer-delete") {
    if (t.dataset.confirm !== "1") { t.dataset.confirm = "1"; t.textContent = "Sure? Tap again"; return; }
    const v = viewing;
    document.getElementById("viewer").close();
    return v && removeShot(v.day, v.key, v.path);
  }
  if (d.day) { const k = d.day; setTab("day"); selected = k; return render(); }
  if (d.approve) {
    const who = (people.find(p => p.user_id === d.approve) || {}).discord_name || "They";
    return instantPerson(d.approve, { status: "approved" }, sb.rpc("approve_member", { g: gid, uid: d.approve, existing_key: null }), `Approved. ${who} is in.`);
  }
  if (d.reject) return instantPerson(d.reject, { status: "rejected", member_key: null }, memberQ({ status: "rejected", member_key: null }, d.reject), "Rejected.");
  if (d.revoke) {
    if (t.dataset.confirm !== "1") { t.dataset.confirm = "1"; t.textContent = "Sure? Tap again"; return; }
    const key = (people.find(p => p.user_id === d.revoke) || {}).member_key;
    const res = await memberQ({ status: "rejected", member_key: null, role: "member" }, d.revoke);
    if (res.error || !key) return adminDo(Promise.resolve(res), "Removed from the group.");
    return adminDo(sb.from("members").update({ active: false }).eq("key", key), "Removed from the group. Their history is kept.");
  }
  if (d.reconsider) return adminDo(memberQ({ status: "pending" }, d.reconsider), "");
  if (d.makeadmin) return adminDo(memberQ({ role: "admin" }, d.makeadmin), "They're a group admin now: they can approve people, add names and excuse days.");
  if (d.unadmin) return adminDo(memberQ({ role: "member" }, d.unadmin), "Admin removed.");
  if (d.adminView) { adminView = d.adminView; flash = ""; error = ""; return render(); }
  if (d.approveReq) return adminDo(sb.rpc("approve_group_request", { request_id: +d.approveReq }), "Group created. Its owner can open it now and share the join code.");
  if (d.rejectReq) return adminDo(sb.from("group_requests").update({ status: "rejected" }).eq("id", +d.rejectReq), "Request rejected.");
  if (d.openGroup) { adminView = "people"; return switchGroup(d.openGroup); }
  if (d.pauseGroup) {
    const x = groups.find(y => y.id === d.pauseGroup);
    return adminDo(sb.from("groups").update({ status: x.status === "paused" ? "active" : "paused" }).eq("id", x.id), x.status === "paused" ? `${x.name} is active again.` : `${x.name} is paused.`);
  }
  if (d.setOwner) {
    const uid = document.getElementById("owner-" + d.setOwner).value;
    return adminDo(sb.from("groups").update({ owner_id: uid }).eq("id", d.setOwner), `${profileName(uid)} owns this group now.`);
  }
  if (d.deleteGroup) {
    const x = groups.find(y => y.id === d.deleteGroup);
    if (t.dataset.confirm !== "1") { t.dataset.confirm = "1"; t.textContent = "Delete everything?"; return; }
    if (t.dataset.confirm2 !== "1") { t.dataset.confirm2 = "1"; t.textContent = `Really delete ${x.name}? Tap again`; return; }
    return adminDo(sb.from("groups").delete().eq("id", x.id), `${x.name} was deleted.`);
  }
  if (d.color) {
    // The color is saved as soon as you tap it (it used to wait for "Save settings", so leaving the page lost it).
    const g = group(), before = g.color, msg = document.getElementById("color-msg");
    if (d.color === before) return;
    document.querySelectorAll("[data-color]").forEach(b => b.setAttribute("aria-checked", String(b === t)));
    document.documentElement.dataset.accent = d.color;
    if (msg) msg.textContent = "Saving…";
    const { error: e2 } = await sb.from("groups").update({ color: d.color }).eq("id", gid);
    if (e2) {
      document.querySelectorAll("[data-color]").forEach(b => b.setAttribute("aria-checked", String(b.dataset.color === before)));
      document.documentElement.dataset.accent = before;
      if (msg) msg.textContent = "Couldn't save the color: " + e2.message;
      return;
    }
    g.color = d.color; applyGroupRules(g);
    if (msg) msg.textContent = "Saved";
    renderTop(); renderTabbar();
    return;
  }
  if (d.switchGroup) return switchGroup(d.switchGroup);
  if (d.rename) {
    const name = document.getElementById("mname-" + d.rename).value.trim();
    if (!name) return;
    return adminDo(sb.from("members").update({ name }).eq("key", d.rename), "Saved.");
  }
  if (d.hide) {
    if (t.dataset.confirm !== "1") { t.dataset.confirm = "1"; t.textContent = "Sure? Tap again"; return; }
    await sb.from("memberships").update({ status: "rejected", member_key: null, role: "member" }).eq("group_id", gid).eq("member_key", d.hide);
    return adminDo(sb.from("members").update({ active: false }).eq("key", d.hide), "Member removed.");
  }
  switch (t.id) {
    case "signin-end":
    case "signin-menu":
    case "signin-nav":
    case "signin-own":
    case "signin": {
      try { if (t.id === "signin-own") localStorage.setItem("lockedin.intent", "create"); else localStorage.removeItem("lockedin.intent"); } catch (err) { /* private mode */ }
      const { error: er } = await sb.auth.signInWithOAuth({ provider: "discord", options: { redirectTo: location.origin + location.pathname } });
      if (er) { error = er.message; render(); }
      return;
    }
    case "signout":
      if (push.sub) await turnRemindersOff();   // this device stops getting your reminders
      try { localStorage.removeItem(OUTBOX); } catch (e) {}
      await idbClear();   // nothing of yours stays on this device
      await sb.auth.signOut(); return;
    case "addmember": {
      const el = document.getElementById("newmember"), name = el.value.trim();
      if (!name) return;
      return adminDo(sb.rpc("add_member", { g: gid, member_name: name }), `Added ${name}.`);
    }
    case "toggleadmin": return setTab(tab === "admin" ? "day" : "admin");
    case "toggleme": return setTab(tab === "me" ? "day" : "me");
    case "close-admin": return setTab("day");
    case "start-tour": closePanel(); return startTour();
    case "open-groups": joinMsg = ""; return openGroupsPanel();
    case "join": return joinWithCode();
    case "send-request": return sendGroupRequest();
    case "leave-group": {
      if (t.dataset.confirm !== "1") { t.dataset.confirm = "1"; t.textContent = "Sure? Tap again"; return; }
      const { error: e } = await sb.from("memberships").delete().eq("group_id", gid).eq("user_id", session.user.id);
      if (e) { error = e.message; return render(); }
      closePanel(); loaded = false; screen = "loading"; render(); return loadAll();
    }
    case "copy-support": {
      try { await navigator.clipboard.writeText(cfg.contactEmail || ""); t.textContent = "Copied"; } catch (err) { t.textContent = "Select it below"; }
      return setTimeout(() => { t.textContent = "Copy address"; }, 1600);
    }
    case "copy-invite": {
      setGuideFlag("s");
      try { await navigator.clipboard.writeText(inviteLink(group().join_code)); t.textContent = "Link copied"; } catch (err) { t.textContent = inviteLink(group().join_code); }
      return setTimeout(() => { t.textContent = "Copy invite link"; }, 1800);
    }
    case "copy-code": {
      setGuideFlag("s");
      try { await navigator.clipboard.writeText(group().join_code); t.textContent = "Copied"; } catch (err) { t.textContent = "Select and copy"; }
      return setTimeout(() => { t.textContent = "Copy"; }, 1500);
    }
    case "new-code": {
      if (t.dataset.confirm !== "1") { t.dataset.confirm = "1"; t.textContent = "Old code stops working. Sure?"; return; }
      return adminDo(sb.rpc("new_join_code", { g: gid }), "New join code made. Share the new one; the old one no longer works.");
    }
    case "save-group": return saveGroupSettings();
    case "dc-save": return saveDiscord();
    case "xfer-go": return transferGroup();
    case "guide-hide": setGuideFlag("x"); return render();
    case "dc-test": {
      const m = document.getElementById("dc-msg"); m.textContent = "Sending…";
      const { error: e } = await sb.rpc("send_discord_test", { g: gid });
      m.textContent = e ? e.message : "Sent. Check the channel in Discord. If nothing shows up, the link may be wrong or the webhook was deleted.";
      return;
    }
    case "dc-remove": {
      if (t.dataset.confirm !== "1") { t.dataset.confirm = "1"; t.textContent = "Stop posting? Tap again"; return; }
      return adminDo(sb.from("group_discord").delete().eq("group_id", gid), "Disconnected. LockedIn no longer posts in your Discord.");
    }
    case "logo-pick": { const inp = document.getElementById("logoinput"); inp.value = ""; return inp.click(); }
    case "logo-remove": return adminDo(sb.from("groups").update({ logo_path: null }).eq("id", gid), "Logo removed.");
    case "create-group": {
      const el = document.getElementById("new-group"), name = el.value.trim();
      if (!name) return;
      const res = await adminDo(sb.rpc("create_group", { group_name: name }), `Created ${name}. Open it to set it up and get its join code.`);
      return res;
    }
    case "prev": selected = prevTrading(selected); weekStart = mondayOf(selected); return render();
    case "next": selected = nextTrading(selected); weekStart = mondayOf(selected); return render();
    case "gotoday": selected = today; weekStart = mondayOf(today); return render();
    case "thisweek": weekStart = mondayOf(today); return render();
    case "pw": weekStart = addDays(weekStart, -7); return render();
    case "nw": weekStart = addDays(weekStart, 7); return render();
  }
});
document.addEventListener("input", e => {
  if (e.target.dataset && e.target.dataset.cbox) { commentDrafts[e.target.dataset.cbox] = e.target.value; return; }
  if (e.target.id === "faq-search") { faqQuery = e.target.value.slice(0, 80); return render(); }
  if (tab === "admin" && e.target.closest && e.target.closest("#app")) adminDirty = true;
  if (e.target.id === "terms-ok") { document.getElementById("accept-terms").disabled = !e.target.checked; return; }
  if (e.target.id === "set-remind") return e.target.checked ? turnRemindersOn() : turnRemindersOff();
  if ((e.target.id === "panel-pnl" || e.target.id === "panel-rr") && editing) {
    const isPnl = e.target.id === "panel-pnl", v = parseNum(e.target.value, isPnl ? 10000000 : 100), hint = document.getElementById("num-hint");
    if (v === undefined) return;
    if (Number.isNaN(v)) { hint.textContent = isPnl ? "Numbers only, like 420 or -150.50." : "Numbers only, like 2 or -1, between -100 and 100."; hint.classList.add("bad"); return; }
    hint.textContent = "Optional. Use a minus for a loss, like -150. Your group sees it."; hint.classList.remove("bad");
    const { day, key } = editing;
    editTick(day, key, row => {
      row[isPnl ? "pnl" : "rr"] = v;
      // no result picked yet: a P&L (or else an R) picks Win or Loss
      const lead = hasNum(row.pnl) ? +row.pnl : hasNum(row.rr) ? +row.rr : 0;
      if (!row.no_trade && !row.result && lead) row.result = lead > 0 ? "win" : "loss";
    }, true);
    const rec = tickOf(day, key) || {};
    document.querySelectorAll("[data-result]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.result === resultOf(rec))));
    const h = document.getElementById("result-hint"); if (h) h.textContent = resultHint(rec);
    return;
  }
  if (e.target.dataset && e.target.dataset.refl) return editReflection(e.target.dataset.week, e.target.dataset.key, e.target.dataset.refl, e.target.value);
  if (e.target.id === "panel-excused" && editing) { const on = e.target.checked; return editTick(editing.day, editing.key, row => { row.excused = on; }); }
  if (e.target.id !== "panel-note" || !editing) return;
  const v = e.target.value;
  putDraft(editing.day + "|" + editing.key, v);
  editTick(editing.day, editing.key, row => { row.note = v; }, true);
});
document.addEventListener("change", e => { if (e.target.id === "daypick") goToDay(e.target.value); });
// Desktop browsers only open the calendar from its small icon; open it from anywhere on the date.
document.addEventListener("click", async e => {
  const clear = e.target.closest && e.target.closest("[data-faq-clear]");
  if (clear) { faqQuery = ""; render(); const f = document.getElementById("faq-search"); if (f) f.focus(); return; }
  const copy = e.target.closest && e.target.closest("[data-faq-copy]");
  if (!copy) return;
  const label = copy.querySelector("span"), url = faqLink(copy.dataset.faqCopy);
  try { await navigator.clipboard.writeText(url); label.textContent = "Link copied"; } catch (err) { label.textContent = url; }
  setTimeout(() => { label.textContent = "Copy link to this answer"; }, 1800);
});
// arrow keys move between questions; Escape in the search box clears it
document.addEventListener("keydown", e => {
  if (e.target.id === "faq-search" && e.key === "Escape" && faqQuery) { e.preventDefault(); faqQuery = ""; render(); return; }
  if (e.target.id === "faq-search" && e.key === "ArrowDown") { const s = document.querySelector("#faq-list summary"); if (s) { e.preventDefault(); s.focus(); } return; }
  if (!(e.target.tagName === "SUMMARY" && e.target.closest("#faq-list"))) return;
  const all = [...document.querySelectorAll("#faq-list summary")], i = all.indexOf(e.target as HTMLElement);
  const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: all.length - 1 }[e.key];
  if (to === undefined) return;
  e.preventDefault();
  if (to < 0) { const f = document.getElementById("faq-search"); if (f) f.focus(); return; }
  if (all[Math.min(to, all.length - 1)]) all[Math.min(to, all.length - 1)].focus();
});
document.addEventListener("click", e => { if (e.target.id === "daypick" && e.target.showPicker) try { e.target.showPicker(); } catch (err) {} });
// Phones: swipe left / right on the Day tab for the next / previous day, on the Week tab for weeks.
(function swipeDays() {
  let s = null;
  const app = document.getElementById("app");
  app.addEventListener("touchstart", e => {
    s = null;
    if (isWide() || profileKey || screen !== "app" || (tab !== "day" && tab !== "week") || e.touches.length !== 1) return;
    if (e.target.closest("input, textarea, select, .grid-wrap, .heat-wrap")) return;
    s = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  }, { passive: true });
  app.addEventListener("touchend", e => {
    if (!s) return;
    const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y, quick = Date.now() - s.t < 600;
    s = null;
    if (!quick || Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
    if (tab === "day") {
      if (dx > 0) goToDay(prevTrading(selected));
      else if (selected < today) goToDay(nextTrading(selected));
    } else {
      if (dx > 0) weekStart = addDays(weekStart, -7);
      else if (weekStart < mondayOf(today)) weekStart = addDays(weekStart, 7);
      render();
    }
  }, { passive: true });
})();
document.addEventListener("keydown", e => {
  if (e.key !== "Escape" || document.getElementById("viewer").open || tour) return;
  if (editing || settingsOpen) return closePanel();
  if (profileKey) { profileKey = null; render(); return window.scrollTo(0, 0); }
  if (tab === "admin" || tab === "me" || tab === "journal") setTab("day");
  if ((e.key as string) === "Enter" && e.target.id === "newmember") document.getElementById("addmember").click();
  if ((e.key as string) === "Enter" && e.target.id === "joincode") { e.preventDefault(); joinWithCode(); }
  if ((e.key as string) === "Enter" && e.target.id === "newbreak") { e.preventDefault(); addCustomBreak(); }
});
document.getElementById("scrim").addEventListener("click", closePanel);
wideQuery.addEventListener("change", () => render());
document.getElementById("shotinput").addEventListener("change", e => {
  const files = [...(e.target.files || [])];
  if (shotTarget) files.forEach(f => uploadShot(shotTarget.day, shotTarget.key, f));
  shotTarget = null;
});
document.getElementById("logoinput").addEventListener("change", e => uploadLogo(e.target.files && e.target.files[0]));
// With the ✎ panel open: paste a copied screenshot (⌘V / Ctrl+V) or drop picture files on the panel.
const imageFiles = list => [...(list || [])].filter(f => f && f.type && f.type.startsWith("image/"));
document.addEventListener("paste", e => {
  if (!editing || document.getElementById("viewer").open) return;
  const files = imageFiles([...(e.clipboardData ? e.clipboardData.items : [])].filter(i => i.kind === "file").map(i => i.getAsFile()));
  if (!files.length) return;   // normal text paste into the note
  e.preventDefault();
  files.forEach(f => uploadShot(editing.day, editing.key, f));
});
["dragenter", "dragover"].forEach(ev => panelEl.addEventListener(ev, (e: DragEvent) => {
  if (!editing || !e.dataTransfer || ![...e.dataTransfer.types].includes("Files")) return;
  e.preventDefault(); panelEl.classList.add("dropping");
}));
panelEl.addEventListener("dragleave", e => { if (!panelEl.contains(e.relatedTarget as Node)) panelEl.classList.remove("dropping"); });
panelEl.addEventListener("drop", e => {
  panelEl.classList.remove("dropping");
  if (!editing || !e.dataTransfer) return;
  e.preventDefault();
  imageFiles(e.dataTransfer.files).forEach(f => uploadShot(editing.day, editing.key, f));
});
// Dropping a file anywhere else shouldn't open it in the tab and leave the app.
window.addEventListener("dragover", e => e.preventDefault());
window.addEventListener("drop", e => e.preventDefault());

// Keep the time-left bar current, and roll over to the next trading day by itself.
setInterval(() => {
  const t = currentTradingDay();
  if (t !== today) { if (selected === today) selected = t; today = t; weekStart = mondayOf(selected); }
  if (screen === "app" && tab !== "admin" && document.visibilityState === "visible") autoRender();
}, 60000);
// While waiting for approval in a group, check every 20 seconds so the page opens as soon as you're approved.
setInterval(() => { if (screen === "lobby" && session && navigator.onLine && myMemberships.some(m => m.status === "pending")) loadAll().catch(() => {}); }, 20000);

// ---------------------------------------------------------------- pull down to refresh (phones)
async function refreshNow() {
  await loadGroups();
  if (!group() || !canOpen(group())) { loaded = false; return loadAll(); }
  await openGroup(gid);
}
(function pullToRefresh() {
  const pill = document.getElementById("ptr"), PULL = 80;
  let y0 = null, dy = 0, busy = false;
  const show = (icon, text, ready) => { pill.hidden = false; pill.innerHTML = ic(icon, 15) + text; pill.classList.toggle("ready", !!ready); };
  document.addEventListener("touchstart", e => {
    y0 = null;
    if (busy || screen !== "app" || isWide() || window.scrollY > 0 || e.touches.length !== 1) return;
    if (editing || settingsOpen || tour || document.getElementById("viewer").open) return;
    if (e.target.closest("textarea, input, select, .panel, .tabbar")) return;
    y0 = e.touches[0].clientY; dy = 0;
  }, { passive: true });
  document.addEventListener("touchmove", e => {
    if (y0 === null) return;
    dy = e.touches[0].clientY - y0;
    if (dy < 14 || window.scrollY > 0) { pill.hidden = true; return; }
    show("repeat", dy > PULL ? "Release to refresh" : "Pull to refresh", dy > PULL);
    pill.style.setProperty("--pull", Math.min(dy, 140) / 2.2 + "px");
  }, { passive: true });
  document.addEventListener("touchend", async () => {
    if (y0 === null) return;
    y0 = null;
    if (dy <= PULL || window.scrollY > 0) { pill.hidden = true; return; }
    busy = true;
    show("repeat", "Refreshing…", true); pill.classList.add("spin");
    try { await refreshNow(); show("check", "Up to date", true); } catch (err) { show("alert", "Couldn't refresh", true); }
    pill.classList.remove("spin");
    setTimeout(() => { pill.hidden = true; pill.style.removeProperty("--pull"); busy = false; }, 900);
  });
})();

// ---------------------------------------------------------------- tutorial
// A short tour that points at the real buttons. Starts by itself the first time; "Skip tutorial" ends it for good.
// Replay it from Me → Tutorial or Settings. Remembered in your settings, so it doesn't come back on another device.
let tour = null;   // { i, steps }
function listText(a) { return a.length > 1 ? a.slice(0, -1).join(", ") + " and " + a[a.length - 1] : a[0] || ""; }
function tourSteps() {
  const wide = isWide(), g = group(), me = myKey(), mine = me && canEdit(today, me);
  const req = RULES.filter(r => r[2] === "req").map(r => r[1]), bonus = RULES.filter(r => r[2] === "bonus").map(r => r[1]);
  const q = sel => () => document.querySelector(sel);
  const tabEl = t => wide ? null : q(`.tabbar [data-tab="${t}"]`);
  const myRow = () => { const b = document.querySelector(`.member [data-tick^="${me}:"]`) || document.querySelector(`[data-edit="${me}"]`); return b && b.closest(".member"); };
  const steps = [
    { title: `Welcome to ${g ? g.name : "LockedIn"}`, text: "Here's a quick tour of everything: about a minute. Skip it with the close button in the corner, and replay it any time from " + (wide ? "Profile" : "the Me tab") + "." },
    mine && { el: wide ? myRow : q(".quick .qgrid"), title: "Tick your homework",
      text: `Tap a box when it's done. Required: ${esc(listText(req))}. All required ticked = Complete (green circle).`
        + (bonus.length ? ` ${esc(listText(bonus))} ${bonus.length > 1 ? "are bonus boxes" : "is a bonus box"}: extra points.` : "")
        + ` You can tick until ${hh(CUTOFF_HOUR)} ${esc(tzCity(TZ))} time on the next trading day.` },
    mine && { el: wide ? q(`[data-edit="${me}"]`) : q(".quick .qnote"), title: "Note & pictures",
      text: "Write your note, add chart screenshots" + (wide ? " (you can paste them with ⌘V / Ctrl+V)" : "") + ", tag rule breaks, mark the day as a win, loss, no trade or gamble, and on Fridays write your weekly reflection. Everything saves by itself." },
    { el: () => { return document.querySelector("#app .daysum"); }, title: "Time left today",
      text: "How many of you are done, who still has homework open, and how much time is left. In the last hour the timer turns red, and you get a reminder if you're not done yet." },
    { el: () => { const m = [...document.querySelectorAll("#app .member")].find(x => !x.querySelector(`[data-edit="${me}"]`)); return m; }, title: "Everyone's day",
      text: "The circle shows each person's status: green complete, yellow partial, red missing. Tap a name for their profile and badges, tap a picture to see it full screen." },
    { el: q(".topbar .datepick"), title: "Change the day",
      text: "Tap the date to jump to any day." + (wide ? " Or use the ‹ › arrows." : " Or use ‹ ›, or swipe left and right on the page.") },
    { el: q("#open-groups"), title: "Your groups", text: "Tap the group name to switch groups, join another one with a code, or start your own group." },
    { el: wide ? q('#rail [data-nav="week"]') : tabEl("week"), title: "Week",
      text: "The whole week at a glance. Tap any square to open that day. Everyone's weekly reflections are there too." },
    { el: wide ? q('#rail [data-nav="board"]') : tabEl("board"), title: "Ranking",
      text: `Points: Complete ${POINTS.COMPLETE}, Partial ${POINTS.PARTIAL}${bonus.length ? `, +${POINTS.bonus} for each bonus box` : ""}. Your streak is Complete days in a row. Earn badges for streaks, notes, pictures and more.` },
    { el: wide ? q("#toggleme") : tabEl("me"), title: "Me",
      text: (wide ? "Your profile and badges. Journal has your notes, pictures, rule breaks and reflections. " : "Your profile and badges, and your Journal: notes, pictures, rule breaks and reflections. ")
        + "Settings has light or dark mode, your own rule-break tags and the app icon for your phone. Sign out and this tutorial are at the bottom of " + (wide ? "Profile." : "Me.") },
    isAdmin && { el: wide ? q("#toggleadmin") : tabEl("admin"), title: "Admin",
      text: `You help run ${esc(g ? g.name : "this group")}: share the join code, approve people, excuse days${isGroupOwner() ? ", and change the group's settings (boxes, points, time, color, logo)" : ""}.` },
    { title: "You're all set", text: (wide ? "" : "Tip: pull down at the top of the page to refresh. ") + "Good luck today, and stay locked in." },
  ];
  return steps.filter(Boolean);
}
function maybeStartTour() {
  if (tour || !settingsLoaded || settings.tutorialDone || screen !== "app" || !loaded || !(myKey() || isAdmin)) return;
  if (editing || settingsOpen) return;
  startTour();
}
function startTour() {
  if (screen !== "app") return;
  tab = "day"; profileKey = null; selected = today; weekStart = mondayOf(today);
  render();
  tour = { i: 0, steps: tourSteps() };
  document.getElementById("tour").hidden = false;
  document.body.style.overflow = "hidden";
  showTourStep();
}
function endTour() {
  if (!tour) return;
  tour = null;
  document.getElementById("tour").hidden = true;
  document.body.style.overflow = "";
  window.scrollTo(0, 0);
  if (!settings.tutorialDone) { settings.tutorialDone = true; saveSettings(); }
}
function showTourStep() {
  const st = tour.steps[tour.i], n = tour.steps.length, last = tour.i === n - 1;
  document.getElementById("tour-n").textContent = `${tour.i + 1} / ${n}`;
  document.getElementById("tour-title").textContent = st.title;
  document.getElementById("tour-text").innerHTML = st.text;
  document.getElementById("tour-dots").innerHTML = tour.steps.map((_, j) => `<i class="${j === tour.i ? "on" : ""}"></i>`).join("");
  document.getElementById("tour-back").hidden = tour.i === 0;
  document.getElementById("tour-next").textContent = tour.i === 0 ? "Start tour" : last ? "Finish" : "Next";
  const el = st.el && st.el();
  if (el && !el.closest(".topbar, .tabbar")) {
    const r = el.getBoundingClientRect();
    if (r.top < 90 || r.bottom > innerHeight - 220) window.scrollTo(0, Math.max(0, window.scrollY + r.top - Math.max(90, (innerHeight - r.height) / 2 - 80)));
  }
  placeTour();
  document.getElementById("tour-next").focus({ preventScroll: true });
}
function placeTour() {
  if (!tour) return;
  const st = tour.steps[tour.i], el = st.el && st.el();
  const hole = document.getElementById("tour-hole"), card = document.getElementById("tour-card"), wrap = document.getElementById("tour");
  const cw = Math.min(360, innerWidth - 32);
  card.style.width = cw + "px";
  if (!el || !el.getClientRects().length) {
    wrap.classList.add("center"); hole.hidden = true;
    card.style.left = (innerWidth - cw) / 2 + "px"; card.style.top = Math.max(16, (innerHeight - card.offsetHeight) / 2) + "px";
    return;
  }
  wrap.classList.remove("center"); hole.hidden = false;
  const r = el.getBoundingClientRect(), pad = 6;
  Object.assign(hole.style, { left: r.left - pad + "px", top: r.top - pad + "px", width: r.width + pad * 2 + "px", height: r.height + pad * 2 + "px" });
  const ch = card.offsetHeight, below = r.bottom + pad + 12, above = r.top - pad - 12 - ch;
  const top = below + ch < innerHeight - 12 ? below : above > 12 ? above : Math.max(12, innerHeight - ch - 12);
  card.style.top = top + "px";
  card.style.left = Math.min(innerWidth - cw - 16, Math.max(16, r.left + r.width / 2 - cw / 2)) + "px";
}
document.getElementById("tour-next").addEventListener("click", () => { if (tour.i === tour.steps.length - 1) return endTour(); tour.i++; showTourStep(); });
document.getElementById("tour-back").addEventListener("click", () => { if (tour.i > 0) { tour.i--; showTourStep(); } });
document.getElementById("tour-skip").addEventListener("click", endTour);
document.addEventListener("keydown", e => {
  if (!tour) return;
  if (e.key === "Escape") { e.stopImmediatePropagation(); endTour(); }
  if (e.key === "ArrowRight") document.getElementById("tour-next").click();
  if (e.key === "ArrowLeft") document.getElementById("tour-back").click();
}, true);
addEventListener("resize", () => tour && placeTour());
addEventListener("scroll", () => tour && placeTour(), { passive: true });

// ---------------------------------------------------------------- offline
// The last loaded group is kept on this device, so the app still opens without internet.
// Ticks made without internet wait in an "outbox" on this device and upload when the connection is back.
var offline = !navigator.onLine, offlineSince = null;   // var, not let: render() can run before this line
// Saved in IndexedDB (room for years of ticks); localStorage is kept small for note backups and the outbox.
const snapKey = (g = gid) => "snap:" + (session ? session.user.id : "") + ":" + g;
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    if (!("indexedDB" in window)) return rej(new Error("no IndexedDB"));
    const r = indexedDB.open("lockedin", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbDo(mode, fn): Promise<any> {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction("kv", mode), req = fn(tx.objectStore("kv"));
    tx.oncomplete = () => res(req && req.result); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
  });
}
const idbGet = k => idbDo("readonly", st => st.get(k)).catch(() => null);
const idbSet = (k, v) => idbDo("readwrite", st => st.put(v, k)).catch(() => {});
const idbClear = () => idbDo("readwrite", st => st.clear()).catch(() => {});
try { Object.keys(localStorage).filter(k => k.startsWith("snap:")).forEach(k => localStorage.removeItem(k)); } catch (e) {}   // old copies
async function readSnapshot(g) {
  const snap = await idbGet(snapKey(g));
  return snap && snap.gid === g ? snap : null;
}
function saveSnapshot() {
  if (!session || !loaded || offlineSince || !gid) return;
  idbSet(snapKey(), { at: Date.now(), gid, groups, myMemberships, profile, isAppOwner, members, holidays: [...HOLIDAYS],
    ticks: Object.values(ticks), reflections: Object.values(reflections), syncedAt });
}
async function restoreSnapshot() {
  const snap = await readSnapshot(gid);
  if (!snap || !snap.groups) return false;
  gid = snap.gid; groups = snap.groups; myMemberships = snap.myMemberships; profile = snap.profile; isAppOwner = snap.isAppOwner;
  members = snap.members; HOLIDAYS = new Set(snap.holidays || []); dateMemo.next.clear();
  ticks = {}; (snap.ticks || []).forEach(r => { ticks[r.day + "|" + r.member_key] = r; });
  reflections = {}; (snap.reflections || []).forEach(r => { reflections[r.week_start + "|" + r.member_key] = r; });
  syncedAt = snap.syncedAt || null;
  applyGroupRules(group());
  isAdmin = canManageGroup(); people = [];
  applyOutbox();
  today = currentTradingDay(); selected = today; weekStart = mondayOf(today);
  if (tab === "admin") tab = "day";
  offlineSince = snap.at; loaded = true; screen = "app"; error = "";
  render();
  return true;
}
var OUTBOX = "outbox";
function getOutbox() { try { return JSON.parse(localStorage.getItem(OUTBOX) || "{}"); } catch (e) { return {}; } }
function putOutbox(o) { try { localStorage.setItem(OUTBOX, JSON.stringify(o)); } catch (e) {} }
// Show ticks still waiting to upload (they're newer than what the server sent).
function applyOutbox() {
  const o = getOutbox();
  for (const id in o) if (members.some(m => m.key === o[id].member_key)) ticks[id] = Object.assign({}, ticks[id], o[id]);
}
const isNetErr = e => !navigator.onLine || /fetch|network|load failed|offline|internet/i.test((e && e.message) || "");
let flushing = false;
async function flushOutbox() {
  if (flushing || !session || !navigator.onLine) return;
  const o = getOutbox(), ids = Object.keys(o);
  if (!ids.length) return;
  flushing = true;
  for (const id of ids) {
    let e;
    try { ({ error: e } = await sb.from("ticks").upsert(o[id], { onConflict: "day,member_key" })); }
    catch (err) { e = { message: "network: " + err.message }; }
    if (e && isNetErr(e)) break;   // still no connection: try again later
    const cur = getOutbox();
    if (JSON.stringify(cur[id]) === JSON.stringify(o[id])) delete cur[id];   // unless you changed it again meanwhile
    putOutbox(cur);
    if (e) error = e.code === "42501" || /row-level security/i.test(e.message)
      ? `A tick from ${fmtDay(o[id].day)} couldn't upload: that day closed before you were back online.` : "Not saved: " + e.message;
    else if (noteState[id] === "offline") noteState[id] = "saved";
  }
  flushing = false;
  render();
}
window.addEventListener("online", async () => {
  offline = false; render();
  if (screen === "app" && offlineSince) { try { await refreshNow(); } catch (e) {} }
  flushOutbox();
});
window.addEventListener("offline", () => { offline = true; render(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") saveSnapshot(); });
function offlineBar() {
  const n = Object.keys(getOutbox()).length;
  if (!offline && !offlineSince && !n) return "";
  const when = offlineSince ? new Date(offlineSince).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  const text = offline ? "You're offline. Your ticks are saved on this device and upload when you're back online."
    : offlineSince ? "Can't reach the server right now." : `${n} tick${n > 1 ? "s" : ""} waiting to upload.`;
  return `<div class="offline-bar" role="status">${ic("alert", 16)}<span>${text}${offlineSince ? ` Showing what was loaded at ${when}.` : ""}</span>
    ${!offline ? `<button class="linkbtn" id="retry-load">Try again</button>` : ""}</div>`;
}
// Start: load from the server; if that's impossible, open the copy saved on this device.
async function startLoad() {
  if (!navigator.onLine && await restoreSnapshot()) return;
  try {
    await loadAll();
    loadPush();
  } catch (err) {
    if (isNetErr(err) || !navigator.onLine || /Couldn't load groups: (TypeError|Failed|Load failed)/i.test(err.message)) {
      if (await restoreSnapshot()) return;
      screen = "offline"; clearTimeout(loadTimer); return render();
    }
    throw err;
  }
}

// ---------------------------------------------------------------- reminders (notifications)
// Settings → Reminders asks for permission and saves this device's push address in the database. The
// send-reminders function (supabase/functions) then notifies you if your homework isn't done before the day closes.
const VAPID = cfg.vapidPublicKey || "";
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const push = { sub: null, busy: false, msg: "" };
let remindMins = 60;
try { remindMins = +localStorage.getItem("remindMins") || 60; } catch (e) {}
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
// The background helper (sw.js); null if it isn't running.
function swReg() {
  if (!("serviceWorker" in navigator)) return Promise.resolve(null);
  return Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(() => r(null), 6000))]);
}
async function loadPush() {
  if (!VAPID || !pushSupported() || !session) return;
  try { const reg = await swReg(); push.sub = reg ? await reg.pushManager.getSubscription() : null; } catch (e) { push.sub = null; }
  // Keeps this device's address up to date and under the account that's signed in now.
  if (push.sub && Notification.permission === "granted") savePushSub().catch(() => {});
  renderRemind();
}
async function savePushSub() {
  const j = push.sub.toJSON();
  const { error: e } = await sb.rpc("save_push_subscription", { sub_endpoint: j.endpoint, sub_p256dh: j.keys.p256dh, sub_auth: j.keys.auth, sub_minutes: remindMins });
  if (e) throw new Error(/function|schema cache/i.test(e.message) ? "Reminders aren't set up yet (database update 10)." : e.message);
}
async function turnRemindersOn() {
  const asked = Notification.requestPermission();   // first, while it still counts as your tap
  push.busy = true; push.msg = ""; renderRemind();
  try {
    const perm = await asked;
    if (perm !== "granted") throw new Error(perm === "denied" ? "" : "You didn't allow notifications.");
    const reg = await swReg();
    if (!reg) throw new Error("Reminders couldn't start. Reload the page and try again.");
    push.sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64u(VAPID) });
    await savePushSub();
    reg.showNotification("Reminders are on", { body: "You'll get a notification here if your homework isn't done before the day closes.", icon: "icons/icon-192.png", tag: "remind-on" });
  } catch (e) { push.msg = e.message || String(e); }
  push.busy = false; renderRemind();
}
async function turnRemindersOff() {
  push.busy = true; renderRemind();
  try {
    if (push.sub) { await sb.from("push_subscriptions").delete().eq("endpoint", push.sub.endpoint); await push.sub.unsubscribe(); }
  } catch (e) {}
  push.sub = null; push.busy = false; push.msg = ""; renderRemind();
}
function remindHtml() {
  if (!VAPID) return "";
  const head = "";   // the Settings page gives this section its own heading
  if (!pushSupported()) return head + `<p class="sub-hint">${isIOS() && !isInstalled()
    ? "On iPhone, reminders work in the app: add LockedIn to your Home Screen first (see <b>App on your phone</b>), then open it from there and turn reminders on."
    : "This browser can't show reminders. Try Chrome, Edge, Firefox or Safari."}</p>`;
  const blocked = Notification.permission === "denied", on = !!push.sub && Notification.permission === "granted";
  const opt = (m, l) => `<button data-remind="${m}" aria-pressed="${remindMins === m}">${l}</button>`;
  const owns = groups.some(g => session && (g.owner_id === session.user.id || (myMembership(g.id) || {}).role === "admin"));
  return head + `<label class="switchrow"><span><b>Remind me</b><small>A notification on this ${isWide() ? "computer" : "phone"} if your homework isn't done before the day closes.${owns ? " You'll also be told when someone asks to join your group or reports something." : ""}</small></span>
      <input type="checkbox" id="set-remind" role="switch" ${on ? "checked" : ""} ${push.busy || blocked ? "disabled" : ""}></label>
    ${on ? `<div class="segset four" role="group" aria-label="How long before the day closes">${opt(30, "30 min")}${opt(60, "1 hour")}${opt(120, "2 hours")}${opt(180, "3 hours")}</div>
      <p class="sub-hint" style="margin-top:8px">before the day closes. Turn it on on each phone or computer you use.</p>` : ""}
    ${blocked ? `<p class="sub-hint bad">Notifications are blocked for this site. Allow them in ${isIOS() ? "iPhone Settings → Notifications → LockedIn" : "your browser's site settings (the icon left of the address)"}, then reload.</p>` : ""}
    ${push.msg ? `<p class="sub-hint bad">${esc(push.msg)}</p>` : ""}`;
}
function renderRemind() { const el = document.getElementById("remind-box"); if (el) el.innerHTML = remindHtml(); }
if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});

// ---------------------------------------------------------------- your data (download / delete)
function dataMsg(text, bad?) { const el = document.getElementById("data-msg"); if (el) { el.textContent = text; el.classList.toggle("bad", !!bad); } }
const notSetUp = m => /function|schema cache/i.test(m) ? "This isn't set up yet (database update 11)." : m;
async function exportMyData() {
  dataMsg("Preparing your file…");
  const { data, error: e } = await sb.rpc("export_my_data");
  if (e) return dataMsg(notSetUp(e.message), true);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `lockedin-my-data-${today}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  dataMsg("Downloaded.");
}
async function deleteMyAccount(btn) {
  if (!btn.classList.contains("armed")) {
    btn.classList.add("armed"); btn.textContent = "Tap again to delete everything";
    dataMsg("This deletes your account, ticks, notes, reflections and pictures for good. It can't be undone.", true);
    return;
  }
  btn.disabled = true; dataMsg("Deleting…");
  const paths = await sb.rpc("my_screenshot_paths");
  if (paths.error) { btn.disabled = false; return dataMsg(notSetUp(paths.error.message), true); }
  const list = (paths.data || []).map(x => typeof x === "string" ? x : x.my_screenshot_paths).filter(Boolean);
  for (let i = 0; i < list.length; i += 100) {
    const { error: e } = await sb.storage.from("screenshots").remove(list.slice(i, i + 100));
    if (e) { btn.disabled = false; return dataMsg("Couldn't delete your pictures: " + e.message + ". Nothing else was deleted. Try again.", true); }
  }
  const { error: e } = await sb.rpc("delete_my_account");
  if (e) { btn.disabled = false; return dataMsg(notSetUp(e.message), true); }
  if (push.sub) try { await push.sub.unsubscribe(); } catch (err) {}
  try { Object.keys(localStorage).filter(k => /^(draft:|badges:|outbox|remindMins|group|tab|mnq-settings)/.test(k)).forEach(k => localStorage.removeItem(k)); } catch (err) {}
  await idbClear();
  closePanel();
  await sb.auth.signOut();
  error = "Your account and data were deleted.";
  screen = "signin"; render();
}

// ---------------------------------------------------------------- errors
// If something breaks, show what went wrong (and a reload button) instead of an endless "Loading…".
function showCrash(err) {
  const msg = err && err.message ? err.message + (err.stack && !err.stack.includes(err.message) ? "\n\n" + err.stack : "") : String(err);
  console.error(err);
  const app = document.getElementById("app");
  if (!app || app.dataset.crashed) return;
  app.dataset.crashed = "1";
  const sp = document.getElementById("splash"); if (sp) sp.remove();
  app.innerHTML = `<div class="card"><p class="msg err"><b>Something went wrong.</b> Send your group owner a screenshot of this box.</p>
    <pre style="white-space:pre-wrap;font:12px/1.4 var(--font-data);color:var(--text-2);margin:10px 0">${esc(msg).slice(0, 1200)}</pre>
    <button class="btn plain small" onclick="location.reload()">Reload</button></div>`;
}
// Once the app is running, a stray error (often just bad signal) shouldn't wipe the screen: show a short note instead.
function softError(err) {
  if (screen !== "app" || !loaded) return showCrash(err);
  console.error(err);
  const m = (err && err.message) || String(err);
  error = isNetErr(err) ? "No connection. Changes are kept and retried." : "Something went wrong: " + m.slice(0, 80);
  try { renderTop(); } catch (e) {}
}
window.addEventListener("error", e => softError(e.error || e.message));
window.addEventListener("unhandledrejection", e => softError(e.reason));
let loadTimer = null;
function watchLoading() {
  clearTimeout(loadTimer);
  loadTimer = setTimeout(() => {
    if (screen === "loading") showCrash(new Error(`Still loading after 15 seconds (stuck at: ${loadStep}). ` +
      "Tap Reload. If it keeps happening, send your group owner this message."));
  }, 15000);
}
watchLoading();

// ---------------------------------------------------------------- start
// After "Sign in with Discord" you come back with the sign-in details (or an error) after a # in the address.
// Show a sign-in error in plain words, and never leave a stray "#" in the address bar.
const authHash = new URLSearchParams(location.hash.replace(/^#/, ""));
if (authHash.get("error_description")) {
  error = "Sign-in didn't work: " + authHash.get("error_description").replace(/\+/g, " ") + ". Try again.";
  history.replaceState(null, "", location.pathname + location.search);
}
function tidyAddress() {
  if (location.href.endsWith("#") || (location.hash && !/access_token|error/.test(location.hash))) history.replaceState(null, "", location.pathname + location.search);
}
(async () => {
  if (!sb) { screen = "setup"; return render(); }
  sb.auth.onAuthStateChange((event, s) => {
    const was = session && session.user.id;
    session = s;
    if (!s) { screen = "signin"; profile = null; isAdmin = false; if (channel) { sb.removeChannel(channel); channel = null; } render(); }
    else if (s.user.id !== was) { screen = "loading"; render(); watchLoading(); setTimeout(startLoad, 0); }
  });
  const { data } = await sb.auth.getSession();
  setTimeout(tidyAddress, 0);
  if (!data.session) { screen = "signin"; render(); }
})();

export {};
