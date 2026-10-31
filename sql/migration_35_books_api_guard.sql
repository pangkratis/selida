-- Stop app users from overwriting the catalog (issue 0k, step 1 of 2; 2026-10-31).
--
-- RLS lets any signed-in user INSERT and UPDATE `books`, because book-details
-- upserts the whole book on every list save. Anyone with an account could
-- therefore rewrite any book's title, description or cover through the REST API.
--
-- These triggers act only when the request comes straight from the API roles
-- (current_user = authenticated/anon) and the caller is not an admin:
--   UPDATE → silently keeps the old row. The live app's upsert still "succeeds"
--            (no new release needed), it just changes nothing.
--   INSERT → allowed (saving a Biblionet search result that is not in the catalog
--            yet), but popularity, sync flags and createdAt are reset so a new row
--            cannot push itself into Trending or skip the subcategory sync.
-- Not affected: admins (catalog ingestion), the service role (Edge Functions),
-- the dashboard / SQL editor, and SECURITY DEFINER functions (they run as owner).
--
-- Step 2 (needs an app release): save books through a server function that takes
-- only the Biblionet id and fetches the data itself, then drop the INSERT policy.

-- SECURITY DEFINER so it can read users.isAdmin whatever the users RLS says.
-- The triggers below run with the caller's rights, so app users must be able
-- to execute it; it only answers "is the caller an admin?".
create or replace function public.fn_caller_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from users u where u.id = auth.uid() and u."isAdmin" = true);
$$;

create or replace function public.fn_books_guard_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') and not fn_caller_is_admin() then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.fn_books_guard_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') and not fn_caller_is_admin() then
    new."popularityCount"    := 0;
    new."syncedSub"          := false;
    new."syncedContributors" := false;
    new."createdAt"          := now();
  end if;
  return new;
end;
$$;

revoke execute on function public.fn_caller_is_admin() from public;
grant  execute on function public.fn_caller_is_admin() to anon, authenticated;

-- Names start with "trg_books_a…" so they run before trg_books_search_text
-- (BEFORE triggers fire in name order).
drop trigger if exists trg_books_api_guard_update on public.books;
create trigger trg_books_api_guard_update
  before update on public.books
  for each row execute function public.fn_books_guard_update();

drop trigger if exists trg_books_api_guard_insert on public.books;
create trigger trg_books_api_guard_insert
  before insert on public.books
  for each row execute function public.fn_books_guard_insert();
