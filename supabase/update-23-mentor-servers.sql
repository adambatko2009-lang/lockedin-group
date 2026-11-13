-- Update 23: mentor servers. A mentor gets a "server" with its own code; group owners link their group to it,
-- and the mentor can then look at the boxes and streaks of every linked group. The mentor can't change anything.
-- Run ONCE in Supabase > SQL Editor > New query > paste > Run (after update 22). Then push the website.
-- Safe to run again.
--
-- Who can do what (enforced here in the database, not just in the website):
--   * App owner (you) ........ creates a server for someone, sees and deletes every server.
--   * Server owner (mentor) .. sees, for each linked group: its name, the members' names and pictures, and for
--                              every trading day whether each member was complete, partial, missed or excused.
--                              Never notes, pictures, P&L, R, comments, reactions or reflections. Can make a new
--                              server code and take a group off the server. Can't tick, edit or approve anything.
--   * Group owner ............ links their own group with the server code, and unlinks it again.
--   * Members ................ can see that their group is linked, and to which server.
--   * Other mentors .......... see only the groups linked to their own server.

-- ================================================================ tables

create table if not exists public.servers (
  id         bigint generated always as identity primary key,
  name       text not null check (char_length(name) between 1 and 40 and name !~ '[<>]'),
  owner_id   uuid not null references auth.users (id) on delete cascade,
  code       text not null unique check (code ~ '^[A-Z0-9]{4}-[A-Z0-9]{4}$'),
  created_at timestamptz not null default now()
);

-- Which group is on which server. A group is on one server at most.
create table if not exists public.server_groups (
  group_id  text primary key references public.groups (id) on update cascade on delete cascade,
  server_id bigint not null references public.servers (id) on delete cascade,
  linked_at timestamptz not null default now()
);
create index if not exists server_groups_server on public.server_groups (server_id);

-- Nobody reads or writes these tables directly. Everything goes through the functions below,
-- so there is no rule here that could be too wide.
alter table public.servers enable row level security;
alter table public.server_groups enable row level security;
revoke all on public.servers, public.server_groups from public, anon, authenticated;

-- ================================================================ helpers

-- The server's owner, or the app owner.
create or replace function public.owns_server(s bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (select 1 from public.servers where id = s and owner_id = auth.uid());
$$;

-- The last 90 trading days of a group, up to its open day.
create or replace function public.server_days(g text) returns table (day date)
language sql stable security definer set search_path = public as $$
  select d::date
  from generate_series(public.current_trading_day(g) - 125, public.current_trading_day(g), interval '1 day') d
  where extract(isodow from d) <= 5 and not exists (select 1 from public.holidays h where h.day = d::date)
  order by d desc limit 90;
$$;

-- ================================================================ app owner

-- App owner: make a server for someone who has signed in.
create or replace function public.create_server(server_name text, owner uuid) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  n text := left(trim(coalesce(server_name, '')), 40);
  c text; sid bigint;
begin
  if not public.is_admin() then raise exception 'Only the app owner can create servers.'; end if;
  if n = '' or n ~ '[<>]' then raise exception 'Give the server a name.'; end if;
  if not exists (select 1 from public.profiles where user_id = owner) then
    raise exception 'That person hasn''t signed in yet.';
  end if;
  loop
    c := public.random_code();
    exit when not exists (select 1 from public.servers where code = c);
  end loop;
  insert into public.servers (name, owner_id, code) values (n, owner, c) returning id into sid;
  return sid;
end;
$$;

-- App owner: delete a server. The groups on it are not touched, they are only taken off it.
create or replace function public.delete_server(s bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only the app owner can delete servers.'; end if;
  delete from public.servers where id = s;
end;
$$;

-- ================================================================ server owner

-- The servers you own (the app owner gets every server).
create or replace function public.my_servers() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name, 'code', s.code, 'mine', s.owner_id = auth.uid(),
      'owner', coalesce((select p.discord_name from public.profiles p where p.user_id = s.owner_id), ''),
      'groups', (select count(*) from public.server_groups x where x.server_id = s.id)) order by s.created_at), '[]'::jsonb)
  from public.servers s
  where auth.uid() is not null and (s.owner_id = auth.uid() or public.is_admin());
$$;

-- A fresh server code. The old one stops working for new groups; groups already linked stay linked.
create or replace function public.new_server_code(s bigint) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.owns_server(s) then raise exception 'Only the server owner can change the server code.'; end if;
  loop
    c := public.random_code();
    exit when not exists (select 1 from public.servers where code = c);
  end loop;
  update public.servers set code = c where id = s;
  if not found then raise exception 'That server doesn''t exist anymore.'; end if;
  return c;
end;
$$;

-- Everything the server owner may see: per linked group the trading days, and per member one mark per day.
--   c = complete, p = partial, n = a row with no required box ticked, x = excused, - = nothing logged.
-- Notes, pictures, P&L, R, comments, reactions and reflections are never part of this.
create or replace function public.server_overview(s bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare sv public.servers;
begin
  if auth.uid() is null or not public.owns_server(s) then raise exception 'Only the server owner can open this server.'; end if;
  select * into sv from public.servers where id = s;
  if sv.id is null then raise exception 'That server doesn''t exist anymore.'; end if;
  return jsonb_build_object(
    'id', sv.id, 'name', sv.name, 'code', sv.code,
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id, 'name', g.name, 'color', g.color, 'logo_path', g.logo_path, 'status', g.status,
        'today', to_char(public.current_trading_day(g.id), 'YYYY-MM-DD'),
        'days', coalesce((select jsonb_agg(to_char(d.day, 'YYYY-MM-DD') order by d.day) from public.server_days(g.id) d), '[]'::jsonb),
        'members', coalesce((
          select jsonb_agg(jsonb_build_object('name', m.name, 'avatar_url', m.avatar_url, 'marks', coalesce((
              select string_agg(case
                  when t.member_key is null then '-'
                  when t.excused then 'x'
                  when public.day_done(g.boxes, t) then 'c'
                  when exists (select 1 from unnest(array['chart','journal','review','social','box5','box6']) b
                               where g.boxes -> b ->> 'kind' = 'req' and coalesce((to_jsonb(t) ->> b)::boolean, false)) then 'p'
                  else 'n' end, '' order by d.day)
              from public.server_days(g.id) d
              left join public.ticks t on t.member_key = m.key and t.day = d.day), '')) order by m.sort, m.name)
          from public.members m where m.group_id = g.id and m.active), '[]'::jsonb)
      ) order by g.name)
      from public.server_groups x join public.groups g on g.id = x.group_id
      where x.server_id = s), '[]'::jsonb));
end;
$$;

-- ================================================================ group owner and members

-- Group owner: put the group on a server by typing the server's code. Returns the server's name.
create or replace function public.link_server(g text, code text) returns text
language plpgsql security definer set search_path = public as $$
declare
  c text := upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g'));
  sv public.servers;
begin
  if auth.uid() is null or not public.is_group_owner(g) then
    raise exception 'Only the group owner can link the group to a server.';
  end if;
  if char_length(c) = 8 then c := substr(c, 1, 4) || '-' || substr(c, 5, 4); end if;
  select * into sv from public.servers where servers.code = c;
  if sv.id is null then raise exception 'That server code doesn''t work. Check it with the server owner.'; end if;
  if (select count(*) from public.server_groups where server_id = sv.id and group_id <> g) >= 200 then
    raise exception 'That server is full.';
  end if;
  insert into public.server_groups (group_id, server_id) values (g, sv.id)
    on conflict (group_id) do update set server_id = excluded.server_id, linked_at = now();
  return sv.name;
end;
$$;

-- Take a group off its server: the group's owner, the server's owner, or the app owner.
create or replace function public.unlink_server(g text) returns void
language plpgsql security definer set search_path = public as $$
declare sid bigint := (select server_id from public.server_groups where group_id = g);
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if sid is null then return; end if;
  if not (public.owns_server(sid) or exists (select 1 from public.groups where id = g and owner_id = auth.uid())) then
    raise exception 'Only the group owner or the server owner can unlink a group.';
  end if;
  delete from public.server_groups where group_id = g;
end;
$$;

-- Everyone in a group can see which server it is on (its name only, never the code).
create or replace function public.group_server(g text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', s.id, 'name', s.name)
  from public.server_groups x join public.servers s on s.id = x.server_id
  where x.group_id = g and auth.uid() is not null and public.in_group(g);
$$;

-- ================================================================ your data
-- The download from Settings > Your data now also lists the servers you own.
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
    'servers_you_own', coalesce((select jsonb_agg(jsonb_build_object('server', s.name, 'created', s.created_at) order by s.created_at)
              from public.servers s where s.owner_id = me), '[]'),
    'ticks', coalesce((select jsonb_agg(to_jsonb(t) - 'updated_by' order by t.day) from public.ticks t where t.member_key = any(keys)), '[]'),
    'reflections', coalesce((select jsonb_agg(to_jsonb(r) order by r.week_start) from public.reflections r where r.member_key = any(keys)), '[]'),
    'group_requests', coalesce((select jsonb_agg(to_jsonb(q)) from public.group_requests q where q.user_id = me), '[]'),
    'reminder_devices', coalesce((select jsonb_agg(jsonb_build_object('minutes_before', s.minutes_before, 'added', s.created_at))
              from public.push_subscriptions s where s.user_id = me), '[]'),
    'reactions_you_gave', coalesce((select jsonb_agg(jsonb_build_object('day', x.day, 'to', mb.name, 'kind', x.kind) order by x.day)
              from public.reactions x left join public.members mb on mb.key = x.member_key where x.user_id = me), '[]'),
    'comments_you_wrote', coalesce((select jsonb_agg(jsonb_build_object('day', c.day, 'on_post_of', mb.name, 'comment', c.body, 'written', c.created_at) order by c.created_at)
              from public.comments c left join public.members mb on mb.key = c.member_key where c.user_id = me), '[]'),
    'reports_you_sent', coalesce((select jsonb_agg(jsonb_build_object('day', r.day, 'kind', r.kind, 'reason', r.reason, 'sent', r.created_at) order by r.created_at)
              from public.reports r where r.reporter_id = me), '[]')
  );
end;
$$;

-- ================================================================ who may call what
-- Signed-out visitors get nothing. server_days is only used inside server_overview.
revoke all on function public.owns_server(bigint), public.server_days(text), public.create_server(text, uuid),
  public.delete_server(bigint), public.my_servers(), public.new_server_code(bigint), public.server_overview(bigint),
  public.link_server(text, text), public.unlink_server(text), public.group_server(text), public.export_my_data()
  from public, anon, authenticated;
grant execute on function public.create_server(text, uuid), public.delete_server(bigint), public.my_servers(),
  public.new_server_code(bigint), public.server_overview(bigint), public.link_server(text, text),
  public.unlink_server(text), public.group_server(text), public.export_my_data() to authenticated;
