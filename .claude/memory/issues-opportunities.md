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

### 7. Subcategory sync is only 7.3% complete
- Only **1,378 of 18,753 books** have `syncedSub = true`
- 441 distinct subject headings from 2,586 book↔subject links
- Onboarding chips (`get_popular_subcategories`) are therefore driven by 7% of the catalog
- Finishing the sync via `syncSubcategories()` would convert a large share of the 68% LLM
  fall-through into deterministic genre matches — highest-leverage data task available

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
