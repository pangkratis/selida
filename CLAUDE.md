# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Selida is a book discovery and reading tracker mobile app built with React Native and Expo. It uses Supabase (Auth, PostgreSQL) as its backend. The app lets users browse/search books, track reading progress with timed sessions, and get personalized recommendations.

## Commands

- `npx expo start` — start the Expo dev server
- `expo run:ios` / `expo run:android` — run native builds
- `npx expo start --web` — run web version
- `npx expo lint` — lint with ESLint (flat config, `eslint-config-expo`)

No test framework is currently configured.

## Architecture

### Routing (Expo Router, file-based)

- `app/_layout.tsx` — Root layout. Wraps everything in `SessionProvider`, handles auth redirects (unauthenticated users go to `(auth)/login`, authenticated users away from auth screens).
- `app/(auth)/` — Login and signup screens.
- `app/(tabs)/` — Main tab navigator with three tabs: Home (`index`), Explore (`explore`), Profile (`profile`).
- `app/book-details.tsx` — Form sheet modal for book details (receives book as JSON param).
- `app/book-list.tsx`, `app/books-grid.tsx` — List/grid views for book collections (receives mode/type/query params).

### Auth & Session (React Context)

- `app/ctx.tsx` — `SessionProvider` and `useSession()` hook. Listens to Supabase `onAuthStateChange`, persists session token via `useStorageState`, and subscribes to the user's row in the `users` table via Supabase Realtime for real-time `AppUser` data.
- Session state is stored in `expo-secure-store` via `hooks/use-storage-state.ts`.

### Supabase / Data Layer

- `services/supabaseConfig.ts` — Supabase client init, exports `supabase` singleton.
- `services/bookStats.ts` — Tracks book view counts and reading status stats in `bookStats` table via RPC functions.
- `services/recommendations.ts` — Personalized recommendation engine. Analyzes user's `readingList` table to find preferred categories/authors/tags, queries candidate books, scores them with popularity + preference matching, applies author diversity. Falls back to trending books.
- `services/readingSessions.ts` — Start/stop reading sessions with ISO timestamps, calculates progress (1 min/page assumption), writes session history to `readingSessions` table.
- `services/userActivity.ts` — Logs user actions (view_details, add_to_wishlist, etc.) to `userActivity` table.

### Supabase Tables

- `users` — User profile (displayName, language, country, catalogPreference, stats jsonb).
- `readingList` — User's books with status (wishlist/reading/completed), progress, session data. Unique on (userId, bookId).
- `books` — Book catalog (title, authors, categories, coverUrl, searchTags, pageCount, biblionetId, syncedSub, subcategories, etc.).
- `bookStats` — Aggregated stats (views, reading/completed/wishlist counts).
- `readingSessions` — Session history rows.
- `userActivity` — User action logs.
- `feedback` — User feedback submissions.

### Theming

- `constants/theme.ts` — Full light/dark theme with `Colors`, `AccentPalette`, `Spacing`, `BorderRadius`, `Fonts`. Screens access theme via `useColorScheme()` hook + `Colors[colorScheme]`.
- `AccentPalette` is a 5-color array cycled across cards/sections for visual variety.
- Screens inline styles rather than using a global stylesheet — theme colors are applied dynamically via `style` arrays.

### Path Aliases

- `@/*` maps to project root (configured in `tsconfig.json`). Use `@/components/...`, `@/services/...`, `@/constants/...`, `@/hooks/...`.

### Key Conventions

- TypeScript with `strict: true`. React Compiler and typed routes are enabled (`app.json` experiments).
- New Architecture enabled (`newArchEnabled: true`).
- File naming: kebab-case for all files (e.g., `horizontal-book-shelf.tsx`, `use-color-scheme.ts`).
- Books are passed between screens as `JSON.stringify(book)` in route params.
- `Book` type defined in `constants/types.ts`.

## Memory & Knowledge Management

These are mandatory rules, not suggestions.

### Before starting any non-trivial task
Always read the relevant memory files before acting:
- `MEMORY.md` — always read first for project context, architecture, and conventions
- `.claude/memory/project-state.md` — read before touching any screen or service (understand current state before proposing changes)
- `.claude/memory/issues-opportunities.md` — read before suggesting improvements or fixes (avoid re-suggesting already noted or fixed items)

### After completing any feature, bug fix, or structural change
Update memory files before considering the task done:
- `MEMORY.md` — update any section that reflects the changed architecture, patterns, or known issues
- `.claude/memory/project-state.md` — update the affected screen(s) and service(s) with new status
- `.claude/memory/issues-opportunities.md` — mark fixed items as fixed, add newly discovered issues

This must happen without the user asking. Completing code without updating memory is an incomplete task.
