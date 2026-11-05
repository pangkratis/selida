import { useSession } from '@/app/ctx';
import HorizontalBookShelf from '@/components/horizontal-book-shelf';
import { ThemedText } from '@/components/themed-text';
import { caps } from '@/constants/text';
import { AccentPalette, BorderRadius, Colors, Spacing, mixHex, roundedFont } from '@/constants/theme';
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
    BackHandler,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    View,
    useWindowDimensions,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
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
const MIN_TOPICS = 3;

// 0 = welcome, 1 = topics, 2 = books (optional), 3 = recap.
type Step = 0 | 1 | 2 | 3;
const LAST_STEP = 3;


export default function OnboardingScreen() {
    const { t, i18n } = useTranslation();
    const { user } = useSession();
    const router = useRouter();
    const colorScheme = useColorScheme() ?? 'light';
    const theme = Colors[colorScheme];
    const { width } = useWindowDimensions();

    const [step, setStep] = useState<Step>(0);
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
    const scrollRef = useRef<ScrollView>(null);

    const gridGap = 12;
    const columns = 3;
    const cardWidth = (width - Spacing.lg * 2 - gridGap * (columns - 1)) / columns;
    const isActiveSearch = searchText.trim().length > 0;

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

    const selectedTopics = useMemo(
        () => topics.filter(topic => selectedKeys.includes(topic.key)),
        [topics, selectedKeys],
    );

    useEffect(() => {
        const load = async () => {
            const [genreResult, subResult, trending] = await Promise.all([
                supabase.rpc('get_browsable_genres', { p_min_books: MIN_GENRE_BOOKS }),
                supabase.rpc('get_onboarding_subcategories', { p_limit: 20 }),
                getTrendingBooksByViews(20),
            ]);
            if (genreResult.error) void logError(genreResult.error, 'onboarding/genres');
            else if (genreResult.data) setGenres(genreResult.data as GenreOption[]);
            if (subResult.error) void logError(subResult.error, 'onboarding/subcategories');
            else if (subResult.data) setSubcategories(subResult.data);
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

    // Step 2 of 3. Next on the topics step only unlocks at MIN_TOPICS picks, so
    // this is the gate people get stuck behind.
    const gateLogged = useRef(false);
    useEffect(() => {
        if (gateLogged.current || selectedKeys.length < MIN_TOPICS) return;
        gateLogged.current = true;
        logEvent('onboarding_gate_reached', 'onboarding', {
            topicCount: selectedKeys.length,
        });
    }, [selectedKeys.length]);

    // Android back button walks back through the steps instead of leaving.
    useEffect(() => {
        const sub = BackHandler.addEventListener('hardwareBackPress', () => {
            if (step === 0) return false;
            setStep(s => (s - 1) as Step);
            return true;
        });
        return () => sub.remove();
    }, [step]);

    useEffect(() => {
        scrollRef.current?.scrollTo({ y: 0, animated: false });
    }, [step]);

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

    // Each step has its own colour: progress segment, eyebrow and button.
    const stepColors = [AccentPalette[1], AccentPalette[0], AccentPalette[4], AccentPalette[3]];
    const stepAccent = stepColors[step];
    const softTint = (accent: string, ratio = colorScheme === 'dark' ? 0.2 : 0.12) => mixHex(theme.surface, accent, ratio);
    const topicsMissing = Math.max(MIN_TOPICS - selectedKeys.length, 0);
    // Unfilled progress segments / disabled button: visible on both themes.
    const track = mixHex(theme.surface, theme.secondary, colorScheme === 'dark' ? 0.3 : 0.2);
    // Accent colours (esp. yellow) are too light for small text; pull them toward the text colour.
    const inkOf = (accent: string) => mixHex(accent, theme.text, colorScheme === 'dark' ? 0.1 : 0.4);

    /* ── Bottom button, per step ───────────────────────────────────── */
    const primary = (() => {
        switch (step) {
            case 0: return { label: t('obIntroStart'), enabled: true, onPress: () => setStep(1) };
            case 1: return {
                label: topicsMissing > 0 ? t('obTopicsPickMore', { count: topicsMissing }) : t('obNextToBooks'),
                enabled: topicsMissing === 0,
                onPress: () => setStep(2),
            };
            case 2: return {
                label: addedBooks.length > 0 ? t('obNextToRecap') : t('obBooksSkip'),
                enabled: true,
                onPress: () => setStep(3),
            };
            default: return {
                label: isCompleting ? t('loading') : t('obRecapFinish'),
                enabled: !isCompleting,
                onPress: completeOnboarding,
            };
        }
    })();

    /* ── Top bar: back + progress ──────────────────────────────────── */
    const topBar = (
        <View style={styles.topBar}>
            <View style={styles.topBarRow}>
                {step > 0 ? (
                    <TouchableOpacity
                        onPress={() => setStep(s => (s - 1) as Step)}
                        style={styles.backButton}
                        accessibilityRole="button"
                        accessibilityLabel={t('obBack')}
                        hitSlop={8}
                    >
                        <Ionicons name="chevron-back" size={20} color={theme.secondary} />
                        <ThemedText style={[styles.backText, { color: theme.secondary }]}>{t('obBack')}</ThemedText>
                    </TouchableOpacity>
                ) : <View />}
                <ThemedText numberOfLines={1} style={[styles.stepLabel, { color: theme.secondary }]}>
                    {caps(step === 0 ? t('obWelcomeLabel') : t('obStepOf', { step, total: LAST_STEP }))}
                </ThemedText>
            </View>
            <View style={styles.progressRow} accessibilityRole="progressbar"
                accessibilityValue={{ min: 0, max: LAST_STEP, now: step }}>
                {[0, 1, 2, 3].map(i => (
                    <View
                        key={i}
                        style={[
                            styles.progressSegment,
                            { backgroundColor: i <= step ? stepColors[i] : track },
                        ]}
                    />
                ))}
            </View>
        </View>
    );

    const heading = (eyebrow: string, title: string, body: string) => (
        <View style={styles.headingBlock}>
            <ThemedText style={[styles.eyebrow, { color: inkOf(stepAccent) }]}>{caps(eyebrow)}</ThemedText>
            <ThemedText style={[styles.title, { color: theme.text }]}>{title}</ThemedText>
            <ThemedText style={[styles.body, { color: theme.secondary }]}>{body}</ThemedText>
        </View>
    );

    /* ── Step 0: welcome ───────────────────────────────────────────── */
    const introSteps = [
        { icon: 'pricetags' as const, color: AccentPalette[0], title: t('obIntroStep1Title'), text: t('obIntroStep1Text') },
        { icon: 'library' as const, color: AccentPalette[4], title: t('obIntroStep2Title'), text: t('obIntroStep2Text') },
        { icon: 'sparkles' as const, color: AccentPalette[3], title: t('obIntroStep3Title'), text: t('obIntroStep3Text') },
    ];
    const renderIntro = () => (
        <>
            <View style={styles.introHero}>
                <Image
                    source={require('../assets/images/selida-mark.png')}
                    style={{ width: 120, height: 120 * (600 / 1040) }}
                    contentFit="contain"
                />
            </View>
            {heading(t('obIntroEyebrow'), t('obIntroTitle'), t('obIntroBody'))}

            <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>{t('obIntroHowTitle')}</ThemedText>
            <View style={styles.introList}>
                {introSteps.map(item => (
                    <View key={item.title} style={[styles.introItem, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                        <View style={[styles.introIcon, { backgroundColor: softTint(item.color, 0.2) }]}>
                            <Ionicons name={item.icon} size={20} color={item.color} />
                        </View>
                        <View style={{ flex: 1 }}>
                            <ThemedText style={[styles.introItemTitle, { color: theme.text }]}>{item.title}</ThemedText>
                            <ThemedText style={[styles.introItemText, { color: theme.secondary }]}>{item.text}</ThemedText>
                        </View>
                    </View>
                ))}
            </View>
            <View style={styles.noteRow}>
                <Ionicons name="time-outline" size={16} color={theme.secondary} />
                <ThemedText style={[styles.note, { color: theme.secondary }]}>{t('obIntroTime')}</ThemedText>
            </View>
        </>
    );

    /* ── Step 1: topics ────────────────────────────────────────────── */
    const renderTopics = () => (
        <>
            {heading(t('obTopicsEyebrow'), t('obTopicsTitle'), t('obTopicsBody'))}
            <View style={[styles.counter, { backgroundColor: softTint(topicsMissing === 0 ? theme.tabFinished : AccentPalette[0]) }]}>
                <Ionicons
                    name={topicsMissing === 0 ? 'checkmark-circle' : 'ellipse-outline'}
                    size={18}
                    color={topicsMissing === 0 ? theme.tabFinished : AccentPalette[0]}
                />
                <ThemedText style={[styles.counterText, { color: theme.text }]}>
                    {topicsMissing === 0
                        ? t('obTopicsDone', { count: selectedKeys.length })
                        : t('obTopicsProgress', { count: selectedKeys.length, total: MIN_TOPICS })}
                </ThemedText>
                {selectedKeys.length > 0 && (
                    <TouchableOpacity onPress={() => setSelectedKeys([])} hitSlop={8}>
                        <ThemedText style={[styles.clearText, { color: theme.secondary }]}>{t('obTopicsClear')}</ThemedText>
                    </TouchableOpacity>
                )}
            </View>
            {topics.length === 0 ? (
                <ActivityIndicator style={{ marginTop: Spacing.xl }} color={AccentPalette[0]} />
            ) : (
                <View style={styles.chipsWrap}>
                    {topics.map((topic, idx) => {
                        const selected = selectedKeys.includes(topic.key);
                        const accent = AccentPalette[idx % AccentPalette.length];
                        return (
                            <TouchableOpacity
                                key={topic.key}
                                style={[
                                    styles.chip,
                                    {
                                        backgroundColor: selected ? accent : softTint(accent, colorScheme === 'dark' ? 0.18 : 0.1),
                                        borderColor: selected ? accent : mixHex(theme.surface, accent, 0.35),
                                    },
                                ]}
                                onPress={() => toggleTopic(topic.key)}
                                activeOpacity={0.75}
                                accessibilityRole="checkbox"
                                accessibilityState={{ checked: selected }}
                            >
                                {selected && <Ionicons name="checkmark" size={14} color="#fff" style={{ marginRight: 4 }} />}
                                <ThemedText
                                    numberOfLines={1}
                                    style={[
                                        styles.chipText,
                                        {
                                            color: selected ? '#fff' : theme.text,
                                            fontFamily: roundedFont(selected ? '700' : '600'),
                                            fontWeight: selected ? '700' : '600',
                                        },
                                    ]}
                                >
                                    {topic.label}
                                </ThemedText>
                            </TouchableOpacity>
                        );
                    })}
                </View>
            )}
        </>
    );

    /* ── Step 2: books ─────────────────────────────────────────────── */
    const renderBooks = () => (
        <>
            {heading(t('obBooksEyebrow'), t('obBooksTitle'), t('obBooksBody'))}

            <View style={styles.howTo}>
                {[t('obBooksHow1'), t('obBooksHow2', { button: t('bookSaveToWishlist') })].map((line, i) => (
                    <View key={i} style={styles.howToRow}>
                        <View style={[styles.howToNum, { backgroundColor: AccentPalette[4] }]}>
                            <ThemedText style={styles.howToNumText}>{i + 1}</ThemedText>
                        </View>
                        <ThemedText style={[styles.howToText, { color: theme.text }]}>{line}</ThemedText>
                    </View>
                ))}
            </View>

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

            {addedBooks.length > 0 && (
                <View style={styles.section}>
                    <ThemedText style={[styles.sectionTitle, { color: theme.text, marginTop: 0 }]}>
                        {t('onboardingYourBooks', { count: addedBooks.length })}
                    </ThemedText>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.addedBooksRow}>
                        {addedBooks.map(item => (
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
                        ))}
                    </ScrollView>
                </View>
            )}

            {isActiveSearch && isSearching && (
                <View style={styles.searchingContainer}>
                    <ActivityIndicator size="small" color={AccentPalette[0]} />
                </View>
            )}

            {isActiveSearch && !isSearching && searchResults.length > 0 && (
                <View style={styles.section}>
                    <ThemedText style={[styles.sectionTitle, { color: theme.text, marginTop: 0 }]}>
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

            {!isActiveSearch && trendingBooks.length > 0 && (
                <View style={styles.section}>
                    <ThemedText style={[styles.sectionTitle, { color: theme.text, marginTop: 0 }]}>
                        {t('onboardingPopularRightNow')}
                    </ThemedText>
                    <ThemedText style={[styles.note, { color: theme.secondary, marginBottom: Spacing.sm }]}>
                        {t('obBooksPopularHint')}
                    </ThemedText>
                    <HorizontalBookShelf
                        books={trendingBooks}
                        keyPrefix="ob-trend"
                        contentPaddingHorizontal={0}
                        onPressBook={handleBookPress}
                    />
                </View>
            )}
        </>
    );

    /* ── Step 3: recap ─────────────────────────────────────────────── */
    const renderRecap = () => (
        <>
            {heading(t('obRecapEyebrow'), t('obRecapTitle'), t('obRecapBody'))}

            <View style={[styles.recapCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <View style={styles.recapRow}>
                    <View style={[styles.introIcon, { backgroundColor: softTint(AccentPalette[0], 0.2) }]}>
                        <Ionicons name="pricetags" size={20} color={AccentPalette[0]} />
                    </View>
                    <View style={{ flex: 1 }}>
                        <ThemedText style={[styles.recapLabel, { color: theme.secondary }]}>{caps(t('obRecapTopics'))}</ThemedText>
                        <View style={styles.recapChips}>
                            {selectedTopics.map((topic, i) => (
                                <View key={topic.key} style={[styles.recapChip, { backgroundColor: softTint(AccentPalette[i % AccentPalette.length], 0.22) }]}>
                                    <ThemedText style={[styles.recapChipText, { color: theme.text }]}>{topic.label}</ThemedText>
                                </View>
                            ))}
                        </View>
                    </View>
                    <TouchableOpacity onPress={() => setStep(1)} hitSlop={8}>
                        <ThemedText style={[styles.editText, { color: inkOf(AccentPalette[0]) }]}>{t('obRecapEdit')}</ThemedText>
                    </TouchableOpacity>
                </View>

                <View style={[styles.divider, { backgroundColor: theme.border }]} />

                <View style={styles.recapRow}>
                    <View style={[styles.introIcon, { backgroundColor: softTint(AccentPalette[4], 0.2) }]}>
                        <Ionicons name="library" size={20} color={AccentPalette[4]} />
                    </View>
                    <View style={{ flex: 1 }}>
                        <ThemedText style={[styles.recapLabel, { color: theme.secondary }]}>{caps(t('obRecapBooks'))}</ThemedText>
                        <ThemedText style={[styles.recapValue, { color: theme.text }]}>
                            {addedBooks.length > 0 ? t('obRecapBooksCount', { count: addedBooks.length }) : t('obRecapBooksNone')}
                        </ThemedText>
                    </View>
                    <TouchableOpacity onPress={() => setStep(2)} hitSlop={8}>
                        <ThemedText style={[styles.editText, { color: inkOf(AccentPalette[4]) }]}>
                            {addedBooks.length > 0 ? t('obRecapEdit') : t('obRecapAdd')}
                        </ThemedText>
                    </TouchableOpacity>
                </View>
            </View>

            <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>{t('obRecapNextTitle')}</ThemedText>
            <View style={styles.introList}>
                {[
                    { icon: 'home' as const, color: AccentPalette[1], text: t('obRecapNext1') },
                    { icon: 'compass' as const, color: AccentPalette[4], text: t('obRecapNext2') },
                    { icon: 'timer-outline' as const, color: AccentPalette[3], text: t('obRecapNext3') },
                ].map(item => (
                    <View key={item.text} style={styles.nextRow}>
                        <Ionicons name={item.icon} size={18} color={item.color} style={{ marginTop: 2 }} />
                        <ThemedText style={[styles.nextText, { color: theme.secondary }]}>{item.text}</ThemedText>
                    </View>
                ))}
            </View>
        </>
    );

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
                {topBar}
                <ScrollView
                    ref={scrollRef}
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                >
                    <Animated.View key={step} entering={FadeIn.duration(220)}>
                        {step === 0 && renderIntro()}
                        {step === 1 && renderTopics()}
                        {step === 2 && renderBooks()}
                        {step === 3 && renderRecap()}
                    </Animated.View>
                </ScrollView>

                <View style={[styles.bottomBar, { backgroundColor: theme.background, borderTopColor: theme.border }]}>
                    <TouchableOpacity
                        style={[
                            styles.primaryButton,
                            { backgroundColor: primary.enabled ? stepAccent : track },
                        ]}
                        onPress={primary.onPress}
                        activeOpacity={0.85}
                        disabled={!primary.enabled}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: !primary.enabled }}
                    >
                        <ThemedText style={[styles.primaryButtonText, { color: primary.enabled ? '#fff' : theme.secondary }]}>
                            {primary.label}
                        </ThemedText>
                        {primary.enabled && step < LAST_STEP && (
                            <Ionicons name="arrow-forward" size={18} color="#fff" style={{ marginLeft: 8 }} />
                        )}
                    </TouchableOpacity>
                </View>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    scrollContent: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.xl },

    // Top bar
    topBar: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, gap: 10 },
    topBarRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 28 },
    backButton: { flexDirection: 'row', alignItems: 'center', marginLeft: -4 },
    backText: { fontSize: 15, fontWeight: '600' },
    stepLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, flexShrink: 0 },
    progressRow: { flexDirection: 'row', gap: 6 },
    progressSegment: { flex: 1, height: 5, borderRadius: 3 },

    // Heading
    headingBlock: { marginTop: Spacing.md, gap: 6 },
    eyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 1 },
    title: { fontSize: 28, lineHeight: 34, fontWeight: '800' },
    body: { fontSize: 15.5, lineHeight: 23 },
    sectionTitle: { fontSize: 17, fontWeight: '700', marginTop: Spacing.lg, marginBottom: Spacing.sm },
    section: { marginTop: Spacing.lg },

    // Intro
    introHero: { alignItems: 'center', paddingTop: Spacing.md, paddingBottom: Spacing.sm },
    introList: { gap: 10 },
    introItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderRadius: 16,
        borderWidth: StyleSheet.hairlineWidth,
    },
    introIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    introItemTitle: { fontSize: 15.5, fontWeight: '700' },
    introItemText: { fontSize: 14, lineHeight: 19, marginTop: 1 },
    noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: Spacing.md },
    note: { flex: 1, fontSize: 13.5, lineHeight: 19 },

    // Topics
    counter: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: Spacing.md,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 14,
    },
    counterText: { flex: 1, fontSize: 14.5, fontWeight: '600' },
    clearText: { fontSize: 13.5, fontWeight: '600', textDecorationLine: 'underline' },
    chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: Spacing.md },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 20,
        borderWidth: 1.5,
        paddingVertical: 8,
        paddingHorizontal: 14,
        maxWidth: '100%',
    },
    chipText: { fontSize: 14 },

    // Books
    howTo: { marginTop: Spacing.md, gap: 10 },
    howToRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    howToNum: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
    howToNumText: { color: '#fff', fontSize: 12, fontWeight: '800', lineHeight: 15 },
    howToText: { flex: 1, fontSize: 14, lineHeight: 20 },
    searchBar: {
        marginTop: Spacing.md,
        borderWidth: 1,
        borderRadius: 14,
        minHeight: 50,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    searchInput: { flex: 1, fontSize: 15, height: '100%' },
    addedBooksRow: { gap: 12 },
    addedBookCard: { width: 90 },
    addedBookCover: { width: 90, height: 128, borderRadius: 10, marginBottom: 6 },
    addedBookTitle: { fontSize: 11, fontWeight: '600', lineHeight: 14 },
    resultsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
    resultCover: { width: '100%', aspectRatio: 0.7, borderRadius: 10, marginBottom: 10 },
    resultTitle: { fontSize: 13, fontWeight: '700', lineHeight: 17 },
    resultAuthor: { marginTop: 3, fontSize: 11, fontWeight: '500' },
    searchingContainer: { paddingVertical: Spacing.xl, alignItems: 'center' },
    emptyContainer: { paddingVertical: Spacing.xl, alignItems: 'center', gap: Spacing.sm },
    emptyText: { fontSize: 14, textAlign: 'center' },

    // Recap
    recapCard: { marginTop: Spacing.lg, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 16 },
    recapRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    recapLabel: { fontSize: 12.5, fontWeight: '700', letterSpacing: 0.4 },
    recapValue: { fontSize: 15.5, fontWeight: '600', marginTop: 3, lineHeight: 21 },
    recapChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
    recapChip: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
    recapChipText: { fontSize: 13, fontWeight: '600' },
    editText: { fontSize: 14, fontWeight: '700' },
    divider: { height: StyleSheet.hairlineWidth, marginVertical: 14 },
    nextRow: { flexDirection: 'row', gap: 10 },
    nextText: { flex: 1, fontSize: 14.5, lineHeight: 21 },

    // Bottom bar
    bottomBar: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.sm + 4,
        paddingBottom: Spacing.md,
        borderTopWidth: StyleSheet.hairlineWidth,
        gap: 8,
    },
    primaryButton: {
        borderRadius: BorderRadius.pill,
        paddingVertical: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    primaryButtonText: {
        fontSize: 16,
        fontWeight: '700',
        fontFamily: roundedFont('700'),
    },
});
