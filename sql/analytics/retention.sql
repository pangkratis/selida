-- ─────────────────────────────────────────────────────────────────────
-- RETENTION BY SIGNUP COHORT
--
-- Answers: do people come back? This is the only number that really
-- says whether Selida works — everything else measures whether people
-- can get in the door.
--
-- One row per signup day. `returned_next_day` is strict (active on
-- exactly cohort day + 1); `returned_within_7` is any activity in days
-- 1-7 after signup. At MVP volumes the strict version is very noisy,
-- so read `returned_within_7` as the real signal and treat
-- `returned_next_day` as a bonus.
--
-- READ THE TWO RIGHTMOST COLUMNS BEFORE BELIEVING A ZERO.
-- A cohort that signed up yesterday cannot have day-7 data yet, and
-- will show 0 — which is not the same as nobody coming back.
-- `day_1_measurable` / `day_7_measurable` say whether enough calendar
-- time has passed for that cell to mean anything.
--
-- HARD FLOOR ON THE DATA: `app_open` events only start on 2026-09-21
-- (migration_16). Any cohort that signed up before that date will show
-- 0 returns because the events did not exist yet, not because the users
-- left. Ignore cohorts older than that entirely.
--
-- Activity is defined as an `app_open`, which fires on cold launch and
-- on resume after a 30-minute gap — so a user who opens the app once
-- and reads for an hour correctly counts as one active day.
-- ─────────────────────────────────────────────────────────────────────

with cohorts as (
  select
    u.id                                    as user_id,
    date_trunc('day', u."createdAt")::date  as cohort_day
  from public.users u
  where u."createdAt" >= now() - interval '30 days'
),
active_days as (
  select distinct
    "userId"                                as user_id,
    date_trunc('day', "createdAt")::date    as active_day
  from public."appEvents"
  where event = 'app_open'
    and "userId" is not null
)
select
  c.cohort_day                                                        as signed_up_on,
  count(distinct c.user_id)                                           as users,
  count(distinct c.user_id) filter (where d1.user_id is not null)     as returned_next_day,
  count(distinct c.user_id) filter (where w7.user_id is not null)     as returned_within_7,
  round(
    100.0 * count(distinct c.user_id) filter (where d1.user_id is not null)
    / nullif(count(distinct c.user_id), 0), 1
  )                                                                   as pct_next_day,
  round(
    100.0 * count(distinct c.user_id) filter (where w7.user_id is not null)
    / nullif(count(distinct c.user_id), 0), 1
  )                                                                   as pct_within_7,
  (c.cohort_day + 1 <= current_date)                                  as day_1_measurable,
  (c.cohort_day + 7 <= current_date)                                  as day_7_measurable
from cohorts c
left join active_days d1
  on d1.user_id = c.user_id
 and d1.active_day = c.cohort_day + 1
left join active_days w7
  on w7.user_id = c.user_id
 and w7.active_day between c.cohort_day + 1 and c.cohort_day + 7
group by c.cohort_day
order by c.cohort_day desc;
