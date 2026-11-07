-- Update 7: custom rule-break tags.
-- Run ONCE in Supabase > SQL Editor > New query > paste > Run (after update 6).
--
-- Members can now tag their day with their own words (e.g. "Traded the news") besides the 8 standard tags.
-- Limits: max 10 tags per day, each 1-30 characters, no < or > (so a tag can't sneak in web code).
-- Each person's own list of custom tags is kept in their settings (update 6), which only they can see or change.

create or replace function public.valid_rule_breaks(tags text[]) returns boolean
language sql immutable as $$
  select coalesce(bool_and(char_length(t) between 1 and 30 and t !~ '[<>]'), true) from unnest(tags) as t;
$$;

alter table public.ticks drop constraint if exists ticks_rule_breaks_check;
alter table public.ticks add constraint ticks_rule_breaks_valid
  check (cardinality(rule_breaks) <= 10 and public.valid_rule_breaks(rule_breaks));
