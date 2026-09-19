export type ReadingStatus = 'reading' | 'wishlist' | 'completed';
export type BookSource = 'biblionet';

export interface ReadingListItem extends Partial<Book> {
    bookId: string;
    status: ReadingStatus;
    progressPercentage?: number;
    addedAt?: string | number;
    totalReadingTimeSeconds?: number;
}

export interface Book {
    id: string;
    title: string;
    subtitle?: string;
    authors: string[];
    coverUrl: string | null;
    publishedYear: string | null;
    isbn: string | null;
    isbn10: string | null;
    isbn13: string | null;
    language: string | 'el';
    lastFetchedAt: Date;
    description: string;
    categories: string[];
    subcategories?: string[];
    searchTags?: string[];
    edition: string;
    isActive: boolean;
    popularityCount: number;
    publisher: string;
    createdAt?: string | Date;
    pageCount?: number;
    source?: BookSource;
    series?: string;
    subSeries?: string;
}
