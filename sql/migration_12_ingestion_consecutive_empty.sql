-- Adds tracking for consecutive fully-empty months to ingestion_cursor,
-- replacing the old hardcoded STOP_YEAR=2015 cutoff. The crawl should
-- stop based on actually running out of books (several consecutive
-- months with zero titles), not an arbitrary year — see
-- services/catalog-ingestion.ts's advance() for the logic.

alter table public.ingestion_cursor
  add column if not exists "consecutiveEmptyMonths" integer not null default 0;
