-- =============================================================================
-- Migration 07: Fix the genre backfill function
-- =============================================================================
-- migration_06 shipped fn_resolve_all_book_genres() as a row-by-row loop over
-- books that have no book_genres row yet. That was wrong on two counts:
--
--   1. NON-TERMINATING. ~68% of books match no mapping rule, so they never get
--      a book_genres row and are re-selected on every run. `books_processed`
--      can never reach 0, and each run re-does the same failed work.
--
--   2. SLOW. 5,000 books per batch × (1 DELETE + 1 INSERT) = 10,000 statements
--      for what is fundamentally one set-based query over ~21k signal rows.
--
-- This replaces it with a single pass over the whole catalog. It is idempotent
-- (clears method='mapping' rows first, so re-running is always safe) and leaves
-- method='llm' / 'manual' assignments untouched.
--
-- Run AFTER migration_06_genres.sql.
-- =============================================================================

DROP FUNCTION IF EXISTS fn_resolve_all_book_genres(int);
DROP FUNCTION IF EXISTS fn_resolve_all_book_genres();

CREATE OR REPLACE FUNCTION fn_resolve_all_book_genres()
RETURNS TABLE (books_matched bigint, genres_assigned bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Rebuild every rule-derived assignment from scratch; LLM/manual rows survive.
  DELETE FROM book_genres WHERE method = 'mapping';

  RETURN QUERY
  WITH signals AS (
    SELECT b.id AS book_id,
           'category'::text AS signal_type,
           UNNEST(b.categories) AS raw_value,
           COALESCE(b.source, 'biblionet') AS source
    FROM books b
    UNION ALL
    SELECT b.id,
           'subject'::text,
           UNNEST(b.subcategories),
           COALESCE(b.source, 'biblionet')
    FROM books b
  ),
  scored AS (
    SELECT s.book_id,
           m.genre_id,
           LEAST(1.0, SUM(m.weight))::real AS confidence
    FROM signals s
    JOIN genre_mappings m
      ON m.source      = s.source
     AND m.signal_type = s.signal_type
     AND m.raw_value   = s.raw_value
    GROUP BY s.book_id, m.genre_id
  ),
  ranked AS (
    SELECT sc.book_id,
           sc.genre_id,
           sc.confidence,
           ROW_NUMBER() OVER (
             PARTITION BY sc.book_id ORDER BY sc.confidence DESC, sc.genre_id
           ) = 1 AS is_primary
    FROM scored sc
  ),
  ins AS (
    INSERT INTO book_genres (book_id, genre_id, confidence, method, is_primary)
    SELECT r.book_id, r.genre_id, r.confidence, 'mapping', r.is_primary
    FROM ranked r
    ON CONFLICT (book_id, genre_id) DO UPDATE
      SET confidence = EXCLUDED.confidence,
          is_primary = EXCLUDED.is_primary,
          method     = 'mapping'
    RETURNING book_genres.book_id
  )
  SELECT COUNT(DISTINCT i.book_id)::bigint, COUNT(*)::bigint FROM ins i;
END;
$$;

-- =============================================================================
-- Run it — ONCE, no looping required:
--
--   SELECT * FROM fn_resolve_all_book_genres();
--
-- Then check the result:
--
--   SELECT * FROM get_browsable_genres();
--
--   SELECT COUNT(DISTINCT book_id) AS classified,
--          (SELECT COUNT(*) FROM books) AS total
--   FROM book_genres;
--
-- Expect ~32% of books classified. The remaining ~68% is the "Γενικά βιβλία"
-- bulk with unsynced subject headings — it needs either the subcategory sync
-- finished or an LLM classification pass, not another backfill run.
-- =============================================================================
