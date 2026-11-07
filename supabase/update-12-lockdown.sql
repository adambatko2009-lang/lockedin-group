-- Update 12: lock down the small helper functions.
-- Run ONCE in Supabase > SQL Editor > New query > paste > Run (after update 11).
--
-- The access rules use helper functions (like "is this person in this group?"). They can't change anything,
-- but signed-out visitors could call them to check whether a group or name exists. After this update only
-- signed-in people (and the database itself) can use them.

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('can_manage', 'can_read_screenshot', 'can_write_logo', 'can_write_screenshot',
                        'current_trading_day', 'current_week_start', 'group_open', 'in_group', 'is_admin',
                        'is_group_owner', 'member_group', 'my_key', 'my_open_requests')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end;
$$;
