-- Addresses the remaining items from `supabase db advisors --type security`
-- (see issues-opportunities.md #0c), deferred earlier while other work was
-- prioritized.
--
-- 1. Eight functions that are only ever meant to run as trigger bodies
--    (confirmed via grep — zero client-side `.rpc(...)` calls anywhere in
--    the app) were nonetheless directly callable via
--    `/rest/v1/rpc/<name>` by BOTH anon and authenticated. Since they run
--    as SECURITY DEFINER (elevated privileges), an outside caller invoking
--    one directly — e.g. repeatedly forcing a full-catalog resync function
--    — could cause unintended writes/load even without leaking data.
--    Revoking direct EXECUTE does not affect their real use: triggers
--    invoke a function via its own execution context, not through the
--    anon/authenticated grants being revoked here.
--
-- 2. create_user_profile accepted an arbitrary p_id from even anonymous
--    (not just authenticated) callers, with no check that it matched the
--    caller's own auth uid, and does `ON CONFLICT (id) DO NOTHING`. An
--    anonymous caller who somehow knew a real user's auth UUID could have
--    pre-created/squatted that profile row before the real user's own
--    post-signup call ran, silently no-oping the legitimate one. Fixed by
--    asserting p_id = auth.uid() internally and revoking EXECUTE from
--    anon (kept for authenticated — the real signup flow already has a
--    session by the time it calls this, confirmed via
--    app/(auth)/signup.tsx calling it right after supabase.auth.signUp()
--    returns, which returns a session immediately since this project has
--    email confirmation disabled).
--
-- 3. Two functions (create_user_profile, fn_books_search_text) had a
--    mutable search_path — a theoretical search-path-hijack vector for
--    SECURITY DEFINER functions specifically. Pinned via
--    `SET search_path = public`. Rebuilt from the ACTUAL live function
--    bodies (fetched via pg_get_functiondef before writing this) rather
--    than the static schema.sql, which is stale — it still references a
--    `stats` column that was dropped from the live `users` table.

-- ── 1. Revoke direct client access to trigger-only functions ──────────

revoke execute on function public.fn_activity_sync_views() from anon, authenticated;
revoke execute on function public.fn_reading_list_sync_stats() from anon, authenticated;
revoke execute on function public.fn_sync_book_categories() from anon, authenticated;
revoke execute on function public.fn_sync_book_genres() from anon, authenticated;
revoke execute on function public.fn_sync_book_popularity() from anon, authenticated;
revoke execute on function public.fn_sync_book_subcategories() from anon, authenticated;
revoke execute on function public.fn_resolve_all_book_genres() from anon, authenticated;
revoke execute on function public.fn_resolve_book_genres(text) from anon, authenticated;

-- ── 2 & 3. create_user_profile: self-check + pinned search_path ───────

create or replace function public.create_user_profile(
  p_id uuid,
  p_email text,
  p_display_name text,
  p_language text,
  p_country text,
  p_catalog_preference text
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if p_id is distinct from auth.uid() then
    raise exception 'p_id must match the authenticated user';
  end if;

  insert into public.users (
    id, email, "displayName", language, country,
    "catalogPreference", "onboardingComplete",
    "preferredSubcategories", "createdAt", "lastLoginAt"
  )
  values (
    p_id, p_email, p_display_name, p_language, p_country,
    p_catalog_preference, false,
    '{}', now(), now()
  )
  on conflict (id) do nothing;
end;
$function$;

revoke execute on function public.create_user_profile(uuid, text, text, text, text, text) from anon;

-- ── 3 (continued). fn_books_search_text: pinned search_path ───────────

create or replace function public.fn_books_search_text()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  new.search_text := lower(
    unaccent(new.title || ' ' || coalesce(array_to_string(new.authors, ' '), ''))
  );
  return new;
end;
$function$;
