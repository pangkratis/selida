-- Contributors (authors, translators, illustrators, etc.) as a proper
-- relational entity instead of a single flat `books.authors` text[].
--
-- Biblionet's get_contributors endpoint returns a stable ContributorID
-- per person plus their role on that specific book (ContributorTypeID/
-- ContributorType — e.g. "Συγγραφέας" author, "Μετάφραση" translation),
-- and a book can have several contributors in different roles. None of
-- that currently exists anywhere in the schema — books.authors only
-- captures a single flat name string with no stable identity, making
-- "more books by this author" fragile string matching instead of a
-- reliable join.
--
-- contributorTypeId/contributorType are stored RAW (Biblionet's own
-- numeric id + Greek label) rather than normalized into an enum — the
-- full set of role types Biblionet uses isn't documented and only one
-- book's worth of samples (author, translator) has been observed so
-- far. Normalize later once more role values are actually seen in data.

create table if not exists public.contributors (
  id uuid primary key default gen_random_uuid(),
  "biblionetId" text unique,
  "fullName" text not null,
  "createdAt" timestamptz not null default now()
);

create table if not exists public.book_contributors (
  id uuid primary key default gen_random_uuid(),
  book_id text not null references public.books(id) on delete cascade,
  contributor_id uuid not null references public.contributors(id) on delete cascade,
  "contributorTypeId" integer,
  "contributorType" text,
  "presentOrder" integer,
  "createdAt" timestamptz not null default now(),
  unique (book_id, contributor_id, "contributorTypeId")
);

create index if not exists book_contributors_book_id_idx on public.book_contributors(book_id);
create index if not exists book_contributors_contributor_id_idx on public.book_contributors(contributor_id);

alter table public.contributors enable row level security;
alter table public.book_contributors enable row level security;

-- Same security posture as `books` itself (see books_public_read /
-- books_auth_write / books_auth_update / books_auth_delete) — public
-- read, any authenticated client can write, since this gets populated by
-- the same client-side ingestion tool that already writes to `books`.

drop policy if exists contributors_public_read on public.contributors;
create policy contributors_public_read on public.contributors for select using (true);

drop policy if exists contributors_auth_write on public.contributors;
create policy contributors_auth_write on public.contributors for insert
  with check ((select auth.role()) = 'authenticated');

drop policy if exists contributors_auth_update on public.contributors;
create policy contributors_auth_update on public.contributors for update
  using ((select auth.role()) = 'authenticated');

drop policy if exists contributors_auth_delete on public.contributors;
create policy contributors_auth_delete on public.contributors for delete
  using ((select auth.role()) = 'authenticated');

drop policy if exists book_contributors_public_read on public.book_contributors;
create policy book_contributors_public_read on public.book_contributors for select using (true);

drop policy if exists book_contributors_auth_write on public.book_contributors;
create policy book_contributors_auth_write on public.book_contributors for insert
  with check ((select auth.role()) = 'authenticated');

drop policy if exists book_contributors_auth_update on public.book_contributors;
create policy book_contributors_auth_update on public.book_contributors for update
  using ((select auth.role()) = 'authenticated');

drop policy if exists book_contributors_auth_delete on public.book_contributors;
create policy book_contributors_auth_delete on public.book_contributors for delete
  using ((select auth.role()) = 'authenticated');

-- Sync progress flag on books, mirroring the existing syncedSub column.
alter table public.books add column if not exists "syncedContributors" boolean not null default false;
