-- Recommendations v2. Replaces get_book_recommendations, which timed out
-- (57014) once books reached ~186k rows: a broad category match made ~55k
-- books candidates and reading those rows took 7+ seconds.
--
-- v2 builds the taste profile server-side from the caller's own reading list
-- and onboarding picks, draws a few thousand candidates from narrow tables
-- (book_genres, book_subcategories, the authors GIN index), and only then
-- touches books.
--
-- Score = 30 * genre fit (0..1)  +  25 if a preferred author
--       + 6 per shared subject heading (max 18)  +  4 if a preferred publisher
--       - 15 on a known language mismatch  +  popularity (max 10)

-- Lets a genre be sampled by book_id range without sorting the whole genre.
create index if not exists book_genres_genre_book on public.book_genres (genre_id, book_id);

create or replace function public.fn_recommend_ids(
  p_user_id     uuid,
  p_exclude_ids text[] default '{}',
  p_limit       int    default 250
)
returns table (book_id text, score double precision, match_reason text)
language sql
stable
security definer
set search_path = public
as $$
  with
  mine as (
    select r."bookId" as book_id, r.status, r."addedAt"
    from "readingList" r
    where r."userId" = p_user_id
  ),
  -- Most recent 30 saves, weighted by status and recency.
  rl as (
    select m.book_id,
           (case m.status when 'completed' then 3 when 'reading' then 2 else 1 end)
           * greatest(0.6, exp(-greatest(0, extract(epoch from now() - m."addedAt") / 86400.0) / 120.0)) as w
    from mine m
    order by m."addedAt" desc nulls last
    limit 30
  ),
  rl_books as (
    select b.authors, b.subcategories, b.publisher, b.language, rl.w
    from rl join books b on b.id = rl.book_id
  ),
  prefs as (
    select coalesce(u."preferredGenres", '{}')        as genres,
           coalesce(u."preferredSubcategories", '{}') as subjects
    from users u
    where u.id = p_user_id
  ),
  -- Onboarding picks count like one wishlist save each, so they carry a new
  -- user and fade as real history accumulates.
  genre_weights as (
    select x.genre_id, sum(x.w) as w
    from (
      select bg.genre_id, rl.w * bg.confidence as w
      from rl join book_genres bg on bg.book_id = rl.book_id
      union all
      select g.id, 1.0
      from prefs p cross join unnest(p.genres) as picked(slug)
      join genres g on g.slug = picked.slug
    ) x
    group by x.genre_id
  ),
  genre_profile as (
    select gw.genre_id, gw.w / max(gw.w) over () as fit
    from genre_weights gw
    order by gw.w desc
    limit 6
  ),
  pref_authors as (
    select a as name
    from rl_books rb cross join unnest(rb.authors) as a
    where a <> 'Unknown Author'
    group by a
    order by sum(rb.w) desc
    limit 5
  ),
  pref_subjects as (
    select x.name
    from (
      select s as name, rb.w from rl_books rb cross join unnest(rb.subcategories) as s
      union all
      select s, 1.0 from prefs p cross join unnest(p.subjects) as s
    ) x
    group by x.name
    order by sum(x.w) desc
    limit 8
  ),
  pref_publishers as (
    select rb.publisher as name
    from rl_books rb
    where coalesce(rb.publisher, '') not in ('', 'Unknown Publisher')
    group by rb.publisher
    order by sum(rb.w) desc
    limit 3
  ),
  pref_language as (
    select rb.language as name
    from rl_books rb
    where coalesce(rb.language, '') <> ''
    group by rb.language
    order by sum(rb.w) desc
    limit 1
  ),
  arr as (
    select coalesce((select array_agg(name) from pref_authors),    '{}') as authors,
           coalesce((select array_agg(name) from pref_subjects),   '{}') as subjects,
           coalesce((select array_agg(name) from pref_publishers), '{}') as publishers,
           (select name from pref_language)                              as language
  ),

  -- ── Candidates ────────────────────────────────────────────────────────────
  cand_author as (
    select b.id as book_id
    from books b, arr
    where b.authors && arr.authors
    limit 500
  ),
  cand_subject as (
    select bs.book_id, count(*) as n
    from book_subcategories bs
    join subcategories s on s.id = bs.subcategory_id
    cross join arr
    where s.name = any (arr.subjects)
    group by bs.book_id
    order by count(*) desc, md5(bs.book_id::text || p_user_id::text || current_date::text)
    limit 1000
  ),
  -- A slice of each preferred genre, larger for better-fitting genres. book
  -- ids are random uuids, so a range starting at a per-user, per-day key is a
  -- random sample that rotates daily and wraps around at the end.
  cand_genre as (
    select s.book_id
    from genre_profile gp
    cross join lateral (
      select md5(p_user_id::text || current_date::text || gp.genre_id::text) as start_key,
             ceil(500 * gp.fit)::int as n
    ) k
    cross join lateral (
      (select bg.book_id from book_genres bg
        where bg.genre_id = gp.genre_id and bg.book_id >= k.start_key
        order by bg.book_id limit k.n)
      union all
      (select bg.book_id from book_genres bg
        where bg.genre_id = gp.genre_id and bg.book_id < k.start_key
        order by bg.book_id limit k.n)
      limit k.n
    ) s
  ),
  -- The books readers are actually engaging with in the preferred genres.
  cand_popular as (
    select bg.book_id
    from "bookStats" st
    join book_genres bg on bg.book_id = st."bookId"
    join genre_profile gp on gp.genre_id = bg.genre_id
    order by (st.completed * 4 + st.reading * 3 + st.wishlist * 2 + st.views) desc
    limit 300
  ),
  cand as (
    select c.book_id
    from (
      select book_id from cand_author
      union select book_id from cand_subject
      union select book_id from cand_genre
      union select book_id from cand_popular
    ) c
    where not exists (select 1 from mine m where m.book_id = c.book_id)
      and not (c.book_id = any (coalesce(p_exclude_ids, '{}')))
  ),

  -- ── Scoring ───────────────────────────────────────────────────────────────
  -- First pass uses only narrow tables, so the wide books rows are read for
  -- the shortlist alone.
  pre as (
    select
      c.book_id,
      coalesce((
        select max(gp.fit * bg.confidence)
        from book_genres bg join genre_profile gp on gp.genre_id = bg.genre_id
        where bg.book_id = c.book_id
      ), 0) as genre_fit,
      (ca.book_id is not null) as auth_match,
      coalesce(cs.n, 0) as subject_n,
      least(
        (
          ln(1 + coalesce(st.views, 0))     * 0.5 +
          ln(1 + coalesce(st.wishlist, 0))  * 1.0 +
          ln(1 + coalesce(st.reading, 0))   * 1.5 +
          ln(1 + coalesce(st.completed, 0)) * 2.0
        )
        * (
          case
            when st."lastActivityAt" is null then 1.0
            else 0.65 + 0.35 * exp(
              -greatest(0, extract(epoch from (now() - st."lastActivityAt")) / 86400.0) / 45.0
            )
          end
        ),
        10.0
      ) as popularity
    from cand c
    left join cand_author ca  on ca.book_id = c.book_id
    left join cand_subject cs on cs.book_id = c.book_id
    left join "bookStats" st  on st."bookId" = c.book_id
  ),
  shortlist as (
    select p.*,
           (30 * p.genre_fit
            + (case when p.auth_match then 25 else 0 end)
            + least(18, 6 * p.subject_n)
            + p.popularity) as base_score
    from pre p
    order by base_score desc, md5(p.book_id || p_user_id::text || current_date::text)
    limit greatest(p_limit * 2, 100)
  ),
  ranked as (
    select
      b.id, b.title, b.authors,
      (
        s.base_score
        + (case when b.publisher = any (arr.publishers) then 4 else 0 end)
        - (case when arr.language is not null and coalesce(b.language, '') <> ''
                 and b.language <> arr.language then 15 else 0 end)
      )::double precision as score,
      case
        when s.auth_match    then 'author'
        when s.subject_n > 0 then 'subject'
        when s.genre_fit > 0 then 'genre'
        else 'popular'
      end as match_reason
    from shortlist s
    join books b on b.id = s.book_id
    cross join arr
    where b."isActive" is distinct from false
  ),
  -- One entry per work: editions share a title and first author.
  deduped as (
    select distinct on (lower(r.title), lower(coalesce(r.authors[1], '')))
           r.id, r.score, r.match_reason
    from ranked r
    order by lower(r.title), lower(coalesce(r.authors[1], '')), r.score desc
  )
  select d.id, d.score, d.match_reason
  from deduped d
  order by d.score desc, d.id
  limit p_limit;
$$;

revoke execute on function public.fn_recommend_ids(uuid, text[], int) from public, anon, authenticated;

-- Client entry point: always the caller's own profile, never a supplied id.
create or replace function public.get_recommendations(
  p_exclude_ids text[] default '{}',
  p_limit       int    default 250
)
returns table (
  id                text,
  title             text,
  subtitle          text,
  authors           text[],
  categories        text[],
  subcategories     text[],
  publisher         text,
  language          text,
  source            text,
  "coverUrl"        text,
  "pageCount"       int,
  "popularityCount" int,
  "biblionetId"     text,
  "syncedSub"       boolean,
  description       text,
  isbn              text,
  "publishedYear"   text,
  edition           text,
  series            text,
  score             double precision,
  match_reason      text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id, b.title, b.subtitle, b.authors, b.categories, b.subcategories,
    b.publisher, b.language, b.source, b."coverUrl", b."pageCount",
    b."popularityCount", b."biblionetId", b."syncedSub",
    b.description, b.isbn, b."publishedYear", b.edition, b.series,
    r.score, r.match_reason
  from public.fn_recommend_ids(auth.uid(), p_exclude_ids, p_limit) r
  join books b on b.id = r.book_id
  order by r.score desc, b.id;
$$;

revoke execute on function public.get_recommendations(text[], int) from public, anon;
grant execute on function public.get_recommendations(text[], int) to authenticated;
