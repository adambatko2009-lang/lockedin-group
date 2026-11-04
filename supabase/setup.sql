-- MNQ Homework Tracker: database setup.
-- Paste this whole file into Supabase > SQL Editor > New query, then click Run. Run it once.
--
-- Who can do what (enforced here in the database, not just in the website):
--   * Not signed in ............ nothing at all
--   * Signed in, not approved .. can only see their own "waiting for approval" record
--   * Approved member .......... can see everything, can tick ONLY their own row, ONLY on the open trading day
--   * Admin (you) .............. can do everything: approve people, edit members, edit any tick on any day

-- ---------------------------------------------------------------- tables

create table public.members (
  key        text primary key check (key ~ '^[a-z0-9_-]{1,32}$'),
  name       text not null check (char_length(name) between 1 and 40),
  sort       int  not null default 0,
  active     boolean not null default true
);

create table public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  discord_name text not null default '',
  avatar_url   text,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  member_key   text references public.members (key) on update cascade on delete set null,
  created_at   timestamptz not null default now()
);
-- One Discord account per member name.
create unique index profiles_one_account_per_member on public.profiles (member_key) where member_key is not null;

create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create table public.holidays (
  day date primary key
);

create table public.ticks (
  day        date not null,
  member_key text not null references public.members (key) on update cascade on delete cascade,
  chart      boolean not null default false,
  journal    boolean not null default false,
  review     boolean not null default false,
  social     boolean not null default false,
  note       text not null default '' check (char_length(note) <= 140),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (day, member_key)
);

-- ---------------------------------------------------------------- helper functions
-- "security definer" lets these read the tables they check without being blocked by the rules below.

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public.is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where user_id = auth.uid() and status = 'approved');
$$;

create or replace function public.my_member_key() returns text
language sql stable security definer set search_path = public as $$
  select member_key from public.profiles where user_id = auth.uid() and status = 'approved';
$$;

-- The trading day whose homework window is open right now:
-- it opens 09:00 New York time and stays open until 09:00 on the next trading day.
create or replace function public.current_trading_day() returns date
language plpgsql stable security definer set search_path = public as $$
declare
  d date := ((now() at time zone 'America/New_York') - interval '9 hours')::date;
begin
  while extract(isodow from d) > 5 or exists (select 1 from public.holidays h where h.day = d) loop
    d := d - 1;
  end loop;
  return d;
end;
$$;

-- When someone signs in with Discord for the first time, create their "waiting for approval" record.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, discord_name, avatar_url)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data -> 'custom_claims' ->> 'global_name',
                  new.raw_user_meta_data ->> 'full_name',
                  new.raw_user_meta_data ->> 'name', 'Unknown'), 64),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Always record who changed a tick and when; nobody can fake these two columns.
create or replace function public.stamp_tick() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

create trigger ticks_stamp
  before insert or update on public.ticks
  for each row execute function public.stamp_tick();

-- ---------------------------------------------------------------- access rules (row level security)

alter table public.members  enable row level security;
alter table public.profiles enable row level security;
alter table public.admins   enable row level security;
alter table public.holidays enable row level security;
alter table public.ticks    enable row level security;

-- members: approved people read, only admin changes
create policy members_read  on public.members for select to authenticated using (public.is_approved() or public.is_admin());
create policy members_write on public.members for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- profiles: you see your own; admin sees and changes all. Nobody can approve themselves.
create policy profiles_read_own on public.profiles for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy profiles_admin    on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy profiles_admin_del on public.profiles for delete to authenticated using (public.is_admin());

-- admins: you can check whether you are one; nobody can add admins from the website
create policy admins_read_own on public.admins for select to authenticated using (user_id = auth.uid());

-- holidays: approved people read, only admin changes
create policy holidays_read  on public.holidays for select to authenticated using (public.is_approved() or public.is_admin());
create policy holidays_write on public.holidays for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- ticks: approved people read all; members write only their own row on the open day; admin writes anything
create policy ticks_read on public.ticks for select to authenticated using (public.is_approved() or public.is_admin());
create policy ticks_insert on public.ticks for insert to authenticated with check (
  public.is_admin()
  or (member_key = public.my_member_key() and day = public.current_trading_day())
);
create policy ticks_update on public.ticks for update to authenticated
  using (public.is_admin() or (member_key = public.my_member_key() and day = public.current_trading_day()))
  with check (public.is_admin() or (member_key = public.my_member_key() and day = public.current_trading_day()));
create policy ticks_delete on public.ticks for delete to authenticated using (public.is_admin());

-- Permissions for the website's key. Signed-out visitors ("anon") get nothing.
revoke all on public.members, public.profiles, public.admins, public.holidays, public.ticks from anon;
grant select, insert, update, delete on public.members, public.holidays, public.ticks to authenticated;
grant select, update, delete on public.profiles to authenticated;
grant select on public.admins to authenticated;
revoke execute on function public.handle_new_user(), public.stamp_tick() from public, anon, authenticated;

-- Live updates: the website refreshes instantly when anyone ticks.
alter publication supabase_realtime add table public.ticks;

-- ---------------------------------------------------------------- starting data

insert into public.members (key, name, sort) values
  ('batko', 'Batko', 1), ('sg', 'Sg', 2), ('soloban', 'Soloban', 3), ('eddie', 'Eddie', 4),
  ('jaybo', 'JayBo', 5), ('justin', 'Justin Bieber', 6), ('sid', 'sidleepy', 7);

insert into public.holidays (day) values
  ('2026-11-26'), ('2026-12-25'), ('2027-01-01'), ('2027-01-18'), ('2027-02-15'), ('2027-03-26'),
  ('2027-05-31'), ('2027-06-18'), ('2027-07-05'), ('2027-09-06'), ('2027-11-25'), ('2027-12-24');
