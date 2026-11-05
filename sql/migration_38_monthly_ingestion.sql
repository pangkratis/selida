-- Monthly catalog ingestion (2026-11-03).
--
-- New Biblionet books used to arrive only when an admin ran the backward crawl
-- in the dev app (ingestion_cursor). This adds them automatically:
--   * ingest_months — one row per month: status, next page, and how many books
--     were found / added / already in the catalog / skipped (no cover, id or summary).
--   * On the 1st of each month (03:00 UTC) the month that just ended is queued,
--     and the month before it is queued again — Biblionet keeps adding a month's
--     books for weeks, and a re-check costs only a few requests because books
--     already in the catalog are skipped (insert … on conflict do nothing).
--   * Every 10 minutes, while a month is queued, the `ingest-month` Edge Function
--     reads a few pages (100 books each, ~8 s per page) within a daily budget.
--     The subcategory sync uses 900 of Biblionet's 1,000 requests a day, so this
--     keeps to 80.
--   * Catch-up: January–October 2026 are queued below.
--
-- ingestion_cursor (the manual backward crawl) is not touched.
--
-- One-off setup that is NOT in this file (it holds a secret):
--   1. supabase secrets set INGEST_CRON_SECRET=<random>
--   2. select vault.create_secret('<same random>', 'ingest_cron_secret');
--   3. supabase functions deploy ingest-month --no-verify-jwt
-- Pause / resume:  update ingest_state set enabled = false;  (true to resume)
-- Redo a month:    select fn_ingest_queue_month(2026, 5);
-- Remove:          select cron.unschedule('ingest-run'); select cron.unschedule('ingest-queue-monthly');

create table if not exists public.ingest_months (
  year         int         not null,
  month        int         not null check (month between 1 and 12),
  status       text        not null default 'queued' check (status in ('queued', 'done')),
  next_page    int         not null default 1,
  pages        int         not null default 0,
  found        int         not null default 0,
  added        int         not null default 0,
  already_had  int         not null default 0,
  skipped      int         not null default 0,
  queued_at    timestamptz not null default now(),
  done_at      timestamptz,
  primary key (year, month)
);

create table if not exists public.ingest_state (
  id             int primary key default 1 check (id = 1),
  enabled        boolean     not null default true,
  daily_limit    int         not null default 80,
  day            date        not null default ((now() at time zone 'utc')::date),
  requests_today int         not null default 0,
  paused_until   timestamptz,
  running_since  timestamptz,
  last_run_at    timestamptz,
  last_result    text,
  total_added    bigint      not null default 0
);
insert into public.ingest_state (id) values (1) on conflict (id) do nothing;

-- No policies: only the service role (Edge Function) and the database owner.
alter table public.ingest_months enable row level security;
alter table public.ingest_state  enable row level security;
revoke all on public.ingest_months, public.ingest_state from anon, authenticated;

-- Queue (or re-queue) one month. Counters keep adding up across re-checks.
create or replace function public.fn_ingest_queue_month(p_year int, p_month int)
returns void
language sql
security definer
set search_path = public
as $$
  insert into ingest_months (year, month) values (p_year, p_month)
  on conflict (year, month) do update
     set status = 'queued', next_page = 1, queued_at = now(), done_at = null;
$$;

-- Run by cron on the 1st: the month that just ended + the one before it.
create or replace function public.fn_ingest_queue_recent()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d date := date_trunc('month', now() at time zone 'utc')::date;
begin
  perform fn_ingest_queue_month(extract(year from d - interval '1 month')::int,  extract(month from d - interval '1 month')::int);
  perform fn_ingest_queue_month(extract(year from d - interval '2 months')::int, extract(month from d - interval '2 months')::int);
end;
$$;

create or replace function public.fn_ingest_should_run()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select s.enabled
     and (s.paused_until is null or s.paused_until <= now())
     and (s.running_since is null or s.running_since < now() - interval '8 minutes')
     and (case when s.day < (now() at time zone 'utc')::date
               then s.daily_limit
               else s.daily_limit - s.requests_today end) > 0
     and exists (select 1 from ingest_months where status = 'queued')
  from ingest_state s
  where s.id = 1;
$$;

-- Claims a run: how many requests it may make now (0 = do nothing).
create or replace function public.fn_ingest_begin(p_max int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed int;
begin
  update ingest_state
     set day = (now() at time zone 'utc')::date, requests_today = 0
   where id = 1 and day < (now() at time zone 'utc')::date;

  if not fn_ingest_should_run() then
    return 0;
  end if;

  select least(greatest(p_max, 0), s.daily_limit - s.requests_today)
    into v_allowed from ingest_state s where s.id = 1;
  if v_allowed > 0 then
    update ingest_state set running_since = now() where id = 1;
  end if;
  return coalesce(v_allowed, 0);
end;
$$;

-- Newest queued month first.
create or replace function public.fn_ingest_next_month()
returns table (year int, month int, next_page int)
language sql
stable
security definer
set search_path = public
as $$
  select m.year, m.month, m.next_page
  from ingest_months m
  where m.status = 'queued'
  order by m.year desc, m.month desc
  limit 1;
$$;

-- Records one page. p_finished = this was the month's last page.
create or replace function public.fn_ingest_page_done(
  p_year int, p_month int, p_page int,
  p_found int, p_added int, p_already int, p_skipped int, p_finished boolean
)
returns void
language sql
security definer
set search_path = public
as $$
  update ingest_months
     set next_page   = p_page + 1,
         pages       = greatest(pages, p_page),
         found       = found + p_found,
         added       = added + p_added,
         already_had = already_had + p_already,
         skipped     = skipped + p_skipped,
         status      = case when p_finished then 'done' else status end,
         done_at     = case when p_finished then now() else done_at end
   where year = p_year and month = p_month;
  update ingest_state set total_added = total_added + greatest(p_added, 0) where id = 1;
$$;

-- Closes a run. p_stopped = Biblionet kept failing: pause for a few hours.
create or replace function public.fn_ingest_end(p_requests int, p_stopped boolean, p_note text)
returns void
language sql
security definer
set search_path = public
as $$
  update ingest_state
     set requests_today = requests_today + greatest(p_requests, 0),
         running_since  = null,
         last_run_at    = now(),
         last_result    = p_note,
         paused_until   = case when p_stopped then now() + interval '4 hours' else paused_until end
   where id = 1;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'fn_ingest_queue_month(int,int)', 'fn_ingest_queue_recent()', 'fn_ingest_should_run()',
    'fn_ingest_begin(int)', 'fn_ingest_next_month()',
    'fn_ingest_page_done(int,int,int,int,int,int,int,boolean)', 'fn_ingest_end(int,boolean,text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ── Catch-up: January–October 2026 ──────────────────────────────────────────
select public.fn_ingest_queue_month(2026, m) from generate_series(1, 10) m;

-- ── Schedules ───────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from cron.job where jobname = 'ingest-run') then
    perform cron.unschedule('ingest-run');
  end if;
  if exists (select 1 from cron.job where jobname = 'ingest-queue-monthly') then
    perform cron.unschedule('ingest-queue-monthly');
  end if;
end $$;

select cron.schedule('ingest-queue-monthly', '0 3 1 * *', $$select public.fn_ingest_queue_recent()$$);

select cron.schedule('ingest-run', '*/10 * * * *', $cron$
  select net.http_post(
    url := 'https://rxovzritmmnpodojhfuj.supabase.co/functions/v1/ingest-month',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ingest_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  )
  where public.fn_ingest_should_run();
$cron$);
