-- Paged shelf queries for Home. Shelves used to fetch 20-40 rows straight from
-- books; paging deeper that way takes 3.5-16 s at 186k rows (wide rows, sort
-- over tens of thousands of matches), past the 8 s authenticated timeout.
--
-- This picks a page of ids from narrow tables (book_categories, an index-only
-- pageCount scan, a createdAt index) and reads books for that page alone.
--
-- Order within a shelf: engagement from bookStats first (so it takes over once
-- there is real usage), then a per-user, per-day pseudo-random order so the
-- shelf is stable while paging but changes between days. Books already on the
-- caller's reading list are excluded.
--
--   p_kind = 'category'  p_key = category name
--   p_kind = 'author'    p_key = author name (exact)
--   p_kind = 'quick'     60-120 page books
--   p_kind = 'new'       newest ingested first

create index if not exists books_created_id_idx on public.books ("createdAt" desc, id);
create index if not exists books_pagecount_id_idx on public.books ("pageCount", id);

create or replace function public.get_shelf_books(
  p_kind       text,
  p_key        text default null,
  p_offset     int  default 0,
  p_limit      int  default 24,
  p_exclude_id text default null
)
returns setof public.books
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_seed text := coalesce(auth.uid()::text, '') || current_date::text;
  v_off  int  := greatest(coalesce(p_offset, 0), 0);
  v_lim  int  := least(greatest(coalesce(p_limit, 24), 1), 60);
begin
  if v_uid is null then
    return;
  end if;

  if p_kind = 'new' then
    return query
      select b.*
      from books b
      where b."isActive" is distinct from false
        and b.id is distinct from p_exclude_id
        and not exists (select 1 from "readingList" r where r."userId" = v_uid and r."bookId" = b.id)
      order by b."createdAt" desc, b.id
      offset v_off limit v_lim;

  elsif p_kind = 'category' then
    return query
      with page as (
        select bc.book_id as id,
               coalesce(st.completed * 4 + st.reading * 3 + st.wishlist * 2 + st.views, 0) as pop,
               md5(bc.book_id || v_seed) as k
        from categories c
        join book_categories bc on bc.category_id = c.id
        left join "bookStats" st on st."bookId" = bc.book_id
        where c.name = p_key
          and bc.book_id is distinct from p_exclude_id
          and not exists (select 1 from "readingList" r where r."userId" = v_uid and r."bookId" = bc.book_id)
        order by pop desc, k
        offset v_off limit v_lim
      )
      select b.*
      from page p join books b on b.id = p.id
      where b."isActive" is distinct from false
      order by p.pop desc, p.k;

  elsif p_kind = 'quick' then
    return query
      with page as (
        select b.id,
               coalesce(st.completed * 4 + st.reading * 3 + st.wishlist * 2 + st.views, 0) as pop,
               md5(b.id || v_seed) as k
        from books b
        left join "bookStats" st on st."bookId" = b.id
        where b."pageCount" between 60 and 120
          and b.id is distinct from p_exclude_id
          and not exists (select 1 from "readingList" r where r."userId" = v_uid and r."bookId" = b.id)
        order by pop desc, k
        offset v_off limit v_lim
      )
      select b.*
      from page p join books b on b.id = p.id
      where b."isActive" is distinct from false
      order by p.pop desc, p.k;

  elsif p_kind = 'author' then
    -- Editions of one work share a title; show it once.
    return query
      with works as (
        select distinct on (lower(b.title))
               b.id, b.title,
               coalesce(st.completed * 4 + st.reading * 3 + st.wishlist * 2 + st.views, 0) as pop
        from books b
        left join "bookStats" st on st."bookId" = b.id
        where b.authors @> array[p_key]
          and b."isActive" is distinct from false
          and b.id is distinct from p_exclude_id
          and not exists (select 1 from "readingList" r where r."userId" = v_uid and r."bookId" = b.id)
        order by lower(b.title), pop desc, b.id
      )
      select b.*
      from works w join books b on b.id = w.id
      order by w.pop desc, w.title, w.id
      offset v_off limit v_lim;
  end if;
end;
$$;

revoke execute on function public.get_shelf_books(text, text, int, int, text) from public, anon;
grant execute on function public.get_shelf_books(text, text, int, int, text) to authenticated;
