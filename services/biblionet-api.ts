import { Book } from '@/constants/types';
import { supabase } from './supabaseConfig';

const COVER_BASE = 'https://www.biblionet.gr';

interface BiblionetTitle {
    TitlesID?: string | number;
    Title?: string;
    Subtitle?: string;
    Writer?: string;
    Category?: string;
    CoverImage?: string;
    ISBN?: string;
    CurrentPublishDate?: string;
    Language?: string;
    Summary?: string;
    PageNo?: string | number;
    Publisher?: string;
    Series?: string;
    SubSeries?: string;
}

function detectIsbn(raw: string | undefined): { isbn: string | null; isbn10: string | null; isbn13: string | null } {
    if (!raw) return { isbn: null, isbn10: null, isbn13: null };
    const clean = raw.replace(/-/g, '');
    if (clean.length === 13) return { isbn: clean, isbn10: null, isbn13: clean };
    if (clean.length === 10) return { isbn: clean, isbn10: clean, isbn13: null };
    return { isbn: raw, isbn10: null, isbn13: null };
}

function mapBiblionetTitle(item: BiblionetTitle): Book | null {
    if (!item.TitlesID) return null;
    const { isbn, isbn10, isbn13 } = detectIsbn(item.ISBN);
    return {
        id: String(item.TitlesID),
        title: item.Title ?? 'Unknown Title',
        authors: item.Writer ? [item.Writer] : ['Unknown Author'],
        coverUrl: item.CoverImage ? `${COVER_BASE}${item.CoverImage}` : null,
        publishedYear: item.CurrentPublishDate ? item.CurrentPublishDate.substring(0, 4) : null,
        isbn,
        isbn10,
        isbn13,
        language: item.Language ?? 'el',
        lastFetchedAt: new Date(),
        description: item.Summary ?? '',
        categories: item.Category ? [item.Category] : [],
        edition: '',
        isActive: true,
        popularityCount: 0,
        publisher: item.Publisher ?? '',
        pageCount: parseInt(String(item.PageNo), 10) || undefined,
        series: item.Series ?? '',
        subSeries: item.SubSeries ?? '',
        source: 'biblionet',
    };
}

async function postToWebservice(endpoint: string, params: Record<string, string>): Promise<BiblionetTitle[]> {
    try {
        const { data, error } = await supabase.functions.invoke('biblionet-proxy', { body: { endpoint, params } });
        if (error) {
            console.error(`Biblionet API error: ${endpoint}`, error);
            return [];
        }
        const firstKey = Object.keys(data)[0];
        const raw = data.book_titles ?? data.book ?? data.titles ?? data.Books ?? data[firstKey] ?? [];
        return Array.isArray(raw) ? raw : [];
    } catch (error) {
        console.error(`Error calling Biblionet ${endpoint}:`, error);
        return [];
    }
}

export async function searchBiblionetBooks(queryText: string): Promise<Book[]> {
    if (!queryText.trim()) return [];
    const items = await postToWebservice('search_titles', {
        title: queryText,
        title_split: '1',
        titles_per_page: '30',
        page: '1',
    });
    return items.map(mapBiblionetTitle).filter((b): b is Book => b !== null);
}

export async function getBiblionetBooksByCategory(category: string): Promise<Book[]> {
    if (!category.trim()) return [];
    const items = await postToWebservice('search_titles', {
        category,
        titles_per_page: '40',
        page: '1',
    });
    return items.map(mapBiblionetTitle).filter((b): b is Book => b !== null);
}

export async function getBiblionetBookById(id: string): Promise<Book | null> {
    const items = await postToWebservice('get_title', { titleid: id });
    return items.length > 0 ? mapBiblionetTitle(items[0]) : null;
}
