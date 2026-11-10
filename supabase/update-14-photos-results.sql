-- Update 14: up to 10 pictures per day, and a result for each day (win, loss or gamble).
-- Run ONCE in Supabase > SQL Editor > New query > paste > Run (after update 13), BEFORE pushing the website.
--
-- Nothing is removed. "No trade" keeps using the no_trade column from update 5.

-- ---------------------------------------------------------------- 10 pictures per day
alter table public.ticks drop constraint if exists ticks_images_check;
alter table public.ticks drop constraint if exists ticks_images_max;
alter table public.ticks add constraint ticks_images_max check (cardinality(images) <= 10);

-- ---------------------------------------------------------------- day result
-- Empty until the member picks one. Members set it on their own row like any other box,
-- so the existing tick rules (own row, open day only; admin anything) already apply.
alter table public.ticks add column if not exists result text
  check (result in ('win', 'loss', 'gamble'));

-- A day is either a no-trade day or has a result, never both.
update public.ticks set result = null where no_trade and result is not null;
alter table public.ticks drop constraint if exists ticks_result_or_no_trade;
alter table public.ticks add constraint ticks_result_or_no_trade check (not (no_trade and result is not null));
