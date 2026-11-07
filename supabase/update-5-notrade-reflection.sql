-- Update 5: no-trade days and weekly reflections.
-- Run ONCE in Supabase > SQL Editor > New query > paste > Run (after the earlier updates).

-- ---------------------------------------------------------------- no-trade day
-- "I sat out, no setup": that day the chart isn't required (journal + HTF still are).
-- Members set it on their own row like any other box, so the existing tick rules apply.
alter table public.ticks add column no_trade boolean not null default false;

-- ---------------------------------------------------------------- weekly reflection
create table public.reflections (
  week_start date not null check (extract(isodow from week_start) = 1),   -- always a Monday
  member_key text not null references public.members (key) on update cascade on delete cascade,
  went_well  text not null default '' check (char_length(went_well) <= 600),
  to_fix     text not null default '' check (char_length(to_fix) <= 600),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (week_start, member_key)
);

-- The Monday of the week whose trading day is open right now.
-- Friday's day stays open until Monday 09:00 New York, so reflections can be written over the weekend.
create or replace function public.current_week_start() returns date
language sql stable security definer set search_path = public as $$
  select public.current_trading_day() - (extract(isodow from public.current_trading_day())::int - 1);
$$;

create trigger reflections_stamp
  before insert or update on public.reflections
  for each row execute function public.stamp_tick();

alter table public.reflections enable row level security;

-- Approved members read everyone's; each writes only their own, only for the current week; admin anything.
create policy reflections_read on public.reflections for select to authenticated
  using (public.is_approved() or public.is_admin());
create policy reflections_insert on public.reflections for insert to authenticated with check (
  public.is_admin() or (member_key = public.my_member_key() and week_start = public.current_week_start()));
create policy reflections_update on public.reflections for update to authenticated
  using (public.is_admin() or (member_key = public.my_member_key() and week_start = public.current_week_start()))
  with check (public.is_admin() or (member_key = public.my_member_key() and week_start = public.current_week_start()));
create policy reflections_delete on public.reflections for delete to authenticated using (public.is_admin());

revoke all on public.reflections from anon;
grant select, insert, update, delete on public.reflections to authenticated;

alter publication supabase_realtime add table public.reflections;
