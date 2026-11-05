// Monthly catalog ingestion — adds new Biblionet books month by month.
//
// Called by pg_cron every 10 minutes while a month is queued in `ingest_months`
// (see sql/migration_38_monthly_ingestion.sql), never by the app. Each call
// reads a few pages of get_month_titles (100 books, ~8 s each) inside a time
// budget and a daily request budget kept in `ingest_state`, and inserts only
// books that are not in the catalog yet (matched on biblionetId). Existing
// rows are never touched.
//
// Same rules as the manual crawl (services/catalog-ingestion.ts): a book needs a
// real cover (not Biblionet's blank placeholder), a Biblionet id and a summary to be saved, and the mapping is the same.
//
// Auth: shared secret in `x-cron-secret` (deployed with --no-verify-jwt).
// Secrets: INGEST_CRON_SECRET, BIBLIONET_USERNAME / BIBLIONET_PASSWORD.
// Test run:  curl -X POST <url> -H "x-cron-secret: ..." -d '{"wait":true,"maxPages":1}'

import { createClient } from 'npm:@supabase/supabase-js@2';

const BIBLIONET_URL = 'https://biblionet.gr/webservice/get_month_titles';
const COVER_BASE = 'https://www.biblionet.gr';
const PER_PAGE = 100;
// Biblionet's stand-in for "no cover" (/assets/images/placeholders/blank_page_cover.jpg).
const isBlankCover = (path: unknown) => String(path ?? '').includes('/placeholders/');
const MAX_PAGES_PER_RUN = 10;
const TIME_BUDGET_MS = 110_000;
const FETCH_TIMEOUT_MS = 40_000;
const ATTEMPTS = 2;
const RETRY_DELAY_MS = 3_000;

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

type Fetched = { ok: true; items: any[]; attempts: number } | { ok: false; attempts: number; why: string };

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchPage(username: string, password: string, year: number, month: number, page: number): Promise<Fetched> {
  let why = 'unknown';
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(BIBLIONET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          username, password,
          year: String(year), month: String(month),
          titles_per_page: String(PER_PAGE), page: String(page),
        }).toString(),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.ok) {
        let data: any;
        try {
          data = JSON.parse(await res.text());
        } catch {
          why = 'response was not JSON';
          data = undefined;
        }
        if (data !== undefined) {
          // A page of books is [[...]]; past the last page Biblionet answers with
          // an error object instead of an empty list.
          const list = Array.isArray(data) ? data.flat() : [];
          return { ok: true, items: list.filter(x => x && typeof x === 'object' && x.TitlesID), attempts: attempt };
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

// Same mapping as mapItem() in services/catalog-ingestion.ts.
function mapItem(item: any): Record<string, unknown> {
  return {
    title: item.Title ?? 'Unknown',
    subtitle: item.Subtitle ?? '',
    authors: item.Writer ? [item.Writer] : [],
    coverUrl: item.CoverImage ? `${COVER_BASE}${item.CoverImage}` : null,
    isbn: item.ISBN ?? null,
    publishedYear: item.CurrentPublishDate ? String(item.CurrentPublishDate).substring(0, 4) : null,
    language: item.Language ?? 'ελληνικά',
    description: item.Summary ?? '',
    categories: item.Category ? [item.Category] : [],
    pageCount: parseInt(item.PageNo, 10) || null,
    publisher: item.Publisher ?? '',
    series: item.Series ?? '',
    subSeries: item.SubSeries ?? '',
    price: item.Price !== '' && item.Price != null ? item.Price : null,
    availability: item.Availability ?? '',
    biblionetId: String(item.TitlesID),
    syncedSub: false,
    source: 'biblionet',
    popularityCount: 0,
    isActive: true,
  };
}

type Summary = { skipped?: string; pages: number; added: number; requests: number; stopped: boolean; note: string };

async function run(maxPages: number): Promise<Summary> {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const username = Deno.env.get('BIBLIONET_USERNAME');
  const password = Deno.env.get('BIBLIONET_PASSWORD');
  if (!username || !password) {
    return { skipped: 'Biblionet credentials not set', pages: 0, added: 0, requests: 0, stopped: false, note: 'misconfigured' };
  }

  const { data: allowed, error: beginError } = await admin.rpc('fn_ingest_begin', { p_max: maxPages });
  if (beginError) throw beginError;
  if (!allowed || allowed <= 0) {
    return { skipped: 'nothing to do (disabled, paused, running, budget used, or nothing queued)', pages: 0, added: 0, requests: 0, stopped: false, note: 'skipped' };
  }

  let pages = 0;
  let added = 0;
  let requests = 0;
  let stopped = false;
  const done: string[] = [];
  let note = '';
  try {
    const started = Date.now();
    while (requests < allowed && Date.now() - started < TIME_BUDGET_MS) {
      const { data: next, error: nextError } = await admin.rpc('fn_ingest_next_month');
      if (nextError) throw nextError;
      const target = (next ?? [])[0] as { year: number; month: number; next_page: number } | undefined;
      if (!target) break;

      const { year, month, next_page: page } = target;
      const result = await fetchPage(username, password, year, month, page);
      requests += result.attempts;
      if (!result.ok) {
        stopped = true;
        note = `${year}/${month} p${page} failed: ${result.why}`;
        break;
      }
      pages++;

      const items = result.items;
      const saveable = items.filter(i => i.CoverImage && !isBlankCover(i.CoverImage) && i.TitlesID && i.Summary);
      let pageAdded = 0;
      if (saveable.length > 0) {
        // Insert only what is new; rows already in the catalog are left alone.
        const { data: inserted, error: insertError } = await admin
          .from('books')
          .upsert(saveable.map(mapItem), { onConflict: 'biblionetId', ignoreDuplicates: true })
          .select('id');
        if (insertError) throw insertError;
        pageAdded = inserted?.length ?? 0;
      }
      added += pageAdded;

      const finished = items.length < PER_PAGE;
      const { error: progressError } = await admin.rpc('fn_ingest_page_done', {
        p_year: year, p_month: month, p_page: page,
        p_found: items.length, p_added: pageAdded,
        p_already: saveable.length - pageAdded, p_skipped: items.length - saveable.length,
        p_finished: finished,
      });
      if (progressError) throw progressError;
      if (finished) done.push(`${year}/${String(month).padStart(2, '0')}`);
    }
    if (!stopped) {
      note = `ok: ${pages} pages, ${added} new books${done.length ? `; finished ${done.join(', ')}` : ''}`;
    } else {
      note = `${note}; pausing (${added} new books before that)`;
    }
  } catch (e) {
    note = `error: ${e instanceof Error ? e.message : JSON.stringify(e)}`;
    console.error('[ingest-month]', e);
  } finally {
    await admin.rpc('fn_ingest_end', { p_requests: requests, p_stopped: stopped, p_note: note.slice(0, 300) });
  }
  return { pages, added, requests, stopped, note };
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }
  const secret = Deno.env.get('INGEST_CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  let body: { wait?: boolean; maxPages?: number } = {};
  try {
    body = await req.json();
  } catch {
    // no body is fine
  }
  const maxPages = Math.min(Math.max(Number(body.maxPages) || MAX_PAGES_PER_RUN, 1), MAX_PAGES_PER_RUN);
  const job = run(maxPages).catch(e => {
    console.error('[ingest-month] run failed', e);
    return { pages: 0, added: 0, requests: 0, stopped: false, note: 'run failed' } as Summary;
  });

  // Cron calls get an immediate 202; the work continues in the background.
  if (!body.wait && typeof EdgeRuntime !== 'undefined') {
    EdgeRuntime.waitUntil(job);
    return new Response(JSON.stringify({ accepted: true }), { status: 202 });
  }
  return new Response(JSON.stringify(await job), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
