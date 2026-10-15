-- Book triage: an admin swipes through books whose subject headings are not
-- synced yet and decides which ones the subcategory sync should do first.
--
--   priority  swiped right / liked     -> synced before everything else
--   skip      swiped left / disliked   -> "not yet": synced only after all untriaged books
--   review    review button            -> kept aside for a later decision (also synced last)
--
-- One row per book. priority/skip rows are removed automatically once the book
-- is synced; review rows stay until decided. Admin-only for now (RLS + checks
-- inside the functions).

create table if not exists public.book_triage (
  book_id    text primary key references public.books(id) on delete cascade,
  decision   text not null check (decision in ('priority', 'skip', 'review')),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz not null default now()
);

create index if not exists book_triage_decision_idx on public.book_triage (decision, decided_at);

alter table public.book_triage enable row level security;

drop policy if exists "book_triage_admin_all" on public.book_triage;
create policy "book_triage_admin_all" on public.book_triage
  for all
  using (exists (select 1 from public.users u where u.id = auth.uid() and u."isAdmin" = true))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u."isAdmin" = true));

-- Deck order: most popular first, then most recently added. Matches the
-- existing sync-queue filter so the deck reads straight off an index.
create index if not exists books_subsync_recent_idx on public.books ("popularityCount" desc, "createdAt" desc)
  where "syncedSub" = false and "biblionetId" is not null;

create or replace function public.fn_require_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from users u where u.id = auth.uid() and u."isAdmin" = true) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function public.fn_require_admin() from public, anon;
grant execute on function public.fn_require_admin() to authenticated;

-- Next cards to swipe: unsynced, not yet decided, not already on the client.
create or replace function public.get_triage_deck(
  p_limit       int    default 20,
  p_exclude_ids text[] default '{}'
)
returns setof public.books
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform fn_require_admin();
  return query
    select b.*
    from books b
    where b."syncedSub" = false
      and b."biblionetId" is not null
      and not exists (select 1 from book_triage t where t.book_id = b.id)
      and not (b.id = any (coalesce(p_exclude_ids, '{}')))
    order by b."popularityCount" desc, b."createdAt" desc
    limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

create or replace function public.get_triage_counts()
returns table (unsynced bigint, in_list bigint, in_review bigint, skipped bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform fn_require_admin();
  return query
    select
      (select count(*) from books b where b."syncedSub" = false and b."biblionetId" is not null),
      (select count(*) from book_triage t where t.decision = 'priority'),
      (select count(*) from book_triage t where t.decision = 'review'),
      (select count(*) from book_triage t where t.decision = 'skip');
end;
$$;

-- What syncSubcategories() works through, in order: the priority list (oldest
-- decision first), then untriaged books by popularity, then skipped/review.
create or replace function public.get_subsync_batch(p_limit int default 900)
returns table (id text, "biblionetId" text, title text, from_list boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_left int := least(greatest(coalesce(p_limit, 900), 1), 1000);
  v_n    int;
begin
  perform fn_require_admin();

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
  get diagnostics v_n = row_count;
  v_left := v_left - v_n;
  if v_left <= 0 then return; end if;

  return query
    select b.id, b."biblionetId", b.title, false
    from book_triage t
    join books b on b.id = t.book_id
    where t.decision in ('skip', 'review')
      and b."syncedSub" = false
      and b."biblionetId" is not null
    order by t.decided_at
    limit v_left;
end;
$$;

revoke execute on function public.get_triage_deck(int, text[]) from public, anon;
revoke execute on function public.get_triage_counts() from public, anon;
revoke execute on function public.get_subsync_batch(int) from public, anon;
grant execute on function public.get_triage_deck(int, text[]) to authenticated;
grant execute on function public.get_triage_counts() to authenticated;
grant execute on function public.get_subsync_batch(int) to authenticated;

-- Once a book's headings are synced it leaves the sync list (and the skip
-- set); review decisions are kept.
create or replace function public.fn_triage_clear_on_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from book_triage where book_id = new.id and decision in ('priority', 'skip');
  return new;
end;
$$;

revoke execute on function public.fn_triage_clear_on_sync() from public, anon, authenticated;

drop trigger if exists trg_triage_clear_on_sync on public.books;
create trigger trg_triage_clear_on_sync
after update of "syncedSub" on public.books
for each row
when (new."syncedSub" = true and old."syncedSub" is distinct from true)
execute function public.fn_triage_clear_on_sync();
