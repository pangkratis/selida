-- Genre counts were computed on every call (migration 06's get_browsable_genres
-- joins ~133k book_genres rows to books). That took ~16s, and the API's
-- anonymous role times out before it finishes, so the onboarding screen
-- silently got no genres.
--
-- The counts now live in a materialized view, refreshed hourly. Counts can be
-- up to an hour stale, which is fine for choosing onboarding chips.

create materialized view if not exists public.genre_book_counts as
select
  g.id as genre_id,
  g.slug,
  g.name_en,
  g.name_el,
  g.is_fiction,
  g.sort_order,
  count(bg.book_id)::bigint as book_count,
  coalesce(sum(bk."popularityCount"), 0)::bigint as total_popularity
from genres g
join book_genres bg on bg.genre_id = g.id
join books bk on bk.id = bg.book_id
where g.is_browsable
  and bk."isActive" is distinct from false
group by g.id, g.slug, g.name_en, g.name_el, g.is_fiction, g.sort_order;

-- Required for REFRESH ... CONCURRENTLY, so reads aren't blocked while it runs.
create unique index if not exists genre_book_counts_genre_id_idx
  on public.genre_book_counts (genre_id);

grant select on public.genre_book_counts to anon, authenticated;

create or replace function public.get_browsable_genres(p_min_books integer default 1)
returns table(
  slug text, name_en text, name_el text, is_fiction boolean,
  sort_order integer, book_count bigint, total_popularity bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select c.slug, c.name_en, c.name_el, c.is_fiction, c.sort_order, c.book_count, c.total_popularity
  from genre_book_counts c
  where c.book_count >= p_min_books
  order by c.sort_order;
$$;

create or replace function public.refresh_genre_book_counts()
returns void
language sql
security definer
set search_path = public
as $$
  refresh materialized view concurrently public.genre_book_counts;
$$;

-- Hourly refresh. Idempotent: unschedule any existing job with this name first.
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'refresh-genre-book-counts';
select cron.schedule('refresh-genre-book-counts', '0 * * * *', 'select public.refresh_genre_book_counts();');
