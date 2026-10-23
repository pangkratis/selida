// Automatic subcategory sync — the server-side twin of the admin screen's
// "Sync subcategories" button (services/catalog-ingestion.ts).
//
// Called by pg_cron every few minutes (see sql/migration_30_subsync_automation.sql),
// never by the app. Each call syncs a small batch inside a time budget (Biblionet
// answers in ~5 s per book), counts its requests against a per-day budget kept in
// `subsync_state`, and pauses itself for a few hours when Biblionet keeps failing
// (assumed daily quota).
//
// Auth: a shared secret in the `x-cron-secret` header (deployed with
// --no-verify-jwt, so this check is the only gate).
//
// Secrets: SUBSYNC_CRON_SECRET (set by hand), BIBLIONET_USERNAME / BIBLIONET_PASSWORD
// (already set for biblionet-proxy). SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
// injected automatically.
//
// Test run:  curl -X POST <url> -H "x-cron-secret: ..." -d '{"wait":true,"maxBooks":3}'

import { createClient } from 'npm:@supabase/supabase-js@2';

const BIBLIONET_URL = 'https://biblionet.gr/webservice/get_title_subject';
const MAX_BOOKS_PER_RUN = 60;
const TIME_BUDGET_MS = 100_000;
const FETCH_TIMEOUT_MS = 20_000;
const ATTEMPTS = 2;
const RETRY_DELAY_MS = 2_000;
const MAX_CONSECUTIVE_FAILURES = 3;

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

type Fetched = { ok: true; data: unknown; attempts: number } | { ok: false; attempts: number; why: string };

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchSubjects(username: string, password: string, biblionetId: string): Promise<Fetched> {
  let why = 'unknown';
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(BIBLIONET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username, password, title: biblionetId }).toString(),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.ok) {
        try {
          return { ok: true, data: JSON.parse(await res.text()), attempts: attempt };
        } catch {
          why = 'response was not JSON';
        }
      } else {
        why = `HTTP ${res.status}`;
      }
    } catch (e) {
      why = e instanceof Error ? e.message : String(e);
    }
    if (attempt < ATTEMPTS) await sleep(RETRY_DELAY_MS);
  }
  return { ok: false, attempts: ATTEMPTS, why };
}

// Same parsing as syncSubcategories() in the app: a book with no subjects comes
// back as an HTTP 200 error object and ends up as an empty list.
function parseSubcategories(data: unknown): string[] {
  const subjects: any[] = Array.isArray(data) ? data.flat() : [];
  return subjects.flatMap(s =>
    String(s?.SubjectTitle ?? '').split(' - ').map(p => p.trim()).filter(Boolean),
  );
}

type Summary = { skipped?: string; synced: number; requests: number; stopped: boolean; note: string };

async function run(maxBooks: number): Promise<Summary> {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const username = Deno.env.get('BIBLIONET_USERNAME');
  const password = Deno.env.get('BIBLIONET_PASSWORD');
  if (!username || !password) {
    return { skipped: 'Biblionet credentials not set', synced: 0, requests: 0, stopped: false, note: 'misconfigured' };
  }

  const { data: allowed, error: beginError } = await admin.rpc('fn_subsync_begin', { p_max: maxBooks });
  if (beginError) throw beginError;
  if (!allowed || allowed <= 0) {
    return { skipped: 'nothing to do (disabled, paused, running, or daily budget used)', synced: 0, requests: 0, stopped: false, note: 'skipped' };
  }

  let synced = 0;
  let requests = 0;
  let consecutiveFailures = 0;
  let stopped = false;
  let note = '';
  try {
    const { data: books, error } = await admin.rpc('fn_subsync_next_batch', { p_limit: allowed });
    if (error) throw error;

    const started = Date.now();
    for (const book of (books ?? []) as { id: string; biblionetId: string; title: string }[]) {
      if (Date.now() - started > TIME_BUDGET_MS) break;

      const result = await fetchSubjects(username, password, String(book.biblionetId));
      requests += result.attempts;

      if (!result.ok) {
        consecutiveFailures++;
        note = `last failure: ${result.why}`;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          stopped = true;
          break;
        }
        continue;
      }
      consecutiveFailures = 0;

      const { error: updateError } = await admin
        .from('books')
        .update({ subcategories: parseSubcategories(result.data), syncedSub: true })
        .eq('id', book.id);
      if (updateError) {
        console.error('[sync-subcategories] update failed for', book.id, updateError);
        note = `update failed: ${updateError.message}`;
        continue;
      }
      synced++;
    }
    note = stopped
      ? `stopped after ${MAX_CONSECUTIVE_FAILURES} failures in a row (${note}); pausing`
      : `ok: synced ${synced}${note ? `; ${note}` : ''}`;
  } catch (e) {
    note = `error: ${e instanceof Error ? e.message : String(e)}`;
    console.error('[sync-subcategories]', e);
  } finally {
    // Always release the run lock, even after an error.
    await admin.rpc('fn_subsync_end', { p_requests: requests, p_synced: synced, p_stopped: stopped, p_note: note.slice(0, 300) });
  }
  return { synced, requests, stopped, note };
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }
  const secret = Deno.env.get('SUBSYNC_CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  let body: { wait?: boolean; maxBooks?: number } = {};
  try {
    body = await req.json();
  } catch {
    // no body is fine
  }
  const maxBooks = Math.min(Math.max(Number(body.maxBooks) || MAX_BOOKS_PER_RUN, 1), MAX_BOOKS_PER_RUN);
  const job = run(maxBooks).catch(e => {
    console.error('[sync-subcategories] run failed', e);
    return { synced: 0, requests: 0, stopped: false, note: 'run failed' } as Summary;
  });

  // Normal (cron) calls get an immediate 202 and the work continues in the
  // background, so the scheduler's short HTTP timeout cannot cut it off.
  if (!body.wait && typeof EdgeRuntime !== 'undefined') {
    EdgeRuntime.waitUntil(job);
    return new Response(JSON.stringify({ accepted: true }), { status: 202 });
  }
  return new Response(JSON.stringify(await job), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
