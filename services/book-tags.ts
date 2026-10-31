import { Book } from '../constants/types';
import { supabase } from './supabaseConfig';

// Book tags: mood, themes, setting … picked from a fixed vocabulary
// (tags / book_tags, sql/migration_32). Admin functions: sql/migration_33.

export type TagFacet =
    | 'mood' | 'storytelling' | 'form' | 'experience' | 'theme'
    | 'setting-region' | 'setting-period' | 'setting-place' | 'flag';

export interface BookTag {
    tagId: number;
    facet: TagFacet;
    slug: string;
    labelEl: string;
    labelEn: string;
    strength: 'clear' | 'implied';
    rank: number;
}

// Tags grouped the way book details shows them.
export interface GroupedTags {
    mood: BookTag[];
    theme: BookTag[];
    experience: BookTag[];
    setting: BookTag[];     // region, period, place — shown as one line
    storytelling: BookTag[]; // storytelling + form
    trueStory: boolean;
}

const SETTING_FACETS: TagFacet[] = ['setting-region', 'setting-period', 'setting-place'];

export const groupTags = (tags: BookTag[]): GroupedTags => ({
    mood: tags.filter(t => t.facet === 'mood'),
    theme: tags.filter(t => t.facet === 'theme'),
    experience: tags.filter(t => t.facet === 'experience'),
    setting: SETTING_FACETS.flatMap(f => tags.filter(t => t.facet === f)),
    storytelling: tags.filter(t => t.facet === 'storytelling' || t.facet === 'form'),
    trueStory: tags.some(t => t.slug === 'true-story'),
});

export const tagLabel = (tag: BookTag, greek: boolean) => (greek ? tag.labelEl : tag.labelEn);

// Tags for one book, any source. A tag picked by more than one source (AI,
// readers, manual) appears once.
export const fetchBookTags = async (bookId: string): Promise<BookTag[]> => {
    const { data, error } = await supabase
        .from('book_tags')
        .select('rank, strength, tags(id, facet, slug, label_el, label_en, sort, active)')
        .eq('book_id', bookId);
    if (error) throw error;
    const seen = new Set<number>();
    return ((data ?? []) as any[])
        .filter(row => row.tags?.active)
        .sort((a, b) => a.rank - b.rank || a.tags.sort - b.tags.sort)
        .filter(row => !seen.has(row.tags.id) && seen.add(row.tags.id))
        .map(row => ({
            tagId: row.tags.id,
            facet: row.tags.facet,
            slug: row.tags.slug,
            labelEl: row.tags.label_el,
            labelEn: row.tags.label_en,
            strength: row.strength,
            rank: row.rank,
        }));
};

/* ── Admin ───────────────────────────────────────────────────────── */

export const ENRICHED_PAGE_SIZE = 30;

export type EnrichedFilter = 'all' | 'thin' | 'failed' | 'skipped';

export interface EnrichOverview {
    enabled: boolean;
    dailyLimit: number;
    batchOpen: boolean;
    lastRunAt: string | null;
    lastResult: string | null;
    done: number;
    editions: number;
    thin: number;
    failed: number;
    skipped: number;
    waiting: number;
}

export interface EnrichedBook extends Book {
    status: 'done' | 'failed' | 'skipped';
    evidence: 'rich' | 'thin' | null;
    model: string | null;
    error: string | null;
    enrichedAt: string;
    copies: number;
    tags: BookTag[];
}

export const fetchEnrichOverview = async (): Promise<EnrichOverview> => {
    const { data, error } = await supabase.rpc('get_enrich_overview');
    if (error) throw error;
    const row = (data ?? [])[0] ?? {};
    return {
        enabled: !!row.enabled,
        dailyLimit: Number(row.daily_limit ?? 0),
        batchOpen: !!row.open_batch_id,
        lastRunAt: row.last_run_at ?? null,
        lastResult: row.last_result ?? null,
        done: Number(row.done ?? 0),
        editions: Number(row.editions ?? 0),
        thin: Number(row.thin ?? 0),
        failed: Number(row.failed ?? 0),
        skipped: Number(row.skipped ?? 0),
        waiting: Number(row.waiting ?? 0),
    };
};

export const fetchEnrichedBooks = async (
    filter: EnrichedFilter,
    search: string,
    offset: number,
): Promise<EnrichedBook[]> => {
    const { data, error } = await supabase.rpc('get_enriched_books', {
        p_filter: filter,
        p_search: search || null,
        p_offset: offset,
        p_limit: ENRICHED_PAGE_SIZE,
    });
    if (error) throw error;
    return ((data ?? []) as any[]).map(row => ({
        ...row,
        enrichedAt: row.enriched_at,
        copies: Number(row.copies ?? 0),
        tags: (row.tags ?? []) as BookTag[],
    }));
};

export const setEnrichEnabled = async (enabled: boolean) => {
    const { error } = await supabase.rpc('set_enrich_enabled', { p_enabled: enabled });
    if (error) throw error;
};

export const requeueBookEnrichment = async (bookId: string) => {
    const { error } = await supabase.rpc('requeue_book_enrichment', { p_book_id: bookId });
    if (error) throw error;
};

export const removeBookTag = async (bookId: string, tagId: number) => {
    const { error } = await supabase.rpc('remove_book_tag', { p_book_id: bookId, p_tag_id: tagId });
    if (error) throw error;
};
