-- Prevents a user from granting themselves admin access.
--
-- Found via manual RLS testing (2026-09-19): the `users` table's UPDATE
-- policy lets a user modify any column on their own row, including
-- "isAdmin" — so `PATCH /rest/v1/users?id=eq.<self>` with
-- {"isAdmin": true} succeeded for a normal authenticated user, with no
-- admin check anywhere. Since app/catalog-ingestion.tsx's admin gate is
-- just a client-side `user.isAdmin` check, this let any signed-in user
-- grant themselves access to admin-only screens.
--
-- Fix: a BEFORE UPDATE trigger that forces "isAdmin" back to its previous
-- value unless the request is made with the service_role key (i.e. from
-- a trusted backend context, not a normal client session). Normal profile
-- edits (displayName, language, country, etc.) are untouched.

create or replace function public.protect_admin_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    new."isAdmin" := old."isAdmin";
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_admin_flag on public.users;

create trigger trg_protect_admin_flag
before update on public.users
for each row
execute function public.protect_admin_flag();
