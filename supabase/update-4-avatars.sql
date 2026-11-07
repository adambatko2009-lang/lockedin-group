-- Update 4: Discord profile pictures.
-- Run ONCE in Supabase > SQL Editor > New query > paste > Run (after the earlier updates).
--
-- Each member name shows the Discord picture of the account approved for it.
-- It's copied automatically: when you approve someone, when they change it on Discord and sign in again,
-- and it's removed when you take their access away. Nobody can set a picture by hand.

alter table public.members add column avatar_url text;

-- Keep members.avatar_url in step with whoever is approved for that name.
create or replace function public.sync_member_avatar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.member_key is not null
     and (old.member_key is distinct from new.member_key or new.status <> 'approved') then
    update public.members set avatar_url = null where key = old.member_key;
  end if;
  if new.status = 'approved' and new.member_key is not null then
    update public.members set avatar_url = new.avatar_url where key = new.member_key;
  end if;
  return new;
end;
$$;

create trigger profiles_sync_avatar
  after insert or update of status, member_key, avatar_url on public.profiles
  for each row execute function public.sync_member_avatar();

-- Discord sends the latest picture and name every time someone signs in; copy them to their record.
create or replace function public.refresh_profile_from_discord() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles
  set avatar_url = new.raw_user_meta_data ->> 'avatar_url',
      discord_name = left(coalesce(new.raw_user_meta_data -> 'custom_claims' ->> 'global_name',
                                   new.raw_user_meta_data ->> 'full_name',
                                   new.raw_user_meta_data ->> 'name', discord_name), 64)
  where user_id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_updated
  after update of raw_user_meta_data on auth.users
  for each row execute function public.refresh_profile_from_discord();

revoke execute on function public.sync_member_avatar(), public.refresh_profile_from_discord() from public, anon, authenticated;

-- Fill in pictures for everyone who's already approved.
update public.members m
set avatar_url = p.avatar_url
from public.profiles p
where p.member_key = m.key and p.status = 'approved';
