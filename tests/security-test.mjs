// Security test for supabase/*.sql. Run:  cd tests && npm install --no-save @electric-sql/pglite@0.2.17 http_ece@1.2.0 && node security-test.mjs
// Loads setup.sql + every update into an in-memory Postgres that mimics Supabase, then tries to break the rules.
// Updates 2-8 are tested first (one group), then update 9 (groups) is loaded on top of that data and tested,
// then update 10 (reminders; everything above its SCHEDULE part, which needs Supabase's pg_cron), then update 11 (your data), then update 12 (helpers locked), then update 13 (accepting the Terms).
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../supabase/", import.meta.url));
const FILES = ["setup.sql", "update-2-screenshots.sql", "update-3-excused.sql", "update-4-avatars.sql", "update-5-notrade-reflection.sql", "update-6-rulebreaks-settings.sql", "update-7-custom-rulebreaks.sql", "update-8-long-notes.sql"];
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${l}`); };
const section = t => console.log(`\n-- ${t}`);

await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, raw_user_meta_data jsonb, created_at timestamptz default clock_timestamp());
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  create publication supabase_realtime;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id serial primary key, bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  grant usage on schema storage to anon, authenticated;
  grant select, insert, delete on storage.objects to authenticated;
  grant usage on sequence storage.objects_id_seq to authenticated;
`);
for (const f of FILES) await db.exec(readFileSync(dir + f, "utf8"));
console.log("loaded:", FILES.join(", "));

const U = { batko: "00000000-0000-0000-0000-00000000000a", sid: "00000000-0000-0000-0000-00000000000b",
            stranger: "00000000-0000-0000-0000-00000000000c", eddie: "00000000-0000-0000-0000-00000000000d" };
const meta = n => ({ full_name: n, avatar_url: `https://cdn.discordapp.com/avatars/1/${n}.png` });
for (const k of ["batko", "sid", "stranger", "eddie"]) await db.query(`insert into auth.users (id, raw_user_meta_data) values ($1, $2)`, [U[k], meta(k)]);
await db.exec(readFileSync(dir + "make-me-admin.sql", "utf8"));

async function as(who, sql, params = []) {
  await db.exec("reset role");
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [who === "anon" || who === "service" ? "" : U[who]]);
  await db.exec(`set role ${who === "anon" ? "anon" : who === "service" ? "service_role" : "authenticated"}`);
  try { const r = await db.query(sql, params); return { rows: r.rows, count: r.affectedRows ?? r.rows.length }; }
  catch (e) { return { error: e.message }; }
  finally { await db.exec("reset role"); }
}
const one = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const today = (await one(`select public.current_trading_day()::text d`)).d;
const yesterday = (await one(`select (public.current_trading_day() - 1)::text d`)).d;
const week = (await one(`select public.current_week_start()::text d`)).d;
const lastWeek = (await one(`select (public.current_week_start() - 7)::text d`)).d;
console.log("open trading day:", today, "· week:", week);
let r;

section("sign-in and approval");
ok((await one(`select count(*)::int n from public.profiles where status='pending'`)).n === 3, "new sign-ins wait for approval");
ok((await one(`select count(*)::int n from public.admins where user_id=$1`, [U.batko])).n === 1, "make-me-admin makes the first account admin");
r = await as("stranger", `update public.profiles set status='approved', member_key='jaybo' where user_id=$1`, [U.stranger]);
ok(!r.error && r.count === 0, "nobody can approve themselves");
r = await as("stranger", `insert into public.admins (user_id) values ($1)`, [U.stranger]);
ok(!!r.error, "nobody can make themselves admin");
r = await as("batko", `update public.profiles set status='approved', member_key='sid' where user_id=$1`, [U.sid]);
ok(!r.error && r.count === 1, "admin can approve someone and give them a name");
await as("batko", `update public.profiles set status='approved', member_key='eddie' where user_id=$1`, [U.eddie]);
r = await as("batko", `update public.profiles set member_key='sid' where user_id=$1`, [U.stranger]);
ok(!!r.error, "one name belongs to one Discord account");

section("ticks");
r = await as("stranger", `select * from public.ticks`);
ok(!r.error && r.rows.length === 0, "people waiting see no ticks");
r = await as("anon", `select * from public.ticks`);
ok(!!r.error, "signed-out visitors get nothing");
r = await as("sid", `insert into public.ticks (day, member_key, chart, updated_by) values ($1, 'sid', true, $2)`, [today, U.batko]);
ok(!r.error, "member ticks their own row on the open day");
ok((await one(`select updated_by::text u from public.ticks where member_key='sid'`)).u === U.sid, "'changed by' can't be faked");
r = await as("sid", `insert into public.ticks (day, member_key, chart) values ($1, 'eddie', true)`, [today]);
ok(!!r.error, "member cannot tick someone else's row");
r = await as("sid", `insert into public.ticks (day, member_key, chart) values ($1, 'sid', true)`, [yesterday]);
ok(!!r.error, "member cannot tick a closed day");
r = await as("sid", `update public.ticks set member_key='eddie' where member_key='sid'`);
ok(!!r.error || r.count === 0, "member cannot move their row onto someone else");
r = await as("sid", `delete from public.ticks`);
ok(!r.error && r.count === 0, "members cannot delete ticks");
r = await as("sid", `update public.members set name='hacked'`);
ok(!r.error && r.count === 0, "members cannot rename members");
r = await as("batko", `insert into public.ticks (day, member_key, chart) values ($1, 'jaybo', true)`, [yesterday]);
ok(!r.error, "admin can tick anyone on any day");

section("screenshots (update 2)");
const put = (who, path) => as(who, `insert into storage.objects (bucket_id, name) values ('screenshots', $1)`, [path]);
ok(!(await put("sid", `${today}/sid/1.jpg`)).error, "member uploads to their own row on the open day");
ok(!!(await put("sid", `${today}/eddie/2.jpg`)).error, "member cannot upload into someone else's row");
ok(!!(await put("sid", `${yesterday}/sid/3.jpg`)).error, "member cannot upload to a closed day");
ok(!!(await put("sid", `${today}/sid/x/../../eddie/4.jpg`)).error, "tricky file paths are refused");
ok(!!(await put("stranger", `${today}/sid/5.jpg`)).error, "people waiting cannot upload");
r = await as("stranger", `select * from storage.objects`);
ok(r.rows.length === 0, "people waiting see no screenshots");
r = await as("sid", `insert into public.ticks (day, member_key, images) values ($1, 'sid', '{a,b,c,d,e}') on conflict (day, member_key) do update set images = excluded.images`, [today]);
ok(!!r.error, "max 4 screenshots per member per day");

section("excused days (update 3)");
const excused = async (k, d) => (await one(`select excused from public.ticks where member_key=$1 and day=$2`, [k, d])).excused;
await as("eddie", `insert into public.ticks (day, member_key, chart, excused) values ($1, 'eddie', true, true)`, [today]);
ok((await excused("eddie", today)) === false, "member cannot excuse themselves");
await as("eddie", `update public.ticks set excused = true where member_key='eddie' and day=$1`, [today]);
ok((await excused("eddie", today)) === false, "member cannot excuse themselves by updating");
await as("batko", `update public.ticks set excused = true where member_key='eddie' and day=$1`, [today]);
ok((await excused("eddie", today)) === true, "admin can excuse a member");
await as("eddie", `update public.ticks set journal = true where member_key='eddie' and day=$1`, [today]);
ok((await excused("eddie", today)) === true, "member saving their row keeps the excuse");

section("Discord pictures (update 4)");
const av = async k => (await one(`select avatar_url from public.members where key=$1`, [k])).avatar_url;
ok((await av("sid")) === meta("sid").avatar_url, "approved member's name shows their Discord picture");
await db.query(`update auth.users set raw_user_meta_data=$2 where id=$1`, [U.sid, { full_name: "sid", avatar_url: "https://cdn.discordapp.com/avatars/1/NEW.png" }]);
ok((await av("sid")).endsWith("NEW.png"), "a new Discord picture appears after signing in again");
r = await as("sid", `update public.members set avatar_url='https://evil.example/x.png' where key='sid'`);
ok(!r.error && r.count === 0, "members cannot set a picture by hand");

section("no-trade days and reflections (update 5)");
ok((await one(`select extract(isodow from public.current_week_start())::int d`)).d === 1, "current week starts on a Monday");
r = await as("sid", `update public.ticks set no_trade = true, journal = true, review = true where member_key='sid' and day=$1`, [today]);
ok(!r.error && r.count === 1, "member can mark their own open day as no-trade");
r = await as("sid", `update public.ticks set no_trade = true where member_key='jaybo'`);
ok(!r.error && r.count === 0, "member cannot mark someone else's day as no-trade");
r = await as("sid", `insert into public.reflections (week_start, member_key, went_well, to_fix) values ($1, 'sid', 'Waited for setups', 'Early entries')`, [week]);
ok(!r.error, "member writes their own reflection for this week");
r = await as("sid", `update public.reflections set to_fix='Size down' where member_key='sid' and week_start=$1`, [week]);
ok(!r.error && r.count === 1, "member edits their own reflection this week");
r = await as("sid", `insert into public.reflections (week_start, member_key, went_well) values ($1, 'eddie', 'fake')`, [week]);
ok(!!r.error, "member cannot write someone else's reflection");
r = await as("sid", `insert into public.reflections (week_start, member_key, went_well) values ($1, 'sid', 'late')`, [lastWeek]);
ok(!!r.error, "member cannot write a reflection for a past week");
r = await as("sid", `delete from public.reflections`);
ok(!r.error && r.count === 0, "members cannot delete reflections");
r = await as("batko", `insert into public.reflections (week_start, member_key, went_well) values ($1, 'eddie', 'by admin')`, [lastWeek]);
ok(!r.error, "admin can write any reflection, any week");
r = await as("eddie", `select count(*)::int n from public.reflections`);
ok(r.rows[0].n === 2, "approved members read everyone's reflections");
r = await as("stranger", `select count(*)::int n from public.reflections`);
ok(r.rows[0].n === 0, "people waiting see no reflections");
ok((await one(`select updated_by::text u from public.reflections where member_key='sid'`)).u === U.sid, "reflection 'changed by' can't be faked");
r = await as("batko", `insert into public.reflections (week_start, member_key) values ('2026-11-04', 'sid')`);
ok(!!r.error, "a reflection week must start on a Monday");

section("rule-break tags and settings (update 6)");
r = await as("sid", `update public.ticks set rule_breaks = '{moved_stop,fomo}' where member_key='sid' and day=$1`, [today]);
ok(!r.error && r.count === 1, "member tags rule breaks on their own open day");
r = await as("sid", `update public.ticks set rule_breaks = '{moved_stop,"Traded the news"}' where member_key='sid' and day=$1`, [today]);
ok(!r.error && r.count === 1, "custom rule-break tags are allowed (update 7)");
r = await as("sid", `update public.ticks set rule_breaks = array[repeat('x', 31)] where member_key='sid' and day=$1`, [today]);
ok(!!r.error, "a tag longer than 30 characters is refused");
r = await as("sid", `update public.ticks set rule_breaks = '{""}' where member_key='sid' and day=$1`, [today]);
ok(!!r.error, "an empty tag is refused");
r = await as("sid", `update public.ticks set rule_breaks = '{"<script>x</script>"}' where member_key='sid' and day=$1`, [today]);
ok(!!r.error, "tags with < or > (web code) are refused");
r = await as("sid", `update public.ticks set rule_breaks = '{a,b,c,d,e,f,g,h,i,j,k}' where member_key='sid' and day=$1`, [today]);
ok(!!r.error, "max 10 tags on one day");
r = await as("sid", `update public.ticks set rule_breaks = '{revenge}' where member_key='jaybo'`);
ok(!r.error && r.count === 0, "member cannot tag someone else's day");
r = await as("sid", `insert into public.user_settings (settings) values ('{"theme":"dark","confetti":false}')`);
ok(!r.error, "a person can save their own settings");
r = await as("sid", `insert into public.user_settings (user_id, settings) values ($1, '{"theme":"light"}')`, [U.eddie]);
ok(!!r.error, "nobody can create settings for someone else");
await as("eddie", `insert into public.user_settings (settings) values ('{"theme":"light"}')`);
r = await as("sid", `select user_id::text u from public.user_settings`);
ok(r.rows.length === 1 && r.rows[0].u === U.sid, "people only see their own settings");
r = await as("sid", `update public.user_settings set settings = '{"theme":"dark"}' where user_id=$1`, [U.eddie]);
ok(!r.error && r.count === 0, "nobody can change someone else's settings");
r = await as("stranger", `insert into public.user_settings (settings) values ('{"theme":"dark"}')`);
ok(!r.error, "people waiting for approval can still pick light/dark mode");
r = await as("anon", `select * from public.user_settings`);
ok(!!r.error, "signed-out visitors can't read settings");

section("long notes (update 8)");
r = await as("sid", `update public.ticks set note = repeat('x', 5000) where member_key='sid' and day=$1`, [today]);
ok(!r.error && r.count === 1, "a long note (5,000 characters) is accepted");
r = await as("sid", `update public.ticks set note = repeat('x', 10001) where member_key='sid' and day=$1`, [today]);
ok(!!r.error, "the safety cap still stops a giant paste (over 10,000)");

// ======================================================================== update 9: groups
await db.exec(readFileSync(dir + "update-9-groups.sql", "utf8"));
console.log("\nloaded: update-9-groups.sql");
for (const [k, id] of [["owner2", "e"], ["m2", "f"], ["admin2", "1"], ["m3", "2"]]) {
  U[k] = "00000000-0000-0000-0000-00000000000" + id;
  await db.query(`insert into auth.users (id, raw_user_meta_data) values ($1, $2)`, [U[k], meta(k)]);
}
const rpc = (who, fn, args) => as(who, `select public.${fn}(${args.map((_, i) => "$" + (i + 1)).join(", ")}) as v`, args);

section("moving the current group into groups (update 9)");
r = await one(`select owner_id::text o, status from public.groups where id='lockedin'`);
ok(r && r.o === U.batko && r.status === "active", "your group became 'LockedIn', owned by you");
ok((await one(`select count(*)::int n from public.ticks where group_id is distinct from 'lockedin'`)).n === 0, "all old ticks belong to LockedIn");
ok((await one(`select count(*)::int n from public.reflections where group_id='lockedin'`)).n === 2, "all old reflections belong to LockedIn");
r = await one(`select string_agg(status || ':' || coalesce(member_key, '-'), ',' order by member_key) s from public.memberships where group_id='lockedin'`);
ok(r.s === "approved:batko,approved:eddie,approved:sid,pending:-", "approved members and the waiting person kept their place");
r = await as("sid", `insert into public.ticks (day, member_key, journal) values ($1, 'sid', true) on conflict (day, member_key) do update set journal = true`, [today]);
ok(!r.error, "members still tick their own row after the update");
r = await as("sid", `update public.ticks set chart = true where member_key='eddie' and day=$1`, [today]);
ok(!r.error && r.count === 0, "members still cannot tick someone else's row");
r = await as("stranger", `select * from public.members`);
ok(!r.error && r.rows.length === 0, "people waiting still see no names");

section("asking for a group");
r = await as("owner2", `insert into public.group_requests (name, note) values ('Night Owls', 'Asia session crew')`);
ok(!r.error, "anyone signed in can ask for a group");
for (let i = 0; i < 2; i++) await as("owner2", `insert into public.group_requests (name) values ('Spam ${i}')`);
r = await as("owner2", `insert into public.group_requests (name) values ('Spam 3')`);
ok(!!r.error, "max 3 requests waiting at a time");
r = await as("owner2", `insert into public.group_requests (name, user_id) values ('Fake', $1)`, [U.m2]);
ok(!!r.error, "nobody can ask in someone else's name");
r = await as("sid", `select * from public.group_requests`);
ok(r.rows.length === 0, "people can't see other people's requests");
const reqId = (await one(`select id from public.group_requests where name='Night Owls'`)).id;
r = await rpc("owner2", "approve_group_request", [reqId]);
ok(!!r.error, "nobody can approve their own request");
r = await as("owner2", `update public.group_requests set status='approved' where id=$1`, [reqId]);
ok(!r.error && r.count === 0, "nobody can mark their own request approved");
r = await as("owner2", `insert into public.groups (id, name, join_code, owner_id, boxes) select 'mine', 'Mine', 'AAAA-BBBB', $1, boxes from public.groups limit 1`, [U.owner2]);
ok(!!r.error || r.count === 0, "nobody but you can create a group directly");
r = await rpc("batko", "approve_group_request", [reqId]);
const G2 = r.rows && r.rows[0].v;
ok(!r.error && G2 === "night-owls", "you approve a request and the group is created");
r = await one(`select owner_id::text o from public.groups where id=$1`, [G2]);
ok(r.o === U.owner2, "the person who asked owns the new group");
r = await one(`select status, role, member_key from public.memberships where group_id=$1 and user_id=$2`, [G2, U.owner2]);
ok(r.status === "approved" && r.role === "admin" && !!r.member_key, "the new owner is in their group with a name");
const owner2Key = r.member_key;
ok((await one(`select avatar_url from public.members where key=$1`, [owner2Key])).avatar_url === meta("owner2").avatar_url, "the owner's name shows their Discord picture");
r = await rpc("batko", "approve_group_request", [reqId]);
ok(!!r.error, "a request can't be approved twice");
r = await rpc("sid", "create_group", ["Sid's group"]);
ok(!!r.error, "members cannot create groups");

section("join codes");
const code2 = (await one(`select join_code from public.groups where id=$1`, [G2])).join_code;
ok(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code2), "groups get a join code like ABCD-1234");
r = await rpc("m2", "join_group", ["ZZZZ-ZZZZ"]);
ok(!!r.error, "a wrong code doesn't work");
r = await rpc("m2", "join_group", [code2.toLowerCase().replace("-", " ")]);
ok(!r.error && r.rows[0].v.status === "pending", "the right code (any case, with spaces) puts you on the waiting list");
r = await as("m2", `select name from public.groups`);
ok(r.rows.length === 1 && r.rows[0].name === "Night Owls", "while waiting you only see that group's name");
r = await as("m2", `select * from public.members`);
ok(r.rows.length === 0, "while waiting you see no names");
r = await as("m2", `update public.memberships set status='approved' where user_id=$1`, [U.m2]);
ok(!r.error && r.count === 0, "nobody approves themselves into a group");
r = await as("anon", `select public.join_group($1)`, [code2]);
ok(!!r.error, "signed-out visitors cannot use a code");

section("groups can't see or touch each other");
r = await rpc("owner2", "add_member", [G2, "Mike"]);
const m2Key = r.rows && r.rows[0].v;
ok(!r.error && !!m2Key, "group owner adds a name to their group");
r = await as("owner2", `update public.memberships set status='approved', member_key=$2 where group_id=$3 and user_id=$1`, [U.m2, m2Key, G2]);
ok(!r.error && r.count === 1, "group owner approves someone into their group");
ok((await one(`select avatar_url from public.members where key=$1`, [m2Key])).avatar_url === meta("m2").avatar_url, "approved person's Discord picture shows");
const today2 = (await one(`select public.current_trading_day($1)::text d`, [G2])).d;
r = await as("m2", `insert into public.ticks (day, member_key, chart, group_id) values ($1, $2, true, 'lockedin')`, [today2, m2Key]);
ok(!r.error, "member of the new group ticks their own row");
ok((await one(`select group_id from public.ticks where member_key=$1`, [m2Key])).group_id === G2, "a tick can't be filed under another group");
r = await as("m2", `select distinct group_id from public.ticks`);
ok(r.rows.length === 1 && r.rows[0].group_id === G2, "a member only sees their own group's ticks");
r = await as("m2", `select * from public.members where group_id='lockedin'`);
ok(r.rows.length === 0, "a member can't see another group's names");
r = await as("sid", `select * from public.ticks where group_id=$1`, [G2]);
ok(r.rows.length === 0, "LockedIn members can't see the new group's ticks");
r = await as("sid", `select * from public.groups where id=$1`, [G2]);
ok(r.rows.length === 0, "LockedIn members can't see the new group at all");
r = await as("owner2", `select * from public.ticks where group_id='lockedin'`);
ok(r.rows.length === 0, "another group's owner can't see LockedIn's ticks");
r = await as("owner2", `select * from public.reflections`);
ok(r.rows.length === 0, "another group's owner can't see LockedIn's reflections");
r = await as("owner2", `select user_id from public.profiles`);
ok(r.rows.length === 2, "a group owner sees only the Discord profiles of people in their group");
r = await as("owner2", `update public.ticks set chart=false where group_id='lockedin'`);
ok(!r.error && r.count === 0, "another group's owner can't change LockedIn's ticks");
r = await as("owner2", `insert into public.ticks (day, member_key, chart) values ($1, 'sid', true)`, [yesterday]);
ok(!!r.error, "another group's owner can't add ticks to LockedIn");
r = await as("owner2", `update public.memberships set status='rejected' where group_id='lockedin'`);
ok(!r.error && r.count === 0, "another group's owner can't approve or kick people in LockedIn");
r = await rpc("owner2", "add_member", ["lockedin", "Spy"]);
ok(!!r.error, "another group's owner can't add names to LockedIn");
r = await as("owner2", `insert into public.members (key, name, group_id) values ('spy', 'Spy', 'lockedin')`);
ok(!!r.error, "...not even directly");
r = await as("owner2", `update public.members set group_id='lockedin' where key=$1`, [m2Key]);
ok((await one(`select group_id from public.members where key=$1`, [m2Key])).group_id === G2, "a name can't be moved into another group");
r = await as("owner2", `update public.memberships set member_key='sid' where group_id=$1 and user_id=$2`, [G2, U.m2]);
ok(!!r.error, "you can't give someone a name from another group");
r = await as("m2", `insert into public.ticks (day, member_key, chart) values ($1, 'sid', true)`, [today]);
ok(!!r.error, "a member can't tick in another group");
r = await as("owner2", `update public.groups set name='Hacked' where id='lockedin'`);
ok(!r.error && r.count === 0, "another group's owner can't change LockedIn's settings");
r = await as("owner2", `delete from public.groups where id='lockedin'`);
ok(!r.error && r.count === 0, "nobody but you can delete a group");

section("group settings");
r = await as("owner2", `update public.groups set name='Night Owls FX', color='violet', timezone='Europe/London', cutoff_hour=8,
  points='{"complete":3,"partial":1,"bonus":2}', boxes = jsonb_set(boxes, '{review}', '{"label":"Backtest","kind":"req"}') where id=$1`, [G2]);
ok(!r.error && r.count === 1, "group owner changes name, color, time zone, cutoff, points and boxes");
ok(!!(await one(`select public.current_trading_day($1) d`, [G2])).d, "the open day follows the group's own time zone");
r = await as("owner2", `update public.groups set owner_id=$2, status='paused' where id=$1`, [G2, U.m2]);
r = await one(`select owner_id::text o, status from public.groups where id=$1`, [G2]);
ok(r.o === U.owner2 && r.status === "active", "a group owner can't hand the group away or pause it (only you can)");
r = await as("owner2", `update public.groups set timezone='Mars/Base' where id=$1`, [G2]);
ok(!!r.error, "a time zone that doesn't exist is refused");
r = await as("owner2", `update public.groups set boxes = jsonb_set(boxes, '{chart,label}', '"<img src=x>"') where id=$1`, [G2]);
ok(!!r.error, "box names with web code are refused");
r = await as("owner2", `update public.groups set boxes = (select jsonb_object_agg(k, jsonb_build_object('label', 'x', 'kind', 'off')) from jsonb_object_keys(boxes) k) where id=$1`, [G2]);
ok(!!r.error, "at least one box must stay required");
r = await as("owner2", `update public.groups set points='{"complete":1000,"partial":1,"bonus":1}' where id=$1`, [G2]);
ok(!!r.error, "points stay between 0 and 10");
r = await as("owner2", `update public.groups set color='#ff00ff' where id=$1`, [G2]);
ok(!!r.error, "only the preset colors are allowed");
r = await as("m2", `update public.groups set name='Mine now' where id=$1`, [G2]);
ok(!r.error && r.count === 0, "members cannot change group settings");
r = await rpc("m2", "new_join_code", [G2]);
ok(!!r.error, "members cannot change the join code");
r = await rpc("owner2", "new_join_code", [G2]);
ok(!r.error && r.rows[0].v !== code2, "group owner makes a new join code");
r = await rpc("m3", "join_group", [code2]);
ok(!!r.error, "the old code stops working");
r = await rpc("m3", "join_group", [r.rows ? "" : (await one(`select join_code from public.groups where id=$1`, [G2])).join_code]);
ok(!r.error, "the new code works");

section("group admins");
await rpc("admin2", "join_group", [(await one(`select join_code from public.groups where id=$1`, [G2])).join_code]);
const a2Key = (await rpc("owner2", "add_member", [G2, "Anna"])).rows[0].v;
await as("owner2", `update public.memberships set status='approved', member_key=$3 where group_id=$1 and user_id=$2`, [G2, U.admin2, a2Key]);
r = await as("owner2", `update public.memberships set role='admin' where group_id=$1 and user_id=$2`, [G2, U.admin2]);
ok(!r.error && (await one(`select role from public.memberships where group_id=$1 and user_id=$2`, [G2, U.admin2])).role === "admin", "group owner makes someone a group admin");
const m3Key = (await rpc("admin2", "add_member", [G2, "Max"])).rows?.[0]?.v;
ok(!!m3Key, "group admin can add names");
r = await as("admin2", `update public.memberships set status='approved', member_key=$3, role='admin' where group_id=$1 and user_id=$2`, [G2, U.m3, m3Key]);
r = await one(`select status, role from public.memberships where group_id=$1 and user_id=$2`, [G2, U.m3]);
ok(r.status === "approved" && r.role === "member", "group admin can approve people, but can't make new admins");
r = await as("admin2", `update public.ticks set excused=true where member_key=$1`, [m2Key]);
ok((await one(`select excused from public.ticks where member_key=$1`, [m2Key])).excused === true, "group admin can excuse days in their group");
r = await as("m2", `update public.ticks set excused=false, journal=true where member_key=$1`, [m2Key]);
ok((await one(`select excused from public.ticks where member_key=$1`, [m2Key])).excused === true, "members still can't un-excuse themselves");
r = await as("admin2", `update public.groups set name='Admin was here' where id=$1`, [G2]);
ok(!r.error && r.count === 0, "group admins can't change group settings");
r = await as("admin2", `update public.memberships set status='rejected' where group_id=$1 and user_id=$2`, [G2, U.owner2]);
ok((await one(`select status from public.memberships where group_id=$1 and user_id=$2`, [G2, U.owner2])).status === "approved", "group admins can't kick out the group owner");
r = await as("admin2", `delete from public.memberships where group_id=$1 and user_id=$2`, [G2, U.owner2]);
ok(!!r.error, "...or remove them");
r = await as("admin2", `update public.ticks set chart=true where group_id='lockedin'`);
ok(!r.error && r.count === 0, "group admins have no power in other groups");
r = await as("m2", `select user_id from public.memberships`);
ok(r.rows.length === 1, "members only see their own membership");

section("pictures and logos");
// The group's time zone changed above, so its open day can differ from earlier (e.g. Monday morning: already Monday in London, still Friday in New York).
const today2now = (await one(`select public.current_trading_day($1)::text d`, [G2])).d;
ok(!(await put("m2", `${today2now}/${m2Key}/1.jpg`)).error, "member uploads to their own row in their group");
ok(!!(await put("m2", `${today}/sid/9.jpg`)).error, "member can't upload into another group's row");
r = await as("sid", `select name from storage.objects where name like $1`, [`%/${m2Key}/%`]);
ok(r.rows.length === 0, "other groups can't see your pictures");
r = await as("m2", `select name from storage.objects where name like '%/sid/%'`);
ok(r.rows.length === 0, "you can't see other groups' pictures");
r = await as("owner2", `select name from storage.objects where name like $1`, [`%/${m2Key}/%`]);
ok(r.rows.length === 1, "your group sees your pictures");
const logo = (who, path) => as(who, `insert into storage.objects (bucket_id, name) values ('logos', $1)`, [path]);
ok(!(await logo("owner2", `${G2}/123.jpg`)).error, "group owner uploads a logo");
ok(!!(await logo("m2", `${G2}/124.jpg`)).error, "members can't upload a logo");
ok(!!(await logo("owner2", `lockedin/125.jpg`)).error, "you can't upload another group's logo");

section("your owner powers");
r = await as("batko", `select count(*)::int n from public.groups`);
ok(r.rows[0].n === 2, "you see every group");
r = await as("batko", `select count(*)::int n from public.ticks where group_id=$1`, [G2]);
ok(r.rows[0].n === 1, "you can see inside every group");
r = await as("batko", `update public.groups set status='paused' where id=$1`, [G2]);
ok(!r.error && r.count === 1, "you can pause a group");
r = await as("m2", `update public.ticks set journal=false where member_key=$1`, [m2Key]);
ok(!r.error && r.count === 0, "nobody can tick in a paused group");
r = await as("owner2", `update public.groups set name='x' where id=$1`, [G2]);
ok(!r.error && r.count === 0, "a paused group's owner can't change settings");
r = await as("m2", `select count(*)::int n from public.ticks`);
ok(r.rows[0].n === 1, "a paused group can still look at its history");
await as("batko", `update public.groups set status='active' where id=$1`, [G2]);
r = await as("batko", `update public.groups set owner_id=$2 where id=$1`, [G2, U.admin2]);
ok(!r.error && (await one(`select owner_id::text o from public.groups where id=$1`, [G2])).o === U.admin2, "you can hand a group to a new owner");
r = await rpc("batko", "create_group", ["Batko Lab"]);
ok(!r.error, "you can create a group yourself");
r = await as("batko", `delete from public.groups where id=$1`, [G2]);
ok(!r.error && r.count === 1, "you can delete a group");
ok((await one(`select count(*)::int n from public.ticks where member_key=$1`, [m2Key])).n === 0, "deleting a group removes its data");
ok((await one(`select count(*)::int n from public.ticks where group_id='lockedin'`)).n >= 3, "other groups are untouched");

// ================================================================ update 10: reminders
await db.exec(`create role service_role nologin; grant usage on schema public to service_role;`);
const u10 = readFileSync(dir + "update-10-reminders.sql", "utf8");
await db.exec(u10.slice(0, u10.indexOf("-- ================================================================ SCHEDULE")));
console.log("\nloaded: update-10-reminders.sql (without the schedule)");
const sub = (who, ep, mins = 60) => rpc(who, "save_push_subscription", [`https://push.example.com/${ep}`, "B".repeat(87), "A".repeat(22), mins]);
const due = at => as("service", `select * from public.due_reminders($1::timestamptz)`, [at]);
const at = async mins => (await one(`select (public.day_closes_at('lockedin', public.current_trading_day('lockedin')) - make_interval(mins => $1))::text t`, [mins])).t;
const d10 = (await one(`select public.current_trading_day('lockedin')::text d`)).d;

section("reminders: saving a device");
ok(!(await sub("sid", "sid-phone")).error, "a member turns reminders on for their phone");
ok((await one(`select user_id::text u from public.push_subscriptions where endpoint like '%sid-phone'`)).u === U.sid, "the device is saved under their own account");
ok(!!(await as("anon", `select public.save_push_subscription('https://push.example.com/x', '${"B".repeat(87)}', '${"A".repeat(22)}', 60)`)).error, "signed-out visitors can't save a device");
ok(!!(await sub("sid", "sid-odd", 45)).error, "only 30 min, 1, 2 or 3 hours are allowed");
ok(!!(await rpc("sid", "save_push_subscription", ["http://insecure.example.com/x", "B".repeat(87), "A".repeat(22), 60])).error, "push addresses must be https");
r = await as("eddie", `select * from public.push_subscriptions`);
ok(!r.error && r.rows.length === 0, "you can't see other people's devices");
r = await as("eddie", `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push.example.com/fake', '${"B".repeat(87)}', '${"A".repeat(22)}')`, [U.sid]);
ok(!!r.error, "nobody can add a device to someone else's account");
r = await as("eddie", `delete from public.push_subscriptions where endpoint like '%sid-phone'`);
ok(!r.error && r.count === 0, "nobody can turn off someone else's reminders");
ok(!!(await as("sid", `select * from public.due_reminders()`)).error, "members can't ask who gets reminders");
ok(!!(await as("sid", `select * from public.push_log`)).error, "members can't read the reminder log");

section("reminders: who gets one");
await db.query(`update public.ticks set chart=false, journal=true, review=false, excused=false where member_key='sid' and day=$1`, [d10]);
const labels = (await one(`select array[boxes->'chart'->>'label', boxes->'review'->>'label'] l from public.groups where id='lockedin'`)).l;
r = await due(await at(120));
ok(!r.error && r.rows.length === 0, "no reminder 2 hours before when you chose 1 hour");
r = await due(await at(30));
ok(!r.error && r.rows.length === 1 && r.rows[0].endpoint.endsWith("sid-phone"), "a reminder goes out in the last hour if you're not done");
ok(r.rows[0] && JSON.stringify(r.rows[0].missing) === JSON.stringify(labels) && r.rows[0].minutes_left === 30, "it says which boxes are missing and how long is left");
r = await due(await at(25));
ok(!r.error && r.rows.length === 0, "never two reminders for the same day");
await sub("eddie", "eddie-phone", 180);
await db.query(`insert into public.ticks (day, member_key, chart, journal, review) values ($1, 'eddie', true, true, true) on conflict (day, member_key) do update set chart=true, journal=true, review=true`, [d10]);
r = await due(await at(100));
ok(!r.error && r.rows.length === 0, "nobody is reminded when their homework is done");
await as("batko", `update public.ticks set review=false, excused=true where member_key='eddie' and day=$1`, [d10]);
r = await due(await at(90));
ok(!r.error && r.rows.length === 0, "nobody is reminded on an excused day");
await as("batko", `update public.ticks set excused=false where member_key='eddie' and day=$1`, [d10]);
await sub("stranger", "stranger-phone", 180);
r = await due(await at(80));
ok(!r.error && r.rows.length === 1 && r.rows[0].endpoint.endsWith("eddie-phone"), "only approved members get reminders (not people waiting)");
r = await due(await at(-5));
ok(!r.error && r.rows.length === 0, "nothing is sent after the day closed");
await sub("m3", "m3-phone", 180);
await as("batko", `update public.groups set status='paused' where id='lockedin'`);
await db.query(`delete from public.push_log`);
r = await due(await at(10));
ok(!r.error && r.rows.length === 0, "a paused group gets no reminders");
await as("batko", `update public.groups set status='active' where id='lockedin'`);
ok(!(await sub("eddie", "sid-phone")).error, "a phone someone else used can be taken over by the new person");
r = await as("sid", `select * from public.push_subscriptions`);
ok(r.rows.length === 0, "the old owner of that phone no longer gets its reminders");
r = await as("eddie", `delete from public.push_subscriptions where endpoint like '%sid-phone'`);
ok(!r.error && r.count === 1, "you can turn off reminders on your own device");

// ================================================================ update 11: download and delete your data
await db.exec(`alter table auth.users add column if not exists email text; update auth.users set email = 'e' || substr(id::text, 36) || '@example.com';`);
await db.exec(readFileSync(dir + "update-11-your-data.sql", "utf8"));
console.log("\nloaded: update-11-your-data.sql");
section("your data: download");
r = await as("sid", `select public.export_my_data() d`);
ok(!r.error && r.rows[0].d.account.user_id === U.sid && r.rows[0].d.account.email, "you can download your account details");
ok(r.rows[0] && r.rows[0].d.ticks.length > 0 && r.rows[0].d.ticks.every(t => t.member_key === "sid" && !("updated_by" in t)), "the download has your ticks and only yours");
ok(r.rows[0] && r.rows[0].d.groups.some(g => g.group === "LockedIn"), "the download lists your groups");
ok(!!(await as("anon", `select public.export_my_data()`)).error, "signed-out visitors can't download anything");

section("your data: delete your account");
ok(!!(await as("batko", `select public.delete_my_account()`)).error, "the app owner can't delete their account by accident");
await db.query(`select public.make_group('Eddie Crew', $1)`, [U.eddie]);
r = await as("eddie", `select public.delete_my_account()`);
ok(!!r.error && /own a group/.test(r.error), "a group owner must hand over their group first");
await db.exec(`delete from public.groups where name = 'Eddie Crew'`);
await db.query(`insert into public.ticks (day, member_key, journal) values ('2026-01-05', 'eddie', true) on conflict do nothing`);
await db.query(`insert into storage.objects (bucket_id, name) values ('screenshots', '2026-01-05/eddie/1.jpg'), ('screenshots', '2026-01-06/eddie/2.jpg')`);
r = await as("sid", `delete from storage.objects where name = '2026-01-05/eddie/1.jpg'`);
ok(!r.error && r.count === 0, "nobody can delete someone else's old pictures");
r = await as("eddie", `delete from storage.objects where name = '2026-01-05/eddie/1.jpg'`);
ok(!r.error && r.count === 1, "you can delete your own old pictures (needed to delete your account)");
await sub("eddie", "eddie-laptop", 60);
const sidBefore = (await one(`select count(*)::int n from public.ticks where member_key = 'sid'`)).n;
r = await as("eddie", `select public.delete_my_account()`);
ok(!r.error, "a member can delete their account");
ok((await one(`select count(*)::int n from auth.users where id = $1`, [U.eddie])).n === 0, "the sign-in account is gone");
ok((await one(`select count(*)::int n from public.ticks where member_key = 'eddie'`)).n === 0, "their ticks and notes are gone");
ok((await one(`select count(*)::int n from public.members where key = 'eddie'`)).n === 0, "their name is gone from the group");
ok((await one(`select count(*)::int n from public.memberships where user_id = $1`, [U.eddie])).n === 0, "their group memberships are gone");
ok((await one(`select count(*)::int n from public.push_subscriptions where user_id = $1`, [U.eddie])).n === 0, "their reminder devices are gone");
ok((await one(`select count(*)::int n from public.profiles where user_id = $1`, [U.eddie])).n === 0, "their profile is gone");
ok((await one(`select count(*)::int n from public.ticks where member_key = 'sid'`)).n === sidBefore, "everyone else's ticks are untouched");
ok(!!(await as("anon", `select public.delete_my_account()`)).error, "signed-out visitors can't delete anything");

// ================================================================ update 12: helper functions locked
await db.exec(readFileSync(dir + "update-12-lockdown.sql", "utf8"));
console.log("\nloaded: update-12-lockdown.sql");
section("helpers locked for signed-out visitors");
for (const call of [`public.member_group('sid')`, `public.group_open('lockedin')`, `public.is_admin()`, `public.in_group('lockedin')`, `public.current_trading_day('lockedin')`])
  ok(!!(await as("anon", `select ${call}`)).error, `signed-out visitors can't call ${call.replace(/\(.*/, "")}`);
r = await as("sid", `insert into public.ticks (day, member_key, chart) values ($1, 'sid', true) on conflict (day, member_key) do update set chart = true`, [d10]);
ok(!r.error, "members can still tick after the lockdown");
r = await as("sid", `select count(*)::int n from public.ticks where group_id = 'lockedin'`);
ok(!r.error && r.rows[0].n > 0, "members can still see their group's ticks");
r = await as("stranger", `select count(*)::int n from public.ticks`);
ok(!r.error && r.rows[0].n === 0, "people outside the group still see nothing");
const exposed = await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')`);
ok(exposed.rows.length === 0, "no database function with special rights can be called by signed-out visitors" + (exposed.rows.length ? ": " + exposed.rows.map(x => x.proname).join(", ") : ""));
ok((await db.query(`select tablename from pg_tables where schemaname = 'public' and not rowsecurity`)).rows.length === 0, "every table has access rules switched on");

// ================================================================ update 13: accepting the Terms
await db.exec(readFileSync(dir + "update-13-accept-terms.sql", "utf8"));
console.log("\nloaded: update-13-accept-terms.sql");
section("accepting the Terms");
ok((await one(`select count(*)::int n from public.profiles where terms_accepted_at is not null`)).n === 0, "nobody has accepted yet after the update (everyone is asked)");
r = await rpc("sid", "accept_terms", ["2026-11-07"]);
ok(!r.error, "a member accepts the Terms");
r = await one(`select terms_version v, terms_accepted_at is not null a from public.profiles where user_id = $1`, [U.sid]);
ok(r.v === "2026-11-07" && r.a, "the time and version are saved as proof");
ok((await one(`select count(*)::int n from public.profiles where terms_accepted_at is not null`)).n === 1, "accepting only records your own acceptance");
ok(!!(await as("anon", `select public.accept_terms('2026-11-07')`)).error, "signed-out visitors can't record an acceptance");
ok(!!(await rpc("sid", "accept_terms", ["anything"])).error, "only real version dates are accepted");
r = await as("sid", `update public.profiles set terms_accepted_at = null where user_id = $1`, [U.sid]);
ok(!!r.error || r.count === 0, "nobody can change the acceptance record directly");
ok((await one(`select count(*)::int n from public.ticks where member_key = 'sid'`)).n > 0, "nobody's ticks were touched");

// ================================================================ update 14: 10 pictures and day results
await db.exec(readFileSync(dir + "update-14-photos-results.sql", "utf8"));
console.log("\nloaded: update-14-photos-results.sql");
section("10 pictures and day results (update 14)");
const t14 = (await one(`select public.current_trading_day()::text d`)).d;
await as("sid", `insert into public.ticks (day, member_key) values ($1, 'sid') on conflict do nothing`, [t14]);
r = await as("sid", `update public.ticks set images = '{a,b,c,d,e,f,g,h,i,j}', no_trade = false where member_key='sid' and day=$1`, [t14]);
ok(!r.error && r.count === 1, "member can save 10 pictures on their own day");
r = await as("sid", `update public.ticks set images = '{a,b,c,d,e,f,g,h,i,j,k}' where member_key='sid' and day=$1`, [t14]);
ok(!!r.error, "11 pictures are refused");
r = await as("sid", `update public.ticks set result = 'win' where member_key='sid' and day=$1`, [t14]);
ok(!r.error && r.count === 1, "member marks their own day as a win");
r = await as("sid", `update public.ticks set result = 'gamble' where member_key='sid' and day=$1`, [t14]);
ok(!r.error && r.count === 1, "member changes it to gamble");
r = await as("sid", `update public.ticks set result = 'jackpot' where member_key='sid' and day=$1`, [t14]);
ok(!!r.error, "unknown results are refused");
r = await as("sid", `update public.ticks set no_trade = true where member_key='sid' and day=$1`, [t14]);
ok(!!r.error, "a day can't be both no-trade and have a result");
r = await as("sid", `update public.ticks set result = 'loss' where member_key <> 'sid'`);
ok(!r.error && r.count === 0, "member cannot set someone else's result");
r = await as("sid", `update public.ticks set result = 'win' where member_key='sid' and day < $1`, [t14]);
ok(!r.error && r.count === 0, "member cannot set a result on a closed day");

// ================================================================ update 15: reports, Discord recaps, moving a group
await db.exec(readFileSync(dir + "update-15-reports-recaps-owner.sql", "utf8").split("-- ================================================================ SCHEDULE")[0]);
console.log("\nloaded: update-15-reports-recaps-owner.sql (without the schedule)");
Object.assign(U, { o3: "00000000-0000-0000-0000-0000000000a3", m3: "00000000-0000-0000-0000-0000000000b3", m4: "00000000-0000-0000-0000-0000000000c3" });
for (const k of ["o3", "m3", "m4"]) await db.query(`insert into auth.users (id, raw_user_meta_data) values ($1, $2)`, [U[k], meta(k)]);
const G3 = (await one(`select public.make_group('Recap Crew', $1) g`, [U.o3])).g;
const code3 = (await one(`select join_code from public.groups where id=$1`, [G3])).join_code;
const o3Key = (await one(`select member_key from public.memberships where group_id=$1 and user_id=$2`, [G3, U.o3])).member_key;
const k3 = (await rpc("o3", "add_member", [G3, "Mia"])).rows[0].v, k4 = (await rpc("o3", "add_member", [G3, "Leo_*star*"])).rows[0].v;
for (const [u, k] of [["m3", k3], ["m4", k4]]) {
  await rpc(u, "join_group", [code3]);
  await as("o3", `update public.memberships set status='approved', member_key=$2 where group_id=$3 and user_id=$1`, [U[u], k, G3]);
}
const d3 = (await one(`select public.current_trading_day($1)::text d`, [G3])).d;
await as("m4", `insert into public.ticks (day, member_key, images, note) values ($1, $2, '{p1.jpg,p2.jpg}', 'my note')`, [d3, k4]);

section("reporting pictures and notes (update 15)");
r = await rpc("m3", "report_content", [d3, k4, "picture", "p1.jpg", "inappropriate", "not ok"]);
ok(!r.error, "a member reports a picture in their group");
r = await rpc("m3", "report_content", [d3, k4, "picture", "p1.jpg", "inappropriate", "again"]);
ok(!r.error && (await one(`select count(*)::int n from public.reports`)).n === 1, "reporting the same thing twice makes one report");
r = await rpc("m3", "report_content", [d3, k4, "note", "", "spam", ""]);
ok(!r.error && (await one(`select excerpt from public.reports where kind='note'`)).excerpt === "my note", "a member reports a note and its text is kept as evidence");
ok(!!(await rpc("m3", "report_content", [d3, k4, "picture", "nope.jpg", "spam", ""])).error, "a picture that doesn't exist can't be reported");
ok(!!(await rpc("m4", "report_content", [d3, k4, "note", "", "spam", ""])).error, "you can't report your own post");
ok(!!(await rpc("sid", "report_content", [d3, k4, "note", "", "spam", ""])).error, "people outside the group can't report in it");
ok(!!(await rpc("m3", "report_content", [d3, k4, "note", "", "because", ""])).error, "only the listed reasons work");
ok(!!(await as("anon", `select public.report_content($1, $2, 'note', '', 'spam', '')`, [d3, k4])).error, "signed-out visitors can't report");
ok((await as("m3", `select * from public.reports`)).rows.length === 0, "members can't read reports, not even their own");
ok((await as("m4", `select * from public.reports`)).rows.length === 0, "the reported member can't see who reported them");
ok((await as("owner2", `select * from public.reports`)).rows.length === 0, "other groups' owners can't see the reports");
ok((await as("o3", `select * from public.reports`)).rows.length === 2, "the group owner sees their group's reports");
ok((await as("batko", `select * from public.reports`)).rows.length === 2, "the app owner sees every report");
r = await as("m3", `insert into public.reports (group_id, day, member_key, kind, reason) values ($1, $2, $3, 'note', 'spam')`, [G3, d3, k4]);
ok(!!r.error, "reports can only be sent through the report button");
r = await as("o3", `update public.reports set status='handled', reason='other', member_key=$1 where kind='picture'`, [o3Key]);
r = await one(`select status, reason, member_key, handled_at is not null h from public.reports where kind='picture'`);
ok(r.status === "handled" && r.reason === "inappropriate" && r.member_key === k4 && r.h, "the owner marks a report handled, and nothing else about it changes");
ok((await as("m3", `update public.reports set status='handled'`)).count === 0, "members can't mark reports handled");

section("Discord recaps (update 15)");
const hook = "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_ABCDEFG-123";
ok(!!(await as("m3", `insert into public.group_discord (group_id, webhook_url) values ($1, $2)`, [G3, hook])).error, "members can't set the Discord link");
ok(!!(await as("o3", `insert into public.group_discord (group_id, webhook_url) values ($1, 'https://evil.example.com/api/webhooks/1/x')`, [G3])).error, "only real Discord webhook links are accepted");
ok(!(await as("o3", `insert into public.group_discord (group_id, webhook_url, last_daily) values ($1, $2, '2099-01-01')`, [G3, hook])).error, "the group owner saves a Discord webhook link");
ok((await one(`select last_daily from public.group_discord where group_id=$1`, [G3])).last_daily === null, "owners can't fake the 'already posted' date");
ok((await as("m3", `select * from public.group_discord`)).rows.length === 0, "members can't see the secret Discord link");
ok((await as("owner2", `select * from public.group_discord`)).rows.length === 0, "other groups can't see the Discord link");
ok(!!(await as("o3", `select * from public.due_recaps()`)).error, "only the server can post recaps");
await as("m3", `insert into public.ticks (day, member_key, chart, journal, review) values ($1, $2, true, true, true) on conflict (day, member_key) do update set chart=true, journal=true, review=true`, [d3, k3]);
const close3 = (await one(`select public.day_closes_at($1, $2::date) c`, [G3, d3])).c;
const at15 = new Date(close3.getTime() - 30 * 60000);
r = await db.query(`select * from public.due_recaps($1)`, [at15]);
const daily = r.rows.find(x => x.kind === "daily");
ok(!!daily && daily.url === hook, "30 minutes before the cutoff the daily recap is due");
ok(daily && /1\/3 done · 30 min left/.test(daily.content) && /Still to finish: .*Leo\\_\\\*star\\\*/.test(daily.content), "it says who is done and who still has to finish, with names shown as plain text");
ok((await db.query(`select * from public.due_recaps($1)`, [at15])).rows.length === 0, "the same recap is never posted twice");
r = await db.query(`select * from public.due_recaps($1)`, [new Date(close3.getTime() - 3 * 3600000)]);
ok(r.rows.filter(x => x.kind === "daily").length === 0, "nothing is posted hours before the cutoff");
const fri = (await one(`select max(x)::date::text f from generate_series(date '2026-10-01', date '2026-10-31', interval '1 day') x where extract(isodow from x) = 5 and not exists (select 1 from public.holidays h where h.day = x::date)`)).f;
await db.query(`update public.group_discord set last_weekly = null`);
const friClose = (await one(`select public.day_closes_at($1, $2::date) c`, [G3, fri])).c;
r = await db.query(`select * from public.due_recaps($1)`, [new Date(friClose.getTime() + 10 * 60000)]);
const weekly = r.rows.find(x => x.kind === "weekly");
ok(!!weekly && /week of/.test(weekly.content) && /^1\. /m.test(weekly.content), "after the week's last day closes, the weekly ranking is due");
ok((await db.query(`select * from public.due_recaps($1)`, [new Date(friClose.getTime() + 20 * 60000)])).rows.filter(x => x.kind === "weekly").length === 0, "the weekly ranking is posted once");

section("moving a group to a new owner (update 15)");
ok(!!(await rpc("m3", "transfer_group", [G3, U.m3])).error, "a member can't take over the group");
ok(!!(await rpc("owner2", "transfer_group", [G3, U.owner2])).error, "another group's owner can't take it");
ok(!!(await rpc("o3", "transfer_group", [G3, U.sid])).error, "the new owner must be in the group");
ok(!!(await rpc("o3", "transfer_group", [G3, U.o3])).error, "you can't hand it to yourself");
r = await as("o3", `update public.groups set owner_id=$1 where id=$2`, [U.m3, G3]);
ok((await one(`select owner_id::text o from public.groups where id=$1`, [G3])).o === U.o3, "the owner can't be changed by editing the group directly");
r = await rpc("o3", "transfer_group", [G3, U.m4]);
ok(!r.error, "the owner hands the group to a member");
r = await one(`select g.owner_id::text o, (select role from public.memberships where group_id=g.id and user_id=$2) nr, (select role from public.memberships where group_id=g.id and user_id=$3) orl,
  (select status from public.memberships where group_id=g.id and user_id=$3) os from public.groups g where g.id=$1`, [G3, U.m4, U.o3]);
ok(r.o === U.m4 && r.nr === "admin" && r.orl === "member" && r.os === "approved", "the new owner owns it; the old owner stays as a normal member");
ok((await one(`select count(*)::int n from public.group_discord where group_id=$1`, [G3])).n === 0, "the old owner's Discord link is removed");
ok((await as("m4", `select * from public.reports`)).rows.length === 2 && (await as("o3", `select * from public.reports`)).rows.length === 0, "reports go to the new owner, not the old one");
ok(!(await as("m4", `update public.groups set name='Recap Crew 2' where id=$1`, [G3])).error && (await one(`select name from public.groups where id=$1`, [G3])).name === "Recap Crew 2", "the new owner can change the settings");
ok((await as("o3", `update public.groups set name='Hacked' where id=$1`, [G3])).count === 0, "the old owner can't anymore");
ok(!!(await rpc("o3", "transfer_group", [G3, U.o3])).error, "the old owner can't take it back");
ok(!(await rpc("batko", "transfer_group", [G3, U.o3])).error && (await one(`select owner_id::text o from public.groups where id=$1`, [G3])).o === U.o3, "the app owner can move any group");

// ================================================================ update 16: old pictures, owner alerts, reactions
await db.exec(readFileSync(dir + "update-16-cleanup-alerts-reactions.sql", "utf8"));
console.log("\nloaded: update-16-cleanup-alerts-reactions.sql");
section("owner alerts (update 16)");
U.j5 = "00000000-0000-0000-0000-0000000000d3";
await db.query(`insert into auth.users (id, raw_user_meta_data) values ($1, $2)`, [U.j5, meta("j5")]);
await db.query(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push.example.com/o3', '${"B".repeat(87)}', '${"A".repeat(22)}')`, [U.o3]);
await db.query(`update public.owner_alerts set sent_at = now()`);   // start clean
await rpc("j5", "join_group", [(await one(`select join_code from public.groups where id=$1`, [G3])).join_code]);
ok((await one(`select count(*)::int n from public.owner_alerts where user_id=$1 and kind='join' and sent_at is null`, [U.o3])).n === 1, "asking to join alerts the group owner");
ok((await one(`select count(*)::int n from public.owner_alerts where user_id=$1 and sent_at is null`, [U.j5])).n === 0, "the person asking isn't alerted");
r = await db.query(`select * from public.due_owner_alerts()`);
ok(r.rows.length === 1 && /^Someone wants to join /.test(r.rows[0].title) && r.rows[0].endpoint === "https://push.example.com/o3", "the owner gets one notification on their device");
ok((await db.query(`select * from public.due_owner_alerts()`)).rows.length === 0, "the same alert is never sent twice");
await rpc("m3", "report_content", [d3, k4, "picture", "p2.jpg", "harassment", ""]);
ok((await one(`select count(*)::int n from public.owner_alerts where kind='report' and sent_at is null and user_id in ($1, $2)`, [U.o3, U.batko])).n === 2, "a report alerts the group owner and the app owner");
ok((await as("o3", `select * from public.owner_alerts`)).error !== undefined || (await as("o3", `select * from public.owner_alerts`)).rows.length === 0, "nobody can read alerts from the app");
ok(!!(await as("o3", `select * from public.due_owner_alerts()`)).error, "only the server sends alerts");
await as("o3", `update public.memberships set status='rejected' where user_id=$1 and group_id=$2`, [U.j5, G3]);
await db.query(`update public.owner_alerts set sent_at = now()`);
await as("o3", `update public.memberships set status='pending' where user_id=$1 and group_id=$2`, [U.j5, G3]);
ok((await one(`select count(*)::int n from public.owner_alerts where user_id=$1 and sent_at is null`, [U.o3])).n === 0, "owners aren't alerted about what they did themselves");

section("reactions (update 16)");
r = await as("m3", `insert into public.reactions (day, member_key, kind) values ($1, $2, 'fire')`, [d3, k4]);
ok(!r.error, "a member reacts to someone's post");
r = await one(`select reactor_key, group_id, user_id::text u from public.reactions where member_key=$1`, [k4]);
ok(r.reactor_key === k3 && r.group_id === G3 && r.u === U.m3, "the database fills in who reacted and the group");
r = await as("m3", `insert into public.reactions (day, member_key, kind, reactor_key, user_id) values ($1, $2, 'clean', $3, $4)`, [d3, k4, o3Key, U.o3]);
ok(!r.error && (await one(`select reactor_key, user_id::text u from public.reactions where kind='clean'`)).reactor_key === k3, "nobody can react in someone else's name");
ok(!!(await as("m3", `insert into public.reactions (day, member_key, kind) values ($1, $2, 'respect')`, [d3, k3])).error, "you can't react to your own post");
ok(!!(await as("m3", `insert into public.reactions (day, member_key, kind) values ($1, $2, 'respect')`, [d3, o3Key])).error, "you can't react to a day with no note or pictures");
ok(!!(await as("m3", `insert into public.reactions (day, member_key, kind) values ($1, $2, 'love')`, [d3, k4])).error, "only fire, clean and respect");
ok(!!(await as("sid", `insert into public.reactions (day, member_key, kind) values ($1, $2, 'fire')`, [d3, k4])).error, "people outside the group can't react");
ok(!!(await as("j5", `insert into public.reactions (day, member_key, kind) values ($1, $2, 'fire')`, [d3, k4])).error, "people waiting for approval can't react");
ok((await as("m4", `select * from public.reactions`)).rows.length === 2, "the group sees reactions");
ok((await as("sid", `select * from public.reactions`)).rows.length === 0, "other groups don't");
ok((await as("m4", `delete from public.reactions where kind='fire'`)).count === 0, "you can't remove someone else's reaction");
ok((await as("m3", `delete from public.reactions where kind='fire'`)).count === 1, "you can take your own reaction back");
r = await rpc("m3", "export_my_data", []);
ok(!r.error && r.rows[0].v.reactions_you_gave.length === 1 && r.rows[0].v.reports_you_sent.length >= 1, "your data download includes your reactions and reports");

section("pictures older than 60 days (update 16)");
await db.query(`insert into storage.objects (bucket_id, name) values ('screenshots', '2020-01-02/x/1.jpg'), ('screenshots', $1), ('logos', '2020-01-02/x/2.jpg')`, [`${d3}/x/2.jpg`]);
r = await db.query(`select p from public.old_pictures(100) as p`);
const oldOnes = r.rows.map(x => x.p);
ok(oldOnes.includes("2020-01-02/x/1.jpg") && !oldOnes.includes(`${d3}/x/2.jpg`) && !oldOnes.includes("2020-01-02/x/2.jpg"), "only screenshots older than 60 days are picked, never recent ones or logos");
await db.query(`insert into public.ticks (day, member_key, images) values ('2020-01-02', $1, '{2020-01-02/x/1.jpg,keep.jpg}')`, [k4]);
r = await db.query(`select public.forget_pictures($1) n`, [["2020-01-02/x/1.jpg"]]);
ok((await one(`select images from public.ticks where day='2020-01-02' and member_key=$1`, [k4])).images.join() === "keep.jpg", "deleted pictures are removed from the day, the rest stays");
ok(!!(await as("o3", `select * from public.old_pictures(10)`)).error && !!(await as("o3", `select public.forget_pictures('{a}')`)).error, "only the server can clean up pictures");

// ================================================================ update 17: one-tap approve
await db.exec(readFileSync(dir + "update-17-one-tap-approve.sql", "utf8"));
console.log("\nloaded: update-17-one-tap-approve.sql");
section("one-tap approve (update 17)");
Object.assign(U, { a6: "00000000-0000-0000-0000-0000000000a6", a7: "00000000-0000-0000-0000-0000000000a7", a8: "00000000-0000-0000-0000-0000000000a8" });
await db.query(`insert into auth.users (id, raw_user_meta_data) values ($1, $2), ($3, $4), ($5, $6)`,
  [U.a6, { full_name: "Mia" }, U.a7, { full_name: "Nova <script>" }, U.a8, { full_name: "Old Timer" }]);
const code17 = (await one(`select join_code from public.groups where id=$1`, [G3])).join_code;
for (const u of ["a6", "a7", "a8"]) await rpc(u, "join_group", [code17]);
ok(!!(await rpc("m3", "approve_member", [G3, U.a6, null])).error, "members can't approve people");
ok(!!(await rpc("owner2", "approve_member", [G3, U.a6, null])).error, "other groups' owners can't approve people here");
ok(!!(await rpc("a6", "approve_member", [G3, U.a6, null])).error, "nobody approves themselves");
r = await rpc("o3", "approve_member", [G3, U.a6, null]);
const k6 = r.rows && r.rows[0].v;
ok(!r.error && !!k6, "the owner approves someone with one tap");
r = await one(`select m.status, mb.name, mb.group_id from public.memberships m join public.members mb on mb.key = m.member_key where m.user_id=$1 and m.group_id=$2`, [U.a6, G3]);
ok(r.status === "approved" && r.name === "Mia 2" && r.group_id === G3, "their name comes from Discord, with a number when it's taken (there's already a Mia)");
r = await rpc("o3", "approve_member", [G3, U.a7, null]);
ok(!r.error && (await one(`select name from public.members where key=$1`, [r.rows[0].v])).name === "Nova script", "unsafe characters are removed from the name");
ok(!!(await rpc("o3", "approve_member", [G3, U.a6, null])).error, "someone already in can't be approved twice");
const oldKey = (await rpc("o3", "add_member", [G3, "Old history"])).rows[0].v;
ok(!!(await rpc("o3", "approve_member", [G3, U.a8, k3])).error, "you can't give someone a name another person already has");
ok(!!(await rpc("o3", "approve_member", [G3, U.a8, o3Key.replace(/.$/, "x")])).error, "you can't link a name that isn't in the group");
r = await rpc("o3", "approve_member", [G3, U.a8, oldKey]);
ok(!r.error && (await one(`select member_key from public.memberships where user_id=$1 and group_id=$2`, [U.a8, G3])).member_key === oldKey, "the owner can link someone to an existing name instead");
ok((await as("a6", `select count(*)::int n from public.members where group_id=$1`, [G3])).rows[0].n > 0, "the approved person can see the group right away");

// ================================================================ update 18: names follow Discord
await db.exec(readFileSync(dir + "update-18-discord-names.sql", "utf8"));
console.log("\nloaded: update-18-discord-names.sql");
section("names follow Discord (update 18)");
ok((await one(`select name from public.members where key=$1`, [k3])).name === "m3" && (await one(`select name from public.members where key=$1`, [k6])).name === "Mia", "everyone already in a group is switched to their Discord name, in the order they joined");
ok((await one(`select count(*)::int n from public.members where name like '~%'`)).n === 0, "no placeholder names are left behind");
await db.query(`update auth.users set raw_user_meta_data=$2 where id=$1`, [U.a6, { full_name: "Mia Trades" }]);
ok((await one(`select name from public.members where key=$1`, [k6])).name === "Mia Trades", "changing your Discord name changes your name in the group");
await db.query(`update auth.users set raw_user_meta_data=$2 where id=$1`, [U.a6, { full_name: "M3" }]);
ok((await one(`select name from public.members where key=$1`, [k6])).name === "M3 2", "if another member has that name, a number is added");
const k3name = (await one(`select name from public.members where key=$1`, [k3])).name;
await db.query(`update auth.users set raw_user_meta_data=$2 where id=$1`, [U.j5, { full_name: "Waiting Person" }]);
ok((await one(`select name from public.members where key=$1`, [k3])).name === k3name && (await one(`select count(*)::int n from public.members where name='Waiting Person'`)).n === 0, "people who aren't approved get no name, and nobody else's name changes");
r = await as("a6", `update public.profiles set discord_name='Admin' where user_id=$1`, [U.a6]);
ok((await one(`select name from public.members where key=$1`, [k6])).name === "M3 2", "you can't rename yourself by editing your profile");
ok(!!(await as("o3", `select public.free_member_name($1, 'x')`, [G3])).error, "the name helper is only for the database");
const before18 = (await db.query(`select key, name from public.members order by key`)).rows.map(x => x.key + "=" + x.name).join();
await db.exec(readFileSync(dir + "update-18-discord-names.sql", "utf8"));
ok((await db.query(`select key, name from public.members order by key`)).rows.map(x => x.key + "=" + x.name).join() === before18, "running update 18 again changes nothing");

// ================================================================ update 19: P&L and R
await db.exec(readFileSync(dir + "update-19-pnl-rr.sql", "utf8"));
console.log("\nloaded: update-19-pnl-rr.sql");
section("P&L and R (update 19)");
const d19 = (await one(`select public.current_trading_day($1)::text d`, [G3])).d;
await as("m3", `insert into public.ticks (day, member_key) values ($1, $2) on conflict do nothing`, [d19, k3]);
r = await as("m3", `update public.ticks set pnl = 420.5, rr = 2.1 where day=$1 and member_key=$2`, [d19, k3]);
ok(!r.error && r.count === 1, "a member saves their P&L and R");
r = await one(`select pnl::text p, rr::text r from public.ticks where day=$1 and member_key=$2`, [d19, k3]);
ok(r.p === "420.50" && r.r === "2.10", "they're stored exactly");
ok(!(await as("m3", `update public.ticks set pnl = -150, rr = -1 where day=$1 and member_key=$2`, [d19, k3])).error, "losses are negative numbers");
ok(!(await as("m3", `update public.ticks set pnl = null, rr = null where day=$1 and member_key=$2`, [d19, k3])).error, "both are optional");
ok(!!(await as("m3", `update public.ticks set rr = 500 where day=$1 and member_key=$2`, [d19, k3])).error, "an R outside -100 to 100 is refused");
ok(!!(await as("m3", `update public.ticks set pnl = 99999999 where day=$1 and member_key=$2`, [d19, k3])).error, "an impossible P&L is refused");
ok((await as("m3", `update public.ticks set pnl = 1 where member_key=$1`, [k6])).count === 0, "members can't set someone else's P&L");
ok((await as("sid", `select pnl from public.ticks where member_key=$1`, [k3])).rows.length === 0, "other groups can't see it");

// ================================================================ update 20: group request alerts
await db.exec(readFileSync(dir + "update-20-request-alerts.sql", "utf8"));
console.log("\nloaded: update-20-request-alerts.sql");
section("group request alerts (update 20)");
await db.query(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push.example.com/batko', '${"B".repeat(87)}', '${"A".repeat(22)}') on conflict do nothing`, [U.batko]);
await db.query(`update public.owner_alerts set sent_at = now() where sent_at is null`);
r = await as("a7", `insert into public.group_requests (name, note) values ('Morning Crew', 'NY session')`);
ok(!r.error, "someone asks to start a group");
ok((await one(`select count(*)::int n from public.owner_alerts where kind='request' and user_id=$1 and sent_at is null`, [U.batko])).n === 1, "the app owner gets an alert for it");
r = await db.query(`select * from public.due_owner_alerts()`);
const req = r.rows.find(x => x.endpoint === "https://push.example.com/batko");
ok(!!req && req.title === "New group request: Morning Crew" && /All groups/.test(req.body), "the notification names the group they asked for");
U.a9 = "00000000-0000-0000-0000-0000000000a9";
await db.query(`insert into auth.users (id, raw_user_meta_data) values ($1, $2)`, [U.a9, { full_name: "Newbie" }]);
await rpc("a9", "join_group", [code17]);
ok((await db.query(`select * from public.due_owner_alerts()`)).rows.some(x => /wants to join/.test(x.title)), "join alerts still work");
ok(!!(await as("a7", `insert into public.owner_alerts (user_id, kind) values ($1, 'request')`, [U.batko])).error, "nobody can create alerts from the app");

// ================================================================ update 21: comments
await db.exec(readFileSync(dir + "update-21-comments.sql", "utf8"));
console.log("\nloaded: update-21-comments.sql");
section("comments (update 21)");
r = await as("m3", `insert into public.comments (day, member_key, body) values ($1, $2, '  Clean entry  ') returning id`, [d3, k4]);
ok(!r.error && r.rows.length === 1, "a member comments on someone's post");
const c1 = r.rows[0] && r.rows[0].id;
r = await one(`select author_key, group_id, user_id::text u, body from public.comments where id=$1`, [c1]);
ok(r.author_key === k3 && r.group_id === G3 && r.u === U.m3 && r.body === "Clean entry", "the database fills in who wrote it and the group");
r = await as("m3", `insert into public.comments (day, member_key, body, author_key, user_id) values ($1, $2, 'fake', $3, $4) returning author_key, user_id::text u`, [d3, k4, o3Key, U.o3]);
ok(!r.error && r.rows[0].author_key === k3 && r.rows[0].u === U.m3, "nobody can comment in someone else's name");
ok(!(await as("m4", `insert into public.comments (day, member_key, body) values ($1, $2, 'thanks')`, [d3, k4])).error, "you can comment on your own post");
r = await as("m4", `insert into public.comments (day, member_key, body, reply_to) values ($1, $2, 'reply', $3) returning id, reply_to`, [d3, k4, c1]);
ok(!r.error && String(r.rows[0].reply_to) === String(c1), "you can reply to a comment");
const c2 = r.rows[0] && r.rows[0].id;
r = await as("m3", `insert into public.comments (day, member_key, body, reply_to) values ($1, $2, 'reply to reply', $3) returning reply_to`, [d3, k4, c2]);
ok(!r.error && String(r.rows[0].reply_to) === String(c1), "a reply to a reply answers the first comment (one level deep)");
await db.query(`update public.ticks set note='my own entry' where day=$1 and member_key=$2`, [d3, k3]);   // k3 now has a post to comment on
ok(!(await as("m4", `insert into public.comments (day, member_key, body) values ($1, $2, 'nice')`, [d3, k3])).error, "comments work on that other post");
r = await as("m3", `insert into public.comments (day, member_key, body, reply_to) values ($1, $2, 'x', $3)`, [d3, k3, c1]);
ok(!!r.error && /doesn't exist anymore/.test(r.error), "a reply must be on the same post");
ok(!!(await as("m3", `insert into public.comments (day, member_key, body) values ($1, $2, 'x')`, [d3, o3Key])).error, "you can't comment on a day with no note or pictures");
ok(!!(await as("m3", `insert into public.comments (day, member_key, body) values ($1, $2, '   ')`, [d3, k4])).error, "an empty comment is refused");
ok(!!(await as("m3", `insert into public.comments (day, member_key, body) values ($1, $2, $3)`, [d3, k4, "a".repeat(501)])).error, "a comment over 500 characters is refused");
ok(!!(await as("sid", `insert into public.comments (day, member_key, body) values ($1, $2, 'hi')`, [d3, k4])).error, "people outside the group can't comment");
ok(!!(await as("j5", `insert into public.comments (day, member_key, body) values ($1, $2, 'hi')`, [d3, k4])).error, "people waiting for approval can't comment");
ok(!!(await as("anon", `insert into public.comments (day, member_key, body) values ($1, $2, 'hi')`, [d3, k4])).error, "signed-out visitors can't comment");
ok((await as("m4", `select * from public.comments`)).rows.length === 6, "the group sees the comments");
ok((await as("sid", `select * from public.comments`)).rows.length === 0, "other groups don't");
ok(!!(await as("anon", `select * from public.comments`)).error || (await as("anon", `select * from public.comments`)).rows.length === 0, "signed-out visitors don't");
ok(!!(await as("m3", `update public.comments set body='edited' where id=$1`, [c1])).error, "comments can't be edited");
ok((await as("m4", `delete from public.comments where id=$1`, [c1])).count === 0, "you can't delete someone else's comment");
r = await rpc("m4", "report_content", [d3, k3, "comment", String(c1), "spam", ""]);
ok(!r.error, "a member reports someone else's comment");
r = await one(`select kind, image, excerpt, member_key from public.reports where kind='comment'`);
ok(r && r.image === String(c1) && r.excerpt === "Clean entry" && r.member_key === k3, "the report keeps the comment's text as evidence");
await rpc("m4", "report_content", [d3, k3, "comment", "00" + String(c1), "spam", ""]);
ok((await one(`select count(*)::int n from public.reports where kind='comment' and status='open'`)).n === 1, "the same comment can't be reported twice by writing its number differently");
ok(!!(await rpc("m3", "report_content", [d3, k3, "comment", String(c1), "spam", ""])).error, "you can't report your own comment");
ok(!!(await rpc("m4", "report_content", [d3, k3, "comment", "999999", "spam", ""])).error, "a comment that doesn't exist can't be reported");
ok(!!(await rpc("sid", "report_content", [d3, k3, "comment", String(c1), "spam", ""])).error, "other groups can't report it");
ok((await as("o3", `delete from public.comments where id=$1`, [c2])).count === 1, "the group owner can delete any comment in the group");
ok((await as("sid", `delete from public.comments`)).count === 0, "other groups can't delete comments");
r = await rpc("m3", "export_my_data", []);
ok(!r.error && r.rows[0].v.comments_you_wrote.length >= 1, "your data download includes your comments");
ok((await as("m3", `delete from public.comments where id=$1`, [c1])).count === 1, "you can delete your own comment");
ok((await one(`select count(*)::int n from public.comments where reply_to=$1`, [c1])).n === 0, "deleting a comment also deletes its replies");


// ================================================================ update 22: notifications removed
// A device and a waiting owner alert exist before the update, so we can see both disappear.
await db.query(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push.example.com/before-22', $2, $3)`, [U.m3, "B".repeat(87), "A".repeat(22)]);
await db.query(`insert into public.owner_alerts (user_id, group_id, kind) select $1, id, 'join' from public.groups limit 1`, [U.batko]);
const u22 = readFileSync(dir + "update-22-remove-notifications.sql", "utf8");
await db.exec(u22.slice(0, u22.indexOf("-- ================================================================ SCHEDULE")));
console.log("\nloaded: update-22-remove-notifications.sql (without the schedule check)");
section("notifications removed");
ok((await one(`select count(*)::int n from public.push_subscriptions`)).n === 0, "every saved push address is deleted");
ok((await one(`select count(*)::int n from public.owner_alerts`)).n === 0, "waiting owner alerts are deleted");
ok(!!(await rpc("m3", "save_push_subscription", ["https://push.example.com/x", "B".repeat(87), "A".repeat(22), 60])).error, "nobody can save a push address any more");
r = await rpc("m4", "report_content", [d3, k3, "note", "", "spam", ""]);
ok(!r.error && (await one(`select count(*)::int n from public.owner_alerts`)).n === 0, "a new report is saved but no longer makes an owner alert");
r = await db.query(`select * from public.due_reminders()`);
ok(r.rows.length === 0, "the server job finds nobody to remind");
r = await db.query(`select * from public.due_owner_alerts()`);
ok(r.rows.length === 0, "the server job finds no owner alerts to send");
r = await rpc("m3", "export_my_data", []);
ok(!r.error, "Download my data still works");
r = await db.query(`select p from public.old_pictures(10) as p`);
ok(Array.isArray(r.rows), "the old-picture cleanup still works");

// ================================================================ update 23: mentor servers
const u23 = readFileSync(dir + "update-23-mentor-servers.sql", "utf8");
await db.exec(u23);
console.log("\nloaded: update-23-mentor-servers.sql");
section("mentor servers (update 23)");
// ro and r2 are two mentors. o9 owns a second group. own3 is whoever owns the Recap Crew group by now.
Object.assign(U, { ro: "00000000-0000-0000-0000-0000000000e1", r2: "00000000-0000-0000-0000-0000000000e2", o9: "00000000-0000-0000-0000-0000000000e3" });
for (const k of ["ro", "r2", "o9"]) await db.query(`insert into auth.users (id, raw_user_meta_data) values ($1, $2)`, [U[k], meta(k)]);
const G9 = (await one(`select public.make_group('Other Crew', $1) g`, [U.o9])).g;
const own3id = (await one(`select owner_id::text o from public.groups where id=$1`, [G3])).o;
const own3 = Object.keys(U).find(k => U[k] === own3id);
const mem3 = own3 === "m3" ? "m4" : "m3";   // a normal member of Recap Crew
const g3name = (await one(`select name from public.groups where id=$1`, [G3])).name, k3now = (await one(`select name from public.members where key=$1`, [k3])).name;
ok(!!own3 && own3 !== "batko", "test setup: Recap Crew has an owner who isn't the app owner");
await db.query(`insert into public.ticks (day, member_key, chart, journal, review, note) values ($1, $2, true, true, true, 'SECRETNOTE')
  on conflict (day, member_key) do update set chart=true, journal=true, review=true, excused=false, note='SECRETNOTE'`, [d3, k3]);

ok(!!(await rpc(own3, "create_server", ["Mine", U[own3]])).error, "a group owner can't create a server");
ok(!!(await rpc("ro", "create_server", ["Mine", U.ro])).error, "a mentor can't create a server for themselves");
ok(!!(await rpc("anon", "create_server", ["Mine", U.ro])).error, "signed-out visitors can't create a server");
ok(!!(await rpc("batko", "create_server", ["Ghost", "00000000-0000-0000-0000-0000000000ff"])).error, "a server needs an owner who has signed in");
ok(!!(await rpc("batko", "create_server", ["  ", U.ro])).error, "a server needs a name");
r = await rpc("batko", "create_server", ["Ronan's server", U.ro]);
ok(!r.error, "the app owner creates a server for a mentor");
const S1 = r.rows && r.rows[0].v;
const S2 = (await rpc("batko", "create_server", ["Second server", U.r2])).rows[0].v;
let srvCode1 = (await one(`select code from public.servers where id=$1`, [S1])).code;
const srvCode2 = (await one(`select code from public.servers where id=$1`, [S2])).code;

ok(!!(await as("ro", `select * from public.servers`)).error, "nobody reads the servers table directly, not even its owner");
ok(!!(await as("anon", `select * from public.servers`)).error, "signed-out visitors can't read servers");
ok(!!(await as(mem3, `select * from public.server_groups`)).error, "nobody reads the list of linked groups directly");
ok(!!(await as("ro", `insert into public.server_groups (group_id, server_id) values ($1, $2)`, [G3, S1])).error, "a mentor can't link a group by writing to the table");
ok(!!(await as("ro", `update public.servers set owner_id=$1`, [U.ro])).error, "nobody changes a server by writing to the table");

r = await rpc("ro", "my_servers", []);
ok(!r.error && r.rows[0].v.length === 1 && r.rows[0].v[0].code === srvCode1 && r.rows[0].v[0].mine === true, "a mentor sees their own server and its code");
ok((await rpc("r2", "my_servers", [])).rows[0].v.every(x => String(x.id) === String(S2)), "another mentor doesn't see it");
ok((await rpc(mem3, "my_servers", [])).rows[0].v.length === 0, "a member has no servers");
ok((await rpc("batko", "my_servers", [])).rows[0].v.length === 2, "the app owner sees every server");
ok(!!(await rpc("anon", "my_servers", [])).error, "signed-out visitors can't list servers");

ok(!!(await rpc(mem3, "link_server", [G3, srvCode1])).error, "a member can't link the group to a server");
ok(!!(await rpc("o9", "link_server", [G3, srvCode1])).error, "the owner of another group can't link this group");
ok(!!(await rpc("ro", "link_server", [G3, srvCode1])).error, "the mentor can't link a group they don't own");
ok(!!(await rpc("anon", "link_server", [G3, srvCode1])).error, "signed-out visitors can't link a group");
r = await rpc(own3, "link_server", [G3, "ZZZZ-ZZZ1"]);
ok(!!r.error && /doesn't work/.test(r.error), "a wrong server code is refused");
r = await rpc("ro", "server_overview", [S1]);
ok(!r.error && r.rows[0].v.groups.length === 0, "before a group is linked the mentor sees no group");
r = await rpc(own3, "link_server", [G3, srvCode1.replace("-", "").toLowerCase()]);
ok(!r.error && r.rows[0].v === "Ronan's server", "the group owner links the group with the server code");

r = await rpc(mem3, "group_server", [G3]);
ok(!r.error && r.rows[0].v && r.rows[0].v.name === "Ronan's server" && !("code" in r.rows[0].v), "members see which server their group is on, without the code");
ok((await rpc("o9", "group_server", [G3])).rows[0].v === null, "other groups can't see which server a group is on");
ok(!!(await rpc("anon", "group_server", [G3])).error, "signed-out visitors can't either");

r = await rpc("ro", "server_overview", [S1]);
const ov = r.rows && r.rows[0].v, og = ov && ov.groups[0];
ok(!r.error && ov.groups.length === 1 && og.id === G3 && og.name === g3name, "the mentor sees the linked group");
ok(!!og && og.days.length > 0 && og.days.length <= 90 && og.days[og.days.length - 1] === d3 && og.today === d3, "with its trading days up to the open day");
const mia = og && og.members.find(m => m.name === k3now);
ok(!!mia && mia.marks.length === og.days.length && mia.marks.slice(-1) === "c", "and a mark per member per day (the member who ticked everything is complete today)");
ok(og.members.every(m => Object.keys(m).sort().join() === "avatar_url,marks,name"), "members come with name, picture and marks only");
ok(!JSON.stringify(ov).includes("SECRETNOTE") && !/"(note|images|pnl|rr|went_well|body)"/.test(JSON.stringify(ov)), "notes, pictures, P&L and comments are never in the mentor's view");
ok(!ov.groups.some(x => x.id === G9), "a group that isn't linked isn't shown");

ok(!!(await rpc("r2", "server_overview", [S1])).error, "another mentor can't open this server");
ok((await rpc("r2", "server_overview", [S2])).rows[0].v.groups.length === 0, "and their own server doesn't show this group");
ok(!!(await rpc(mem3, "server_overview", [S1])).error, "a member can't open the server");
ok(!!(await rpc(own3, "server_overview", [S1])).error, "the group owner can't open the server either");
ok(!!(await rpc("anon", "server_overview", [S1])).error, "signed-out visitors can't open a server");
ok(!(await rpc("batko", "server_overview", [S1])).error, "the app owner can");
ok(!!(await as("ro", `select * from public.server_days($1)`, [G3])).error, "the helper that lists trading days can't be called from the website");

ok((await as("ro", `select * from public.ticks`)).rows.length === 0, "the mentor can't read the group's ticks or notes");
ok((await as("ro", `select * from public.members`)).rows.length === 0, "or its member list");
ok((await as("ro", `select * from public.comments`)).rows.length === 0, "or its comments");
ok((await as("ro", `select * from public.reflections`)).rows.length === 0, "or its reflections");
ok((await as("ro", `select * from public.groups`)).rows.length === 0, "or the group's settings and join code");
ok(!!(await as("ro", `insert into public.ticks (day, member_key, chart) values ($1, $2, true)`, [d3, k4])).error, "the mentor can't tick for anyone");
ok((await as("ro", `update public.ticks set chart=false`)).count === 0, "or change a tick");
ok((await as("ro", `update public.groups set name='Hacked'`)).count === 0, "or change a group");
ok((await as("ro", `update public.memberships set status='approved'`)).count === 0, "or approve anyone");

ok(!!(await rpc("r2", "new_server_code", [S1])).error, "another mentor can't change the server code");
ok(!!(await rpc(own3, "new_server_code", [S1])).error, "a group owner can't change the server code");
r = await rpc("ro", "new_server_code", [S1]);
ok(!r.error && r.rows[0].v !== srvCode1, "the server owner makes a new code");
ok(!!(await rpc("o9", "link_server", [G9, srvCode1])).error, "the old code stops working");
srvCode1 = r.rows[0].v;
ok((await rpc("ro", "server_overview", [S1])).rows[0].v.groups.length === 1, "groups that were already linked stay linked");

ok(!!(await rpc(mem3, "unlink_server", [G3])).error, "a member can't unlink the group");
ok(!!(await rpc("r2", "unlink_server", [G3])).error, "another mentor can't unlink it");
ok(!!(await rpc("o9", "unlink_server", [G3])).error, "another group's owner can't unlink it");
ok(!!(await rpc("anon", "unlink_server", [G3])).error, "signed-out visitors can't unlink it");
ok((await one(`select count(*)::int n from public.server_groups where group_id=$1`, [G3])).n === 1, "after all that the group is still linked");
ok(!(await rpc("ro", "unlink_server", [G3])).error && (await one(`select count(*)::int n from public.server_groups`)).n === 0, "the server owner can take a group off the server");
await rpc(own3, "link_server", [G3, srvCode1]);
ok(!(await rpc(own3, "unlink_server", [G3])).error && (await one(`select count(*)::int n from public.server_groups`)).n === 0, "the group owner can unlink the group");
ok((await rpc(mem3, "group_server", [G3])).rows[0].v === null, "members then see no server");
ok((await rpc("ro", "server_overview", [S1])).rows[0].v.groups.length === 0, "and the mentor no longer sees the group");

await rpc(own3, "link_server", [G3, srvCode1]);
await rpc(own3, "link_server", [G3, srvCode2]);
ok((await rpc("ro", "server_overview", [S1])).rows[0].v.groups.length === 0 && (await rpc("r2", "server_overview", [S2])).rows[0].v.groups.length === 1, "a group is on one server at a time");
await rpc(own3, "link_server", [G3, srvCode1]);
await rpc("o9", "link_server", [G9, srvCode1]);

await db.exec(u23);
ok((await one(`select count(*)::int n from public.servers`)).n === 2 && (await one(`select count(*)::int n from public.server_groups`)).n === 2, "running update 23 a second time keeps servers and links");
ok(!!(await as("ro", `select * from public.servers`)).error && !(await rpc("ro", "server_overview", [S1])).error, "and the rules still hold after the second run");

r = await rpc("ro", "export_my_data", []);
ok(!r.error && r.rows[0].v.servers_you_own.length === 1 && r.rows[0].v.servers_you_own[0].server === "Ronan's server", "your data download lists the server you own");
ok(!!(await rpc("ro", "delete_server", [S1])).error, "a mentor can't delete a server");
ok(!!(await rpc(own3, "delete_server", [S1])).error, "a group owner can't delete a server");
ok(!(await rpc("batko", "delete_server", [S2])).error && (await one(`select count(*)::int n from public.servers`)).n === 1, "the app owner deletes a server");
await db.query(`delete from public.groups where id=$1`, [G9]);
ok((await one(`select count(*)::int n from public.server_groups where group_id=$1`, [G9])).n === 0, "deleting a group takes it off the server");
ok(!(await rpc("ro", "delete_my_account", [])).error && (await one(`select count(*)::int n from public.servers`)).n === 0
  && (await one(`select count(*)::int n from public.server_groups`)).n === 0, "when a mentor deletes their account, the server and its links go too");
ok((await one(`select count(*)::int n from public.groups where id=$1`, [G3])).n === 1 && (await one(`select count(*)::int n from public.ticks where member_key=$1`, [k3])).n >= 1, "the groups that were on it keep all their data");

// ================================================================ update 24: monthly ranking and mentor summary
const u24 = readFileSync(dir + "update-24-monthly-and-mentor-recaps.sql", "utf8");
await db.exec(u24);
console.log("\nloaded: update-24-monthly-and-mentor-recaps.sql");
// Supabase's pg_net isn't in the test database. This stand-in keeps what would have been posted.
await db.exec(`create schema if not exists net; create table net.sent (url text, body jsonb);
  create function net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds int) returns bigint
  language sql as $$ insert into net.sent values (url, body); select 1::bigint $$;`);
// June 2025 is used because no other test has ticks there. Its last trading day is a Monday, so the month
// ends without a week ending; the Friday before it ends a week without ending the month.
const tdays = async (a, b) => (await db.query(`select x::date::text d from generate_series($1::date, $2::date, interval '1 day') x
  where extract(isodow from x) <= 5 and not exists (select 1 from public.holidays h where h.day = x::date) order by 1`, [a, b])).rows.map(x => x.d);
const june = await tdays("2025-06-01", "2025-06-30");
const jEnd = june[june.length - 1], jFri = "2025-06-27", jThu = "2025-06-26";
const closeAt = async (g, d) => (await one(`select public.day_closes_at($1, $2::date) c`, [g, d])).c;
const due24 = async at => (await db.query(`select * from public.due_recaps($1)`, [at])).rows;
const plus24 = (t, m) => new Date(t.getTime() + m * 60000);
ok(jEnd === "2025-06-30" && june.includes(jFri) && june.includes(jThu), "test setup: the June 2025 days are trading days");
await db.query(`insert into public.ticks (day, member_key, chart, journal, review, result) values ($1, $3, true, true, true, 'win'), ($2, $3, true, true, true, null)`, [jThu, jFri, k3]);

section("monthly ranking (update 24)");
const hook24 = "https://discord.com/api/webhooks/223456789012345678/abcdefghijklmnopqrstuvwxyz_ABCDEFG-124";
await db.query(`delete from public.group_discord`);
ok(!(await as(own3, `insert into public.group_discord (group_id, webhook_url, daily, weekly) values ($1, $2, false, false)`, [G3, hook24])).error, "the group owner connects Discord again");
ok((await one(`select monthly from public.group_discord where group_id=$1`, [G3])).monthly === false, "the monthly ranking is off until the owner switches it on");
const jClose3 = await closeAt(G3, jEnd);
ok((await due24(plus24(jClose3, 10))).length === 0, "nothing is posted at the end of the month while it is off");
ok((await as(mem3, `update public.group_discord set monthly = true`)).count === 0, "a member can't switch the monthly ranking on");
ok((await as("o9", `update public.group_discord set monthly = true`)).count === 0, "another group's owner can't either");
ok(!!(await as("anon", `update public.group_discord set monthly = true`)).error, "signed-out visitors can't either");
r = await as(own3, `update public.group_discord set monthly = true, last_monthly = '2025-06-01' where group_id = $1`, [G3]);
r = await one(`select monthly, last_monthly from public.group_discord where group_id=$1`, [G3]);
ok(r.monthly === true && r.last_monthly === null, "the owner switches it on, and can't fake the 'already posted' date");
ok((await due24(plus24(await closeAt(G3, jFri), 10))).filter(x => x.kind === "monthly").length === 0, "nothing monthly is posted in the middle of a month");
await db.query(`update public.members set name = 'Sky_*x*' where key = $1`, [k4]);
r = await due24(plus24(jClose3, 10));
const monthly24 = r.find(x => x.kind === "monthly");
ok(r.length === 1 && !!monthly24 && monthly24.url === hook24 && monthly24.group_id === G3, "after the month's last trading day closes, the monthly ranking is due");
ok(!!monthly24 && monthly24.content.includes("June 2025") && monthly24.content.includes(`1. ${k3now} · 2/${june.length} days · 1W 0L`), "it ranks members by days done in that month, with wins and losses");
ok(!!monthly24 && monthly24.content.includes("Sky\\_\\*x\\*"), "names are shown as plain text");
ok((await due24(plus24(jClose3, 20))).length === 0, "the monthly ranking is posted once");
await db.query(`update public.group_discord set last_monthly = null`);
ok((await due24(plus24(jClose3, 25 * 60))).length === 0, "and never more than a day late");
await db.query(`delete from public.group_discord`);

section("mentor summary (update 24)");
// mt and mt2 are two mentors. o10 owns a second group on mt's server.
Object.assign(U, { mt: "00000000-0000-0000-0000-0000000000f1", mt2: "00000000-0000-0000-0000-0000000000f2", o10: "00000000-0000-0000-0000-0000000000f3" });
for (const k of ["mt", "mt2", "o10"]) await db.query(`insert into auth.users (id, raw_user_meta_data) values ($1, $2)`, [U[k], meta(k)]);
const G10 = (await one(`select public.make_group('Summary Crew', $1) g`, [U.o10])).g;
const k10 = (await one(`select member_key k from public.memberships where group_id=$1 and user_id=$2`, [G10, U.o10])).k;
const T1 = (await rpc("batko", "create_server", ["Mentor <1>".replace(/[<>]/g, "") + " *hub*", U.mt])).rows[0].v;
const T2 = (await rpc("batko", "create_server", ["Other hub", U.mt2])).rows[0].v;
const code24 = async s => (await one(`select code from public.servers where id=$1`, [s])).code;
await rpc(own3, "link_server", [G3, await code24(T1)]);
await rpc("o10", "link_server", [G10, await code24(T1)]);
await db.query(`insert into public.ticks (day, member_key, chart, journal, review) values ($1, $2, true, true, true)`, [jFri, k10]);
const g3now = (await one(`select name from public.groups where id=$1`, [G3])).name;
const n3 = (await one(`select count(*)::int n from public.members where group_id=$1 and active`, [G3])).n;
const n10 = (await one(`select count(*)::int n from public.members where group_id=$1 and active`, [G10])).n;
const hookS = "https://discord.com/api/webhooks/323456789012345678/abcdefghijklmnopqrstuvwxyz_ABCDEFG-125";

for (const [who, label] of [[mem3, "a member"], [own3, "a group owner"], ["mt2", "another mentor"], ["anon", "a signed-out visitor"]]) {
  ok(!!(await rpc(who, "save_server_discord", [T1, hookS, true, true])).error, `${label} can't set the server's Discord link`);
}
ok(!!(await rpc("mt", "save_server_discord", [T1, "https://evil.example.com/api/webhooks/1/x", true, true])).error, "only real Discord webhook links are accepted");
ok(!!(await rpc("mt", "send_server_discord_test", [T1])).error, "a test needs a saved link first");
ok(!(await rpc("mt", "save_server_discord", [T1, hookS, true, false])).error, "the server owner saves a Discord webhook link");
r = await rpc("mt", "server_discord_get", [T1]);
ok(!r.error && r.rows[0].v.webhook_url === hookS && r.rows[0].v.weekly === true && r.rows[0].v.monthly === false, "and reads the settings back");
ok(!(await rpc("batko", "server_discord_get", [T1])).error, "the app owner can read them too");
for (const [who, label] of [[mem3, "a member"], [own3, "a group owner"], ["mt2", "another mentor"], ["anon", "a signed-out visitor"]]) {
  ok(!!(await rpc(who, "server_discord_get", [T1])).error, `${label} can't see the server's Discord link`);
  ok(!!(await as(who, `select * from public.server_discord`)).error, `${label} can't read the table directly`);
  ok(!!(await rpc(who, "send_server_discord_test", [T1])).error, `${label} can't send a test message`);
  ok(!!(await rpc(who, "remove_server_discord", [T1])).error, `${label} can't disconnect it`);
}
ok(!!(await as("mt", `select * from public.server_discord`)).error && !!(await as("mt", `update public.server_discord set last_weekly = null`)).error, "even the server owner can't touch the table directly");
ok((await rpc("mt2", "server_discord_get", [T2])).rows[0].v === null, "another mentor's own server has no link");
ok((await one(`select count(*)::int n from public.server_discord`)).n === 1, "after all that the link is still there");
ok(!(await rpc("mt", "send_server_discord_test", [T1])).error && (await one(`select count(*)::int n from net.sent where url=$1 and body->>'content' like 'LockedIn is connected%'`, [hookS])).n === 1, "the server owner sends a test message to the channel");
ok(!!(await rpc("mt", "send_server_discord_test", [T1])).error, "but only one a minute");
for (const fn of ["due_recaps()", "group_score('x', current_date, current_date)", "server_summary_lines(1, current_date, current_date)", "last_closed_day('x', now())"]) {
  ok(!!(await as("mt", `select * from public.${fn}`)).error, `the website can't call ${fn.split("(")[0]}`);
}

// The second group closes three hours after the first, so the summary has to wait for it.
await db.query(`update public.groups set timezone = (select timezone from public.groups where id=$2), cutoff_hour = (select cutoff_hour from public.groups where id=$2) where id=$1`, [G10, G3]);
await db.query(`update public.groups set cutoff_hour = cutoff_hour + case when cutoff_hour <= 20 then 3 else -3 end where id=$1`, [G10]);
const cA = await closeAt(G3, jFri), cB = await closeAt(G10, jFri);
const firstClose = cA < cB ? cA : cB, lastClose = cA < cB ? cB : cA;
ok(lastClose.getTime() - firstClose.getTime() === 3 * 3600000, "test setup: the two groups close three hours apart");
ok((await due24(plus24(firstClose, 10))).length === 0, "the summary waits until the week has closed for every group");
r = await due24(plus24(lastClose, 10));
const sw = r.find(x => x.kind === "server-weekly");
ok(r.length === 1 && !!sw && sw.url === hookS && sw.group_id === null, "after the last group's week closes, the weekly summary is due");
const pct3 = Math.round(100 * 2 / (2 * n3));
ok(!!sw && sw.content.includes("Mentor 1 \\*hub\\*") && sw.content.includes("week of 23 Jun"), "it is headed with the server's name, as plain text, and the week");
ok(!!sw && sw.content.includes(`1. Summary Crew · 100% · ${n10} ${n10 === 1 ? "member" : "members"}`) && sw.content.includes(`2. ${g3now} · ${pct3}% · ${n3} members`), "groups are ranked by how much of their homework got done");
const names3 = (await db.query(`select name from public.members where group_id in ($1, $2)`, [G3, G10])).rows.map(x => x.name);
ok(!!sw && names3.length >= 3 && !names3.some(nm => sw.content.includes(nm) || sw.content.includes(nm.replace(/([\\*_~`|])/g, "\\$1"))), "no member's name is in the summary");
ok(!!sw && !sw.content.includes("Other Crew") && !/SECRETNOTE|win|loss/i.test(sw.content), "and no notes, results or groups from elsewhere");
ok((await due24(plus24(lastClose, 20))).length === 0, "the weekly summary is posted once");
ok((await due24(plus24(await closeAt(G10, jEnd), 10))).length === 0, "the monthly summary is off until the server owner switches it on");

ok(!(await rpc("mt", "save_server_discord", [T1, hookS, true, true])).error && (await one(`select last_weekly is not null w from public.server_discord where server_id=$1`, [T1])).w, "saving again keeps the 'already posted' date");
await as("batko", `update public.groups set status='paused' where id=$1`, [G10]);
r = await due24(plus24(await closeAt(G3, jEnd), 10));
const sm = r.find(x => x.kind === "server-monthly");
ok(r.length === 1 && !!sm && sm.content.includes("June 2025") && sm.content.includes(`1. ${g3now} · ${pct3}%`), "after the month closes, the monthly summary is due");
ok(!!sm && !sm.content.includes("Summary Crew"), "a paused group is left out");
await as("batko", `update public.groups set status='active' where id=$1`, [G10]);
await db.query(`delete from public.ticks where member_key = any($1) and day between '2025-06-01' and '2025-06-30'`, [[k3, k10]]);
await db.query(`update public.server_discord set last_monthly = null`);
r = await due24(plus24(await closeAt(G10, jEnd), 10));
ok(r.length === 1 && r[0].kind === "server-monthly" && /Summary Crew · nothing logged/.test(r[0].content), "a group that logged nothing is listed as that, not as 0%");

// Two groups whose days close more than a day apart (one far ahead of the other on the clock), and a group
// name written to look like a link.
await db.query(`update public.groups set timezone = 'Pacific/Kiritimati', cutoff_hour = 0, name = $2 where id = $1`, [G10, "[Top](https://bad.example)"]);
await db.query(`insert into public.ticks (day, member_key, chart, journal, review) values ($1, $2, true, true, true)`, [jFri, k10]);
await db.query(`update public.server_discord set last_weekly = null`);
const fA = await closeAt(G3, jFri), fB = await closeAt(G10, jFri);
ok(fA.getTime() - fB.getTime() >= 24 * 3600000, "test setup: one group closes more than a day after the other");
ok((await due24(plus24(fB, 10))).filter(x => x.kind === "server-weekly").length === 0, "the summary still waits for the group that closes last");
r = (await due24(plus24(fA, 10))).filter(x => x.kind === "server-weekly");
ok(r.length === 1 && r[0].content.includes("week of 23 Jun"), "and is posted when that group's week closes, however far apart the groups are");
ok(r.length === 1 && r[0].content.includes("\\[Top\\]\\(https: //bad.example\\)") && !r[0].content.includes("](http"), "a group name can't become a clickable link in the mentor's Discord");
ok((await due24(plus24(fA, 20))).filter(x => x.kind === "server-weekly").length === 0, "and it is posted once");

await db.exec(u24);
r = await rpc("mt", "server_discord_get", [T1]);
ok(!r.error && r.rows[0].v.webhook_url === hookS && r.rows[0].v.monthly === true, "running update 24 a second time keeps the server's Discord settings");
ok(!!(await as("mt", `select * from public.server_discord`)).error && !!(await as("mt", `select * from public.due_recaps()`)).error, "and the rules still hold after the second run");
ok(!!(await rpc("mt2", "remove_server_discord", [T1])).error && !(await rpc("mt", "remove_server_discord", [T1])).error && (await one(`select count(*)::int n from public.server_discord`)).n === 0, "the server owner disconnects, and the link is deleted");
await rpc("mt", "save_server_discord", [T1, hookS, true, true]);
ok(!(await rpc("batko", "delete_server", [T1])).error && (await one(`select count(*)::int n from public.server_discord`)).n === 0, "deleting a server deletes its Discord link");

// ================================================================ update 25: break even result
const u25 = readFileSync(dir + "update-25-break-even-result.sql", "utf8");
r = await as("sid", `update public.ticks set no_trade = false, result = 'breakeven' where member_key='sid' and day=$1`, [t14]);
ok(!!r.error, "before update 25, break even is refused");
await db.exec(u25);
console.log("\nloaded: update-25-break-even-result.sql");
section("break even result (update 25)");
r = await as("sid", `update public.ticks set no_trade = false, result = 'breakeven' where member_key='sid' and day=$1`, [t14]);
ok(!r.error && r.count === 1, "member marks their own day as break even");
for (const v of ["win", "loss", "gamble"]) {
  r = await as("sid", `update public.ticks set result = $2 where member_key='sid' and day=$1`, [t14, v]);
  ok(!r.error && r.count === 1, `the old result "${v}" still works`);
}
r = await as("sid", `update public.ticks set result = 'jackpot' where member_key='sid' and day=$1`, [t14]);
ok(!!r.error, "unknown results are still refused");
r = await as("sid", `update public.ticks set result = 'breakeven' where member_key='sid' and day=$1`, [t14]);
r = await as("sid", `update public.ticks set no_trade = true where member_key='sid' and day=$1`, [t14]);
ok(!!r.error, "a day still can't be both no-trade and break even");
r = await as("sid", `update public.ticks set result = 'breakeven' where member_key <> 'sid'`);
ok(!!r.error || r.count === 0, "a member can't mark someone else's day as break even");
r = await as("uma", `update public.ticks set result = 'breakeven' where member_key='sid'`);
ok(!!r.error || r.count === 0, "someone outside the group can't either");
r = await as(null, `update public.ticks set result = 'breakeven'`);
ok(!!r.error || r.count === 0, "a signed-out visitor can't either");
await db.exec(u25);
ok((await one(`select result from public.ticks where member_key='sid' and day=$1`, [t14])).result === "breakeven", "running update 25 a second time keeps saved results");

// ================================================================ update 26: server tags
const u26 = readFileSync(dir + "update-26-server-tags.sql", "utf8");
// ta is a mentor, tb asks for groups, tc joins one. Two servers are made the old way first, without a tag.
Object.assign(U, { ta: "00000000-0000-0000-0000-000000002601", tb: "00000000-0000-0000-0000-000000002602", tc: "00000000-0000-0000-0000-000000002603" });
for (const k of ["ta", "tb", "tc"]) await db.query(`insert into auth.users (id, raw_user_meta_data) values ($1, $2)`, [U[k], meta(k)]);
const SB = (await rpc("batko", "create_server", ["BNQ", U.ta])).rows[0].v;
const SL = (await rpc("batko", "create_server", ["A long server name", U.ta])).rows[0].v;
const code3old = (await one(`select join_code from public.groups where id=$1`, [G3])).join_code;
const srvTag = async s => (await one(`select tag from public.servers where id=$1`, [s])).tag;
const joinCode = async g => (await one(`select join_code from public.groups where id=$1`, [g])).join_code;
const TAGGED = /^BNQ-[A-Z0-9]{4}-[A-Z0-9]{4}$/, PLAIN = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;
await db.exec(u26);
console.log("\nloaded: update-26-server-tags.sql");
section("server tags (update 26)");
ok((await srvTag(SB)) === "BNQ", "a server with a short name gets its name as its tag");
ok((await srvTag(SL)) === null, "a server with a long name has no tag until the app owner gives it one");
ok((await joinCode(G3)) === code3old, "groups that already exist keep their join code");
r = await rpc("ta", "my_servers", []);
ok(!r.error && r.rows[0].v.find(x => String(x.id) === String(SB)).tag === "BNQ", "a mentor sees the tag of their server");

ok(!!(await rpc("ta", "create_server", ["Mine", U.ta, "MINE"])).error, "a mentor can't create a server with a tag");
ok(!!(await rpc("anon", "create_server", ["Mine", U.ta, "MINE"])).error, "signed-out visitors can't either");
ok(!!(await rpc("batko", "create_server", ["Short", U.ta, "B"])).error, "a tag of one letter is refused");
ok(!!(await rpc("batko", "create_server", ["Long", U.ta, "TOOLONG"])).error, "a tag of more than 5 letters is refused");
ok(!!(await rpc("batko", "create_server", ["Odd", U.ta, "B-Q"])).error, "a tag with other signs is refused");
r = await rpc("batko", "create_server", ["Copy", U.ta, "bnq"]);
ok(!!r.error && /already has the tag/.test(r.error), "two servers can't share a tag");
r = await rpc("batko", "create_server", ["Third server", U.tc, " xy1 "]);
const SX = r.rows && r.rows[0].v;
ok(!r.error && (await srvTag(SX)) === "XY1", "the app owner creates a server with a tag");

ok(!!(await rpc("ta", "set_server_tag", [SL, "LONG"])).error, "a mentor can't change the tag of their own server");
ok(!!(await rpc("tb", "set_server_tag", [SL, "LONG"])).error, "a member can't change a tag");
ok(!!(await rpc("anon", "set_server_tag", [SL, "LONG"])).error, "signed-out visitors can't change a tag");
ok(!!(await rpc("batko", "set_server_tag", [SL, "BNQ"])).error, "the app owner can't give a tag that another server has");
ok(!(await rpc("batko", "set_server_tag", [SL, "long"])).error && (await srvTag(SL)) === "LONG", "the app owner gives a server its tag");
ok(!!(await as("ta", `update public.servers set tag='HACK'`)).error, "nobody changes a tag by writing to the table");

ok(!!(await rpc("anon", "request_group", ["Ghosts", "", "BNQ"])).error, "signed-out visitors can't ask for a group");
r = await rpc("tb", "request_group", ["Tag Crew", "note", "NOPE"]);
ok(!!r.error && /No server has that tag/.test(r.error), "a tag that doesn't exist is refused");
ok(!!(await rpc("tb", "request_group", ["  ", "", ""])).error, "a request needs a group name");
r = await rpc("tb", "request_group", ["Tag Crew", "note", " bnq "]);
ok(!r.error && r.rows[0].v === "BNQ", "someone asks for a group with a server tag and gets the server's name back");
const reqT = await one(`select id, server_id, user_id::text u, status from public.group_requests where name='Tag Crew'`);
ok(String(reqT.server_id) === String(SB) && reqT.u === U.tb && reqT.status === "pending", "the request remembers the server and waits for the app owner");
ok(!!(await as("tb", `insert into public.group_requests (name, server_id) values ('Sneaky', $1)`, [SL])).error, "a request written straight into the table can't name a server");
ok(!(await as("tb", `insert into public.group_requests (name) values ('Old Way')`)).error, "a request without a server still works the old way");
r = await rpc("tb", "request_group", ["No Tag", "", ""]);
ok(!r.error && r.rows[0].v === null && (await one(`select server_id from public.group_requests where name='No Tag'`)).server_id === null, "a request without a tag names no server");
r = await rpc("tb", "request_group", ["Fourth", "", "BNQ"]);
ok(!!r.error && /3 requests/.test(r.error), "3 waiting requests is still the most");
ok(!((await as("tb", `update public.group_requests set server_id=$1 where name='No Tag'`, [SB])).count > 0)
  && (await one(`select server_id from public.group_requests where name='No Tag'`)).server_id === null, "the person who asked can't add a server to a request afterwards");
ok((await as("ta", `select * from public.group_requests`)).rows.length === 0, "the mentor can't read requests that name their server");
ok(!!(await rpc("ta", "approve_group_request", [reqT.id])).error, "the mentor can't approve a group for their server");
ok(!!(await rpc("tb", "approve_group_request", [reqT.id])).error, "the person who asked can't approve it themselves");
ok((await rpc("ta", "server_overview", [SB])).rows[0].v.groups.length === 0, "before approval the mentor sees nothing of that group");

r = await rpc("batko", "approve_group_request", [reqT.id]);
const GT = r.rows && r.rows[0].v;
let codeT = GT && await joinCode(GT);
ok(!r.error && TAGGED.test(codeT), "after approval the group's join code starts with the server tag");
ok(String((await one(`select server_id from public.server_groups where group_id=$1`, [GT])).server_id) === String(SB), "and the group is on that server");
r = await rpc("ta", "server_overview", [SB]);
ok(!r.error && r.rows[0].v.tag === "BNQ" && r.rows[0].v.groups.length === 1 && r.rows[0].v.groups[0].id === GT, "the mentor now sees the group");
ok(!!(await rpc("tc", "server_overview", [SB])).error, "another mentor can't open that server");
ok((await rpc("tb", "group_server", [GT])).rows[0].v.name === "BNQ", "the new owner sees which server the group is on");
r = await rpc("batko", "approve_group_request", [(await one(`select id from public.group_requests where name='No Tag'`)).id]);
const GP = r.rows && r.rows[0].v;
ok(!r.error && PLAIN.test(await joinCode(GP)) && (await one(`select count(*)::int n from public.server_groups where group_id=$1`, [GP])).n === 0, "a group without a tag gets a plain code and is on no server");

r = await rpc("tc", "join_group", [codeT.replace(/-/g, "").toLowerCase()]);
ok(!r.error && r.rows[0].v.id === GT && r.rows[0].v.status === "pending", "someone joins with the tagged code, typed without dashes, and waits for the owner");
r = await rpc("tc", "join_group", [codeT]);
ok(!r.error && r.rows[0].v.id === GT, "the tagged code also works typed with its dashes");
ok(!!(await rpc("tc", "join_group", ["XY1-" + codeT.slice(4)])).error, "the same ending with another tag is refused");
ok(!!(await rpc("tc", "join_group", [codeT.slice(4)])).error, "the ending without the tag is refused");
ok(!!(await rpc("tc", "join_group", ["BNQ"])).error, "the tag alone is refused");
r = await rpc("tc", "join_group", [code3old.replace("-", "")]);
ok(!r.error && r.rows[0].v.id === G3, "a code without a tag still works");
ok(!!(await rpc("anon", "join_group", [codeT])).error, "signed-out visitors can't join with a tagged code");

ok(!!(await rpc("tc", "new_join_code", [GT])).error, "someone on the waiting list can't change the join code");
ok(!!(await rpc("ta", "new_join_code", [GT])).error, "the mentor can't change a group's join code");
r = await rpc("tb", "new_join_code", [GT]);
ok(!r.error && TAGGED.test(r.rows[0].v) && r.rows[0].v !== codeT, "a new join code for a group on the server keeps the tag");
ok(!!(await rpc("tc", "join_group", [codeT])).error, "and the old tagged code stops working");
codeT = r.rows[0].v;
r = await rpc("tb", "new_join_code", [GP]);
ok(!r.error && PLAIN.test(r.rows[0].v), "a new join code for a group on no server stays plain");
ok(!!(await as("tb", `update public.groups set join_code='bad code' where id=$1`, [GT])).error || (await joinCode(GT)) === codeT, "a join code in another shape is refused");

await rpc("tb", "request_group", ["Late Crew", "", "BNQ"]);
ok(!(await rpc("batko", "delete_server", [SB])).error && (await one(`select server_id from public.group_requests where name='Late Crew'`)).server_id === null, "deleting a server takes it off waiting requests");
r = await rpc("batko", "approve_group_request", [(await one(`select id from public.group_requests where name='Late Crew'`)).id]);
ok(!r.error && PLAIN.test(await joinCode(r.rows[0].v)), "a request whose server is gone becomes a plain group");
ok((await joinCode(GT)) === codeT && (await one(`select count(*)::int n from public.server_groups where group_id=$1`, [GT])).n === 0, "a group whose server is deleted keeps its code and is on no server");

await db.exec(u26);
ok((await srvTag(SL)) === "LONG" && (await srvTag(SX)) === "XY1" && (await joinCode(GT)) === codeT, "running update 26 a second time keeps tags and join codes");
ok(!!(await as("tb", `insert into public.group_requests (name, server_id) values ('Sneaky', $1)`, [SL])).error
  && !!(await rpc("ta", "set_server_tag", [SL, "ZZZ"])).error, "and the rules still hold after the second run");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
