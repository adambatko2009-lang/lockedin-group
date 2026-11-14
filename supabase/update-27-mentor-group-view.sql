-- Update 27: a mentor can open a group that is on their server and look at it: the Today, Week and Ranking
-- screens with everyone's boxes. Looking only. Nothing here lets the mentor change anything.
-- Run ONCE in Supabase > SQL Editor > New query > paste > Run (after update 26). Then push the website.
-- Safe to run again.
--
-- Who can do what (enforced here in the database, not just in the website):
--   * Server owner (mentor) .. for a group on their own server: the group's name, color, logo, boxes, points, time zone
--                              and cutoff, the members' names and pictures, and for the last 90 trading days which
--                              boxes each member ticked and whether they were excused.
--                              Never notes, pictures, results, P&L, R, rule breaks, comments, reactions or reflections.
--                              Never the join code. The tables themselves stay closed to the mentor, so there is
--                              still no way for them to tick, edit or approve anything.
--   * App owner (you) ........ the same view, for a group on any server.
--   * Everyone else .......... refused: members, group owners, other mentors, signed-out visitors.
--   * A group that is on no server can't be opened this way by anyone.

-- ================================================================ the view

-- One linked group, for looking at. Each tick is a day plus seven digits: the six boxes in their fixed order
-- (chart, journal, review, social, box5, box6), then excused. 1 = yes, 0 = no.
create or replace function public.server_group_view(g text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  gr  public.groups;
  sid bigint;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select x.server_id into sid from public.server_groups x where x.group_id = g;
  -- The same answer whether the group doesn't exist, is on no server, or is on someone else's server.
  if sid is null or not public.owns_server(sid) then
    raise exception 'Only the owner of the server this group is on can open it.';
  end if;
  select * into gr from public.groups where id = g;
  return jsonb_build_object(
    'group', jsonb_build_object('id', gr.id, 'name', gr.name, 'color', gr.color, 'logo_path', gr.logo_path,
                                'status', gr.status, 'timezone', gr.timezone, 'cutoff_hour', gr.cutoff_hour,
                                'boxes', gr.boxes, 'points', gr.points),
    'server', (select jsonb_build_object('id', s.id, 'name', s.name) from public.servers s where s.id = sid),
    -- The open day and the last 90 trading days, worked out here so the website and the database agree.
    'today', to_char(public.current_trading_day(g), 'YYYY-MM-DD'),
    'days', coalesce((select jsonb_agg(to_char(d.day, 'YYYY-MM-DD') order by d.day) from public.server_days(g) d), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('name', m.name, 'avatar_url', m.avatar_url, 'sort', m.sort,
          'ticks', coalesce((
            select jsonb_agg(jsonb_build_array(to_char(t.day, 'YYYY-MM-DD'),
                coalesce(t.chart, false)::int::text || coalesce(t.journal, false)::int::text
                || coalesce(t.review, false)::int::text || coalesce(t.social, false)::int::text
                || coalesce(t.box5, false)::int::text || coalesce(t.box6, false)::int::text
                || coalesce(t.excused, false)::int::text) order by t.day)
            from public.ticks t
            where t.member_key = m.key and t.day in (select d.day from public.server_days(g) d)), '[]'::jsonb))
        order by m.sort, m.name)
      from public.members m where m.group_id = g and m.active), '[]'::jsonb));
end;
$$;

-- ================================================================ who may call what
-- Signed-out visitors get nothing.
revoke all on function public.server_group_view(text) from public, anon, authenticated;
grant execute on function public.server_group_view(text) to authenticated;
