-- ============================================================
-- Selida — Supabase PostgreSQL Schema
-- Run this in the Supabase SQL Editor (Project → SQL Editor → New Query)
-- ============================================================
-- NOTE: uuid type and gen_random_uuid() are built-in since PostgreSQL 13.
-- No extensions required.

-- ── Tables ────────────────────────────────────────────────────────────

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  "displayName" text,
  language text default 'en',
  country text default 'GR',
  "catalogPreference" text default 'international',
  "isAdmin" boolean default false,
  "onboardingComplete" boolean default false,
  stats jsonb default '{"booksReadCount": 0}'::jsonb,
  "createdAt" timestamptz default now(),
  "lastLoginAt" timestamptz default now()
);

create table if not exists public.books (
  id text primary key default gen_random_uuid()::text,
  title text not null default 'Unknown Title',
  subtitle text,
  authors text[],
  "coverUrl" text,
  "publishedYear" text,
  isbn text,
  isbn10 text,
  isbn13 text,
  language text,
  description text,
  categories text[],
  edition text,
  "isActive" boolean default true,
  "popularityCount" integer default 0,
  publisher text,
  "pageCount" integer,
  source text,
  series text,
  "subSeries" text,
  "searchTags" text[],
  price numeric,
  availability text,
  "biblionetId" text unique,
  "syncedSub" boolean default false,
  subcategories text[],
  "createdAt" timestamptz default now()
);

create table if not exists public."readingList" (
  id uuid primary key default gen_random_uuid(),
  "userId" uuid not null references public.users(id) on delete cascade,
  "bookId" text not null references public.books(id) on delete cascade,
  status text not null,
  "progressPercentage" numeric default 0,
  "totalReadingTimeSeconds" numeric default 0,
  "lastSessionStart" timestamptz,
  "isReading" boolean default false,
  "addedAt" timestamptz default now(),
  unique("userId", "bookId")
);

create table if not exists public."bookStats" (
  "bookId" text primary key references public.books(id) on delete cascade,
  views integer default 0,
  wishlist integer default 0,
  reading integer default 0,
  completed integer default 0,
  "lastActivityAt" timestamptz default now()
);

create table if not exists public."readingSessions" (
  id uuid primary key default gen_random_uuid(),
  "userId" uuid not null references public.users(id) on delete cascade,
  "bookId" text not null,
  "durationSeconds" numeric,
  "createdAt" timestamptz default now()
);

create table if not exists public."userActivity" (
  id uuid primary key default gen_random_uuid(),
  "userId" uuid not null references public.users(id) on delete cascade,
  "bookId" text,
  action text,
  context text,
  "createdAt" timestamptz default now()
);

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  platform text,
  "createdAt" timestamptz default now()
);

-- ── Row Level Security ────────────────────────────────────────────────

alter table public.users enable row level security;
alter table public.books enable row level security;
alter table public."readingList" enable row level security;
alter table public."bookStats" enable row level security;
alter table public."readingSessions" enable row level security;
alter table public."userActivity" enable row level security;
alter table public.feedback enable row level security;

-- Users: own row only
create policy "users_own_data" on public.users
  for all using (auth.uid() = id);

-- Books: public read, authenticated write (books are public catalog data)
create policy "books_public_read" on public.books
  for select using (true);
create policy "books_auth_write" on public.books
  for insert with check ((select auth.role()) = 'authenticated');
create policy "books_auth_update" on public.books
  for update using ((select auth.role()) = 'authenticated');
create policy "books_auth_delete" on public.books
  for delete using ((select auth.role()) = 'authenticated');

-- Reading list: own rows only
create policy "reading_list_own" on public."readingList"
  for all using (auth.uid() = "userId");

-- Book stats: public read, authenticated write
create policy "book_stats_public_read" on public."bookStats"
  for select using (true);
create policy "book_stats_auth_write" on public."bookStats"
  for insert with check ((select auth.role()) = 'authenticated');
create policy "book_stats_auth_update" on public."bookStats"
  for update using ((select auth.role()) = 'authenticated');

-- Reading sessions: own rows only
create policy "reading_sessions_own" on public."readingSessions"
  for all using (auth.uid() = "userId");

-- User activity: own rows only
create policy "user_activity_own" on public."userActivity"
  for all using (auth.uid() = "userId");

-- Feedback: authenticated insert, no read (admin-only via dashboard)
create policy "feedback_auth_insert" on public.feedback
  for insert with check ((select auth.role()) = 'authenticated');

-- ── User Profile Creation (bypasses RLS for signup) ─────────────────
-- Called from the client immediately after auth.signUp().
-- security definer means it runs as the DB owner and ignores RLS,
-- which is necessary because the user has no session yet when email
-- confirmation is enabled.

create or replace function create_user_profile(
  p_id uuid,
  p_email text,
  p_display_name text,
  p_language text,
  p_country text,
  p_catalog_preference text
)
returns void language plpgsql security definer as $$
begin
  insert into public.users (
    id, email, "displayName", language, country,
    "catalogPreference", "onboardingComplete",
    stats, "createdAt", "lastLoginAt"
  )
  values (
    p_id, p_email, p_display_name, p_language, p_country,
    p_catalog_preference, false,
    '{"booksReadCount": 0}'::jsonb, now(), now()
  )
  on conflict (id) do nothing;
end;
$$;

-- ── Helper Functions (atomic increments) ─────────────────────────────

create or replace function increment_book_view(p_book_id text)
returns void language plpgsql security definer as $$
begin
  insert into public."bookStats" ("bookId", views, "lastActivityAt")
  values (p_book_id, 1, now())
  on conflict ("bookId")
  do update set
    views = public."bookStats".views + 1,
    "lastActivityAt" = now();
end;
$$;

create or replace function update_book_status_stats(
  p_book_id text,
  p_old_status text,
  p_new_status text
)
returns void language plpgsql security definer as $$
begin
  insert into public."bookStats" ("bookId", "lastActivityAt")
  values (p_book_id, now())
  on conflict ("bookId") do update set "lastActivityAt" = now();

  if p_old_status = 'wishlist' then
    update public."bookStats" set wishlist = greatest(0, wishlist - 1) where "bookId" = p_book_id;
  elsif p_old_status = 'reading' then
    update public."bookStats" set reading = greatest(0, reading - 1) where "bookId" = p_book_id;
  elsif p_old_status = 'completed' then
    update public."bookStats" set completed = greatest(0, completed - 1) where "bookId" = p_book_id;
  end if;

  if p_new_status = 'wishlist' then
    update public."bookStats" set wishlist = wishlist + 1 where "bookId" = p_book_id;
  elsif p_new_status = 'reading' then
    update public."bookStats" set reading = reading + 1 where "bookId" = p_book_id;
  elsif p_new_status = 'completed' then
    update public."bookStats" set completed = completed + 1 where "bookId" = p_book_id;
  end if;
end;
$$;

-- ── Realtime ──────────────────────────────────────────────────────────

alter publication supabase_realtime add table public.users;
alter publication supabase_realtime add table public."readingList";