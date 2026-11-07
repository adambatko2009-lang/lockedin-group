-- Update 9: groups.
-- Run ONCE in Supabase > SQL Editor > New query > paste > Run (after update 8). Best outside trading hours.
--
-- Turns the app into many separate groups. Your current group becomes the group "LockedIn" with all its history.
--
-- Who can do what (enforced here in the database, not just in the website):
--   * App owner (you, the "admins" table) ... everything, in every group: create / pause / delete groups,
--                                              approve group requests, change any group's owner.
--   * Group owner ............................ only their own group: settings (name, color, logo, homework boxes,
--                                              points, cutoff time, time zone), join code, group admins,
--                                              plus everything a group admin can do.
--   * Group admin ............................ only their own group: approve / reject people, add / rename members,
--                                              excuse days, fix anyone's ticks in that group.
--   * Member ................................. sees only their own group(s); ticks only their own row on the open day.
--   * Anyone signed in ....................... can type a join code (puts them on that group's waiting list)
--                                              and can ask you for a group of their own.
-- Groups can never see each other's members, ticks, notes, pictures or reflections.

-- ================================================================ new tables

create table public.groups (
  id          text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  name        text not null check (char_length(name) between 1 and 40 and name !~ '[<>]'),
  color       text not null default 'blue' check (color in ('blue', 'violet', 'green', 'orange', 'red', 'teal', 'pink', 'gold')),
  logo_path   text check (logo_path ~ '^[a-z0-9-]{2,40}/[0-9]{1,20}\.jpg$'),
  join_code   text not null unique check (join_code ~ '^[A-Z0-9]{4}-[A-Z0-9]{4}$'),
  owner_id    uuid not null references auth.users (id),
  status      text not null default 'active' check (status in ('active', 'paused')),
  timezone    text not null default 'America/New_York' check (char_length(timezone) <= 64),
  cutoff_hour int  not null default 9 check (cutoff_hour between 0 and 23),
  boxes       jsonb not null,
  points      jsonb not null default '{"complete": 2, "partial": 1, "bonus": 1}',
  created_at  timestamptz not null default now()
);

-- Who is in which group. One row per person per group.
create table public.memberships (
  group_id   text not null references public.groups (id) on update cascade on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  role       text not null default 'member' check (role in ('member', 'admin')),
  member_key text references public.members (key) on update cascade on delete set null,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
-- One Discord account per member name.
create unique index memberships_one_account_per_member on public.memberships (member_key) where member_key is not null;

-- "I want my own group" requests. Only you (app owner) see and approve them.
create table public.group_requests (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 40 and name !~ '[<>]'),
  note       text not null default '' check (char_length(note) <= 300),
  status     text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

-- ================================================================ checks for group settings

-- Homework boxes: six slots (chart, journal, review, social, box5, box6). Each has a label and is required, bonus or off.
create or replace function public.valid_boxes(b jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(b) = 'object'
     and (select count(*) from jsonb_object_keys(b)) = 6
     and (select bool_and(k in ('chart', 'journal', 'review', 'social', 'box5', 'box6')
                          and jsonb_typeof(b -> k) = 'object'
                          and coalesce(b -> k ->> 'kind', '') in ('req', 'bonus', 'off')
                          and char_length(coalesce(b -> k ->> 'label', '')) between 1 and 30
                          and (b -> k ->> 'label') !~ '[<>]')
          from jsonb_object_keys(b) k)
     and exists (select 1 from jsonb_each(b) e where e.value ->> 'kind' = 'req');
$$;

create or replace function public.valid_points(p jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(p) = 'object'
     and (select count(*) from jsonb_object_keys(p)) = 3
     and (select bool_and(k in ('complete', 'partial', 'bonus') and jsonb_typeof(p -> k) = 'number'
                          and (p ->> k)::numeric between 0 and 10 and (p ->> k)::numeric = round((p ->> k)::numeric))
          from jsonb_object_keys(p) k);
$$;

alter table public.groups add constraint groups_boxes_valid check (public.valid_boxes(boxes));
alter table public.groups add constraint groups_points_valid check (public.valid_points(points));

-- ================================================================ your current group becomes "LockedIn"

insert into public.groups (id, name, color, join_code, owner_id, boxes)
select 'lockedin', 'LockedIn', 'blue', 'LOCK-' || upper(substr(md5(gen_random_uuid()::text), 1, 4)),
       (select user_id from public.admins limit 1),
       '{"chart":   {"label": "Chart with execution", "kind": "req"},
         "journal": {"label": "Journal", "kind": "req"},
         "review":  {"label": "HTF", "kind": "req"},
         "social":  {"label": "Social", "kind": "bonus"},
         "box5":    {"label": "Extra 1", "kind": "off"},
         "box6":    {"label": "Extra 2", "kind": "off"}}';

alter table public.members add column group_id text references public.groups (id) on update cascade on delete cascade;
update public.members set group_id = 'lockedin';
alter table public.members alter column group_id set not null;
create index members_group on public.members (group_id);

insert into public.memberships (group_id, user_id, status, member_key, created_at)
select 'lockedin', user_id, status, member_key, created_at from public.profiles;
update public.memberships set role = 'admin', status = 'approved' where user_id in (select user_id from public.admins);

-- Two more homework boxes for groups that want them (off by default).
alter table public.ticks add column box5 boolean not null default false;
alter table public.ticks add column box6 boolean not null default false;

alter table public.ticks add column group_id text references public.groups (id) on update cascade on delete cascade;
update public.ticks t set group_id = m.group_id from public.members m where m.key = t.member_key;
alter table public.ticks alter column group_id set not null;
create index ticks_group_day on public.ticks (group_id, day);

alter table public.reflections add column group_id text references public.groups (id) on update cascade on delete cascade;
update public.reflections r set group_id = m.group_id from public.members m where m.key = r.member_key;
alter table public.reflections alter column group_id set not null;

-- ================================================================ remove the old one-group rules

drop policy members_read on public.members;
drop policy members_write on public.members;
drop policy profiles_read_own on public.profiles;
drop policy profiles_admin on public.profiles;
drop policy profiles_admin_del on public.profiles;
drop policy holidays_read on public.holidays;
drop policy holidays_write on public.holidays;
drop policy ticks_read on public.ticks;
drop policy ticks_insert on public.ticks;
drop policy ticks_update on public.ticks;
drop policy ticks_delete on public.ticks;
drop policy reflections_read on public.reflections;
drop policy reflections_insert on public.reflections;
drop policy reflections_update on public.reflections;
drop policy reflections_delete on public.reflections;
drop policy screenshots_read on storage.objects;
drop policy screenshots_upload on storage.objects;
drop policy screenshots_delete on storage.objects;

drop trigger profiles_sync_avatar on public.profiles;
drop function public.sync_member_avatar();
alter table public.profiles drop column status, drop column member_key;
drop function public.is_approved();
drop function public.my_member_key();

-- ================================================================ helper functions
-- "security definer" lets these read the tables they check without being blocked by the rules below.

-- is_admin() = the app owner (you). Unchanged.

create or replace function public.group_open(g text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.groups where id = g and status = 'active');
$$;

create or replace function public.is_group_owner(g text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (select 1 from public.groups where id = g and owner_id = auth.uid() and status = 'active');
$$;

-- Owner or group admin of an active group (or the app owner).
create or replace function public.can_manage(g text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_group_owner(g)
      or (public.group_open(g) and exists (select 1 from public.memberships
            where group_id = g and user_id = auth.uid() and status = 'approved' and role = 'admin'));
$$;

-- Can see the group's data: approved members, its owner, the app owner. Paused groups stay readable.
create or replace function public.in_group(g text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or exists (select 1 from public.groups where id = g and owner_id = auth.uid())
      or exists (select 1 from public.memberships where group_id = g and user_id = auth.uid() and status = 'approved');
$$;

create or replace function public.my_key(g text) returns text
language sql stable security definer set search_path = public as $$
  select member_key from public.memberships where group_id = g and user_id = auth.uid() and status = 'approved';
$$;

create or replace function public.member_group(k text) returns text
language sql stable security definer set search_path = public as $$
  select group_id from public.members where key = k;
$$;

-- The open trading day for a group: opens at its cutoff hour in its time zone, closes at that hour on the next trading day.
create or replace function public.current_trading_day(g text) returns date
language plpgsql stable security definer set search_path = public as $$
declare
  tz text; h int; d date;
begin
  select timezone, cutoff_hour into tz, h from public.groups where id = g;
  if tz is null then return null; end if;
  d := ((now() at time zone tz) - make_interval(hours => h))::date;
  while extract(isodow from d) > 5 or exists (select 1 from public.holidays x where x.day = d) loop
    d := d - 1;
  end loop;
  return d;
end;
$$;

create or replace function public.current_week_start(g text) returns date
language sql stable security definer set search_path = public as $$
  select public.current_trading_day(g) - (extract(isodow from public.current_trading_day(g))::int - 1);
$$;

-- A random join code like K7P2-QX9M (no 0/O/1/I so it's easy to type).
create or replace function public.random_code() returns text
language plpgsql volatile as $$
declare
  abc text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b bytea := uuid_send(gen_random_uuid()); out text := ''; i int;
begin
  for i in 0..7 loop
    out := out || substr(abc, 1 + (get_byte(b, i) % 32), 1);
    if i = 3 then out := out || '-'; end if;
  end loop;
  return out;
end;
$$;

-- ================================================================ automatic fields

-- A tick / reflection always belongs to the group of its member; nobody can file it under another group.
create or replace function public.set_row_group() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.group_id := public.member_group(new.member_key);
  return new;
end;
$$;
create trigger ticks_0_set_group before insert or update on public.ticks
  for each row execute function public.set_row_group();
create trigger reflections_0_set_group before insert or update on public.reflections
  for each row execute function public.set_row_group();

-- Only the group's managers (owner / admins / app owner) can excuse a day.
create or replace function public.protect_excused() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage(new.group_id) then
    if tg_op = 'INSERT' then new.excused := false; else new.excused := old.excused; end if;
  end if;
  return new;
end;
$$;

-- Members: a name can't be moved to another group or get a new key (keys are in picture file paths).
create or replace function public.protect_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- pg_trigger_depth() > 1: changed by the automatic picture sync, not by a person.
  if not public.is_admin() and pg_trigger_depth() <= 1 then
    new.key := old.key;
    new.group_id := old.group_id;
    new.avatar_url := old.avatar_url;
  end if;
  return new;
end;
$$;
create trigger members_protect before update on public.members
  for each row execute function public.protect_member();

-- New names never come with a picture; it's copied from Discord when someone is approved for that name.
create or replace function public.member_no_avatar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() and pg_trigger_depth() <= 1 then new.avatar_url := null; end if;
  return new;
end;
$$;
create trigger members_no_avatar before insert on public.members
  for each row execute function public.member_no_avatar();

-- Groups: only the app owner changes who owns a group, pauses it, or renames its id.
create or replace function public.protect_group() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    new.id := old.id;
    new.owner_id := old.owner_id;
    new.status := old.status;
    new.created_at := old.created_at;
  end if;
  perform now() at time zone new.timezone;   -- refuses a time zone that doesn't exist
  return new;
end;
$$;
create trigger groups_protect before update on public.groups
  for each row execute function public.protect_group();

-- Memberships: nobody approves themselves; only the group owner hands out or takes away "group admin";
-- nobody but the app owner touches the group owner's own membership; a name must belong to that group.
create or replace function public.protect_membership() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  owner uuid := (select owner_id from public.groups where id = coalesce(old.group_id, new.group_id));
begin
  if tg_op = 'DELETE' then
    if public.is_admin() then return old; end if;
    if old.user_id = owner then raise exception 'The group owner can''t be removed from their own group.'; end if;
    if old.role = 'admin' and old.user_id <> auth.uid() and not public.is_group_owner(old.group_id) then
      raise exception 'Only the group owner can remove a group admin.';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and not public.is_admin() then
    new.group_id := old.group_id;
    new.user_id := old.user_id;
    new.created_at := old.created_at;
    if not public.is_group_owner(old.group_id) then
      new.role := old.role;
      if old.role = 'admin' and old.user_id <> auth.uid() then
        new.status := old.status; new.member_key := old.member_key;   -- admins can't kick out other admins
      end if;
      if old.user_id = auth.uid() then new.status := old.status; new.member_key := old.member_key; end if;
    end if;
    if old.user_id = owner and auth.uid() <> owner then
      new.status := old.status; new.role := old.role; new.member_key := old.member_key;
    end if;
  end if;
  if new.member_key is not null and not exists (select 1 from public.members where key = new.member_key and group_id = new.group_id) then
    raise exception 'That name isn''t in this group.';
  end if;
  if new.status <> 'approved' then new.role := 'member'; end if;
  return new;
end;
$$;
create trigger memberships_protect before insert or update or delete on public.memberships
  for each row execute function public.protect_membership();

-- Discord pictures: a name shows the picture of whoever is approved for it.
create or replace function public.sync_member_avatar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.member_key is not null then
    update public.members set avatar_url = null where key = old.member_key;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.status = 'approved' and new.member_key is not null then
    update public.members set avatar_url = (select avatar_url from public.profiles where user_id = new.user_id) where key = new.member_key;
  end if;
  return null;
end;
$$;
create trigger memberships_sync_avatar after insert or update of status, member_key or delete on public.memberships
  for each row execute function public.sync_member_avatar();

create or replace function public.profile_avatar_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.members set avatar_url = new.avatar_url
  where key in (select member_key from public.memberships where user_id = new.user_id and status = 'approved' and member_key is not null);
  return null;
end;
$$;
create trigger profiles_avatar_changed after update of avatar_url on public.profiles
  for each row execute function public.profile_avatar_changed();

-- ================================================================ actions the website calls

-- Make a group. Its owner gets a name in it (their Discord name) and is approved as group admin.
create or replace function public.make_group(group_name text, owner uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  base text := trim(both '-' from left(regexp_replace(lower(group_name), '[^a-z0-9]+', '-', 'g'), 30));
  gid text; mkey text; code text; dname text;
begin
  if char_length(base) < 2 then base := 'group'; end if;
  gid := base;
  while exists (select 1 from public.groups where id = gid) loop
    gid := base || '-' || lower(substr(public.random_code(), 1, 4));
  end loop;
  loop
    code := public.random_code();
    exit when not exists (select 1 from public.groups where join_code = code);
  end loop;
  insert into public.groups (id, name, join_code, owner_id, boxes) values (gid, left(trim(group_name), 40), code, owner,
    '{"chart":   {"label": "Chart with execution", "kind": "req"},
      "journal": {"label": "Journal", "kind": "req"},
      "review":  {"label": "HTF", "kind": "req"},
      "social":  {"label": "Social", "kind": "bonus"},
      "box5":    {"label": "Extra 1", "kind": "off"},
      "box6":    {"label": "Extra 2", "kind": "off"}}');
  dname := coalesce(nullif(regexp_replace((select discord_name from public.profiles where user_id = owner), '[<>]', '', 'g'), ''), 'Owner');
  mkey := left(regexp_replace(lower(dname), '[^a-z0-9]+', '-', 'g'), 20) || '-' || lower(substr(public.random_code(), 6, 4));
  mkey := trim(both '-' from mkey);
  insert into public.members (key, name, sort, group_id) values (mkey, left(dname, 40), 1, gid);
  insert into public.memberships (group_id, user_id, status, role, member_key) values (gid, owner, 'approved', 'admin', mkey)
    on conflict (group_id, user_id) do update set status = 'approved', role = 'admin', member_key = excluded.member_key;
  return gid;
end;
$$;
revoke execute on function public.make_group(text, uuid) from public, anon, authenticated;

-- App owner: create a group you own yourself.
create or replace function public.create_group(group_name text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only the app owner can create groups.'; end if;
  if char_length(trim(coalesce(group_name, ''))) = 0 or group_name ~ '[<>]' then raise exception 'Give the group a name.'; end if;
  return public.make_group(group_name, auth.uid());
end;
$$;

-- App owner: approve a request. The person who asked becomes the owner of the new group.
create or replace function public.approve_group_request(request_id bigint) returns text
language plpgsql security definer set search_path = public as $$
declare r public.group_requests; gid text;
begin
  if not public.is_admin() then raise exception 'Only the app owner can approve group requests.'; end if;
  select * into r from public.group_requests where id = request_id and status = 'pending' for update;
  if r.id is null then raise exception 'That request is already handled.'; end if;
  gid := public.make_group(r.name, r.user_id);
  update public.group_requests set status = 'approved' where id = request_id;
  return gid;
end;
$$;

-- Anyone signed in: type a join code. Puts you on that group's waiting list (or tells you you're already in).
create or replace function public.join_group(code text) returns json
language plpgsql security definer set search_path = public as $$
declare
  c text := upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g'));
  g public.groups; m public.memberships;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if char_length(c) = 8 then c := substr(c, 1, 4) || '-' || substr(c, 5, 4); end if;
  select * into g from public.groups where join_code = c and status = 'active';
  if g.id is null then raise exception 'That code doesn''t work. Check it with the group owner.'; end if;
  select * into m from public.memberships where group_id = g.id and user_id = auth.uid();
  if m.group_id is null then
    if (select count(*) from public.memberships where user_id = auth.uid()) >= 10 then
      raise exception 'You''re already in 10 groups.';
    end if;
    insert into public.memberships (group_id, user_id) values (g.id, auth.uid()) returning * into m;
  end if;
  return json_build_object('id', g.id, 'name', g.name, 'status', m.status);
end;
$$;

-- Group owner: a fresh join code. The old one stops working right away.
create or replace function public.new_join_code(g text) returns text
language plpgsql security definer set search_path = public as $$
declare code text;
begin
  if not public.is_group_owner(g) then raise exception 'Only the group owner can change the join code.'; end if;
  loop
    code := public.random_code();
    exit when not exists (select 1 from public.groups where join_code = code);
  end loop;
  update public.groups set join_code = code where id = g;
  return code;
end;
$$;

-- Managers: add a name to the group (the key is made here so it never clashes with another group's).
create or replace function public.add_member(g text, member_name text) returns text
language plpgsql security definer set search_path = public as $$
declare k text; n text := left(trim(regexp_replace(coalesce(member_name, ''), '[<>]', '', 'g')), 40);
begin
  if not public.can_manage(g) then raise exception 'Only the group owner or a group admin can add names.'; end if;
  if n = '' then raise exception 'Type a name.'; end if;
  loop
    k := trim(both '-' from left(regexp_replace(lower(n), '[^a-z0-9]+', '-', 'g'), 20)) || '-' || lower(substr(public.random_code(), 6, 4));
    k := trim(both '-' from k);
    exit when not exists (select 1 from public.members where key = k);
  end loop;
  insert into public.members (key, name, sort, group_id)
  values (k, n, coalesce((select max(sort) from public.members where group_id = g), 0) + 1, g);
  return k;
end;
$$;

revoke execute on function public.set_row_group(), public.protect_excused(), public.protect_member(), public.member_no_avatar(),
  public.protect_group(), public.protect_membership(), public.sync_member_avatar(), public.profile_avatar_changed()
  from public, anon, authenticated;
revoke execute on function public.create_group(text), public.approve_group_request(bigint), public.join_group(text),
  public.new_join_code(text), public.add_member(text, text) from public, anon;
grant execute on function public.create_group(text), public.approve_group_request(bigint), public.join_group(text),
  public.new_join_code(text), public.add_member(text, text) to authenticated;

-- ================================================================ access rules (row level security)

alter table public.groups enable row level security;
alter table public.memberships enable row level security;
alter table public.group_requests enable row level security;

-- groups: you see groups you're in or waiting for; the owner changes settings; only the app owner adds or deletes.
create policy groups_read on public.groups for select to authenticated using (
  public.in_group(id) or exists (select 1 from public.memberships m where m.group_id = id and m.user_id = auth.uid()));
create policy groups_update on public.groups for update to authenticated
  using (public.is_group_owner(id)) with check (public.is_group_owner(id));
create policy groups_admin_insert on public.groups for insert to authenticated with check (public.is_admin());
create policy groups_admin_delete on public.groups for delete to authenticated using (public.is_admin());

-- memberships: you see your own; managers see their group's. Joining only through a join code.
create policy memberships_read on public.memberships for select to authenticated
  using (user_id = auth.uid() or public.can_manage(group_id));
create policy memberships_manage on public.memberships for update to authenticated
  using (public.can_manage(group_id)) with check (public.can_manage(group_id));
create policy memberships_delete on public.memberships for delete to authenticated
  using (user_id = auth.uid() or public.can_manage(group_id));

-- group requests: you ask for yourself (max 3 waiting); only the app owner sees all and decides.
create or replace function public.my_open_requests() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.group_requests where user_id = auth.uid() and status = 'pending';
$$;
create policy requests_read on public.group_requests for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy requests_insert on public.group_requests for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending' and public.my_open_requests() < 3);
create policy requests_admin on public.group_requests for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy requests_delete on public.group_requests for delete to authenticated using (public.is_admin() or (user_id = auth.uid() and status = 'pending'));

-- profiles (Discord name + picture): your own; group managers see the people in their group; the app owner sees all.
create policy profiles_read on public.profiles for select to authenticated using (
  user_id = auth.uid() or public.is_admin()
  or exists (select 1 from public.memberships m where m.user_id = profiles.user_id and public.can_manage(m.group_id)));
create policy profiles_admin_del on public.profiles for delete to authenticated using (public.is_admin());

-- members (the names in a group)
create policy members_read on public.members for select to authenticated using (public.in_group(group_id));
create policy members_insert on public.members for insert to authenticated with check (public.can_manage(group_id));
create policy members_update on public.members for update to authenticated
  using (public.can_manage(group_id)) with check (public.can_manage(group_id));
create policy members_delete on public.members for delete to authenticated using (public.is_admin());

-- holidays: the same market calendar for everyone; only the app owner changes it.
create policy holidays_read on public.holidays for select to authenticated using (true);
create policy holidays_write on public.holidays for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ticks: your group reads; you write only your own row on your group's open day; managers fix anything in their group.
create policy ticks_read on public.ticks for select to authenticated using (public.in_group(group_id));
create policy ticks_insert on public.ticks for insert to authenticated with check (
  public.can_manage(group_id)
  or (public.group_open(group_id) and member_key = public.my_key(group_id) and day = public.current_trading_day(group_id)));
create policy ticks_update on public.ticks for update to authenticated
  using (public.can_manage(group_id)
         or (public.group_open(group_id) and member_key = public.my_key(group_id) and day = public.current_trading_day(group_id)))
  with check (public.can_manage(group_id)
         or (public.group_open(group_id) and member_key = public.my_key(group_id) and day = public.current_trading_day(group_id)));
create policy ticks_delete on public.ticks for delete to authenticated using (public.can_manage(group_id));

-- reflections: same idea, for the current week.
create policy reflections_read on public.reflections for select to authenticated using (public.in_group(group_id));
create policy reflections_insert on public.reflections for insert to authenticated with check (
  public.can_manage(group_id)
  or (public.group_open(group_id) and member_key = public.my_key(group_id) and week_start = public.current_week_start(group_id)));
create policy reflections_update on public.reflections for update to authenticated
  using (public.can_manage(group_id)
         or (public.group_open(group_id) and member_key = public.my_key(group_id) and week_start = public.current_week_start(group_id)))
  with check (public.can_manage(group_id)
         or (public.group_open(group_id) and member_key = public.my_key(group_id) and week_start = public.current_week_start(group_id)));
create policy reflections_delete on public.reflections for delete to authenticated using (public.can_manage(group_id));

-- screenshots: files are <day>/<member>/<time>.jpg; the member decides which group they belong to.
create or replace function public.can_write_screenshot(path text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  parts text[] := storage.foldername(path);
  g text;
begin
  if path !~ '^\d{4}-\d{2}-\d{2}/[a-z0-9_-]+/[0-9]+\.(jpg|png|webp)$' then return false; end if;
  g := public.member_group(parts[2]);
  if g is null then return false; end if;
  return public.can_manage(g)
      or (public.group_open(g) and parts[2] = public.my_key(g) and parts[1] = public.current_trading_day(g)::text);
end;
$$;
create or replace function public.can_read_screenshot(path text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.in_group(public.member_group((storage.foldername(path))[2]));
$$;
create policy screenshots_read on storage.objects for select to authenticated
  using (bucket_id = 'screenshots' and public.can_read_screenshot(name));
create policy screenshots_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'screenshots' and public.can_write_screenshot(name));
create policy screenshots_delete on storage.objects for delete to authenticated
  using (bucket_id = 'screenshots' and public.can_write_screenshot(name));

-- group logos: a small public picture per group, files are <group>/<time>.jpg; only the group owner uploads.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', true, 1048576, array['image/jpeg'])
on conflict (id) do nothing;
create or replace function public.can_write_logo(path text) returns boolean
language sql stable security definer set search_path = public as $$
  select path ~ '^[a-z0-9-]{2,40}/[0-9]{1,20}\.jpg$' and public.is_group_owner((storage.foldername(path))[1]);
$$;
create policy logos_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'logos' and public.can_write_logo(name));
create policy logos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'logos' and public.can_write_logo(name));

-- Permissions for the website's key. Signed-out visitors ("anon") get nothing.
revoke all on public.groups, public.memberships, public.group_requests from anon;
grant select, insert, update, delete on public.groups to authenticated;
grant select, update, delete on public.memberships to authenticated;
grant select, insert, update, delete on public.group_requests to authenticated;
grant select, delete on public.profiles to authenticated;
revoke update on public.profiles from authenticated;

-- Live updates for the new tables too.
alter publication supabase_realtime add table public.memberships;
