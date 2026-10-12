-- Fixes "Sync subcategories" throwing a 57014 (statement timeout) error.
-- services/catalog-ingestion.ts's syncSubcategories() selects:
--   WHERE "syncedSub" = false AND "biblionetId" IS NOT NULL
--   ORDER BY "popularityCount" DESC LIMIT 900
-- books has grown to ~187,500 rows with no index supporting this filter/sort,
-- forcing a full scan + sort that now exceeds the statement timeout.
-- Confirmed live: the same filter without ORDER BY returns instantly; adding
-- ORDER BY "popularityCount" DESC reproduces the 57014 error directly via curl.
--
-- Partial index matching the query shape exactly, so Postgres can satisfy
-- WHERE + ORDER BY + LIMIT with an index scan instead of a full-table sort.
CREATE INDEX IF NOT EXISTS books_subsync_queue_idx
ON public.books ("popularityCount" DESC)
WHERE "syncedSub" = false AND "biblionetId" IS NOT NULL;
