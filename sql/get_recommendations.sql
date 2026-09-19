-- =============================================================================
-- get_book_recommendations
-- -----------------------------------------------------------------------------
-- Server-side recommendation scoring for Selida.
--
-- Receives the user's extracted preference signals (already weighted client-side
-- by status × recency decay, then reduced to top-N arrays) plus a source filter
-- and a list of ids to exclude. Joins books + bookStats once and returns the
-- top p_limit candidates pre-scored, in a single round-trip.
--
-- Scoring weights:
--   author match       +20
--   category match     +15
--   subcategory match  +12
--   publisher match    +8
--   language mismatch  -15
--   popularity boost   capped at +10, with recency multiplier on lastActivityAt
--
-- popularity raw =
--   log(1+views)*0.5 + log(1+wishlist)*1.0 + log(1+reading)*1.5 + log(1+completed)*2.0
-- recency multiplier =
--   0.65 + 0.35 * exp(-ageDays / 45)
--
-- Tags dimension removed: searchTags was a Firebase-era prefix array replaced
-- by pg_trgm trigram search. Subcategories are the correct fine-grained signal.
--
-- SECURITY DEFINER so it can read books + bookStats regardless of the caller's
-- RLS context. Only reads catalog/aggregate data — no per-user rows.
-- =============================================================================

-- Drop both old and new signatures to handle return-type changes cleanly
drop function if exists get_book_recommendations(text[],text[],text[],text[],text[],text,text,text[],integer);
drop function if exists get_book_recommendations(text[],text[],text[],text[],text,text,text[],integer);

create or replace function get_book_recommendations(
  p_categories         text[],
  p_subcategories      text[],
  p_authors            text[],
  p_publishers         text[],
  p_preferred_language text,
  p_source             text,
  p_exclude_ids        text[],
  p_limit              int default 200
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
  with scored as (
    select
      b.id,
      b.title,
      b.subtitle,
      b.authors,
      b.categories,
      b.subcategories,
      b.publisher,
      b.language,
      b.source,
      b."coverUrl",
      b."pageCount",
      b."popularityCount",
      b."biblionetId",
      b."syncedSub",
      b.description,
      b.isbn,
      b."publishedYear",
      b.edition,
      b.series,

      -- ---- preference match flags -------------------------------------------
      (coalesce(p_categories,    '{}') <> '{}' and b.categories    && p_categories)    as cat_match,
      (coalesce(p_subcategories, '{}') <> '{}' and b.subcategories && p_subcategories) as sub_match,
      (coalesce(p_authors,       '{}') <> '{}' and b.authors       && p_authors)       as auth_match,
      (coalesce(p_publishers,    '{}') <> '{}' and b.publisher = any(p_publishers))    as pub_match,

      -- ---- popularity boost (capped at 10, recency-decayed) ------------------
      least(
        (
          ln(1 + coalesce(s.views, 0))     * 0.5 +
          ln(1 + coalesce(s.wishlist, 0))  * 1.0 +
          ln(1 + coalesce(s.reading, 0))   * 1.5 +
          ln(1 + coalesce(s.completed, 0)) * 2.0
        )
        * (
          case
            when s."lastActivityAt" is null then 1.0
            else 0.65 + 0.35 * exp(
              -greatest(0, extract(epoch from (now() - s."lastActivityAt")) / 86400.0) / 45.0
            )
          end
        ),
        10.0
      ) as popularity_boost
    from books b
    left join "bookStats" s on s."bookId" = b.id
    where
      b."isActive" is distinct from false
      and (p_source is null or b.source = p_source)
      and (p_exclude_ids is null or not (b.id = any(p_exclude_ids)))
      -- must match at least one signal; trending fallback is handled client-side
      and (
        (coalesce(p_categories,    '{}') <> '{}' and b.categories    && p_categories) or
        (coalesce(p_subcategories, '{}') <> '{}' and b.subcategories && p_subcategories) or
        (coalesce(p_authors,       '{}') <> '{}' and b.authors       && p_authors)
      )
  ),
  final as (
    select
      scored.*,
      (
        (case when cat_match  then 15 else 0 end) +
        (case when sub_match  then 12 else 0 end) +
        (case when auth_match then 20 else 0 end) +
        (case when pub_match  then 8  else 0 end) +
        (case
           when p_preferred_language is not null
            and language is not null
            and language <> p_preferred_language
           then -15 else 0
         end)
        + popularity_boost
      ) as final_score,
      array_to_string(
        array_remove(array[
          case when auth_match then 'Similar Author'    end,
          case when cat_match  then 'Similar Category'  end,
          case when sub_match  then 'Similar Theme'     end,
          case when pub_match  then 'Favorite Publisher' end
        ], null),
        ', '
      ) as reason
    from scored
  )
  select
    id, title, subtitle, authors, categories, subcategories,
    publisher, language, source, "coverUrl", "pageCount",
    "popularityCount", "biblionetId", "syncedSub",
    description, isbn, "publishedYear", edition, series,
    final_score as score,
    nullif(reason, '') as match_reason
  from final
  order by final_score desc
  limit p_limit;
$$;

grant execute on function get_book_recommendations(
  text[], text[], text[], text[], text, text, text[], int
) to authenticated, anon;