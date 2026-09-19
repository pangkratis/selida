-- =============================================================================
-- Migration 01: Trigram search (replaces searchTags prefix array)
-- =============================================================================
-- Run FIRST in Supabase SQL editor.
--
-- What this does:
--   1. Enables pg_trgm and unaccent extensions
--   2. Adds a stored search_text column (lowercase, diacritic-stripped title+authors)
--      maintained by a trigger — no app code needed to populate it
--   3. Creates a GIN trigram index on search_text for fast ILIKE queries
--   4. Creates search_books() RPC used by books-grid.tsx
--
-- After the app is deployed and confirmed working, you can optionally drop
-- the now-unused searchTags column:
--   ALTER TABLE books DROP COLUMN IF EXISTS "searchTags";
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ── search_text column ────────────────────────────────────────────────────────
-- Stored, auto-maintained by trigger below.
-- Lowercase + diacritic-stripped concatenation of title and authors.
ALTER TABLE books ADD COLUMN IF NOT EXISTS search_text text;

CREATE OR REPLACE FUNCTION fn_books_search_text()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_text := lower(
    unaccent(NEW.title || ' ' || COALESCE(array_to_string(NEW.authors, ' '), ''))
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_books_search_text ON books;
CREATE TRIGGER trg_books_search_text
BEFORE INSERT OR UPDATE OF title, authors ON books
FOR EACH ROW EXECUTE FUNCTION fn_books_search_text();

-- Backfill existing rows
UPDATE books
SET search_text = lower(
  unaccent(title || ' ' || COALESCE(array_to_string(authors, ' '), ''))
);

-- ── GIN trigram index ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS books_search_text_trgm
  ON books USING gin(search_text gin_trgm_ops);

-- ── search_books RPC ──────────────────────────────────────────────────────────
-- Called by books-grid.tsx instead of .overlaps('searchTags', tokens).
-- Handles Greek diacritics server-side; app no longer needs to strip them.
-- Returns books ordered by trigram similarity desc, then popularityCount desc.
DROP FUNCTION IF EXISTS search_books(text, int);

CREATE OR REPLACE FUNCTION search_books(p_query text, p_limit int DEFAULT 200)
RETURNS SETOF books
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT b.*
  FROM books b
  WHERE
    b."isActive" IS DISTINCT FROM false
    AND b.search_text ILIKE '%' || lower(unaccent(p_query)) || '%'
  ORDER BY
    similarity(b.search_text, lower(unaccent(p_query))) DESC,
    COALESCE(b."popularityCount", 0) DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION search_books(text, int) TO authenticated, anon;
