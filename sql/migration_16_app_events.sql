-- Pre-launch funnel analytics, part 2 (2026-09-21).
--
-- migration_15 added app-level events to `userActivity`, but that table can
-- only ever describe SIGNED-IN users: `"userId"` is `not null references
-- users(id)`, and its RLS policy is `using (auth.uid() = "userId")`. That
-- leaves the single biggest MVP funnel question unanswerable — how many
-- people open the app, reach the signup screen, and leave without ever
-- creating an account. Those people have no user row, so they cannot be
-- represented in `userActivity` at all.
--
-- Rather than weaken `userActivity` (making userId nullable + loosening that
-- policy would give up a security property we deliberately verified during
-- the 2026-09-19 RLS audit, on a table that also carries the bookStats
-- trigger and feeds recommendations), app-level events move to their own
-- table keyed by an anonymous device id.
--
-- Stitching: `deviceId` is present on EVERY row, `userId` is filled in once
-- known. So a device's pre-signup events and its post-signup events share a
-- deviceId, and the whole funnel is one query against one table — the
-- standard anonymous-id → identified-user pattern.
--
-- The three event types migration_15 put in `userActivity` (app_open,
-- onboarding_complete, search_performed) move here. `userActivity` goes back
-- to being purely book-centric, which is what its trigger and the
-- recommendation engine actually want.

create table if not exists public."appEvents" (
  id uuid primary key default gen_random_uuid(),

  -- Anonymous, app-generated, stored client-side in SecureStore (localStorage
  -- on web). NOT a device fingerprint and not derived from any hardware id —
  -- a random UUID that dies with an app uninstall or a cleared browser.
  "deviceId" text not null,

  -- Null until the device has an account. `on delete set null` so deleting an
  -- account doesn't punch holes in historical funnel counts.
  "userId" uuid references public.users(id) on delete set null,

  event text not null,
  context text,
  metadata jsonb,
  platform text,
  "appVersion" text,
  "createdAt" timestamptz not null default now(),

  -- These caps exist because `anon` can insert here (see the policy below).
  -- Without them the publishable key that ships in every app bundle is a
  -- write-anything-you-like handle on this table.
  constraint app_events_device_len check (char_length("deviceId") <= 64),
  constraint app_events_event_len check (char_length(event) <= 64),
  constraint app_events_context_len check (context is null or char_length(context) <= 200)
);

-- Funnel queries are almost always "this event, over this window".
create index if not exists idx_app_events_event_created
  on public."appEvents" (event, "createdAt" desc);

-- Per-device timeline: "what did this device do before it signed up".
create index if not exists idx_app_events_device_created
  on public."appEvents" ("deviceId", "createdAt" desc);

create index if not exists idx_app_events_user_created
  on public."appEvents" ("userId", "createdAt" desc);

alter table public."appEvents" enable row level security;

-- Insert-only from the client, no SELECT policy — same shape as `feedback`
-- and `errorLogs`. Read via the dashboard / service_role.
--
-- anon CAN insert, deliberately: a pre-auth event is the entire point of this
-- table. The with-check still prevents attributing an event to another user.
drop policy if exists "app_events_insert" on public."appEvents";
create policy "app_events_insert" on public."appEvents"
  for insert with check ("userId" is null or "userId" = (select auth.uid()));

-- ── Move the migration_15 app events out of userActivity ──────────────
-- Pre-launch, so this is near-certainly a no-op — but it is written to be
-- correct rather than assumed empty, and it reports what it moved.

do $$
declare
  v_moved integer;
begin
  with moved as (
    delete from public."userActivity"
    where action in ('app_open', 'onboarding_complete', 'search_performed')
    returning "userId", action, context, metadata, "createdAt"
  )
  insert into public."appEvents" ("deviceId", "userId", event, context, metadata, "createdAt")
  select 'legacy-pre-device-id', "userId", action, context, metadata, "createdAt"
  from moved;

  get diagnostics v_moved = row_count;
  raise notice 'Moved % app-level rows from userActivity to appEvents', v_moved;
end $$;
