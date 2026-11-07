-- Update 13: everyone accepts the Terms and Privacy policy once (and again if they change).
-- Run ONCE in Supabase > SQL Editor > New query > paste > Run (after update 12), BEFORE pushing the website.
--
-- Saves when each person accepted and which version, as proof. Nothing else changes; no data is removed.

alter table public.profiles add column if not exists terms_accepted_at timestamptz;
alter table public.profiles add column if not exists terms_version text;

-- You can only record your own acceptance, and only with the time the database sees.
create or replace function public.accept_terms(terms_v text) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if terms_v !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Unknown terms version'; end if;
  update public.profiles set terms_accepted_at = now(), terms_version = terms_v where user_id = auth.uid();
end;
$$;
revoke all on function public.accept_terms(text) from public, anon;
grant execute on function public.accept_terms(text) to authenticated;
