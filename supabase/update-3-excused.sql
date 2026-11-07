-- Update 3: excused days.
-- Run ONCE in Supabase > SQL Editor > New query > paste > Run (after the earlier updates).
--
-- An excused day (sick, travelling...) doesn't count as missed, doesn't break a streak and gives no points.
-- Only the admin can excuse someone; members can't excuse themselves, even by calling the database directly.

alter table public.ticks add column excused boolean not null default false;

-- If someone who isn't the admin saves a row, keep "excused" exactly as it was.
create or replace function public.protect_excused() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    if tg_op = 'INSERT' then
      new.excused := false;
    else
      new.excused := old.excused;
    end if;
  end if;
  return new;
end;
$$;

create trigger ticks_protect_excused
  before insert or update on public.ticks
  for each row execute function public.protect_excused();

revoke execute on function public.protect_excused() from public, anon, authenticated;
