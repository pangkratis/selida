-- Personal taste on every Home shelf (2026-11-05).
--
-- Until now only "Recommended for you" was personal; Trending, New arrivals,
-- Quick reads and the genre/topic shelves were the same for everyone. This adds
-- one shared taste profile and one affinity score, and uses them everywhere:
--
--   fn_user_taste(uid)          the user's taste as weighted features (0..1 per kind):
--     genre   distinctive genres (weighted by rarity in the catalog, as the reader
--             type does) + onboarding picks + the saved reader type's genre
--     tag     theme and mood tags of their books (rarity-weighted) + the reader
--             type's theme
--     author  favourite authors       language  their main language
--   fn_taste_affinity(uid, ids) how well each book fits that taste (0..1)
--
--   Recommended    + candidates that share the user's top themes, + 20 × tag fit,
--                    + 5 in the reader type's genre (fn_recommend_ids, end of file)
--   Trending       popular books re-ranked: 50% popularity, 50% affinity
--   New arrivals   recent books (last 120 days) the user is likely to like
--                    (affinity ≥ 0.3); when fewer than 12 match, the closest ones
--   Quick reads    short books re-ranked by affinity (70%) and popularity (30%)
--   Genre / topic  the first 600 books of the shelf re-ranked (60% affinity,
--                    40% popularity); deeper pages keep the old order
--   Author shelves unchanged
--   No taste yet (new user, no picks) → every shelf keeps its old order.
--
-- Signatures of get_recommendations and get_shelf_books are unchanged, so the
-- live app gets this without a release.

-- ── Taste ───────────────────────────────────────────────────────────────────
create or replace function public.fn_user_taste(p_uid uuid)
returns table (kind text, key text, w double precision)
language sql
stable
security definer
set search_path = public
as $$
  with
  mine as (
    select r."bookId" as book_id,
           (case r.status when 'completed' then 3 when 'reading' then 2 else 1 end)
           * greatest(0.6, exp(-greatest(0, extract(epoch from now() - r."addedAt") / 86400.0) / 120.0)) as w
    from "readingList" r
    where r."userId" = p_uid
  ),
  me as (
    select coalesce(u."preferredGenres", '{}') as picks, u."readerGenre", u."readerFlavour"
    from users u where u.id = p_uid
  ),
  genre_total as (select greatest(coalesce(sum(book_count), 1), 1)::numeric as t from genre_book_counts),
  genre_raw as (
    select g.slug as key, m.w * coalesce(bg.confidence, 1) as w
    from mine m
    join book_genres bg on bg.book_id = m.book_id
    join genres g on g.id = bg.genre_id
    union all
    select p.slug, 1.0 from me cross join unnest(me.picks) as p(slug)
    union all
    select me."readerGenre", 2.0 from me where me."readerGenre" is not null
  ),
  genre_w as (
    select x.key,
           sum(x.w) * power(greatest(coalesce(max(c.book_count), 1000)::numeric / (select t from genre_total), 0.0001), -0.35) as w
    from genre_raw x
    left join genre_book_counts c on c.slug = x.key
    group by x.key
  ),
  tag_total as (select tag_id, count(*)::numeric as n from book_tags group by tag_id),
  tag_all as (select greatest(sum(n), 1) as t from tag_total),
  tag_raw as (
    select t.slug as key, t.id as tag_id, m.w * case when bt.strength = 'clear' then 1 else 0.6 end as w
    from mine m
    join book_tags bt on bt.book_id = m.book_id
    join tags t on t.id = bt.tag_id and t.facet in ('theme', 'mood')
    union all
    select t.slug, t.id, 2.0
    from me join tags t on me."readerFlavour" = 'tag:' || t.slug
  ),
  tag_w as (
    select x.key,
           sum(x.w) * power(greatest(coalesce(max(tt.n), 1)::numeric / (select t from tag_all), 0.00001), -0.35) as w
    from tag_raw x
    left join tag_total tt on tt.tag_id = x.tag_id
    group by x.key
  ),
  author_w as (
    select a as key, sum(m.w) as w
    from mine m join books b on b.id = m.book_id
    cross join lateral unnest(b.authors) as a
    where coalesce(trim(a), '') not in ('', 'Unknown Author')
    group by a
  ),
  lang as (
    select b.language as key, sum(m.w) as w
    from mine m join books b on b.id = m.book_id
    where coalesce(b.language, '') <> ''
    group by b.language
    order by sum(m.w) desc
    limit 1
  ),
  feats as (
    select 'genre'::text as kind, key, w from (select * from genre_w order by w desc limit 8) g
    union all
    select 'tag', key, w from (select * from tag_w order by w desc limit 12) t
    union all
    select 'author', key, w from (select * from author_w order by w desc limit 6) a
    union all
    select 'language', key, 1.0 from lang
  )
  select f.kind, f.key, (f.w / nullif(max(f.w) over (partition by f.kind), 0))::double precision as w
  from feats f
  where f.key is not null;
$$;

-- ── Affinity ────────────────────────────────────────────────────────────────
-- 0..1. Books with AI tags: 50% genre fit + 35% tag fit + 15% author.
-- Books without tags (not enriched yet) are judged on genre + author alone, so
-- they are not punished for missing data. −0.3 for a different language.
create or replace function public.fn_taste_affinity(p_uid uuid, p_ids text[])
returns table (book_id text, affinity double precision)
language sql
stable
security definer
set search_path = public
as $$
  with
  taste as (select * from fn_user_taste(p_uid)),
  ids as (select distinct unnest(p_ids) as id),
  gfit as (
    select bg.book_id, max(t.w * coalesce(bg.confidence, 1)) as v
    from ids join book_genres bg on bg.book_id = ids.id
    join genres g on g.id = bg.genre_id
    join taste t on t.kind = 'genre' and t.key = g.slug
    group by bg.book_id
  ),
  tagged as (
    select distinct bt.book_id from ids join book_tags bt on bt.book_id = ids.id
  ),
  tfit as (
    select bt.book_id, least(1.0, sum(t.w * case when bt.strength = 'clear' then 1 else 0.6 end) / 2.0) as v
    from ids join book_tags bt on bt.book_id = ids.id
    join tags tg on tg.id = bt.tag_id
    join taste t on t.kind = 'tag' and t.key = tg.slug
    group by bt.book_id
  ),
  bk as (
    select b.id, b.authors, b.language from ids join books b on b.id = ids.id
  ),
  afit as (
    select bk.id as book_id, max(t.w) as v
    from bk cross join lateral unnest(bk.authors) as a
    join taste t on t.kind = 'author' and t.key = a
    group by bk.id
  ),
  lang as (select key from taste where kind = 'language' limit 1)
  select bk.id,
         greatest(0.0,
           case when tg.book_id is not null
                then 0.50 * coalesce(g.v, 0) + 0.35 * coalesce(tf.v, 0) + 0.15 * coalesce(af.v, 0)
                else 0.80 * coalesce(g.v, 0) + 0.20 * coalesce(af.v, 0)
           end
           - case when (select key from lang) is not null and coalesce(bk.language, '') <> ''
                       and bk.language <> (select key from lang) then 0.3 else 0 end
         )::double precision
  from bk
  left join gfit g    on g.book_id = bk.id
  left join tagged tg on tg.book_id = bk.id
  left join tfit tf   on tf.book_id = bk.id
  left join afit af   on af.book_id = bk.id;
$$;

revoke execute on function public.fn_user_taste(uuid) from public, anon, authenticated;
revoke execute on function public.fn_taste_affinity(uuid, text[]) from public, anon, authenticated;

-- Speeds up "books in the last 120 days".
create index if not exists books_created_at_idx on public.books ("createdAt" desc);

-- ── Shelves ─────────────────────────────────────────────────────────────────
create or replace function public.get_shelf_books(
  p_kind       text,
  p_key        text default null,
  p_offset     int  default 0,
  p_limit      int  default 24,
  p_exclude_id text default null
)
returns setof public.books
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_seed      text := coalesce(auth.uid()::text, '') || current_date::text;
  v_off       int  := greatest(coalesce(p_offset, 0), 0);
  v_lim       int  := least(greatest(coalesce(p_limit, 24), 1), 60);
  v_saved     text[];
  v_has_taste boolean;
  v_pool      text[];
  v_liked     int;
begin
  if v_uid is null then
    return;
  end if;
  v_saved := public.fn_saved_work_ids(v_uid);
  v_has_taste := exists (select 1 from fn_user_taste(v_uid) t where t.kind in ('genre', 'tag'));

  if p_kind = 'new' then
    if not v_has_taste then
      return query
        select b.* from books b
        where b."isActive" is distinct from false
          and b.id is distinct from p_exclude_id
          and not (b.id = any (v_saved))
        order by b."createdAt" desc, b.id
        offset v_off limit v_lim;
      return;
    end if;

    select array_agg(id) into v_pool from (
      select b.id from books b
      where b."createdAt" > now() - interval '120 days'
        and b."isActive" is distinct from false
        and b.id is distinct from p_exclude_id
        and not (b.id = any (v_saved))
      order by b."createdAt" desc
      limit 2000
    ) p;

    select count(*) into v_liked from fn_taste_affinity(v_uid, v_pool) a where a.affinity >= 0.3;

    return query
      with scored as (
        select a.book_id, a.affinity,
               a.affinity * 0.8 + 0.2 * exp(-greatest(0, extract(epoch from now() - b."createdAt") / 86400.0) / 30.0) as score
        from fn_taste_affinity(v_uid, v_pool) a
        join books b on b.id = a.book_id
      )
      select b.* from scored s join books b on b.id = s.book_id
      where v_liked < 12 or s.affinity >= 0.3
      order by s.score desc, b.id
      offset v_off limit v_lim;

  elsif p_kind = 'trending' then
    if not v_has_taste then
      return query
        with page as (
          select st."bookId" as id, st.views from "bookStats" st
          where not (st."bookId" = any (v_saved)) and st."bookId" is distinct from p_exclude_id
          order by st.views desc, st."bookId"
          offset v_off limit v_lim
        )
        select b.* from page p join books b on b.id = p.id
        where b."isActive" is distinct from false
        order by p.views desc, p.id;
      return;
    end if;

    return query
      with pool as (
        select st."bookId" as id,
               ln(1 + st.completed * 4 + st.reading * 3 + st.wishlist * 2 + st.views) as pop
        from "bookStats" st
        where not (st."bookId" = any (v_saved)) and st."bookId" is distinct from p_exclude_id
        order by (st.completed * 4 + st.reading * 3 + st.wishlist * 2 + st.views) desc
        limit 500
      ),
      scored as (
        select p.id, 0.5 * p.pop / nullif(max(p.pop) over (), 0) + 0.5 * coalesce(a.affinity, 0) as score
        from pool p
        left join fn_taste_affinity(v_uid, (select array_agg(id) from pool)) a on a.book_id = p.id
      )
      select b.* from scored s join books b on b.id = s.id
      where b."isActive" is distinct from false
      order by s.score desc nulls last, b.id
      offset v_off limit v_lim;

  elsif p_kind = 'quick' then
    return query
      with pool as (
        select b.id,
               coalesce(st.completed * 4 + st.reading * 3 + st.wishlist * 2 + st.views, 0) as pop,
               md5(b.id || v_seed) as k
        from books b
        left join "bookStats" st on st."bookId" = b.id
        where b."pageCount" between 60 and 120
          and b.id is distinct from p_exclude_id
          and not (b.id = any (v_saved))
        order by pop desc, k
        limit case when v_has_taste then 1500 else v_off + v_lim end
      ),
      scored as (
        select p.id, p.k,
               case when v_has_taste
                    then 0.7 * coalesce(a.affinity, 0) + 0.3 * ln(1 + p.pop) / nullif(max(ln(1 + p.pop)) over (), 0)
                    else p.pop end as score
        from pool p
        left join fn_taste_affinity(v_uid, case when v_has_taste then (select array_agg(id) from pool) else '{}' end) a
               on a.book_id = p.id
      )
      select b.* from scored s join books b on b.id = s.id
      where b."isActive" is distinct from false
      order by s.score desc nulls last, s.k
      offset v_off limit v_lim;

  elsif p_kind in ('genre', 'subcategory') then
    -- First 600 of the shelf re-ranked by taste; deeper pages keep the old order.
    return query
      with base as (
        select x.id, x.pop, x.k, row_number() over (order by x.pop desc, x.k) as rn
        from (
          select bg.book_id as id,
                 coalesce(st.completed * 4 + st.reading * 3 + st.wishlist * 2 + st.views, 0) as pop,
                 md5(bg.book_id || v_seed) as k
          from genres g
          join book_genres bg on bg.genre_id = g.id
          left join "bookStats" st on st."bookId" = bg.book_id
          where p_kind = 'genre' and g.slug = p_key
            and bg.book_id is distinct from p_exclude_id
            and not (bg.book_id = any (v_saved))
          union all
          select bs.book_id,
                 coalesce(st.completed * 4 + st.reading * 3 + st.wishlist * 2 + st.views, 0),
                 md5(bs.book_id || v_seed)
          from subcategories s
          join book_subcategories bs on bs.subcategory_id = s.id
          left join "bookStats" st on st."bookId" = bs.book_id
          where p_kind = 'subcategory' and s.name = p_key
            and bs.book_id is distinct from p_exclude_id
            and not (bs.book_id = any (v_saved))
        ) x
        order by x.pop desc, x.k
        limit greatest(v_off + v_lim, 600)
      ),
      head as (select * from base where rn <= 600),
      scored as (
        select h.id, h.k,
               case when v_has_taste
                    then 0.6 * coalesce(a.affinity, 0) + 0.4 * ln(1 + h.pop) / nullif(max(ln(1 + h.pop)) over (), 0)
                    else null end as score,
               h.rn
        from head h
        left join fn_taste_affinity(v_uid, case when v_has_taste then (select array_agg(id) from head) else '{}' end) a
               on a.book_id = h.id
      ),
      ordered as (
        select s.id, row_number() over (order by s.score desc nulls last, s.rn) as pos from scored s
        union all
        select b.id, b.rn from base b where b.rn > 600
      )
      select bk.* from ordered o join books bk on bk.id = o.id
      where bk."isActive" is distinct from false
      order by o.pos
      offset v_off limit v_lim;

  elsif p_kind = 'author' then
    -- Editions of one work share a title; show it once.
    return query
      with works as (
        select distinct on (lower(b.title))
               b.id, b.title,
               coalesce(st.completed * 4 + st.reading * 3 + st.wishlist * 2 + st.views, 0) as pop
        from books b
        left join "bookStats" st on st."bookId" = b.id
        where b.authors @> array[p_key]
          and b."isActive" is distinct from false
          and b.id is distinct from p_exclude_id
          and not (b.id = any (v_saved))
        order by lower(b.title), pop desc, b.id
      )
      select b.* from works w join books b on b.id = w.id
      order by w.pop desc, w.title, w.id
      offset v_off limit v_lim;
  end if;
end;
$$;

revoke execute on function public.get_shelf_books(text, text, int, int, text) from public, anon;
grant execute on function public.get_shelf_books(text, text, int, int, text) to authenticated;

-- ── Recommended ─────────────────────────────────────────────────────────────
-- Same as migration 22, plus: candidates sharing the user's top 4 themes/moods,
-- + 20 × tag fit, + 5 when the book is in the reader type's genre, and the
-- reader type's genre in the genre profile. match_reason can now be 'theme'.
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
           coalesce(u."preferredSubcategories", '{}') as subjects,
           u."readerGenre"                            as reader_genre
    from users u
    where u.id = p_user_id
  ),
  -- Shared taste profile (migration 42): theme/mood tags for candidates + scoring.
  taste as (select * from fn_user_taste(p_user_id)),
  pref_tags as (
    select t.key from taste t where t.kind = 'tag' order by t.w desc limit 4
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
      union all
      -- The saved reader type's genre counts like two saves.
      select g.id, 2.0
      from prefs p join genres g on g.slug = p.reader_genre
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
  -- Books that share the user's strongest themes/moods.
  cand_tag as (
    select bt.book_id
    from book_tags bt
    join tags t on t.id = bt.tag_id
    join pref_tags p on p.key = t.slug
    group by bt.book_id
    order by count(*) desc, md5(bt.book_id || p_user_id::text || current_date::text)
    limit 600
  ),
  cand as (
    select c.book_id
    from (
      select book_id from cand_author
      union select book_id from cand_subject
      union select book_id from cand_genre
      union select book_id from cand_popular
      union select book_id from cand_tag
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
      coalesce((
        select least(1.0, sum(t.w * case when bt.strength = 'clear' then 1 else 0.6 end) / 2.0)
        from book_tags bt join tags tg on tg.id = bt.tag_id
        join taste t on t.kind = 'tag' and t.key = tg.slug
        where bt.book_id = c.book_id
      ), 0) as tag_fit,
      exists (
        select 1 from book_genres bg join genres g on g.id = bg.genre_id
        join prefs pr on g.slug = pr.reader_genre
        where bg.book_id = c.book_id
      ) as reader_genre_match,
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
            + 20 * p.tag_fit
            + (case when p.reader_genre_match then 5 else 0 end)
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
        when s.tag_fit >= 0.5 then 'theme'
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
