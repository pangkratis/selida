import { ThemedText } from '@/components/themed-text';
import { AccentPalette, clamp, Colors, Spacing, mixHex, roundedFont } from '@/constants/theme';
import { Book } from '@/constants/types';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { supabase } from '@/services/supabaseConfig';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { logUserActivity } from '../services/userActivity';
import { useSession } from './ctx';

type BookGenre = { slug: string; name_en: string; name_el: string };

export default function BookDetailsScreen() {
    const { t, i18n } = useTranslation();
    const router = useRouter();
    const params = useLocalSearchParams();
    const { user } = useSession();
    const colorScheme = useColorScheme() ?? 'light';
    const theme = Colors[colorScheme];

    const book: Book = params.book ? JSON.parse(params.book as string) : null;
    const [status, setStatus] = useState<string | null>(null);
    const [coverVisible, setCoverVisible] = useState(false);
    const [genres, setGenres] = useState<BookGenre[]>([]);
    const { width } = useWindowDimensions();

    useEffect(() => {
        if (!user?.uid || !book?.id) return;
        const userId = user.uid;
        const bookId = book.id;

        const load = async () => {
            const { data } = await supabase.from('readingList').select('status').eq('userId', userId).eq('bookId', bookId).maybeSingle();
            setStatus(data?.status ?? null);
        };
        load();

        const channel = supabase
            .channel(`rl-${userId}-${bookId}-${Date.now()}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'readingList', filter: `userId=eq.${userId}` },
                (payload: any) => {
                    if (payload.eventType === 'DELETE') setStatus(null);
                    else if (payload.new?.bookId === bookId) setStatus(payload.new.status ?? null);
                })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [user?.uid, book?.id]);

    // Genre taxonomy (book_genres/genres) — source-independent, replaces the raw
    // `book.categories` for display (that column is ~81% junk "Γενικά βιβλία",
    // see issues-opportunities.md). Coverage is partial (~29% of books have a
    // genre assigned as of 2026-09-19), so this silently renders nothing when
    // a book has none yet — no loading/error state needed for a one-shot,
    // non-critical lookup like this.
    useEffect(() => {
        if (!book?.id) return;
        supabase
            .from('book_genres')
            .select('is_primary, confidence, genres(slug, name_en, name_el)')
            .eq('book_id', book.id)
            .order('is_primary', { ascending: false })
            .order('confidence', { ascending: false })
            .then(({ data }) => {
                setGenres((data ?? []).map((row: any) => row.genres).filter(Boolean));
            });
    }, [book?.id]);

    if (!book) {
        return (
            <View style={[styles.container, { backgroundColor: theme.background, justifyContent: 'center', alignItems: 'center' }]}>
                <ThemedText>{t('bookNotFound')}</ThemedText>
            </View>
        );
    }

    const toggleStatus = async () => {
        if (!user?.uid || !book?.id) return;
        try {
            await upsertBook(book);
        } catch (e) {
            console.error('Error saving book:', e);
            return;
        }
        if (!status) {
            await addToReadingList(user.uid, book.id, 'wishlist');
            await logUserActivity(user.uid, book.id, "add_to_wishlist", "book_details");
        } else {
            await removeFromReadingList(user.uid, book.id);
            await logUserActivity(user.uid, book.id, "remove_from_list", "book_details");
        }
    };

    const addToReadingList = async (uid: string, bookId: string, listStatus: 'reading' | 'wishlist' | 'completed') => {
        try {
            const { error } = await supabase.from('readingList').upsert(
                { userId: uid, bookId, status: listStatus, addedAt: new Date().toISOString() },
                { onConflict: 'userId,bookId' }
            );
            if (error) throw error;
        } catch (error) { console.error("Error adding book to reading list:", error); }
    };

    const removeFromReadingList = async (uid: string, bookId: string) => {
        try {
            const { error } = await supabase.from('readingList').delete().eq('userId', uid).eq('bookId', bookId);
            if (error) throw error;
        } catch (error) { console.error("Error removing book from reading list:", error); }
    };

    const upsertBook = async (book: Book): Promise<void> => {
        const {
            id,
            // ScoredBook fields
            score, matchReason, match_reason,
            // ReadingList fields that can leak when opened from profile
            addedAt, status, progressPercentage, totalReadingTimeSeconds,
            lastSessionStart, isReading, userId, bookId,
            ...bookData
        } = book as any;
        const { error } = await supabase.from('books').upsert(
            { id, ...bookData, source: 'biblionet', createdAt: new Date().toISOString() },
            { onConflict: 'id' }
        );
        if (error) console.error('Error upserting book:', error);
    };

    /* ── Derived display values ──────────────────────────────────── */

    const accentIndex = Math.abs((book.title || '').split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0)) % AccentPalette.length;
    const accent = AccentPalette[accentIndex];
    const heroTint = mixHex(theme.background, accent, colorScheme === 'dark' ? 0.12 : 0.08);

    // Hero cover: clamped to screen width rather than a bare fixed size — at a
    // flat 140px it's ~44% of a small phone's width but only ~33% of a large
    // phone's, visibly shrinking/growing the hero's prominence at the extremes.
    // Bounded so it still reads as a normal book-cover thumbnail either way.
    const coverWidth = clamp(120, width * 0.38, 160);
    const coverHeight = coverWidth * 1.5; // matches the fixed 140x210 (2:3) aspect ratio


    /* ── Render ──────────────────────────────────────────────────── */

    return (
        <SafeAreaView edges={['top', 'bottom']} style={[styles.container, { backgroundColor: theme.background }]}>
            {/*
              ScrollView MUST be the sheet's first child (react-native-screens' iOS form-sheet
              finds its "tracking" scroll view by walking only the FIRST child at each level —
              see RNSScrollViewFinder.mm — so a sibling rendered before it, like the grabber used
              to be, makes the sheet fail to find the ScrollView at all and it never scrolls).
              The grabber is rendered after it instead, as an absolute overlay, so it stays
              visually on top without occupying the first-child slot.
            */}
            <ScrollView style={styles.scrollView} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} nestedScrollEnabled={true}>

                {/* ── Hero Zone ─────────────────────────────────── */}
                <View style={[styles.hero, { backgroundColor: heroTint }]}>
                    {/* Close */}
                    <TouchableOpacity
                        onPress={() => router.back()}
                        style={[styles.closeButton, { backgroundColor: theme.surface }]}
                    >
                        <Ionicons name="close" size={20} color={theme.icon} />
                    </TouchableOpacity>

                    {/* Cover */}
                    <TouchableOpacity style={styles.coverWrap} onPress={() => setCoverVisible(true)} activeOpacity={0.9}>
                        <Image
                            source={{ uri: book.coverUrl || undefined }}
                            style={[styles.cover, { width: coverWidth, height: coverHeight, backgroundColor: theme.border }]}
                            contentFit="cover"
                            transition={200}
                        />
                    </TouchableOpacity>

                    {/* Title */}
                    <ThemedText style={[styles.title, { color: theme.text }]} numberOfLines={3}>
                        {book.title}
                    </ThemedText>

                    {/* Author */}
                    <ThemedText style={[styles.author, { color: theme.secondary }]} numberOfLines={2}>
                        {book.authors?.join(', ') || 'Unknown Author'}
                    </ThemedText>

                    {/* Publisher */}
                    {book.publisher ? (
                        <ThemedText style={[styles.publisher, { color: theme.secondary }]} numberOfLines={1}>
                            {book.publisher}
                        </ThemedText>
                    ) : null}

                    {/* Meta badges */}
                    <View style={styles.metaRow}>
                        {book.publishedYear ? (
                            <View style={[styles.badge, { backgroundColor: theme.surface }]}>
                                <ThemedText style={[styles.badgeText, { color: theme.secondary }]}>
                                    {book.publishedYear}
                                </ThemedText>
                            </View>
                        ) : null}
                        {book.language ? (
                            <View style={[styles.badge, { backgroundColor: theme.surface }]}>
                                <ThemedText style={[styles.badgeText, { color: theme.secondary }]}>
                                    {book.language.toUpperCase()}
                                </ThemedText>
                            </View>
                        ) : null}
                        {book.pageCount ? (
                            <View style={[styles.badge, { backgroundColor: theme.surface }]}>
                                <ThemedText style={[styles.badgeText, { color: theme.secondary }]}>
                                    {t('bookPages', { count: book.pageCount })}
                                </ThemedText>
                            </View>
                        ) : null}
                    </View>

                    {/* Genre + subcategory chips (genre replaces the old raw `categories` chips) */}
                    {([...genres, ...(book.subcategories ?? [])]).length > 0 && (
                        <View style={styles.chipRow}>
                            {[
                                ...genres.map(g => i18n.language.startsWith('el') ? g.name_el : g.name_en),
                                ...(book.subcategories ?? []),
                            ].map((label, idx) => {
                                const chipAccent = AccentPalette[idx % AccentPalette.length];
                                return (
                                    <View
                                        key={`${label}-${idx}`}
                                        style={[styles.chip, { backgroundColor: chipAccent, shadowColor: chipAccent }]}
                                    >
                                        <ThemedText style={[styles.chipText, { color: '#fff', fontFamily: roundedFont('600') }]}>
                                            {label}
                                        </ThemedText>
                                    </View>
                                );
                            })}
                        </View>
                    )}
                </View>

                {/* ── CTA Button ────────────────────────────────── */}
                <View style={styles.ctaRow}>
                    <TouchableOpacity
                        style={[styles.ctaButton, {
                            backgroundColor: !status ? accent : theme.error,
                            shadowColor: !status ? accent : theme.error,
                        }]}
                        onPress={toggleStatus}
                        activeOpacity={0.82}
                    >
                        <Ionicons name={!status ? 'heart' : 'trash-outline'} size={18} color="#fff" />
                        <ThemedText style={styles.ctaText}>{!status ? t('bookSaveToWishlist') : t('bookRemoveFromList')}</ThemedText>
                    </TouchableOpacity>
                </View>

                {/* ── Description ───────────────────────────────── */}
                <View style={[styles.card, { backgroundColor: theme.surface }]}>
                    <View style={[styles.cardHeader, { backgroundColor: theme.background, borderBottomColor: theme.border }]}>
                        <Ionicons name="document-text-outline" size={17} color={accent} />
                        <ThemedText style={[styles.cardTitle, { color: theme.text }]}>{t('bookAbout')}</ThemedText>
                    </View>
                    <View style={styles.cardBody}>
                        <ThemedText style={[styles.description, { color: theme.secondary }]}>
                            {book.description || t('bookNoDescription')}
                        </ThemedText>
                        {book.isbn ? (
                            <View style={[styles.isbnRow, { borderTopColor: theme.border }]}>
                                <ThemedText style={[styles.isbnLabel, { color: theme.secondary }]}>{t('bookIsbn')}</ThemedText>
                                <ThemedText style={[styles.isbnValue, { color: theme.text }]}>{book.isbn}</ThemedText>
                            </View>
                        ) : null}
                    </View>
                </View>

            </ScrollView>

            {/* Grabber — rendered after the ScrollView, absolute, so it stays the visible top
                indicator without being the sheet's first child (see comment above). */}
            <View style={styles.grabberContainer} pointerEvents="none">
                <View style={[styles.grabber, { backgroundColor: theme.border }]} />
            </View>

            {/* ── Cover lightbox ────────────────────────────────── */}
            <Modal visible={coverVisible} transparent statusBarTranslucent animationType="fade" onRequestClose={() => setCoverVisible(false)}>
                <Pressable style={styles.lightboxBackdrop} onPress={() => setCoverVisible(false)}>
                    <View style={{ width: width * 0.85, aspectRatio: 0.67, borderRadius: 14, overflow: 'hidden' }}>
                        <Image
                            source={{ uri: book.coverUrl || undefined }}
                            style={{ width: '100%', height: '100%' }}
                            contentFit="cover"
                            transition={200}
                        />
                    </View>
                    <View style={[styles.lightboxClose, { backgroundColor: 'rgba(0,0,0,0.55)' }]}>
                        <Ionicons name="close" size={20} color="#fff" />
                    </View>
                </Pressable>
            </Modal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    grabberContainer: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        alignItems: 'center',
        paddingTop: 6,
        paddingBottom: 2,
    },
    grabber: {
        width: 36,
        height: 4,
        borderRadius: 2,
        opacity: 0.4,
    },
    scrollView: {
        flex: 1,
    },
    scroll: {
        paddingTop: 16,
        paddingBottom: 40,
    },

    // Hero
    hero: {
        paddingHorizontal: Spacing.xl,
        paddingBottom: 28,
        paddingTop: 0,
        borderBottomLeftRadius: 28,
        borderBottomRightRadius: 28,
        alignItems: 'center',
    },
    closeButton: {
        alignSelf: 'flex-end',
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 6,
        elevation: 2,
    },
    coverWrap: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.22,
        shadowRadius: 20,
        elevation: 10,
        marginBottom: 20,
    },
    cover: {
        borderRadius: 14,
    },
    title: {
        fontSize: 24,
        fontWeight: '800',
        lineHeight: 30,
        letterSpacing: -0.5,
        textAlign: 'center',
        marginBottom: 6,
    },
    author: {
        fontSize: 15,
        fontWeight: '500',
        textAlign: 'center',
        marginBottom: 4,
        lineHeight: 21,
    },
    publisher: {
        fontSize: 13,
        fontWeight: '500',
        textAlign: 'center',
        marginBottom: 14,
        opacity: 0.75,
    },
    metaRow: {
        flexDirection: 'row',
        gap: 8,
        flexWrap: 'wrap',
        justifyContent: 'center',
    },
    badge: {
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
    },
    badgeText: {
        fontSize: 11,
        fontWeight: '600',
    },

    // CTA
    ctaRow: {
        alignItems: 'center',
        marginTop: 20,
        marginBottom: 6,
    },
    ctaButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height: 46,
        paddingHorizontal: 26,
        borderRadius: 15,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
        elevation: 3,
    },
    ctaText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '700',
    },

    // Cards
    card: {
        marginHorizontal: Spacing.xl,
        marginTop: 14,
        borderRadius: 20,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.07,
        shadowRadius: 10,
        elevation: 3,
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
    },
    cardTitle: {
        fontSize: 15,
        fontWeight: '700',
    },
    cardBody: {
        padding: 16,
    },

    // Category chips
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14, justifyContent: 'center' },
    chip: {
        borderRadius: 20,
        paddingVertical: 7,
        paddingHorizontal: 14,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
        elevation: 2,
    },
    chipText: { fontSize: 13, fontWeight: '600' },

    // Description
    description: {
        fontSize: 15,
        lineHeight: 24,
    },
    isbnRow: {
        marginTop: 14,
        paddingTop: 12,
        borderTopWidth: 1,
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 12,
    },
    isbnLabel: {
        fontSize: 12,
        fontWeight: '600',
    },
    isbnValue: {
        flex: 1,
        textAlign: 'right',
        fontSize: 12,
        fontWeight: '700',
    },

    // Lightbox
    lightboxBackdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.75)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    lightboxClose: {
        position: 'absolute',
        top: 52,
        right: 20,
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
