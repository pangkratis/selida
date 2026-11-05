-- Reader profile for the Profile tab (2026-11-05).
--
-- get_reader_profile() returns, for the signed-in user only (auth.uid()):
--   genres          top 5 genres of the books in their lists, weighted by list
--                   (finished ×3, reading ×2, wishlist ×1) × genre confidence,
--                   primary genre ×1.5. The app turns the top two into a fun
--                   "reader type" (constants/reader-types.ts).
--   genre_books     how many of their books have a genre at all — the app only
--                   trusts the mix from 3 books up, below that it uses…
--   preferred_genres the onboarding picks (users.preferredGenres), with names.
--   genre_count     how many different genres their books cover.
--   finished, reading, wishlist, pages_read, seconds_read, top_author
--
-- pages_read = full page count of finished books + progress share of books
-- being read. seconds_read = the larger of the session log and the per-book
-- totals (older sessions only exist in readingList.totalReadingTimeSeconds).
-- top_author needs at least 2 books by the same author.

create or replace function public.get_reader_profile()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with rl as (
    select r."bookId", r.status, r."progressPercentage", r."totalReadingTimeSeconds"
    from "readingList" r
    where r."userId" = auth.uid()
  ),
  w as (
    select rl."bookId",
           case rl.status when 'completed' then 3 when 'reading' then 2 else 1 end as wt
    from rl
  ),
  gw as (
    select g.slug, g.name_en, g.name_el, g.is_fiction,
           sum(w.wt * coalesce(bg.confidence, 1) * case when bg.is_primary then 1.5 else 1 end) as score,
           count(distinct w."bookId") as books
    from w
    join book_genres bg on bg.book_id = w."bookId"
    join genres g on g.id = bg.genre_id
    group by g.slug, g.name_en, g.name_el, g.is_fiction
  ),
  authors as (
    select a.name, count(*) as n
    from rl
    join books b on b.id = rl."bookId"
    cross join lateral unnest(b.authors) as a(name)
    where coalesce(trim(a.name), '') <> ''
    group by a.name
    having count(*) >= 2
  )
  select jsonb_build_object(
    'genres', coalesce((
      select jsonb_agg(jsonb_build_object('slug', slug, 'name_en', name_en, 'name_el', name_el, 'is_fiction', is_fiction,
                                         'score', round(score::numeric, 2), 'books', books)
                       order by score desc)
      from (select * from gw order by score desc limit 5) top
    ), '[]'::jsonb),
    'genre_count', (select count(*) from gw),
    'genre_books', (select count(distinct w."bookId") from w join book_genres bg on bg.book_id = w."bookId"),
    'preferred_genres', coalesce((
      select jsonb_agg(jsonb_build_object('slug', g.slug, 'name_en', g.name_en, 'name_el', g.name_el) order by p.ord)
      from users u
      cross join lateral unnest(u."preferredGenres") with ordinality as p(slug, ord)
      join genres g on g.slug = p.slug
      where u.id = auth.uid()
    ), '[]'::jsonb),
    'finished', (select count(*) from rl where status = 'completed'),
    'reading',  (select count(*) from rl where status = 'reading'),
    'wishlist', (select count(*) from rl where status = 'wishlist'),
    'pages_read', (
      select coalesce(round(sum(
        case when rl.status = 'completed' then b."pageCount"
             when rl.status = 'reading' then b."pageCount" * least(greatest(coalesce(rl."progressPercentage", 0), 0), 100) / 100.0
             else 0 end)), 0)::int
      from rl join books b on b.id = rl."bookId"
    ),
    'seconds_read', greatest(
      (select coalesce(sum(s."durationSeconds"), 0) from "readingSessions" s where s."userId" = auth.uid()),
      (select coalesce(sum(rl."totalReadingTimeSeconds"), 0) from rl)
    )::bigint,
    'top_author', (select name from authors order by n desc, name limit 1)
  );
$$;

revoke execute on function public.get_reader_profile() from public, anon;
grant  execute on function public.get_reader_profile() to authenticated;
