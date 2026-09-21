-- ─────────────────────────────────────────────────────────────────────
-- SIGNUP + ONBOARDING FUNNEL
--
-- Answers: of the people who discovered Selida this week, how many made
-- it to a finished account — and which screen lost the rest?
--
-- Read it left to right. The biggest drop between two adjacent columns
-- is the screen worth fixing first.
--
-- DELIBERATE CHOICE — new devices only: this counts only devices whose
-- FIRST EVER event falls inside the window. Without that restriction,
-- every existing user opening the app inflates `opened_app` and the
-- funnel looks far worse than it is. If you retype this query ad hoc,
-- this is the bit you will forget.
--
-- Counting is by "deviceId", not "userId", because the top of the funnel
-- happens before an account exists.
--
-- Caveats worth knowing before you read a number as bad news:
--  - A device that reinstalls the app gets a new deviceId and counts as
--    a new person.
--  - `opened_app` requires the app to have reached the root layout, so
--    a crash-on-launch (see errors-by-context.sql) shows up as people
--    who never existed rather than people who dropped.
--
-- Window: change the interval on the `first_at >=` line below.
-- ─────────────────────────────────────────────────────────────────────

with first_seen as (
  select "deviceId", min("createdAt") as first_at
  from public."appEvents"
  group by "deviceId"
),
new_devices as (
  select "deviceId"
  from first_seen
  where first_at >= now() - interval '7 days'
),
stages as (
  select
    count(distinct e."deviceId") filter (where e.event = 'app_open')                as opened_app,
    count(distinct e."deviceId") filter (where e.event = 'signup_started')          as started_signup,
    count(distinct e."deviceId") filter (where e.event = 'signup_completed')        as created_account,
    count(distinct e."deviceId") filter (where e.event = 'onboarding_started')      as began_setup,
    count(distinct e."deviceId") filter (where e.event = 'onboarding_gate_reached') as picked_3_chips,
    count(distinct e."deviceId") filter (where e.event = 'onboarding_complete')     as finished_setup,
    -- Not part of the funnel, but the number that says whether the
    -- people who DID get through are actually using the app.
    count(distinct e."deviceId") filter (where e.event = 'search_performed')        as searched_at_least_once
  from public."appEvents" e
  join new_devices n on n."deviceId" = e."deviceId"
)
select
  opened_app,
  started_signup,
  created_account,
  began_setup,
  picked_3_chips,
  finished_setup,
  searched_at_least_once,
  -- Step-to-step conversion. nullif guards the empty-table case so this
  -- returns nulls instead of a divide-by-zero error.
  round(100.0 * started_signup  / nullif(opened_app, 0), 1)      as pct_open_to_signup,
  round(100.0 * created_account / nullif(started_signup, 0), 1)  as pct_signup_to_account,
  round(100.0 * picked_3_chips  / nullif(began_setup, 0), 1)     as pct_setup_to_gate,
  round(100.0 * finished_setup  / nullif(picked_3_chips, 0), 1)  as pct_gate_to_finish,
  -- The headline number: discovered the app → usable account.
  round(100.0 * finished_setup  / nullif(opened_app, 0), 1)      as pct_overall
from stages;
