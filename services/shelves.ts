import { Book } from '../constants/types';
import { supabase } from './supabaseConfig';

export type ShelfKind = 'category' | 'author' | 'quick' | 'new';

export const SHELF_PAGE_SIZE = 24;

export const fetchShelfPage = async (
    kind: ShelfKind,
    key: string | null,
    offset: number,
    limit: number = SHELF_PAGE_SIZE,
    excludeId?: string,
): Promise<Book[]> => {
    const { data, error } = await supabase.rpc('get_shelf_books', {
        p_kind: kind,
        p_key: key,
        p_offset: offset,
        p_limit: limit,
        p_exclude_id: excludeId ?? null,
    });
    if (error) throw error;
    return (data ?? []) as Book[];
};
