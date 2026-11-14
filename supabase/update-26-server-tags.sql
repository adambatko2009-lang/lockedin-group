-- Update 26: server tags. A server gets a short tag (like BNQ). Someone who asks for a new group can type that tag,
-- and when the group is approved it is already on that server and its join code starts with the tag (BNQ-ABCD-1234).
-- Run ONCE in Supabase > SQL Editor > New query > paste > Run (after update 25). Then push the website.
-- Safe to run again.
--
-- Who can do what (enforced here in the database, not just in the website):
--   * App owner (you) ........ gives a server its tag, and still approves every new group.
--   * Anyone signed in ....... may name a server's tag when they ask for a group. A tag that doesn't exist is refused.
--                              Naming a tag shows them that server's name and nothing else.
--   * Server owner (mentor) .. sees a group that came in with the tag only after you approved it. Same view as
--                              before: names, boxes and streaks. Never notes, pictures or results.
--   * Groups that already exist keep their join code. Their owner can still link them with the server code.

-- ================================================================ tables

-- The tag: 2 to 5 capital letters or digits, and no two servers share one.
alter table public.servers add column if not exists tag text;
alter table public.servers drop constraint if exists servers_tag_format;
alter table public.servers add constraint servers_tag_format check (tag ~ '^[A-Z0-9]{2,5}$');
create unique index if not exists servers_tag on public.servers (tag);

-- A server whose name is already short enough (like BNQ) gets its name as its tag.
do $$
declare s record; t text;
begin
  for s in select id, name from public.servers where tag is null order by created_at, id loop
    t := upper(regexp_replace(s.name, '[^A-Za-z0-9]', '', 'g'));
    if t ~ '^[A-Z0-9]{2,5}$' and not exists (select 1 from public.servers where tag = t) then
      update public.servers set tag = t where id = s.id;
    end if;
  end loop;
end;
$$;

-- Which server a request for a new group named. Empty for a group that is not part of a server.
alter table public.group_requests add column if not exists server_id bigint references public.servers (id) on delete set null;

-- A join code may now start with a server tag: ABCD-1234 or BNQ-ABCD-1234.
alter table public.groups drop constraint if exists groups_join_code_check;
alter table public.groups drop constraint if exists groups_join_code_format;
alter table public.groups add constraint groups_join_code_format
  check (join_code ~ '^([A-Z0-9]{2,5}-)?[A-Z0-9]{4}-[A-Z0-9]{4}$');

-- A request written straight into the table can't name a server. Only request_group below can, after it has
-- checked the tag. (The old website writes requests this way, and that keeps working.)
drop policy if exists requests_insert on public.group_requests;
create policy requests_insert on public.group_requests for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending' and server_id is null and public.my_open_requests() < 3);

-- ================================================================ helpers

-- What the app owner typed as a tag, tidied up. Anything that isn't 2 to 5 letters or digits is refused.
create or replace function public.clean_server_tag(t text) returns text
language plpgsql immutable set search_path = public as $$
declare c text := upper(trim(coalesce(t, '')));
begin
  if c !~ '^[A-Z0-9]{2,5}$' then raise exception 'A server tag is 2 to 5 letters or digits, like BNQ.'; end if;
  return c;
end;
$$;

-- A join code nobody has yet. With a tag it starts with the tag.
create or replace function public.fresh_join_code(tag text) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  loop
    c := coalesce(tag || '-', '') || public.random_code();
    exit when not exists (select 1 from public.groups where join_code = c);
  end loop;
  return c;
end;
$$;

-- ================================================================ app owner

-- App owner: make a server with a tag for someone who has signed in.
create or replace function public.create_server(server_name text, owner uuid, server_tag text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  n text := left(trim(coalesce(server_name, '')), 40);
  t text; c text; sid bigint;
begin
  if not public.is_admin() then raise exception 'Only the app owner can create servers.'; end if;
  if n = '' or n ~ '[<>]' then raise exception 'Give the server a name.'; end if;
  t := public.clean_server_tag(server_tag);
  if exists (select 1 from public.servers where tag = t) then raise exception 'Another server already has the tag %.', t; end if;
  if not exists (select 1 from public.profiles where user_id = owner) then
    raise exception 'That person hasn''t signed in yet.';
  end if;
  loop
    c := public.random_code();
    exit when not exists (select 1 from public.servers where code = c);
  end loop;
  insert into public.servers (name, owner_id, code, tag) values (n, owner, c, t) returning id into sid;
  return sid;
end;
$$;

-- App owner: give a server its tag, or change it. Join codes that already exist keep the old start.
create or replace function public.set_server_tag(s bigint, server_tag text) returns text
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  if not public.is_admin() then raise exception 'Only the app owner can change a server tag.'; end if;
  t := public.clean_server_tag(server_tag);
  if exists (select 1 from public.servers where tag = t and id <> s) then raise exception 'Another server already has the tag %.', t; end if;
  update public.servers set tag = t where id = s;
  if not found then raise exception 'That server doesn''t exist anymore.'; end if;
  return t;
end;
$$;

-- App owner: approve a request. The person who asked becomes the owner of the new group. If the request named
-- a server, the group is put on it and its join code starts with the server's tag.
create or replace function public.approve_group_request(request_id bigint) returns text
language plpgsql security definer set search_path = public as $$
declare r public.group_requests; sv public.servers; gid text;
begin
  if not public.is_admin() then raise exception 'Only the app owner can approve group requests.'; end if;
  select * into r from public.group_requests where id = request_id and status = 'pending' for update;
  if r.id is null then raise exception 'That request is already handled.'; end if;
  gid := public.make_group(r.name, r.user_id);
  if r.server_id is not null then
    select * into sv from public.servers where id = r.server_id;
    if sv.id is not null then
      insert into public.server_groups (group_id, server_id) values (gid, sv.id)
        on conflict (group_id) do update set server_id = excluded.server_id, linked_at = now();
      if sv.tag is not null then
        update public.groups set join_code = public.fresh_join_code(sv.tag) where id = gid;
      end if;
    end if;
  end if;
  update public.group_requests set status = 'approved' where id = request_id;
  return gid;
end;
$$;

-- ================================================================ anyone signed in

-- Ask for a group of your own, with or without a server tag. Returns the server's name when a tag was given.
-- Same limits as before: your own name on it, and 3 waiting requests at most.
create or replace function public.request_group(group_name text, note text, server_tag text) returns text
language plpgsql security definer set search_path = public as $$
declare
  n text := left(trim(coalesce(group_name, '')), 40);
  t text := upper(trim(coalesce(server_tag, '')));
  sv public.servers;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if n = '' or n ~ '[<>]' then raise exception 'Give your group a name first.'; end if;
  if public.my_open_requests() >= 3 then raise exception 'You already have 3 requests waiting.'; end if;
  if t <> '' then
    select * into sv from public.servers where tag = t;
    if sv.id is null then raise exception 'No server has that tag. Check it with the server owner, or leave the field empty.'; end if;
  end if;
  insert into public.group_requests (user_id, name, note, server_id)
    values (auth.uid(), n, left(coalesce(note, ''), 300), sv.id);
  return sv.name;
end;
$$;

-- Anyone signed in: type a join code. Puts you on that group's waiting list (or tells you you're already in).
-- Now also reads a code with a server tag in front, typed with or without the dashes.
create or replace function public.join_group(code text) returns json
language plpgsql security definer set search_path = public as $$
declare
  c text := upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g'));
  n int;
  g public.groups; m public.memberships;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  n := char_length(c);
  if n = 8 then c := substr(c, 1, 4) || '-' || substr(c, 5, 4);
  elsif n between 10 and 13 then c := substr(c, 1, n - 8) || '-' || substr(c, n - 7, 4) || '-' || substr(c, n - 3, 4);
  end if;
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

-- ================================================================ group owner

-- Group owner: a fresh join code. The old one stops working right away. A group on a server with a tag
-- gets a code that starts with the tag.
create or replace function public.new_join_code(g text) returns text
language plpgsql security definer set search_path = public as $$
declare code text;
begin
  if not public.is_group_owner(g) then raise exception 'Only the group owner can change the join code.'; end if;
  code := public.fresh_join_code((select s.tag from public.server_groups x join public.servers s on s.id = x.server_id where x.group_id = g));
  update public.groups set join_code = code where id = g;
  return code;
end;
$$;

-- ================================================================ server owner

-- The servers you own (the app owner gets every server). Now with the tag.
create or replace function public.my_servers() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name, 'code', s.code, 'tag', s.tag, 'mine', s.owner_id = auth.uid(),
      'owner', coalesce((select p.discord_name from public.profiles p where p.user_id = s.owner_id), ''),
      'groups', (select count(*) from public.server_groups x where x.server_id = s.id)) order by s.created_at), '[]'::jsonb)
  from public.servers s
  where auth.uid() is not null and (s.owner_id = auth.uid() or public.is_admin());
$$;

-- Everything the server owner may see: per linked group the trading days, and per member one mark per day.
--   c = complete, p = partial, n = a row with no required box ticked, x = excused, - = nothing logged.
-- Notes, pictures, P&L, R, comments, reactions and reflections are never part of this. Now with the server's tag.
create or replace function public.server_overview(s bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare sv public.servers;
begin
  if auth.uid() is null or not public.owns_server(s) then raise exception 'Only the server owner can open this server.'; end if;
  select * into sv from public.servers where id = s;
  if sv.id is null then raise exception 'That server doesn''t exist anymore.'; end if;
  return jsonb_build_object(
    'id', sv.id, 'name', sv.name, 'code', sv.code, 'tag', sv.tag,
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

-- ================================================================ who may call what
-- Signed-out visitors get nothing. The two helpers are only used inside the functions above.
revoke all on function public.clean_server_tag(text), public.fresh_join_code(text), public.create_server(text, uuid, text),
  public.set_server_tag(bigint, text), public.request_group(text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_server(text, uuid, text), public.set_server_tag(bigint, text),
  public.request_group(text, text, text) to authenticated;
