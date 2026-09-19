import { Book, BookSource } from '../constants/types';
import { supabase } from './supabaseConfig';

export interface ScoredBook extends Book {
    score: number;
    matchReason?: string;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const trendingViewsCache = new Map<string, { data: ScoredBook[]; ts: number }>();
const recommendationsCache = new Map<string, { data: ScoredBook[]; ts: number }>();

type ReadingListSignal = {
    bookId: string;
    status?: string;
    addedAtMs: number | null;
};

const ANALYSIS_HISTORY_LIMIT = 30;
const MAX_RECS_PER_PRIMARY_AUTHOR = 3;
const JITTER_RANGE = 30;
const MAX_POOL_SIZE = 250;
const SEEN_RECS_MAX = 50;

// How many top signals of each kind we hand to the RPC.
const TOP_CATEGORIES = 5;
const TOP_SUBCATEGORIES = 6;
const TOP_AUTHORS = 5;
const TOP_PUBLISHERS = 3;
const TOP_TAGS = 8;

const seenRecommendationsMap = new Map<string, string[]>();

const updateSeenList = (userId: string, books: ScoredBook[]) => {
    const existing = seenRecommendationsMap.get(userId) ?? [];
    const updated = [...existing, ...books.map(b => b.id).filter(Boolean)].slice(-SEEN_RECS_MAX);
    seenRecommendationsMap.set(userId, updated);
};

export const invalidateRecommendationsCache = (userId: string) => {
    for (const key of recommendationsCache.keys()) {
        if (key.startsWith(`recs-pool-${userId}-`)) recommendationsCache.delete(key);
    }
};

const STATUS_WEIGHTS: Record<string, number> = {
    wishlist: 1,
    reading: 2,
    completed: 3,
};

const getStatusWeight = (status?: string): number => STATUS_WEIGHTS[status ?? ''] || 1;

const getHistoryRecencyWeight = (addedAtMs: number | null): number => {
    if (!addedAtMs) return 1;
    const ageDays = Math.max(0, (Date.now() - addedAtMs) / (1000 * 60 * 60 * 24));
    return Math.max(0.6, Math.exp(-ageDays / 120));
};

const fetchBooksByIds = async (bookIds: string[]): Promise<Map<string, Book>> => {
    const booksMap = new Map<string, Book>();
    if (bookIds.length === 0) return booksMap;
    const { data } = await supabase.from('books').select('*').in('id', bookIds);
    (data ?? []).forEach((row: any) => booksMap.set(row.id, row as Book));
    return booksMap;
};

const topNByWeight = (counts: Record<string, number>, n: number): string[] =>
    Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(e => e[0]);

const applyAuthorDiversity = (books: ScoredBook[], limitCount: number): ScoredBook[] => {
    const selected: ScoredBook[] = [];
    const primaryAuthorCounts = new Map<string, number>();
    const selectedIds = new Set<string>();

    for (const book of books) {
        if (selected.length >= limitCount) break;
        const primaryAuthor = book.authors?.[0];
        const normalizedAuthor = primaryAuthor?.trim().toLowerCase();
        if (normalizedAuthor && normalizedAuthor !== 'unknown author') {
            const count = primaryAuthorCounts.get(normalizedAuthor) || 0;
            if (count >= MAX_RECS_PER_PRIMARY_AUTHOR) continue;
            primaryAuthorCounts.set(normalizedAuthor, count + 1);
        }
        selected.push(book);
        selectedIds.add(book.id);
    }

    if (selected.length < limitCount) {
        for (const book of books) {
            if (selected.length >= limitCount) break;
            if (selectedIds.has(book.id)) continue;
            selected.push(book);
            selectedIds.add(book.id);
        }
    }
    return selected;
};

const applyJitterAndSlice = (pool: ScoredBook[], count: number): ScoredBook[] => {
    const jittered = pool.map(b => ({ ...b, score: b.score + Math.random() * JITTER_RANGE }));
    jittered.sort((a, b) => b.score - a.score);
    return jittered.slice(0, count);
};

// RPC rows already carry computed score + match_reason; map them onto ScoredBook.
const mapRpcRow = (row: any): ScoredBook => {
    const { score, match_reason, ...bookFields } = row;
    return {
        ...(bookFields as Book),
        score: typeof score === 'number' ? score : 0,
        matchReason: match_reason || 'Popular',
    };
};

export const getRecommendationsForUser = async (
    userId: string,
    limitCount: number = 10,
    source?: BookSource,
    preloadedList?: Array<{ bookId: string; status?: string; addedAt?: any }>,
): Promise<ScoredBook[]> => {
    const poolKey = `recs-pool-${userId}-${source ?? 'all'}`;
    const poolCached = recommendationsCache.get(poolKey);
    if (poolCached && Date.now() - poolCached.ts < CACHE_TTL_MS) {
        const results = applyJitterAndSlice(poolCached.data, limitCount);
        updateSeenList(userId, results);
        return results;
    }

    const storePool = (pool: ScoredBook[]): ScoredBook[] => {
        recommendationsCache.set(poolKey, { data: pool, ts: Date.now() });
        const results = applyJitterAndSlice(pool, limitCount);
        updateSeenList(userId, results);
        return results;
    };

    try {
        const seenIds = new Set(seenRecommendationsMap.get(userId) ?? []);

        let readingListSignals: ReadingListSignal[];

        if (preloadedList) {
            readingListSignals = preloadedList.map(item => ({
                bookId: item.bookId,
                status: item.status,
                addedAtMs: item.addedAt ? new Date(item.addedAt).getTime() : null,
            }));
        } else {
            const { data: rlData } = await supabase
                .from('readingList')
                .select('bookId, status, addedAt')
                .eq('userId', userId)
                .order('addedAt', { ascending: false })
                .limit(50);

            if (!rlData || rlData.length === 0) {
                return storePool(await getTrendingBooks(MAX_POOL_SIZE, source));
            }

            readingListSignals = rlData.map((row: any) => ({
                bookId: row.bookId,
                status: row.status,
                addedAtMs: row.addedAt ? new Date(row.addedAt).getTime() : null,
            }));
        }

        if (readingListSignals.length === 0) {
            return storePool(await getTrendingBooks(MAX_POOL_SIZE, source));
        }

        const readingListIds = readingListSignals.map(s => s.bookId);

        // --- Resolve the source books for preference analysis --------------------
        const sourceSignals = readingListSignals.slice(0, ANALYSIS_HISTORY_LIMIT);
        const signalByBookId = new Map(sourceSignals.map(s => [s.bookId, s]));

        const validSignals = sourceSignals.filter(s => !s.bookId.includes('/') && !s.bookId.includes('http'));
        const invalidSignals = sourceSignals.filter(s => s.bookId.includes('/') || s.bookId.includes('http'));

        const sourceBooks: Array<{ book: Book; signal: ReadingListSignal }> = [];

        const validIds = validSignals.map(s => s.bookId);
        if (validIds.length > 0) {
            const booksMap = await fetchBooksByIds(validIds);
            for (const [id, book] of booksMap) {
                const signal = signalByBookId.get(id);
                if (signal) sourceBooks.push({ book, signal });
            }
        }

        // Data-integrity fallback: some rows stored a coverUrl as bookId.
        if (invalidSignals.length > 0) {
            const results = await Promise.all(
                invalidSignals.map(async signal => {
                    const { data } = await supabase.from('books').select('*').eq('coverUrl', signal.bookId).limit(1);
                    if (data && data.length > 0) return { book: data[0] as Book, signal };
                    return null;
                })
            );
            results.forEach(r => { if (r) sourceBooks.push(r); });
        }

        // --- Extract weighted preference signals (status × recency decay) --------
        const categoryCounts: Record<string, number> = {};
        const subcategoryCounts: Record<string, number> = {};
        const authorCounts: Record<string, number> = {};
        const publisherCounts: Record<string, number> = {};
        const languageCounts: Record<string, number> = {};
        const tagCounts: Record<string, number> = {};

        sourceBooks.forEach(({ book, signal }) => {
            const weight = getStatusWeight(signal.status) * getHistoryRecencyWeight(signal.addedAtMs);
            book.categories?.forEach(cat => { categoryCounts[cat] = (categoryCounts[cat] || 0) + weight; });
            book.subcategories?.forEach(sub => { subcategoryCounts[sub] = (subcategoryCounts[sub] || 0) + weight; });
            book.authors?.forEach(a => {
                if (a !== 'Unknown Author') authorCounts[a] = (authorCounts[a] || 0) + weight;
            });
            if (book.publisher && book.publisher !== 'Unknown Publisher') {
                publisherCounts[book.publisher] = (publisherCounts[book.publisher] || 0) + weight;
            }
            if (book.language) languageCounts[book.language] = (languageCounts[book.language] || 0) + weight;
            book.searchTags?.forEach((tag: string) => { tagCounts[tag] = (tagCounts[tag] || 0) + weight; });
        });

        const topCategories = topNByWeight(categoryCounts, TOP_CATEGORIES);
        const topSubcategories = topNByWeight(subcategoryCounts, TOP_SUBCATEGORIES);
        const topAuthors = topNByWeight(authorCounts, TOP_AUTHORS);
        const topPublishers = topNByWeight(publisherCounts, TOP_PUBLISHERS);
        const topTags = topNByWeight(tagCounts, TOP_TAGS);
        const preferredLanguage = topNByWeight(languageCounts, 1)[0] ?? null;

        if (topCategories.length === 0 && topSubcategories.length === 0 && topAuthors.length === 0) {
            return storePool(await getTrendingBooks(MAX_POOL_SIZE, source));
        }

        // --- Single RPC round-trip: server joins + scores candidates -------------
        const excludeIds = Array.from(new Set([...readingListIds, ...seenIds])).filter(Boolean);

        const { data: rpcData, error: rpcError } = await supabase.rpc('get_book_recommendations', {
            p_categories: topCategories,
            p_subcategories: topSubcategories,
            p_authors: topAuthors,
            p_tags: topTags,
            p_publishers: topPublishers,
            p_preferred_language: preferredLanguage,
            p_source: source ?? null,
            p_exclude_ids: excludeIds,
            p_limit: MAX_POOL_SIZE,
        });

        if (rpcError) {
            console.error('get_book_recommendations RPC failed:', rpcError);
            return storePool(await getTrendingBooks(MAX_POOL_SIZE, source));
        }

        const scored: ScoredBook[] = ((rpcData ?? []) as any[]).map(mapRpcRow);
        if (scored.length === 0) {
            return storePool(await getTrendingBooks(MAX_POOL_SIZE, source));
        }

        // RPC returns sorted by score desc; dedupe defensively then diversify.
        const uniqueScored = Array.from(new Map(scored.map(item => [item.id, item])).values());
        return storePool(applyAuthorDiversity(uniqueScored, MAX_POOL_SIZE));

    } catch (error) {
        console.error('Error getting recommendations:', error);
        return [];
    }
};

const getTrendingBooks = async (limitCount: number, source?: BookSource): Promise<ScoredBook[]> => {
    try {
        const { data: statsData } = await supabase
            .from('bookStats')
            .select('bookId, completed')
            .order('completed', { ascending: false })
            .limit(limitCount);

        if (!statsData || statsData.length === 0) {
            let booksQuery = supabase.from('books').select('*').limit(limitCount);
            if (source) booksQuery = booksQuery.eq('source', source);
            const { data } = await booksQuery;
            return (data ?? []).map(d => ({ ...d, score: 0 } as ScoredBook));
        }

        const popularIds = statsData.map((d: any) => d.bookId);
        const completedMap = new Map<string, number>(statsData.map((d: any) => [d.bookId, d.completed || 0]));
        const booksById = await fetchBooksByIds(popularIds);

        return popularIds
            .map((bookId: string) => {
                const book = booksById.get(bookId);
                if (!book) return null;
                if (source && book.source && book.source !== source) return null;
                return { ...book, score: completedMap.get(bookId) || 0, matchReason: 'Trending' } as ScoredBook;
            })
            .filter((b): b is ScoredBook => !!b)
            .slice(0, limitCount);
    } catch (e) {
        console.warn('Error fetching trending:', e);
        return [];
    }
};

export const getTrendingBooksByViews = async (limitCount: number = 10, source?: BookSource): Promise<ScoredBook[]> => {
    const cacheKey = `trending-views-${source ?? 'all'}-${limitCount}`;
    const cached = trendingViewsCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

    try {
        const { data: statsData } = await supabase
            .from('bookStats')
            .select('bookId, views')
            .order('views', { ascending: false })
            .limit(limitCount);

        if (!statsData || statsData.length === 0) {
            let booksQuery = supabase.from('books').select('*').limit(limitCount);
            if (source) booksQuery = booksQuery.eq('source', source);
            const { data } = await booksQuery;
            const result = (data ?? []).map(d => ({ ...d, score: 0 } as ScoredBook));
            trendingViewsCache.set(cacheKey, { data: result, ts: Date.now() });
            return result;
        }

        const trendingIds = statsData.map((d: any) => d.bookId);
        const viewsMap = new Map<string, number>(statsData.map((d: any) => [d.bookId, d.views || 0]));
        const booksById = await fetchBooksByIds(trendingIds);

        const trendingBooks: ScoredBook[] = trendingIds
            .map((bookId: string) => {
                const book = booksById.get(bookId);
                if (!book) return null;
                if (source && book.source && book.source !== source) return null;
                const views = viewsMap.get(bookId) || 0;
                return { ...book, score: views, matchReason: `${views} views` } as ScoredBook;
            })
            .filter((b): b is ScoredBook => !!b);

        trendingBooks.sort((a, b) => b.score - a.score);
        trendingViewsCache.set(cacheKey, { data: trendingBooks, ts: Date.now() });
        return trendingBooks;
    } catch (e) {
        console.error('Error fetching trending by views:', e);
        return [];
    }
};