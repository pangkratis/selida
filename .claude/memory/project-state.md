# Selida — Project State

## Screens (app/(tabs)/)

### Home (index.tsx) — Complete & Polished
- Banner carousel: 3 gradient banners, auto-scroll every 4s, dot pagination with AccentPalette
- Continue Reading: books with status='reading', dual-state timer (play/stop), circular progress rings, real-time elapsed time display
- Recommendations: personalized via recommendations.ts, "See all" → book-list
- Trending: HorizontalBookShelf ordered by view count
- Recent Activity: placeholder — empty state only, not implemented
- Pull-to-refresh via RefreshControl; useRef for interval management

### Explore (explore.tsx) — Complete & Refined
- Layout: decorative "?" watermarks behind everything (`pointerEvents:'none'`), inside one
  `ScrollView` (`style={{flex:1}}`, `contentContainerStyle={styles.stage}`): a headline, a search
  card, then either the recent-searches list or a hint line, then a "Recently viewed"
  `HorizontalBookShelf` as the last item in scroll flow (bottom fade via `LinearGradient`,
  absolutely positioned as a sibling AFTER the `ScrollView` — unaffected by this restructure).
  Results on submit → `books-grid` with `mode:'search'`.
  - **Restructured 2026-09-17 (was a non-scrolling `flex:1` layout) — recent searches overlapped
    "Recently viewed"**: previously `stage` was a plain `View` with `flex:1`, and "Recently
    viewed" was a separate sibling `View` rendered after it (no `flex`) — Yoga sizes non-flex
    siblings first, then gives the `flex:1` sibling exactly the REMAINING space as a hard box, not
    a suggestion. With several recent searches (up to `MAX_VISIBLE`=5), `stage`'s actual content
    height could exceed that remaining box, and since a plain `View` doesn't clip by default, the
    overflow rendered straight through/over "Recently viewed" below it instead of pushing it down
    — a classic Yoga trap for "flex:1 + pinned-to-bottom sibling" layouts with variable-height
    content above. **Fixed by making `stage` a real `ScrollView`** (content flows and scrolls
    instead of overflowing a fixed box) with "Recently viewed" moved INSIDE it as just the next
    item in scroll flow, not a separately-pinned sibling. Knock-on changes: `stage`'s own `flex:1`
    was removed (wrong for a `contentContainerStyle` — can collapse short content) and its
    `paddingBottom` now carries `TAB_BAR_CONTENT_CLEARANCE` unconditionally (previously that lived
    on `recentlyViewedSection`, which doesn't render at all when there's no recently-viewed
    history, silently losing the tab-bar clearance in that case — moving it to `stage` fixes that
    edge case too); `recentlyViewedSection`'s own `paddingHorizontal:24`-equivalent duplication
    (`recentlyViewedLabel`'s `paddingHorizontal:24` + the shelf's `contentPaddingHorizontal={24}`)
    was removed since the section is now genuinely nested inside `stage`'s own
    `paddingHorizontal:24` and would otherwise be double-inset — the shelf now passes
    `contentPaddingHorizontal={0}`. **General rule for this codebase: don't pin a variable-height
    section to the bottom of a screen via a `flex:1` sibling above it** — if the flex sibling's
    content can grow (a list, search results, anything user-driven), wrap the whole screen in a
    real `ScrollView` instead, or the content will silently overflow into whatever's pinned below
    it rather than pushing it down.
- **Fixed 2026-09-17 — typing caused layout shift**: two elements used to appear/disappear as the
  user typed, shoving everything below them up/down: (1) a big circular "search icon orb" above
  the headline, shown only while the recent-searches list was visible (i.e. hidden as soon as
  `searchText` became non-empty) — removed entirely, along with the now-dead
  `showRecent`/`hideOrb` vars; (2) a full-width "Search →" pill button that appeared below the
  search card only when `searchText.length > 0` — removed. The search-trigger action it provided
  moved INSIDE the search card itself: the trailing clear (`close-circle`) button was replaced
  with a small circular arrow button (`styles.inlineSearchButton`, same
  `searchText.length > 0` visibility) that calls `saveAndNavigate(searchText)` directly — tapping
  it (or the keyboard's `returnKeyType="search"` key, unchanged) submits the search. The
  recent-searches-list-vs-hint block right below the search card is now keyed only on
  `recentSearches.length > 0`, not on `searchText` too, so it no longer toggles based on typing
  either. Net effect: nothing above or below the search card changes shape while typing — only
  the trailing icon inside the search card itself swaps. **Clearing the search text via a
  dedicated button was intentionally removed** per this request; backspace/keyboard clear still
  works.

### Profile (profile.tsx) — Rebuilt as hero + per-status shelves (2026-09-02, iterated same day)
Adapted from a Claude Design HTML mock ("Library / Profile — design reference (3b)", option 3b)
— structural layout only, NOT the mock's literal colors/fonts (Quicksand/Fraunces, hardcoded
hex). Uses the app's own theme tokens throughout.
- **Hero**: title text `t('profileYourLibrary')` = "My Library" / "Η Βιβλιοθήκη μου" (changed
  from "Your"/"σου" — this is the user's own page, "my" reads more natural; same change applied
  to `profileYourWishlist` = "My Wishlist"). Both keys are ONLY used in this file — safe to
  reword without checking other screens. Settings is a bare icon button (Ionicons
  `settings-outline`, size 24, `theme.secondary`, `padding:8` hit target, no background/shadow
  container — two earlier passes had it in a colored badge, then as white-on-badge; both were
  reverted on request) that navigates to `/settings`. No greeting/display-name in the hero —
  intentionally removed since Home already greets the user; `getGreeting()`/`getInitials()`
  helpers from the first pass are gone entirely, not just unused.
  Hero background is `mixHex(theme.background, AccentPalette[1], ...)`, matching the existing
  header-tint pattern used elsewhere. Counts-card icon size **20** / count fontSize 27 (icon was
  24 through an earlier "a little bigger" pass from 19/22, then reduced back down to 20 on
  2026-09-19 — "too big" + visibly cutting into the top of the number below it). **The count
  `ThemedText` needed an explicit `lineHeight: 32`** (fixed same day) — fontSize 27 with no
  `lineHeight` let the glyph box render taller than the `marginTop: 9` spacing accounted for, so it
  visually crept up under the icon above it. Same root-cause pattern as the Home-screen
  header-overlap bug and the empty-state emoji clipping — see those notes; **large/bold text
  without an explicit `lineHeight` is the first thing to check for any "icon/text overlapping
  something above it" report in this codebase**, it keeps recurring. Icon colors use
  `theme.tabReading`/`tabWishlist`/`tabFinished` (semantic tokens in theme.ts, previously unused
  before this screen). The vertical dividers between the 3 columns were `width:1` with
  `marginVertical:14`, relying on the row's implicit `alignItems:'stretch'` to make them span the
  full row height minus that margin (~78px tall, spanning nearly the whole card) — shortened
  2026-09-19 to an explicit `height:36, alignSelf:'center'` instead, which is both shorter (per
  "reduce the height of the separator" feedback) and more predictable than margin-subtracted
  stretch if the row's content height ever changes again.
- **Counts card is tappable**: each column scrolls the page to its shelf via a `ScrollView` ref
  + per-section `onLayout` y-offset capture (`sectionY.current[key]`).
- **Currently reading**: horizontal rail, 108px cards (cover 2:3 + title + author). No "+ Add a
  book" tile anymore (removed on request) — empty state is a dashed tile instead.
- **Wishlist**: horizontal rail, 108px covers only (no caption) — matches Currently Reading's
  card width exactly, on request (was 70px, then 88px, now 108px). Empty state is a dashed tile.
- **Finished**: vertical list of compact rows, 52×78 thumb (bumped up from 40×60), title 14.5px,
  meta 12.5px ("author · finished date").
- **Reading and Wishlist headers have the 3-colored-dot "see all" affordance** (same
  `AccentPalette[0,1,2]` dot component as Home's `SeeAllDots`, reimplemented locally in this
  file since it isn't exported from index.tsx) → pushes `/book-list` with a NEW `type` value
  (`'user-reading'` / `'user-wishlist'`, see book-list.tsx below). Finished's header
  deliberately has NO dots/see-all — it's already a full vertical list, not a rail.
- **No tabs** — removed the old pill-tab selector; all three collections are always visible as
  stacked shelves.
- **Status-change interaction**: rail cards (reading/wishlist) have no visible menu button (no
  room at 88-108px) — long-press opens the same status-change Modal that used to be triggered by
  a visible ellipsis icon. Finished rows keep a visible ellipsis button since they have room.
  Preserves all existing status-menu functionality (move to reading/wishlist, mark finished,
  remove), just changes the affordance on 2 of 3 shelves.
- **Removed from the pre-2026-09-02 version**: the bouncing-emoji Reanimated empty states, the
  Reanimated press-scale on cards (`AnimatedBookCard`), the reading-time/motivation-banner cards
  mentioned in older notes here (that older description was already stale before the rewrite —
  the actual pre-rewrite code was a tabs + single vertical list layout).
- **Data fetching changed 2026-09-02**: was `useFocusEffect` — reloaded readingList (1 query +
  N per-book queries) every time this screen regained focus, including every close of
  book-details. Now a plain `useEffect` (loads once on mount / when `user.uid` becomes
  available); ongoing sync relies entirely on the existing realtime `postgres_changes`
  subscription. This only works because `sql/migration_09_readinglist_replica_identity.sql`
  sets `REPLICA IDENTITY FULL` on `readingList` — without it, Postgres only replicates PK
  columns on DELETE, and since readingList has no single-column PK (unique on
  `(userId, bookId)` via constraint, not a PK), Realtime couldn't identify deleted rows and
  they'd go stale until a full reload. **If that migration hasn't been run, deletes will not
  reflect live and this regresses** — check `sql/migration_09...` was applied before assuming
  this data-freshness fix is actually in effect on a given environment.
- `handleStatusChange`/`navigateToBook`/timestamp-sanitization logic are UNCHANGED from before.

### Settings (settings.tsx)
- Reached from Profile's bare gear icon → `/settings`. Sections: Account (display name, country),
  Preferences (language), Admin (conditional on `user.isAdmin`).
- Generic `Row` component (icon + `flex:1` label + `rightSlot` or `value`/chevron) is used for
  most single-line settings rows — it's a single `flexDirection:'row'`, so `rightSlot` content
  needs to stay narrow or the label (which has `numberOfLines={1}` + `flex:1`) gets squeezed.
- **Language row fixed 2026-09-17 — label truncated to a single letter on iPhone 16**: the
  Preferences section's Language row used the generic single-line `Row` with
  `LanguageSegmentedControl` (flag + full language name, e.g. "🇬🇷 Ελληνικά", for 2 languages) as
  `rightSlot`. That control's intrinsic width left almost nothing for the label, truncating
  "Language" down to "L". Fixed by giving Language its own stacked two-line block instead of
  `Row`/`rightSlot`: label+icon on one line, `LanguageSegmentedControl` full-width on the line
  below (its two option buttons now use `flex:1` each to fill that width evenly, rather than
  hugging their own content). **General rule for this codebase: don't put a multi-word/flag
  segmented control in a `Row`'s `rightSlot`** — the label has no minimum-width protection against
  it; stack it below instead if the control needs more than ~80-100px.

### Onboarding (onboarding.tsx) — Complete (updated 2026-06-25)
- PageHeader + subtitle + "What do you enjoy reading?" chip strip
- Subcategory chips: horizontal ScrollView, sizes vary by popularity (font 12–17px) from `get_popular_subcategories` RPC
- Selected chips: filled AccentPalette[0]; unselected: outlined with AccentPalette[0]+'15'
- "Popular right now" HorizontalBookShelf from getTrendingBooksByViews — shown when search bar is empty
- Book search bar (400ms debounce → searchBiblionetBooks); results in 3-col grid
- Added books shelf: real-time readingList subscription shows user's already-added books
- completeOnboarding writes `onboardingComplete: true` + `preferredSubcategories: string[]` to users table
- Continue button text: "Continue" if any personalization selected, "Skip" otherwise

### Book Details (book-details.tsx) — Complete
- Form sheet modal (`sheetAllowedDetents: [0.72, 1.0]`, native `presentation:'formSheet'` via
  `app/_layout.tsx`'s `Stack.Screen`, react-native-screens ~4.16)
- **Hero cover sized via `clamp()`, not a bare fixed size (2026-09-19)**: `coverWidth = clamp(120,
  width * 0.38, 160)` (`width` from `useWindowDimensions()`, already destructured here for the
  lightbox), `coverHeight = coverWidth * 1.5` to preserve the original 140×210 (2:3) aspect ratio.
  Was a flat `width:140/height:210` in `styles.cover` — at that fixed size the cover is ~44% of a
  ~320pt phone's width but only ~33% of a ~430pt phone's, so it visibly shrinks/grows in
  prominence at the screen-size extremes even though centered layout means it never clips or
  crowds the edges. See the "Responsive sizing" note under Navigation Structure for the general
  reasoning (`clamp()` is for elements whose visual prominence/proportion matters, not general
  spacing).
- **CTA button + chips slimmed down 2026-09-19** ("too chunky" feedback): `ctaButton`
  (Save to Wishlist/Remove) was `height:54`, full-width (stretched edge-to-edge via `ctaRow`'s
  `paddingHorizontal` with no own width/alignSelf), heavy shadow (`shadowOpacity:0.28,
  shadowRadius:14, shadowOffset.height:8, elevation:6`). Now `height:46`, content-sized
  (`paddingHorizontal:26` instead of a width) and centered via `ctaRow: { alignItems:'center' }`
  (no longer stretching full-width), lighter shadow (`shadowOpacity:0.15, shadowRadius:8,
  shadowOffset.height:4, elevation:3`). The genre/subcategory `chip` style had an even heavier
  shadow for its size (`shadowOpacity:0.35, elevation:4`) — toned down to match
  (`shadowOpacity:0.15, shadowRadius:4, shadowOffset.height:2, elevation:2`). If another "chunky
  button" report comes in elsewhere, check for this same combination (tall + full-width +
  strong shadow) rather than assuming it's a new problem shape.
- Status cycling: None → Wishlist → Reading → Completed → Remove (cyclic)
- Book persistence: saves to Supabase 'books' on first open, upserted by id
- search_text column populated automatically by DB trigger fn_books_search_text
- **Genre taxonomy wired into the chip row (2026-09-19)**: a `useEffect` fetches
  `book_genres.select('is_primary, confidence, genres(slug, name_en, name_el)')` for `book.id`
  (ordered primary-first, then by confidence), stored in local `genres` state — one-shot fetch, no
  realtime subscription (not needed for a rarely-changing, non-critical classification). The chip
  row that used to render `[...book.categories, ...book.subcategories]` now renders
  `[...genres (localized via i18n.language), ...book.subcategories]` — **`book.categories` is no
  longer shown here at all**, deliberately, since it's ~81% junk "Γενικά βιβλία" (see
  issues-opportunities.md #6) and genre is meant to replace it for exactly this kind of display.
  User-confirmed decision (asked via 3 options — add genre as a separate badge / replace
  categories with genre / genre-with-categories-fallback — "replace" was chosen). **Caveat: only
  ~29% of books have a genre row** (see the Genre taxonomy section below), so plenty of book
  detail pages will show ONLY subcategory chips (if any) or no chip row at all, where they
  previously always showed at least the (junk) category chip — this part is the accepted
  tradeoff, not a bug. (A SEPARATE real bug was found and fixed the same day, initially
  mistaken for a consequence of this one: books opened via search were losing their
  `subcategories` entirely regardless of genre, due to `books-grid.tsx`'s `mapDocToBook` never
  copying that field — see the Books Grid section below. Don't re-attribute a missing-subcategory
  report to genre coverage without first checking whether the book actually has subcategories in
  the DB.)
  **NOTE: this only changed DISPLAY on this one screen** — `book.categories` is still used
  elsewhere for actual filtering (`books-grid.tsx`'s `mode:'category'` still does
  `array-contains` on `books.categories`) and that underlying data-quality problem is untouched by
  this change; don't assume issue #6 is resolved.
- **Publisher shown in the hero, below the author (2026-09-19)**: first added as a labeled row in
  the About card next to ISBN, then moved same-day per "let's have publisher more visible" — now a
  plain, unlabeled `ThemedText` (`styles.publisher`: 13px, `opacity:0.75`, centered,
  `numberOfLines={1}`) directly below the author name in the hero zone, matching how the author
  itself has no "Author:" label either. `author.marginBottom` was reduced from 14→4 and the new
  14px bottom margin moved onto `publisher` itself, so spacing before the meta-badge row stays the
  same when a publisher exists; **books with no publisher get slightly tighter spacing there
  (4px instead of 14px)** — a minor, accepted inconsistency rather than adding a conditional
  fallback margin for it. The `bookPublisher` locale key (added when this was still an About-card
  row) was removed again since the hero version has no label to translate — only `bookIsbn`
  (`'ISBN'`/`'ISBN'`) survived from that first pass, fixing the previously-hardcoded/untranslated
  ISBN label. `isbnRow`/`isbnValue` still carry the `flex:1, textAlign:'right'`, `gap:12` robustness
  changes made during the brief publisher-in-About-card version — harmless to keep even though only
  ISBN uses that row now.
- Reading stopwatch: only shown when origin='readingList' AND status='reading'
  - Animated progress bar, start/stop, HH:MM:SS display
  - Crash recovery: resumes from lastSessionStartMs
  - Shows total time + estimated pages (1 min/page)
- Logs user activity; bookStats incremented automatically by Postgres trigger fn_activity_sync_views
- **iOS scroll bug fixed 2026-09-17 — three attempts, real root cause was #3:**
  1. The sheet's `ScrollView` had `contentContainerStyle` but no `style={{flex:1}}` on the
     `ScrollView` itself. Added a `scrollView: { flex: 1 }` style passed via `style=`, alongside
     the existing `scroll` `contentContainerStyle` (padding only) — still good practice (**any
     `ScrollView` needs both**), but did NOT fix the actual bug.
  2. Tried `sheetExpandsWhenScrolledToEdge: false` on book-details' `Stack.Screen` options in
     `app/_layout.tsx`, theorizing the native sheet's scroll-to-expand-detent gesture was
     intercepting the scroll. Also did not fix it (left in place — harmless, arguably still
     correct for a sheet with sub-1.0 detents, just wasn't the actual cause here).
  3. **Actual root cause**: `react-native-screens`' iOS form sheet finds its "tracking" scroll
     view via `RNSScrollViewFinder.mm`'s `findScrollViewInFirstDescendantChainFrom`, which walks
     **only the first child at each level** of the native view tree — not a full subtree search.
     `book-details.tsx` rendered a small grabber `View` as a sibling BEFORE the `ScrollView`
     (`<SafeAreaView><View grabber /><ScrollView>...`), so the first-child walk dead-ended on the
     grabber (a non-scrolling `View` with no further children) and never found the `ScrollView` at
     all — the sheet had no tracking scroll view, so it never handed scroll gestures to it
     ("doesn't scroll"/"scrolls a bit then bounces back" were really the same underlying failure,
     not fixed by either of the above). **Fix: `ScrollView` must be the sheet's literal first
     child.** Reordered so `ScrollView` renders first; the grabber now renders AFTER it as a
     `position: 'absolute', pointerEvents: 'none'` overlay (top:0, `alignItems:'center'`) so it
     still visually sits on top without occupying the first-child slot — `scroll`'s
     `contentContainerStyle` got a matching `paddingTop: 16` so hero content doesn't render under
     the floating grabber. **This is the pattern to check first for ANY future "ScrollView won't
     scroll" report inside a `formSheet` route in this codebase**: is the `ScrollView` genuinely
     the first child in the JSX render tree (not preceded by any sibling `View`, even a tiny
     decorative one)? If not, react-native-screens silently fails to link it and no other fix
     (flex sizing, `sheetExpandsWhenScrolledToEdge`) will help.

### Books Grid (books-grid.tsx) — Complete
- mode='search': calls search_books RPC (pg_trgm + unaccent on search_text column)
- mode='category': array-contains on books.categories
- Deduplication via Set; limit 200 results; no pagination yet
- mapDocToBook utility normalizes Supabase rows to Book type — **hand-picks fields one by one from
  the raw row rather than spreading it**, which is exactly how it silently dropped `subcategories`
  (fixed 2026-09-19, see below). This is the ONLY hand-built `Book` object literal anywhere in the
  app (`book-list.tsx` and other screens just spread/cast the full Supabase row) — if a `Book`
  field is ever added to the type and books opened via search seem to be missing it, check here
  first; nowhere else has this failure mode.
- **Fixed 2026-09-19 — subcategory chips silently missing on book-details for books with no
  genre**: not actually related to genre at all — coincidence of two independent things having low
  coverage. Root cause: `mapDocToBook` (used only by this screen's `mode:'search'`/`mode:'all'`
  paths) never copied `data.subcategories` into the returned `Book`, even though the Supabase row
  has it (`syncedSub: true`, populated array — verified directly against the DB). Any book opened
  via a search result lost its subcategories for display purposes, regardless of whether it also
  had a genre — it just READ as genre-correlated because genre coverage (~29%) is also low, so a
  no-genre book showing no subcategories either looked like a pattern rather than two unrelated
  gaps. Fixed by adding `subcategories: data.subcategories || []` to `mapDocToBook`.
- **Fixed 2026-09-17**: the 📚 emoji in the "No books found" empty state was visually clipped on
  iOS — `emptyEmoji` style had `fontSize: 36` with no `lineHeight`. Same root cause as the
  Home-screen header-overlap bug noted elsewhere in this file (large glyphs need an explicit
  `lineHeight` on iOS or RN renders the glyph box shorter than the glyph actually needs, clipping
  it). Fixed with `lineHeight: 44`. `book-list.tsx`'s equivalent empty-state emoji (`fontSize: 40`,
  inline style) had the identical bug — fixed there too with `lineHeight: 48`. **Check for this
  first on any report of an emoji/large-glyph being visually cut off on iOS** — it's almost always
  a missing `lineHeight`, not a layout/clipping-container issue.
- **Tried, then reverted, 2026-09-17**: swapped the "Finding books..." `ActivityIndicator` for
  `<AnimatedLogo size={72} showWordmark={false} />` (the splash-screen brand-mark component from
  `components/animated-logo.tsx`) to use the app's own animated mark instead of a platform-default
  spinner. **Reverted same day** — search results load fast enough here that the animation barely
  gets time to play before the loading state disappears, so it wasn't worth it; back to plain
  `ActivityIndicator`. **Don't re-suggest `AnimatedLogo` as a loading indicator for a short-lived
  loading state** — it only reads well somewhere the loading state reliably lasts long enough to
  see the animation (the actual splash screen, e.g.), not a fast Supabase query like this one.

### Book List (book-list.tsx) — Simple, now 4 list types (added 2026-09-02)
- `type` param: `'recommendations' | 'trending' | 'user-reading' | 'user-wishlist'`
- The two new `user-*` types (added for Profile's "see all" dots) bypass the
  recommendations/trending catalog-pagination path entirely: `USER_LIST_STATUS` maps them to a
  status, fetches the user's `readingList` rows for that status, then fetches each book by id
  (same 2-step pattern as profile.tsx's own `getBookDetails` — no FK exists from
  `readingList.bookId` to `books.id`, so PostgREST embedded-resource joins are NOT available;
  don't try `.select('bookId, books(*)')`, it will not auto-join).
- `isUserList` (`type in USER_LIST_STATUS`) short-circuits `loadMore` (a bounded personal list
  has no "next page") and suppresses the "You've seen it all" footer for these two types.
- `user-reading` passes `origin: 'readingList'` to book-details on tap, matching what
  profile.tsx's own `navigateToBook` does, so the reading stopwatch still shows correctly.
- Uses CompactBookGrid; has loading + empty states

---

## Services (services/)

### recommendations.ts — Server-side scoring (rewritten 2026-06-23)
- SCORING MOVED TO POSTGRES: `supabase.rpc('get_book_recommendations', {...})` — one round-trip
- SQL function in `sql/get_recommendations.sql` (SECURITY DEFINER, STABLE); indexes in `sql/recommendation_indexes.sql`
- Client extracts weighted preferences from readingList (top 30): categories, SUBCATEGORIES (new), authors, tags, publishers, language
- Status weights: wishlist=1, reading=2, completed=3 × history recency decay (exp, floor 0.6)
- SQL weights: category +15, SUBCATEGORY +12, author +20, tag +12, publisher +8, language mismatch -15, popularity boost capped +10 (log of views/wishlist/reading/completed × lastActivityAt recency mult)
- RPC params: p_categories, p_subcategories, p_authors, p_tags, p_publishers, p_preferred_language, p_source (null=all), p_exclude_ids (readingList+seen), p_limit
- RPC returns pre-scored rows mapped directly to ScoredBook (no client scoring). match_reason built in SQL.
- Client still owns: 10-min pool cache, seen-recs dedupe (max 50), jitter (0..30), author diversity (max 3/author), trending fallback
- REMOVED: fetchBookStatsMap, 3 parallel candidate queries, shuffleSlice, CANDIDATE_FETCH_LIMIT
- Added `subcategories?: string[]` to Book type in constants/types.ts
- getTrendingBooksByViews(limit): unchanged — bookStats ordered by views DESC (2 queries)
- Known issue: detects coverUrl-as-bookId via '/' or 'http' check — data integrity workaround (kept)

### readingSessions.ts — Core Feature, Complete
- startReadingSession: writes lastSessionStart timestamp
- stopReadingSession: calculates elapsed, updates totalReadingTimeSeconds, creates session history doc
- getReadingProgress: returns totalSeconds, progressPercentage, isReading, lastSessionStartMs
- 1 min/page assumption for page progress

### bookStats.ts — No-op stubs (2026-06-25)
- Both exports are now empty no-op stubs: `incrementBookView` and `updateBookStatusStats`
- All stat updates handled by Postgres triggers: fn_activity_sync_views, fn_reading_list_sync_stats, fn_sync_book_popularity
- The old debug log ("pangkratis: ") is gone since the function body is empty

### userActivity.ts — Book events only (2026-09-21)
- `logUserActivity(userId, bookId, action, context, metadata?)` — book-attached events only.
  `BookAction` union: view_details, add_to_reading, add_to_wishlist, mark_completed,
  remove_from_list (previously a plain `string` — the union was a tracked tech-debt item, now done)
- **App-level events are NOT here** — they're in `services/analytics.ts` → `appEvents`. A brief
  intermediate version (migration_15) put app_open/onboarding_complete/search_performed in this
  table with a null bookId; migration_16 moved them out. Don't add non-book events back here.
- Contexts: home_recommendations, explore_recommendations, continue_reading, search_results,
  category_results, book_details, list_recommendations, list_trending
- `metadata` jsonb column (migration_15) is available for book events, currently unused by any
  call site.
- Errors logged but not thrown

### analytics.ts + deviceId.ts — App-level funnel events (added 2026-09-21, second pass)
- **Why a separate table from `userActivity`**: `userActivity."userId"` is `not null references
  users(id)` and its RLS is `using (auth.uid() = "userId")`, so it can only ever describe
  signed-in users. That made the biggest MVP funnel question unanswerable — people who open the
  app, hit signup, and leave. Loosening that table was rejected: it would give up the security
  property verified in the 2026-09-19 RLS audit, on a table that also carries the `bookStats`
  trigger and feeds recommendations. So app events moved to their own `appEvents` table.
  **migration_15's three app events were moved out of `userActivity` by migration_16** —
  `userActivity` is book-only again.
- `services/deviceId.ts` — `getDeviceId()`, a random UUID (expo-crypto) persisted in SecureStore,
  localStorage on web (follows the same platform split as `hooks/use-storage-state.ts`).
  **NOT a device fingerprint** — nothing about the hardware is read; it dies on uninstall.
  Caches the *promise*, not the value, so concurrent startup callers can't race and mint two ids.
  Returns null if storage is unavailable (private browsing, locked keychain) and callers skip.
- `services/analytics.ts` — `logEvent(event, context?, metadata?)`, `logSearch(query, count)`,
  `logScreenView(path)`. `userId` is resolved internally from the cached session, never passed
  in, so a caller can't misattribute an event and pre-auth events correctly record null.
  `logScreenView` drops consecutive duplicate paths (expo-router re-reports on param changes).
- **Event taxonomy**: app_open (context `cold_launch`|`resume`), screen_view,
  signup_started/completed/failed, login_started/completed/failed, onboarding_started,
  onboarding_gate_reached, onboarding_complete, search_performed.
- **`app_open` fires on resume, not just launch** — an `AppState` listener in `_layout.tsx` with
  a 30-min session gap. The first version (migration_15) fired once per cold launch only, which
  **undercounted DAU**, since mobile users resume far more often than they relaunch. Don't
  regress this.
- **The onboarding gate is the key funnel**: the finish button only renders at
  `selectedSubcategories.length >= 3`. `onboarding_started` → `onboarding_gate_reached` measures
  people stuck below 3 chips; `gate_reached` → `complete` measures people who saw the button and
  didn't press it.

### errorLog.ts — Self-hosted crash/error reporting (added 2026-09-21)
- `logError(error, context, { fatal })` and `reportError(context)` (curried, for `.catch(...)`)
- Writes to the `errorLogs` table in our OWN Supabase — deliberately NOT Sentry/Bugsnag, so
  `docs/privacy.html`'s "no crash-reporting trackers" claim stays literally true and no new data
  processor / App Store privacy label is introduced. **This was an explicit user decision
  (2026-09-21), not a default — don't swap in a third-party SDK without revisiting it.**
- Never throws (a throwing error-reporter would mask the error it was reporting)
- Reads userId from `supabase.auth.getSession()` (local cache, no network round-trip — the error
  being reported may itself be a network failure)
- **Flood protection**: same context+message deduped within 60s, hard cap 25 reports per app
  launch. A render-loop error would otherwise write thousands of rows.
- Truncates to match the DB check constraints (message 2000 / stack 10000 / context 200)

### biblionet-api.ts / catalog-ingestion.ts — Biblionet calls go through an Edge Function proxy (2026-09-19)
- **Root issue this fixed**: both files (plus an inline block in `app/catalog-ingestion.tsx`) used
  to have the real Biblionet account username/password hardcoded as client-side constants — shipped
  in the JS bundle to every install, regardless of `__DEV__` guards (those only gate the function
  bodies at runtime, not whether the module/constant is bundled at all). Found during an app-store
  readiness review; full writeup in `issues-opportunities.md` #0.
- **Architecture now**: `supabase/functions/biblionet-proxy/index.ts` is a Supabase Edge Function
  (Deno) that reads `BIBLIONET_USERNAME`/`BIBLIONET_PASSWORD` from `Deno.env` (set via
  `supabase secrets set`, never in the repo), and forwards `{ endpoint, params }` to
  `https://biblionet.gr/webservice/{endpoint}` with those credentials attached server-side. It
  only allows 4 endpoints (`search_titles`, `get_title`, `get_month_titles`,
  `get_title_subject`) — the exact set this app uses — as light defense against being used as an
  open relay.
- **Client side**: `biblionet-api.ts`'s `postToWebservice()`, `catalog-ingestion.ts`'s
  `fetchTitles()` and the subject-fetch inside `syncSubcategories()`, and
  `app/catalog-ingestion.tsx`'s `handleBookLookup()` all now call
  `supabase.functions.invoke('biblionet-proxy', { body: { endpoint, params } })` instead of
  building the request with a hardcoded credential. `params` values must be strings (the function
  builds a `URLSearchParams` server-side) — e.g. `catalog-ingestion.ts`'s subject-sync explicitly
  does `String(book.biblionetId)` since that column can come back as a number from Supabase.
- **`tsconfig.json` excludes `supabase/functions`** — it's Deno code (global `Deno.serve`,
  `Deno.env`, different runtime), not part of the RN/Expo TypeScript project; including it caused
  `Cannot find name 'Deno'` errors against the app's tsconfig.
- **Deploy gotcha** (see issues-opportunities.md #0 for full detail): needs `supabase init` run
  once (creates `supabase/config.toml`, which the CLI needs to anchor path resolution for
  `functions deploy` — without it, deploy fails with a confusing "entrypoint path does not exist"
  error even though the file is right there) and `supabase functions deploy biblionet-proxy
  --use-api` (this machine has no Docker installed, so the Docker-based default bundling doesn't
  work; `--use-api` bundles server-side instead).
- **Still outstanding, not fixable in code**: the OLD password (now unused by the app, but still
  valid on Biblionet's side) should be rotated by whoever administers that account — it was
  exposed in git history and past local builds regardless of this fix. Not the app's call to make;
  flagged to the user.

### Biblionet API shape, confirmed 2026-09-19 (investigating subcategory-sync speed)
Discussed speeding up subcategory sync (1 request per book, 1000 req/day account limit, resets
daily). Investigated whether a bulk/reverse lookup exists (subject→books instead of book→subject)
— confirmed via the official docs at `https://biblionet.gr/webservice/` that it does NOT: **8
total endpoints** (`get_month_titles`, `get_title`, `get_contributors`, `get_title_subject`,
`get_person`, `get_company`, `get_subject`, `get_language`), every one single-ID-per-request, no
batch param support anywhere, no rate limit documented publicly (the 1000/day figure must come
from account-specific terms, not the public docs). `get_subject` returns metadata about ONE
subject (name/DDC code), not which books have it. **1 request per book for subcategories is a
real, unavoidable constraint of this API** — don't re-investigate this without new information.
- **Confirmed empirically**: `get_title` and `get_month_titles` return the exact same field
  shape (`TitlesID`, `Title`, `Category`/`CategoryID`, etc.) — neither includes subject/subcategory
  data inline; `get_title_subject` is genuinely the only source for it.
- **Real bug found and left unfixed by request**: `get_title` needs its ID parameter named
  `title`, not `titleid` — confirmed by testing both directly (`{"title":"..."}` returns a full
  record; `{"titleid":"..."}` returns an empty HTTP 500). Two call sites use the wrong name:
  `biblionet-api.ts`'s `getBiblionetBookById()` (dead code — nothing calls it) and
  `app/catalog-ingestion.tsx`'s `handleBookLookup()` (the admin "Book Lookup" text box — wired to
  real UI, but **user confirmed they don't use this feature**, so left broken rather than fixed;
  don't "fix" this unprompted later without checking this note first).

### Ingestion cursor moved to the database (2026-09-19)
The catalog crawl position (year/month/page) used to live only in `expo-secure-store` on
whichever device last ran ingestion — invisible unless you opened the app on that exact device.
Moved to a new single-row table, `public.ingestion_cursor` (migration_11), keyed by a fixed
`id='catalog'`. `updatedAt` on that row doubles as "when did ingestion last make progress."
`services/catalog-ingestion.ts`'s `getCursor()`/`saveCursor()`/`clearCursor()` now read/write this
table instead of SecureStore; `readCursor()`/`resetCursor()` (called from
`app/catalog-ingestion.tsx`) kept their exact signatures, so the admin UI needed zero changes.
RLS: readable/writable by any `authenticated` client (same informal security posture as
`books`/`bookStats` — not gated to real admins at the DB level, only the UI path to it is gated by
`isAdmin` client-side) — verified anon access is blocked, authenticated read/write both work.
`expo-secure-store` import removed from this file (still used elsewhere, e.g. auth session
storage — untouched).

**Correction, same day**: the verification test for this migration inserted a row using
`START_CURSOR` (`year:2026, month:4, page:1`) to check read/write mechanics worked — this
overwrote the real, already-progressed position, which had only ever existed in the now-migrated-
away-from local SecureStore and couldn't be recovered directly. **Recovered by inference from the
data itself**: grouped `books` by `publishedYear` (where `biblionetId is not null`, i.e. actually
crawled, not search-added) — 2024/2025/early-2026 all show ~full-year volume (~7,500 books/year,
2026 partial-year-adjusted), 2023 shows only 1,414 (~19% of a full year), 2022-and-earlier show
essentially zero. Since the crawl walks backward month-by-month from April 2026 toward
`STOP_YEAR=2015`, this is exactly the signature of a crawl currently stuck partway through 2023.
Cursor manually reset to **`year:2023, month:11, page:1`** — a deliberate 1-month safety buffer
before the point volume drops off, favoring a small amount of harmless re-crawling (upserts
dedupe on `biblionetId`, so no bad data results, just a few wasted requests re-confirming
already-known books) over the alternative risk of silently skipping months forever. **This is an
estimate, not a recovered exact value** — the true month/page this reached before is permanently
lost. If ingestion ever seems to be re-covering suspiciously many already-known books once it
resumes, that's expected here, not a new bug.

### New-vs-already-known book counts during ingestion (2026-09-19)
Two things checked: (1) duplicate prevention — **confirmed real, not just assumed**: `books` has
an actual `UNIQUE` constraint (`books_biblionet_id_unique`) on `biblionetId`, verified directly
against the live schema (`pg_constraint`), and `runCatalogIngestion()` upserts with
`onConflict:'biblionetId'` — so a re-fetched book updates its existing row rather than
duplicating. (2) **New-vs-updated split, added same day**: previously `runCatalogIngestion()`
only logged "Saved N books," which was really "attempted to save N via upsert" — no way to tell
how many were genuinely brand-new rows versus already-known books just being refreshed. Added a
pre-upsert check: `SELECT biblionetId FROM books WHERE biblionetId IN (...)` for the batch's ids
(a plain Postgres query — costs nothing against the Biblionet daily quota, unlike everything else
in this file) — the set difference gives an exact `newCount`/`updatedCount` split.
`IngestionResult` gained both fields; console logs and the admin UI ("Saved N books (X new, Y
already known)") both show the breakdown now. Two other places in `app/catalog-ingestion.tsx`
construct placeholder `IngestionResult`-shaped objects before any real run has happened
(`useEffect` on mount, `handleReset`) — both updated to include `newCount:0, updatedCount:0` too,
or TypeScript would (rightly) reject them as incomplete.

### STOP_YEAR removed — crawl now stops on actual data exhaustion (2026-09-19)
The backward crawl (April 2026 → older) used to hard-stop at a hardcoded `STOP_YEAR = 2015`,
regardless of whether Biblionet still had books further back — undocumented, unexplained in code,
origin unknown. Per explicit request ("go as far behind as there are still books fetched"),
replaced with a real signal: `Cursor` gained a `consecutiveEmptyMonths` field (persisted in
`ingestion_cursor` via migration_12), incremented only when a month's FIRST page (`page===1`)
comes back with zero titles — **a trailing empty page after a month that DID have books doesn't
count** (that's just pagination ending normally, distinguished via `c.page === 1` at the moment of
the empty result). Crawl stops (`advance()` returns `null`) once `MAX_CONSECUTIVE_EMPTY_MONTHS`
(6) months in a row are genuinely empty — treated as "walked past the start of Biblionet's
catalog," not one unusually quiet month. If this number ever needs tuning (false-stops too early,
or runs too long through genuinely empty history), it's the one constant to adjust — no other
logic changed.

### Pre-launch data audit → contributors table added (2026-09-19)
Cross-checked the live schema (`information_schema.columns`, `pg_indexes`, `pg_constraint` —
NOT just the static `sql/*.sql` files, which can drift from what's actually live) against the full
Biblionet API surface, testing all 4 previously-unused endpoints (`get_contributors`, `get_person`,
`get_company`, `get_language`) live. Findings:
- **Indexing was already solid** — GIN indexes on `authors`/`categories`/`subcategories`/
  `searchTags`, trigram index on `search_text`. No performance gap.
- **`get_language` is a dead end** for the known ISO-language-code issue (#8 in
  issues-opportunities.md) — it returns the same Greek word Biblionet already stores, not an ISO
  code. That fix still needs a local static lookup table; nothing from the API helps.
- **`get_company`** (publisher contact info — address/phone/email) — confirmed low value for a
  reading app, not pursued.
- **`get_contributors` was the real find**: a book can have MULTIPLE people in DIFFERENT ROLES
  (e.g. author + translator), each with a stable `ContributorID` — completely unlike
  `books.authors` (a flat `text[]`, no stable identity, no roles, no non-author contributors
  captured at all). This is the same class of problem the genre taxonomy already fixed for
  categories (unreliable string matching vs. stable IDs) — left unfixed for authors until now.
- **Built**: `contributors` (id uuid PK, `biblionetId` unique, `fullName`) +
  `book_contributors` (book_id/contributor_id/`contributorTypeId`/`contributorType`/
  `presentOrder`, unique on book+contributor+type) — see migration_13. RLS mirrors `books` exactly
  (public read, any `authenticated` client can write — NOT the stricter `genres`-style
  select-only-then-RPC pattern, since this gets populated by the same client-side ingestion tool
  that already writes `books` directly). `contributorTypeId` is coalesced to `0` rather than left
  `null` when missing — Postgres treats `NULL` as distinct from itself in unique constraints, which
  would otherwise let a re-sync create duplicate links for a contributor with an unlisted role.
- **`role` is stored RAW** (Biblionet's own numeric `ContributorTypeID` + Greek `ContributorType`
  label, e.g. 1/"Συγγραφέας" for author, 2/"Μετάφραση" for translator) — NOT normalized into an
  enum. Only one book's worth of role samples has been observed (author, translator); build a
  proper normalized vocabulary once more role values actually show up in real data, the same way
  `genre_mappings` grew from observed data rather than a guessed-upfront taxonomy.
- **New `syncContributors()`** in `catalog-ingestion.ts` mirrors `syncSubcategories()`'s design
  exactly: batched (`CONTRIBUTOR_SYNC_BATCH=900`), ordered by `popularityCount DESC`, stops after
  `MAX_CONSECUTIVE_FAILURES` (shared constant with subcategory sync) consecutive failures. New
  `books.syncedContributors` boolean tracks progress, mirroring `syncedSub`. Wired into
  `app/catalog-ingestion.tsx` as a new "Sync contributors" button (`AccentPalette[4]`), identical
  pattern to "Sync subcategories."
- **Shares the same 1000/day Biblionet quota** as subcategory sync and catalog ingestion — no
  cross-feature budget tracker exists or was built; running "Sync contributors" the same day as
  "Sync subcategories" will compete for the same budget. Left as a manual judgment call, same as
  ingestion + subcategory sync already coexist today without one.
- `get_contributors` added PERMANENTLY to the proxy's `ALLOWED_ENDPOINTS` (now actually used).
  `get_person`/`get_company`/`get_language` were temporarily allowed during the audit itself, then
  reverted — not added, since nothing uses them (verified via `git diff` showing no changes before
  the final permanent edit).
- **Verified end-to-end against live data before considering this done**: contributor upsert,
  book_contributors upsert (including confirming a re-upsert merges instead of duplicating, via
  the correct `on_conflict` query param — matches what `supabase-js`'s `.upsert(..., {onConflict})`
  sends automatically), then cleaned up all test rows.
- **Not done, deliberately out of scope for this pass**: no book-details UI displays contributor/
  role data yet (data layer only, per what was actually asked); `get_person` author-bio
  integration (flagged as lower-priority "nice to have" during the audit, not built).

---

## Components (components/)

| Component           | Purpose                              | Used In                        |
|---------------------|--------------------------------------|--------------------------------|
| PageHeader          | Eyebrow + title + rightSlot          | All main screens               |
| HorizontalBookShelf | FlatList horizontal, 140px cards     | Home, Explore                  |
| CompactBookGrid     | 3-col FlatList, portrait covers      | Book List, Books Grid          |
| CircularProgress    | SVG animated ring, % in center       | Home continue-reading, Profile |
| ThemedText/View     | Theme-aware wrappers                 | Throughout                     |
| HapticTab           | Custom tab button with haptics       | Tab navigator                  |
| AnimatedLogo        | SVG fan-mark + wordmark, Reanimated  | SplashOverlay (login uses static PNG instead) |
| SplashOverlay       | Fullscreen brand intro, gates on intro+session | _layout.tsx Root() |
| ErrorBoundary       | Class component (no hook equivalent for `componentDidCatch`); themed fallback + "Try again" that remounts the subtree via a bumped key. Reports to `errorLogs` with `fatal: true`, appending React's component stack to the JS stack. Mounted OUTSIDE SessionProvider in _layout.tsx so provider crashes are caught too | _layout.tsx RootLayout() |
| AuthBackgroundCircles | 8 absolutely-positioned pastel circles, `mixHex(theme.background, AccentPalette[i], 0.14)` | login, signup |
| FloatingField / FloatingFieldShell | Label-inside-field input with focus ring + optional eye toggle; Shell is the bare visual container reused for non-TextInput fields (signup's country trigger) | login, signup |

---

## Auth screens (login.tsx, signup.tsx) — Rebuilt 2026-09-02
Adapted from a Claude Design HTML mock ("Selida — Auth screens (6a + 7a)") — structural layout
only, NOT the mock's Quicksand/Fraunces fonts or literal hex (uses `roundedFont`/theme tokens
throughout, same convention as the Profile and Onboarding rewrites this session).
- **Wordmark color changed again same day, on request**: mock's intent was yellow wordmark /
  blue button. Shipped that way first, then the user asked for the wordmark in "black letters"
  instead — now `theme.text` (near-black light / near-white dark, NOT literal `#000`, which
  would be invisible in dark mode). The PRIMARY BUTTON still uses `AccentPalette[1]` (blue) —
  that reassignment from the mock stands; only the wordmark's own color was reverted from
  accent-yellow to neutral ink.
- **Logo/wordmark layout changed same day**: was a small INLINE mark+text row at the top-left
  (30-46px mark). Now a bigger (76px) mark with "Selida" CENTERED below it (stacked, not
  inline), and the whole screen's content is vertically centered (`ScrollView` content
  `justifyContent:'center'`, footer link merged into the same centered block rather than pinned
  to the bottom via `space-between`) — both changed because the first version read as "tiny and
  squeezed" per user feedback. Signup's back button was pulled out of that row into its own
  `position:'absolute', top:0, left:0` element (relative to the ScrollView's padded content box
  — do NOT add extra top/left offset on top of the container's own `padding`, that double-insets
  it) so the centered wordmark block isn't sharing a row with it.
- `loginTitle` changed from "Welcome back" → "Welcome" (English only — the Greek `'Καλώς ήρθες'`
  already meant plain "Welcome" with no "back" connotation, so only English was inconsistent).
  Reason: "Welcome back" reads oddly if this is someone's first time landing on the login
  screen, which can happen (e.g. mistakenly navigating there before ever signing up).
- **Dropped from the mock**: the "or continue with" divider + Google/Magic-link social row.
  Neither is wired up in this codebase — Google Sign-In's config plugin is commented out in
  app.json (`withGoogleSignInAndroid`), and there is no `signInWithOtp`/magic-link call anywhere.
  Shipping non-functional buttons would be worse than omitting them; the README's own fallback
  guidance explicitly permits dropping unsupported buttons. If Google/magic-link auth is added
  later, this is where the row goes back in.
- **"Forgot password?" is real, not decorative**: opens a small Modal (email pre-filled from the
  login field) and calls `supabase.auth.resetPasswordForEmail(email)`. This uses Supabase's
  DEFAULT redirect behavior — no `redirectTo` deep link was configured, so the reset email leads
  to a Supabase-hosted web page, not back into the app. Revisit if a proper deep-linked
  in-app reset screen is wanted later.
- **Password strength meter** (signup only): `getPasswordStrength()` in signup.tsx, a simple
  4-point heuristic (length≥8, upper+lower case, digit, symbol) mapped to
  weak/medium/strong via `theme.error`/`theme.warning`/`theme.success`. Purely client-side UX
  hint, does not block submission.
- **Auth failures moved from `Alert.alert` to an inline error banner** above the primary button
  on both screens (`authError` state), per the mock's explicit spec. The "missing fields"
  validation also uses this same banner now instead of `Alert.alert`, for consistency — not
  mixing alert-based and inline-based error presentation on the same screen.
- **Legal line on signup ("Terms & Privacy Policy") is plain, non-interactive text** — no
  Terms-of-Service or Privacy Policy page exists anywhere in this codebase to link to. Flagged,
  not fabricated; add real links (or make them tappable) once those pages exist.
- `signupTitle`/`loginTitle`/taglines were NOT reworded to match the mock's exact copy
  ("Create your shelf", "Your shelves are waiting.") — existing translated strings were judged
  good enough already; changing copy felt like scope beyond a structural redesign. Revisit if
  the user wants the copy to match more closely.
- CountryPicker (existing component, unchanged) is now triggered from a `FloatingFieldShell`
  instead of a plain bordered row, for visual consistency with the other fields.

---

## Auth & Session (ctx.tsx)
- useSession() hook: exposes session token, AppUser data, signIn/signOut
- onAuthStateChanged → persists token in expo-secure-store
- Supabase Realtime channel on users table → real-time AppUser updates
- AppUser: uid, email, displayName, language, country, catalogPreference, preferredSubcategories, onboardingComplete, isAdmin
- Updates lastLoginAt on login

### Account deletion (added 2026-09-19) — App Store/Play Store compliance requirement
Apps with account creation must let users delete their account+data in-app (Apple guideline
5.1.1(v); Google Play has an equivalent). Didn't exist before this — was the one confirmed hard
blocker found during pre-launch review, everything else being either already-done or
administrative/non-code (privacy policy, EAS signing, store listings).
- **`supabase/functions/delete-account/index.ts`** — new Edge Function. Verifies the caller's
  identity from their OWN JWT via a client built with the `anon` key + the incoming Authorization
  header (`callerClient.auth.getUser()`) — **never trusts a client-supplied user id**, so a user
  can only ever delete themselves. Actually deleting the auth user needs
  `adminClient.auth.admin.deleteUser(user.id)` with the **service_role** key — unlike
  `biblionet-proxy`, no manual `supabase secrets set` was needed for this, since
  `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` are auto-injected into every Edge
  Function's environment.
- **No manual per-table cleanup needed** — confirmed via `pg_constraint`/`information_schema`
  before writing any code that `auth.users → public.users → readingList/readingSessions/
  userActivity` are ALL `ON DELETE CASCADE` (all three of those tables' `userId` FK, plus
  `public.users.id`'s own FK to `auth.users`). Deleting the auth user alone fully cleans up
  everything. `feedback` has no `userId` column at all, so nothing to clean up there.
  **If a new user-owned table is ever added without a cascading FK to `users`, this silently stops
  fully cleaning up on deletion** — worth checking this function's assumption still holds whenever
  a new per-user table is introduced.
- **UI**: `app/settings.tsx`, Session section, a destructive Row below Sign Out
  (`settingsDeleteAccount`), gated behind an `Alert.alert` confirmation
  (`settingsDeleteAccountConfirmTitle`/`Message`) before calling
  `supabase.functions.invoke('delete-account')`, then `signOut()` on success (clears local
  session, triggers `_layout.tsx`'s normal auth-redirect to login). New EN/EL locale keys added
  for all of this.
- **Verified end-to-end with a real throwaway account** before considering this done: created a
  profile + a `readingList` row, called the function, confirmed both were gone and the account
  could no longer log in (`invalid_credentials`) — not just that the function returned success.

---

## App icon (fixed 2026-09-21)
`icon.png` and all three Android adaptive-icon layers were, until this date, the **unmodified
Expo scaffold template assets** (generic blue chevron with visible construction guidelines) —
never replaced when the rest of the branding below was built out. This is what a user saw as "the
Expo icon" on a real device install; it was never a caching issue, the files on disk genuinely
were the placeholder.

Fixed by rebuilding the fan-mark glyph as a **fresh SVG from exact geometry**, not by upscaling
`selida-mark.png` — that file bakes in the "Selida" wordmark (wrong composition for an icon, and
1040×600 source would've needed lossy upscaling to 1024×1024 anyway). The geometry itself was
lifted directly from `components/animated-logo.tsx`'s `REF_*` constants and `COLORED_PETALS`/
`DARK_ANGLES` arrays (7 trapezoid petals — 2 dark "book cover" petals at ±85°, 5 colored ones
fanning between them — rotated around one shared pivot). The glyph's bounding box was computed
analytically (Python, not eyeballed) so it centers correctly without iterating renders.

Generated with `rsvg-convert` + ImageMagick (both already present at `/opt/homebrew/bin` on this
machine) at the exact sizes `app.json` declares:
- `icon.png` (1024×1024) — glyph on `#fefbf8` (the app's real soft background — same color as the
  splash screen and light theme background), **flattened to fully opaque** (`-alpha off`) since
  iOS icons can't carry an alpha channel.
- `android-icon-foreground.png` (512×512) — glyph only, transparent, deliberately scaled SMALLER
  relative to canvas than icon.png's glyph, because Android's adaptive-icon system further masks
  this layer down to a centered safe-zone circle (~66% diameter) — undersizing it is what keeps a
  petal tip from being clipped by whichever mask shape (circle/squircle/teardrop) the launcher
  applies.
- `android-icon-monochrome.png` (432×432) — same safe-zone-aware scale, but a plain WHITE
  silhouette on transparent (Android 13+ tints this layer itself; verified it rendered correctly
  by compositing onto black temporarily, since a white-on-transparent PNG is invisible against a
  white preview background).
- `android-icon-background.png` (512×512) — flat `#fefbf8` fill, no glyph.
- `favicon.png` (48×48) — same composition downscaled; checked legible at that size before
  committing.
- `adaptiveIcon.backgroundColor` in `app.json` updated from `#E6F4FE` (the same leftover
  Expo-default blue) to `#fefbf8`, so it agrees with the new background image.
- **Requires a fresh `eas build`** to actually show up on a device, same as any native asset.

## Branding & Splash (added 2026-09-02)
- Source of truth for the fan-mark logo + splash animation: user-designed in Claude Design,
  exported as "Selida Exports.dc.html" (#export-mark = static mark, #export-lockup = mark +
  wordmark, #export-splash = the CSS keyframe animation this was ported from). If the design
  changes, re-derive constants from a fresh export rather than eyeballing the app.
- `assets/images/selida-mark.png` — static mark-only PNG (1040×600, transparent bg), the
  "closed"/settled state. Used on the login screen header (`app/(auth)/login.tsx`) via a
  RELATIVE require path (`../../assets/images/...`), not the `@/` alias — there was no existing
  precedent for `@/` inside `require()` in this codebase and it couldn't be verified against
  Metro without running the bundler, so the always-safe relative path was used instead.
- `assets/images/selida-splash-{light,dark}.png` (480×360, transparent bg, added 2026-09-02) —
  composite "mark + Selida wordmark" lockups for the NATIVE splash specifically (the native
  splash config takes exactly one static image, no separate text field, so mark+name-below-it
  had to be pre-baked into one PNG). Generated with ImageMagick + the real bundled font at
  `node_modules/@expo-google-fonts/nunito/800ExtraBold/Nunito_800ExtraBold.ttf`, text color
  exactly `Colors.light.text` (`#2D3A2D`) / `Colors.dark.text` (`#F2F9F3`). Mark trimmed to
  420px working width, text scaled to ~230px (≈55% of mark width) for visual balance — if
  regenerating, re-derive that ratio rather than guessing a new pointsize. Both variants were
  visually verified by compositing over their real target background colors before wiring in.
  **Known unresolved issue**: the 2 dark petals (`#3A403C`) are nearly invisible against the
  `#1F1C18` dark background — low contrast, verified in the composite preview. This is a
  pre-existing brand-color problem shared with `components/animated-logo.tsx` (same hardcoded
  petal colors, not theme-aware), not something introduced by the composite generation. Flagged
  to the user, not fixed — recoloring the mark for dark mode is a design decision, not made
  unilaterally.
- **Too big on a small phone, fixed 2026-09-19 (reported on iPhone SE) — TWO separate fixed-size
  spots, both needed fixing:**
  1. `app.json`'s `expo-splash-screen` plugin config had `imageWidth: 240` (the NATIVE splash,
     shown before any JS runs) — on a 375pt iPhone SE that's ~64% of the screen. Reduced to `190`.
     **This is the one the user most likely actually saw**, since it's the first frame and stays
     up longest. **Requires a native rebuild to take effect** — per the existing note above
     ("editing app.json alone does nothing until [prebuild]"), changing `imageWidth` needs
     `expo prebuild` + `expo run:ios`/`run:android` (or a new EAS build) before it's visible; a
     plain Metro/JS reload will NOT show this change. Flag this to the user if they report "I
     changed it but it still looks the same" after just reloading.
  2. `components/splash-overlay.tsx` passed `<AnimatedLogo size={220} .../>` — the JS-rendered
     animated mark shown right after the native splash hands off (see the component's own doc
     comment for why they must match visually). Fixed the same way as the tab-bar pill/hero cover
     (see "Responsive sizing" note under Navigation Structure): `logoSize = clamp(170, screenWidth
     * 0.52, 220)` via `useWindowDimensions()`. This one IS pure JS — takes effect on a normal
     reload, no rebuild needed, unlike #1.
  Both were sized against one device and neither auto-scales on its own (`resizeMode:"contain"`
  on the native splash only prevents the image from being cropped/overflowing — it does NOT scale
  `imageWidth` down for a smaller screen, a common misconception). `app/(auth)/login.tsx`'s static
  `selida-mark.png` header logo was NOT touched — not reported as oversized, and it's a different,
  simpler `<Image>` usage rather than the `AnimatedLogo` component, out of scope unless raised.
- `app.json` `expo-splash-screen` plugin (previously fully commented out, briefly pointed at
  the bare mark) now points `image` at `selida-splash-light.png` and `dark.image` at
  `selida-splash-dark.png`, `imageWidth: 240`, background `#fefbf8` light / `#1F1C18` dark
  (matches `Colors.light/dark.background`). This is the OS-level static splash shown at cold
  start, before any JS runs — it can only ever be static, see the "Known limitation" note
  further below. `ios/` and `android/` are both gitignored and untracked — android/ exists
  locally as a prebuild artifact; this config needs a fresh `expo prebuild` (or
  `expo run:android`/`run:ios`) to take effect, was NOT run as part of this change (still true
  as of the 2026-09-02 composite-image update — nothing here changes that requirement).
- `components/animated-logo.tsx` — Reanimated + `react-native-svg`, NOT a literal port of the
  HTML/CSS anymore (was originally, revised 2026-09-02 — see below). 7 petals (5 colored + 2
  dark) as absolutely-positioned `Animated.View`s sized so each container's own center sits
  exactly on the shared pivot point (RN has no CSS-style arbitrary `transform-origin`, so the
  pivot is achieved by construction instead). Colors, angles, and the infinite ambient
  "shimmer" loop's stagger/curve are still taken directly from the original keyframes.
  **Deliberately changed from the original**: the HTML unfolds petals from a collapsed
  scale-0.45 "bud" over ~1.8s. The app's native OS splash (unavoidably) shows the fully
  assembled static mark BEFORE this component ever mounts, so starting from a collapsed bud
  made the JS overlay look like a second, unrelated splash screen jumping backward in shape.
  Petals now render at final angle/scale/opacity from frame one (matches
  `assets/images/selida-mark.png` and the native splash exactly), with a single ~480ms
  whole-mark "arrival" scale-pulse standing in for the reveal. `INTRO_END_MS` (exported from
  the file, currently 800ms — wordmark delay + duration) replaces the old hardcoded 2400ms.
  If a future HTML export changes the shimmer timing, update those constants only — the entry
  choreography is intentionally no longer keyframe-matched to the HTML and shouldn't be
  reverted to be "more faithful" without re-litigating the native-splash seam problem above.
- `components/splash-overlay.tsx` — fullscreen wrapper: renders `AnimatedLogo` over
  `theme.background`, cross-fades out (350ms) only once BOTH the intro has finished AND the
  `ready` prop (passed as `!isLoading` from session state) is true, then unmounts. Minimum
  guaranteed splash duration is now `INTRO_END_MS` (~800ms) rather than the original 2.4s —
  shortened when the entry animation was redesigned (see above).
- `app/_layout.tsx` — `SplashScreen.hideAsync()` moved to fire on `Root()` mount (fonts already
  loaded by then) instead of waiting on `!isLoading`; the `<Stack>` now always mounts (previously
  `Root()` returned `null` while `isLoading`), with `SplashOverlay` layered on top until ready.
  Screens underneath were already written to guard on `!user`/loading, so mounting the Stack
  earlier (hidden behind the opaque overlay) is safe — verified via `tsc --noEmit` (clean) and
  `expo lint` (zero new warnings) but NOT yet run on-device.

**Known limitation, not a bug**: the true native OS splash (before JS runtime starts) can only
ever show a static image — no engineering fix makes it run this animation. On 2026-09-02 the
user's local `android/` was found to be stale from 2026-06-04 (predates the splash plugin even
existing in app.json), background `#ffffff`, so what they were seeing was a generic unbranded
splash, not our design at all. Fixing that requires a native rebuild
(`npx expo prebuild --clean` then `expo run:android`/`run:ios`) — cannot be run from an agent
sandbox, needs the user's own device/toolchain. If this comes up again, check `android/`'s
mtime against `app.json`'s before assuming the config is wrong.

---

## Multi-Country Book API Architecture
(Moved here from top-level MEMORY.md 2026-09-17 during an index compaction — no content change.)
- **Country**: stored on user profile for informational purposes only — does NOT drive catalog anymore
- **CatalogPreference type**: `'greek' | 'international' | 'both'` — defined in `constants/types.ts`
- **Catalog toggle**: 3-option pill on profile screen (Greek / Intl / Both), writes to `users.catalogPreference` column
- **Signup default**: GR country → `'greek'`, all others → `'international'`
- **BookSource type**: `'biblionet' | 'google_books'` — still used internally and on `Book.source`
- **`getSourceForCountry` REMOVED** from `constants/countries.ts` — no longer exists
- **Service layer**:
  - `services/book-provider.ts` — `searchBooksFromApi(query, CatalogPreference)`, `getBooksByCategoryFromApi(cat, CatalogPreference)`, `sourceFromPreference(pref)` helper
  - When preference is `'both'`: both APIs queried in parallel, Biblionet results first, deduplicated by id
  - `services/recommendations.ts` — `resolveRecommendationSource(pref, readingList)` returns a single `BookSource` for recs; when `'both'`, derives dominant source from reading history via `getDominantSource()`
- **Greek users**: Bookshark API (`https://bookshark.bibliography.gr/api/v1/`) wrapping Biblionet data
- **International users**: Google Books API — dual-query: `inauthor:"query"` + `q=query` in parallel, author results first
- **Countries list**: `constants/countries.ts` — 32 countries, Greece first
- **Supabase indexes needed**: composite indexes on `source` + `categories`, `source` + `searchTags`, `source` + `popularityCount` — create via `CREATE INDEX` in SQL editor if queries are slow

## Gradient fade bug (toTransparent) — fixed 2026-09-17
`constants/theme.ts` exports `toTransparent(hex)`. Use it for every LinearGradient fade endpoint
instead of the literal string `'transparent'`. `'transparent'` is `rgba(0,0,0,0)` — fading an
opaque theme color toward it also interpolates the RGB channels toward black, producing a
visible gray/muddy band partway through the fade instead of a clean fade in the original hue.
Reported by the user as "weird" scroll fades on a real iOS device (screenshot showed a gray
stripe under the status bar on Home) — not actually iOS-specific, just more visible there due to
larger safe-area insets; Android had the same underlying bug. Fixed in all 7 places the app had
this pattern: `app/(tabs)/index.tsx` (top+bottom fade), `app/(tabs)/_layout.tsx` (tab bar),
`app/(tabs)/explore.tsx`, `app/(tabs)/profile.tsx`, `app/book-list.tsx`, `app/books-grid.tsx`.
Any new fade-to-background gradient must use `toTransparent(theme.background)`, never the bare
string.

## Navigation Structure
```
_layout.tsx (Stack, SessionProvider)
├── (auth)/login.tsx
├── (auth)/signup.tsx
├── (tabs)/_layout.tsx (Tab Navigator)
│   ├── index.tsx (Home)
│   ├── explore.tsx
│   └── profile.tsx
├── book-details.tsx (formSheet modal)
├── book-list.tsx (card presentation)
└── books-grid.tsx (card presentation)
```
- **`book-list.tsx`, `books-grid.tsx`, `settings.tsx`, `catalog-ingestion.tsx`** (all `presentation:
  'card'`, `headerShown: false`, custom in-page back button) have `gestureEnabled: true` +
  `fullScreenGestureEnabled: true` in their `Stack.Screen` options (added 2026-09-17, per request
  "add a gesture to go back"). Native-stack's default swipe-back on iOS only recognizes a swipe
  starting right at the screen's left edge; `fullScreenGestureEnabled` widens that to anywhere on
  screen. **Note the prop name**: react-native-screens' own docs/types call the underlying native
  prop `fullScreenSwipeEnabled`, but the version of `@react-navigation/native-stack` this project
  uses (which is what expo-router's `Stack.Screen options` actually type-checks against) exposes
  it as `fullScreenGestureEnabled` — using the react-native-screens name here is a TS error
  (`does not exist in type ExtendedStackNavigationOptions`). `onboarding.tsx` intentionally keeps
  `gestureEnabled: false` (unchanged) since users shouldn't be able to swipe away from onboarding.
  `book-details.tsx` (formSheet) wasn't touched — sheet dismissal already has its own native
  swipe-down gesture, unrelated to this stack-screen option.

### Responsive sizing across phone screen sizes (decided 2026-09-19)
Discussed at length before any code changed — deliberately NOT adopting a blanket
"scale-everything-by-screen-width" system (rejected a `theme.spacing = width * 0.04`-style
approach and a `react-native-responsive-fontsize`/NativeWind rewrite that had been suggested).
Reasoning, for future reference so this doesn't get re-litigated from scratch:
- RN points are already device-density-independent — a `fontSize: 16` is already the same
  physical size on every phone. Scaling `Spacing`/font tokens by screen width would REINTRODUCE
  inconsistency, not fix one, and blows up badly outside the narrow phone-width band (~320-430pt)
  if ever reused for tablet/web-width layouts.
- The ONLY things worth `clamp()`-ing (see `clamp()` in `constants/theme.ts`) are elements whose
  SIZE is deliberately not full-width/flex-driven AND whose visual prominence/proportion-to-screen
  genuinely matters — tested with: does this look meaningfully more/less "right" at 320pt vs
  430pt, not just "does it clip." Two confirmed cases so far: the tab-bar island width (
  `getTabBarIslandWidth()` in `constants/tab-bar.ts`) and book-details' hero cover width (inline in
  `book-details.tsx`, see the Book Details section above) — both because their job is partly about
  looking balanced against the screen, not just fitting their own content.
- Explicitly NOT clamped, and shouldn't be without a fresh reason: `Spacing`/`BorderRadius`/font
  size tokens in `theme.ts` (no visible problem across the phone range), and the fixed-width rail
  cards in `HorizontalBookShelf`/Home/Profile/onboarding's horizontal shelves (uniform card width
  across a scrollable rail is the actual design intent, not a bug — same logic that keeps corner
  radii static: some sizes shouldn't respond to screen width at all).
- An audit (`Agent`/Explore pass across `app/**` and `components/**`) found no other
  "sized-against-one-device" hardcodes beyond those two — don't re-run a full audit without a
  specific new suspect; check `git log`/this file for what's already been covered first.
- Platform (iOS vs Android) differences are handled separately, per-bug, via `Platform.select`/
  `Platform.OS` checks (e.g. the tab-icon `boxShadow` Android bug above) — this section is only
  about screen SIZE, not OS. The user has committed to testing both platforms manually, so this
  isn't something to try to solve generically in code.

### Tab bar — floating "island" (added 2026-09-17, resized + fixed 2026-09-17)
Per-tab active color mapping in `_layout.tsx` (`tabBarActiveTintColor` on each `Tabs.Screen`,
passed into that tab's `TabIcon` too): Home → `AccentPalette[1]` (blue, `#2D8FD5`), Explore →
`AccentPalette[4]` (purple, `#C07ED6`), Profile → `AccentPalette[3]` (green, `#34C759`, unchanged
from the original mapping). This is scoped to the tab bar's own active-icon color only — it does
NOT touch each screen's internal accent usage, which follows its own convention (e.g.
`explore.tsx`/`profile.tsx`/auth screens all independently use `AccentPalette[1]` as "the" accent
for their own headers/buttons) and was intentionally left alone.

`app/(tabs)/_layout.tsx` renders a **fully custom `tabBar`** (via `<Tabs tabBar={(props) =>
<FloatingTabBar {...props} />}>`), not a `tabBarStyle` override. **This was a hard-won fix — do
not go back to `tabBarStyle` for positioning.** Three attempts at centering a fixed-width
`position:'absolute'` bar via `tabBarStyle` all failed, each rendering the island pinned near the
left edge instead of centered: (1) `left:'50%'` + negative `marginLeft`, (2) `left:'50%'` +
`transform:[{translateX}]`, (3) a pixel `left` computed from `useWindowDimensions()`. Root cause:
react-navigation's `BottomTabBar` does not guarantee `tabBarStyle` is positioned/sized directly
against the full screen width, so any left-offset math against "the screen" is unreliable —
including the two textbook CSS centering tricks that would work for a plain absolutely-positioned
`View` outside react-navigation's layout. **The fix: stop fighting react-navigation's
positioning — render your own tab bar.** `FloatingTabBar` (local component in `_layout.tsx`) is a
full-width `position:'absolute', left:0, right:0` wrapper with `alignItems:'center'`
(`pointerEvents="box-none"` so empty space beside the pill doesn't block touches to screen content
below), containing one `flexDirection:'row'` pill `View` that IS the visible island — flexbox
centers it correctly regardless of what width react-navigation's own container resolves to, since
we no longer depend on that container's width at all. The pill's own width is
`getTabBarIslandWidth(screenWidth)` from `constants/tab-bar.ts` (via `useWindowDimensions()`) —
**changed 2026-09-19 from a bare fixed `TAB_BAR_ISLAND_WIDTH = 216` constant** to a `clamp(190,
screenWidth * 0.55, 236)` formula (margin-based full-width sizing was tried even earlier and read
as "too wide" on larger phones — see the "Responsive sizing" note above for why this is clamped
rather than either a bare fixed number or scaled without bounds). Inside the pill, each route is
manually mapped from `state.routes` to a `HapticTab`
(`flex:1`, manually wired `onPress`/`onLongPress` via `navigation.emit`/`navigation.navigate`,
replicating what `options.tabBarButton` used to do automatically) rendering
`options.tabBarIcon?.({ focused, color, size })`. `screenOptions` on `<Tabs>` now only carries
`tabBarActiveTintColor`/`tabBarInactiveTintColor`/`headerShown` — `tabBarShowLabel`,
`tabBarButton`, `tabBarItemStyle`, `tabBarStyle` are gone; the custom `FloatingTabBar` owns all of
that visually. Each `HapticTab` item is just `{ flex:1, alignItems:'center',
justifyContent:'center' }` — **do not add `paddingTop` here for "breathing room above the
icon"**: with a fixed pill height (60) and a fixed icon capsule size (44, see `TabIcon` below),
plain `justifyContent:'center'` already splits the 16px of slack evenly (8 top / 8 bottom); adding
`paddingTop` on top of that shifts the centered content down, producing MORE space above the icon
and less below — this was tried and had to be reverted for exactly that visible misalignment.
Floats `TAB_BAR_ISLAND_GAP` (10) above the
safe-area bottom edge, height `TAB_BAR_ISLAND_HEIGHT` (60), fully rounded (`borderRadius:
height/2`), opaque `theme.surface` background with its own shadow. All dimension constants live in
`constants/tab-bar.ts` — change them there, not inline, since 3 screens depend on them staying in
sync (see below). Dropped entirely: the old `tabBarBackground` custom render (gradient fade +
hairline dividers) — not needed once the bar is an opaque floating card instead of an edge-to-edge
bar blending into the page.
- Each tab's `tabBarIcon` still renders a `TabIcon` wrapper (local to `_layout.tsx`, 44×44, radius
  22) behind the icon when focused, and switches to the SF-Symbol/Ionicons `.fill` variant on
  focus (`house`→`house.fill`, etc.) — the `.fill` mapping already existed in `icon-symbol.tsx`'s
  Android/web fallback but was previously unused; now wired up on both platforms.
  - **Focused-state capsule styled as "pressed in", not a colored highlight** (changed
    2026-09-17): a flat neutral dark-grey `backgroundColor` (`rgba(0,0,0,0.09)` light /
    `rgba(0,0,0,0.32)` dark — NOT `color + '20'`, which was the original accent-tinted version and
    read as "raised highlight" rather than "pressed button") PLUS a real **inset shadow via the
    `boxShadow` style prop** (two entries: a darker shadow (`offsetY: 1.5, blurRadius: 5`) — the
    generous blur relative to the small offset spreads it around most (~60-70%) of the ring rather
    than reading as a thin one-sided crescent, but a fully centered `offsetX:0, offsetY:0` version
    was also tried and read as "too even/full circle" per feedback — plus a faint lighter one
    (`offsetY: -1, blurRadius: 1.5`) offset up for a thin bottom "lip" highlight on the remaining
    rim — both `inset: true`). An
    `expo-linear-gradient` overlay was tried first to fake the inset look (RN's
    `shadow*`/`elevation` props only render outer/raised shadows, so there's no way to fake an
    inset via those), but the user found the gradient "looked weird" and asked for a real inline
    shadow instead. `boxShadow` (CSS-style, array-of-objects form: `{ offsetX, offsetY,
    blurRadius, color, inset }`) is supported here because the project runs **RN 0.81 with New
    Architecture enabled** (`newArchEnabled: true` in `app.json`) — it renders true inset shadows,
    unlike the legacy `shadow*` props. **If `newArchEnabled` is ever turned off, this capsule
    shadow needs revisiting** (fall back to the gradient trick or similar) since `boxShadow` inset
    support depends on it. **Android square-shadow bug, 2026-09-17 — two attempts:**
    (1) added `overflow: 'hidden'` to the capsule `View`, theorizing the inset shadow just needed
    clipping to the `borderRadius`. **Did not fix it** — still rendered as a square on Android.
    (2) Root cause is deeper: Android's `boxShadow`/`inset` rendering has known upstream bugs where
    it ignores the view's `borderRadius` entirely — the shadow paints as part of the view's own
    border/background layer during its own draw step, not as clippable child content, so
    `overflow:'hidden'` (which only clips children) can't touch it. See
    react-native-screens#2669 and react-native#48874 for the same class of bug. First fix attempt
    gated just the `boxShadow` block to `Platform.OS === 'ios'`, keeping the flat grey
    `backgroundColor` capsule on Android without any shadow. **User then asked to go further: on
    Android, drop the capsule background entirely too — focused state there is just the
    accent-colored icon, no circle at all** (`backgroundColor` is now also gated to
    `focused && Platform.OS === 'ios'`, same condition as the `boxShadow` block). iOS is
    unchanged/kept exactly as it was (grey fill + inset shadow). `overflow: 'hidden'` was left in
    place (harmless) but is NOT what fixes the square-shadow bug — don't waste time re-trying it if
    this resurfaces; the fix is platform-gating both `backgroundColor` and `boxShadow` together.
    The icon glyph itself keeps its accent color
    (unchanged `color` prop) on both platforms so tab identity doesn't disappear — only the capsule
    behind it went neutral grey.
- **Because the bar is `position:'absolute'`, it no longer reserves layout space** — screen
  content scrolls underneath it and must supply its own bottom clearance, or the island visually
  covers the last row of content. `constants/tab-bar.ts` exports `TAB_BAR_CONTENT_CLEARANCE`
  (island gap + height + a buffer) for exactly this. All 3 tab screens already reserve
  `insets.bottom` via their own `SafeAreaView`, so this clearance value must NOT also include
  `insets.bottom` — it only covers the island itself. Applied to:
  - `index.tsx` — `scrollContent.paddingBottom`
  - `profile.tsx` — the main ScrollView's `contentContainerStyle.paddingBottom`
  - `explore.tsx` — **was** NOT a scrolling screen (a `flex:1` `stage` View pushing
    `recentlyViewedSection` to the bottom); restructured 2026-09-17 into a real `ScrollView` (see
    the Explore section above — the old flex-push layout let a long recent-searches list overflow
    into "Recently viewed" instead of pushing it down) — clearance now lives on `stage`'s own
    `contentContainerStyle.paddingBottom`, same pattern as `index.tsx`/`profile.tsx` now.
  - If a 4th tab screen is ever added, or any of these three screens' bottom-content structure
    changes, re-check this clearance is still applied somewhere reachable.
- `components/feedback-button.tsx` (profile-only floating action button) sits at
  `bottom: insets.bottom + 80`, its own top edge lands ~10px above the island's top edge — no
  overlap, checked, but it's a narrow-ish gap; revisit if the island's height/gap constants change.

---

## Supabase Schema

### books
id text (UUID default), title, authors[], categories[], coverUrl, searchTags[], pageCount, description,
isbn, language, publisher, edition, isActive, createdAt, biblionetId (unique), syncedSub boolean, subcategories[]

### bookStats
bookId text (PK), views, reading, completed, wishlist, lastActivityAt

### users
id uuid, displayName, email, language, country, catalogPreference, onboardingComplete, preferredSubcategories text[], lastLoginAt, isAdmin boolean
(stats jsonb DROPPED — was never populated)
`isAdmin` is protected by a `BEFORE UPDATE` trigger (`migration_10_protect_admin_flag.sql`, added
2026-09-19) — a client can send `isAdmin` in a self-PATCH and it will be silently ignored/reset
unless the request is made with the service_role key. See "RLS audit (2026-09-19)" below for why.

### readingList
userId, bookId, status (wishlist|reading|completed), progressPercentage, totalReadingTimeSeconds,
lastSessionStart timestamptz, isReading, addedAt

### readingSessions
userId, bookId, durationSeconds, createdAt

### userActivity
userId, bookId, action, context, metadata (jsonb, added migration_15), createdAt
- Book events only. RLS `for all using (auth.uid() = "userId")` — signed-in users, own rows.

### appEvents (added migration_16, 2026-09-21)
id, deviceId (not null), userId (nullable), event, context, metadata (jsonb), platform,
appVersion, createdAt
- App-level funnel/retention events. **Keyed by an anonymous deviceId so pre-signup behaviour is
  visible** — `userId` fills in once known, and the two stitch together on deviceId (the standard
  anonymous → identified pattern).
- Insert-only, no SELECT policy; `anon` CAN insert (that's the point). With-check
  `"userId" is null or "userId" = auth.uid()` prevents misattribution. Length caps on
  deviceId/event/context because anon can write here.
- **Verified live 2026-09-21** via curl with the real anon key: anon insert (no userId) → 201;
  anon select → `[]`; forged userId → 42501; 100-char event name → 23514.

### errorLogs (added migration_15, 2026-09-21)
id, userId (nullable, `on delete set null` — pre-auth crashes have no user, and a report should
outlive the account), message, stack, context, fatal, platform, appVersion, createdAt
- **Insert-only from the client, no SELECT policy at all** — same shape as `feedback`. Read it via
  the Supabase dashboard / service_role, never through the app.
- `anon` CAN insert (deliberate — pre-auth crashes on the login screen are exactly the ones you
  most need). The with-check `"userId" is null or "userId" = auth.uid()` stops report forgery.
- Check constraints cap message/stack/context length — these exist *because* anon can insert, so
  the public key in the bundle can't be used to write unbounded text into the table.
- **Verified live 2026-09-21** with the real anon key via curl: anon insert → 201; anon select →
  `[]`; forged userId → 42501 RLS rejection; 2500-char message → 23514 check-constraint rejection.

### feedback
message, platform, createdAt

### Genre taxonomy (migration_06_genres.sql — written 2026-06-29, **confirmed RUN as of 2026-09-19**)
Source-independent genre layer so Biblionet (Greek) and Google Books (international) land in
the same buckets. Replaces books.categories for all browsing/recommendation purposes.
**Correction 2026-09-19**: this section previously said "NOT YET RUN" — that was stale. Verified
directly against the live DB via the anon key (`services/supabaseConfig.ts`) + PostgREST: `genres`
has all 25 seeded rows, and `book_genres` has a working FK join to `genres` (PostgREST embedded
resource `select=...,genres(slug,name_en,name_el)` works directly, unlike `readingList.bookId`
which needs a manual 2-step lookup). **Coverage is partial, though: only 5,418 of 18,753 books
(~29%) have a `book_genres` row.** Any UI reading genres must handle "no genre yet" gracefully
(most books currently have none) — don't assume coverage without re-checking if this matters again
later, since the backfill function only assigns genres to books matching a `genre_mappings` rule.

- **genres** — id uuid, slug (stable key), name_en, name_el, is_fiction (NULL = audience
  bucket), is_browsable, sort_order. **25 rows seeded.**
- **book_genres** — book_id, genre_id, confidence real, method ('mapping'|'llm'|'manual'),
  is_primary. The ONLY table the app should read for genre browsing.
- **genre_mappings** — source, signal_type ('category'|'subject'|'bisac'), raw_value, genre_id,
  weight. 34 Biblionet category rules + 172 subject-heading rules seeded.

The 25 genres (slug — name_el):
literature Λογοτεχνία · crime-thriller Αστυνομικά & Θρίλερ · science-fiction Επιστημονική
Φαντασία · fantasy Φαντασίας · horror Τρόμου · romance Αισθηματικά · historical-fiction
Ιστορικό Μυθιστόρημα · poetry Ποίηση · drama Θέατρο · comics Κόμικς · childrens Παιδικά ·
young-adult Εφηβικά · biography-memoir Βιογραφίες & Μαρτυρίες · history Ιστορία · philosophy
Φιλοσοφία · psychology-self-help Ψυχολογία & Αυτοβελτίωση · religion-spirituality Θρησκεία &
Πνευματικότητα · science-nature Επιστήμες & Φύση · technology Τεχνολογία & Πληροφορική ·
business-economics Επιχειρήσεις & Οικονομία · politics-society Πολιτική & Κοινωνία ·
health-wellbeing Υγεία & Ευεξία · art-culture Τέχνες & Πολιτισμός · food-travel Γαστρονομία &
Ταξίδια · sports Αθλητισμός

Design decisions (user-confirmed 2026-06-29):
- "Literature" not "Literary Fiction" (Λογοτεχνία)
- Sports included; ancient literature (Αρχαία γραμματεία) folds into `literature`, no own genre
- Children's and Young Adult kept as SEPARATE genres
- Reference material (Εκπαιδευτικά βοηθήματα, Εγκυκλοπαίδειες & λεξικά, Γλώσσα, Εκπαίδευση)
  gets NO genre — stays searchable, never a browse tile
- Thema qualifiers (place/language/period/audience) deliberately excluded from mapping

Functions:
- `fn_resolve_book_genres(book_id)` — applies mappings, sets is_primary on top-weighted genre
- `fn_resolve_all_book_genres()` — single-pass set-based backfill, idempotent, run ONCE
  (migration_07 replaced migration_06's batched loop, which was non-terminating: books matching
   no rule never get a book_genres row, so they were re-selected on every run)
- `trg_sync_book_genres` — AFTER INSERT/UPDATE OF categories, subcategories ON books
- `get_browsable_genres(min_books)` — RPC for Explore grid + onboarding chips; replaces
  `get_popular_subcategories`
- `get_unmapped_subjects(limit)` — (migration_08) subject headings with no rule, ranked by how
  many books each would unlock. NOT every row deserves a rule — qualifiers (place/language/
  period/education) must stay unmapped or genre quality degrades.
- `get_genre_coverage()` — (migration_08) one-row health check: total/classified/pct, split by
  method, `unclassified_with_subjects` (= rule gaps, fixable without an LLM), sync progress.

**LLM classification is NOT built** — only the `method='llm'` slot exists. Note that
`book_genres` has SELECT-only RLS policies, so any external classification script needs the
**service_role** key; the anon key cannot write genres.

Live state (2026-06-29, after migration_07 backfill): 4,864 / 18,753 books classified (25.9%),
5,295 assignments, all 25 genres populated. 14,891 books (79.4%) are "Γενικά βιβλία".
Recommended order of work: finish subcategory sync → add rules for new high-frequency
headings → LLM pass for the residue.

Measured coverage: **31.9%** from mappings alone (24.0% category + 9.4% subject).
68.1% needs LLM classification or a completed subcategory sync. Only `romance` gets zero books
from rules. books.categories / books.subcategories are KEPT as provenance — never delete.

**Not yet done:** run the migration; switch Explore + onboarding to `get_browsable_genres`;
LLM batch classification for the 68%; ISO language codes; cross-source book identity.

## Security audits (2026-09-19)

### App-store readiness review — found hardcoded Biblionet credentials
Triggered by "what do we need before app stores" — found the real Biblionet account
username/password hardcoded client-side in 3 places. Full detail and fix in
`issues-opportunities.md` #0. Net result: credential moved to a Supabase Edge Function
(`supabase/functions/biblionet-proxy/`), verified working live.

### Git history reset (2026-09-19)
Since the Biblionet credential had been committed to git history (though the repo was always
private, and no real app build was ever produced from this code — confirmed with the user,
so the actual exposure surface was narrow), the user chose to drop history entirely rather than
rewrite it in place (didn't care about keeping old commit log). Process used:
1. `mv .git .git.bak-<timestamp>` (rename, not delete — reversible safety net)
2. Moved that backup OUTSIDE the project directory entirely: `../Selida-old-git-history-backup-<date>`
   (sibling to the project folder) — critical, since leaving it inside the repo risks it getting
   swept into a future `git add -A`.
3. `git init -b main`, `git add -A`, single "Initial commit" with the current (already-fixed)
   codebase.
4. User manually deleted the old GitHub repo and created a fresh empty one (same name,
   `pangkratis/selida`) via the GitHub web UI — this tool has no `gh` CLI access, cannot create/
   delete GitHub repos itself, only push to an already-existing remote.
5. `git remote add origin https://github.com/pangkratis/selida.git`, `git push -u origin main`.
**If this ever needs to be referenced**: the pre-reset history (44 commits) lives at
`../Selida-old-git-history-backup-<date>` on the same machine it was done on — nowhere else.
**Caveat inherent to this approach**: only cleans up what's on this machine / this GitHub repo.
Any other clone of the old repo (another machine, a synced backup) would still have the old
history — not something either the user or this tool could verify from here.

### RLS audit (2026-09-19)
Manual, hands-on audit — not just reading policy definitions, actually attempted the accesses
that should be blocked, using real Supabase auth accounts. Two passes:

**Pass 1 — anonymous access** (anon key, no login) against every table found in `sql/*.sql`
(`grep -ihE "^\s*create table"`): `users`, `readingList`, `readingSessions`, `userActivity`,
`feedback` all correctly return `[]` for `SELECT *` with no auth. `books`, `categories`,
`subcategories`, `book_categories`, `book_subcategories`, `genres`, `genre_mappings`,
`book_genres` are all openly readable — correct, these are catalog/taxonomy data with nothing
personal in them. **One low-severity looseness noted, not fixed**: `bookStats` (per-book
aggregate counts, no personal data) is also openly anon-readable — probably fine, but wasn't a
deliberate decision, just how RLS happens to be configured; revisit if it ever matters.

**Pass 2 — authenticated cross-user access** (the more common real bug class, invisible to
anon-only testing). Created two real throwaway accounts via `/auth/v1/signup` (not just
`auth.users` — also had to call the app's own `create_user_profile` RPC to populate
`public.users`, since that row isn't auto-created by a trigger; found this by hitting a foreign-key
violation on the first attempt and tracing it to `app/(auth)/signup.tsx`'s post-signup RPC call).
User B created real `readingList`/`userActivity` rows; User A then attempted, live, against the
real API:
- SELECT another user's `readingList`/`userActivity`/`users` row → blocked (`[]`) in all cases.
- UPDATE / DELETE another user's `readingList` row → both silently matched zero rows (RLS-filtered
  before the write), verified by re-checking as the actual owner that nothing changed.
- INSERT into `readingList` with someone else's `userId` (impersonation) → explicitly rejected,
  403, "new row violates row-level security policy."
- UPDATE another user's `users` profile row → blocked (`[]`).
- **UPDATE OWN `users` row setting `isAdmin: true`` → SUCCEEDED.** This was the one real bug —
  see `issues-opportunities.md` #0b for the fix (`migration_10_protect_admin_flag.sql`, a
  `BEFORE UPDATE` trigger). Re-tested after the fix: identical request now correctly leaves
  `isAdmin` at `false`; normal self-edits (displayName etc.) still work.

All test accounts/rows were cleaned up (deleted) after testing, including reverting the `isAdmin`
escalation before deleting the row. **Not cleaned up**: the two `auth.users` entries themselves
(`selida.rls.test.a@mailinator.com` / `...b@mailinator.com`) — deleting an auth user needs the
service_role key, which this tool doesn't have; flagged to the user to remove via Dashboard →
Authentication → Users whenever convenient. Harmless either way — no real data attached.

**Follow-up — ran `supabase db advisors --linked --type security`** (Supabase's own linter) after
the manual audit, since manual testing can't see everything a static analysis catches. Full triage
in `issues-opportunities.md` #0c — short version: one free dashboard-toggle fix (leaked password
protection), a batch of internal-looking `SECURITY DEFINER` functions that are exposed as public
RPC endpoints and probably shouldn't be, and `create_user_profile` accepting an arbitrary `p_id`
from even anonymous callers. None of #0c is fixed yet, unlike #0b — read that section before
assuming the whole security pass is complete.
**Update 2026-09-19, later same day**: #0c WAS fixed (`migration_14_lock_down_internal_functions.sql`)
except the leaked-password-protection toggle, which turned out to be Pro-plan-gated. See
`issues-opportunities.md` #0c for the current, accurate status — this paragraph is left as-written
to show the audit's original findings; don't take "None of #0c is fixed yet" above at face value.

---

## Play Store Deployment (started 2026-09-21)

### First preview build crashed on launch — NoSuchMethodError (fixed 2026-09-21)
Root cause: `expo-localization` was declared `"^56.0.6"` in package.json — a real, published,
completely unrelated-to-SDK version that npm happily resolved, vs. the `~17.0.9` Expo SDK 54
actually expects (per `expo-doctor`, which is authoritative here). A native module compiled
against that mismatched surface throws `NoSuchMethodError` at registration time on boot.
**This is invisible in `expo start`/Expo Go dev** — Expo Go ships its own precompiled native
modules and only reads the JS side from `node_modules`, so a broken native package version never
actually gets compiled until a real EAS/prebuild happens. First time this app's real native code
ran was this preview build, so first time this could have surfaced.
Also found + fixed same pass: `expo-web-browser` had two different versions in the dependency
tree (expo-doctor explicitly warns this causes native build errors), deduped via `npx expo install
--fix` along with several other Expo-managed packages that had drifted a patch/two behind SDK 54.
**Lesson for next time a crash-on-launch-only-in-a-real-build is reported**: run
`npx expo-doctor` first — it directly diffs installed vs. SDK-expected native package versions and
would have caught this before ever needing a device/logcat. Don't hand-edit Expo-managed package
versions; use `npx expo install --fix`, which won't touch anything outside Expo's own
compatibility table.
One remaining expo-doctor flag (`@types/react-native` installed directly) is types-only, zero
native code, cannot cause a runtime crash — left as optional cleanup, not mixed into this fix.
**A fresh `eas build` is required** — this fix cannot take effect on an already-built APK.

### Pre-build exposure audit (2026-09-21) — found & fixed a catalog-wipe vulnerability
Asked to cross-check before running `eas build`. Found something unrelated to build config: the
`books` and `ingestion_cursor` RLS policies let ANY signed-up user modify/delete ANY row via a
plain REST call — confirmed live with two disposable throwaway accounts (not just read from
policy text). Fixed in `sql/migration_17_lock_down_books_and_cursor.sql` + an `isAdmin` gate added
to `app/catalog-ingestion.tsx`. Full detail, what's fixed vs. deliberately left open (books
INSERT/UPDATE, the biblionet-proxy quota-exhaustion vector), in `issues-opportunities.md` → 0k.
**Read that before touching `books` RLS or the catalog-ingestion screen again.**

### Current state, verified live (not assumed)
- **Privacy policy is live**: `https://pangkratis.github.io/selida/privacy.html` (HTTP 200,
  confirmed via curl) — GitHub Pages, no workflow file needed (repo-settings "deploy from
  branch"). This is the URL to paste into Play Console's store listing.
- **App icons**: all present and correctly sized — `icon.png` 1024×1024, Android adaptive icon
  layers (foreground/background/monochrome) at 512×512/512×512/432×432, favicon 48×48.
- **Package identity**: `com.selida.app`, consistent iOS/Android, set in `app.json`.
- **No Google Sign-In complication**: `plugins` has a commented-out `withGoogleSignInAndroid`
  entry with zero live call sites (grepped `app/`, `services/`, `components/` — nothing). Dead,
  not integrated. No OAuth consent screen / SHA fingerprint step needed unless this gets revived.
- **No explicit `android.permissions`** in app.json — matches the privacy policy's claim of no
  camera/location/contacts access. Don't add permissions without updating that policy to match.
- **Managed workflow**: `android/` and `ios/` folders exist locally (from a prior `expo prebuild`)
  but are gitignored — not committed, regenerated on demand. Not bare workflow.
- **`eas.json` added 2026-09-21** — `preview` profile (internal APK) + `production` profile
  (app-bundle/AAB, required format for Play Store, `autoIncrement: true` for versionCode via
  `appVersionSource: "remote"` rather than hand-tracking it in app.json). No `development`
  profile — deliberately, since this project runs via plain Expo Go, not `expo-dev-client`
  (`MEMORY.md` note); adding a dev-client profile would need that package installed first.
- **EAS CLI logged in** as `pangkratis` (confirmed via `eas whoami`).
- **`eas init` DONE (2026-09-21)** — run by the user in their own terminal (needed an interactive
  y/n this sandbox couldn't answer). Created `@pangkratis/selida` on EAS, ID
  `af95d387-1b99-419d-b344-16a2bc746230`. Wrote `extra.eas.projectId` + `owner: "pangkratis"` into
  `app.json` automatically — verified against `eas project:info`, matches. `eas build`/
  `eas submit` are now unblocked.
- **Found + fixed while running `eas init`**: `app.json` was NOT actually strict JSON — it had
  two trailing commas (after `ios.bundleIdentifier` and `android.package`) and two `//` comment
  lines in `plugins`. `npx expo config` tolerated this silently (its loader is more permissive),
  which is why the earlier deployment-readiness check missed it — only `eas init`'s stricter
  `JSON.parse` surfaced it ("Expected double-quoted property name in JSON"). Fixed by removing
  the trailing commas and dropping the two comment lines (both inert — no live
  `withGoogleSignInAndroid` call sites, and `expo-router` is auto-detected from the entry point
  in SDK 54, doesn't need listing). **Lesson: `npx expo config` resolving cleanly does NOT mean
  `app.json` is valid JSON — check both if this file is hand-edited again.**

### What's still Play-Console-side (needs the user directly, not code)
- Google Play Console developer account ($25 one-time, their payment/identity — can't be done
  from here).
- **Data safety form** — must match `docs/privacy.html` exactly (account info, reading activity,
  search terms + result counts, anonymous usage/diagnostics data added 2026-09-21). Draft this
  together once the console is open; getting it wrong is a common rejection reason.
- Store listing assets: feature graphic (1024×500), phone screenshots, short/full description,
  IARC content rating questionnaire.
- **Google's closed-testing requirement**: new apps need ≥12 testers for 14 days in closed
  testing before production release is allowed — confirmed current policy, not optional. Adds
  ~2 weeks to the timeline regardless of code readiness; plan around this, don't discover it late.

### Order of operations from here
1. `eas build --profile production --platform android` (or `preview` first for a sideload-test
   APK before committing to a store-bound AAB) — unblocked now that `eas init` is done
2. Play Console: create app, fill data safety form + listing content, start closed testing
3. After 14 days + 12 testers: promote to production, or `eas submit --platform android` if a
   Play Console API service-account key is set up for automated submission
