-- Search across Greek and Latin letters (2026-11-01).
--
-- search_books compared the query letter for letter with title + authors, so
-- "kazantzakis" never found Καζαντζάκης. Now every book also has `search_latin`:
-- title + authors converted to a loose "Greeklish" spelling, and the query goes
-- through the same conversion, so both sides meet in the same letters whichever
-- alphabet the user types in.
--
-- fn_greeklish is deliberately forgiving, because people type Greeklish in many
-- ways: η/ι/υ/ει/οι → i, ω/ο → o, αι → e, ου → u, θ → th (also "8"), χ → h
-- (also "ch"/"kh"), ξ → ks (also "x"), β/μπ/b → v, γκ/gk → g, double letters
-- collapsed. The same rules run on Latin text too, so Latin names still match
-- themselves ("vonnegut" ↔ "Vonnegut"). Small differences that remain are
-- absorbed by trigram word-similarity.

create or replace function public.fn_greeklish(p_text text)
returns text
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  s text := lower(unaccent(coalesce(p_text, '')));
begin
  -- Greek digraphs first (order matters: ντ before τζ, ου before single letters)
  s := replace(s, 'ου', 'u');
  s := replace(s, 'ει', 'i');
  s := replace(s, 'οι', 'i');
  s := replace(s, 'υι', 'i');
  s := replace(s, 'αι', 'e');
  s := replace(s, 'αυ', 'av');
  s := replace(s, 'ευ', 'ev');
  s := replace(s, 'μπ', 'b');
  s := replace(s, 'ντ', 'nt');
  s := replace(s, 'γκ', 'g');
  s := replace(s, 'γγ', 'ng');
  -- Greek letters that become two Latin letters
  s := replace(s, 'θ', 'th');
  s := replace(s, 'ψ', 'ps');
  s := replace(s, 'ξ', 'ks');
  s := replace(s, 'χ', 'h');
  -- The remaining Greek letters, one to one
  s := translate(s, 'αβγδεζηικλμνοπρσςτυφω', 'avgdeziiklmnoprsstifo');

  -- Canonical Latin spelling, applied to everything (Greek-derived or not)
  s := replace(s, '8', 'th');
  s := replace(s, 'ch', 'h');
  s := replace(s, 'kh', 'h');
  s := replace(s, 'ph', 'f');
  s := replace(s, 'x', 'ks');
  s := replace(s, 'mp', 'b');
  s := replace(s, 'b', 'v');
  s := replace(s, 'c', 'k');
  s := replace(s, 'q', 'k');
  s := replace(s, 'w', 'o');
  s := replace(s, 'y', 'i');
  s := replace(s, 'ou', 'u');
  s := replace(s, 'eu', 'ev');
  s := replace(s, 'au', 'av');
  s := replace(s, 'ai', 'e');
  s := replace(s, 'ei', 'i');
  s := replace(s, 'oi', 'i');
  s := replace(s, 'gk', 'g');

  s := regexp_replace(s, '([a-z])\1+', '\1', 'g');   -- double letters
  s := regexp_replace(s, '[^a-z0-9]+', ' ', 'g');     -- anything else → space
  return trim(s);
end;
$$;

-- ── Column, kept up to date by the existing search_text trigger ─────────────
alter table public.books add column if not exists search_latin text;

create or replace function public.fn_books_search_text()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.search_text := lower(
    unaccent(new.title || ' ' || coalesce(array_to_string(new.authors, ' '), ''))
  );
  new.search_latin := fn_greeklish(new.title || ' ' || coalesce(array_to_string(new.authors, ' '), ''));
  return new;
end;
$$;

-- Backfill (run separately, in id batches — see the note at the end):
--   update books set search_latin = fn_greeklish(title || ' ' || coalesce(array_to_string(authors, ' '), ''))
--   where id > '<last>' and id <= '<next>';

create index if not exists books_search_latin_trgm
  on public.books using gin (search_latin gin_trgm_ops);

-- ── Search: Greek/as-typed match OR Greeklish match OR close Greeklish words ─
create or replace function public.search_books(p_query text, p_limit integer default 200)
returns setof books
language sql
stable
security definer
set search_path = public
set pg_trgm.word_similarity_threshold = 0.5
as $$
  with q as (
    select lower(unaccent(coalesce(p_query, ''))) as plain,
           fn_greeklish(p_query)                  as latin
  )
  select b.*
  from books b, q
  where b."isActive" is distinct from false
    and (
      b.search_text ilike '%' || q.plain || '%'
      or (q.latin <> '' and b.search_latin ilike '%' || q.latin || '%')
      -- fuzzy only for queries long enough not to match everything
      or (length(q.latin) >= 4 and q.latin <% b.search_latin)
    )
  order by
    greatest(similarity(b.search_text, q.plain), word_similarity(q.latin, b.search_latin)) desc,
    coalesce(b."popularityCount", 0) desc
  limit least(greatest(coalesce(p_limit, 200), 1), 200);
$$;
