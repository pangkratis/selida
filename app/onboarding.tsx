import { useSession } from '@/app/ctx';
import HorizontalBookShelf from '@/components/horizontal-book-shelf';
import PageHeader from '@/components/page-header';
import { ThemedText } from '@/components/themed-text';
import { AccentPalette, BorderRadius, Colors, Spacing, roundedFont } from '@/constants/theme';
import { Book } from '@/constants/types';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { logEvent } from '@/services/analytics';
import { logError } from '@/services/errorLog';
import { getTrendingBooksByViews, invalidateRecommendationsCache } from '@/services/recommendations';
import { supabase } from '@/services/supabaseConfig';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    View,
    useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type AddedBook = {
    bookId: string;
    status: string;
    title?: string;
    coverUrl?: string | null;
    authors?: string[];
};

type GenreOption = { slug: string; name_en: string; name_el: string; book_count: number };
type SubcategoryOption = { name: string; book_count: number };
type Topic = { key: string; label: string };

// Genres need this many books to be offered: a chip that leads to a near-empty
// shelf is worse than no chip.
const MIN_GENRE_BOOKS = 20;



const CHIP_ROWS = 4;

export default function OnboardingScreen() {
    const { t, i18n } = useTranslation();
    const { user } = useSession();
    const router = useRouter();
    const colorScheme = useColorScheme() ?? 'light';
    const theme = Colors[colorScheme];
    const { width } = useWindowDimensions();

    const [searchText, setSearchText] = useState('');
    const [searchResults, setSearchResults] = useState<Book[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [addedBooks, setAddedBooks] = useState<AddedBook[]>([]);
    const [genres, setGenres] = useState<GenreOption[]>([]);
    const [subcategories, setSubcategories] = useState<SubcategoryOption[]>([]);
    // Keys are 'g:<slug>' for genres and 's:<name>' for subcategories, so a
    // genre and a subcategory can never collide.
    const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
    const [trendingBooks, setTrendingBooks] = useState<Book[]>([]);
    const [isCompleting, setIsCompleting] = useState(false);
    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const gridGap = 12;
    const columns = 3;
    const cardWidth = (width - Spacing.lg * 2 - gridGap * (columns - 1)) / columns;

    const isActiveSearch = searchText.trim().length > 0;

    // Distribute chips into CHIP_ROWS rows in column-major order so all rows
    // have similarly-ranked chips as the user scrolls horizontally.
    // Genres first, then subcategories, shown as one list of topics. The
    // user sees a single set of tags; they're stored separately on save.
    const topics = useMemo<Topic[]>(() => {
        const isGreek = i18n.language.startsWith('el');
        const genreTopics = genres.map(g => ({
            key: `g:${g.slug}`,
            label: isGreek ? g.name_el : g.name_en,
        }));
        const subTopics = subcategories.map(s => ({ key: `s:${s.name}`, label: s.name }));
        return [...genreTopics, ...subTopics];
    }, [genres, subcategories, i18n.language]);

    const chipRows = useMemo(() => {
        const rows: { topic: Topic; idx: number }[][] =
            Array.from({ length: CHIP_ROWS }, () => []);
        topics.forEach((topic, i) => {
            rows[i % CHIP_ROWS].push({ topic, idx: i });
        });
        return rows;
    }, [topics]);

    useEffect(() => {
        const load = async () => {
            const [{ data: genreRows }, { data: subs }, trending] = await Promise.all([
                supabase.rpc('get_browsable_genres', { p_min_books: MIN_GENRE_BOOKS }),
                supabase.rpc('get_onboarding_subcategories', { p_limit: 20 }),
                getTrendingBooksByViews(20),
            ]);
            if (genreRows) setGenres(genreRows as GenreOption[]);
            if (subs) setSubcategories(subs);
            setTrendingBooks(trending);
        };
        load();
    }, []);

    useEffect(() => {
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
        if (!searchText.trim()) { setSearchResults([]); return; }

        searchTimeoutRef.current = setTimeout(async () => {
            setIsSearching(true);
            try {
                const { data, error } = await supabase.rpc('search_books', { p_query: searchText.trim(), p_limit: 12 });
                if (error) throw error;
                setSearchResults(((data ?? []) as any[]).map(row => ({
                    ...row,
                    authors: row.authors ?? [],
                    categories: row.categories ?? [],
                    description: row.description ?? '',
                    edition: row.edition ?? '',
                    isActive: row.isActive ?? true,
                    popularityCount: row.popularityCount ?? 0,
                    publisher: row.publisher ?? '',
                    lastFetchedAt: row.lastFetchedAt ? new Date(row.lastFetchedAt) : new Date(),
                })));
            } catch (error) {
                void logError(error, 'onboarding/search');
                setSearchResults([]);
            } finally {
                setIsSearching(false);
            }
        }, 400);

        return () => { if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current); };
    }, [searchText]);

    useEffect(() => {
        if (!user?.uid) return;
        const userId = user.uid;

        const loadReadingList = async () => {
            const { data: rlData } = await supabase
                .from('readingList').select('bookId, status').eq('userId', userId);
            const items: AddedBook[] = await Promise.all(
                (rlData ?? []).map(async (row: any) => {
                    const item: AddedBook = { bookId: row.bookId, status: row.status };
                    try {
                        const { data: bookData } = await supabase
                            .from('books').select('title, coverUrl, authors').eq('id', row.bookId).maybeSingle();
                        if (bookData) {
                            item.title = bookData.title;
                            item.coverUrl = bookData.coverUrl;
                            item.authors = bookData.authors;
                        }
                    } catch { /* book details unavailable */ }
                    return item;
                })
            );
            setAddedBooks(items);
        };

        loadReadingList();

        const channel = supabase
            .channel(`onboarding-rl-${userId}-${Date.now()}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'readingList', filter: `userId=eq.${userId}` },
                () => { loadReadingList(); })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [user?.uid]);

    // Onboarding funnel, step 1 of 3. Fired once on mount so the denominator
    // exists: without it, someone who opens this screen and quits is
    // indistinguishable from someone who never reached it.
    useEffect(() => {
        logEvent('onboarding_started', 'onboarding');
    }, []);

    // Step 2 of 3. The finish button only renders at >= 3 selected chips, so
    // this is the actual gate people get stuck behind. The gap between
    // onboarding_started and this event is the drop-off that was previously
    // invisible; the gap between this and onboarding_complete is people who
    // saw the button and still didn't press it.
    const gateLogged = useRef(false);
    useEffect(() => {
        if (gateLogged.current || selectedKeys.length < 3) return;
        gateLogged.current = true;
        logEvent('onboarding_gate_reached', 'onboarding', {
            topicCount: selectedKeys.length,
        });
    }, [selectedKeys.length]);

    const toggleTopic = (key: string) => {
        setSelectedKeys(prev =>
            prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
        );
    };

    const handleBookPress = (book: Book) => {
        router.push({ pathname: '/book-details', params: { book: JSON.stringify(book) } });
    };

    const completeOnboarding = async () => {
        if (!user?.uid || isCompleting) return;
        setIsCompleting(true);
        try {
            const preferredGenres = selectedKeys.filter(k => k.startsWith('g:')).map(k => k.slice(2));
            const preferredSubcategories = selectedKeys.filter(k => k.startsWith('s:')).map(k => k.slice(2));
            const { error } = await supabase.from('users').update({
                onboardingComplete: true,
                preferredGenres,
                preferredSubcategories,
            }).eq('id', user.uid);
            if (error) throw error;
            // Drop any pool cached before these picks existed, so they take
            // effect on the first home screen load.
            invalidateRecommendationsCache(user.uid);

            // Final step of the onboarding funnel — see onboarding_started
            // and onboarding_gate_reached for the two steps before it.
            logEvent('onboarding_complete', 'onboarding', {
                topicCount: selectedKeys.length,
                booksAdded: addedBooks.length,
            });

            router.replace('/');
        } catch (err) {
            void logError(err, 'onboarding/completeOnboarding');
            setIsCompleting(false);
        }
    };

    if (!user) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={AccentPalette[0]} />
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
                <ScrollView
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                >
                    <PageHeader
                        eyebrow={t('onboardingEyebrow')}
                        title={t('onboardingTitle')}
                        rightSlot={
                            <Image
                                source={require('../assets/images/selida-mark.png')}
                                style={{ width: 56, height: 56 * (600 / 1040) }}
                                contentFit="contain"
                            />
                        }
                    />

                    <ThemedText style={[styles.subtitle, { color: theme.secondary }]}>
                        {t('onboardingSubtitle')}
                    </ThemedText>

                    {/* ── Search bar ────────────────────────────────── */}
                    <View style={[styles.searchBar, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                        <Ionicons name="search" size={18} color={theme.icon} />
                        <TextInput
                            style={[styles.searchInput, { color: theme.text, fontFamily: roundedFont('400') }]}
                            placeholder={t('onboardingSearchPlaceholder')}
                            placeholderTextColor={theme.secondary}
                            value={searchText}
                            onChangeText={setSearchText}
                            returnKeyType="search"
                        />
                        {searchText.length > 0 && (
                            <TouchableOpacity onPress={() => { setSearchText(''); setSearchResults([]); }}>
                                <Ionicons name="close-circle" size={18} color={theme.icon} />
                            </TouchableOpacity>
                        )}
                    </View>

                    {/* ── Search states (shown only while searching) ── */}
                    {isActiveSearch && isSearching && (
                        <View style={styles.searchingContainer}>
                            <ActivityIndicator size="small" color={AccentPalette[0]} />
                        </View>
                    )}

                    {isActiveSearch && !isSearching && searchResults.length > 0 && (
                        <View style={styles.section}>
                            <ThemedText style={[styles.sectionTitle, { color: theme.secondary }]}>
                                {t('onboardingResults')}
                            </ThemedText>
                            <View style={styles.resultsGrid}>
                                {searchResults.map((book, index) => (
                                    <TouchableOpacity
                                        key={`${book.id}-${index}`}
                                        style={{ width: cardWidth, marginBottom: 14 }}
                                        onPress={() => handleBookPress(book)}
                                        activeOpacity={0.85}
                                    >
                                        <Image
                                            source={{ uri: book.coverUrl || undefined }}
                                            style={[styles.resultCover, { backgroundColor: theme.border }]}
                                            contentFit="cover"
                                            transition={300}
                                        />
                                        <ThemedText style={styles.resultTitle} numberOfLines={2}>
                                            {book.title || t('unknownTitle')}
                                        </ThemedText>
                                        <ThemedText style={[styles.resultAuthor, { color: theme.secondary }]} numberOfLines={1}>
                                            {book.authors?.[0] || t('unknownAuthor')}
                                        </ThemedText>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>
                    )}

                    {isActiveSearch && !isSearching && searchResults.length === 0 && (
                        <View style={styles.emptyContainer}>
                            <Ionicons name="search-outline" size={40} color={theme.border} />
                            <ThemedText style={[styles.emptyText, { color: theme.secondary }]}>
                                {t('onboardingNoResults')}
                            </ThemedText>
                        </View>
                    )}

                    {/* ── Genre chips — multi-row horizontal scroll ─── */}
                    {!isActiveSearch && topics.length > 0 && (
                        <View style={styles.chipsSection}>
                            <View style={styles.chipsSectionHeader}>
                                <View style={{ flex: 1 }}>
                                    <ThemedText style={[styles.sectionTitle, { color: theme.secondary, marginBottom: 2 }]}>
                                        {t('onboardingWhatDoYouEnjoy')}
                                    </ThemedText>
                                    {selectedKeys.length < 3 && (
                                        <ThemedText style={[styles.chipsHint, { color: theme.secondary }]}>
                                            {t('onboardingSelectMoreHint', { count: 3 - selectedKeys.length })}
                                        </ThemedText>
                                    )}
                                </View>
                                {selectedKeys.length > 0 && (
                                    <View style={styles.selectedRow}>
                                        <TouchableOpacity
                                            onPress={() => setSelectedKeys([])}
                                            activeOpacity={0.7}
                                            style={[styles.checkbox, { borderColor: AccentPalette[3], borderWidth: 2 }]}
                                        >
                                            <Ionicons name="checkmark" size={15} color={AccentPalette[3]} />
                                        </TouchableOpacity>
                                        <ThemedText style={[styles.selectedCount, { color: theme.secondary }]}>
                                            <ThemedText style={[styles.selectedCountNum, { color: theme.secondary }]}>
                                                {selectedKeys.length}
                                            </ThemedText>
                                            {' selected'}
                                        </ThemedText>
                                    </View>
                                )}
                            </View>
                            <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                contentContainerStyle={styles.chipsScroll}
                            >
                                <View style={styles.chipsColumns}>
                                    {chipRows.map((row, rowIdx) => (
                                        <View key={rowIdx} style={styles.chipsRow}>
                                            {row.map(({ topic, idx }) => {
                                                const selected = selectedKeys.includes(topic.key);
                                                const accent = AccentPalette[idx % AccentPalette.length];
                                                return (
                                                    <TouchableOpacity
                                                        key={topic.key}
                                                        style={[
                                                            styles.chip,
                                                            {
                                                                backgroundColor: selected ? '#fff' : accent,
                                                                borderColor: selected ? accent : 'transparent',
                                                                shadowColor: accent,
                                                                elevation: 4,
                                                            },
                                                        ]}
                                                        onPress={() => toggleTopic(topic.key)}
                                                        activeOpacity={0.75}
                                                    >
                                                        <ThemedText
                                                            numberOfLines={1}
                                                            style={[
                                                                styles.chipText,
                                                                {
                                                                    color: selected ? accent : '#fff',
                                                                    fontFamily: roundedFont(selected ? '800' : '600'),
                                                                },
                                                            ]}
                                                        >
                                                            {topic.label}
                                                        </ThemedText>
                                                    </TouchableOpacity>
                                                );
                                            })}
                                        </View>
                                    ))}
                                </View>
                            </ScrollView>
                        </View>
                    )}

                    {/* ── Trending shelf (hidden while searching) ───── */}
                    {!isActiveSearch && trendingBooks.length > 0 && (
                        <View style={styles.trendingSection}>
                            <View style={styles.sectionHeaderRow}>
                                <ThemedText style={[styles.sectionTitle, { color: theme.secondary, marginBottom: 0 }]}>
                                    {t('onboardingPopularRightNow')}
                                </ThemedText>
                                <TouchableOpacity
                                    onPress={() => router.push({ pathname: '/book-list', params: { type: 'trending', title: t('onboardingPopularRightNow') } })}
                                    style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingLeft: 8 }}
                                >
                                    {[AccentPalette[0], AccentPalette[1], AccentPalette[2]].map((color, i) => (
                                        <View key={i} style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: color }} />
                                    ))}
                                </TouchableOpacity>
                            </View>
                            <HorizontalBookShelf
                                books={trendingBooks}
                                keyPrefix="ob-trend"
                                contentPaddingHorizontal={0}
                                onPressBook={handleBookPress}
                            />
                        </View>
                    )}

                    {/* ── Added books shelf (shown below trending) ──── */}
                    {!isActiveSearch && addedBooks.length > 0 && (
                        <View style={styles.trendingSection}>
                            <ThemedText style={[styles.sectionTitle, { color: theme.secondary }]}>
                                {t('onboardingYourBooks', { count: addedBooks.length })}
                            </ThemedText>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.addedBooksRow}>
                                {addedBooks.map((item) => {
                                    return (
                                        <View key={item.bookId} style={styles.addedBookCard}>
                                            <Image
                                                source={{ uri: item.coverUrl || undefined }}
                                                style={[styles.addedBookCover, { backgroundColor: theme.border }]}
                                                contentFit="cover"
                                                transition={200}
                                            />
                                            <ThemedText style={styles.addedBookTitle} numberOfLines={1}>
                                                {item.title || t('untitled')}
                                            </ThemedText>
                                        </View>
                                    );
                                })}
                            </ScrollView>
                        </View>
                    )}

                    <View style={{ height: selectedKeys.length >= 3 ? 120 : 40 }} />
                </ScrollView>

                {/* ── Finish button (sticky, shown when ≥3 categories selected) ── */}
                {selectedKeys.length >= 3 && (
                    <View style={[styles.bottomBar, { backgroundColor: theme.background, borderTopColor: theme.border }]}>
                        <TouchableOpacity
                            style={[styles.finishButton, { backgroundColor: AccentPalette[1], opacity: isCompleting ? 0.6 : 1 }]}
                            onPress={completeOnboarding}
                            activeOpacity={0.85}
                            disabled={isCompleting}
                        >
                            <Ionicons name="color-wand" size={18} color="#fff" style={{ marginRight: 8 }} />
                            <ThemedText style={styles.finishButtonText}>
                                {isCompleting ? t('loading') : t('onboardingFinish')}
                            </ThemedText>
                        </TouchableOpacity>
                    </View>
                )}
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    scrollContent: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg },
    subtitle: { fontSize: 14, marginTop: Spacing.sm, lineHeight: 20 },

    // Search
    searchBar: {
        marginTop: Spacing.lg,
        borderWidth: 1,
        borderRadius: 14,
        minHeight: 50,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    searchInput: { flex: 1, fontSize: 15, height: '100%' },

    // Sections
    section: { marginTop: Spacing.lg },
    sectionTitle: { fontSize: 16, fontWeight: '600', marginBottom: Spacing.sm },
    chipsHint: { fontSize: 12.5, fontWeight: '500' },

    // Chips
    chipsSectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: Spacing.sm,
    },
    chipsScroll: { paddingBottom: 2 },
    chipsColumns: { flexDirection: 'column', gap: 8 },
    chipsRow: { flexDirection: 'row', gap: 8 },
    chip: {
        borderRadius: 20,
        borderWidth: 2,
        paddingVertical: 7,
        paddingHorizontal: 14,
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.35,
        shadowRadius: 6,
    },
    chipText: { fontSize: 13, fontWeight: '600' },
    selectedRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    selectedCount: { fontSize: 14, fontWeight: '500' },
    selectedCountNum: { fontSize: 14, fontWeight: '800' },
    checkbox: {
        width: 22,
        height: 22,
        borderRadius: 6,
        alignItems: 'center',
        justifyContent: 'center',
    },

    // Added books
    addedBooksRow: { gap: 12 },
    addedBookCard: { width: 90 },
    addedBookCover: { width: 90, height: 128, borderRadius: 10, marginBottom: 6 },
    addedBookTitle: { fontSize: 11, fontWeight: '600', lineHeight: 14 },
    statusBadge: {
        alignSelf: 'flex-start',
        borderRadius: 20,
        borderWidth: 1,
        paddingHorizontal: 6,
        paddingVertical: 2,
        marginTop: 4,
    },
    statusBadgeText: { fontSize: 9, fontWeight: '600' },

    sectionHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: Spacing.sm,
    },
    chipsSection: { marginTop: Spacing.xl + Spacing.lg },
    trendingSection: { marginTop: Spacing.xl + Spacing.md },

    // Search results
    resultsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
    resultCover: { width: '100%', aspectRatio: 0.7, borderRadius: 10, marginBottom: 10 },
    resultTitle: { fontSize: 13, fontWeight: '700', lineHeight: 17 },
    resultAuthor: { marginTop: 3, fontSize: 11, fontWeight: '500' },
    searchingContainer: { paddingVertical: Spacing.xl, alignItems: 'center' },
    emptyContainer: { paddingVertical: Spacing.xl, alignItems: 'center', gap: Spacing.sm },
    emptyText: { fontSize: 14, textAlign: 'center' },

    // Bottom bar
    bottomBar: {
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.md,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    finishButton: {
        borderRadius: BorderRadius.pill,
        paddingVertical: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    finishButtonText: {
        fontSize: 16,
        fontWeight: '700',
        color: '#fff',
        fontFamily: roundedFont('700'),
    },
});
