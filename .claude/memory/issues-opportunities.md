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

### 0c. Supabase security advisor findings (2026-09-19) — FIXED except one dashboard toggle
Ran `supabase db advisors --linked --type security` (Supabase's own linter) after the manual RLS
audit above — surfaces issues a manual table-by-table test can't see. Deferred initially, fixed
same day in a follow-up pass via `sql/migration_14_lock_down_internal_functions.sql`.

- **FIXED**: 8 `SECURITY DEFINER` functions that were INTERNAL-only (triggered automatically by
  Postgres, confirmed via grep — zero client-side `.rpc(...)` calls anywhere in the app) were
  nonetheless directly callable via `/rest/v1/rpc/<name>` by both `anon` and `authenticated`:
  `fn_activity_sync_views`, `fn_reading_list_sync_stats`, `fn_sync_book_categories`,
  `fn_sync_book_genres`, `fn_sync_book_popularity`, `fn_sync_book_subcategories`,
  `fn_resolve_all_book_genres`, `fn_resolve_book_genres`. `REVOKE EXECUTE` applied to all 8.
  **Verified all three affected triggers still fire correctly after the revoke** (revoking direct
  RPC access doesn't affect a function's own trigger-context execution) — tested live: updating a
  book's title still regenerates `search_text`, inserting `userActivity` still increments
  `bookStats.views`, inserting into `readingList` still increments `bookStats.wishlist`.
- **Confirmed fine, not a bug**: `search_books`, `get_book_recommendations`,
  `get_browsable_genres`, `get_popular_subcategories` are also anon/authenticated-callable
  `SECURITY DEFINER` functions, but genuinely ARE meant to be called directly by the app — left
  untouched.
- **FIXED**: `create_user_profile` accepted an arbitrary `p_id` from even anonymous callers with
  no ownership check (`on conflict (id) do nothing` meant an anon caller who knew a real user's
  UUID could have pre-squatted that profile row). Rebuilt the function (fetched the REAL live body
  via `pg_get_functiondef` first — the static `schema.sql` was stale, still referencing a `stats`
  column already dropped from the live table) to `raise exception` unless
  `p_id = auth.uid()`, and revoked `anon` execute entirely (kept for `authenticated` — confirmed
  the real signup flow in `app/(auth)/signup.tsx` already has a session by the time it calls this,
  since email confirmation is disabled and `signUp()` returns a session immediately).
  **Verified live**: real signup + own-profile creation still works; anon calls and
  authenticated-as-someone-else calls both correctly rejected.
- **FIXED**: pinned `search_path = public` on `create_user_profile` and `fn_books_search_text`
  (previously mutable — a theoretical search-path-hijack vector for `SECURITY DEFINER` functions).
- **Deferred by user 2026-09-19 — requires a Supabase Pro plan upgrade**: "Leaked Password
  Protection" toggle (Authentication → Policies) turned out to be plan-gated, not just a free
  dashboard toggle — user will revisit later, this is a cost/plan decision, not a code task.
  Confirmed via `supabase config pull` that this setting isn't represented in the CLI's
  `config.toml` schema at all (a full pull of real remote auth/db/storage config came back with no
  trace of it), so it couldn't have been scripted from here even without the plan gate. That same
  `config pull` was otherwise useful independent of this: it turned up that `supabase/config.toml`
  was still `supabase init`'s generic template (localhost `site_url`, MFA disabled, default pooler
  sizes) rather than the project's real settings — now synced, which matters because
  `supabase config push` writes the WHOLE file; pushing the stale template would have silently
  reset real settings back to generic defaults. Don't run `config push` without pulling first if
  this file is ever touched again.
- **Not pursued, cosmetic**: `pg_trgm`/`unaccent` extensions living in the `public` schema instead
  of a dedicated schema — best-practice only, not a real vulnerability, and moving extension
  schemas is a riskier change for marginal benefit.

### 0d. No error tracking or crash recovery at all — FIXED (2026-09-21)
- Pre-launch observability review found: **zero ErrorBoundary anywhere in the app**, 94
  `console.*` calls and 61 `catch` blocks, none of which go anywhere retrievable in a release
  build. One bad render (malformed book field, undefined coverUrl) would white-screen the whole
  app with no recovery path and no report.
- **Decision (user's, 2026-09-21): self-hosted, NOT Sentry.** `docs/privacy.html` explicitly
  promised "No analytics SDKs, no advertising networks, no crash-reporting trackers" — adding a
  third-party reporter would have meant rewriting that section and declaring a new data processor
  on the App Store privacy labels. Trade-off accepted knowingly: no stack symbolication, no error
  grouping, no alerting — reads are manual via the Supabase dashboard. Revisit only with the user.
- **Fixed** via `sql/migration_15_error_logs_and_activity_metadata.sql` (applied live + verified),
  `services/errorLog.ts`, `components/error-boundary.tsx`, wired in `app/_layout.tsx`.
- Privacy policy updated in the same pass (new "Diagnostics" row + search-terms wording in the
  collection table, effective date bumped to 21 September 2026) — the point of going self-hosted
  was that the policy stays true, so **keep it in sync if this area changes again**.

### 0e. No funnel/retention analytics — FIXED (2026-09-21)
- `userActivity` already logged book interactions well (with a genuinely useful `context`
  dimension), but could log nothing else: the service early-returned unless a `bookId` was
  present, so onboarding drop-off, app opens and searches were all invisible.
- **Fixed**: `metadata jsonb` column added to `userActivity`; `logAppEvent` + `logSearch` added
  alongside `logUserActivity`; action types converted from plain `string` to `BookAction` /
  `AppAction` unions (this also closes the "Type the userActivity actions as union type" item
  under Architecture Improvements below). New events wired: `app_open` (_layout.tsx, once per
  launch via a ref), `onboarding_complete` (onboarding.tsx, with subcategory + book counts),
  `search_performed` (books-grid.tsx, with query + result count).
- **Superseded same day by 0f** — a review of "is this enough to know where users got stuck?"
  found it wasn't, and the app-level events moved to a new `appEvents` table.

### 0f. Funnel blind spots found reviewing 0e — FIXED (2026-09-21)
Asked whether 0e's events could actually answer "where did our first users get stuck". They
couldn't. Four gaps, all now closed (`sql/migration_16_app_events.sql` + `services/analytics.ts`
+ `services/deviceId.ts`):
- **Pre-account users were entirely invisible.** Every event required a `userId`, so anyone who
  opened the app, reached signup and left produced zero rows — plausibly the largest MVP drop-off.
  Fixed with an anonymous `deviceId` and the `appEvents` table. Now: signup_started/completed/
  failed, login_started/completed/failed.
- **The onboarding 3-chip gate was invisible.** Only completion was logged, so "picked 2 chips and
  gave up" looked identical to "never opened the screen". Added onboarding_started +
  onboarding_gate_reached.
- **`app_open` undercounted DAU** — fired once per cold launch, no `AppState` listener, so
  background→resume (the common mobile pattern) never logged. Now fires on resume after a 30-min
  gap. This was a genuine defect in 0e, not a missing nice-to-have.
- **No screen views** — a dead tab was indistinguishable from a tab nobody tapped a book in.
  Added `logScreenView` via `usePathname()` in the root layout.
- Privacy policy updated again in the same pass (new "Usage" row covering the anonymous
  identifier and screen views; the "three categories, all tied to your account" line was now
  factually wrong, since pre-auth events are tied to no account, and was rewritten).

### 0g. Nothing reads the analytics back — PARTLY ADDRESSED (2026-09-21)
- **Done**: `sql/analytics/` — `signup-funnel.sql`, `zero-result-searches.sql`,
  `errors-by-context.sql`, `retention.sql`, plus a README with run instructions. All four were
  executed against the live DB before committing, so they're syntax-verified, not just plausible.
  Run via `supabase db query --linked -f <file>` or the dashboard SQL editor.
- **One statement per file on purpose** — `supabase db query` returns only the LAST statement's
  rows, so a two-query file silently hides the first. Keep that rule when adding more.
- **Still open**: no in-app admin screen. Reading still means running SQL by hand. That's a
  deliberate deferral, not an oversight — the client key can't read these tables by design, so an
  admin screen needs an Edge Function with service_role.

### 0g (original note). Nothing reads the analytics back
- `appEvents`, `userActivity` and `errorLogs` are all insert-only with no SELECT policy by design,
  so there is no in-app way to see any of it. Reading means hand-written SQL in the Supabase
  dashboard.
- Nothing is broken; it's just that data nobody looks at answers no questions. Worth either a
  small admin screen (service_role via an Edge Function — the client key deliberately can't read
  these tables) or, cheaper, a saved set of funnel/error SQL queries kept in `sql/`.
- Highest-value queries to write first: signup funnel by day (appEvents), onboarding
  started→gate→complete drop-off, zero-result searches ranked by frequency, errors grouped by
  `context` over the last 7 days.

### 0h. console.error sweep → errorLog — DONE (2026-09-21)
- All production error paths now route through `logError` from `services/errorLog.ts`, so they
  land in `errorLogs` instead of vanishing in a release build. ~30 real call sites converted
  across index.tsx, profile.tsx, settings.tsx, book-details.tsx, book-list.tsx, books-grid.tsx,
  feedback-button.tsx, recommendations.ts, biblionet-api.ts, userActivity.ts.
- Context naming convention: `<file-stem>/<operation>` — e.g. `home/recommendations`,
  `settings/deleteAccount`, `book-details/addToReadingList`. Keep this; `errors-by-context.sql`
  groups on it.
- **~15 `.catch(console.error)` handlers were dead code and were deleted, not converted** —
  `logUserActivity` and `incrementBookView` both swallow their own errors and never reject, so
  those handlers could never fire. (`incrementBookView` is a no-op stub; see bookStats.ts.)
- **Three deliberate exclusions, each documented in-file — don't "finish the job" later without
  reading why**:
  - `hooks/use-storage-state.ts` — `logError` resolves the user via
    `supabase.auth.getSession()`, which reads this very storage layer; reporting a storage
    failure would re-enter the thing that just failed.
  - `services/catalog-ingestion.ts` + `app/catalog-ingestion.tsx` — `__DEV__`-only, loops over
    thousands of books; would flood `errorLogs` and burn the 25-per-launch cap on admin noise.
  - `services/errorLog.ts` itself — its `if (__DEV__) console.error` is the local dev echo.

### 0i. Session tokens were being written to device logs — FIXED (2026-09-21)
- Found during the 0h sweep. `app/_layout.tsx` logged the whole `session` object on **every
  navigation change**. Supabase's `Session` type carries `access_token` AND `refresh_token`, so
  live credentials were going into iOS/Android device logs and, on web, the browser console.
- Fixed by logging `hasSession: !!session` instead. The log line is kept — it's useful — it just
  no longer carries the credential.
- **Also done (2026-09-21)**: all 7 remaining `[Layout]`/`[Auth]` debug `console.log` lines in
  `_layout.tsx` (5) and `ctx.tsx` (2) are now `if (__DEV__)`-guarded, so nothing — including the
  user uids `ctx.tsx` logs — reaches production device logs. The lines were kept rather than
  deleted because they're genuinely useful when debugging the auth/onboarding redirect flow.
- **Convention going forward**: debug `console.log` in app code should be `__DEV__`-guarded;
  real errors go through `logError`. `console.*` is production-visible in React Native release
  builds by default — it is NOT stripped automatically.

### 0j. Free-tier DB size headroom check (2026-09-21) — no action needed yet
- Asked whether the new logging tables would strain the free plan before first users. Measured
  live rather than guessed: total DB was 108 MB, of which **~95 MB is the `books` catalog +
  genre/category tables — fixed cost, doesn't grow with users**. Free tier cap is 500 MB
  (confirmed via supabase.com/pricing, 2026-09-21), so ~400 MB of real headroom exists regardless
  of user count.
- `userActivity` measured at **~910 bytes/row including indexes** (208 KB / 234 rows) — used as
  the working estimate for `appEvents` too, similar column shape. At realistic first-cohort
  volume (tens of users, not all daily-active) that's low single-digit MB/month — not a concern.
  MAU (50k) and egress (5 GB) aren't close to relevant at this scale either; DB size is the only
  binding free-tier constraint.
- **The real gap, still open**: `appEvents`/`errorLogs`/`userActivity` have no retention policy —
  rows accumulate forever. Fine now; becomes relevant if usage actually grows, since `books` is
  flat but logs compound. **User's call (2026-09-21): defer this — plans to upgrade to Pro before
  it becomes a real constraint, so no pruning job needed for now.** Revisit if usage grows
  meaningfully before that upgrade happens, or if `pg_size_pretty(pg_database_size(...))`
  approaches ~350-400 MB. `userActivity` should stay unpruned regardless — it feeds
  recommendations and `bookStats`, unlike the two purely-diagnostic tables.

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

### 4. No user-facing error feedback — STILL OPEN (narrowed 2026-09-21)
- The *fatal* case is now handled: `ErrorBoundary` shows a themed "Something went wrong" screen
  with a retry (see 0d above). What remains is the non-fatal case.
- Most Supabase errors are still swallowed into `console.error` / `logError` with no UI at all —
  a failed "add to wishlist" looks like nothing happened.
- Fix: add a lightweight toast/snackbar system, then pair it with the existing `logError` calls
  (log for us, toast for the user) rather than replacing them.

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

### Type the userActivity actions as union type — DONE (2026-09-21)
- Now `BookAction` | `AppAction` unions exported from `services/userActivity.ts` — see item 0e above.

### Extract large screen components
- profile.tsx (rewritten 2026-09-02 as hero + shelves, see project-state.md) still keeps its
  shelf sub-components (ShelfHeader, ReadingCard, CoverOnlyCard, FinishedRow, empty-state tiles)
  defined locally in the same file rather than extracted — fine at current size, revisit if the
  file keeps growing. The stale "StatsTiles, CategoryCloud, BookTabList" suggestion here no
  longer applies — those don't exist in the current structure.
- Same for home (index.tsx): ContinueReadingSection, RecommendationsSection, etc.
