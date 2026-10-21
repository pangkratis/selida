-- Book triage deck: newest publication year first (was popularity, then the
-- date the book was added to our database). Ties: popularity, then most
-- recently added. Every unsynced book has a four-digit "publishedYear", so the
-- text column sorts correctly; nulls go last just in case.

create index if not exists books_subsync_year_idx
  on public.books ("publishedYear" desc nulls last, "popularityCount" desc, "createdAt" desc)
  where "syncedSub" = false and "biblionetId" is not null;

-- Only the old deck order used this one.
drop index if exists public.books_subsync_recent_idx;

create or replace function public.get_triage_deck(
  p_limit       int    default 20,
  p_exclude_ids text[] default '{}'
)
returns setof public.books
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform fn_require_admin();
  return query
    select b.*
    from books b
    where b."syncedSub" = false
      and b."biblionetId" is not null
      and not exists (select 1 from book_triage t where t.book_id = b.id)
      and not (b.id = any (coalesce(p_exclude_ids, '{}')))
    order by b."publishedYear" desc nulls last, b."popularityCount" desc, b."createdAt" desc
    limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;
