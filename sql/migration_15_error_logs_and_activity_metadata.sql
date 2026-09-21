-- Pre-launch observability (2026-09-21).
--
-- Self-hosted alternative to a third-party crash reporter, chosen so the
-- privacy policy's explicit promise — "No analytics SDKs, no advertising
-- networks, no crash-reporting trackers" (docs/privacy.html) — stays true
-- as written. Everything here lands in the same Supabase project that
-- already holds the user's reading data, so no new data processor is
-- introduced and the App Store privacy labels don't change.
--
-- 1. `errorLogs` — client-side crash/error sink. Previously there was NO
--    error reporting of any kind: 94 `console.*` calls and 61 `catch`
--    blocks, all of which go nowhere retrievable in a release build.
--
-- 2. `userActivity.metadata` — a jsonb column so non-book events can carry
--    structured detail (e.g. a search's result count) instead of being
--    crammed into the free-text `context` column.
--
-- Trigger safety, verified before writing this: `fn_activity_sync_views`
-- already guards on `action = 'view_details' AND "bookId" IS NOT NULL`, so
-- the new null-bookId event types below cannot corrupt `bookStats.views`.

-- ── 1. errorLogs ──────────────────────────────────────────────────────

create table if not exists public."errorLogs" (
  id uuid primary key default gen_random_uuid(),
  -- Nullable + `on delete set null`: errors happen pre-auth too (login
  -- screen, session restore), and an error report outlives the account it
  -- came from — we still want the crash even after the user deletes their
  -- profile, but not tied to them.
  "userId" uuid references public.users(id) on delete set null,
  message text not null,
  stack text,
  -- Where it came from: 'ErrorBoundary', 'services/recommendations', etc.
  context text,
  -- true = crashed a React subtree (caught by ErrorBoundary);
  -- false = handled/caught error that was reported for visibility.
  fatal boolean not null default false,
  platform text,
  "appVersion" text,
  "createdAt" timestamptz not null default now(),

  -- Length caps matter here specifically because `anon` can insert (see
  -- the policy below). Without them, the same public key that ships in
  -- every app bundle could be used to write unbounded text into this
  -- table. Truncation is also enforced client-side in services/errorLog.ts;
  -- this is the constraint that actually holds, since the client is not
  -- something we control once the bundle is published.
  constraint error_logs_message_len check (char_length(message) <= 2000),
  constraint error_logs_stack_len check (stack is null or char_length(stack) <= 10000),
  constraint error_logs_context_len check (context is null or char_length(context) <= 200)
);

create index if not exists idx_error_logs_created_at
  on public."errorLogs" ("createdAt" desc);

-- Grouping/triage query support: "what's breaking most this week".
create index if not exists idx_error_logs_context
  on public."errorLogs" (context, "createdAt" desc);

alter table public."errorLogs" enable row level security;

-- Insert-only from the client, same shape as the existing `feedback`
-- table: anyone (including anon, since pre-auth crashes are exactly the
-- ones you most need to see) may write a report, but nobody may read the
-- table back through the API. Reads happen via the Supabase dashboard /
-- service_role only.
--
-- The `"userId" is null or "userId" = auth.uid()` check stops a caller
-- from attributing a fabricated error report to another user.
drop policy if exists "error_logs_insert" on public."errorLogs";
create policy "error_logs_insert" on public."errorLogs"
  for insert with check ("userId" is null or "userId" = (select auth.uid()));

-- ── 2. userActivity.metadata ──────────────────────────────────────────

alter table public."userActivity"
  add column if not exists metadata jsonb;

-- Supports "which searches come back empty" without a full table scan.
create index if not exists idx_user_activity_action_created
  on public."userActivity" (action, "createdAt" desc);
