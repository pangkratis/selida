-- Clients read genre counts only through get_browsable_genres() (SECURITY
-- DEFINER), so the materialized view doesn't need a direct API grant.
-- Materialized views can't use RLS, so access is controlled by grants alone.
revoke select on public.genre_book_counts from anon, authenticated;
