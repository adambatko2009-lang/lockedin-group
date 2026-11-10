-- Update 20: the app owner gets a notification when someone asks to start a new group.
-- Run ONCE in Supabase > SQL Editor > New query > paste > Run (after update 19). No website push needed for this one.
-- Safe to run again.

-- A group request has no group yet, so alerts can now be without a group, and carry the requested name.
alter table public.owner_alerts alter column group_id drop not null;
alter table public.owner_alerts add column if not exists detail text check (char_length(detail) <= 60);
alter table public.owner_alerts drop constraint if exists owner_alerts_kind_check;
alter table public.owner_alerts add constraint owner_alerts_kind_check check (kind in ('join', 'report', 'request'));

create or replace function public.alert_group_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'pending' then
    insert into public.owner_alerts (user_id, group_id, kind, detail)
    select a.user_id, null, 'request', left(new.name, 60) from public.admins a
    where a.user_id is distinct from new.user_id;
  end if;
  return new;
end;
$$;
drop trigger if exists group_requests_alert on public.group_requests;
create trigger group_requests_alert after insert on public.group_requests
  for each row execute function public.alert_group_request();
revoke execute on function public.alert_group_request() from public, anon, authenticated;

create or replace function public.due_owner_alerts()
returns table (endpoint text, p256dh text, auth text, title text, body text, tag text)
language plpgsql volatile security definer set search_path = public as $$
begin
  delete from public.owner_alerts where sent_at < now() - interval '7 days';
  return query
  with fresh as (
    update public.owner_alerts a set sent_at = now()
    where a.sent_at is null
    returning a.user_id, a.group_id, a.kind, a.detail, a.created_at
  ), grouped as (
    select f.user_id, f.group_id, f.kind, count(*)::int as n, min(f.detail) as detail
    from fresh f where f.created_at > now() - interval '1 day'
    group by f.user_id, f.group_id, f.kind
  )
  select s.endpoint, s.p256dh, s.auth,
    case g.kind
      when 'join' then case when g.n = 1 then 'Someone wants to join ' else g.n || ' people want to join ' end || gr.name
      when 'report' then case when g.n = 1 then 'New report in ' else g.n || ' new reports in ' end || gr.name
      else case when g.n = 1 then 'New group request: ' || coalesce(g.detail, 'a new group') else g.n || ' new group requests' end
    end,
    case g.kind
      when 'join' then 'Open Admin to approve them. It''s one tap.'
      when 'report' then 'A member reported a picture or note. Open Admin to look at it.'
      else 'Open All groups to approve or reject it.'
    end,
    'owner-' || g.kind || '-' || coalesce(g.group_id, 'new')
  from grouped g
  left join public.groups gr on gr.id = g.group_id
  join public.push_subscriptions s on s.user_id = g.user_id
  where g.kind = 'request' or gr.id is not null;
end;
$$;
revoke all on function public.due_owner_alerts() from public, anon, authenticated;
