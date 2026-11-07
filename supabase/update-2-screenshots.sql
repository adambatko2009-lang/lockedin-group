-- Update 2: journal screenshots.
-- Run ONCE in Supabase > SQL Editor > New query > paste > Run (after setup.sql).
--
-- Rules, same as the tick boxes:
--   * Only approved members (and the admin) can see screenshots.
--   * A member can add or delete screenshots ONLY in their own row, ONLY while the day is open.
--   * The admin can add or delete any screenshot.
--   * Max 4 screenshots per member per day, max 5 MB each, images only.

-- Each tick row remembers its screenshots (file paths in storage).
alter table public.ticks
  add column images text[] not null default '{}'
  check (cardinality(images) <= 4);

-- A private storage folder ("bucket") for the images.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('screenshots', 'screenshots', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Files are stored as  <day>/<member>/<time>.jpg  e.g.  2026-11-04/sid/1762270000000.jpg
create or replace function public.can_write_screenshot(path text) returns boolean
language sql stable security definer set search_path = public as $$
  select path ~ '^\d{4}-\d{2}-\d{2}/[a-z0-9_-]+/[0-9]+\.(jpg|png|webp)$'
     and (public.is_admin()
          or ((storage.foldername(path))[1] = public.current_trading_day()::text
              and (storage.foldername(path))[2] = public.my_member_key()));
$$;

create policy screenshots_read on storage.objects for select to authenticated
  using (bucket_id = 'screenshots' and (public.is_approved() or public.is_admin()));

create policy screenshots_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'screenshots' and public.can_write_screenshot(name));

create policy screenshots_delete on storage.objects for delete to authenticated
  using (bucket_id = 'screenshots' and public.can_write_screenshot(name));
