-- =============================================================================
-- Migration 02: Normalize categories and subcategories
-- =============================================================================
-- Run AFTER migration_01_search.sql.
--
-- What this does:
--   1. Creates subcategories + book_subcategories junction tables
--   2. Creates categories + book_categories junction tables
--   3. Backfills both from existing books.subcategories / books.categories arrays
--   4. Adds triggers to keep junction tables in sync when books are upserted
--   5. Creates get_popular_subcategories() RPC (used by onboarding chips)
--
-- The books.subcategories and books.categories arrays are KEPT for now —
-- the recommendation RPC still uses them for fast array-overlap matching.
-- Drop them only after confirming nothing else depends on them.
-- =============================================================================

-- ── subcategories ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.subcategories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text UNIQUE NOT NULL,
  "createdAt" timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.book_subcategories (
  book_id        text NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  subcategory_id uuid NOT NULL REFERENCES public.subcategories(id) ON DELETE CASCADE,
  PRIMARY KEY (book_id, subcategory_id)
);

CREATE INDEX IF NOT EXISTS book_subcategories_sub_id ON public.book_subcategories(subcategory_id);
CREATE INDEX IF NOT EXISTS book_subcategories_book_id ON public.book_subcategories(book_id);

-- ── categories ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text UNIQUE NOT NULL,
  "createdAt" timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.book_categories (
  book_id     text NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  PRIMARY KEY (book_id, category_id)
);

CREATE INDEX IF NOT EXISTS book_categories_cat_id  ON public.book_categories(category_id);
CREATE INDEX IF NOT EXISTS book_categories_book_id ON public.book_categories(book_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.subcategories    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.book_subcategories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.book_categories    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subcategories_public_read"      ON public.subcategories      FOR SELECT USING (true);
CREATE POLICY "categories_public_read"         ON public.categories         FOR SELECT USING (true);
CREATE POLICY "book_subcategories_public_read" ON public.book_subcategories FOR SELECT USING (true);
CREATE POLICY "book_categories_public_read"    ON public.book_categories    FOR SELECT USING (true);

-- ── Backfill from existing books arrays ──────────────────────────────────────

-- Populate subcategories lookup
INSERT INTO subcategories (name)
SELECT DISTINCT unnested_sub
FROM books, UNNEST(subcategories) AS unnested_sub
WHERE unnested_sub IS NOT NULL AND unnested_sub <> ''
ON CONFLICT (name) DO NOTHING;

-- Populate book_subcategories junction
INSERT INTO book_subcategories (book_id, subcategory_id)
SELECT b.id, s.id
FROM books b
CROSS JOIN LATERAL UNNEST(b.subcategories) AS unnested_sub
JOIN subcategories s ON s.name = unnested_sub
WHERE unnested_sub IS NOT NULL AND unnested_sub <> ''
ON CONFLICT DO NOTHING;

-- Populate categories lookup
INSERT INTO categories (name)
SELECT DISTINCT unnested_cat
FROM books, UNNEST(categories) AS unnested_cat
WHERE unnested_cat IS NOT NULL AND unnested_cat <> ''
ON CONFLICT (name) DO NOTHING;

-- Populate book_categories junction
INSERT INTO book_categories (book_id, category_id)
SELECT b.id, c.id
FROM books b
CROSS JOIN LATERAL UNNEST(b.categories) AS unnested_cat
JOIN categories c ON c.name = unnested_cat
WHERE unnested_cat IS NOT NULL AND unnested_cat <> ''
ON CONFLICT DO NOTHING;

-- ── Triggers: keep junctions in sync on every book upsert ────────────────────

CREATE OR REPLACE FUNCTION fn_sync_book_subcategories()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM book_subcategories WHERE book_id = NEW.id;

  IF NEW.subcategories IS NOT NULL AND array_length(NEW.subcategories, 1) > 0 THEN
    INSERT INTO subcategories (name)
    SELECT DISTINCT unnested_sub
    FROM UNNEST(NEW.subcategories) AS unnested_sub
    WHERE unnested_sub IS NOT NULL AND unnested_sub <> ''
    ON CONFLICT (name) DO NOTHING;

    INSERT INTO book_subcategories (book_id, subcategory_id)
    SELECT NEW.id, s.id
    FROM UNNEST(NEW.subcategories) AS unnested_sub
    JOIN subcategories s ON s.name = unnested_sub
    WHERE unnested_sub IS NOT NULL AND unnested_sub <> ''
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_book_subcategories ON books;
CREATE TRIGGER trg_sync_book_subcategories
AFTER INSERT OR UPDATE OF subcategories ON books
FOR EACH ROW EXECUTE FUNCTION fn_sync_book_subcategories();

CREATE OR REPLACE FUNCTION fn_sync_book_categories()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM book_categories WHERE book_id = NEW.id;

  IF NEW.categories IS NOT NULL AND array_length(NEW.categories, 1) > 0 THEN
    INSERT INTO categories (name)
    SELECT DISTINCT unnested_cat
    FROM UNNEST(NEW.categories) AS unnested_cat
    WHERE unnested_cat IS NOT NULL AND unnested_cat <> ''
    ON CONFLICT (name) DO NOTHING;

    INSERT INTO book_categories (book_id, category_id)
    SELECT NEW.id, c.id
    FROM UNNEST(NEW.categories) AS unnested_cat
    JOIN categories c ON c.name = unnested_cat
    WHERE unnested_cat IS NOT NULL AND unnested_cat <> ''
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_book_categories ON books;
CREATE TRIGGER trg_sync_book_categories
AFTER INSERT OR UPDATE OF categories ON books
FOR EACH ROW EXECUTE FUNCTION fn_sync_book_categories();

-- ── get_popular_subcategories RPC ─────────────────────────────────────────────
-- Used by onboarding chips and future analytics.
-- Joins junction table → avoids UNNEST on every call.

DROP FUNCTION IF EXISTS get_popular_subcategories(int);

CREATE OR REPLACE FUNCTION get_popular_subcategories(p_limit int DEFAULT 40)
RETURNS TABLE (name text, book_count bigint, total_popularity bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    s.name,
    COUNT(bs.book_id)::bigint                          AS book_count,
    COALESCE(SUM(bk."popularityCount"), 0)::bigint     AS total_popularity
  FROM subcategories s
  JOIN book_subcategories bs ON bs.subcategory_id = s.id
  JOIN books bk ON bk.id = bs.book_id
  WHERE bk."isActive" IS DISTINCT FROM false
  GROUP BY s.id, s.name
  HAVING COUNT(bs.book_id) >= 3
  ORDER BY total_popularity DESC, book_count DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION get_popular_subcategories(int) TO authenticated, anon;