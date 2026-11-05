import { supabase } from './supabaseConfig';

export type ProfileGenre = {
    slug: string;
    name_en: string;
    name_el: string;
    is_fiction?: boolean | null;
    score?: number;
    books?: number;
};

export type ReaderProfile = {
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

/** The signed-in user's genre mix and reading stats (sql/migration_39_reader_profile.sql). */
export async function fetchReaderProfile(): Promise<ReaderProfile> {
    const { data, error } = await supabase.rpc('get_reader_profile');
    if (error) throw error;
    return data as ReaderProfile;
}
