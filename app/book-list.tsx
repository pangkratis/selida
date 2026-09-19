import { useSession } from '@/app/ctx';
import CompactBookGrid from '@/components/compact-book-grid';
import { ThemedText } from '@/components/themed-text';
import { Colors, toTransparent } from '@/constants/theme';
import { Book } from '@/constants/types';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { supabase } from '@/services/supabaseConfig';
import { getRecommendationsForUser, getTrendingBooksByViews } from '@/services/recommendations';
import { logUserActivity } from '@/services/userActivity';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const PAGE_SIZE = 30;
const GRID_COLUMNS = 3;
const GRID_PADDING = 20;
const GRID_GAP = 12;

function SkeletonFooter({ borderColor }: { borderColor: string }) {
    const { width } = useWindowDimensions();
    const cardWidth = (width - GRID_PADDING * 2 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
    return (
        <View style={{ paddingHorizontal: GRID_PADDING, paddingTop: 14 }}>
            {[0, 1].map(row => (
                <View key={row} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 }}>
                    {[0, 1, 2].map(col => (
                        <View key={col} style={{ width: cardWidth }}>
                            <View style={{ width: '100%', aspectRatio: 0.7, borderRadius: 10, backgroundColor: borderColor }} />
                            <View style={{ height: 11, borderRadius: 4, backgroundColor: borderColor, marginTop: 10, width: '75%' }} />
                            <View style={{ height: 9, borderRadius: 4, backgroundColor: borderColor, marginTop: 5, width: '50%' }} />
                        </View>
                    ))}
                </View>
            ))}
        </View>
    );
}

type ListType = 'recommendations' | 'trending' | 'user-reading' | 'user-wishlist';

const USER_LIST_STATUS: Partial<Record<ListType, 'reading' | 'wishlist'>> = {
    'user-reading': 'reading',
    'user-wishlist': 'wishlist',
};

export default function BookListScreen() {
    const { user } = useSession();
    const router = useRouter();
    const colorScheme = useColorScheme() ?? 'light';
    const theme = Colors[colorScheme];
    const params = useLocalSearchParams<{ title: string; type: ListType }>();

    const [books, setBooks] = useState<Book[]>([]);
    const [loadingInitial, setLoadingInitial] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);

    const offsetRef = useRef<number>(0);
    const shownIdsRef = useRef<Set<string>>(new Set());
    const dominantLanguageRef = useRef<string | null>(null);
    const loadingMoreRef = useRef(false);

    const title = params.title || 'Books';
    const type = params.type || 'recommendations';

    const isUserList = type in USER_LIST_STATUS;

    useEffect(() => {
        async function fetchInitial() {
            setLoadingInitial(true);
            try {
                let result: Book[] = [];
                const userStatus = USER_LIST_STATUS[type];
                if (userStatus && user?.uid) {
                    const { data: rlData, error } = await supabase
                        .from('readingList')
                        .select('bookId')
                        .eq('userId', user.uid)
                        .eq('status', userStatus);
                    if (error) throw error;
                    const books = await Promise.all(
                        (rlData ?? []).map(async (row: any) => {
                            const { data } = await supabase.from('books').select('*').eq('id', row.bookId).maybeSingle();
                            return (data ?? { id: row.bookId }) as Book;
                        })
                    );
                    result = books;
                    setHasMore(false);
                } else if (type === 'recommendations' && user?.uid) {
                    result = await getRecommendationsForUser(user.uid, 250);
                } else if (type === 'trending') {
                    result = await getTrendingBooksByViews(100);
                }

                // Derive dominant language from the pool to filter tier 2
                if (result.length > 0) {
                    const langCounts: Record<string, number> = {};
                    result.forEach(b => {
                        if (b.language) langCounts[b.language] = (langCounts[b.language] || 0) + 1;
                    });
                    dominantLanguageRef.current = Object.entries(langCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
                }

                shownIdsRef.current = new Set(result.map(b => b.id));
                setBooks(result);
            } catch (error) {
                console.error('Error fetching book list:', error);
            } finally {
                setLoadingInitial(false);
            }
        }
        fetchInitial();
    }, [type, user?.uid]);

    const loadMore = useCallback(async () => {
        if (isUserList || loadingMoreRef.current || !hasMore || loadingInitial) return;
        loadingMoreRef.current = true;
        setLoadingMore(true);
        try {
            const { data, error } = await supabase
                .from('books')
                .select('*')
                .order('popularityCount', { ascending: false })
                .range(offsetRef.current, offsetRef.current + PAGE_SIZE - 1);

            if (error) throw error;
            if (!data || data.length === 0) { setHasMore(false); return; }

            const newBooks = (data as Book[]).filter(b => {
                if (shownIdsRef.current.has(b.id)) return false;
                if (dominantLanguageRef.current && b.language && b.language !== dominantLanguageRef.current) return false;
                return true;
            });

            offsetRef.current += data.length;
            if (data.length < PAGE_SIZE) setHasMore(false);
            newBooks.forEach(b => shownIdsRef.current.add(b.id));
            setBooks(prev => [...prev, ...newBooks]);
        } catch (e) {
            console.error('Error loading more books:', e);
        } finally {
            loadingMoreRef.current = false;
            setLoadingMore(false);
        }
    }, [hasMore, loadingInitial, isUserList]);

    const handleBookPress = async (item: Book) => {
        if (user?.uid) {
            logUserActivity(user.uid, item.id, 'view_details', `list_${type}`).catch(console.error);
        }
        router.push({
            pathname: '/book-details',
            params: {
                book: JSON.stringify(item),
                origin: type === 'user-reading' ? 'readingList' : undefined,
            },
        });
    };

    const footer = loadingMore
        ? <SkeletonFooter borderColor={theme.border} />
        : !isUserList && !hasMore && books.length > 0
        ? <View style={styles.footer}><ThemedText style={[styles.footerText, { color: theme.secondary }]}>You've seen it all</ThemedText></View>
        : null;

    return (
        <SafeAreaView edges={['top', 'bottom']} style={[styles.safeArea, { backgroundColor: theme.background }]}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: theme.surface }]}>
                    <Ionicons name="arrow-back" size={20} color={theme.text} />
                </TouchableOpacity>
                <View style={styles.headerCenter}>
                    <ThemedText style={styles.headerTitle}>{title}</ThemedText>
                    {!loadingInitial && (
                        <ThemedText style={[styles.headerCount, { color: theme.secondary }]}>
                            {books.length}{hasMore ? '+' : ''} books
                        </ThemedText>
                    )}
                </View>
                <View style={styles.backBtnSpacer} />
            </View>

            <View style={{ flex: 1 }}>
                {loadingInitial ? (
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator size="large" color={theme.primary} />
                        <ThemedText style={[styles.loadingText, { color: theme.secondary }]}>Finding books...</ThemedText>
                    </View>
                ) : books.length === 0 ? (
                    <View style={styles.emptyContainer}>
                        <ThemedText style={{ fontSize: 40, lineHeight: 48, marginBottom: 12 }}>📚</ThemedText>
                        <ThemedText style={{ color: theme.secondary, fontSize: 16 }}>No books found</ThemedText>
                    </View>
                ) : (
                    <CompactBookGrid
                        books={books}
                        onPressBook={handleBookPress}
                        onEndReached={loadMore}
                        onEndReachedThreshold={0.3}
                        ListFooterComponent={footer}
                    />
                )}
                <LinearGradient
                    colors={[toTransparent(theme.background), theme.background]}
                    locations={[0, 0.8]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 0, y: 1 }}
                    pointerEvents="none"
                    style={styles.fadeBottom}
                />
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: 16,
    },
    backBtnSpacer: { width: 40 },
    backBtn: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 6,
        elevation: 2,
    },
    headerCenter: { flex: 1, alignItems: 'center' },
    headerTitle: { fontSize: 18, fontWeight: '700', letterSpacing: -0.3 },
    headerCount: { fontSize: 12, marginTop: 2 },
    loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
    loadingText: { fontSize: 14 },
    emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    footer: { paddingVertical: 32, alignItems: 'center' },
    footerText: { fontSize: 13 },
    fadeBottom: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 40,
    },
});