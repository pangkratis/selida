-- =============================================================================
-- Migration 06: Canonical genre taxonomy
-- =============================================================================
-- Introduces a source-independent genre layer so that Biblionet (Greek) and
-- Google Books (international) books land in the same 25 browsable buckets.
--
-- Why this exists:
--   books.categories comes from Biblionet's `Category` field, which is ~81%
--   "Γενικά βιβλία" — effectively no signal. books.subcategories carries the
--   real genre signal but mixes five different facet types (genre, form,
--   audience, place, period) and is only ~7% synced.
--
-- Design:
--   genres          — the 25 canonical buckets (slug + el/en labels)
--   book_genres     — resolved genre per book, with confidence + method
--   genre_mappings  — curated raw_value → genre rules, per source
--
-- books.categories / books.subcategories are KEPT untouched as provenance.
-- They are the input to classification, never deleted, so the taxonomy can be
-- recomputed without re-fetching from the APIs.
--
-- Run AFTER migration_05_fix_trigger_security.sql.
-- =============================================================================

-- ── genres ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.genres (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text UNIQUE NOT NULL,
  name_en      text NOT NULL,
  name_el      text NOT NULL,
  -- NULL = audience bucket that spans both (children's, young adult)
  is_fiction   boolean,
  -- false = in the catalog but never shown as a browse tile (reference material)
  is_browsable boolean NOT NULL DEFAULT true,
  sort_order   int  NOT NULL DEFAULT 0,
  "createdAt"  timestamptz DEFAULT now()
);

-- ── book_genres ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.book_genres (
  book_id    text NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  genre_id   uuid NOT NULL REFERENCES public.genres(id) ON DELETE CASCADE,
  confidence real NOT NULL DEFAULT 1.0,
  -- 'mapping' = genre_mappings rule, 'llm' = batch classification, 'manual' = hand-set
  method     text NOT NULL DEFAULT 'mapping',
  is_primary boolean NOT NULL DEFAULT false,
  PRIMARY KEY (book_id, genre_id)
);

CREATE INDEX IF NOT EXISTS book_genres_genre_id ON public.book_genres(genre_id);
CREATE INDEX IF NOT EXISTS book_genres_book_id  ON public.book_genres(book_id);
CREATE INDEX IF NOT EXISTS book_genres_primary  ON public.book_genres(genre_id) WHERE is_primary;

-- ── genre_mappings ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.genre_mappings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source      text NOT NULL,        -- 'biblionet' | 'google_books'
  signal_type text NOT NULL,        -- 'category' | 'subject' | 'bisac'
  raw_value   text NOT NULL,
  genre_id    uuid NOT NULL REFERENCES public.genres(id) ON DELETE CASCADE,
  weight      real NOT NULL DEFAULT 1.0,
  UNIQUE (source, signal_type, raw_value, genre_id)
);

CREATE INDEX IF NOT EXISTS genre_mappings_lookup
  ON public.genre_mappings(source, signal_type, raw_value);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.genres         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.book_genres    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.genre_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "genres_public_read"         ON public.genres;
DROP POLICY IF EXISTS "book_genres_public_read"    ON public.book_genres;
DROP POLICY IF EXISTS "genre_mappings_public_read" ON public.genre_mappings;

CREATE POLICY "genres_public_read"         ON public.genres         FOR SELECT USING (true);
CREATE POLICY "book_genres_public_read"    ON public.book_genres    FOR SELECT USING (true);
CREATE POLICY "genre_mappings_public_read" ON public.genre_mappings FOR SELECT USING (true);

-- =============================================================================
-- Seed: the 25 canonical genres
-- =============================================================================

INSERT INTO genres (slug, name_en, name_el, is_fiction, is_browsable, sort_order) VALUES
  -- Fiction
  ('literature',           'Literature',              'Λογοτεχνία',                 true,  true,  10),
  ('crime-thriller',       'Crime & Thriller',        'Αστυνομικά & Θρίλερ',        true,  true,  20),
  ('science-fiction',      'Science Fiction',         'Επιστημονική Φαντασία',      true,  true,  30),
  ('fantasy',              'Fantasy',                 'Φαντασίας',                  true,  true,  40),
  ('horror',               'Horror',                  'Τρόμου',                     true,  true,  50),
  ('romance',              'Romance',                 'Αισθηματικά',                true,  true,  60),
  ('historical-fiction',   'Historical Fiction',      'Ιστορικό Μυθιστόρημα',       true,  true,  70),
  ('poetry',               'Poetry',                  'Ποίηση',                     true,  true,  80),
  ('drama',                'Drama & Theatre',         'Θέατρο',                     true,  true,  90),
  ('comics',               'Comics & Graphic Novels', 'Κόμικς',                     true,  true, 100),
  -- Young readers (audience buckets — span fiction and non-fiction)
  ('childrens',            'Children''s',             'Παιδικά',                    NULL,  true, 110),
  ('young-adult',          'Young Adult',             'Εφηβικά',                    NULL,  true, 120),
  -- Non-fiction
  ('biography-memoir',     'Biography & Memoir',      'Βιογραφίες & Μαρτυρίες',     false, true, 130),
  ('history',              'History',                 'Ιστορία',                    false, true, 140),
  ('philosophy',           'Philosophy',              'Φιλοσοφία',                  false, true, 150),
  ('psychology-self-help', 'Psychology & Self-Help',  'Ψυχολογία & Αυτοβελτίωση',   false, true, 160),
  ('religion-spirituality','Religion & Spirituality', 'Θρησκεία & Πνευματικότητα',  false, true, 170),
  ('science-nature',       'Science & Nature',        'Επιστήμες & Φύση',           false, true, 180),
  ('technology',           'Technology & Computing',  'Τεχνολογία & Πληροφορική',   false, true, 190),
  ('business-economics',   'Business & Economics',    'Επιχειρήσεις & Οικονομία',   false, true, 200),
  ('politics-society',     'Politics & Society',      'Πολιτική & Κοινωνία',        false, true, 210),
  ('health-wellbeing',     'Health & Wellbeing',      'Υγεία & Ευεξία',             false, true, 220),
  ('art-culture',          'Art & Culture',           'Τέχνες & Πολιτισμός',        false, true, 230),
  ('food-travel',          'Food & Travel',           'Γαστρονομία & Ταξίδια',      false, true, 240),
  ('sports',               'Sports',                  'Αθλητισμός',                 false, true, 250)
ON CONFLICT (slug) DO UPDATE
  SET name_en = EXCLUDED.name_en,
      name_el = EXCLUDED.name_el,
      is_fiction = EXCLUDED.is_fiction,
      is_browsable = EXCLUDED.is_browsable,
      sort_order = EXCLUDED.sort_order;

-- =============================================================================
-- Seed: Biblionet `Category` → genre  (all 38 real values)
-- =============================================================================
-- "Γενικά βιβλία" is deliberately absent — it is 81% of the catalog and carries
-- no signal. Those books fall through to LLM classification (method='llm').
--
-- Also deliberately absent (reference material, no browse tile):
--   Εκπαιδευτικά βοηθήματα, Εγκυκλοπαίδειες & λεξικά, Γλώσσα, Εκπαίδευση

INSERT INTO genre_mappings (source, signal_type, raw_value, genre_id, weight)
SELECT 'biblionet', 'category', v.raw, g.id, v.w
FROM (VALUES
  ('Επιχειρήσεις',                              'business-economics',    1.0),
  ('Οικονομία',                                 'business-economics',    1.0),
  ('Φιλοσοφία',                                 'philosophy',            1.0),
  ('Μουσική',                                   'art-culture',           1.0),
  ('Κινηματογράφος & τηλεόραση',                'art-culture',           1.0),
  ('Ζωγραφική',                                 'art-culture',           1.0),
  ('Χορός',                                     'art-culture',           1.0),
  ('Αρχιτεκτονική & πολεοδομία',                'art-culture',           1.0),
  ('Λαογραφία',                                 'art-culture',           0.8),
  ('Εφαρμοσμένες τέχνες - διακόσμηση - Κόμικς', 'art-culture',           0.8),
  ('Εφαρμοσμένες τέχνες - διακόσμηση - Κόμικς', 'comics',                0.6),
  ('Εφαρμοσμένες επιστήμες',                    'technology',            0.8),
  ('Πληροφορική & υπολογιστές',                 'technology',            1.0),
  ('Φυσικές Επιστήμες',                         'science-nature',        1.0),
  ('Ιατρική & υγεία',                           'health-wellbeing',      1.0),
  ('Αθλητισμός & σπορ',                         'sports',                1.0),
  ('Θρησκεία',                                  'religion-spirituality', 1.0),
  ('Αποκρυφισμός',                              'religion-spirituality', 0.8),
  ('Βιογραφίες - μαρτυρία',                     'biography-memoir',      1.0),
  ('Ιστορία',                                   'history',               1.0),
  ('Ψυχολογία',                                 'psychology-self-help',  1.0),
  ('Κοινωνικές επιστήμες',                      'politics-society',      1.0),
  ('Πολιτικές επιστήμες',                       'politics-society',      1.0),
  ('Δίκαιο',                                    'politics-society',      0.8),
  ('Ευρωπαϊκή Ένωση',                           'politics-society',      0.8),
  ('Επικοινωνία',                               'politics-society',      0.7),
  ('Ελληνική λογοτεχνία',                       'literature',            1.0),
  ('Ξένη λογοτεχνία',                           'literature',            1.0),
  ('Λογοτεχνία',                                'literature',            1.0),
  ('Αρχαία γραμματεία',                         'literature',            0.9),
  ('Θέατρο',                                    'drama',                 1.0),
  ('Παιδικά βιβλία',                            'childrens',             1.0),
  ('Γεωγραφία - ταξίδια',                       'food-travel',           1.0),
  ('Γαστρονομία',                               'food-travel',           1.0)
) AS v(raw, slug, w)
JOIN genres g ON g.slug = v.slug
ON CONFLICT (source, signal_type, raw_value, genre_id) DO UPDATE SET weight = EXCLUDED.weight;

-- =============================================================================
-- Seed: Biblionet subject headings → genre
-- =============================================================================
-- Curated from the top ~170 subject headings by book frequency (top 200 cover
-- ~90% of all book↔subject links).
--
-- Pure Thema-style QUALIFIERS are deliberately excluded — they are facets, not
-- genres, and mapping them would add noise:
--   Place      → Ελλάς, Μεσσηνία, Θεσσαλονίκη, Ισραήλ, Μέση Ανατολή, Βοιωτία
--   Language   → Μεταφράσεις στα αγγλικά / ιταλικά / γαλλικά
--   Period     → 1940-, 1967-1974
--   Education  → Σπουδή και διδασκαλία, Παιδαγωγική, Εκπαίδευση, Πανεπιστήμια
--   Form/misc  → Συλλογές, Συνεντεύξεις, Θεωρία, Έρευνα, Βιβλία, Δώρα

INSERT INTO genre_mappings (source, signal_type, raw_value, genre_id, weight)
SELECT 'biblionet', 'subject', v.raw, g.id, v.w
FROM (VALUES
  -- Literature (prose, national literatures, essay forms)
  ('Νεοελληνική πεζογραφία',                     'literature',            1.0),
  ('Νεοελληνική πεζογραφία - Μυθιστόρημα',       'literature',            1.0),
  ('Νεοελληνική λογοτεχνία',                     'literature',            1.0),
  ('Μυθιστόρημα',                                'literature',            0.9),
  ('Νουβέλα',                                    'literature',            0.9),
  ('Διήγημα',                                    'literature',            0.9),
  ('Αφήγημα',                                    'literature',            0.9),
  ('Λογοτεχνία',                                 'literature',            1.0),
  ('Αμερικανική πεζογραφία',                     'literature',            1.0),
  ('Αμερικανική λογοτεχνία',                     'literature',            1.0),
  ('Αγγλική πεζογραφία',                         'literature',            1.0),
  ('Αγγλική λογοτεχνία',                         'literature',            1.0),
  ('Γαλλική πεζογραφία',                         'literature',            1.0),
  ('Γαλλόφωνη πεζογραφία',                       'literature',            1.0),
  ('Γερμανική πεζογραφία',                       'literature',            1.0),
  ('Γερμανική λογοτεχνία',                       'literature',            1.0),
  ('Ιταλική πεζογραφία',                         'literature',            1.0),
  ('Ρωσική πεζογραφία',                          'literature',            1.0),
  ('Ισπανική πεζογραφία',                        'literature',            1.0),
  ('Ισπανόφωνη πεζογραφία (Μεξικό)',             'literature',            1.0),
  ('Πολωνική πεζογραφία',                        'literature',            1.0),
  ('Σερβική πεζογραφία',                         'literature',            1.0),
  ('Κορεατική πεζογραφία',                       'literature',            1.0),
  ('Ιρλανδική πεζογραφία',                       'literature',            1.0),
  ('Κυπριακή πεζογραφία',                        'literature',            1.0),
  ('Ιαπωνική λογοτεχνία',                        'literature',            1.0),
  ('Αλγερινή λογοτεχνία',                        'literature',            1.0),
  ('Ελληνική γραμματεία, Αρχαία',                'literature',            0.9),
  ('Λόγοι, δοκίμια, διαλέξεις',                  'literature',            0.7),
  ('Νεοελληνικό δοκίμιο',                        'literature',            0.7),
  ('Ελληνικά δοκίμια',                           'literature',            0.7),
  ('Γαλλικό δοκίμιο',                            'literature',            0.7),
  ('Αμερικανικό δοκίμιο',                        'literature',            0.7),
  ('Δοκίμια',                                    'literature',            0.7),
  ('Ερμηνεία και κριτική',                       'literature',            0.6),
  -- Poetry
  ('Νεοελληνική ποίηση',                         'poetry',                1.0),
  ('Κυπριακή ποίηση',                            'poetry',                1.0),
  ('Αμερικανική ποίηση',                         'poetry',                1.0),
  ('Ιταλική ποίηση',                             'poetry',                1.0),
  ('Ποίηση',                                     'poetry',                1.0),
  ('Χαϊκού',                                     'poetry',                1.0),
  -- Genre fiction
  ('Αστυνομική λογοτεχνία',                      'crime-thriller',        1.0),
  ('Επιστημονική φαντασία',                      'science-fiction',       1.0),
  ('Φανταστική λογοτεχνία',                      'fantasy',               1.0),
  ('Λογοτεχνία τρόμου',                          'horror',                1.0),
  ('Ερωτική λογοτεχνία',                         'romance',               0.9),
  ('Ιστορικό μυθιστόρημα',                       'historical-fiction',    1.0),
  -- Drama
  ('Νεοελληνικά θεατρικά έργα',                  'drama',                 1.0),
  ('Θέατρο',                                     'drama',                 1.0),
  -- Comics
  ('Κόμικς',                                     'comics',                1.0),
  -- Children's / YA
  ('Παιδικά βιβλία, Ελληνικά',                   'childrens',             1.0),
  ('Παιδικά βιβλία, Μεταφρασμένα',               'childrens',             1.0),
  ('Βιβλία για παιδιά',                          'childrens',             1.0),
  ('Παραμύθια',                                  'childrens',             0.9),
  ('Παραμύθια, Ελληνικά',                        'childrens',             0.9),
  ('Παιδικές δραστηριότητες',                    'childrens',             1.0),
  ('Παιδικές δραστηριότητες (Προσχολική αγωγή)', 'childrens',             1.0),
  ('Ζωγραφική για παιδιά',                       'childrens',             0.9),
  ('Παιδική ποίηση, Ελληνική',                   'childrens',             0.8),
  ('Παιδική ποίηση, Ελληνική',                   'poetry',                0.6),
  ('Παιδική και εφηβική λογοτεχνία, Ελληνική',   'childrens',             0.7),
  ('Παιδική και εφηβική λογοτεχνία, Ελληνική',   'young-adult',           0.7),
  ('Παιδική και εφηβική λογοτεχνία, Μεταφρασμένη','childrens',            0.7),
  ('Παιδική και εφηβική λογοτεχνία, Μεταφρασμένη','young-adult',          0.7),
  -- Biography & memoir
  ('Βιογραφίες',                                 'biography-memoir',      1.0),
  ('Μαρτυρίες',                                  'biography-memoir',      1.0),
  ('Προσωπικές αφηγήσεις',                       'biography-memoir',      1.0),
  ('Προσωπικές αφηγήσεις - Μαρτυρίες',           'biography-memoir',      1.0),
  ('Ημερολόγια',                                 'biography-memoir',      0.6),
  ('Λογοτέχνες',                                 'biography-memoir',      0.6),
  -- History
  ('Ιστορία',                                    'history',               1.0),
  ('Παγκόσμια ιστορία',                          'history',               1.0),
  ('Ιστορία, Στρατιωτική',                       'history',               1.0),
  ('Εμφύλιος πόλεμος, 1944-1949',                'history',               1.0),
  ('Επανάσταση του 1821',                        'history',               1.0),
  ('Παγκόσμιος πόλεμος, 1939-1945',              'history',               1.0),
  ('Μικρασιατική καταστροφή',                    'history',               1.0),
  ('Μυθολογία, Ελληνική',                        'history',               0.7),
  ('Μυθολογία',                                  'history',               0.7),
  ('Μύθοι',                                      'history',               0.6),
  ('Πόλεμος',                                    'history',               0.6),
  -- Philosophy
  ('Φιλοσοφία',                                  'philosophy',            1.0),
  ('Φιλοσοφία, Σύγχρονη',                        'philosophy',            1.0),
  ('Φιλοσοφία, Γαλλική',                         'philosophy',            1.0),
  ('Φιλοσοφία, Ανατολική',                       'philosophy',            1.0),
  ('Στωϊκή φιλοσοφία',                           'philosophy',            1.0),
  ('Φιλοσοφική ανθρωπολογία',                    'philosophy',            0.9),
  ('Μεταφυσική',                                 'philosophy',            0.8),
  ('Φιλοσοφία και θρησκεία',                     'philosophy',            0.8),
  ('Φιλοσοφία και θρησκεία',                     'religion-spirituality', 0.8),
  -- Psychology & self-help
  ('Ψυχολογία',                                  'psychology-self-help',  1.0),
  ('Ψυχανάλυση',                                 'psychology-self-help',  1.0),
  ('Ψυχιατρική',                                 'psychology-self-help',  0.8),
  ('Συμβουλευτική',                              'psychology-self-help',  1.0),
  ('Γονείς και παιδιά',                          'psychology-self-help',  0.8),
  ('Συναισθήματα',                               'psychology-self-help',  0.8),
  ('Επιτυχία και προσωπικότητα',                 'psychology-self-help',  1.0),
  ('Πνευματικές λειτουργίες και νοημοσύνη',      'psychology-self-help',  0.8),
  ('Σεξουαλική συμπεριφορά',                     'psychology-self-help',  0.7),
  -- Religion & spirituality
  ('Θρησκεία',                                   'religion-spirituality', 1.0),
  ('Θεολογία',                                   'religion-spirituality', 1.0),
  ('Θεός',                                       'religion-spirituality', 1.0),
  ('Ζεν βουδισμός',                              'religion-spirituality', 1.0),
  ('Διαλογισμός',                                'religion-spirituality', 0.7),
  ('Διαλογισμός',                                'health-wellbeing',      0.6),
  ('Μαγεία',                                     'religion-spirituality', 0.6),
  ('Παραφυσικά φαινόμενα',                       'religion-spirituality', 0.6),
  ('Θαύματα',                                    'religion-spirituality', 0.8),
  ('Εξομολόγηση',                                'religion-spirituality', 0.7),
  ('Θρησκεία - Ιστορία',                         'religion-spirituality', 0.8),
  ('Θρησκεία και επιστήμη',                      'religion-spirituality', 0.7),
  ('Θρησκεία και επιστήμη',                      'science-nature',        0.6),
  -- Science & nature
  ('Επιστήμη',                                   'science-nature',        1.0),
  ('Φυσικές και θετικές επιστήμες',              'science-nature',        1.0),
  ('Μαθηματικά',                                 'science-nature',        1.0),
  ('Αστροφυσική',                                'science-nature',        1.0),
  ('Νευροεπιστήμες',                             'science-nature',        1.0),
  ('Περιβάλλον',                                 'science-nature',        1.0),
  ('Φυτά',                                       'science-nature',        0.8),
  ('Ψάρια',                                      'science-nature',        0.8),
  ('Ποταμοί',                                    'science-nature',        0.6),
  ('Επιστήμονες',                                'science-nature',        0.7),
  ('Φυσικοί',                                    'science-nature',        0.7),
  -- Technology & computing
  ('Τεχνολογία',                                 'technology',            1.0),
  ('Τεχνητή νοημοσύνη',                          'technology',            1.0),
  ('Ηλεκτρονικοί υπολογιστές',                   'technology',            1.0),
  ('Ηλεκτρονική',                                'technology',            1.0),
  ('Ηλεκτρολογία',                               'technology',            1.0),
  ('Μηχανολογία',                                'technology',            1.0),
  ('Εκπαιδευτική τεχνολογία',                    'technology',            0.7),
  -- Business & economics
  ('Λογιστική',                                  'business-economics',    1.0),
  ('Φορολογία',                                  'business-economics',    1.0),
  ('Διοίκηση και οργάνωση',                      'business-economics',    1.0),
  ('Ηγεσία',                                     'business-economics',    1.0),
  ('Στρατηγική',                                 'business-economics',    0.5),
  -- Politics & society
  ('Πολιτική',                                   'politics-society',      1.0),
  ('Πολιτικές επιστήμες',                        'politics-society',      1.0),
  ('Κοινωνικές επιστήμες',                       'politics-society',      1.0),
  ('Κοινωνιολογία',                              'politics-society',      1.0),
  ('Κοινωνιολογία. Ανθρωπολογία',                'politics-society',      1.0),
  ('Κοινωνικές απόψεις',                         'politics-society',      0.8),
  ('Διεθνείς σχέσεις',                           'politics-society',      1.0),
  ('Γεωπολιτική',                                'politics-society',      1.0),
  ('Διπλωματία',                                 'politics-society',      1.0),
  ('Δίκαιο',                                     'politics-society',      0.8),
  ('Συνταγματικό δίκαιο',                        'politics-society',      0.8),
  ('Δημοσιογραφία',                              'politics-society',      0.8),
  ('Πρόσφυγες',                                  'politics-society',      0.8),
  ('Γυναίκα',                                    'politics-society',      0.6),
  ('Φύλο',                                       'politics-society',      0.7),
  ('Ειρήνη',                                     'politics-society',      0.7),
  ('Διαζύγιο',                                   'politics-society',      0.6),
  -- Health & wellbeing
  ('Υγεία',                                      'health-wellbeing',      1.0),
  ('Ιατρική',                                    'health-wellbeing',      1.0),
  ('Νοσηλευτική',                                'health-wellbeing',      1.0),
  -- Art & culture
  ('Τέχνη',                                      'art-culture',           1.0),
  ('Ζωγραφική',                                  'art-culture',           1.0),
  ('Ζωγράφοι',                                   'art-culture',           0.8),
  ('Μουσική',                                    'art-culture',           1.0),
  ('Χορός',                                      'art-culture',           1.0),
  ('Φωτογραφία',                                 'art-culture',           1.0),
  ('Φωτογραφικά λευκώματα',                      'art-culture',           0.8),
  ('Μουσεία',                                    'art-culture',           0.8),
  ('Λαογραφία',                                  'art-culture',           0.8),
  ('Λαογραφία, Ελληνική',                        'art-culture',           0.8),
  -- Food & travel
  ('Μαγειρική',                                  'food-travel',           1.0),
  ('Ταξίδια και περιηγήσεις',                    'food-travel',           1.0),
  ('Ταξιδιωτική λογοτεχνία',                     'food-travel',           0.8),
  -- Sports
  ('Αθλητισμός',                                 'sports',                1.0),
  ('Ποδόσφαιρο',                                 'sports',                1.0),
  ('Προπόνηση (αθλητισμός)',                     'sports',                1.0),
  ('Πολεμικές τέχνες',                           'sports',                0.9)
) AS v(raw, slug, w)
JOIN genres g ON g.slug = v.slug
ON CONFLICT (source, signal_type, raw_value, genre_id) DO UPDATE SET weight = EXCLUDED.weight;

-- =============================================================================
-- fn_resolve_book_genres — apply genre_mappings to one book
-- =============================================================================
-- Aggregates every matching category + subject signal into per-genre weights,
-- writes the result to book_genres, and flags the highest-scoring genre primary.
-- Only touches rows with method='mapping' so LLM/manual assignments survive.

CREATE OR REPLACE FUNCTION fn_resolve_book_genres(p_book_id text)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count int;
BEGIN
  DELETE FROM book_genres WHERE book_id = p_book_id AND method = 'mapping';

  WITH signals AS (
    SELECT 'category' AS signal_type, UNNEST(b.categories)    AS raw_value, b.source
    FROM books b WHERE b.id = p_book_id
    UNION ALL
    SELECT 'subject'  AS signal_type, UNNEST(b.subcategories) AS raw_value, b.source
    FROM books b WHERE b.id = p_book_id
  ),
  scored AS (
    SELECT m.genre_id, LEAST(1.0, SUM(m.weight))::real AS confidence
    FROM signals s
    JOIN genre_mappings m
      ON m.source      = COALESCE(s.source, 'biblionet')
     AND m.signal_type = s.signal_type
     AND m.raw_value   = s.raw_value
    GROUP BY m.genre_id
  ),
  ranked AS (
    SELECT genre_id, confidence,
           ROW_NUMBER() OVER (ORDER BY confidence DESC, genre_id) = 1 AS is_primary
    FROM scored
  )
  INSERT INTO book_genres (book_id, genre_id, confidence, method, is_primary)
  SELECT p_book_id, genre_id, confidence, 'mapping', is_primary
  FROM ranked
  ON CONFLICT (book_id, genre_id) DO UPDATE
    SET confidence = EXCLUDED.confidence,
        is_primary = EXCLUDED.is_primary,
        method     = 'mapping';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ── Backfill helper: resolve genres for every book (run once after seeding) ───
-- Batched so it can be re-run safely and won't lock the table for minutes.

CREATE OR REPLACE FUNCTION fn_resolve_all_book_genres(p_limit int DEFAULT 5000)
RETURNS TABLE (books_processed int, genres_assigned int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r RECORD;
  v_books int := 0;
  v_genres int := 0;
BEGIN
  FOR r IN
    SELECT b.id FROM books b
    WHERE NOT EXISTS (SELECT 1 FROM book_genres bg WHERE bg.book_id = b.id)
    LIMIT p_limit
  LOOP
    v_genres := v_genres + fn_resolve_book_genres(r.id);
    v_books  := v_books + 1;
  END LOOP;
  RETURN QUERY SELECT v_books, v_genres;
END;
$$;

-- ── Trigger: keep genres current as books are upserted ───────────────────────

CREATE OR REPLACE FUNCTION fn_sync_book_genres()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM fn_resolve_book_genres(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_book_genres ON books;
CREATE TRIGGER trg_sync_book_genres
AFTER INSERT OR UPDATE OF categories, subcategories ON books
FOR EACH ROW EXECUTE FUNCTION fn_sync_book_genres();

-- =============================================================================
-- get_browsable_genres RPC — drives the Explore grid and onboarding chips
-- =============================================================================
-- Replaces get_popular_subcategories for onboarding. Returns only genres that
-- actually have books, so no empty tiles.

DROP FUNCTION IF EXISTS get_browsable_genres(int);

CREATE OR REPLACE FUNCTION get_browsable_genres(p_min_books int DEFAULT 1)
RETURNS TABLE (
  slug text, name_en text, name_el text,
  is_fiction boolean, sort_order int,
  book_count bigint, total_popularity bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    g.slug, g.name_en, g.name_el, g.is_fiction, g.sort_order,
    COUNT(bg.book_id)::bigint                      AS book_count,
    COALESCE(SUM(bk."popularityCount"), 0)::bigint AS total_popularity
  FROM genres g
  JOIN book_genres bg ON bg.genre_id = g.id
  JOIN books bk       ON bk.id = bg.book_id
  WHERE g.is_browsable
    AND bk."isActive" IS DISTINCT FROM false
  GROUP BY g.id, g.slug, g.name_en, g.name_el, g.is_fiction, g.sort_order
  HAVING COUNT(bg.book_id) >= p_min_books
  ORDER BY g.sort_order;
$$;

GRANT EXECUTE ON FUNCTION get_browsable_genres(int) TO authenticated, anon;

-- =============================================================================
-- After running this file:
--
--   1. Run migration_07_fix_backfill.sql, then backfill in a single pass:
--        SELECT * FROM fn_resolve_all_book_genres();
--
--      (The batched loop originally shipped here was non-terminating — books
--       matching no rule never get a row, so they were re-selected forever.
--       migration_07 replaces it with one set-based query.)
--
--   2. Check coverage:
--        SELECT COUNT(DISTINCT book_id) FROM book_genres;      -- classified
--        SELECT COUNT(*) FROM books;                            -- total
--
--   3. Review the result per genre:
--        SELECT * FROM get_browsable_genres();
--
-- Measured against the live catalog (5,600-book sample, 2026-06-29):
--   24.0% match via Biblionet Category
--    9.4% match via subject heading
--   31.9% match by at least one rule   <-- expected mapping-layer coverage
--   68.1% fall through to LLM classification (method='llm')
--
-- Every genre except 'romance' receives books from these rules. Romance has no
-- firing rule because Biblionet has no romance subject heading in the synced
-- 7% — it will be populated by LLM classification and by Google Books.
--
-- The 68% fall-through is almost entirely books whose Category is
-- "Γενικά βιβλία" (81% of the catalog) and whose subject headings are not yet
-- synced. Finishing the subcategory sync will convert a large share of these
-- into deterministic matches before any LLM pass is needed.
-- =============================================================================
