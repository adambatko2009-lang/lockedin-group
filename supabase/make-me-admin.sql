-- Run this ONCE, right after you (Batko) have signed in to the website for the first time.
-- It makes the first account that ever signed in the admin, and links it to the name "Batko".
-- Supabase > SQL Editor > New query > paste > Run.

insert into public.admins (user_id)
select id from auth.users order by created_at limit 1
on conflict do nothing;

update public.profiles
set status = 'approved', member_key = 'batko'
where user_id = (select id from auth.users order by created_at limit 1);

-- Check: this should show exactly one row, with your Discord name.
select p.discord_name, p.status, p.member_key
from public.admins a join public.profiles p on p.user_id = a.user_id;
