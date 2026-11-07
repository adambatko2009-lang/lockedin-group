-- Update 6: rule-break tags and personal settings.
-- Run ONCE in Supabase > SQL Editor > New query > paste > Run (after the earlier updates).

-- ---------------------------------------------------------------- rule-break tags
-- Honest self-reporting: shown to the group, never costs points. Only these tags are allowed.
alter table public.ticks add column rule_breaks text[] not null default '{}'
  check (rule_breaks <@ array['moved_stop', 'revenge', 'oversized', 'fomo', 'no_plan', 'overtraded', 'early_exit', 'ignored_htf']::text[]);

-- ---------------------------------------------------------------- personal settings
-- One row per person (light/dark mode, confetti...). Everyone can only see and change their own.
create table public.user_settings (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  settings   jsonb not null default '{}' check (jsonb_typeof(settings) = 'object' and length(settings::text) <= 2000),
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;
create policy settings_own on public.user_settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.user_settings from anon;
grant select, insert, update, delete on public.user_settings to authenticated;
