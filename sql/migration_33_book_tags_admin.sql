-- Admin screen for book tags (Settings → Admin → "Book tags").
--
-- book_enrichment and enrich_state have no API access (migration_32), so the
-- screen reads and acts through these admin-only functions. Every one starts
-- with fn_require_admin().
--
--   get_enrich_overview()                 job switches + counts
--   get_enriched_books(filter, search…)   enriched books with their tags
--   set_enrich_enabled(bool)              pause / resume the daily job
--   requeue_book_enrichment(book_id)      drop the AI tags, the job redoes the book
--   remove_book_tag(book_id, tag_id)      drop one wrong AI tag (book + its copies)

create or replace function public.get_enrich_overview()
returns table (
  enabled        boolean,
  daily_limit    int,
  open_batch_id  text,
  last_run_at    timestamptz,
  last_result    text,
  done           bigint,
  editions       bigint,
  thin           bigint,
  failed         bigint,
  skipped        bigint,
  waiting        bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform fn_require_admin();
  return query
  select s.enabled, s.daily_limit, s.open_batch_id, s.last_run_at, s.last_result,
         (select count(*) from book_enrichment e where e.status = 'done' and e.copied_from is null),
         (select count(*) from book_enrichment e where e.status = 'done' and e.copied_from is not null),
         (select count(*) from book_enrichment e where e.status = 'done' and e.copied_from is null and e.evidence = 'thin'),
         (select count(*) from book_enrichment e where e.status = 'failed'),
         (select count(*) from book_enrichment e where e.status = 'skipped'),
         -- Synced books with a description and no enrichment row yet. Editions of
         -- one work count separately here, so the real batch count is a bit lower.
         (select count(*) from books b
           where b."syncedSub" = true and length(coalesce(b.description, '')) >= 80
             and not exists (select 1 from book_enrichment e where e.book_id = b.id))
  from enrich_state s
  where s.id = 1;
end;
$$;

-- p_filter: 'all' (enriched originals), 'thin' (weak descriptions), 'failed'.
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
          when 'thin'   then e.status = 'done' and e.evidence = 'thin'
          when 'failed' then e.status = 'failed'
          else e.status = 'done'
        end
    and (v_search is null or b.title ilike '%' || v_search || '%')
  order by e.updated_at desc, b.id
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

create or replace function public.set_enrich_enabled(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform fn_require_admin();
  update enrich_state set enabled = coalesce(p_enabled, false) where id = 1;
end;
$$;

-- Drops the book's AI tags and enrichment rows (and those of the editions that
-- got a copy), so the next daily batch picks it up again.
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
  delete from book_enrichment where book_id = any(coalesce(v_ids, array[p_book_id]));
end;
$$;

-- Removes one AI tag from a book and from the editions that got a copy of it.
-- A later re-enrichment can bring it back.
create or replace function public.remove_book_tag(p_book_id text, p_tag_id smallint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform fn_require_admin();
  delete from book_tags bt
  where bt.tag_id = p_tag_id
    and bt.source = 'ai'
    and (bt.book_id = p_book_id
         or bt.book_id in (select e.book_id from book_enrichment e where e.copied_from = p_book_id));
end;
$$;

revoke execute on function public.get_enrich_overview()                         from public, anon;
revoke execute on function public.get_enriched_books(text, text, int, int)      from public, anon;
revoke execute on function public.set_enrich_enabled(boolean)                   from public, anon;
revoke execute on function public.requeue_book_enrichment(text)                 from public, anon;
revoke execute on function public.remove_book_tag(text, smallint)               from public, anon;
grant  execute on function public.get_enrich_overview()                         to authenticated;
grant  execute on function public.get_enriched_books(text, text, int, int)      to authenticated;
grant  execute on function public.set_enrich_enabled(boolean)                   to authenticated;
grant  execute on function public.requeue_book_enrichment(text)                 to authenticated;
grant  execute on function public.remove_book_tag(text, smallint)               to authenticated;
