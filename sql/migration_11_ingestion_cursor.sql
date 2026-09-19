-- Moves the catalog ingestion crawl position (year/month/page) from
-- device-local SecureStore into the database, so progress is visible
-- from anywhere (e.g. the Supabase dashboard) instead of only from the
-- one device that last ran it.
--
-- Singleton row keyed by a fixed id ('catalog') — there is only ever one
-- ongoing crawl position. "updatedAt" doubles as "when did ingestion last
-- make progress."
--
-- Same security posture as the rest of the ingestion tables (books,
-- bookStats etc.): writable by any authenticated client, not restricted
-- to real admins at the DB level — the app only gates the ingestion UI
-- behind isAdmin client-side, same as before this change.

create table if not exists public.ingestion_cursor (
  id text primary key default 'catalog',
  year integer not null,
  month integer not null,
  page integer not null,
  "updatedAt" timestamptz not null default now()
);

alter table public.ingestion_cursor enable row level security;

drop policy if exists "Authenticated users can read ingestion cursor" on public.ingestion_cursor;
create policy "Authenticated users can read ingestion cursor"
  on public.ingestion_cursor for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can write ingestion cursor" on public.ingestion_cursor;
create policy "Authenticated users can write ingestion cursor"
  on public.ingestion_cursor for all
  to authenticated
  using (true)
  with check (true);
