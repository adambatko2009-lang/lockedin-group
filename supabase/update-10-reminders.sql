-- Update 10: reminder notifications.
-- Run ONCE in Supabase > SQL Editor > New query > paste > Run (after update 9).
--
-- When someone turns on reminders in Settings, their phone/computer gets a "push address" that is saved here.
-- Every 5 minutes Supabase asks the send-reminders function to notify everyone whose homework isn't done
-- yet and whose group's day closes soon (each person picks 30 min, 1, 2 or 3 hours before).
-- Each person gets at most one reminder per group per day.

-- ================================================================ push addresses (one per device)
create table if not exists public.push_subscriptions (
  id             bigserial primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  endpoint       text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh         text not null check (char_length(p256dh) between 20 and 200),
  auth           text not null check (char_length(auth) between 10 and 100),
  minutes_before int  not null default 60 check (minutes_before in (30, 60, 120, 180)),
  created_at     timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
-- You can see and remove your own devices. Saving goes through save_push_subscription() below.
drop policy if exists push_own_read on public.push_subscriptions;
drop policy if exists push_own_delete on public.push_subscriptions;
create policy push_own_read on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy push_own_delete on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());
revoke all on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;

-- Save (or move to you) this device's push address. A device that someone else used before becomes yours.
create or replace function public.save_push_subscription(sub_endpoint text, sub_p256dh text, sub_auth text, sub_minutes int default 60)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first'; end if;
  if (select count(*) from public.push_subscriptions s where s.user_id = me and s.endpoint <> sub_endpoint) >= 10 then
    raise exception 'Too many devices with reminders. Turn them off on a device you no longer use.';
  end if;
  insert into public.push_subscriptions as s (user_id, endpoint, p256dh, auth, minutes_before)
  values (me, sub_endpoint, sub_p256dh, sub_auth, sub_minutes)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, minutes_before = excluded.minutes_before;
end;
$$;
revoke all on function public.save_push_subscription(text, text, text, int) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, int) to authenticated;

-- ================================================================ who needs a reminder right now
-- Remembers who already got today's reminder, so nobody gets two.
create table if not exists public.push_log (
  sub_id   bigint not null references public.push_subscriptions (id) on delete cascade,
  group_id text   not null references public.groups (id) on delete cascade,
  day      date   not null,
  sent_at  timestamptz not null default now(),
  primary key (sub_id, group_id, day)
);
alter table public.push_log enable row level security;   -- no policies: only the server can use it
revoke all on public.push_log from anon, authenticated;

-- When a group's trading day closes: the cutoff hour on the next trading day, in the group's time zone.
create or replace function public.day_closes_at(g text, d date) returns timestamptz
language plpgsql stable security definer set search_path = public as $$
declare
  tz text; h int; nd date := d + 1;
begin
  select timezone, cutoff_hour into tz, h from public.groups where id = g;
  if tz is null then return null; end if;
  while extract(isodow from nd) > 5 or exists (select 1 from public.holidays x where x.day = nd) loop
    nd := nd + 1;
  end loop;
  return (nd + make_interval(hours => h)) at time zone tz;
end;
$$;

-- current_trading_day at any moment (the one from update 9 always uses "now").
create or replace function public.trading_day_at(g text, at_time timestamptz) returns date
language plpgsql stable security definer set search_path = public as $$
declare
  tz text; h int; d date;
begin
  select timezone, cutoff_hour into tz, h from public.groups where id = g;
  if tz is null then return null; end if;
  d := ((at_time at time zone tz) - make_interval(hours => h))::date;
  while extract(isodow from d) > 5 or exists (select 1 from public.holidays x where x.day = d) loop
    d := d - 1;
  end loop;
  return d;
end;
$$;

-- Everyone who should get a reminder now. Marks them as sent, so calling it twice never sends twice.
-- Only the server (the send-reminders function) can call this.
create or replace function public.due_reminders(at_time timestamptz default now())
returns table (sub_id bigint, endpoint text, p256dh text, auth text, group_name text, missing text[], minutes_left int)
language plpgsql volatile security definer set search_path = public as $$
begin
  return query
  with days as (
    select g.id, g.name, g.boxes, g.timezone, public.trading_day_at(g.id, at_time) as d
    from public.groups g where g.status = 'active'
  ), open_days as (
    select x.*, public.day_closes_at(x.id, x.d) as closes from days x
  ), due as (
    select s.id as sid, s.endpoint as ep, s.p256dh as pk, s.auth as au, o.id as gid, o.name as gname, o.d, o.closes,
      array(select o.boxes -> slot ->> 'label'
            from unnest(array['chart','journal','review','social','box5','box6']) with ordinality as b(slot, n)
            where o.boxes -> slot ->> 'kind' = 'req' and coalesce((to_jsonb(t) ->> slot)::boolean, false) = false
            order by n) as todo
    from open_days o
    join public.memberships ms on ms.group_id = o.id and ms.status = 'approved' and ms.member_key is not null
    join public.members mb on mb.key = ms.member_key and mb.active
    join public.push_subscriptions s on s.user_id = ms.user_id
    left join public.ticks t on t.day = o.d and t.member_key = ms.member_key
    where at_time >= o.closes - make_interval(mins => s.minutes_before) and at_time < o.closes
      and not coalesce(t.excused, false)
      and not exists (select 1 from public.push_log l where l.sub_id = s.id and l.group_id = o.id and l.day = o.d)
  ), logged as (
    insert into public.push_log (sub_id, group_id, day)
    select sid, gid, d from due where cardinality(todo) > 0
    on conflict do nothing
    returning push_log.sub_id, push_log.group_id
  )
  select due.sid, due.ep, due.pk, due.au, due.gname, due.todo,
         greatest(1, ceil(extract(epoch from (due.closes - at_time)) / 60))::int
  from due join logged on logged.sub_id = due.sid and logged.group_id = due.gid;
end;
$$;
revoke all on function public.due_reminders(timestamptz) from public, anon, authenticated;
grant execute on function public.due_reminders(timestamptz) to service_role;
revoke all on function public.day_closes_at(text, date) from public, anon;
revoke all on function public.trading_day_at(text, timestamptz) from public, anon;
grant execute on function public.day_closes_at(text, date), public.trading_day_at(text, timestamptz) to authenticated;

-- Old "already reminded" rows aren't needed after a week.
create or replace function public.clean_push_log() returns void
language sql security definer set search_path = public as $$
  delete from public.push_log where sent_at < now() - interval '7 days';
$$;
revoke all on function public.clean_push_log() from public, anon, authenticated;
grant execute on function public.clean_push_log() to service_role;

-- ================================================================ SCHEDULE (Supabase only)
-- Every 5 minutes, ask the send-reminders function to send what's due.
-- Anyone calling that function can only trigger reminders that are due anyway, so it needs no password.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
select cron.schedule('send-reminders', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://awpyovkucwteyzsqcazl.supabase.co/functions/v1/send-reminders',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
$$);
select cron.schedule('clean-push-log', '17 3 * * *', $$ select public.clean_push_log(); $$);
