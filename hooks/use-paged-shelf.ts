import { Book } from '@/constants/types';
import { logError } from '@/services/errorLog';
import { SHELF_PAGE_SIZE } from '@/services/shelves';
import { useCallback, useEffect, useRef, useState } from 'react';

type PageLoader = (offset: number, limit: number) => Promise<Book[]>;

const CACHE_TTL_MS = 10 * 60 * 1000;
const shelfCache = new Map<string, { books: Book[]; hasMore: boolean; ts: number }>();

export const clearPagedShelfCache = () => shelfCache.clear();

// A shelf that loads its first page on mount and the next ones on demand.
// `cacheKey` identifies the shelf (null = nothing to load); `load` is read
// through a ref, so callers can pass an inline function.
export function usePagedShelf(cacheKey: string | null, errorContext: string, load: PageLoader) {
    const [books, setBooks] = useState<Book[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);

    const loadRef = useRef(load);
    const booksRef = useRef<Book[]>([]);
    const hasMore = useRef(true);
    const busy = useRef(false);
    const generation = useRef(0);

    useEffect(() => {
        loadRef.current = load;
    });

    useEffect(() => {
        const gen = ++generation.current;
        booksRef.current = [];
        hasMore.current = true;
        busy.current = false;
        setLoadingMore(false);

        if (!cacheKey) { setBooks([]); setLoading(false); return; }

        const cached = shelfCache.get(cacheKey);
        if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
            booksRef.current = cached.books;
            hasMore.current = cached.hasMore;
            setBooks(cached.books);
            setLoading(false);
            return;
        }

        setBooks([]);
        setLoading(true);
        busy.current = true;
        loadRef.current(0, SHELF_PAGE_SIZE)
            .then(page => {
                if (gen !== generation.current) return;
                booksRef.current = page;
                hasMore.current = page.length >= SHELF_PAGE_SIZE;
                shelfCache.set(cacheKey, { books: page, hasMore: hasMore.current, ts: Date.now() });
                setBooks(page);
            })
            .catch(e => { if (gen === generation.current) void logError(e, errorContext); })
            .finally(() => {
                if (gen !== generation.current) return;
                busy.current = false;
                setLoading(false);
            });
    }, [cacheKey, errorContext]);

    const loadMore = useCallback(() => {
        if (!cacheKey || busy.current || !hasMore.current) return;
        const gen = generation.current;
        busy.current = true;
        setLoadingMore(true);
        loadRef.current(booksRef.current.length, SHELF_PAGE_SIZE)
            .then(page => {
                if (gen !== generation.current) return;
                const known = new Set(booksRef.current.map(b => b.id));
                const next = [...booksRef.current, ...page.filter(b => !known.has(b.id))];
                booksRef.current = next;
                hasMore.current = page.length >= SHELF_PAGE_SIZE;
                shelfCache.set(cacheKey, { books: next, hasMore: hasMore.current, ts: Date.now() });
                setBooks(next);
            })
            .catch(e => { if (gen === generation.current) void logError(e, errorContext); })
            .finally(() => {
                if (gen !== generation.current) return;
                busy.current = false;
                setLoadingMore(false);
            });
    }, [cacheKey, errorContext]);

    return { books, loading, loadingMore, loadMore };
}
