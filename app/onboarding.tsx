import { useSession } from '@/app/ctx';
import HorizontalBookShelf from '@/components/horizontal-book-shelf';
import PageHeader from '@/components/page-header';
import { ThemedText } from '@/components/themed-text';
import { AccentPalette, BorderRadius, Colors, Spacing, roundedFont } from '@/constants/theme';
import { Book } from '@/constants/types';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { logEvent } from '@/services/analytics';
import { searchBiblionetBooks } from '@/services/biblionet-api';
import { logError } from '@/services/errorLog';
import { getTrendingBooksByViews } from '@/services/recommendations';
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

type PopularSubcategory = {
    name: string;
    book_count: number;
    total_popularity: number;
};



const CHIP_ROWS = 4;

export default function OnboardingScreen() {
    const { t } = useTranslation();
    const { user } = useSession();
    const router = useRouter();
    const colorScheme = useColorScheme() ?? 'light';
    const theme = Colors[colorScheme];
    const { width } = useWindowDimensions();

    const [searchText, setSearchText] = useState('');
    const [searchResults, setSearchResults] = useState<Book[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [addedBooks, setAddedBooks] = useState<AddedBook[]>([]);
    const [popularSubcategories, setPopularSubcategories] = useState<PopularSubcategory[]>([]);
    const [selectedSubcategories, setSelectedSubcategories] = useState<string[]>([]);
    const [trendingBooks, setTrendingBooks] = useState<Book[]>([]);
    const [isCompleting, setIsCompleting] = useState(false);
    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const gridGap = 12;
    const columns = 3;
    const cardWidth = (width - Spacing.lg * 2 - gridGap * (columns - 1)) / columns;

    const isActiveSearch = searchText.trim().length > 0;

    // Distribute chips into CHIP_ROWS rows in column-major order so all rows
    // have similarly-ranked chips as the user scrolls horizontally.
    const chipRows = useMemo(() => {
        const rows: { sub: PopularSubcategory; idx: number }[][] =
            Array.from({ length: CHIP_ROWS }, () => []);
        popularSubcategories.forEach((sub, i) => {
            rows[i % CHIP_ROWS].push({ sub, idx: i });
        });
        return rows;
    }, [popularSubcategories]);

    useEffect(() => {
        const load = async () => {
            const [{ data: subs }, trending] = await Promise.all([
                supabase.rpc('get_popular_subcategories', { p_limit: 40 }),
                getTrendingBooksByViews(20),
            ]);
            if (subs) setPopularSubcategories(subs);
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
                const results = await searchBiblionetBooks(searchText.trim());
                setSearchResults(results.slice(0, 12));
            } catch {
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
        if (gateLogged.current || selectedSubcategories.length < 3) return;
        gateLogged.current = true;
        logEvent('onboarding_gate_reached', 'onboarding', {
            subcategoryCount: selectedSubcategories.length,
        });
    }, [selectedSubcategories.length]);

    const toggleSubcategory = (name: string) => {
        setSelectedSubcategories(prev =>
            prev.includes(name) ? prev.filter(s => s !== name) : [...prev, name]
        );
    };

    const handleBookPress = (book: Book) => {
        router.push({ pathname: '/book-details', params: { book: JSON.stringify(book) } });
    };

    const completeOnboarding = async () => {
        if (!user?.uid || isCompleting) return;
        setIsCompleting(true);
        try {
            const { error } = await supabase.from('users').update({
                onboardingComplete: true,
                preferredSubcategories: selectedSubcategories,
            }).eq('id', user.uid);
            if (error) throw error;

            // Final step of the onboarding funnel — see onboarding_started
            // and onboarding_gate_reached for the two steps before it.
            logEvent('onboarding_complete', 'onboarding', {
                subcategoryCount: selectedSubcategories.length,
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
                    {!isActiveSearch && popularSubcategories.length > 0 && (
                        <View style={styles.chipsSection}>
                            <View style={styles.chipsSectionHeader}>
                                <View style={{ flex: 1 }}>
                                    <ThemedText style={[styles.sectionTitle, { color: theme.secondary, marginBottom: 2 }]}>
                                        {t('onboardingWhatDoYouEnjoy')}
                                    </ThemedText>
                                    {selectedSubcategories.length < 3 && (
                                        <ThemedText style={[styles.chipsHint, { color: theme.secondary }]}>
                                            {t('onboardingSelectMoreHint', { count: 3 - selectedSubcategories.length })}
                                        </ThemedText>
                                    )}
                                </View>
                                {selectedSubcategories.length > 0 && (
                                    <View style={styles.selectedRow}>
                                        <TouchableOpacity
                                            onPress={() => setSelectedSubcategories([])}
                                            activeOpacity={0.7}
                                            style={[styles.checkbox, { borderColor: AccentPalette[3], borderWidth: 2 }]}
                                        >
                                            <Ionicons name="checkmark" size={15} color={AccentPalette[3]} />
                                        </TouchableOpacity>
                                        <ThemedText style={[styles.selectedCount, { color: theme.secondary }]}>
                                            <ThemedText style={[styles.selectedCountNum, { color: theme.secondary }]}>
                                                {selectedSubcategories.length}
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
                                            {row.map(({ sub, idx }) => {
                                                const selected = selectedSubcategories.includes(sub.name);
                                                const accent = AccentPalette[idx % AccentPalette.length];
                                                return (
                                                    <TouchableOpacity
                                                        key={sub.name}
                                                        style={[
                                                            styles.chip,
                                                            {
                                                                backgroundColor: selected ? '#fff' : accent,
                                                                borderColor: selected ? accent : 'transparent',
                                                                shadowColor: accent,
                                                                elevation: 4,
                                                            },
                                                        ]}
                                                        onPress={() => toggleSubcategory(sub.name)}
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
                                                            {sub.name}
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

                    <View style={{ height: selectedSubcategories.length >= 3 ? 120 : 40 }} />
                </ScrollView>

                {/* ── Finish button (sticky, shown when ≥3 categories selected) ── */}
                {selectedSubcategories.length >= 3 && (
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
