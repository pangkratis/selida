-- Onboarding topics (2026-10-04).
--
-- Onboarding shows two kinds of tag: genres (curated taxonomy, migration 06)
-- and subcategories (raw Biblionet subject headings). Subject headings mix
-- genre with qualifiers (place, language, period, education, form), so only
-- headings explicitly approved here are offered as subcategory chips.
--
-- The approved set is deliberately small today: most real topics already
-- map to a genre, and the rest are qualifiers. Add a heading by setting
-- onboarding_visible = true for its name in a later migration.

-- ── 1. Subcategory allowlist ─────────────────────────────────────────

alter table public.subcategories
  add column if not exists onboarding_visible boolean not null default false;

update public.subcategories
set onboarding_visible = true
where name in (
  'Χριστούγεννα',
  'Εθνική Αντίσταση, 1940-1944'
);

-- Subcategories that a genre already covers are skipped: the genre chip
-- already represents them, so showing both would duplicate the same topic.
create or replace function public.get_onboarding_subcategories(p_limit int default 20)
returns table(name text, book_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select s.name, count(bs.book_id)::bigint as book_count
  from subcategories s
  join book_subcategories bs on bs.subcategory_id = s.id
  join books bk on bk.id = bs.book_id
  where s.onboarding_visible
    and bk."isActive" is distinct from false
    and not exists (
      select 1 from genre_mappings gm
      where gm.raw_value = s.name and gm.signal_type = 'subject'
    )
  group by s.id, s.name
  having count(bs.book_id) >= 3
  order by book_count desc
  limit p_limit;
$$;

grant execute on function public.get_onboarding_subcategories(int) to anon, authenticated;

-- ── 2. Genre preference storage ──────────────────────────────────────

alter table public.users
  add column if not exists "preferredGenres" text[] not null default '{}';

-- ── 3. Genre → subject-heading expansion for cold-start recommendations ─
-- Book subcategories are raw subject headings. A chosen genre expands into
-- the headings mapped to it, so the recommender's existing subcategory match
-- can use the genre choice without a separate genre index.

create or replace function public.get_genre_subject_headings(p_slugs text[])
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select distinct gm.raw_value
  from genre_mappings gm
  join genres g on g.id = gm.genre_id
  where g.slug = any(p_slugs)
    and gm.signal_type = 'subject';
$$;

grant execute on function public.get_genre_subject_headings(text[]) to anon, authenticated;
