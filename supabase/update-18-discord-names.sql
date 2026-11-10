-- Update 18: names follow Discord. When someone changes their Discord name, their name in every group they're in
-- changes too, the next time they sign in. (Renaming by hand is gone from the app; the Discord name is the name.)
-- Run ONCE in Supabase > SQL Editor > New query > paste > Run (after update 17), BEFORE pushing the website.
--
-- Everyone already in a group is switched to their Discord name once (see the end of this file).

-- A name that's free in a group: "Alex", or "Alex 2" if another active member already has it.
create or replace function public.free_member_name(g text, wanted text, except_key text default null) returns text
language plpgsql stable security definer set search_path = public as $$
declare base text; n text; i int := 1;
begin
  base := left(trim(regexp_replace(coalesce(wanted, ''), '[<>]', '', 'g')), 36);
  if base = '' or base = 'Unknown' then base := 'Member'; end if;
  n := base;
  while exists (select 1 from public.members where group_id = g and active and lower(name) = lower(n) and key is distinct from except_key) loop
    i := i + 1;
    n := base || ' ' || i;
  end loop;
  return n;
end;
$$;
revoke all on function public.free_member_name(text, text, text) from public, anon, authenticated;

create or replace function public.sync_member_name() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.discord_name is distinct from old.discord_name and trim(coalesce(new.discord_name, '')) not in ('', 'Unknown') then
    update public.members mb set name = public.free_member_name(mb.group_id, new.discord_name, mb.key)
    from public.memberships ms
    where ms.user_id = new.user_id and ms.status = 'approved' and ms.member_key = mb.key;
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_sync_name on public.profiles;
create trigger profiles_sync_name after update of discord_name on public.profiles
  for each row execute function public.sync_member_name();
revoke execute on function public.sync_member_name() from public, anon, authenticated;

-- ================================================================ one-time switch
-- Everyone already in a group gets their Discord name now. Names are first cleared to a placeholder, then handed out
-- in the order people joined, so the person who joined first keeps "Alex" and a later one gets "Alex 2".
-- Names with no account behind them, and people whose Discord name is unknown, keep their name. History isn't touched.
-- Safe to run again.
do $$
declare r record;
begin
  update public.members mb set name = '~' || mb.key
  from public.memberships ms join public.profiles p on p.user_id = ms.user_id
  where ms.status = 'approved' and ms.member_key = mb.key and mb.active
    and trim(coalesce(p.discord_name, '')) not in ('', 'Unknown');
  for r in
    select mb.key, mb.group_id, p.discord_name
    from public.members mb
    join public.memberships ms on ms.member_key = mb.key and ms.status = 'approved'
    join public.profiles p on p.user_id = ms.user_id
    where mb.name = '~' || mb.key
    order by ms.created_at, mb.key
  loop
    update public.members set name = public.free_member_name(r.group_id, r.discord_name, r.key) where key = r.key;
  end loop;
end;
$$;
