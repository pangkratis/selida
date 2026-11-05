-- Reader types v2: distinctive genre + theme flavour, stored in the database (2026-11-05).
--
-- v1 (migration 39 + constants/reader-types.ts) named readers after their two
-- biggest genres. Literature is 81% of the books in users' lists (it is the
-- catalog's default shelf for novels), so nearly everyone became "Bookworm of …".
--
-- v2:
--   noun    = the most DISTINCTIVE genre among those with at least 2 of the
--             user's books: user score × (catalog share)^-0.35, so a genre that
--             is rare in the catalog counts for more, softened so one poetry
--             book can't outweigh thirty novels. Literature only wins when
--             nothing else stands out.
--   flavour = the user's strongest THEME tag (AI book tags, migration 32), also
--             weighted by rarity, when at least 3 of their books are tagged and
--             the theme appears in at least 2 → "Bookworm of Old Wounds".
--             Otherwise the next most distinctive genre's phrase (v1 style),
--             otherwise the noun genre's own phrase.
--   moods   = top 3 mood tags (shown as a line under the title).
--   fewer than 3 genre-tagged books → onboarding picks (first = noun,
--   second = flavour), as in v1.
--
-- Names live in two editable tables — change them in the dashboard, no app
-- release needed:
--   reader_archetypes  one row per genre: noun, "of …" phrase, tagline, icon
--   reader_flavours    one row per theme tag: "of …" phrase
-- The result is saved on users (readerGenre, readerFlavour, readerTypeAt) so
-- it can be counted, used in recommendations or shared later.
--
-- Greek: nouns are gender-neutral (ο/η φιλόσοφος, ντετέκτιβ…) or of fixed
-- grammatical gender (Καρδιά, Ξωτικό…); flavours are genitive phrases, so
-- nothing has to agree with the reader's gender.

-- ── Names ───────────────────────────────────────────────────────────────────
create table if not exists public.reader_archetypes (
  genre_slug  text primary key,
  noun_en     text not null,
  noun_el     text not null,
  of_en       text not null,
  of_el       text not null,
  tagline_en  text not null,
  tagline_el  text not null,
  icon        text not null,   -- Ionicons name
  updated_at  timestamptz not null default now()
);

create table if not exists public.reader_flavours (
  tag_slug    text primary key,
  of_en       text not null,
  of_el       text not null,
  updated_at  timestamptz not null default now()
);

alter table public.reader_archetypes enable row level security;
alter table public.reader_flavours   enable row level security;
drop policy if exists reader_archetypes_read on public.reader_archetypes;
drop policy if exists reader_flavours_read   on public.reader_flavours;
create policy reader_archetypes_read on public.reader_archetypes for select to anon, authenticated using (true);
create policy reader_flavours_read   on public.reader_flavours   for select to anon, authenticated using (true);

insert into public.reader_archetypes (genre_slug, noun_en, noun_el, of_en, of_el, tagline_en, tagline_el, icon) values
  ('literature', 'Bookworm', 'Βιβλιοφάγος', 'of Great Novels', 'των μεγάλων μυθιστορημάτων', 'A good story is all you need.', 'Μια καλή ιστορία σού αρκεί.', 'book'),
  ('crime-thriller', 'Detective', 'Ντετέκτιβ', 'of Dark Alleys', 'των σκοτεινών σοκακιών', 'You always find out who did it.', 'Πάντα βρίσκεις ποιος το έκανε.', 'search'),
  ('science-fiction', 'Starchild', 'Αστρόπαιδο', 'of Distant Galaxies', 'των μακρινών γαλαξιών', 'Your head is in the future.', 'Το μυαλό σου είναι στο μέλλον.', 'planet'),
  ('fantasy', 'Elf', 'Ξωτικό', 'of Enchanted Kingdoms', 'των μαγεμένων βασιλείων', 'Dragons over daily news, any day.', 'Δράκοι αντί για ειδήσεις, κάθε μέρα.', 'sparkles'),
  ('horror', 'Night Owl', 'Νυχτοπούλι', 'of Haunted Houses', 'των στοιχειωμένων σπιτιών', 'You read with the lights on.', 'Διαβάζεις με αναμμένα φώτα.', 'moon'),
  ('romance', 'Heart', 'Καρδιά', 'of Great Loves', 'των μεγάλων ερώτων', 'Here for the happy ending.', 'Εδώ για το happy end.', 'heart'),
  ('historical-fiction', 'Chronicler', 'Χρονογράφος', 'of Bygone Eras', 'των περασμένων εποχών', 'Born in the wrong century.', 'Γεννήθηκες σε λάθος αιώνα.', 'hourglass'),
  ('poetry', 'Dreamer', 'Ονειροπόλος', 'of Verses', 'των στίχων', 'Few words, big feelings.', 'Λίγες λέξεις, μεγάλα συναισθήματα.', 'pencil'),
  ('drama', 'Muse', 'Μούσα', 'of the Stage', 'της σκηνής', 'All the world’s a stage.', 'Όλος ο κόσμος μια σκηνή.', 'happy'),
  ('comics', 'Superkid', 'Σουπερπαιδί', 'of Colourful Panels', 'των πολύχρωμων καρέ', 'Pictures speak louder.', 'Οι εικόνες μιλούν πιο δυνατά.', 'flash'),
  ('childrens', 'Fairy', 'Νεράιδα', 'of Fairy Tales', 'των παραμυθιών', 'Once upon a time, every time.', 'Μια φορά κι έναν καιρό, κάθε φορά.', 'balloon'),
  ('young-adult', 'Wild Spirit', 'Ατίθασο Πνεύμα', 'of Coming of Age', 'της ενηλικίωσης', 'Every page is a first time.', 'Κάθε σελίδα, μια πρώτη φορά.', 'flame'),
  ('biography-memoir', 'Witness', 'Μάρτυρας', 'of Real Lives', 'των αληθινών ζωών', 'Real lives beat fiction.', 'Οι αληθινές ζωές ξεπερνούν τη μυθοπλασία.', 'person'),
  ('history', 'Historian', 'Ιστορικός', 'of Ancient Empires', 'των αρχαίων αυτοκρατοριών', 'The past is your playground.', 'Το παρελθόν είναι η παιδική σου χαρά.', 'library'),
  ('philosophy', 'Philosopher', 'Φιλόσοφος', 'of Big Questions', 'των μεγάλων ερωτημάτων', 'Why? is your favourite word.', 'Το «γιατί;» είναι η αγαπημένη σου λέξη.', 'bulb'),
  ('psychology-self-help', 'Curious Mind', 'Ανήσυχο Μυαλό', 'of Inner Worlds', 'των εσωτερικών κόσμων', 'Always working on yourself.', 'Πάντα δουλεύεις τον εαυτό σου.', 'infinite'),
  ('religion-spirituality', 'Old Soul', 'Αρχαία Ψυχή', 'of Quiet Wisdom', 'της ήσυχης σοφίας', 'You read slowly and deeply.', 'Διαβάζεις αργά και βαθιά.', 'leaf'),
  ('science-nature', 'Naturalist', 'Φυσιοδίφης', 'of Wild Nature', 'της άγριας φύσης', 'Curious about how everything works.', 'Θες να ξέρεις πώς δουλεύουν όλα.', 'flask'),
  ('technology', 'Robot', 'Ρομπότ', 'of the Future', 'του μέλλοντος', 'Beep boop, one more chapter.', 'Μπιπ μπουπ, ένα κεφάλαιο ακόμα.', 'hardware-chip'),
  ('business-economics', 'Strategist', 'Στρατηγός', 'of Bold Ideas', 'των τολμηρών ιδεών', 'Every book is an investment.', 'Κάθε βιβλίο είναι μια επένδυση.', 'trending-up'),
  ('politics-society', 'Citizen', 'Πολίτης', 'of the World', 'του κόσμου', 'Reading to change the world.', 'Διαβάζεις για να αλλάξεις τον κόσμο.', 'globe'),
  ('health-wellbeing', 'Guru', 'Γκουρού', 'of Good Vibes', 'της καλής ενέργειας', 'Body, mind and a good book.', 'Σώμα, μυαλό κι ένα καλό βιβλίο.', 'fitness'),
  ('art-culture', 'Aesthete', 'Εστέτ', 'of Beautiful Things', 'των ωραίων πραγμάτων', 'Life is too short for ugly books.', 'Η ζωή είναι μικρή για άσχημα βιβλία.', 'color-palette'),
  ('food-travel', 'Nomad', 'Νομάς', 'of Faraway Places', 'των μακρινών τόπων', 'Your passport is a library card.', 'Το διαβατήριό σου είναι τα βιβλία.', 'airplane'),
  ('sports', 'Team Spirit', 'Ομαδικό Πνεύμα', 'of the Finish Line', 'του τερματισμού', 'Reading marathons only.', 'Μόνο μαραθώνιοι ανάγνωσης.', 'trophy')
on conflict (genre_slug) do nothing;

insert into public.reader_flavours (tag_slug, of_en, of_el) values
  ('art-creativity',      'of Creative Souls',        'των δημιουργικών ψυχών'),
  ('belonging',           'of Finding Home',          'του ανήκειν'),
  ('betrayal',            'of Broken Trust',          'της προδοσίας'),
  ('coming-of-age',       'of Growing Up',            'της ενηλικίωσης'),
  ('corruption-morality', 'of Moral Dilemmas',        'των ηθικών διλημμάτων'),
  ('crime-justice',       'of Crime and Punishment',  'του εγκλήματος και της τιμωρίας'),
  ('death',               'of Mortality',             'της θνητότητας'),
  ('facing-the-past',     'of Old Wounds',            'των παλιών πληγών'),
  ('faith',               'of Faith',                 'της πίστης'),
  ('family',              'of Family Sagas',          'των οικογενειακών ιστοριών'),
  ('freedom',             'of Freedom',               'της ελευθερίας'),
  ('friendship',          'of True Friends',          'των αληθινών φίλων'),
  ('generations',         'of Generations',           'των γενεών'),
  ('identity',            'of Self-Discovery',        'της αυτογνωσίας'),
  ('loneliness',          'of Lonely Hearts',         'των μοναχικών καρδιών'),
  ('loss-grief',          'of Loss',                  'της απώλειας'),
  ('love',                'of Great Loves',           'των μεγάλων ερώτων'),
  ('meaning-of-life',     'of Big Questions',         'των μεγάλων ερωτημάτων'),
  ('memory',              'of Memories',              'των αναμνήσεων'),
  ('mental-health',       'of Inner Storms',          'των εσωτερικών καταιγίδων'),
  ('migration-exile',     'of Far Horizons',          'της ξενιτιάς'),
  ('nature',              'of Wild Nature',           'της άγριας φύσης'),
  ('power-politics',      'of Power Games',           'των παιχνιδιών εξουσίας'),
  ('redemption',          'of Second Chances',        'των δεύτερων ευκαιριών'),
  ('revenge',             'of Sweet Revenge',         'της γλυκιάς εκδίκησης'),
  ('social-class',        'of Rich and Poor',         'των πλουσίων και των φτωχών'),
  ('survival',            'of Survival',              'της επιβίωσης'),
  ('transformation',      'of New Beginnings',        'των νέων ξεκινημάτων'),
  ('war',                 'of Battlefields',          'των πεδίων της μάχης'),
  ('womens-lives',        'of Remarkable Women',      'των σπουδαίων γυναικών')
on conflict (tag_slug) do nothing;

-- ── Saved result ────────────────────────────────────────────────────────────
alter table public.users add column if not exists "readerGenre"   text;
alter table public.users add column if not exists "readerFlavour" text;   -- 'tag:<slug>' or 'genre:<slug>'
alter table public.users add column if not exists "readerTypeAt"  timestamptz;

-- ── Profile + type ──────────────────────────────────────────────────────────
-- Returns everything migration 39 did, plus:
--   type   { genre, noun_en/el, of_en/el, tagline_en/el, icon, flavour } or null
--   source 'books' | 'picks' | null
--   moods  [{ slug, label_en, label_el }] (top 3, only from 3 tagged books up)
-- Volatile because it saves the type on the user (only when it changed).
create or replace function public.get_reader_profile()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_total_books  numeric;
  v_genre_books  int;
  v_tagged_books int;
  v_source       text;
  v_noun         text;
  v_flavour      text;   -- 'tag:<slug>' | 'genre:<slug>'
  v_picks        text[];
  v_base         jsonb;
  v_type         jsonb;
  v_moods        jsonb;
begin
  if v_uid is null then
    return null;
  end if;

  v_base := (
    with rl as (
      select r."bookId", r.status, r."progressPercentage", r."totalReadingTimeSeconds"
      from "readingList" r where r."userId" = v_uid
    ),
    w as (
      select rl."bookId", case rl.status when 'completed' then 3 when 'reading' then 2 else 1 end as wt from rl
    ),
    gw as (
      select g.slug, g.name_en, g.name_el, g.is_fiction,
             sum(w.wt * coalesce(bg.confidence, 1) * case when bg.is_primary then 1.5 else 1 end) as score,
             count(distinct w."bookId") as books
      from w
      join book_genres bg on bg.book_id = w."bookId"
      join genres g on g.id = bg.genre_id
      group by g.slug, g.name_en, g.name_el, g.is_fiction
    ),
    authors as (
      select a.name, count(*) as n
      from rl join books b on b.id = rl."bookId"
      cross join lateral unnest(b.authors) as a(name)
      where coalesce(trim(a.name), '') <> ''
      group by a.name having count(*) >= 2
    )
    select jsonb_build_object(
      'genres', coalesce((
        select jsonb_agg(jsonb_build_object('slug', slug, 'name_en', name_en, 'name_el', name_el, 'is_fiction', is_fiction,
                                           'score', round(score::numeric, 2), 'books', books) order by score desc)
        from (select * from gw order by score desc limit 5) top
      ), '[]'::jsonb),
      'genre_count', (select count(*) from gw),
      'genre_books', (select count(distinct w."bookId") from w join book_genres bg on bg.book_id = w."bookId"),
      'preferred_genres', coalesce((
        select jsonb_agg(jsonb_build_object('slug', g.slug, 'name_en', g.name_en, 'name_el', g.name_el) order by p.ord)
        from users u
        cross join lateral unnest(u."preferredGenres") with ordinality as p(slug, ord)
        join genres g on g.slug = p.slug
        where u.id = v_uid
      ), '[]'::jsonb),
      'finished', (select count(*) from rl where status = 'completed'),
      'reading',  (select count(*) from rl where status = 'reading'),
      'wishlist', (select count(*) from rl where status = 'wishlist'),
      'pages_read', (
        select coalesce(round(sum(
          case when rl.status = 'completed' then b."pageCount"
               when rl.status = 'reading' then b."pageCount" * least(greatest(coalesce(rl."progressPercentage", 0), 0), 100) / 100.0
               else 0 end)), 0)::int
        from rl join books b on b.id = rl."bookId"
      ),
      'seconds_read', greatest(
        (select coalesce(sum(s."durationSeconds"), 0) from "readingSessions" s where s."userId" = v_uid),
        (select coalesce(sum(rl."totalReadingTimeSeconds"), 0) from rl)
      )::bigint,
      'top_author', (select name from authors order by n desc, name limit 1)
    )
  );

  v_genre_books := (v_base->>'genre_books')::int;

  -- Catalog shares for the rarity weighting.
  select sum(book_count) into v_total_books from genre_book_counts;

  if v_genre_books >= 3 then
    v_source := 'books';

    -- Noun: most distinctive genre with ≥ 2 books (else simply the top one).
    with gw as (
      select g.slug,
             sum(case r.status when 'completed' then 3 when 'reading' then 2 else 1 end
                 * coalesce(bg.confidence, 1) * case when bg.is_primary then 1.5 else 1 end) as score,
             count(distinct r."bookId") as books
      from "readingList" r
      join book_genres bg on bg.book_id = r."bookId"
      join genres g on g.id = bg.genre_id
      where r."userId" = v_uid
      group by g.slug
    ),
    ranked as (
      select gw.slug, gw.books,
             gw.score * power(greatest(coalesce(c.book_count, 1000)::numeric / nullif(v_total_books, 0), 0.0001), -0.35) as distinct_score,
             gw.score
      from gw left join genre_book_counts c on c.slug = gw.slug
      where exists (select 1 from reader_archetypes a where a.genre_slug = gw.slug)
    )
    select
      coalesce(
        (select slug from ranked where books >= 2 order by distinct_score desc, score desc limit 1),
        (select slug from ranked order by score desc limit 1)),
      (select 'genre:' || slug from ranked
        where slug is distinct from coalesce(
          (select slug from ranked where books >= 2 order by distinct_score desc, score desc limit 1),
          (select slug from ranked order by score desc limit 1))
        order by distinct_score desc, score desc limit 1)
    into v_noun, v_flavour;

    -- Flavour: strongest distinctive theme, when there are enough tagged books.
    select count(distinct r."bookId") into v_tagged_books
    from "readingList" r join book_tags bt on bt.book_id = r."bookId"
    where r."userId" = v_uid;

    if v_tagged_books >= 3 then
      select coalesce(
        (with tag_totals as (
           select bt.tag_id, count(*)::numeric as n from book_tags bt group by bt.tag_id
         ),
         tw as (
           select t.slug,
                  sum(case r.status when 'completed' then 3 when 'reading' then 2 else 1 end
                      * case when bt.strength = 'clear' then 1 else 0.6 end) as score,
                  count(distinct r."bookId") as books,
                  max(tt.n) as catalog_n
           from "readingList" r
           join book_tags bt on bt.book_id = r."bookId"
           join tags t on t.id = bt.tag_id and t.facet = 'theme'
           join tag_totals tt on tt.tag_id = bt.tag_id
           where r."userId" = v_uid
           group by t.slug
         )
         select 'tag:' || tw.slug
         from tw
         where tw.books >= 2 and exists (select 1 from reader_flavours f where f.tag_slug = tw.slug)
         order by tw.score * power(tw.catalog_n / (select sum(n) from tag_totals), -0.35) desc
         limit 1),
        v_flavour)
      into v_flavour;

      select coalesce(jsonb_agg(jsonb_build_object('slug', slug, 'label_en', label_en, 'label_el', label_el) order by score desc), '[]'::jsonb)
      into v_moods
      from (
        select t.slug, t.label_en, t.label_el,
               sum(case r.status when 'completed' then 3 when 'reading' then 2 else 1 end
                   * case when bt.strength = 'clear' then 1 else 0.6 end) as score
        from "readingList" r
        join book_tags bt on bt.book_id = r."bookId"
        join tags t on t.id = bt.tag_id and t.facet = 'mood'
        where r."userId" = v_uid
        group by t.slug, t.label_en, t.label_el
        having count(distinct r."bookId") >= 2
        order by score desc
        limit 3
      ) m;
    end if;
  else
    -- Too few books: use the onboarding picks.
    select coalesce(u."preferredGenres", '{}') into v_picks from users u where u.id = v_uid;
    v_picks := array(select p from unnest(v_picks) p where exists (select 1 from reader_archetypes a where a.genre_slug = p));
    if array_length(v_picks, 1) >= 1 then
      v_source := 'picks';
      v_noun := v_picks[1];
      v_flavour := case when array_length(v_picks, 1) >= 2 then 'genre:' || v_picks[2] end;
    elsif v_genre_books >= 1 then
      v_source := 'books';
      v_noun := v_base->'genres'->0->>'slug';
    end if;
  end if;

  if v_noun is not null then
    v_flavour := coalesce(v_flavour, 'genre:' || v_noun);
    select jsonb_build_object(
             'genre', a.genre_slug,
             'noun_en', a.noun_en, 'noun_el', a.noun_el,
             'of_en', coalesce(f.of_en, fg.of_en, a.of_en),
             'of_el', coalesce(f.of_el, fg.of_el, a.of_el),
             'tagline_en', a.tagline_en, 'tagline_el', a.tagline_el,
             'icon', a.icon,
             'flavour', v_flavour)
    into v_type
    from reader_archetypes a
    left join reader_flavours  f  on v_flavour = 'tag:'   || f.tag_slug
    left join reader_archetypes fg on v_flavour = 'genre:' || fg.genre_slug
    where a.genre_slug = v_noun;

    update users
       set "readerGenre" = v_noun, "readerFlavour" = v_flavour, "readerTypeAt" = now()
     where id = v_uid
       and ("readerGenre" is distinct from v_noun or "readerFlavour" is distinct from v_flavour);
  end if;

  return v_base || jsonb_build_object(
    'type', v_type,
    'source', v_source,
    'moods', coalesce(v_moods, '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.get_reader_profile() from public, anon;
grant  execute on function public.get_reader_profile() to authenticated;
