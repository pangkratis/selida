# Selida — Issues & Improvement Opportunities

## Active Bugs / Tech Debt

### 0. Hardcoded Biblionet credentials shipped in the app bundle — FIXED (2026-09-19)
- `services/biblionet-api.ts`, `services/catalog-ingestion.ts`, and an inline block in
  `app/catalog-ingestion.tsx` all had the user's real Biblionet username/password hardcoded as
  client-side constants — meaning every app install shipped these in the JS bundle (extractable
  regardless of `__DEV__` guards on the functions that used them, since the top-level `const`
  declarations and the `catalog-ingestion.tsx` route itself are bundled unconditionally).
  Discovered during an app-store-readiness review.
- **Fixed**: added `supabase/functions/biblionet-proxy/` (Edge Function) that holds the
  credential as a server-side secret (`BIBLIONET_USERNAME`/`BIBLIONET_PASSWORD` via
  `supabase secrets set`) and forwards a small allowlist of Biblionet webservice endpoints
  (`search_titles`, `get_title`, `get_month_titles`, `get_title_subject`). All 3 call sites now
  use `supabase.functions.invoke('biblionet-proxy', { body: { endpoint, params } })` instead of
  building the request with the credential directly. Verified working end-to-end via a direct
  curl test against the deployed function (real book data came back from `get_month_titles`).
- **The old password should still be rotated** with whoever administers that Biblionet account —
  it was exposed in git history and local builds regardless of this code fix, which only prevents
  *future* exposure. Not something this fix can resolve on its own; flagged to the user, their
  call to make.
- **Deploy gotcha for next time**: `supabase functions deploy` failed with a confusing
  `WARN: failed to read file... no such file or directory` + `Entrypoint path does not exist`
  error when the `supabase/functions/` folder was created by hand rather than via `supabase init`
  — there was no `supabase/config.toml` for the CLI to anchor its project-root/path resolution
  against. Fix: run `supabase init` (safe — doesn't touch an existing `functions/` folder) before
  the first deploy in a repo that didn't start with the Supabase CLI. Also: this machine has no
  Docker installed, so `supabase functions deploy <name> --use-api` (server-side bundling, no
  Docker needed) is the right flag here, not the Docker-based default.
- **Follow-up 2026-09-19**: git history containing this credential was also scrubbed — the repo
  was reset to a single fresh "Initial commit" (old history kept only in a local backup folder
  OUTSIDE the repo, `../Selida-old-git-history-backup-<date>`, sibling to the project). See
  `project-state.md` → "Git history reset" for the full record if this ever needs to be referenced.

### 0b. RLS self-privilege-escalation on `users.isAdmin` — FIXED (2026-09-19)
- Manually tested (real auth accounts, real cross-user attempts, not just reasoning about it) —
  found that any authenticated user could `PATCH /rest/v1/users?id=eq.<self>` with
  `{"isAdmin": true}` and it would actually be written. No check anywhere stopped it — the `users`
  UPDATE policy allowed full self-editing including that column, and `catalog-ingestion.tsx`'s
  admin gate is purely a client-side `user.isAdmin` check with nothing backing it server-side.
  Practical impact: any signed-in user could grant themselves access to admin screens/features.
- Everything else tested passed: cross-user SELECT/UPDATE/DELETE on `readingList`/`users`/
  `userActivity` all correctly blocked; INSERT impersonating another `userId` explicitly rejected
  by RLS (403). Full test methodology in `project-state.md` → "RLS audit (2026-09-19)".
- **Fixed** via `sql/migration_10_protect_admin_flag.sql` — a `BEFORE UPDATE` trigger on
  `public.users` that resets `isAdmin` to its previous value unless the caller is `service_role`.
  Applied directly to the live DB via `supabase db query --linked -f <file>` and verified: the
  exact escalation that worked before now no-ops (stays `false`), while normal self-edits
  (displayName, language, etc.) still work.

### 0c. Supabase security advisor findings (2026-09-19) — mostly unaddressed, triaged below
Ran `supabase db advisors --linked --type security` (Supabase's own linter) after the manual RLS
audit above — surfaces issues a manual table-by-table test can't see. None of these are fixed yet
except where noted; listed here so they don't get lost.

- **Worth doing, no code risk**: enable "Leaked Password Protection" in Supabase Dashboard →
  Authentication → Policies — currently disabled. Checks new passwords against HaveIBeenPwned.
  Pure dashboard toggle, no migration needed.
- **Worth reviewing — likely real, not yet fixed**: several `SECURITY DEFINER` functions that look
  like they should be INTERNAL-only (triggered automatically by Postgres, never called directly by
  the app) are nonetheless directly callable via `/rest/v1/rpc/<name>` by `anon` AND
  `authenticated`: `fn_activity_sync_views`, `fn_reading_list_sync_stats`, `fn_sync_book_categories`,
  `fn_sync_book_genres`, `fn_sync_book_popularity`, `fn_sync_book_subcategories`,
  `fn_resolve_all_book_genres`, `fn_resolve_book_genres`. If none of these are meant to be called
  directly by client code (check first — grep the app for `.rpc('fn_...')` before touching
  anything), the fix is `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` on each, so they stay
  callable only by their trigger context / service role. Risk if left as-is: since they run as
  `SECURITY DEFINER` (elevated privileges), an outside caller invoking them directly (e.g.
  repeatedly calling a full-catalog resync function) could cause unintended writes or load, even
  without any data leak.
- **Worth reviewing — likely fine, but confirm**: `search_books`, `get_book_recommendations`,
  `get_browsable_genres`, `get_popular_subcategories`, `create_user_profile` are ALSO flagged as
  anon/authenticated-callable `SECURITY DEFINER` functions — but these genuinely ARE meant to be
  called directly by the app (confirmed via `.rpc(...)` call sites in `app/`), so this is expected,
  not a bug. Listed here only so the noisy advisor warning isn't mistaken for 8 problems instead of
  the ~8 legitimate ones above.
- **Worth a closer look — possible integrity issue, not confirmed exploitable**:
  `create_user_profile` is callable by `anon` (fully unauthenticated, not just logged-in users) and
  takes an arbitrary `p_id` with no check that it matches the caller's own auth uid, and does
  `on conflict (id) do nothing`. In theory, an anonymous caller who somehow knew a real user's auth
  UUID could pre-create/squat that profile row before the real user's own post-signup call runs,
  silently no-oping the legitimate one. Practical severity is low (requires knowing another user's
  UUID, which isn't exposed anywhere obvious), but the function should probably assert
  `p_id = auth.uid()` internally and/or not be callable by `anon` at all.
- **Minor, best-practice only**: `fn_books_search_text` and `create_user_profile` have a mutable
  `search_path` (should be pinned via `set search_path = public` like the new
  `protect_admin_flag()` trigger function does) — theoretical search-path-hijack risk for
  `SECURITY DEFINER` functions, low practical severity here. `pg_trgm`/`unaccent` extensions living
  in the `public` schema instead of a dedicated schema — cosmetic/best-practice, not a real
  vulnerability.

### 1. Debug log in bookStats.ts — FIXED (2026-06-25)
- bookStats.ts is now no-op stubs; all stat logic moved to Postgres triggers
- Debug log is gone along with the function bodies

### 2. bookId data integrity (coverUrl stored as ID)
- `services/recommendations.ts` has a workaround that checks if bookId contains '/' or 'http'
  to detect when a coverUrl was accidentally stored as a book ID in readingList
- Root cause likely in `book-details.tsx` where book is first saved — when the book doesn't yet
  have a Supabase-generated ID, the local `book.id` (which may be a coverUrl from Google Books API) gets
  written as the readingList key
- Fix: audit book-details.tsx and ensure bookId is always the Supabase row ID, not coverUrl

### 3. mixHex utility duplicated
- Defined separately in: `app/(tabs)/explore.tsx`, `components/page-header.tsx`, `app/(tabs)/profile.tsx`
- Should be extracted to: `constants/utils.ts` and imported everywhere
- Fix: create shared utility, update all 3 imports

### 4. No user-facing error feedback
- All Supabase errors use `console.error` only
- Users see no toast, alert, or inline message when operations fail
- Fix: add a lightweight toast/snackbar system

### 5. Categories hardcoded in explore.tsx
- `HARDCODED_CATEGORIES` array (9 categories) defined directly in explore.tsx
- Should be centralized in `constants/categories.ts` or fetched from Firestore
- The category strings must match exactly what's stored in book.categories[] in Supabase
- SUPERSEDED by the genre taxonomy (migration_06) — Explore should read `get_browsable_genres()`

### 6. books.categories is ~81% junk (measured 2026-06-29)
- Sampled 5,553 books across the full catalog: **81.1% are "Γενικά βιβλία"** (General Books)
- Next: Πληροφορική & υπολογιστές 8.8%, Φιλοσοφία 4.9%; the other 35 categories share ~5%
- Biblionet's `Category` field is effectively dead data — it cannot drive browsing or recommendations
- This is WHY the genre taxonomy (migration_06) exists; do not build features on books.categories

### 7. Subcategory sync is only 7.3% complete (as of last measurement — throughput improved 2026-09-19)
- Only **1,378 of 18,753 books** have `syncedSub = true`
- 441 distinct subject headings from 2,586 book↔subject links
- Onboarding chips (`get_popular_subcategories`) are therefore driven by 7% of the catalog
- Finishing the sync via `syncSubcategories()` would convert a large share of the 68% LLM
  fall-through into deterministic genre matches — highest-leverage data task available
- **Throughput fix (2026-09-19)**: confirmed via Biblionet's own docs (`https://biblionet.gr/webservice/`)
  that subject data can ONLY be fetched one book per request — no batch endpoint, no reverse
  "books by subject" lookup exists (`get_subject` only returns metadata about one subject, not
  which books have it). Don't re-investigate this without new information — see
  `project-state.md` → "Biblionet API shape, confirmed 2026-09-19". Given that hard constraint,
  `syncSubcategories()` was changed to get more done per day within the account's 1000
  requests/day cap: `SUB_BATCH` raised 100→900 (was only using 10% of the daily quota per run),
  results now ordered by `popularityCount DESC` (spend requests on books people actually look at
  first, not arbitrary DB order), and the loop stops early after 5 consecutive failures instead of
  blindly burning through the rest of the batch once something systemic (most likely the daily
  quota) has been hit — surfaced in the admin UI as "stopped early, likely hit today's rate limit."
- **Along the way, found `get_title` uses the wrong parameter name** (`titleid` instead of
  `title`) in `biblionet-api.ts`'s `getBiblionetBookById()` (dead code) and
  `app/catalog-ingestion.tsx`'s admin "Book Lookup" box — **left unfixed, user confirmed they
  don't use that feature**. Don't fix this without checking with the user first, per that note.

### 8. language stored as Greek words, not ISO codes — BLOCKS Google Books
- Actual values: `ελληνικά` (952), `αγγλικά` (19), `γαλλικά` (7), `ιταλικά` (2), `''` (20)
- Google Books returns ISO 639-1 (`el`, `en`, `fr`)
- `recommendations.ts` applies a **-15 score penalty** on language mismatch, so every Google Books
  result would be permanently penalised against a Greek user's stored preference
- Fix BEFORE adding the second source: normalise to ISO 639-1, keep a display-name lookup

### 9. No cross-source book identity — BLOCKS Google Books
- `books` upserts use `onConflict: 'biblionetId'`; Google Books rows have no `biblionetId`
- Postgres treats NULLs as distinct in unique constraints → duplicates accumulate silently
  rather than conflicting
- Needs a real identity strategy (normalised ISBN-13 as cross-source key + fallback for books
  without one) before any second source is ingested

### 10. Subject headings mix five facet types
- Biblionet `SubjectTitle` values conflate genre, form, audience, place, language, and period:
  `Ελλάς` (place), `Μεταφράσεις στα αγγλικά` (language), `1967-1974` (period),
  `Παιδικά βιβλία` (audience), `Αστυνομική λογοτεχνία` (genre)
- Thema (the international standard) formalises exactly this split as "qualifiers"
- migration_06 deliberately excludes qualifier values from genre mapping — do not "fix" this
- `catalog-ingestion.ts` splits `SubjectTitle` on `' - '`, which destroys hierarchy; some values
  survive unsplit (`Νεοελληνική πεζογραφία - Μυθιστόρημα`), suggesting inconsistent dash chars

---

## Missing / Placeholder Features

### Recent Activity Section (Home screen)
- Currently renders an empty state
- Data already exists: `userActivity` table logs all user actions with context
- Implementation: query userActivity where userId==uid, order by createdAt DESC, limit 10
- Display: HorizontalBookShelf or a simple activity feed

### Book List Pagination
- `books-grid.tsx` fetches up to 140 results and displays all at once
- Should implement offset pagination with Supabase `.range(from, to)`

### Reading Goals
- No reading goals (e.g., "read 20 books this year")
- Could be stored in users table as goalBooksPerYear jsonb field, tracked against stats.booksReadCount

### Offline Support
- Auth token persists via expo-secure-store (user stays logged in)
- All Supabase queries fail without network — no offline cache configured
- No built-in offline persistence in Supabase JS client — would need manual caching layer

### Search UX improvements
- No search history
- No autocomplete / suggestions
- No filtering by language, year within search results
- Search re-queries on every navigation — no caching between visits

---

## UX / Quality of Life Improvements

### Book cover fallback
- No fallback image shown when coverUrl is missing or fails to load
- Should show a placeholder (colored box with first letter of title)

### Empty recommendations onboarding — FIXED (2026-06-25)
- Onboarding now shows subcategory chips from get_popular_subcategories RPC
- Selected chips saved as preferredSubcategories on the users row
- Recommendation engine uses preferredSubcategories as cold-start signal when readingList is empty

### Manual reading progress
- 1 min/page assumption may be inaccurate for different readers
- No way for user to set their actual current page
- Could add a "Set page" input in book-details

### Long book titles in cards
- HorizontalBookShelf truncates title to 1 line
- CompactBookGrid shows no title — could show truncated title below cover

---

## Architecture Improvements

### Centralize Book utilities
- `mapDocToBook` is defined in books-grid.tsx but useful elsewhere
- Should live in a shared `utils/book-utils.ts`

### Type the userActivity actions as union type
- Currently action is a plain string in userActivity.ts
- Should be: `type UserAction = 'view_details' | 'add_to_reading' | 'add_to_wishlist' | 'mark_completed' | 'remove_from_list'`

### Extract large screen components
- profile.tsx (rewritten 2026-09-02 as hero + shelves, see project-state.md) still keeps its
  shelf sub-components (ShelfHeader, ReadingCard, CoverOnlyCard, FinishedRow, empty-state tiles)
  defined locally in the same file rather than extracted — fine at current size, revisit if the
  file keeps growing. The stale "StatsTiles, CategoryCloud, BookTabList" suggestion here no
  longer applies — those don't exist in the current structure.
- Same for home (index.tsx): ContinueReadingSection, RecommendationsSection, etc.
