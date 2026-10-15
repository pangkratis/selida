-- Home shelves no longer use books.categories (too generic: 13% of books are
-- "Γενικά βιβλία", and the category often does not describe the book). Topic
-- shelves now run on a genre (book_genres) or a subject heading
-- (book_subcategories); the 'category' kind is removed.
--
--   p_kind = 'genre'        p_key = genre slug
--   p_kind = 'subcategory'  p_key = subject heading name
--   p_kind = 'author'       p_key = author name (exact)
--   p_kind = 'quick'        60-120 page books
--   p_kind = 'new'          newest ingested first
-- Ordering, reading-list exclusion and paging are unchanged from migration 23.

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

  elsif p_kind = 'genre' then
    return query
      with page as (
        select bg.book_id as id,
               coalesce(st.completed * 4 + st.reading * 3 + st.wishlist * 2 + st.views, 0) as pop,
               md5(bg.book_id || v_seed) as k
        from genres g
        join book_genres bg on bg.genre_id = g.id
        left join "bookStats" st on st."bookId" = bg.book_id
        where g.slug = p_key
          and bg.book_id is distinct from p_exclude_id
          and not exists (select 1 from "readingList" r where r."userId" = v_uid and r."bookId" = bg.book_id)
        order by pop desc, k
        offset v_off limit v_lim
      )
      select b.*
      from page p join books b on b.id = p.id
      where b."isActive" is distinct from false
      order by p.pop desc, p.k;

  elsif p_kind = 'subcategory' then
    return query
      with page as (
        select bs.book_id as id,
               coalesce(st.completed * 4 + st.reading * 3 + st.wishlist * 2 + st.views, 0) as pop,
               md5(bs.book_id || v_seed) as k
        from subcategories s
        join book_subcategories bs on bs.subcategory_id = s.id
        left join "bookStats" st on st."bookId" = bs.book_id
        where s.name = p_key
          and bs.book_id is distinct from p_exclude_id
          and not exists (select 1 from "readingList" r where r."userId" = v_uid and r."bookId" = bs.book_id)
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
