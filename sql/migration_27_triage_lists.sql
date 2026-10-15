-- Book triage, round 2.
--
-- "Not yet" (skip) and "review" books are no longer synced automatically at
-- all: the sync takes the priority list, then untriaged books, and stops.
-- A skipped or review book only gets its subject headings once it is moved to
-- the priority list (from the new list screen). The deck already hides every
-- triaged book, so skipped books never come back to it.
--
-- get_triage_list pages through one decision list, newest decision first.

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
end;
$$;

create or replace function public.get_triage_list(
  p_decision text,
  p_offset   int default 0,
  p_limit    int default 30
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
    from book_triage t
    join books b on b.id = t.book_id
    where t.decision = p_decision
    order by t.decided_at desc, b.id
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

revoke execute on function public.get_triage_list(text, int, int) from public, anon;
grant execute on function public.get_triage_list(text, int, int) to authenticated;
