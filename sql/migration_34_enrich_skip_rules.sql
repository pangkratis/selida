-- Which books the AI tags (decided with the user 2026-10-31).
--
-- Mood/theme tags make no sense for some of what the subcategory sync brings in,
-- so these are marked 'skipped' instead of being sent:
--   1. practical / academic books: primary genre technology, business-economics,
--      science-nature, health-wellbeing, food-travel or sports, or a subject
--      heading about law, teaching, textbooks, dictionaries, puzzles, maths,
--      computing or economics;
--   2. short children's books: primary genre childrens and 1–48 pages (picture,
--      activity and talking books).
-- Kept on purpose: poetry, books with no genre (real novels often lack one).
--
-- New status 'queued' = an admin asked for this book ("Tag again"). Queued books
-- go first and bypass the skip rules; the rules only look at books that have no
-- book_enrichment row yet.

alter table public.book_enrichment drop constraint if exists book_enrichment_status_check;
alter table public.book_enrichment add constraint book_enrichment_status_check
  check (status in ('pending', 'queued', 'done', 'skipped', 'failed'));

create or replace function public.fn_enrich_next_batch(p_limit int default 1000)
returns table (
  id            text,
  title         text,
  authors       text[],
  description   text,
  subcategories text[],
  genres        text[],
  "pageCount"   int
)
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into book_enrichment (book_id, status, error, updated_at)
  select b.id, 'skipped', 'description shorter than 80 characters', now()
  from books b
  where b."syncedSub" = true
    and length(coalesce(b.description, '')) < 80
    and not exists (select 1 from book_enrichment e where e.book_id = b.id)
  on conflict (book_id) do nothing;

  insert into book_enrichment (book_id, status, error, updated_at)
  select b.id, 'skipped', r.reason, now()
  from books b
  left join book_genres bg on bg.book_id = b.id and bg.is_primary
  left join genres g on g.id = bg.genre_id
  cross join lateral (
    select case
      when g.slug in ('technology', 'business-economics', 'science-nature',
                      'health-wellbeing', 'food-travel', 'sports')
        then 'practical or academic book (genre ' || g.slug || ')'
      when exists (select 1 from unnest(b.subcategories) h
                   where h ~* '(Σπουδή και διδασκαλία|δίκαιο|Εκπαίδευση|Γρίφοι|Άτλαντες|Λεξικά|Εγχειρίδια|Μαθηματικά|Πληροφορική|Οικονομικ)')
        then 'practical or academic book (subject heading)'
      when g.slug = 'childrens' and coalesce(b."pageCount", 0) between 1 and 48
        then 'short children''s book'
    end as reason
  ) r
  where b."syncedSub" = true
    and length(coalesce(b.description, '')) >= 80
    and r.reason is not null
    and not exists (select 1 from book_enrichment e where e.book_id = b.id)
  on conflict (book_id) do nothing;

  return query
  with candidates as (
    select distinct on (lower(b.title), lower(coalesce(b.authors[1], b.id)))
           b.id, b."popularityCount", b."createdAt", (e.status = 'queued') as queued
    from books b
    left join book_enrichment e on e.book_id = b.id
    where b."syncedSub" = true
      and length(coalesce(b.description, '')) >= 80
      and (e.book_id is null
           or e.status = 'queued'
           or (e.status = 'failed'  and e.attempts < 3)
           or (e.status = 'pending' and e.updated_at < now() - interval '2 days'))
    order by lower(b.title), lower(coalesce(b.authors[1], b.id)), (e.status = 'queued') desc nulls last,
             b."popularityCount" desc nulls last
  ),
  picked as materialized (       -- limit first, then look up genres only for these
    select * from candidates c
    order by c.queued desc nulls last, c."popularityCount" desc nulls last, c."createdAt" desc
    limit least(greatest(coalesce(p_limit, 1000), 1), 100000)
  )
  select b.id, b.title, b.authors, b.description, b.subcategories,
         coalesce((select array_agg(g.slug order by bg.is_primary desc, bg.confidence desc)
                   from book_genres bg join genres g on g.id = bg.genre_id
                   where bg.book_id = p.id), '{}'),
         b."pageCount"
  from picked p
  join books b on b.id = p.id
  order by p.queued desc nulls last, p."popularityCount" desc nulls last, p."createdAt" desc;
end;
$$;

-- "Tag again": drop the AI tags of the book and its editions, then mark the book
-- 'queued' so the next batch takes it first, skip rules or not.
create or replace function public.requeue_book_enrichment(p_book_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids text[];
begin
  perform fn_require_admin();
  select array_agg(e.book_id) into v_ids
  from book_enrichment e
  where e.book_id = p_book_id or e.copied_from = p_book_id;

  delete from book_tags where book_id = any(coalesce(v_ids, array[p_book_id])) and source = 'ai';
  delete from book_enrichment where copied_from = p_book_id;
  insert into book_enrichment (book_id, status, updated_at)
  values (p_book_id, 'queued', now())
  on conflict (book_id) do update
    set status = 'queued', error = null, evidence = null, raw = null, attempts = 0, updated_at = now();
end;
$$;

-- Adds 'skipped' (with the reason in `error`) to the admin list filters.
create or replace function public.get_enriched_books(
  p_filter text default 'all',
  p_search text default null,
  p_offset int  default 0,
  p_limit  int  default 30
)
returns table (
  id              text,
  title           text,
  authors         text[],
  "coverUrl"      text,
  description     text,
  "publishedYear" text,
  "pageCount"     int,
  publisher       text,
  subcategories   text[],
  status          text,
  evidence        text,
  model           text,
  error           text,
  enriched_at     timestamptz,
  copies          bigint,
  tags            jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_search text := nullif(trim(coalesce(p_search, '')), '');
begin
  perform fn_require_admin();
  return query
  select b.id, b.title, b.authors, b."coverUrl", b.description, b."publishedYear", b."pageCount",
         b.publisher, b.subcategories, e.status, e.evidence, e.model, e.error, e.updated_at,
         (select count(*) from book_enrichment c where c.copied_from = e.book_id),
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'tagId', t.id, 'facet', t.facet, 'slug', t.slug,
                    'labelEl', t.label_el, 'labelEn', t.label_en,
                    'strength', bt.strength, 'rank', bt.rank)
                  order by f.sort, bt.rank)
           from book_tags bt
           join tags t on t.id = bt.tag_id
           join tag_facets f on f.slug = t.facet
           where bt.book_id = e.book_id and bt.source = 'ai'
         ), '[]'::jsonb)
  from book_enrichment e
  join books b on b.id = e.book_id
  where e.copied_from is null
    and case coalesce(p_filter, 'all')
          when 'thin'    then e.status = 'done' and e.evidence = 'thin'
          when 'failed'  then e.status = 'failed'
          when 'skipped' then e.status = 'skipped'
          else e.status = 'done'
        end
    and (v_search is null or b.title ilike '%' || v_search || '%')
  order by e.updated_at desc, b.id
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

revoke execute on function public.fn_enrich_next_batch(int) from public, anon, authenticated;
grant  execute on function public.fn_enrich_next_batch(int) to service_role;
