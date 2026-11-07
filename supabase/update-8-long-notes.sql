-- Update 8: long notes.
-- Run ONCE in Supabase > SQL Editor > New query > paste > Run (after the earlier updates).
--
-- Removes the old 140-character note limit. A very high safety cap (10,000 characters) stays,
-- only so an accidental giant paste can't bloat the database.

alter table public.ticks drop constraint if exists ticks_note_check;
alter table public.ticks add constraint ticks_note_length check (char_length(note) <= 10000);
