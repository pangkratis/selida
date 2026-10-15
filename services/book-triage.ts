import { Book } from '../constants/types';
import { supabase } from './supabaseConfig';

// priority = sync first, skip = not yet, review = decide later.
export type TriageDecision = 'priority' | 'skip' | 'review';

export interface TriageCounts {
    unsynced: number;
    inList: number;
    inReview: number;
    skipped: number;
}

export interface TriageGenre {
    slug: string;
    nameEn: string;
    nameEl: string;
}

export interface TriageBook extends Book {
    genres: TriageGenre[];
}

export const TRIAGE_PAGE_SIZE = 20;
export const TRIAGE_LIST_PAGE_SIZE = 30;

// Primary genre first, then by confidence.
const withGenres = async (books: Book[]): Promise<TriageBook[]> => {
    if (books.length === 0) return [];
    const { data, error } = await supabase
        .from('book_genres')
        .select('book_id, is_primary, confidence, genres(slug, name_en, name_el)')
        .in('book_id', books.map(b => b.id));
    if (error) throw error;
    const byBook = new Map<string, { rank: number; genre: TriageGenre }[]>();
    for (const row of (data ?? []) as any[]) {
        if (!row.genres) continue;
        const list = byBook.get(row.book_id) ?? [];
        list.push({
            rank: (row.is_primary ? 2 : 0) + (row.confidence ?? 0),
            genre: { slug: row.genres.slug, nameEn: row.genres.name_en, nameEl: row.genres.name_el },
        });
        byBook.set(row.book_id, list);
    }
    return books.map(b => ({
        ...b,
        genres: (byBook.get(b.id) ?? []).sort((x, y) => y.rank - x.rank).map(x => x.genre),
    }));
};

export const fetchTriageDeck = async (excludeIds: string[]): Promise<TriageBook[]> => {
    const { data, error } = await supabase.rpc('get_triage_deck', {
        p_limit: TRIAGE_PAGE_SIZE,
        p_exclude_ids: excludeIds,
    });
    if (error) throw error;
    return withGenres((data ?? []) as Book[]);
};

export const fetchTriageList = async (decision: TriageDecision, offset: number): Promise<TriageBook[]> => {
    const { data, error } = await supabase.rpc('get_triage_list', {
        p_decision: decision,
        p_offset: offset,
        p_limit: TRIAGE_LIST_PAGE_SIZE,
    });
    if (error) throw error;
    return withGenres((data ?? []) as Book[]);
};

export const moveToSyncList = async (bookIds: string[], userId: string) => {
    if (bookIds.length === 0) return;
    const now = new Date().toISOString();
    const { error } = await supabase.from('book_triage').upsert(
        bookIds.map(id => ({ book_id: id, decision: 'priority', decided_by: userId, decided_at: now })),
        { onConflict: 'book_id' },
    );
    if (error) throw error;
};

export const fetchTriageCounts = async (): Promise<TriageCounts> => {
    const { data, error } = await supabase.rpc('get_triage_counts');
    if (error) throw error;
    const row = (data ?? [])[0] ?? {};
    return {
        unsynced: Number(row.unsynced ?? 0),
        inList: Number(row.in_list ?? 0),
        inReview: Number(row.in_review ?? 0),
        skipped: Number(row.skipped ?? 0),
    };
};

export const saveTriageDecision = async (bookId: string, decision: TriageDecision, userId: string) => {
    const { error } = await supabase.from('book_triage').upsert(
        { book_id: bookId, decision, decided_by: userId, decided_at: new Date().toISOString() },
        { onConflict: 'book_id' },
    );
    if (error) throw error;
};

export const clearTriageDecision = async (bookId: string) => {
    const { error } = await supabase.from('book_triage').delete().eq('book_id', bookId);
    if (error) throw error;
};
