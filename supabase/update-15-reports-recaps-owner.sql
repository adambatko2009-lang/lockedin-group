-- Update 15: reporting pictures and notes, daily and weekly recaps in a group's Discord, and moving a group to a new owner.
-- Run ONCE in Supabase > SQL Editor > New query > paste > Run (after update 14), BEFORE pushing the website.
--
-- Nothing is removed. The last part (SCHEDULE) only works on Supabase; it posts the recaps every 5 minutes.

-- ================================================================ reports
-- Anyone in a group can report a picture or note in that group. Only the group owner and you (app owner) see reports.
create table if not exists public.reports (
  id          bigint generated always as identity primary key,
  group_id    text not null references public.groups (id) on update cascade on delete cascade,
  day         date not null,
  member_key  text not null references public.members (key) on update cascade on delete cascade,
  kind        text not null check (kind in ('picture', 'note')),
  image       text not null default '' check (char_length(image) <= 200),
  reason      text not null check (reason in ('inappropriate', 'harassment', 'spam', 'other')),
  detail      text not null default '' check (char_length(detail) <= 300),
  excerpt     text not null default '' check (char_length(excerpt) <= 300),   -- start of the note, kept as evidence
  reporter_id uuid default auth.uid() references auth.users (id) on delete set null,
  status      text not null default 'open' check (status in ('open', 'handled')),
  created_at  timestamptz not null default now(),
  handled_at  timestamptz
);
create unique index if not exists reports_once on public.reports (reporter_id, day, member_key, kind, image) where status = 'open';

alter table public.reports enable row level security;
revoke all on public.reports from anon;
grant select, update, delete on public.reports to authenticated;
create policy reports_read on public.reports for select to authenticated using (public.is_group_owner(group_id));
create policy reports_handle on public.reports for update to authenticated
  using (public.is_group_owner(group_id)) with check (public.is_group_owner(group_id));
create policy reports_delete on public.reports for delete to authenticated using (public.is_admin());

-- Only the status can change once a report exists.
create or replace function public.protect_report() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.id := old.id; new.group_id := old.group_id; new.day := old.day; new.member_key := old.member_key;
  new.kind := old.kind; new.image := old.image; new.reason := old.reason; new.detail := old.detail;
  new.excerpt := old.excerpt; new.reporter_id := old.reporter_id; new.created_at := old.created_at;
  new.handled_at := case when new.status = 'handled' then coalesce(old.handled_at, now()) else null end;
  return new;
end;
$$;
drop trigger if exists reports_protect on public.reports;
create trigger reports_protect before update on public.reports for each row execute function public.protect_report();
revoke execute on function public.protect_report() from public, anon, authenticated;

create or replace function public.report_content(r_day date, r_key text, r_kind text, r_image text, r_reason text, r_detail text default '')
returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  g text := public.member_group(r_key);
  t public.ticks;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if g is null or not public.in_group(g) then raise exception 'You can only report things in your own group.'; end if;
  if r_key = public.my_key(g) then raise exception 'You can''t report your own post.'; end if;
  if r_kind not in ('picture', 'note') then raise exception 'Unknown kind'; end if;
  if r_reason not in ('inappropriate', 'harassment', 'spam', 'other') then raise exception 'Pick a reason.'; end if;
  select * into t from public.ticks where day = r_day and member_key = r_key;
  if t.member_key is null then raise exception 'That post doesn''t exist anymore.'; end if;
  if r_kind = 'picture' and not (coalesce(r_image, '') = any (t.images)) then raise exception 'That picture doesn''t exist anymore.'; end if;
  if r_kind = 'note' and coalesce(t.note, '') = '' then raise exception 'That note doesn''t exist anymore.'; end if;
  if (select count(*) from public.reports where reporter_id = auth.uid() and created_at > now() - interval '1 day') >= 20 then
    raise exception 'You''ve sent a lot of reports today. Try again tomorrow.';
  end if;
  insert into public.reports (group_id, day, member_key, kind, image, reason, detail, excerpt)
  values (g, r_day, r_key, r_kind, case when r_kind = 'picture' then r_image else '' end, r_reason,
          left(regexp_replace(coalesce(r_detail, ''), '[<>]', '', 'g'), 300),
          case when r_kind = 'note' then left(t.note, 300) else '' end)
  on conflict do nothing;
end;
$$;
revoke all on function public.report_content(date, text, text, text, text, text) from public, anon;
grant execute on function public.report_content(date, text, text, text, text, text) to authenticated;

-- ================================================================ Discord recaps
-- The group owner pastes a Discord webhook link (Channel settings > Integrations > Webhooks).
-- The link is secret, so only the group owner and you can see it. Members never do.
create table if not exists public.group_discord (
  group_id     text primary key references public.groups (id) on update cascade on delete cascade,
  webhook_url  text not null check (webhook_url ~ '^https://(ptb\.|canary\.)?(discord|discordapp)\.com/api/webhooks/[0-9]{5,25}/[A-Za-z0-9_-]{20,100}$'),
  daily        boolean not null default true,
  weekly       boolean not null default true,
  lead_minutes int not null default 60 check (lead_minutes in (30, 60, 120, 180)),
  last_daily   date,
  last_weekly  date,
  last_test    timestamptz,
  updated_at   timestamptz not null default now()
);
alter table public.group_discord enable row level security;
revoke all on public.group_discord from anon;
grant select, insert, update, delete on public.group_discord to authenticated;
create policy discord_owner on public.group_discord for all to authenticated
  using (public.is_group_owner(group_id)) with check (public.is_group_owner(group_id));

-- Owners can't fake "already posted" dates.
-- (Runs as whoever makes the change, so it can tell the server apart from a signed-in person.)
create or replace function public.protect_group_discord() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'UPDATE' then
      new.group_id := old.group_id; new.last_daily := old.last_daily; new.last_weekly := old.last_weekly; new.last_test := old.last_test;
    else
      new.last_daily := null; new.last_weekly := null; new.last_test := null;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists group_discord_protect on public.group_discord;
create trigger group_discord_protect before insert or update on public.group_discord
  for each row execute function public.protect_group_discord();
revoke execute on function public.protect_group_discord() from public, anon, authenticated;

-- Discord treats \, *, _, ~, ` and | as formatting. Names are shown as plain text.
create or replace function public.discord_text(s text) returns text
language sql immutable set search_path = public as $$
  select regexp_replace(coalesce(s, ''), '([\\*_~`|])', '\\\1', 'g');
$$;

-- Is this member done on this day? All required boxes ticked (and at least one required box exists).
create or replace function public.day_done(boxes jsonb, t public.ticks) returns boolean
language sql immutable set search_path = public as $$
  select t.member_key is not null
     and exists (select 1 from unnest(array['chart','journal','review','social','box5','box6']) s where boxes -> s ->> 'kind' = 'req')
     and not exists (select 1 from unnest(array['chart','journal','review','social','box5','box6']) s
                     where boxes -> s ->> 'kind' = 'req' and coalesce((to_jsonb(t) ->> s)::boolean, false) = false);
$$;

-- Every recap that should be posted now. Marks each as posted, so calling it twice never posts twice.
-- Only the server can call it.
create or replace function public.due_recaps(at_time timestamptz default now())
returns table (group_id text, url text, kind text, content text)
language plpgsql volatile security definer set search_path = public as $$
declare
  gd record; d date; lc date; closes timestamptz; mins int; mon date;
  total int; done int; todo text; lines text; n int; body text;
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
  end loop;
end;
$$;
revoke all on function public.due_recaps(timestamptz) from public, anon, authenticated;
revoke all on function public.day_done(jsonb, public.ticks) from public, anon;
revoke all on function public.discord_text(text) from public, anon;

-- ================================================================ moving a group to a new owner
-- The owner (or you) picks someone who is approved in the group with a name. They become the owner;
-- the old owner stays in the group as a normal member. Only this function can change the owner.
create or replace function public.protect_group() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    new.id := old.id;
    if coalesce(current_setting('lockedin.moving_group', true), '') <> old.id then new.owner_id := old.owner_id; end if;
    new.status := old.status;
    new.created_at := old.created_at;
  end if;
  perform now() at time zone new.timezone;   -- refuses a time zone that doesn't exist
  return new;
end;
$$;

create or replace function public.transfer_group(g text, new_owner uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  old_owner uuid;
begin
  select owner_id into old_owner from public.groups where id = g;
  if old_owner is null then raise exception 'That group doesn''t exist.'; end if;
  if not (public.is_admin() or (old_owner = auth.uid() and public.group_open(g))) then
    raise exception 'Only the group owner can hand the group over.';
  end if;
  if new_owner is null or new_owner = old_owner then raise exception 'Pick someone else in the group.'; end if;
  if not exists (select 1 from public.memberships where group_id = g and user_id = new_owner and status = 'approved' and member_key is not null) then
    raise exception 'The new owner must be approved in the group and have a name.';
  end if;
  update public.memberships set role = 'admin' where group_id = g and user_id = new_owner;
  update public.memberships set role = 'member' where group_id = g and user_id = old_owner;
  perform set_config('lockedin.moving_group', g, true);
  update public.groups set owner_id = new_owner where id = g;
  perform set_config('lockedin.moving_group', '', true);
  -- the Discord link was set up by the old owner; the new owner adds their own
  delete from public.group_discord where group_id = g;
end;
$$;
revoke all on function public.transfer_group(text, uuid) from public, anon;
grant execute on function public.transfer_group(text, uuid) to authenticated;

-- ================================================================ SCHEDULE (Supabase only)
-- Every 5 minutes, post the recaps that are due. Mentions are switched off, so nobody gets pinged.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
select cron.schedule('clean-reports', '23 3 * * *', $$ delete from public.reports where status = 'handled' and handled_at < now() - interval '90 days'; $$);
select cron.schedule('send-discord-recaps', '*/5 * * * *', $$
  select net.http_post(
    url := r.url,
    body := jsonb_build_object('content', r.content, 'username', 'LockedIn', 'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb)),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 10000
  ) from public.due_recaps() r;
$$);

-- The "Send test message" button in Group settings. At most once a minute per group.
create or replace function public.send_discord_test(g text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  x public.group_discord;
begin
  if not public.is_group_owner(g) then raise exception 'Only the group owner can do this.'; end if;
  select * into x from public.group_discord where group_id = g for update;
  if x.group_id is null then raise exception 'Save a Discord link first.'; end if;
  if x.last_test > now() - interval '1 minute' then raise exception 'Wait a minute before sending another test.'; end if;
  update public.group_discord set last_test = now() where group_id = g;
  perform net.http_post(
    url := x.webhook_url,
    body := jsonb_build_object('content', format('LockedIn is connected. Recaps for **%s** will show up here.',
              public.discord_text((select name from public.groups where id = g))),
              'username', 'LockedIn', 'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb)),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 10000);
end;
$$;
revoke all on function public.send_discord_test(text) from public, anon;
grant execute on function public.send_discord_test(text) to authenticated;
