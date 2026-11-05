import { supabase } from './supabaseConfig';

export type ProfileGenre = {
    slug: string;
    name_en: string;
    name_el: string;
    is_fiction?: boolean | null;
    score?: number;
    books?: number;
};

/** The reader type, built and saved by get_reader_profile (migration 41). */
export type ReaderTypeResult = {
    genre: string;
    noun_en: string;
    noun_el: string;
    of_en: string;
    of_el: string;
    tagline_en: string;
    tagline_el: string;
    /** Ionicons name. */
    icon: string;
    /** 'tag:<theme slug>' or 'genre:<genre slug>'. */
    flavour: string;
};

export type ProfileMood = { slug: string; label_en: string; label_el: string };

export type ReaderProfile = {
    type: ReaderTypeResult | null;
    /** Where the type came from: the user's books, or (too few books) their onboarding picks. */
    source: 'books' | 'picks' | null;
    moods: ProfileMood[];
    genres: ProfileGenre[];
    genre_count: number;
    genre_books: number;
    preferred_genres: ProfileGenre[];
    finished: number;
    reading: number;
    wishlist: number;
    pages_read: number;
    seconds_read: number;
    top_author: string | null;
};

/** The signed-in user's reader type, genre mix, moods and reading stats (migrations 39 + 41). */
export async function fetchReaderProfile(): Promise<ReaderProfile> {
    const { data, error } = await supabase.rpc('get_reader_profile');
    if (error) throw error;
    return data as ReaderProfile;
}
