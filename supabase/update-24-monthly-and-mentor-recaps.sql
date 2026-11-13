-- Update 24: a monthly ranking in a group's Discord, and a summary of all linked groups in a mentor's Discord.
-- Run ONCE in Supabase > SQL Editor > New query > paste > Run (after update 23). Then push the website.
-- Safe to run again.
--
-- Who can do what (enforced here in the database, not just in the website):
--   * Group owner ............ switches the monthly ranking on or off, next to the daily recap and the weekly ranking.
--                              It is off until the owner switches it on.
--   * Server owner (mentor) .. pastes a Discord webhook link for their server, picks weekly and/or monthly,
--                              sends a test message, and disconnects again.
--   * App owner (you) ........ can do the same for any server.
--   * Everyone else .......... can't see or change a server's Discord link. Not group owners, not members,
--                              not other mentors, not signed-out visitors.
-- The mentor summary lists group names, a percentage and a member count. Never a member's name.
-- The every-5-minutes job from update 15 is not changed: it already posts whatever due_recaps() hands it.

-- ================================================================ group: monthly ranking

alter table public.group_discord add column if not exists monthly boolean not null default false;
alter table public.group_discord add column if not exists last_monthly date;

-- Owners can't fake "already posted" dates. Same as update 15, now also for the monthly one.
create or replace function public.protect_group_discord() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'UPDATE' then
      new.group_id := old.group_id; new.last_daily := old.last_daily; new.last_weekly := old.last_weekly;
      new.last_monthly := old.last_monthly; new.last_test := old.last_test;
    else
      new.last_daily := null; new.last_weekly := null; new.last_monthly := null; new.last_test := null;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.protect_group_discord() from public, anon, authenticated;

-- ================================================================ mentor: Discord link for a server

create table if not exists public.server_discord (
  server_id    bigint primary key references public.servers (id) on delete cascade,
  webhook_url  text not null check (webhook_url ~ '^https://(ptb\.|canary\.)?(discord|discordapp)\.com/api/webhooks/[0-9]{5,25}/[A-Za-z0-9_-]{20,100}$'),
  weekly       boolean not null default true,
  monthly      boolean not null default false,
  last_weekly  date,
  last_monthly date,
  last_test    timestamptz,
  updated_at   timestamptz not null default now()
);
-- Nobody reads or writes this table directly (the link is secret). Everything goes through the functions below.
alter table public.server_discord enable row level security;
revoke all on public.server_discord from public, anon, authenticated;

-- The server owner's saved settings, or nothing when no link is saved.
create or replace function public.server_discord_get(s bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.owns_server(s) then raise exception 'Only the server owner can do this.'; end if;
  return (select jsonb_build_object('webhook_url', x.webhook_url, 'weekly', x.weekly, 'monthly', x.monthly)
          from public.server_discord x where x.server_id = s);
end;
$$;

-- Save the link and the two switches. The "already posted" dates are kept, so saving again never posts twice.
create or replace function public.save_server_discord(s bigint, url text, post_weekly boolean, post_monthly boolean) returns void
language plpgsql security definer set search_path = public as $$
declare u text := trim(coalesce(url, ''));
begin
  if auth.uid() is null or not public.owns_server(s) then raise exception 'Only the server owner can do this.'; end if;
  if not exists (select 1 from public.servers where id = s) then raise exception 'That server doesn''t exist anymore.'; end if;
  if u !~ '^https://(ptb\.|canary\.)?(discord|discordapp)\.com/api/webhooks/[0-9]{5,25}/[A-Za-z0-9_-]{20,100}$' then
    raise exception 'That isn''t a Discord webhook link. It starts with https://discord.com/api/webhooks/';
  end if;
  insert into public.server_discord (server_id, webhook_url, weekly, monthly)
    values (s, u, coalesce(post_weekly, true), coalesce(post_monthly, false))
    on conflict (server_id) do update
      set webhook_url = excluded.webhook_url, weekly = excluded.weekly, monthly = excluded.monthly, updated_at = now();
end;
$$;

-- Disconnect: the link is deleted and nothing is posted anymore.
create or replace function public.remove_server_discord(s bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.owns_server(s) then raise exception 'Only the server owner can do this.'; end if;
  delete from public.server_discord where server_id = s;
end;
$$;

-- The "Send test message" button on the server screen. At most once a minute per server.
create or replace function public.send_server_discord_test(s bigint) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  x public.server_discord;
begin
  if auth.uid() is null or not public.owns_server(s) then raise exception 'Only the server owner can do this.'; end if;
  select * into x from public.server_discord where server_id = s for update;
  if x.server_id is null then raise exception 'Save a Discord link first.'; end if;
  if x.last_test > now() - interval '1 minute' then raise exception 'Wait a minute before sending another test.'; end if;
  update public.server_discord set last_test = now() where server_id = s;
  perform net.http_post(
    url := x.webhook_url,
    body := jsonb_build_object('content', format('LockedIn is connected. The summary for **%s** will show up here.',
              public.discord_text((select name from public.servers where id = s))),
              'username', 'LockedIn', 'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb)),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 10000);
end;
$$;

-- ================================================================ helpers for the summaries (server only)

-- The last trading day of a group that has already closed, at a given moment.
create or replace function public.last_closed_day(g text, at_time timestamptz) returns date
language plpgsql stable security definer set search_path = public as $$
declare lc date := public.trading_day_at(g, at_time) - 1;
begin
  if lc is null then return null; end if;
  while extract(isodow from lc) > 5 or exists (select 1 from public.holidays h where h.day = lc) loop
    lc := lc - 1;
  end loop;
  return lc;
end;
$$;

-- How much of its homework a group got done between two days: finished member-days out of possible ones.
-- Excused days are skipped. A day when nobody in the group logged anything isn't held against the group,
-- the same way the mentor screen counts it. pct is empty when there was nothing to count.
create or replace function public.group_score(g text, d_from date, d_to date)
returns table (pct int, people int)
language sql stable security definer set search_path = public as $$
  with days as (
    select gs::date as dd
    from generate_series(d_from, d_to, interval '1 day') gs
    where extract(isodow from gs) <= 5 and not exists (select 1 from public.holidays h where h.day = gs::date)
      and exists (select 1 from public.ticks t join public.members m on m.key = t.member_key
                  where m.group_id = g and m.active and t.day = gs::date and not coalesce(t.excused, false))
  ), cells as (
    select public.day_done(gr.boxes, t) as fin
    from public.groups gr
    join public.members m on m.group_id = gr.id and m.active
    cross join days
    left join public.ticks t on t.day = days.dd and t.member_key = m.key
    where gr.id = g and not coalesce(t.excused, false)
  )
  select case when count(*) > 0 then round(100.0 * count(*) filter (where fin) / count(*))::int end,
         (select count(*)::int from public.members m where m.group_id = g and m.active)
  from cells;
$$;

-- A name that is posted in someone else's Discord (a group's name in the mentor's channel). On top of discord_text:
-- line breaks become spaces, and [ ] ( ) and web addresses are defused, so a name can't turn into a clickable link.
create or replace function public.discord_plain(s text) returns text
language sql immutable set search_path = public as $$
  select replace(regexp_replace(public.discord_text(regexp_replace(coalesce(s, ''), '\s+', ' ', 'g')), '([\[\]()])', '\\\1', 'g'), '://', ': //');
$$;

-- The lines of a mentor summary: every active group on the server, best first. Group names only.
create or replace function public.server_summary_lines(s bigint, d_from date, d_to date) returns text
language sql stable security definer set search_path = public as $$
  select string_agg(format('%s. %s · %s · %s %s', q.rk, public.discord_plain(q.nm),
                           case when q.pct is null then 'nothing logged' else q.pct || '%' end,
                           q.people, case when q.people = 1 then 'member' else 'members' end),
                    E'\n' order by q.rk) filter (where q.rk <= 25)
         || case when count(*) > 25 then E'\n' || format('and %s more', count(*) - 25) else '' end
  from (
    select g.name as nm, sc.pct, sc.people,
           row_number() over (order by sc.pct desc nulls last, g.name) as rk
    from public.server_groups x
    join public.groups g on g.id = x.group_id
    cross join lateral public.group_score(g.id, d_from, d_to) sc
    where x.server_id = s and g.status = 'active' and sc.people > 0
  ) q;
$$;

-- ================================================================ what is due now

-- Every recap that should be posted now. Marks each as posted, so calling it twice never posts twice.
-- Only the server can call it. The daily and weekly parts are the ones from update 15, unchanged.
-- New: the monthly ranking of a group, and the weekly and monthly summary of a mentor's server
-- (those rows have no group_id).
create or replace function public.due_recaps(at_time timestamptz default now())
returns table (group_id text, url text, kind text, content text)
language plpgsql volatile security definer set search_path = public as $$
declare
  gd record; d date; lc date; closes timestamptz; mins int; mon date;
  total int; done int; todo text; lines text; n int; body text;
  sd record; ms date; nd date; lc_first date; all_closed timestamptz;
begin
  for gd in
    select x.*, g.name as gname, g.boxes, g.status as gstatus
    from public.group_discord x join public.groups g on g.id = x.group_id
    where g.status = 'active'
    for update of x skip locked
  loop
    d := public.trading_day_at(gd.group_id, at_time);
    closes := public.day_closes_at(gd.group_id, d);

    -- daily: shortly before the day closes
    if gd.daily and at_time >= closes - make_interval(mins => gd.lead_minutes) and at_time < closes
       and gd.last_daily is distinct from d then
      select count(*) filter (where not coalesce(t.excused, false)),
             count(*) filter (where not coalesce(t.excused, false) and public.day_done(gd.boxes, t)),
             string_agg(public.discord_text(m.name), ', ' order by m.sort, m.name)
               filter (where not coalesce(t.excused, false) and not public.day_done(gd.boxes, t))
        into total, done, todo
      from public.members m
      left join public.ticks t on t.day = d and t.member_key = m.key
      where m.group_id = gd.group_id and m.active;
      if total > 0 then
        mins := greatest(1, ceil(extract(epoch from (closes - at_time)) / 60))::int;
        body := format(E'**%s** · %s\n%s/%s done · %s left\n%s',
          public.discord_text(gd.gname), to_char(d, 'Dy FMDD Mon'), done, total,
          case when mins >= 60 then (mins / 60) || 'h ' || lpad((mins % 60)::text, 2, '0') || 'm' else mins || ' min' end,
          case when todo is null then 'Everyone is done.' else 'Still to finish: ' || todo end);
        update public.group_discord x set last_daily = d where x.group_id = gd.group_id;
        group_id := gd.group_id; url := gd.webhook_url; kind := 'daily'; content := left(body, 1900);
        return next;
      end if;
    end if;

    -- weekly: right after the last trading day of a week closes
    lc := d - 1;
    while extract(isodow from lc) > 5 or exists (select 1 from public.holidays h where h.day = lc) loop
      lc := lc - 1;
    end loop;
    mon := lc - (extract(isodow from lc)::int - 1);
    if gd.weekly and mon <> d - (extract(isodow from d)::int - 1) and gd.last_weekly is distinct from mon
       and at_time < public.day_closes_at(gd.group_id, lc) + interval '1 day' then
      lines := null; n := 0;
      select string_agg(format('%s. %s · %s/%s days%s', rk, public.discord_text(nm), ok, possible,
                               case when wins + losses > 0 then format(' · %sW %sL', wins, losses) else '' end),
                        E'\n' order by rk)
        into lines
      from (
        select m.name as nm,
               count(*) filter (where public.day_done(gd.boxes, t)) as ok,
               count(*) filter (where not coalesce(t.excused, false)) as possible,
               count(*) filter (where t.result = 'win') as wins,
               count(*) filter (where t.result = 'loss') as losses,
               row_number() over (order by count(*) filter (where public.day_done(gd.boxes, t)) desc, m.sort, m.name) as rk
        from public.members m
        cross join generate_series(mon, lc, interval '1 day') as gs(dd)
        left join public.ticks t on t.day = gs.dd::date and t.member_key = m.key
        where m.group_id = gd.group_id and m.active
          and extract(isodow from gs.dd) <= 5 and not exists (select 1 from public.holidays h where h.day = gs.dd::date)
        group by m.key, m.name, m.sort
      ) s where rk <= 25;
      update public.group_discord x set last_weekly = mon where x.group_id = gd.group_id;
      if lines is not null then
        group_id := gd.group_id; url := gd.webhook_url; kind := 'weekly';
        content := left(format(E'**%s** · week of %s\n%s', public.discord_text(gd.gname), to_char(mon, 'FMDD Mon'), lines), 1900);
        return next;
      end if;
    end if;

    -- monthly: right after the last trading day of a month closes. Same counting as the weekly ranking.
    ms := date_trunc('month', lc)::date;
    if gd.monthly and ms <> date_trunc('month', d)::date and gd.last_monthly is distinct from ms
       and at_time < public.day_closes_at(gd.group_id, lc) + interval '1 day' then
      lines := null;
      select string_agg(format('%s. %s · %s/%s days%s', rk, public.discord_text(nm), ok, possible,
                               case when wins + losses > 0 then format(' · %sW %sL', wins, losses) else '' end),
                        E'\n' order by rk)
        into lines
      from (
        select m.name as nm,
               count(*) filter (where public.day_done(gd.boxes, t)) as ok,
               count(*) filter (where not coalesce(t.excused, false)) as possible,
               count(*) filter (where t.result = 'win') as wins,
               count(*) filter (where t.result = 'loss') as losses,
               row_number() over (order by count(*) filter (where public.day_done(gd.boxes, t)) desc, m.sort, m.name) as rk
        from public.members m
        cross join generate_series(ms, lc, interval '1 day') as gs(dd)
        left join public.ticks t on t.day = gs.dd::date and t.member_key = m.key
        where m.group_id = gd.group_id and m.active
          and extract(isodow from gs.dd) <= 5 and not exists (select 1 from public.holidays h where h.day = gs.dd::date)
        group by m.key, m.name, m.sort
      ) s where rk <= 25;
      update public.group_discord x set last_monthly = ms where x.group_id = gd.group_id;
      if lines is not null then
        group_id := gd.group_id; url := gd.webhook_url; kind := 'monthly';
        content := left(format(E'**%s** · %s\n%s', public.discord_text(gd.gname), to_char(ms, 'FMMonth YYYY'), lines), 1900);
        return next;
      end if;
    end if;
  end loop;

  -- mentor summaries: once the week (or month) has closed for every active group on the server.
  -- Groups can have different cutoffs and time zones, so this goes by the group that closes last:
  -- its last closed day and its open day are the earliest ones on the server.
  for sd in
    select x.*, s.name as sname
    from public.server_discord x join public.servers s on s.id = x.server_id
    for update of x skip locked
  loop
    select count(*), min(w.closed_day), min(w.open_day)
      into n, lc_first, nd
    from (
      select public.trading_day_at(g.id, at_time) as open_day, public.last_closed_day(g.id, at_time) as closed_day
      from public.server_groups sg join public.groups g on g.id = sg.group_id
      where sg.server_id = sd.server_id and g.status = 'active'
    ) w;
    continue when n = 0;
    -- the moment that day closed for the last group; a summary is never posted more than a day after it
    select max(public.day_closes_at(g.id, lc_first)) into all_closed
    from public.server_groups sg join public.groups g on g.id = sg.group_id
    where sg.server_id = sd.server_id and g.status = 'active';
    continue when at_time >= all_closed + interval '1 day';

    mon := lc_first - (extract(isodow from lc_first)::int - 1);
    if sd.weekly and mon <> nd - (extract(isodow from nd)::int - 1) and sd.last_weekly is distinct from mon then
      lines := public.server_summary_lines(sd.server_id, mon, lc_first);
      update public.server_discord x set last_weekly = mon where x.server_id = sd.server_id;
      if lines is not null then
        group_id := null; url := sd.webhook_url; kind := 'server-weekly';
        content := left(format(E'**%s** · week of %s\n%s', public.discord_plain(sd.sname), to_char(mon, 'FMDD Mon'), lines), 1900);
        return next;
      end if;
    end if;

    ms := date_trunc('month', lc_first)::date;
    if sd.monthly and ms <> date_trunc('month', nd)::date and sd.last_monthly is distinct from ms then
      lines := public.server_summary_lines(sd.server_id, ms, lc_first);
      update public.server_discord x set last_monthly = ms where x.server_id = sd.server_id;
      if lines is not null then
        group_id := null; url := sd.webhook_url; kind := 'server-monthly';
        content := left(format(E'**%s** · %s\n%s', public.discord_plain(sd.sname), to_char(ms, 'FMMonth YYYY'), lines), 1900);
        return next;
      end if;
    end if;
  end loop;
end;
$$;

-- ================================================================ who may call what
-- Signed-out visitors get nothing. The helpers and due_recaps are for the server only.
revoke all on function public.server_discord_get(bigint), public.save_server_discord(bigint, text, boolean, boolean),
  public.remove_server_discord(bigint), public.send_server_discord_test(bigint),
  public.last_closed_day(text, timestamptz), public.group_score(text, date, date), public.discord_plain(text),
  public.server_summary_lines(bigint, date, date), public.due_recaps(timestamptz)
  from public, anon, authenticated;
grant execute on function public.server_discord_get(bigint), public.save_server_discord(bigint, text, boolean, boolean),
  public.remove_server_discord(bigint), public.send_server_discord_test(bigint) to authenticated;
