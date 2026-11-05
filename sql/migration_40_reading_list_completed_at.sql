-- When was a book finished? (2026-11-05)
--
-- readingList only had addedAt (when the book was saved), so the Profile's
-- "Completed" shelf could not show the most recently finished books first.
--
-- completedAt is set by a trigger, so every way of finishing a book (book page,
-- profile menu, a direct insert as 'completed') records it without app changes:
--   status becomes 'completed'   → completedAt = now() (unless the row already had one)
--   status leaves 'completed'    → completedAt = null
-- Back-fill: the latest 'mark_completed' event in userActivity for that book,
-- otherwise addedAt.

alter table public."readingList" add column if not exists "completedAt" timestamptz;

create or replace function public.fn_reading_list_completed_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'completed' then
    if tg_op = 'INSERT' or old.status is distinct from 'completed' or new."completedAt" is null then
      new."completedAt" := coalesce(case when tg_op = 'UPDATE' and old.status = 'completed' then old."completedAt" end, now());
    end if;
  else
    new."completedAt" := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reading_list_completed_at on public."readingList";
create trigger trg_reading_list_completed_at
  before insert or update of status, "completedAt" on public."readingList"
  for each row execute function public.fn_reading_list_completed_at();

-- Back-fill existing finished books.
update public."readingList" r
   set "completedAt" = coalesce(
         (select max(a."createdAt") from public."userActivity" a
           where a."userId" = r."userId" and a."bookId" = r."bookId" and a.action = 'mark_completed'),
         r."addedAt"::timestamptz,
         now())
 where r.status = 'completed' and r."completedAt" is null;

create index if not exists reading_list_user_completed_idx
  on public."readingList" ("userId", "completedAt" desc)
  where status = 'completed';
