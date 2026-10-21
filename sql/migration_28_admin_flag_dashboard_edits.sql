-- Database administrators could not change "isAdmin" from the Supabase
-- dashboard: migration_10's trigger reverted the change silently unless the
-- request carried the service_role key, and dashboard edits run as the
-- database owner without one.
--
-- The trigger now protects the flag only against the API roles the app uses
-- (anon, authenticated) — the actual risk, since the users UPDATE policy lets
-- a signed-in user edit their own row. Changes made as postgres (dashboard,
-- SQL editor), supabase_admin or service_role go through.
--
-- SECURITY INVOKER so current_user is the caller's role; under SECURITY
-- DEFINER it would always be the function owner.

create or replace function public.protect_admin_flag()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    new."isAdmin" := old."isAdmin";
  end if;
  return new;
end;
$$;
