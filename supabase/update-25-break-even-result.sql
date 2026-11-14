-- Update 25: a day's result can also be "break even" (next to win, loss and gamble).
-- Run ONCE in Supabase > SQL Editor > New query > paste > Run (after update 24). Then push the website.
-- Safe to run again.
--
-- Nothing is removed and no saved result changes. Only the list of allowed results gets one more word.
-- Who may change a result stays exactly as before: your own row, while the day is open.

alter table public.ticks drop constraint if exists ticks_result_check;
alter table public.ticks add constraint ticks_result_check
  check (result in ('win', 'loss', 'breakeven', 'gamble'));

select 'Update 25 done: break even is now an allowed result.' as result;
