-- ─────────────────────────────────────────────────────────────────────
-- SEARCHES THAT FOUND NOTHING
--
-- Answers: what are people looking for that the catalog doesn't have?
--
-- This is your catalog to-do list, ranked by demand. Every row is a
-- real person who wanted a book and got an empty screen.
--
-- `people` matters more than `searches` when deciding what to act on:
-- 30 searches from one determined person is a different signal from
-- 30 people searching once each. Sorted by people first for that reason.
--
-- Before treating a row as "missing book", check the spelling — Greek
-- input with Latin characters (or the reverse) lands here too, and that
-- is a search-normalisation bug rather than a catalog gap.
--
-- Window: change the interval below. 30 days is a reasonable default;
-- searches are lower-volume than opens, so a 7-day window may be thin.
-- ─────────────────────────────────────────────────────────────────────

select
  metadata->>'query'                                          as query,
  count(*)                                                    as searches,
  -- Falls back to deviceId so searches from a signed-out session still
  -- count as a distinct person rather than collapsing into one null.
  count(distinct coalesce("userId"::text, "deviceId"))         as people,
  max("createdAt")                                            as last_searched
from public."appEvents"
where event = 'search_performed'
  and metadata ? 'resultCount'
  and (metadata->>'resultCount')::int = 0
  and "createdAt" >= now() - interval '30 days'
group by metadata->>'query'
order by people desc, searches desc
limit 50;
