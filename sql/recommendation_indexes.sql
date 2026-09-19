-- =============================================================================
-- Indexes supporting get_book_recommendations
-- -----------------------------------------------------------------------------
-- The function relies on array-overlap (&&) and = any() probes across four
-- array columns plus an equality on `source`. GIN indexes make the && / any()
-- predicates index-assisted instead of full sequential scans.
--
-- Run once in the Supabase SQL editor. CONCURRENTLY avoids locking the table;
-- it must be run outside a transaction block (Supabase editor runs each
-- statement standalone, which is fine).
-- =============================================================================

create index if not exists books_categories_gin
  on books using gin (categories);

create index if not exists books_subcategories_gin
  on books using gin (subcategories);

create index if not exists books_authors_gin
  on books using gin (authors);

create index if not exists books_searchtags_gin
  on books using gin ("searchTags");

create index if not exists books_source_idx
  on books (source);

-- bookStats is joined by primary key (bookId) which is already indexed as PK.