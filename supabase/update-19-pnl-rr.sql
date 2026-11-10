-- Update 19: P&L and R for each day. Both optional; members fill in their own, the group sees them.
-- Run ONCE in Supabase > SQL Editor > New query > paste > Run (after update 18), BEFORE pushing the website.
--
-- Members set these on their own row like any other box, so the existing tick rules (own row, open day only;
-- owner and admins anything) already apply. Nothing is removed. Safe to run again.

alter table public.ticks add column if not exists pnl numeric(12, 2);   -- dollars, e.g. 420.00 or -150.50
alter table public.ticks add column if not exists rr  numeric(6, 2);    -- R multiple, e.g. 2.10 or -1.00

alter table public.ticks drop constraint if exists ticks_pnl_range;
alter table public.ticks add constraint ticks_pnl_range check (pnl is null or pnl between -10000000 and 10000000);
alter table public.ticks drop constraint if exists ticks_rr_range;
alter table public.ticks add constraint ticks_rr_range check (rr is null or rr between -100 and 100);
