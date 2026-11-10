-- Update 18: names follow Discord. When someone changes their Discord name, their name in every group they're in
-- changes too, the next time they sign in. (Renaming by hand is gone from the app; the Discord name is the name.)
-- Run ONCE in Supabase > SQL Editor > New query > paste > Run (after update 17), BEFORE pushing the website.
--
-- Names people already have stay as they are until their Discord name changes.

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
