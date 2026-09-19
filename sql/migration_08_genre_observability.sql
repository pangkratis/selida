-- =============================================================================
-- Migration 08: Genre coverage observability
-- =============================================================================
-- Closes a blind spot left by migration_06/07.
--
-- The problem:
--   syncSubcategories() writes new subject headings into books.subcategories.
--   That fires trg_sync_book_subcategories (registers the name) and
--   trg_sync_book_genres (resolves genres). But if the new heading has no rule
--   in genre_mappings, it contributes NOTHING — silently. No error, no queue.
--   As the sync progresses from 7% to 100%, thousands of new headings will
--   appear and there is currently no way to see which ones are costing coverage.
--
-- This adds two read-only RPCs so the gap is observable instead of invisible:
--   get_unmapped_subjects()  — which headings to write rules for, ranked by payoff
--   get_genre_coverage()     — one-call health check on classification progress
--
-- Both are STABLE and read-only. Run AFTER migration_07_fix_backfill.sql.
-- =============================================================================

-- ── get_unmapped_subjects ─────────────────────────────────────────────────────
-- Subject headings that exist on books but have no genre_mappings rule.
-- Ordered by how many books each would unlock, so the top rows are always the
-- highest-value rules to add next. sample_title helps judge whether a heading
-- is a real genre signal or a Thema-style qualifier that SHOULD stay unmapped
-- (place, language, period, audience — see migration_06 notes).

CREATE OR REPLACE FUNCTION get_unmapped_subjects(p_limit int DEFAULT 40)
RETURNS TABLE (
  subject_name text,
  book_count   bigint,
  sample_title text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    s.name,
    COUNT(bs.book_id)::bigint,
    MIN(b.title)
  FROM subcategories s
  JOIN book_subcategories bs ON bs.subcategory_id = s.id
  JOIN books b               ON b.id = bs.book_id
  WHERE NOT EXISTS (
    SELECT 1 FROM genre_mappings m
    WHERE m.source      = 'biblionet'
      AND m.signal_type = 'subject'
      AND m.raw_value   = s.name
  )
  GROUP BY s.id, s.name
  ORDER BY COUNT(bs.book_id) DESC, s.name
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION get_unmapped_subjects(int) TO authenticated, anon;

-- ── get_genre_coverage ────────────────────────────────────────────────────────
-- Single-row health check. Run before and after each subcategory sync batch to
-- watch coverage climb.
--
-- unclassified_with_subjects is the important one: books that HAVE subject
-- headings but still resolved to no genre. Those are rule gaps, not data gaps —
-- they are fixable by adding genre_mappings rows, no LLM needed.

CREATE OR REPLACE FUNCTION get_genre_coverage()
RETURNS TABLE (
  total_books                bigint,
  classified                 bigint,
  pct_classified             numeric,
  via_mapping                bigint,
  via_llm                    bigint,
  unclassified_with_subjects bigint,
  subjects_synced            bigint,
  subjects_pending           bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(*) FROM books)::bigint,
    (SELECT COUNT(DISTINCT bg.book_id) FROM book_genres bg)::bigint,
    ROUND(
      100.0 * (SELECT COUNT(DISTINCT bg.book_id) FROM book_genres bg)
            / NULLIF((SELECT COUNT(*) FROM books), 0), 1
    ),
    (SELECT COUNT(DISTINCT bg.book_id) FROM book_genres bg WHERE bg.method = 'mapping')::bigint,
    (SELECT COUNT(DISTINCT bg.book_id) FROM book_genres bg WHERE bg.method = 'llm')::bigint,
    (SELECT COUNT(*) FROM books b
      WHERE b.subcategories IS NOT NULL
        AND array_length(b.subcategories, 1) > 0
        AND NOT EXISTS (SELECT 1 FROM book_genres bg WHERE bg.book_id = b.id))::bigint,
    (SELECT COUNT(*) FROM books WHERE "syncedSub" = true)::bigint,
    (SELECT COUNT(*) FROM books WHERE "syncedSub" IS DISTINCT FROM true)::bigint;
$$;

GRANT EXECUTE ON FUNCTION get_genre_coverage() TO authenticated, anon;

-- =============================================================================
-- Usage
--
--   -- health check (run before/after each sync batch)
--   SELECT * FROM get_genre_coverage();
--
--   -- what to write rules for next
--   SELECT * FROM get_unmapped_subjects(40);
--
--   -- after adding rules to genre_mappings, rebuild (safe + idempotent;
--   -- only touches method='mapping', LLM/manual rows survive)
--   SELECT * FROM fn_resolve_all_book_genres();
--
-- Reading get_unmapped_subjects: NOT every row deserves a rule. Qualifiers must
-- stay unmapped — place (Ελλάς, Μεσσηνία), language (Μεταφράσεις στα αγγλικά),
-- period (1940-, 1967-1974), education/reference (Σπουδή και διδασκαλία,
-- Εγκυκλοπαίδειες και λεξικά). Mapping those makes genre quality worse.
-- Map a heading only when it names a genre, form, or audience.
-- =============================================================================
