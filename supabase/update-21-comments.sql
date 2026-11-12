-- Update 21: comments and replies on someone's post (their note or pictures for a day).
-- Run ONCE in Supabase > SQL Editor > New query > paste > Run (after update 20), BEFORE pushing the website.
-- Safe to run again.
--
-- Who can do what:
--   read:    only people in the same group (members, the group owner, the app owner). Other groups never see them.
--   write:   approved members with a name in that group, only on a day that has a note or pictures, only as themselves.
--   delete:  your own comments; group owners and group admins can delete any comment in their group.
--   edit:    nobody. Delete and write it again.
--   report:  members can report someone else's comment, like a picture or note.

-- ================================================================ comments
create table if not exists public.comments (
  id          bigint generated always as identity primary key,
  group_id    text not null references public.groups (id) on update cascade on delete cascade,
  day         date not null,
  member_key  text not null references public.members (key) on update cascade on delete cascade,   -- whose post
  author_key  text not null references public.members (key) on update cascade on delete cascade,   -- who wrote it
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  reply_to    bigint references public.comments (id) on delete cascade,                            -- the comment it answers
  body        text not null check (char_length(btrim(body)) between 1 and 500),
  created_at  timestamptz not null default now()
);
create index if not exists comments_group_day on public.comments (group_id, day);
create index if not exists comments_reply_to on public.comments (reply_to);

-- The group, the author and the time are filled in by the database, never by the app.
create or replace function public.set_comment() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  parent public.comments;
begin
  new.group_id := public.member_group(new.member_key);
  new.author_key := public.my_key(new.group_id);
  new.user_id := auth.uid();
  new.created_at := now();
  new.body := btrim(coalesce(new.body, ''));
  if new.author_key is null then raise exception 'Only members with a name in this group can comment.'; end if;
  if not public.group_open(new.group_id) then raise exception 'This group is paused.'; end if;
  if not exists (select 1 from public.ticks t where t.day = new.day and t.member_key = new.member_key
                 and (coalesce(t.note, '') <> '' or cardinality(t.images) > 0)) then
    raise exception 'There''s nothing to comment on.';
  end if;
  if new.reply_to is not null then
    select * into parent from public.comments where id = new.reply_to;
    if parent.id is null or parent.day <> new.day or parent.member_key <> new.member_key then
      raise exception 'That comment doesn''t exist anymore.';
    end if;
    -- Replies stay one level deep: a reply to a reply answers the same first comment.
    new.reply_to := coalesce(parent.reply_to, parent.id);
  end if;
  if (select count(*) from public.comments where user_id = new.user_id and created_at > now() - interval '1 day') >= 200 then
    raise exception 'You''ve written a lot of comments today. Try again tomorrow.';
  end if;
  return new;
end;
$$;
drop trigger if exists comments_set on public.comments;
create trigger comments_set before insert on public.comments for each row execute function public.set_comment();
revoke execute on function public.set_comment() from public, anon, authenticated;

alter table public.comments enable row level security;
revoke all on public.comments from anon, authenticated;
grant select, insert, delete on public.comments to authenticated;
grant usage on sequence public.comments_id_seq to authenticated;
drop policy if exists comments_read on public.comments;
drop policy if exists comments_add on public.comments;
drop policy if exists comments_remove on public.comments;
create policy comments_read on public.comments for select to authenticated using (public.in_group(group_id));
create policy comments_add on public.comments for insert to authenticated with check (public.in_group(public.member_group(member_key)));
create policy comments_remove on public.comments for delete to authenticated using (user_id = auth.uid() or public.can_manage(group_id));

-- New comments show up for everyone in the group right away.
do $$ begin
  alter publication supabase_realtime add table public.comments;
exception when duplicate_object or undefined_object then null;
end $$;

-- ================================================================ reporting a comment
alter table public.reports drop constraint if exists reports_kind_check;
alter table public.reports add constraint reports_kind_check check (kind in ('picture', 'note', 'comment'));

-- For a comment: r_key is the person who wrote it, r_image is the comment's number.
create or replace function public.report_content(r_day date, r_key text, r_kind text, r_image text, r_reason text, r_detail text default '')
returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  g text := public.member_group(r_key);
  t public.ticks;
  c public.comments;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if g is null or not public.in_group(g) then raise exception 'You can only report things in your own group.'; end if;
  if r_key = public.my_key(g) then raise exception 'You can''t report your own post.'; end if;
  if r_kind not in ('picture', 'note', 'comment') then raise exception 'Unknown kind'; end if;
  if r_reason not in ('inappropriate', 'harassment', 'spam', 'other') then raise exception 'Pick a reason.'; end if;
  if r_kind = 'comment' then
    if coalesce(r_image, '') !~ '^[0-9]{1,18}$' then raise exception 'That comment doesn''t exist anymore.'; end if;
    select * into c from public.comments where id = r_image::bigint;
    if c.id is null or c.author_key <> r_key or c.group_id <> g then raise exception 'That comment doesn''t exist anymore.'; end if;
  else
    select * into t from public.ticks where day = r_day and member_key = r_key;
    if t.member_key is null then raise exception 'That post doesn''t exist anymore.'; end if;
    if r_kind = 'picture' and not (coalesce(r_image, '') = any (t.images)) then raise exception 'That picture doesn''t exist anymore.'; end if;
    if r_kind = 'note' and coalesce(t.note, '') = '' then raise exception 'That note doesn''t exist anymore.'; end if;
  end if;
  if (select count(*) from public.reports where reporter_id = auth.uid() and created_at > now() - interval '1 day') >= 20 then
    raise exception 'You''ve sent a lot of reports today. Try again tomorrow.';
  end if;
  insert into public.reports (group_id, day, member_key, kind, image, reason, detail, excerpt)
  values (g, case when r_kind = 'comment' then c.day else r_day end, r_key, r_kind,
          case when r_kind = 'picture' then r_image when r_kind = 'comment' then c.id::text else '' end, r_reason,
          left(regexp_replace(coalesce(r_detail, ''), '[<>]', '', 'g'), 300),
          case when r_kind = 'note' then left(t.note, 300) when r_kind = 'comment' then left(c.body, 300) else '' end)
  on conflict do nothing;
end;
$$;
revoke all on function public.report_content(date, text, text, text, text, text) from public, anon;
grant execute on function public.report_content(date, text, text, text, text, text) to authenticated;

-- ================================================================ owner notifications
-- Same as update 20, except a report can now also be about a comment.
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
      when 'report' then 'A member reported a picture, note or comment. Open Admin to look at it.'
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

-- ================================================================ your data
-- The download from Settings > Your data now also includes the comments you wrote.
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
              from public.push_subscriptions s where s.user_id = me), '[]'),
    'reactions_you_gave', coalesce((select jsonb_agg(jsonb_build_object('day', x.day, 'to', mb.name, 'kind', x.kind) order by x.day)
              from public.reactions x left join public.members mb on mb.key = x.member_key where x.user_id = me), '[]'),
    'comments_you_wrote', coalesce((select jsonb_agg(jsonb_build_object('day', c.day, 'on_post_of', mb.name, 'comment', c.body, 'written', c.created_at) order by c.created_at)
              from public.comments c left join public.members mb on mb.key = c.member_key where c.user_id = me), '[]'),
    'reports_you_sent', coalesce((select jsonb_agg(jsonb_build_object('day', r.day, 'kind', r.kind, 'reason', r.reason, 'sent', r.created_at) order by r.created_at)
              from public.reports r where r.reporter_id = me), '[]')
  );
end;
$$;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
