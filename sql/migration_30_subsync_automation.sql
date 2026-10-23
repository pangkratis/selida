-- Automatic subcategory sync.
--
-- Until now syncSubcategories() only ran when an admin pressed the button in
-- the dev app. This moves it to Supabase: pg_cron calls the `sync-subcategories`
-- Edge Function every few minutes; each call syncs a small batch (Biblionet
-- takes ~5 s per book and an Edge Function can only run for so long), keeps
-- a per-day request counter against the 900/day budget, and pauses itself for
-- a few hours when Biblionet starts refusing requests (quota hit), so the
-- unknown reset time does not need to be known.
--
-- Order is the same as the button: the triage sync list first (oldest decision
-- first), then untriaged books by popularity. Skipped/review books are never
-- picked automatically.
--
-- One-off setup that is NOT in this file (it holds a secret):
--   1. supabase secrets set SUBSYNC_CRON_SECRET=<random>
--   2. select vault.create_secret('<same random>', 'subsync_cron_secret');
--   3. supabase functions deploy sync-subcategories --use-api --no-verify-jwt
-- Pause / resume:  update subsync_state set enabled = false;  (true to resume)
-- Remove:          select cron.unschedule('subsync-run');

create extension if not exists pg_net;

-- ── State: one row ───────────────────────────────────────────────────────────
create table if not exists public.subsync_state (
  id             int primary key default 1 check (id = 1),
  enabled        boolean     not null default true,
  daily_limit    int         not null default 900,
  day            date        not null default ((now() at time zone 'utc')::date),
  requests_today int         not null default 0,
  synced_today   int         not null default 0,
  paused_until   timestamptz,
  running_since  timestamptz,
  last_run_at    timestamptz,
  last_result    text,
  total_synced   bigint      not null default 0
);

insert into public.subsync_state (id) values (1) on conflict (id) do nothing;

-- No policies on purpose: only the service role (the Edge Function) and the
-- database owner can read or write it.
alter table public.subsync_state enable row level security;
revoke all on public.subsync_state from anon, authenticated;

-- ── The ordered queue, shared by the button and the automatic job ────────────
create or replace function public.fn_subsync_next_batch(p_limit int default 60)
returns table (id text, "biblionetId" text, title text, from_list boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_left int := least(greatest(coalesce(p_limit, 60), 1), 1000);
  v_n    int;
begin
  return query
    select b.id, b."biblionetId", b.title, true
    from book_triage t
    join books b on b.id = t.book_id
    where t.decision = 'priority'
      and b."syncedSub" = false
      and b."biblionetId" is not null
    order by t.decided_at
    limit v_left;
  get diagnostics v_n = row_count;
  v_left := v_left - v_n;
  if v_left <= 0 then return; end if;

  return query
    select b.id, b."biblionetId", b.title, false
    from books b
    where b."syncedSub" = false
      and b."biblionetId" is not null
      and not exists (select 1 from book_triage t where t.book_id = b.id)
    order by b."popularityCount" desc
    limit v_left;
end;
$$;

create or replace function public.get_subsync_batch(p_limit int default 900)
returns table (id text, "biblionetId" text, title text, from_list boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform fn_require_admin();
  return query select * from fn_subsync_next_batch(p_limit);
end;
$$;

-- ── Run bookkeeping ──────────────────────────────────────────────────────────
-- Cheap check used by the cron job so an idle day costs no Edge Function calls.
create or replace function public.fn_subsync_should_run()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select s.enabled
     and (s.paused_until is null or s.paused_until <= now())
     and (s.running_since is null or s.running_since < now() - interval '6 minutes')
     and (case when s.day < (now() at time zone 'utc')::date
               then s.daily_limit
               else s.daily_limit - s.requests_today end) > 0
     and exists (select 1 from books b where b."syncedSub" = false and b."biblionetId" is not null)
  from subsync_state s
  where s.id = 1;
$$;

-- Claims a run: returns how many books it may sync now (0 = do nothing).
create or replace function public.fn_subsync_begin(p_max int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed int;
begin
  update subsync_state
     set day = (now() at time zone 'utc')::date, requests_today = 0, synced_today = 0
   where id = 1 and day < (now() at time zone 'utc')::date;

  if not fn_subsync_should_run() then
    return 0;
  end if;

  select least(greatest(p_max, 0), s.daily_limit - s.requests_today)
    into v_allowed
    from subsync_state s where s.id = 1;

  if v_allowed > 0 then
    update subsync_state set running_since = now() where id = 1;
  end if;
  return coalesce(v_allowed, 0);
end;
$$;

-- Closes a run. p_stopped = Biblionet kept failing: pause for a few hours.
create or replace function public.fn_subsync_end(
  p_requests int,
  p_synced   int,
  p_stopped  boolean,
  p_note     text
)
returns void
language sql
security definer
set search_path = public
as $$
  update subsync_state
     set requests_today = requests_today + greatest(p_requests, 0),
         synced_today   = synced_today + greatest(p_synced, 0),
         total_synced   = total_synced + greatest(p_synced, 0),
         running_since  = null,
         last_run_at    = now(),
         last_result    = p_note,
         paused_until   = case when p_stopped then now() + interval '4 hours' else paused_until end
   where id = 1;
$$;

-- Service role only: these must never be callable from the app.
revoke execute on function public.fn_subsync_next_batch(int)               from public, anon, authenticated;
revoke execute on function public.fn_subsync_should_run()                  from public, anon, authenticated;
revoke execute on function public.fn_subsync_begin(int)                    from public, anon, authenticated;
revoke execute on function public.fn_subsync_end(int, int, boolean, text)  from public, anon, authenticated;
grant  execute on function public.fn_subsync_next_batch(int)               to service_role;
grant  execute on function public.fn_subsync_should_run()                  to service_role;
grant  execute on function public.fn_subsync_begin(int)                    to service_role;
grant  execute on function public.fn_subsync_end(int, int, boolean, text)  to service_role;

-- ── Schedule ─────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from cron.job where jobname = 'subsync-run') then
    perform cron.unschedule('subsync-run');
  end if;
end $$;

select cron.schedule('subsync-run', '*/4 * * * *', $cron$
  select net.http_post(
    url := 'https://rxovzritmmnpodojhfuj.supabase.co/functions/v1/sync-subcategories',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'subsync_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  )
  where public.fn_subsync_should_run();
$cron$);
