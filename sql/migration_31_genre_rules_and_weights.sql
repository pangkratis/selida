-- Genre rules, round 2 (2026-10-23), found with get_unmapped_subjects() from
-- migration_08, plus a fix for category/subject ties.
--
-- 1. THE TIE PROBLEM. Biblionet's category field is often wrong (children's
--    dinosaur books filed under "Φιλοσοφία"). A wrong category and the correct
--    subject heading both scored 1.0, so the primary genre was picked by genre_id
--    order — effectively at random (~3,000 books). When a book has at least one
--    genre derived from its subject headings, category-derived signals now count
--    at half strength, so the per-book subject wins and the category stays as a
--    weaker secondary genre. Books with only category signals are unchanged.
--
-- 2. RULES. Pattern families (same treatment the existing rules already give
--    "Αγγλική πεζογραφία" etc.) and ~25 individual headings. Deliberately NOT
--    mapped: places and periods (Ελλάς, Κύπρος, …), languages, education/reference
--    headings, "Κινηματογραφικές ταινίες" (= has a film adaptation; mapping it
--    would label novels like Κάρολ as art), holidays/animals, and
--    "Εθνική Αντίσταση, 1940-1944" — get_onboarding_subcategories() hides every
--    heading that has a genre rule, and that one is an onboarding topic chip.
--
-- After applying, re-resolve the books that have subject headings:
--   select fn_resolve_book_genres(id) from books
--   where cardinality(coalesce(subcategories,'{}')) > 0;     -- run in id batches
--   select refresh_genre_book_counts();

-- ── Resolver: one book ───────────────────────────────────────────────────────
create or replace function public.fn_resolve_book_genres(p_book_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  delete from book_genres where book_id = p_book_id and method = 'mapping';

  with signals as (
    select 'category' as signal_type, unnest(b.categories)    as raw_value, b.source
    from books b where b.id = p_book_id
    union all
    select 'subject'  as signal_type, unnest(b.subcategories) as raw_value, b.source
    from books b where b.id = p_book_id
  ),
  mapped as (
    select s.signal_type, m.genre_id, m.weight
    from signals s
    join genre_mappings m
      on m.source      = coalesce(s.source, 'biblionet')
     and m.signal_type = s.signal_type
     and m.raw_value   = s.raw_value
  ),
  has_subject as (
    select exists (select 1 from mapped where signal_type = 'subject') as yes
  ),
  scored as (
    select mp.genre_id,
           least(1.0, sum(mp.weight * case when mp.signal_type = 'category' and hs.yes then 0.5 else 1.0 end))::real as confidence
    from mapped mp cross join has_subject hs
    group by mp.genre_id
  ),
  ranked as (
    select genre_id, confidence,
           row_number() over (order by confidence desc, genre_id) = 1 as is_primary
    from scored
  )
  insert into book_genres (book_id, genre_id, confidence, method, is_primary)
  select p_book_id, genre_id, confidence, 'mapping', is_primary
  from ranked
  on conflict (book_id, genre_id) do update
    set confidence = excluded.confidence,
        is_primary = excluded.is_primary,
        method     = 'mapping';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ── Resolver: every book (full rebuild) ──────────────────────────────────────
create or replace function public.fn_resolve_all_book_genres()
returns table (books_matched bigint, genres_assigned bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Rebuild every rule-derived assignment from scratch; LLM/manual rows survive.
  delete from book_genres where method = 'mapping';

  return query
  with signals as (
    select b.id as book_id, 'category'::text as signal_type,
           unnest(b.categories) as raw_value, coalesce(b.source, 'biblionet') as source
    from books b
    union all
    select b.id, 'subject'::text, unnest(b.subcategories), coalesce(b.source, 'biblionet')
    from books b
  ),
  mapped as (
    select s.book_id, s.signal_type, m.genre_id, m.weight
    from signals s
    join genre_mappings m
      on m.source      = s.source
     and m.signal_type = s.signal_type
     and m.raw_value   = s.raw_value
  ),
  has_subject as (
    select distinct book_id from mapped where signal_type = 'subject'
  ),
  scored as (
    select mp.book_id, mp.genre_id,
           least(1.0, sum(mp.weight * case when mp.signal_type = 'category' and hs.book_id is not null then 0.5 else 1.0 end))::real as confidence
    from mapped mp
    left join has_subject hs on hs.book_id = mp.book_id
    group by mp.book_id, mp.genre_id
  ),
  ranked as (
    select sc.book_id, sc.genre_id, sc.confidence,
           row_number() over (partition by sc.book_id order by sc.confidence desc, sc.genre_id) = 1 as is_primary
    from scored sc
  ),
  ins as (
    insert into book_genres (book_id, genre_id, confidence, method, is_primary)
    select r.book_id, r.genre_id, r.confidence, 'mapping', r.is_primary
    from ranked r
    on conflict (book_id, genre_id) do update
      set confidence = excluded.confidence,
          is_primary = excluded.is_primary,
          method     = 'mapping'
    returning book_genres.book_id
  )
  select count(distinct i.book_id)::bigint, count(*)::bigint from ins i;
end;
$$;

revoke execute on function public.fn_resolve_book_genres(text) from public, anon, authenticated;
revoke execute on function public.fn_resolve_all_book_genres() from public, anon, authenticated;

-- ── Rules A: naming-pattern families ─────────────────────────────────────────
-- National prose -> literature (existing rules: "Αγγλική πεζογραφία" -> literature 1.0)
insert into genre_mappings (source, signal_type, raw_value, genre_id, weight)
select 'biblionet', 'subject', s.name, g.id, 1.0
from subcategories s
join genres g on g.slug = 'literature'
where s.name ~* 'πεζογραφία'
  and not exists (select 1 from genre_mappings m where m.source = 'biblionet' and m.signal_type = 'subject' and m.raw_value = s.name)
on conflict (source, signal_type, raw_value, genre_id) do nothing;

-- Poetry -> poetry. The two excluded names only end in "…ποίηση" by accident.
insert into genre_mappings (source, signal_type, raw_value, genre_id, weight)
select 'biblionet', 'subject', s.name, g.id, 1.0
from subcategories s
join genres g on g.slug = 'poetry'
where s.name ~* 'ποίηση'
  and s.name not in ('Εξωσωματική γονιμοποίηση', 'Παγκοσμιοποίηση', 'Θρησκεία και ποίηση')
  and not exists (select 1 from genre_mappings m where m.source = 'biblionet' and m.signal_type = 'subject' and m.raw_value = s.name)
on conflict (source, signal_type, raw_value, genre_id) do nothing;

-- Theatre -> drama
insert into genre_mappings (source, signal_type, raw_value, genre_id, weight)
select 'biblionet', 'subject', s.name, g.id, 1.0
from subcategories s
join genres g on g.slug = 'drama'
where (s.name ~* 'θεατρικά έργα' or s.name ~* '^(Ελληνικό|Λατινικό) δράμα' or s.name ~* 'θέατρο')
  and not exists (select 1 from genre_mappings m where m.source = 'biblionet' and m.signal_type = 'subject' and m.raw_value = s.name)
on conflict (source, signal_type, raw_value, genre_id) do nothing;

-- Children's poetry / theatre are also children's books.
insert into genre_mappings (source, signal_type, raw_value, genre_id, weight)
select 'biblionet', 'subject', s.name, g.id, 0.8
from subcategories s
join genres g on g.slug = 'childrens'
where s.name in ('Παιδική ποίηση, Μεταφρασμένη', 'Παιδικά θεατρικά έργα', 'Παιδικά θεατρικά έργα, Ελληνικά', 'Παιδικό θέατρο')
on conflict (source, signal_type, raw_value, genre_id) do nothing;

-- ── Rules B: individual headings ─────────────────────────────────────────────
insert into genre_mappings (source, signal_type, raw_value, genre_id, weight)
select 'biblionet', 'subject', v.raw, g.id, v.w
from (values
  ('Οικονομία',                          'business-economics',   1.0),
  ('Μάρκετινγκ',                         'business-economics',   1.0),
  ('Φιλοσοφία και θεωρία',               'philosophy',           1.0),
  ('Φιλοσοφία, Νεότερη',                 'philosophy',           1.0),
  ('Φιλοσοφία, Αρχαία ελληνική',         'philosophy',           1.0),
  ('Φιλοσοφικά συστήματα και διδασκαλίες','philosophy',          1.0),
  ('Πολιτική επιστήμη',                  'politics-society',     1.0),
  ('Πολιτική ιδεολογία',                 'politics-society',     1.0),
  ('Κομμουνισμός',                       'politics-society',     1.0),
  ('Δημοκρατία',                         'politics-society',     0.8),
  ('Ιστορία, Αρχαία',                    'history',              1.0),
  ('Αρχαιολογία',                        'history',              0.8),
  ('Αρχαία Ελλάδα',                      'history',              0.8),
  ('Αυτογνωσία',                         'psychology-self-help', 1.0),
  ('Διαπροσωπικές σχέσεις',              'psychology-self-help', 1.0),
  ('Κινηματογράφος',                     'art-culture',          1.0),
  ('Λευκώματα',                          'art-culture',          1.0),
  ('Αρχιτεκτονική',                      'art-culture',          1.0),
  ('Αυτοβιογραφίες',                     'biography-memoir',     1.0),
  ('Πνευματισμός',                       'religion-spirituality',1.0),
  ('Άγιοι',                              'religion-spirituality',1.0),
  ('Αποκρυφισμός',                       'religion-spirituality',0.8),
  ('Διατροφή',                           'health-wellbeing',     1.0),
  ('Φυσική',                             'science-nature',       1.0)
) as v(raw, slug, w)
join genres g on g.slug = v.slug
on conflict (source, signal_type, raw_value, genre_id) do nothing;
