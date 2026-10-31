-- Book tags: mood, themes, setting, reading experience … picked by an AI from a fixed list.
--
-- Each book is enriched ONCE, after the subcategory sync has given it its subject
-- headings (syncedSub = true), so the model sees description + headings + genres.
-- The enrich-books Edge Function runs daily from pg_cron: it submits the books
-- synced since the last run to Anthropic's Batch API and saves the answers the
-- next time it runs. Tags are copied to the book's other editions (same title +
-- first author), so a work is paid for once.
--
--   tag_facets       the facets and their rules (max picks, fiction-only)
--   tags             the fixed vocabulary (edit labels/hints from the dashboard)
--   book_tags        book ↔ tag, per source ('ai' now, 'reader' / 'manual' later)
--   book_enrichment  one row per book: done / skipped / failed, raw answer, audit
--   enrich_state     the job's switches (disabled until the API key is set)
--
-- One-off setup that is NOT in this file (it holds secrets):
--   1. supabase secrets set ANTHROPIC_API_KEY=<key> ENRICH_CRON_SECRET=<random>
--   2. select vault.create_secret('<same random>', 'enrich_cron_secret');
--   3. supabase functions deploy enrich-books --use-api --no-verify-jwt
--   4. update enrich_state set enabled = true;
-- Pause: update enrich_state set enabled = false;
-- Undo a bad AI run: delete from book_tags where source = 'ai';
--                    delete from book_enrichment;

-- ── Vocabulary ───────────────────────────────────────────────────────────────
create table if not exists public.tag_facets (
  slug          text primary key,
  label_el      text not null,
  label_en      text not null,
  max_picks     int  not null check (max_picks > 0),
  fiction_only  boolean not null default false,
  hint          text,                         -- guidance for the model (English)
  sort          int  not null default 0
);

create table if not exists public.tags (
  id        smallserial primary key,
  facet     text not null references public.tag_facets(slug) on update cascade,
  slug      text not null unique,
  label_el  text not null,
  label_en  text not null,
  hint      text,                             -- guidance for the model (English)
  active    boolean not null default true,    -- retire a tag without losing history
  sort      int not null default 0
);

create table if not exists public.book_tags (
  book_id     text not null references public.books(id) on delete cascade,
  tag_id      smallint not null references public.tags(id) on delete cascade,
  source      text not null default 'ai' check (source in ('ai', 'reader', 'manual')),
  rank        smallint not null default 1,    -- 1 = strongest within its facet
  strength    text not null default 'clear' check (strength in ('clear', 'implied')),
  created_at  timestamptz not null default now(),
  primary key (book_id, tag_id, source)
);
create index if not exists book_tags_tag_book on public.book_tags (tag_id, book_id);

create table if not exists public.book_enrichment (
  book_id           text primary key references public.books(id) on delete cascade,
  status            text not null check (status in ('pending', 'done', 'skipped', 'failed')),
  model             text,
  vocab_version     int,
  evidence          text check (evidence in ('rich', 'thin')),
  description_hash  text,                     -- md5(description) when enriched
  copied_from       text,                     -- set on editions that got a copy
  raw               jsonb,                    -- the model's answer, for audit
  error             text,
  attempts          int not null default 0,
  updated_at        timestamptz not null default now()
);

-- Readable by everyone (book metadata), writable only by the owner/service role.
alter table public.tag_facets      enable row level security;
alter table public.tags            enable row level security;
alter table public.book_tags       enable row level security;
alter table public.book_enrichment enable row level security;

drop policy if exists tag_facets_read on public.tag_facets;
drop policy if exists tags_read       on public.tags;
drop policy if exists book_tags_read  on public.book_tags;
create policy tag_facets_read on public.tag_facets for select to anon, authenticated using (true);
create policy tags_read       on public.tags       for select to anon, authenticated using (true);
create policy book_tags_read  on public.book_tags  for select to anon, authenticated using (true);

revoke insert, update, delete, truncate on public.tag_facets, public.tags, public.book_tags from anon, authenticated;
revoke all on public.book_enrichment from anon, authenticated;

-- ── Seed: facets ─────────────────────────────────────────────────────────────
insert into public.tag_facets (slug, label_el, label_en, max_picks, fiction_only, hint, sort) values
  ('mood',           'Διάθεση',               'Mood and tone',      3, false, 'How the book feels to read. Strongest first.', 10),
  ('storytelling',   'Αφήγηση',               'Storytelling',       1, true,  'Character-driven vs plot-driven. Leave empty if unclear.', 30),
  ('form',           'Μορφή',                 'Form',               2, true,  'Only when the description states it.', 50),
  ('experience',     'Εμπειρία ανάγνωσης',    'Reading experience', 2, false, null, 60),
  ('theme',          'Θέματα',                'Themes',             4, false, 'What the book is about, strongest first.', 70),
  ('setting-region', 'Πού διαδραματίζεται',   'Setting: region',    2, false, 'Where the story (or subject) takes place. Subject headings naming a place are authoritative.', 80),
  ('setting-period', 'Πότε διαδραματίζεται',  'Setting: period',    1, false, 'When the story takes place, NOT when the book was published.', 90),
  ('setting-place',  'Τόπος',                 'Setting: place type',1, false, null, 100),
  ('flag',           'Χαρακτηριστικά',        'Flags',              2, false, 'Set by the fiction / true_story answers, not picked as tags.', 110)
on conflict (slug) do nothing;

-- ── Seed: tags ───────────────────────────────────────────────────────────────
insert into public.tags (facet, slug, label_el, label_en, hint, sort) values
  -- mood
  ('mood', 'dark',          'Σκοτεινό',        'Dark',          null, 1),
  ('mood', 'hopeful',       'Αισιόδοξο',       'Hopeful',       null, 2),
  ('mood', 'melancholic',   'Μελαγχολικό',     'Melancholic',   null, 3),
  ('mood', 'heartwarming',  'Τρυφερό',         'Heartwarming',  null, 4),
  ('mood', 'funny',         'Αστείο',          'Funny',         null, 5),
  ('mood', 'tense',         'Γεμάτο ένταση',   'Tense',         'suspense, thrills', 6),
  ('mood', 'mysterious',    'Μυστηριώδες',     'Mysterious',    null, 7),
  ('mood', 'romantic',      'Ρομαντικό',       'Romantic',      null, 8),
  ('mood', 'unsettling',    'Ανησυχητικό',     'Unsettling',    'disturbing, eerie', 9),
  ('mood', 'inspiring',     'Εμπνευστικό',     'Inspiring',     null, 10),
  ('mood', 'reflective',    'Στοχαστικό',      'Reflective',    'contemplative', 11),
  ('mood', 'adventurous',   'Περιπετειώδες',   'Adventurous',   null, 12),
  ('mood', 'whimsical',     'Παιχνιδιάρικο',   'Whimsical',     'playful, fairy-tale-like', 13),
  ('mood', 'nostalgic',     'Νοσταλγικό',      'Nostalgic',     null, 14),
  ('mood', 'ironic',        'Ειρωνικό',        'Ironic',        null, 15),
  ('mood', 'satirical',     'Σατιρικό',        'Satirical',     null, 16),
  ('mood', 'raw',           'Ωμό',             'Raw',           'gritty, unflinching', 17),
  ('mood', 'intimate',      'Εξομολογητικό',   'Intimate',      'confessional, personal', 18),
  -- storytelling
  ('storytelling', 'character-driven', 'Έμφαση στους χαρακτήρες', 'Character-driven', null, 1),
  ('storytelling', 'plot-driven',      'Έμφαση στην πλοκή',       'Plot-driven',      null, 2),
  -- form
  ('form', 'short-stories',      'Διηγήματα',               'Short stories',       'a collection of stories', 1),
  ('form', 'letters-diary',      'Επιστολές ή ημερολόγιο',  'Letters or diary',    null, 2),
  ('form', 'multiple-timelines', 'Παράλληλοι χρόνοι',       'Multiple timelines',  null, 3),
  ('form', 'multiple-narrators', 'Πολλοί αφηγητές',         'Multiple narrators',  null, 4),
  -- experience
  ('experience', 'easy-read',             'Εύκολο ανάγνωσμα',          'Easy read',             null, 1),
  ('experience', 'challenging',           'Απαιτητικό',                'Challenging',           null, 2),
  ('experience', 'page-turner',           'Δεν αφήνεται από τα χέρια', 'Page-turner',           null, 3),
  ('experience', 'thought-provoking',     'Βάζει σε σκέψεις',          'Thought-provoking',     null, 4),
  ('experience', 'immersive',             'Σε απορροφά',               'Immersive',             null, 5),
  ('experience', 'cozy',                  'Ζεστό, χαλαρό',             'Cozy',                  null, 6),
  ('experience', 'emotionally-demanding', 'Συναισθηματικά φορτισμένο', 'Emotionally demanding', null, 7),
  ('experience', 'educational',           'Ενημερωτικό',               'Educational',           'you learn something concrete', 8),
  -- themes
  ('theme', 'love',                'Αγάπη',                       'Love',                     null, 1),
  ('theme', 'family',              'Οικογένεια',                  'Family',                   null, 2),
  ('theme', 'friendship',          'Φιλία',                       'Friendship',               null, 3),
  ('theme', 'coming-of-age',       'Ενηλικίωση',                  'Coming of age',            null, 4),
  ('theme', 'identity',            'Ταυτότητα',                   'Identity',                 null, 5),
  ('theme', 'loneliness',          'Μοναξιά',                     'Loneliness',               null, 6),
  ('theme', 'belonging',           'Το αίσθημα του ανήκειν',      'Belonging',                null, 7),
  ('theme', 'loss-grief',          'Απώλεια και πένθος',          'Loss and grief',           null, 8),
  ('theme', 'death',               'Θάνατος',                     'Death and mortality',      null, 9),
  ('theme', 'war',                 'Πόλεμος',                     'War',                      null, 10),
  ('theme', 'migration-exile',     'Μετανάστευση και ξενιτιά',    'Migration and exile',      'includes refugees and Greek emigration', 11),
  ('theme', 'power-politics',      'Εξουσία και πολιτική',        'Power and politics',       null, 12),
  ('theme', 'crime-justice',       'Έγκλημα και δικαιοσύνη',      'Crime and justice',        null, 13),
  ('theme', 'corruption-morality', 'Διαφθορά και ηθική',          'Corruption and morality',  null, 14),
  ('theme', 'survival',            'Επιβίωση',                    'Survival',                 null, 15),
  ('theme', 'faith',               'Πίστη',                       'Faith',                    null, 16),
  ('theme', 'nature',              'Φύση',                        'Nature',                   null, 17),
  ('theme', 'memory',              'Μνήμη',                       'Memory',                   null, 18),
  ('theme', 'facing-the-past',     'Συμφιλίωση με το παρελθόν',   'Coming to terms with the past', null, 19),
  ('theme', 'social-class',        'Κοινωνική τάξη',              'Social class',             null, 20),
  ('theme', 'freedom',             'Ελευθερία',                   'Freedom',                  null, 21),
  ('theme', 'betrayal',            'Προδοσία',                    'Betrayal',                 null, 22),
  ('theme', 'revenge',             'Εκδίκηση',                    'Revenge',                  null, 23),
  ('theme', 'redemption',          'Λύτρωση',                     'Redemption',               null, 24),
  ('theme', 'transformation',      'Προσωπική μεταμόρφωση',       'Personal transformation',  null, 25),
  ('theme', 'mental-health',       'Ψυχική υγεία',                'Mental health',            null, 26),
  ('theme', 'womens-lives',        'Η ζωή των γυναικών',          'Women''s lives',           null, 27),
  ('theme', 'generations',         'Σύγκρουση γενεών',            'Generational conflict',    null, 28),
  ('theme', 'art-creativity',      'Τέχνη και δημιουργία',        'Art and creativity',       null, 29),
  ('theme', 'meaning-of-life',     'Το νόημα της ζωής',           'Meaning of life',          null, 30),
  -- setting: region
  ('setting-region', 'greece',          'Ελλάδα',             'Greece',          null, 1),
  ('setting-region', 'cyprus',          'Κύπρος',             'Cyprus',          null, 2),
  ('setting-region', 'balkans',         'Βαλκάνια',           'Balkans',         'excluding Greece', 3),
  ('setting-region', 'western-europe',  'Δυτική Ευρώπη',      'Western Europe',  null, 4),
  ('setting-region', 'eastern-europe',  'Ανατολική Ευρώπη',   'Eastern Europe',  'includes Russia', 5),
  ('setting-region', 'northern-europe', 'Βόρεια Ευρώπη',      'Northern Europe', 'Scandinavia, Baltics', 6),
  ('setting-region', 'north-america',   'Βόρεια Αμερική',     'North America',   null, 7),
  ('setting-region', 'latin-america',   'Λατινική Αμερική',   'Latin America',   null, 8),
  ('setting-region', 'middle-east',     'Μέση Ανατολή',       'Middle East',     'includes Turkey and Asia Minor', 9),
  ('setting-region', 'asia',            'Ασία',               'Asia',            null, 10),
  ('setting-region', 'africa',          'Αφρική',             'Africa',          null, 11),
  ('setting-region', 'imaginary-world', 'Φανταστικός κόσμος', 'Imaginary world', null, 12),
  -- setting: period
  ('setting-period', 'ancient',             'Αρχαιότητα',                 'Ancient',              null, 1),
  ('setting-period', 'byzantine-medieval',  'Βυζάντιο και Μεσαίωνας',     'Byzantine / medieval', null, 2),
  ('setting-period', 'ottoman-1821',        'Τουρκοκρατία και 1821',      'Ottoman era / 1821',   'Greece under Ottoman rule and the War of Independence', 3),
  ('setting-period', 'early-modern',        '17ος και 18ος αιώνας',       '17th-18th century',    'outside Greece; Greek settings of this era use ottoman-1821', 4),
  ('setting-period', '19th-century',        '19ος αιώνας',                '19th century',         null, 5),
  ('setting-period', 'early-20th-century',  'Αρχές 20ού αιώνα',           'Early 20th century',   'up to the 1930s, other than 1922', 6),
  ('setting-period', 'asia-minor-1922',     'Μικρασιατική καταστροφή',    'Asia Minor 1922',      null, 7),
  ('setting-period', 'wwii-occupation',     'Β΄ Παγκόσμιος και Κατοχή',   'WWII / Occupation',    null, 8),
  ('setting-period', 'civil-war',           'Εμφύλιος',                   'Civil War',            'the Greek Civil War 1946-49, or another civil war', 9),
  ('setting-period', 'post-war',            'Μεταπολεμικά χρόνια',        'Post-war',             '1950s-1960s', 10),
  ('setting-period', 'junta',               'Χούντα',                     'Junta',                'Greek dictatorship 1967-74', 11),
  ('setting-period', 'contemporary',        'Σύγχρονη εποχή',             'Contemporary',         'roughly 1975 to today', 12),
  ('setting-period', 'future',              'Μέλλον',                     'Future',               null, 13),
  -- setting: place type
  ('setting-place', 'city',        'Πόλη',               'City',           null, 1),
  ('setting-place', 'small-town',  'Μικρή πόλη',         'Small town',     null, 2),
  ('setting-place', 'village',     'Χωριό',              'Village',        null, 3),
  ('setting-place', 'island-sea',  'Νησί και θάλασσα',   'Island / coast', null, 4),
  ('setting-place', 'wilderness',  'Άγρια φύση',         'Wilderness',     null, 5),
  ('setting-place', 'isolated',    'Απομονωμένος τόπος', 'Isolated place', null, 6),
  -- flags (set from the fiction / true_story answers)
  ('flag', 'fiction',     'Μυθοπλασία',                      'Fiction',                 null, 1),
  ('flag', 'true-story',  'Βασισμένο σε αληθινή ιστορία',    'Based on a true story',   null, 2)
on conflict (slug) do nothing;

-- ── Job state: one row ───────────────────────────────────────────────────────
create table if not exists public.enrich_state (
  id               int primary key default 1 check (id = 1),
  enabled          boolean not null default false,
  daily_limit      int  not null default 1000,
  vocab_version    int  not null default 1,
  model            text not null default 'claude-haiku-4-5-20251001',
  open_batch_id    text,
  open_batch_at    timestamptz,
  last_submit_day  date,
  last_run_at      timestamptz,
  last_result      text,
  total_enriched   bigint not null default 0
);
insert into public.enrich_state (id) values (1) on conflict (id) do nothing;
alter table public.enrich_state enable row level security;
revoke all on public.enrich_state from anon, authenticated;

-- ── Queue: books to enrich next ──────────────────────────────────────────────
-- The queue must stay under the API's 8 s statement timeout. Without these the
-- planner seq-scans all of `books` (~450 MB); with them it reads only the index
-- (predicates must match the queries below exactly).
create index if not exists books_enrich_queue_idx
  on public.books (lower(title), lower(coalesce(authors[1], id)), "popularityCount" desc nulls last)
  include (id, "createdAt")
  where "syncedSub" = true and length(coalesce(description, '')) >= 80;
create index if not exists books_enrich_short_idx
  on public.books (id)
  where "syncedSub" = true and length(coalesce(description, '')) < 80;

-- Synced books that have not been enriched (or failed < 3 times, or have been
-- pending for over 2 days because a batch was lost). One edition per work.
-- Books whose description is too short to say anything are marked 'skipped'.
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

  return query
  with candidates as (
    select distinct on (lower(b.title), lower(coalesce(b.authors[1], b.id)))
           b.id, b."popularityCount", b."createdAt"
    from books b
    left join book_enrichment e on e.book_id = b.id
    where b."syncedSub" = true
      and length(coalesce(b.description, '')) >= 80
      and (e.book_id is null
           or (e.status = 'failed'  and e.attempts < 3)
           or (e.status = 'pending' and e.updated_at < now() - interval '2 days'))
    order by lower(b.title), lower(coalesce(b.authors[1], b.id)), b."popularityCount" desc nulls last
  ),
  picked as materialized (       -- limit first, then look up genres only for these
    select * from candidates c
    order by c."popularityCount" desc nulls last, c."createdAt" desc
    limit least(greatest(coalesce(p_limit, 1000), 1), 100000)
  )
  select b.id, b.title, b.authors, b.description, b.subcategories,
         coalesce((select array_agg(g.slug order by bg.is_primary desc, bg.confidence desc)
                   from book_genres bg join genres g on g.id = bg.genre_id
                   where bg.book_id = p.id), '{}'),
         b."pageCount"
  from picked p
  join books b on b.id = p.id
  order by p."popularityCount" desc nulls last, p."createdAt" desc;
end;
$$;

-- Marks books as submitted, so they are not picked again while a batch runs.
create or replace function public.fn_enrich_mark_pending(p_book_ids text[])
returns void
language sql
security definer
set search_path = public
as $$
  insert into book_enrichment (book_id, status, updated_at)
  select unnest(p_book_ids), 'pending', now()
  on conflict (book_id) do update set status = 'pending', updated_at = now();
$$;

-- ── Save answers ─────────────────────────────────────────────────────────────
-- p_items: [{ "book_id", "fiction": bool, "true_story": bool, "evidence": "rich"|"thin",
--             "tags": [{ "slug", "strength": "clear"|"implied" }, …] }, …]
-- Tags are validated here (unknown/retired slugs dropped, per-facet max enforced,
-- fiction-only facets dropped for non-fiction), so any caller can use it.
-- The result is copied to the book's other editions (same title + first author).
create or replace function public.fn_enrich_save(p_items jsonb, p_model text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item     jsonb;
  v_book     text;
  v_fiction  boolean;
  v_ids      text[];
  v_vocab    int;
  v_saved    int := 0;
begin
  select vocab_version into v_vocab from enrich_state where id = 1;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_book    := v_item->>'book_id';
    v_fiction := coalesce((v_item->>'fiction')::boolean, false);
    continue when not exists (select 1 from books where books.id = v_book);

    -- The book plus its other editions; books without an author are not matched.
    select array_agg(distinct o.id) into v_ids
    from books b
    join books o on o.id = b.id
               or (b.authors[1] is not null
                   and lower(o.title) = lower(b.title)
                   and lower(coalesce(o.authors[1], '')) = lower(b.authors[1]))
    where b.id = v_book;

    delete from book_tags where book_id = any(v_ids) and source = 'ai';

    insert into book_tags (book_id, tag_id, source, rank, strength)
    select x.book_id, v.tag_id, 'ai', v.rank, v.strength
    from (
      select t.id as tag_id,
             row_number() over (partition by t.facet order by a.ord)::smallint as rank,
             case when a.strength = 'implied' then 'implied' else 'clear' end as strength,
             f.max_picks
      from (
        -- the model's order is the rank; a repeated slug keeps its first position
        select distinct on (j.e->>'slug') j.e->>'slug' as slug, j.e->>'strength' as strength, j.ord
        from jsonb_array_elements(coalesce(v_item->'tags', '[]'::jsonb)) with ordinality j(e, ord)
        order by j.e->>'slug', j.ord
      ) a
      join tags t on t.slug = a.slug and t.active and t.facet <> 'flag'
      join tag_facets f on f.slug = t.facet
      where v_fiction or not f.fiction_only
      union all
      select t.id, 1::smallint, 'clear', 1
      from tags t
      where (t.slug = 'fiction' and v_fiction)
         or (t.slug = 'true-story' and coalesce((v_item->>'true_story')::boolean, false))
    ) v
    cross join unnest(v_ids) as x(book_id)
    where v.rank <= v.max_picks
    on conflict (book_id, tag_id, source) do update
      set rank = excluded.rank, strength = excluded.strength, created_at = now();

    insert into book_enrichment (book_id, status, model, vocab_version, evidence,
                                 description_hash, copied_from, raw, error, updated_at)
    select x.book_id, 'done', p_model, v_vocab,
           case when v_item->>'evidence' in ('rich', 'thin') then v_item->>'evidence' end,
           md5(coalesce(b.description, '')),
           case when x.book_id <> v_book then v_book end,
           case when x.book_id = v_book then v_item end,
           null, now()
    from unnest(v_ids) as x(book_id)
    join books b on b.id = x.book_id
    on conflict (book_id) do update
      set status = 'done', model = excluded.model, vocab_version = excluded.vocab_version,
          evidence = excluded.evidence, description_hash = excluded.description_hash,
          copied_from = excluded.copied_from, raw = excluded.raw, error = null,
          updated_at = now();

    v_saved := v_saved + 1;
  end loop;

  update enrich_state set total_enriched = total_enriched + v_saved where id = 1;
  return v_saved;
end;
$$;

create or replace function public.fn_enrich_fail(p_book_id text, p_error text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into book_enrichment (book_id, status, error, attempts, updated_at)
  values (p_book_id, 'failed', left(p_error, 500), 1, now())
  on conflict (book_id) do update
    set status = 'failed', error = left(p_error, 500),
        attempts = book_enrichment.attempts + 1, updated_at = now();
$$;

-- Cheap check for the cron job: a batch to collect, or today's batch not sent yet.
create or replace function public.fn_enrich_should_run()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select s.enabled
     and (s.open_batch_id is not null
          or s.last_submit_day is distinct from (now() at time zone 'utc')::date)
  from enrich_state s
  where s.id = 1;
$$;

revoke execute on function public.fn_enrich_next_batch(int)          from public, anon, authenticated;
revoke execute on function public.fn_enrich_mark_pending(text[])     from public, anon, authenticated;
revoke execute on function public.fn_enrich_save(jsonb, text)        from public, anon, authenticated;
revoke execute on function public.fn_enrich_fail(text, text)         from public, anon, authenticated;
revoke execute on function public.fn_enrich_should_run()             from public, anon, authenticated;
grant  execute on function public.fn_enrich_next_batch(int)          to service_role;
grant  execute on function public.fn_enrich_mark_pending(text[])     to service_role;
grant  execute on function public.fn_enrich_save(jsonb, text)        to service_role;
grant  execute on function public.fn_enrich_fail(text, text)         to service_role;
grant  execute on function public.fn_enrich_should_run()             to service_role;
grant  select, update on public.enrich_state to service_role;

-- ── Schedule: every 30 minutes, does nothing while enrich_state.enabled = false ─
do $$
begin
  if exists (select 1 from cron.job where jobname = 'enrich-run') then
    perform cron.unschedule('enrich-run');
  end if;
end $$;

select cron.schedule('enrich-run', '*/30 * * * *', $cron$
  select net.http_post(
    url := 'https://rxovzritmmnpodojhfuj.supabase.co/functions/v1/enrich-books',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'enrich_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  )
  where public.fn_enrich_should_run();
$cron$);
