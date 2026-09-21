-- ─────────────────────────────────────────────────────────────────────
-- WHAT IS BREAKING, GROUPED
--
-- Answers: which part of the app is failing, how often, and for how
-- many different people?
--
-- `users_affected` is the triage column, not `occurrences`. One user
-- hitting a retry loop 400 times is a smaller problem than 40 users
-- hitting something once each, even though it dwarfs it on raw count.
--
-- `ever_crashed_a_screen` (the `fatal` flag) marks errors that took
-- down a React subtree and showed the "Something went wrong" screen, as
-- opposed to handled errors reported for visibility. Fix those first.
--
-- Messages are grouped on their first 120 characters, which merges
-- errors whose tails differ (ids, URLs) while keeping genuinely
-- different failures apart. It is a heuristic — a real crash reporter
-- would group on a normalised stack signature.
--
-- NOTE on coverage: only call sites that use `logError` from
-- services/errorLog.ts reach this table. Anything still using a bare
-- `console.error` is invisible here, so an empty result does NOT mean
-- nothing is failing.
-- ─────────────────────────────────────────────────────────────────────

select
  context,
  left(message, 120)                                           as message,
  count(*)                                                     as occurrences,
  count(distinct "userId") filter (where "userId" is not null)  as users_affected,
  count(*) filter (where "userId" is null)                      as anonymous_hits,
  bool_or(fatal)                                               as ever_crashed_a_screen,
  array_agg(distinct platform)                                  as platforms,
  max("appVersion")                                            as newest_version_seen,
  min("createdAt")                                             as first_seen,
  max("createdAt")                                             as last_seen
from public."errorLogs"
where "createdAt" >= now() - interval '7 days'
group by context, left(message, 120)
order by ever_crashed_a_screen desc, users_affected desc, occurrences desc
limit 50;
