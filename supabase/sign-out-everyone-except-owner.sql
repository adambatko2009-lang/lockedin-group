-- Signs out every account except the app owner (you), on all their devices.
-- Run in Supabase > SQL Editor whenever you need it (for example after changing the Terms).
--
-- Only removes login sessions. Ticks, notes, pictures, streaks, groups and settings are NOT touched.
-- People stay signed in for at most 1 more hour (until their current login pass runs out), then they
-- see the front page and sign in again with Discord. Everything of theirs is still there.

delete from auth.sessions
where user_id not in (select user_id from public.admins);

-- Shows how many sessions are left (only yours should remain).
select count(*) as sessions_left, count(distinct user_id) as accounts_signed_in from auth.sessions;
