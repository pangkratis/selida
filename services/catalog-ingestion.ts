/**
 * DEV-ONLY catalog ingestion service.
 * Crawls the Biblionet webservice by year/month/page and writes books to Supabase.
 * The cursor (year/month/page) persists in the `ingestion_cursor` table — a
 * single row, so progress is visible from anywhere (e.g. the Supabase
 * dashboard), not just from the one device that last ran it.
 * Uses Supabase upsert so 100 books = 1 round-trip.
 * Guarded by __DEV__ — never runs in production builds.
 *
 * NOTE: console.* here is intentional and was deliberately left out of the
 * services/errorLog sweep. This file only ever runs in development, and it
 * loops over thousands of books — routing its failures into `errorLogs`
 * would flood the table and burn the reporter's per-launch cap on admin
 * ingestion noise, hiding real user-facing errors. The admin screen already
 * surfaces these in its own on-screen log.
 */

import { supabase } from './supabaseConfig';

/* ── Config ──────────────────────────────────────────────────────── */

// Biblionet's account-level quota is 1000 requests/day (resets daily, per
// the user — not in the public API docs). This is 100 short of that,
// leaving headroom for the same day's catalog ingestion crawl and any
// live user searches, which share the same quota.
const SUB_BATCH = 900;
const COVER_BASE = 'https://www.biblionet.gr';
const PER_PAGE = 100;

// No hardcoded year floor — the crawl goes back as far as Biblionet still
// has books. Stops once this many consecutive MONTHS (not pages — a
// month with several pages of books naturally ends on one empty page,
// that's not "no books," just pagination finishing) come back completely
// empty, which is the actual signal that we've walked past the start of
// Biblionet's catalog rather than just hit one unusually quiet month.
const MAX_CONSECUTIVE_EMPTY_MONTHS = 6;

const CURSOR_ROW_ID = 'catalog';
const START_CURSOR = { year: 2026, month: 4, page: 1, consecutiveEmptyMonths: 0 };

/* ── Cursor helpers ──────────────────────────────────────────────── */

interface Cursor { year: number; month: number; page: number; consecutiveEmptyMonths: number; }

async function getCursor(): Promise<Cursor> {
    const { data } = await supabase
        .from('ingestion_cursor')
        .select('year, month, page, consecutiveEmptyMonths')
        .eq('id', CURSOR_ROW_ID)
        .maybeSingle();
    return data
        ? { year: data.year, month: data.month, page: data.page, consecutiveEmptyMonths: data.consecutiveEmptyMonths ?? 0 }
        : { ...START_CURSOR };
}

async function saveCursor(c: Cursor): Promise<void> {
    await supabase.from('ingestion_cursor').upsert(
        {
            id: CURSOR_ROW_ID,
            year: c.year,
            month: c.month,
            page: c.page,
            consecutiveEmptyMonths: c.consecutiveEmptyMonths,
            updatedAt: new Date().toISOString(),
        },
        { onConflict: 'id' }
    );
}

async function clearCursor(): Promise<void> {
    await supabase.from('ingestion_cursor').delete().eq('id', CURSOR_ROW_ID);
}

function advance(c: Cursor, hasResults: boolean): Cursor | null {
    if (hasResults) return { ...c, page: c.page + 1, consecutiveEmptyMonths: 0 };

    // Only a page-1 miss means the WHOLE month was empty — a trailing
    // empty page after a month that did have books doesn't count.
    const monthWasEmpty = c.page === 1;
    const consecutiveEmptyMonths = monthWasEmpty ? c.consecutiveEmptyMonths + 1 : c.consecutiveEmptyMonths;
    if (consecutiveEmptyMonths >= MAX_CONSECUTIVE_EMPTY_MONTHS) return null;

    let { year, month } = c;
    month -= 1;
    if (month < 1) { month = 12; year -= 1; }
    return { year, month, page: 1, consecutiveEmptyMonths };
}

/* ── API fetch ───────────────────────────────────────────────────── */

async function fetchTitles(cursor: Cursor): Promise<any[]> {
    const { data, error } = await supabase.functions.invoke('biblionet-proxy', {
        body: {
            endpoint: 'get_month_titles',
            params: {
                year: String(cursor.year),
                month: String(cursor.month),
                titles_per_page: String(PER_PAGE),
                page: String(cursor.page),
            },
        },
    });
    if (error) {
        console.warn(`[Ingestion] proxy error for ${cursor.year}/${cursor.month} p${cursor.page}`, error);
        return [];
    }

    const firstKey = Object.keys(data)[0];
    const raw = data.book_titles ?? data.book ?? data.titles ?? data.Books ?? data[firstKey] ?? [];
    const items = Array.isArray(raw) ? raw : [];
    if (items.length > 0) {
        console.log('[Ingestion] First item keys:', Object.keys(items[0]));
        console.log('[Ingestion] First item raw:', JSON.stringify(items[0], null, 2));
    }
    return items;
}

/* ── Mapping ─────────────────────────────────────────────────────── */

function mapItem(item: any): Record<string, any> {
    const authors: string[] = item.Writer ? [item.Writer] : [];
    const categories: string[] = item.Category ? [item.Category] : [];
    const title: string = item.Title ?? 'Unknown';
    return {
        title,
        subtitle: item.Subtitle ?? '',
        authors,
        coverUrl: item.CoverImage ? `${COVER_BASE}${item.CoverImage}` : null,
        isbn: item.ISBN ?? null,
        publishedYear: item.CurrentPublishDate ? item.CurrentPublishDate.substring(0, 4) : null,
        language: item.Language ?? 'ελληνικά',
        description: item.Summary ?? '',
        categories,
        pageCount: parseInt(item.PageNo, 10) || null,
        publisher: item.Publisher ?? '',
        series: item.Series ?? '',
        subSeries: item.SubSeries ?? '',
        price: item.Price !== '' && item.Price != null ? item.Price : null,
        availability: item.Availability ?? '',
        biblionetId: item.TitlesID ?? null,
        syncedSub: false,
        source: 'biblionet',
        popularityCount: 0,
        isActive: true,
        // search_text is populated automatically by the DB trigger (fn_books_search_text)
    };
}

/* ── Main entry point ────────────────────────────────────────────── */

export interface IngestionResult {
    cursor: Cursor;
    count: number;
    newCount: number;
    updatedCount: number;
    next: Cursor | null;
    done: boolean;
    error?: string;
}

export async function readCursor(): Promise<Cursor> {
    return getCursor();
}

export async function resetCursor(): Promise<void> {
    await saveCursor({ ...START_CURSOR });
}

export async function runCatalogIngestion(): Promise<IngestionResult | null> {
    if (!__DEV__) return null;

    const cursor = await getCursor();
    console.log(`[Ingestion] ${cursor.year}/${String(cursor.month).padStart(2, '0')} — page ${cursor.page}`);

    try {
        const items = await fetchTitles(cursor);
        console.log(`[Ingestion] Got ${items.length} titles`);

        const saveable = items.filter(item => !!item.CoverImage && !!item.TitlesID && !!item.Writer && !!item.Summary);
        console.log(`[Ingestion] ${saveable.length}/${items.length} have cover + TitlesID + author + description`);

        let newCount = 0;
        let updatedCount = 0;

        if (saveable.length > 0) {
            const biblionetIds = saveable.map(item => String(item.TitlesID));
            const { data: existing } = await supabase
                .from('books')
                .select('biblionetId')
                .in('biblionetId', biblionetIds);
            const existingIds = new Set((existing ?? []).map((r: any) => String(r.biblionetId)));
            newCount = biblionetIds.filter(id => !existingIds.has(id)).length;
            updatedCount = saveable.length - newCount;

            const rows = saveable.map(mapItem);
            const { error } = await supabase.from('books').upsert(rows, { onConflict: 'biblionetId' });
            if (error) console.error('[Ingestion] Supabase upsert error:', error);
            else console.log(`[Ingestion] Saved ${saveable.length} books to Supabase (${newCount} new, ${updatedCount} already known)`);
        }

        const next = advance(cursor, items.length > 0);
        if (next) {
            await saveCursor(next);
        } else {
            console.log('[Ingestion] Reached end of catalog — clearing cursor');
            await clearCursor();
        }

        return { cursor, count: saveable.length, newCount, updatedCount, next, done: next === null };
    } catch (err) {
        console.error('[Ingestion] Error:', err);
        return { cursor, count: 0, newCount: 0, updatedCount: 0, next: cursor, done: false, error: String(err) };
    }
}

export interface SubSyncResult {
    synced: number;
    remaining: number;
    error?: string;
    stoppedEarly?: boolean;
}

// Consecutive (not total) failures before assuming something systemic is
// wrong — most likely today's Biblionet request quota has been hit
// partway through the batch — rather than blindly burning through the
// rest of SUB_BATCH on doomed requests.
const MAX_CONSECUTIVE_FAILURES = 5;

export async function syncSubcategories(): Promise<SubSyncResult | null> {
    if (!__DEV__) return null;

    try {
        const { data: books, error: fetchError } = await supabase
            .from('books')
            .select('id, biblionetId, title')
            .eq('syncedSub', false)
            .not('biblionetId', 'is', null)
            .order('popularityCount', { ascending: false })
            .limit(SUB_BATCH);

        if (fetchError) throw fetchError;
        if (!books || books.length === 0) return { synced: 0, remaining: 0 };

        let synced = 0;
        let consecutiveFailures = 0;
        let stoppedEarly = false;

        for (const book of books) {
            try {
                const { data, error: proxyError } = await supabase.functions.invoke('biblionet-proxy', {
                    body: { endpoint: 'get_title_subject', params: { title: String(book.biblionetId) } },
                });

                if (proxyError) {
                    console.warn(`[SubSync] proxy error for biblionetId ${book.biblionetId}`, proxyError);
                    consecutiveFailures++;
                    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                        console.warn(`[SubSync] ${MAX_CONSECUTIVE_FAILURES} consecutive failures — stopping early, likely hit today's rate limit`);
                        stoppedEarly = true;
                        break;
                    }
                    continue;
                }

                consecutiveFailures = 0;
                console.log(`[SubSync] Raw response for biblionetId ${book.biblionetId}:`, JSON.stringify(data, null, 2));
                const subjects: any[] = Array.isArray(data) ? data.flat() : [];
                const subcategories: string[] = subjects
                    .flatMap((s: any) =>
                        (s.SubjectTitle ?? '').split(' - ').map((p: string) => p.trim()).filter(Boolean)
                    );

                const { error: updateError } = await supabase
                    .from('books')
                    .update({ subcategories, syncedSub: true })
                    .eq('id', book.id);

                if (updateError) {
                    console.error(`[SubSync] Update error for ${book.biblionetId}:`, updateError);
                } else {
                    console.log(`[SubSync] "${book.title}" → ${subcategories.length} subjects`);
                    synced++;
                }
            } catch (err) {
                console.error(`[SubSync] Error for biblionetId ${book.biblionetId}:`, err);
                consecutiveFailures++;
                if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                    console.warn(`[SubSync] ${MAX_CONSECUTIVE_FAILURES} consecutive failures — stopping early, likely hit today's rate limit`);
                    stoppedEarly = true;
                    break;
                }
            }
        }

        const { count } = await supabase
            .from('books')
            .select('*', { count: 'exact', head: true })
            .eq('syncedSub', false);

        return { synced, remaining: count ?? 0, stoppedEarly };
    } catch (err) {
        console.error('[SubSync] Error:', err);
        return { synced: 0, remaining: 0, error: String(err) };
    }
}

export interface ContributorSyncResult {
    synced: number;
    remaining: number;
    error?: string;
    stoppedEarly?: boolean;
}

// Shares the same 1000/day Biblionet quota as SUB_BATCH's subcategory sync
// and the catalog ingestion crawl — running this the same day as either of
// those will eat into the same budget. No shared cross-feature tracker;
// left as a manual judgment call (which sync to run on a given day), same
// as ingestion and subcategory sync already coexist without one.
const CONTRIBUTOR_SYNC_BATCH = 900;

export async function syncContributors(): Promise<ContributorSyncResult | null> {
    if (!__DEV__) return null;

    try {
        const { data: books, error: fetchError } = await supabase
            .from('books')
            .select('id, biblionetId, title')
            .eq('syncedContributors', false)
            .not('biblionetId', 'is', null)
            .order('popularityCount', { ascending: false })
            .limit(CONTRIBUTOR_SYNC_BATCH);

        if (fetchError) throw fetchError;
        if (!books || books.length === 0) return { synced: 0, remaining: 0 };

        let synced = 0;
        let consecutiveFailures = 0;
        let stoppedEarly = false;

        for (const book of books) {
            try {
                const { data, error: proxyError } = await supabase.functions.invoke('biblionet-proxy', {
                    body: { endpoint: 'get_contributors', params: { title: String(book.biblionetId) } },
                });

                if (proxyError) {
                    console.warn(`[ContributorSync] proxy error for biblionetId ${book.biblionetId}`, proxyError);
                    consecutiveFailures++;
                    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                        console.warn(`[ContributorSync] ${MAX_CONSECUTIVE_FAILURES} consecutive failures — stopping early, likely hit today's rate limit`);
                        stoppedEarly = true;
                        break;
                    }
                    continue;
                }

                consecutiveFailures = 0;
                const contributorRows: any[] = Array.isArray(data) ? data.flat() : [];

                for (const row of contributorRows) {
                    const contributorBiblionetId = row.ContributorID ? String(row.ContributorID) : null;
                    const fullName = (row.ContributorFullName ?? '').trim();
                    if (!contributorBiblionetId || !fullName) continue;

                    const { data: contributor, error: contributorError } = await supabase
                        .from('contributors')
                        .upsert({ biblionetId: contributorBiblionetId, fullName }, { onConflict: 'biblionetId' })
                        .select('id')
                        .single();

                    if (contributorError || !contributor) {
                        console.error(`[ContributorSync] Error upserting contributor ${contributorBiblionetId}:`, contributorError);
                        continue;
                    }

                    // Coalesce a missing type to 0 rather than null — Postgres
                    // treats NULL as distinct from itself in unique
                    // constraints, which would let a re-sync create duplicate
                    // links for a contributor with an unlisted role.
                    const { error: linkError } = await supabase
                        .from('book_contributors')
                        .upsert(
                            {
                                book_id: book.id,
                                contributor_id: contributor.id,
                                contributorTypeId: row.ContributorTypeID ? parseInt(row.ContributorTypeID, 10) : 0,
                                contributorType: row.ContributorType ?? null,
                                presentOrder: row.PresentOrder ? parseInt(row.PresentOrder, 10) : null,
                            },
                            { onConflict: 'book_id,contributor_id,contributorTypeId' }
                        );

                    if (linkError) {
                        console.error(`[ContributorSync] Error linking contributor ${contributorBiblionetId} to book ${book.id}:`, linkError);
                    }
                }

                const { error: updateError } = await supabase
                    .from('books')
                    .update({ syncedContributors: true })
                    .eq('id', book.id);

                if (updateError) {
                    console.error(`[ContributorSync] Update error for ${book.biblionetId}:`, updateError);
                } else {
                    console.log(`[ContributorSync] "${book.title}" → ${contributorRows.length} contributors`);
                    synced++;
                }
            } catch (err) {
                console.error(`[ContributorSync] Error for biblionetId ${book.biblionetId}:`, err);
                consecutiveFailures++;
                if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                    console.warn(`[ContributorSync] ${MAX_CONSECUTIVE_FAILURES} consecutive failures — stopping early, likely hit today's rate limit`);
                    stoppedEarly = true;
                    break;
                }
            }
        }

        const { count } = await supabase
            .from('books')
            .select('*', { count: 'exact', head: true })
            .eq('syncedContributors', false);

        return { synced, remaining: count ?? 0, stoppedEarly };
    } catch (err) {
        console.error('[ContributorSync] Error:', err);
        return { synced: 0, remaining: 0, error: String(err) };
    }
}

async function deleteAllInTable(tableName: string): Promise<number> {
    const { count } = await supabase.from(tableName).delete({ count: 'exact' }).not('id', 'is', null);
    return count ?? 0;
}

async function deleteAllInTableByPk(tableName: string, pkColumn: string): Promise<number> {
    const { count } = await supabase.from(tableName).delete({ count: 'exact' }).not(pkColumn, 'is', null);
    return count ?? 0;
}

export async function clearBookDatabase(): Promise<{ total: number }> {
    if (!__DEV__) return { total: 0 };
    let total = 0;
    try {
        // Order matters — foreign keys reference books
        total += await deleteAllInTable('readingSessions');
        total += await deleteAllInTable('userActivity');
        total += await deleteAllInTable('readingList');
        total += await deleteAllInTableByPk('bookStats', 'bookId');
        total += await deleteAllInTableByPk('books', 'id');
        console.log(`[Clear] Deleted ~${total} rows`);
    } catch (err) {
        console.error('[Clear] Error:', err);
    }
    return { total };
}