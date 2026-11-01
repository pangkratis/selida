-- Fill books.search_latin slowly (2026-11-01).
--
-- The one-shot backfill in migration_36 rewrote ~90k book rows at once; the old
-- row versions pushed the database over the free plan's size limit and Supabase
-- made it read-only for a while. This does the rest in small pieces:
--   :00 and :30  fn_backfill_search_latin(1000) — next 1,000 books without it
--   :15 and :45  VACUUM books — makes the old row versions reusable, so the
--                next batch fills that space instead of growing the table
-- ≈ 48,000 books a day. When nothing is left, both jobs unschedule themselves.
-- A batch is skipped while the database is above p_max_db_bytes.
--
-- New and edited books already get search_latin from the trigger (migration_36).
-- Stop early: select cron.unschedule('latin-backfill'); select cron.unschedule('latin-backfill-vacuum');

create or replace function public.fn_backfill_search_latin(
  p_limit        int    default 1000,
  p_max_db_bytes bigint default 760 * 1024 * 1024
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_done int;
begin
  if pg_database_size(current_database()) > p_max_db_bytes then
    return -1;   -- too big right now; try again next run
  end if;

  update books b
     set search_latin = fn_greeklish(b.title || ' ' || coalesce(array_to_string(b.authors, ' '), ''))
   where b.id in (select id from books where search_latin is null limit p_limit);
  get diagnostics v_done = row_count;

  if v_done = 0 then
    perform cron.unschedule('latin-backfill');
    perform cron.unschedule('latin-backfill-vacuum');
  end if;
  return v_done;
end;
$$;

revoke execute on function public.fn_backfill_search_latin(int, bigint) from public, anon, authenticated;

-- Finds the remaining rows fast instead of scanning the whole table each time.
create index if not exists books_search_latin_missing_idx
  on public.books (id) where search_latin is null;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'latin-backfill') then
    perform cron.unschedule('latin-backfill');
  end if;
  if exists (select 1 from cron.job where jobname = 'latin-backfill-vacuum') then
    perform cron.unschedule('latin-backfill-vacuum');
  end if;
end $$;

select cron.schedule('latin-backfill',        '0,30 * * * *',  $$select public.fn_backfill_search_latin(1000)$$);
select cron.schedule('latin-backfill-vacuum', '15,45 * * * *', $$vacuum public.books$$);
