import { supabase } from './supabaseConfig';

export const logUserActivity = async (
    userId: string,
    bookId: string,
    action: string,
    context: string
) => {
    try {
        if (!userId || !bookId) {
            console.warn('logUserActivity: Missing userId or bookId');
            return;
        }
        await supabase.from('userActivity').insert({
            userId,
            bookId,
            action,
            context,
            createdAt: new Date().toISOString(),
        });
    } catch (error) {
        console.error('Error logging user activity:', error);
    }
};