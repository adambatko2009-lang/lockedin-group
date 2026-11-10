-- Update 17: approving someone is one tap. Their name in the group is made from their Discord name.
-- Run ONCE in Supabase > SQL Editor > New query > paste > Run (after update 16), BEFORE pushing the website.
--
-- Nothing changes for people already in a group. Owners can still rename anyone, or link someone to an existing name
-- (for example a name that already has history from before they had an account).

create or replace function public.approve_member(g text, uid uuid, existing_key text default null) returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  m public.memberships;
  base text; n text; k text; i int := 1;
begin
  if not public.can_manage(g) then raise exception 'Only the group owner or a group admin can approve people.'; end if;
  select * into m from public.memberships where group_id = g and user_id = uid for update;
  if m.user_id is null then raise exception 'That person isn''t waiting to join this group.'; end if;
  if m.status = 'approved' then raise exception 'They''re already in the group.'; end if;

  if existing_key is not null then
    -- Link to a name that's already in the group and not used by anyone else.
    if not exists (select 1 from public.members where key = existing_key and group_id = g and active) then
      raise exception 'That name isn''t in this group.';
    end if;
    if exists (select 1 from public.memberships where member_key = existing_key and status = 'approved') then
      raise exception 'Someone else already has that name.';
    end if;
    k := existing_key;
  else
    -- A new name from their Discord name. If it's taken in this group, add a number: "Alex 2".
    base := left(trim(regexp_replace(coalesce((select discord_name from public.profiles where user_id = uid), ''), '[<>]', '', 'g')), 36);
    if base = '' or base = 'Unknown' then base := 'Member'; end if;
    n := base;
    while exists (select 1 from public.members where group_id = g and active and lower(name) = lower(n)) loop
      i := i + 1;
      n := base || ' ' || i;
    end loop;
    k := public.add_member(g, n);
  end if;

  update public.memberships set status = 'approved', member_key = k where group_id = g and user_id = uid;
  return k;
end;
$$;
revoke all on function public.approve_member(text, uuid, text) from public, anon;
grant execute on function public.approve_member(text, uuid, text) to authenticated;

-- The join notification no longer says to give people a name.
create or replace function public.due_owner_alerts()
returns table (endpoint text, p256dh text, auth text, title text, body text, tag text)
language plpgsql volatile security definer set search_path = public as $$
begin
  delete from public.owner_alerts where sent_at < now() - interval '7 days';
  return query
  with fresh as (
    update public.owner_alerts a set sent_at = now()
    where a.sent_at is null
    returning a.user_id, a.group_id, a.kind, a.created_at
  ), grouped as (
    select f.user_id, f.group_id, f.kind, count(*)::int as n
    from fresh f where f.created_at > now() - interval '1 day'
    group by f.user_id, f.group_id, f.kind
  )
  select s.endpoint, s.p256dh, s.auth,
    case when g.kind = 'join'
      then case when g.n = 1 then 'Someone wants to join ' else g.n || ' people want to join ' end || gr.name
      else case when g.n = 1 then 'New report in ' else g.n || ' new reports in ' end || gr.name end,
    case when g.kind = 'join' then 'Open Admin to approve them. It''s one tap.'
      else 'A member reported a picture or note. Open Admin to look at it.' end,
    'owner-' || g.kind || '-' || g.group_id
  from grouped g
  join public.groups gr on gr.id = g.group_id
  join public.push_subscriptions s on s.user_id = g.user_id;
end;
$$;
revoke all on function public.due_owner_alerts() from public, anon, authenticated;
