# Analytics queries

Read-only queries against the three insert-only tables (`appEvents`,
`errorLogs`, `userActivity`). The app itself cannot read these — they have no
SELECT policy on purpose — so this is how you look at them.

## Running one

Either paste the file's contents into the Supabase dashboard → SQL Editor →
Run, or from the project root:

```
supabase db query --linked -f sql/analytics/signup-funnel.sql
```

**One statement per file, deliberately.** `supabase db query` returns only the
last statement's rows, so a file with two queries silently hides the first.

## The four

| File | Answers | Read it when |
|---|---|---|
| `signup-funnel.sql` | How many new people reach a finished account, and which screen loses the rest | Daily during launch week |
| `zero-result-searches.sql` | What people search for that the catalog doesn't have | Weekly — it's a catalog to-do list |
| `errors-by-context.sql` | What's breaking, for how many people | Daily during launch week |
| `retention.sql` | Whether anyone comes back | Weekly; needs 7+ days of data to mean anything |

## Before you trust a number

Each file has a comment block naming its own caveats. The three that bite hardest:

- **The funnel counts new devices only.** Without that restriction every
  existing user inflates the top of the funnel. This is the thing you'd forget
  if you retyped the query by hand, which is most of why these files exist.
- **`app_open` events start 2026-09-21.** Any retention cohort older than that
  shows 0 returns because the events didn't exist, not because people left.
- **Error coverage is partial.** Only call sites using `logError` reach
  `errorLogs`; anything still on a bare `console.error` is invisible, so an
  empty result does not mean nothing is failing.

## Adding more

Keep the pattern: one statement, a comment block at the top saying what it
answers *and what it deliberately excludes*. The second half is the part that
stops a query being misread six weeks later.
