import { Book, BookSource } from '../constants/types';
import { logError } from './errorLog';
import { supabase } from './supabaseConfig';

export interface ScoredBook extends Book {
    score: number;
    matchReason?: string;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const trendingViewsCache = new Map<string, { data: ScoredBook[]; ts: number }>();
const recommendationsCache = new Map<string, { data: ScoredBook[]; ts: number }>();

const MAX_RECS_PER_PRIMARY_AUTHOR = 3;
// Small enough that it only reorders near-ties; relevance decides the rest.
const JITTER_RANGE = 5;
const MAX_POOL_SIZE = 250;
const SEEN_RECS_MAX = 50;

const seenRecommendationsMap = new Map<string, string[]>();

const updateSeenList = (userId: string, books: ScoredBook[]) => {
    const existing = seenRecommendationsMap.get(userId) ?? [];
    const updated = [...existing, ...books.map(b => b.id).filter(Boolean)].slice(-SEEN_RECS_MAX);
    seenRecommendationsMap.set(userId, updated);
};

const orderedRecsCache = new Map<string, { data: ScoredBook[]; ts: number }>();

export const invalidateRecommendationsCache = (userId: string) => {
    recommendationsCache.delete(userId);
    orderedRecsCache.delete(userId);
};

const fetchBooksByIds = async (bookIds: string[]): Promise<Map<string, Book>> => {
    const booksMap = new Map<string, Book>();
    if (bookIds.length === 0) return booksMap;
    const { data } = await supabase.from('books').select('*').in('id', bookIds);
    (data ?? []).forEach((row: any) => booksMap.set(row.id, row as Book));
    return booksMap;
};

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

// Jitter first, then cap per author — the other order lets the re-sort undo the cap.
const pickFromPool = (pool: ScoredBook[], count: number): ScoredBook[] => {
    const jittered = pool.map(b => ({ ...b, score: b.score + Math.random() * JITTER_RANGE }));
    jittered.sort((a, b) => b.score - a.score);
    return applyAuthorDiversity(jittered, count);
};

const mapRpcRow = (row: any): ScoredBook => {
    const { score, match_reason, ...bookFields } = row;
    return {
        ...(bookFields as Book),
        score: typeof score === 'number' ? score : 0,
        matchReason: match_reason ?? undefined,
    };
};

// The taste profile (reading list + onboarding picks) is built server-side from
// the caller's session; userId here only keys the local cache.
const loadPool = async (userId: string): Promise<ScoredBook[]> => {
    const cached = recommendationsCache.get(userId);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

    const store = (pool: ScoredBook[]) => {
        recommendationsCache.set(userId, { data: pool, ts: Date.now() });
        return pool;
    };

    try {
        const { data, error } = await supabase.rpc('get_recommendations', {
            p_exclude_ids: seenRecommendationsMap.get(userId) ?? [],
            p_limit: MAX_POOL_SIZE,
        });

        if (error) {
            void logError(error, 'recommendations/rpc');
            return store(await getTrendingBooks(MAX_POOL_SIZE));
        }

        const scored = ((data ?? []) as any[]).map(mapRpcRow);
        return store(scored.length > 0 ? scored : await getTrendingBooks(MAX_POOL_SIZE));
    } catch (error) {
        void logError(error, 'recommendations/getForUser');
        return [];
    }
};

export const getRecommendationsForUser = async (
    userId: string,
    limitCount: number = 10,
): Promise<ScoredBook[]> => {
    const results = pickFromPool(await loadPool(userId), limitCount);
    updateSeenList(userId, results);
    return results;
};

// Paging needs one fixed order, so the jitter and author cap are applied once
// per pool and the pages are slices of that list.
export const getRecommendationPage = async (
    userId: string,
    offset: number,
    limit: number,
): Promise<ScoredBook[]> => {
    let entry = orderedRecsCache.get(userId);
    if (!entry || Date.now() - entry.ts >= CACHE_TTL_MS) {
        const ordered = pickFromPool(await loadPool(userId), MAX_POOL_SIZE);
        if (ordered.length === 0) return [];
        entry = { data: ordered, ts: Date.now() };
        orderedRecsCache.set(userId, entry);
    }
    const page = entry.data.slice(offset, offset + limit);
    if (offset === 0) updateSeenList(userId, page);
    return page;
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
        void logError(e, 'recommendations/trending');
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
        void logError(e, 'recommendations/trendingByViews');
        return [];
    }
};

export const getTrendingBooksPage = async (offset: number, limit: number): Promise<ScoredBook[]> => {
    try {
        const { data: statsData } = await supabase
            .from('bookStats')
            .select('bookId, views')
            .order('views', { ascending: false })
            .order('bookId', { ascending: true })
            .range(offset, offset + limit - 1);
        if (!statsData || statsData.length === 0) return [];

        const ids = statsData.map((d: any) => d.bookId as string);
        const booksById = await fetchBooksByIds(ids);
        return statsData
            .map((d: any) => {
                const book = booksById.get(d.bookId);
                return book ? ({ ...book, score: d.views || 0, matchReason: `${d.views || 0} views` } as ScoredBook) : null;
            })
            .filter((b): b is ScoredBook => !!b);
    } catch (e) {
        void logError(e, 'recommendations/trendingPage');
        return [];
    }
};
