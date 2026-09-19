// bookStats.ts — intentionally empty.
//
// These functions were replaced by Postgres triggers in migration_03_triggers.sql:
//   - incrementBookView      → fn_activity_sync_views (fires on userActivity INSERT)
//   - updateBookStatusStats  → fn_reading_list_sync_stats (fires on readingList changes)
//
// Call sites have been removed. This file is kept to avoid import errors during
// any transition period and can be deleted once confirmed clean.

export const incrementBookView = async (_bookId: string): Promise<void> => {};
export const updateBookStatusStats = async (
    _bookId: string,
    _oldStatus: string | null | undefined,
    _newStatus: string | null | undefined,
): Promise<void> => {};