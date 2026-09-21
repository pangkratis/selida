import { logError } from './errorLog';
import { supabase } from './supabaseConfig';

/**
 * First-party book-activity logging — writes to our own `userActivity`
 * table, no analytics SDK involved, which is what keeps the privacy policy's
 * "no analytics SDKs / no tracking" claim true.
 *
 * Scope is deliberately book events only. App-level events (funnel,
 * retention, search) live in services/analytics.ts and write to `appEvents`,
 * because they must also work with no signed-in user — which this table,
 * with its `not null userId` and `auth.uid() = "userId"` policy, cannot do.
 */

/** Events tied to a specific book. */
export type BookAction =
  | 'view_details'
  | 'add_to_reading'
  | 'add_to_wishlist'
  | 'mark_completed'
  | 'remove_from_list';

/**
 * Log an action against a specific book.
 *
 * Note `bookId` is required here on purpose: `fn_activity_sync_views`
 * increments `bookStats.views` only for `view_details` rows that have one,
 * so a book event silently missing its id would be lost from the stats.
 */
export const logUserActivity = async (
    userId: string,
    bookId: string,
    action: BookAction,
    context: string,
    metadata?: Record<string, unknown>
) => {
    try {
        if (!userId || !bookId) {
            void logError(new Error('logUserActivity called without userId or bookId'), 'userActivity/missingIds');
            return;
        }
        await supabase.from('userActivity').insert({
            userId,
            bookId,
            action,
            context,
            metadata: metadata ?? null,
            createdAt: new Date().toISOString(),
        });
    } catch (error) {
        void logError(error, 'userActivity/insert');
    }
};

