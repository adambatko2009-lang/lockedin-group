-- Update 16: old pictures are deleted after 60 days, group owners get notifications about join requests and reports,
-- and members can react to each other's posts.
-- Run ONCE in Supabase > SQL Editor > New query > paste > Run (after update 15), BEFORE pushing the website.
-- Then update the send-reminders Edge Function (see README): it now also sends owner alerts and deletes old pictures.

-- ================================================================ pictures older than 60 days
-- The send-reminders function asks for old picture files, deletes them through Supabase Storage (that's what frees the space),
-- then tells the database to forget them. Only the server can call these.
create or replace function public.old_pictures(max_count int default 200) returns setof text
language sql stable security definer set search_path = public as $$
  select o.name from storage.objects o
  where o.bucket_id = 'screenshots'
    and o.name ~ '^\d{4}-\d{2}-\d{2}/'
    and left(o.name, 10) < to_char(current_date - 60, 'YYYY-MM-DD')
  order by o.name
  limit greatest(1, least(max_count, 1000));
$$;
revoke all on function public.old_pictures(int) from public, anon, authenticated;

create or replace function public.forget_pictures(paths text[]) returns int
language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  update public.ticks t set images = array(select p from unnest(t.images) p where p <> all (paths))
  where t.images && paths;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.forget_pictures(text[]) from public, anon, authenticated;

-- ================================================================ owner alerts
-- Filled by the database itself; nobody can read or write it from the app. Sent by send-reminders to the
-- owner's phones and computers that have notifications on.
create table if not exists public.owner_alerts (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  group_id   text not null references public.groups (id) on update cascade on delete cascade,
  kind       text not null check (kind in ('join', 'report')),
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);
alter table public.owner_alerts enable row level security;   -- no policies: only the server
revoke all on public.owner_alerts from anon, authenticated;

-- Someone asked to join: tell the group owner and the group admins.
create or replace function public.alert_join() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status is distinct from 'pending') then
    insert into public.owner_alerts (user_id, group_id, kind)
    select x.uid, new.group_id, 'join' from (
      select owner_id as uid from public.groups where id = new.group_id and status = 'active'
      union
      select user_id from public.memberships where group_id = new.group_id and status = 'approved' and role = 'admin'
    ) x where x.uid is not null and x.uid <> new.user_id and x.uid is distinct from auth.uid();
  end if;
  return new;
end;
$$;
drop trigger if exists memberships_alert_join on public.memberships;
create trigger memberships_alert_join after insert or update of status on public.memberships
  for each row execute function public.alert_join();
revoke execute on function public.alert_join() from public, anon, authenticated;

-- Something was reported: tell the group owner and the app owner.
create or replace function public.alert_report() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.owner_alerts (user_id, group_id, kind)
  select x.uid, new.group_id, 'report' from (
    select owner_id as uid from public.groups where id = new.group_id
    union
    select user_id from public.admins
  ) x where x.uid is not null and x.uid is distinct from new.reporter_id and x.uid is distinct from auth.uid();
  return new;
end;
$$;
drop trigger if exists reports_alert on public.reports;
create trigger reports_alert after insert on public.reports for each row execute function public.alert_report();
revoke execute on function public.alert_report() from public, anon, authenticated;

-- Alerts to send now, one notification per person, group and kind ("3 people want to join Night Desk").
-- Marks them as sent, so calling it twice never sends twice. Alerts for people without notifications are just dropped.
create or replace function public.due_owner_alerts()
returns table (endpoint text, p256dh text, auth text, title text, body text, tag text)
language plpgsql volatile security definer set search_path = public as $$
begin
  delete from public.owner_alerts where sent_at < now() - interval '7 days';
  return query
  with fresh as (
    update public.owner_alerts a set sent_at = now()
    where a.sent_at is null
    returning a.user_id, a.group_id, a.kind, a.created_at
  ), grouped as (
    select f.user_id, f.group_id, f.kind, count(*)::int as n
    from fresh f where f.created_at > now() - interval '1 day'
    group by f.user_id, f.group_id, f.kind
  )
  select s.endpoint, s.p256dh, s.auth,
    case when g.kind = 'join'
      then case when g.n = 1 then 'Someone wants to join ' else g.n || ' people want to join ' end || gr.name
      else case when g.n = 1 then 'New report in ' else g.n || ' new reports in ' end || gr.name end,
    case when g.kind = 'join' then 'Open Admin to approve them and give them a name.'
      else 'A member reported a picture or note. Open Admin to look at it.' end,
    'owner-' || g.kind || '-' || g.group_id
  from grouped g
  join public.groups gr on gr.id = g.group_id
  join public.push_subscriptions s on s.user_id = g.user_id;
end;
$$;
revoke all on function public.due_owner_alerts() from public, anon, authenticated;

-- ================================================================ reactions
-- One tap on someone's post (note or pictures) for the day: fire, clean (good execution) or respect.
create table if not exists public.reactions (
  group_id    text not null references public.groups (id) on update cascade on delete cascade,
  day         date not null,
  member_key  text not null references public.members (key) on update cascade on delete cascade,   -- whose post
  reactor_key text not null references public.members (key) on update cascade on delete cascade,   -- who reacted
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('fire', 'clean', 'respect')),
  created_at  timestamptz not null default now(),
  primary key (day, member_key, user_id, kind)
);
create index if not exists reactions_group_day on public.reactions (group_id, day);

-- The group and "who reacted" are filled in by the database, never by the app.
create or replace function public.set_reaction() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.group_id := public.member_group(new.member_key);
  new.reactor_key := public.my_key(new.group_id);
  new.user_id := auth.uid();
  new.created_at := now();
  if new.reactor_key is null then raise exception 'Only members with a name in this group can react.'; end if;
  if new.reactor_key = new.member_key then raise exception 'You can''t react to your own post.'; end if;
  if not exists (select 1 from public.ticks t where t.day = new.day and t.member_key = new.member_key
                 and (coalesce(t.note, '') <> '' or cardinality(t.images) > 0)) then
    raise exception 'There''s nothing to react to.';
  end if;
  return new;
end;
$$;
drop trigger if exists reactions_set on public.reactions;
create trigger reactions_set before insert on public.reactions for each row execute function public.set_reaction();
revoke execute on function public.set_reaction() from public, anon, authenticated;

alter table public.reactions enable row level security;
revoke all on public.reactions from anon;
grant select, insert, delete on public.reactions to authenticated;
create policy reactions_read on public.reactions for select to authenticated using (public.in_group(group_id));
create policy reactions_add on public.reactions for insert to authenticated with check (public.in_group(public.member_group(member_key)));
create policy reactions_remove on public.reactions for delete to authenticated using (user_id = auth.uid() or public.can_manage(group_id));
-- New reactions show up for everyone in the group right away.
alter publication supabase_realtime add table public.reactions;

-- ================================================================ your data
-- The download from Settings > Your data now also includes the reactions you gave.
create or replace function public.export_my_data() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  keys text[];
begin
  if me is null then raise exception 'Sign in first'; end if;
  select coalesce(array_agg(member_key), '{}') into keys from public.memberships where user_id = me and member_key is not null;
  return jsonb_build_object(
    'exported_at', now(),
    'account', jsonb_build_object('user_id', me, 'email', (select email from auth.users where id = me)),
    'profile', (select to_jsonb(p) from public.profiles p where p.user_id = me),
    'settings', (select to_jsonb(s) from public.user_settings s where s.user_id = me),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('group', g.name, 'status', m.status, 'role', m.role,
                         'name_in_group', mb.name, 'joined', m.created_at) order by m.created_at)
              from public.memberships m join public.groups g on g.id = m.group_id
              left join public.members mb on mb.key = m.member_key
              where m.user_id = me), '[]'),
    'groups_you_own', coalesce((select jsonb_agg(g.name) from public.groups g where g.owner_id = me), '[]'),
    'ticks', coalesce((select jsonb_agg(to_jsonb(t) - 'updated_by' order by t.day) from public.ticks t where t.member_key = any(keys)), '[]'),
    'reflections', coalesce((select jsonb_agg(to_jsonb(r) order by r.week_start) from public.reflections r where r.member_key = any(keys)), '[]'),
    'group_requests', coalesce((select jsonb_agg(to_jsonb(q)) from public.group_requests q where q.user_id = me), '[]'),
    'reminder_devices', coalesce((select jsonb_agg(jsonb_build_object('minutes_before', s.minutes_before, 'added', s.created_at))
              from public.push_subscriptions s where s.user_id = me), '[]'),
    'reactions_you_gave', coalesce((select jsonb_agg(jsonb_build_object('day', x.day, 'to', mb.name, 'kind', x.kind) order by x.day)
              from public.reactions x left join public.members mb on mb.key = x.member_key where x.user_id = me), '[]'),
    'reports_you_sent', coalesce((select jsonb_agg(jsonb_build_object('day', r.day, 'kind', r.kind, 'reason', r.reason, 'sent', r.created_at) order by r.created_at)
              from public.reports r where r.reporter_id = me), '[]')
  );
end;
$$;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

