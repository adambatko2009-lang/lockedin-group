-- Copies the ticks you made on the old claude.ai page into the new database.
-- Run ONCE, after setup.sql. Supabase > SQL Editor > New query > paste > Run.
-- Rows where nothing was ticked were left out, so those test days show as "Not logged" instead of "Missing".

insert into public.ticks (day, member_key, chart, journal, review, social, note) values
  ('2026-11-02', 'batko', true, true, true, true, ''),
  ('2026-11-02', 'eddie', false, true, false, false, ''),
  ('2026-11-02', 'justin', true, true, true, true, ''),
  ('2026-11-02', 'sg', false, true, true, false, ''),
  ('2026-11-02', 'sid', true, true, false, false, ''),
  ('2026-11-03', 'eddie', true, true, false, true, ''),
  ('2026-11-03', 'jaybo', true, true, true, false, ''),
  ('2026-11-03', 'sg', true, true, true, false, ''),
  ('2026-11-03', 'sid', true, true, true, false, ''),
  ('2026-11-03', 'soloban', true, false, false, false, '')
on conflict (day, member_key) do nothing;
