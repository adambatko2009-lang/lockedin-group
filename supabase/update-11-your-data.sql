-- Update 11: download your data, and delete your account (GDPR rights).
-- Run ONCE in Supabase > SQL Editor > New query > paste > Run (after update 10).
--
-- Settings > Your data > "Download my data" gives you a file with everything LockedIn stores about you.
-- Settings > Your data > "Delete my account" removes your account, your ticks, notes, reflections and pictures.

-- ================================================================ download
create or replace function public.export_my_data() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  keys text[];
begin
  if me is null then raise exception 'Sign in first'; end if;
  select coalesce(array_agg(member_key), '{}') into keys from public.memberships where user_id = me and member_key is not null;
  return jsonb_build_object(
    'exported_at', now(),
    'account', jsonb_build_object('user_id', me, 'email', (select email from auth.users where id = me)),
    'profile', (select to_jsonb(p) from public.profiles p where p.user_id = me),
    'settings', (select to_jsonb(s) from public.user_settings s where s.user_id = me),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('group', g.name, 'status', m.status, 'role', m.role,
                         'name_in_group', mb.name, 'joined', m.created_at) order by m.created_at)
              from public.memberships m join public.groups g on g.id = m.group_id
              left join public.members mb on mb.key = m.member_key
              where m.user_id = me), '[]'),
    'groups_you_own', coalesce((select jsonb_agg(g.name) from public.groups g where g.owner_id = me), '[]'),
    'ticks', coalesce((select jsonb_agg(to_jsonb(t) - 'updated_by' order by t.day) from public.ticks t where t.member_key = any(keys)), '[]'),
    'reflections', coalesce((select jsonb_agg(to_jsonb(r) order by r.week_start) from public.reflections r where r.member_key = any(keys)), '[]'),
    'group_requests', coalesce((select jsonb_agg(to_jsonb(q)) from public.group_requests q where q.user_id = me), '[]'),
    'reminder_devices', coalesce((select jsonb_agg(jsonb_build_object('minutes_before', s.minutes_before, 'added', s.created_at))
              from public.push_subscriptions s where s.user_id = me), '[]')
  );
end;
$$;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

-- ================================================================ delete
-- Your picture files, so the website can delete them before your account goes.
create or replace function public.my_screenshot_paths() returns setof text
language sql stable security definer set search_path = public as $$
  select distinct unnest(t.images) from public.ticks t
  where t.member_key in (select member_key from public.memberships where user_id = auth.uid() and member_key is not null);
$$;
revoke all on function public.my_screenshot_paths() from public, anon;
grant execute on function public.my_screenshot_paths() to authenticated;

-- You may delete your own picture files from any day (normally only today's), for deleting your account.
drop policy if exists screenshots_delete_own on storage.objects;
create policy screenshots_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'screenshots' and (storage.foldername(name))[2] in
         (select member_key from public.memberships where user_id = auth.uid() and member_key is not null));

create or replace function public.delete_my_account() returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  keys text[];
begin
  if me is null then raise exception 'Sign in first'; end if;
  if exists (select 1 from public.admins where user_id = me) then
    raise exception 'The app owner account can''t be deleted from the app.';
  end if;
  if exists (select 1 from public.groups where owner_id = me) then
    raise exception 'You own a group. Ask the app owner to give it a new owner or delete it first.';
  end if;
  select coalesce(array_agg(member_key), '{}') into keys from public.memberships where user_id = me and member_key is not null;
  delete from public.memberships where user_id = me;
  delete from public.ticks where member_key = any(keys);
  delete from public.reflections where member_key = any(keys);
  delete from public.members where key = any(keys);
  -- Removes the sign-in account; profile, settings, reminder devices and group requests go with it.
  delete from auth.users where id = me;
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
