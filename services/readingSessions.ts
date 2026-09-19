import { supabase } from '@/services/supabaseConfig';

const DEFAULT_PAGE_COUNT = 200;

export const startReadingSession = async (uid: string, bookId: string): Promise<void> => {
    const { error } = await supabase
        .from('readingList')
        .update({ lastSessionStart: new Date().toISOString(), isReading: true })
        .eq('userId', uid)
        .eq('bookId', bookId);
    if (error) throw error;
};

export const stopReadingSession = async (
    uid: string,
    bookId: string,
    pageCount?: number
): Promise<{ totalSeconds: number; progressPercentage: number }> => {
    const { data, error } = await supabase
        .from('readingList')
        .select('lastSessionStart, totalReadingTimeSeconds, progressPercentage')
        .eq('userId', uid)
        .eq('bookId', bookId)
        .single();

    if (error || !data) throw new Error('Reading list entry not found');

    const sessionStart = data.lastSessionStart ? new Date(data.lastSessionStart) : null;
    if (!sessionStart) {
        return {
            totalSeconds: data.totalReadingTimeSeconds || 0,
            progressPercentage: data.progressPercentage || 0,
        };
    }

    const elapsedMs = Date.now() - sessionStart.getTime();
    const durationSeconds = Math.max(0, elapsedMs / 1000);
    const previousTotal = data.totalReadingTimeSeconds || 0;
    const newTotal = previousTotal + durationSeconds;

    const pages = pageCount || DEFAULT_PAGE_COUNT;
    const totalMinutes = newTotal / 60;
    const progressPercentage = Math.min(Math.round((totalMinutes / pages) * 100), 100);

    await supabase
        .from('readingList')
        .update({ totalReadingTimeSeconds: newTotal, lastSessionStart: null, isReading: false, progressPercentage })
        .eq('userId', uid)
        .eq('bookId', bookId);

    await supabase.from('readingSessions').insert({
        userId: uid,
        bookId,
        durationSeconds,
        createdAt: new Date().toISOString(),
    });

    return { totalSeconds: newTotal, progressPercentage };
};

export const getReadingProgress = async (
    uid: string,
    bookId: string
): Promise<{ totalSeconds: number; progressPercentage: number; isReading: boolean; lastSessionStartMs: number | null }> => {
    const { data } = await supabase
        .from('readingList')
        .select('totalReadingTimeSeconds, progressPercentage, isReading, lastSessionStart')
        .eq('userId', uid)
        .eq('bookId', bookId)
        .maybeSingle();

    if (!data) return { totalSeconds: 0, progressPercentage: 0, isReading: false, lastSessionStartMs: null };

    const lastSessionStartMs = data.lastSessionStart ? new Date(data.lastSessionStart).getTime() : null;
    return {
        totalSeconds: data.totalReadingTimeSeconds || 0,
        progressPercentage: data.progressPercentage || 0,
        isReading: data.isReading || false,
        lastSessionStartMs,
    };
};