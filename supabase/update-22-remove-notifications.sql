-- Update 22: notifications are removed from LockedIn (homework reminders and owner alerts).
-- Run ONCE in Supabase > SQL Editor > New query > paste > Run (after update 21), BEFORE pushing the website.
-- Safe to run again.
--
-- What this does:
--   * Deletes every saved push address, so nobody gets a reminder or an owner alert again
--     (their sent-reminder log goes with them).
--   * Removes the function the app used to save a push address, so none can be added again.
--   * Stops making owner alerts for join requests, group requests and reports, and deletes the ones waiting.
--
-- What it keeps on purpose:
--   * The every-5-minutes job and the send-reminders Edge Function. They also delete pictures older than
--     60 days, which the privacy policy promises. With no push addresses left they find nobody to notify.
--   * The empty tables, because "Download my data" (update 21) still reads push_subscriptions.

-- ================================================================ no more push addresses
delete from public.push_subscriptions;   -- push_log rows are removed with them (on delete cascade)
drop function if exists public.save_push_subscription(text, text, text, int);

-- ================================================================ no more owner alerts
drop trigger if exists memberships_alert_join on public.memberships;
drop trigger if exists reports_alert on public.reports;
drop trigger if exists group_requests_alert on public.group_requests;
drop function if exists public.alert_join();
drop function if exists public.alert_report();
drop function if exists public.alert_group_request();
delete from public.owner_alerts;

-- ================================================================ checks (the query stops with an error if one fails)
do $$
begin
  if exists (select 1 from public.push_subscriptions) then raise exception 'Check failed: push addresses are still saved.'; end if;
  if exists (select 1 from public.owner_alerts) then raise exception 'Check failed: owner alerts are still waiting.'; end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname in ('save_push_subscription', 'alert_join', 'alert_report', 'alert_group_request'))
    then raise exception 'Check failed: a notification function still exists.'; end if;
  if exists (select 1 from pg_trigger where tgname in ('memberships_alert_join', 'reports_alert', 'group_requests_alert'))
    then raise exception 'Check failed: an alert trigger still exists.'; end if;
end $$;

-- ================================================================ SCHEDULE (only on Supabase: the test database has no pg_cron)
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'send-reminders')
    then raise exception 'Check failed: the job that deletes old pictures is missing. Do not push the website; ask for help.'; end if;
end $$;

select 'Update 22 done: notifications are off, old pictures are still cleaned up.' as result;
