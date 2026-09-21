-- Pre-build exposure audit (2026-09-21). Found while cross-checking what a
-- shipped build would expose, unrelated to what triggered the check.
--
-- CONFIRMED LIVE, not just read from policy text: created two disposable
-- accounts (A and B, no relation to each other). Account A inserted a
-- throwaway book row. Account B — a totally unrelated signed-up user —
-- was able to UPDATE and DELETE that row via a plain REST call. No UI
-- involved. Both books_auth_update and books_auth_delete used
-- `using (auth.role() = 'authenticated')` with no ownership or admin
-- check, so this generalizes to: any self-registered account can modify
-- or delete ANY row in the book catalog, including wiping it entirely,
-- from raw curl. __DEV__ guards on the client's admin ingestion tools
-- (services/catalog-ingestion.ts) do not help here — they only affect
-- the bundled app's own code, not direct REST calls made with a real
-- user's own session token.
--
-- ── DELETE: lock to admins only ────────────────────────────────────────
-- Checked first: no legitimate client flow deletes from `books` outside
-- the already-__DEV__-gated `clearBookDatabase()`. Zero regression risk.

drop policy if exists "books_auth_delete" on public.books;
create policy "books_admin_delete" on public.books
  for delete
  using (exists (
    select 1 from public.users u where u.id = auth.uid() and u."isAdmin" = true
  ));

-- ── UPDATE/INSERT: intentionally left broad — see note below ───────────
-- book-details.tsx calls upsertBook() on every wishlist/reading-status
-- toggle, for every ordinary user, as a normal part of using the app —
-- this is how a book a user views gets cached into the shared catalog.
-- There is no ownership column on `books` (it's a shared, non-owned
-- catalog), so RLS alone cannot distinguish "a normal user saving a book
-- they're viewing" from "a normal user vandalizing an arbitrary existing
-- row" — both are structurally the same operation. Restricting UPDATE to
-- admins would break the core save/wishlist feature for every user.
--
-- This is a real residual risk (any signed-up account can still overwrite
-- an existing book's title/cover/authors/etc via upsert) and is NOT fixed
-- by this migration. Closing it properly needs either a validated
-- server-side upsert path (an RPC that only allows setting safe fields,
-- can rate-limit, can log who changed what) or a moderation/versioning
-- model — a real design decision, not a one-line policy change, and not
-- something to rush through in the same pass as the clear-cut fixes
-- above. Left as a flagged follow-up.

-- ── ingestion_cursor: lock to admins only ───────────────────────────────
-- Single-row crawl-progress tracker. Confirmed via grep: touched only by
-- services/catalog-ingestion.ts, whose exported functions are __DEV__-
-- gated except readCursor()/resetCursor() — those two were NOT gated, so
-- resetCursor() could actually execute in a production build for any
-- authenticated user, unlike its sibling functions. This RLS fix closes
-- that regardless of the TS-level gating, since the write would now be
-- rejected server-side for non-admins either way.

drop policy if exists "Authenticated users can read ingestion cursor" on public.ingestion_cursor;
drop policy if exists "Authenticated users can write ingestion cursor" on public.ingestion_cursor;

create policy "ingestion_cursor_admin_only" on public.ingestion_cursor
  for all
  using (exists (
    select 1 from public.users u where u.id = auth.uid() and u."isAdmin" = true
  ))
  with check (exists (
    select 1 from public.users u where u.id = auth.uid() and u."isAdmin" = true
  ));
