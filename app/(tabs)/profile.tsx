import { useSession } from '@/app/ctx';
import { ThemedText } from '@/components/themed-text';
import { useTranslation } from 'react-i18next';
import { TAB_BAR_CONTENT_CLEARANCE } from '@/constants/tab-bar';
import { AccentPalette, BorderRadius, Colors, Spacing, mixHex, roundedFont, toTransparent } from '@/constants/theme';
import { ReadingListItem } from '@/constants/types';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { supabase } from "@/services/supabaseConfig";
import { logUserActivity } from '@/services/userActivity';
import { Ionicons } from '@expo/vector-icons';
import FeedbackButton from '@/components/feedback-button';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
    ActivityIndicator,
    Modal,
    Pressable,
    ScrollView,
    TouchableOpacity,
    View,
} from 'react-native';

/* ── Helpers ─────────────────────────────────────────────────────── */

type ShelfKey = 'reading' | 'wishlist' | 'finished';

/* ── Shelf sub-components ───────────────────────────────────────── */

function SeeAllDots({ onPress }: { onPress: () => void }) {
    return (
        <TouchableOpacity onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingLeft: 8 }}>
            {[AccentPalette[0], AccentPalette[1], AccentPalette[2]].map((color, i) => (
                <View key={i} style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: color }} />
            ))}
        </TouchableOpacity>
    );
}

function ShelfHeader({ title, theme, onSeeAll }: { title: string; theme: typeof Colors.light; onSeeAll?: () => void }) {
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.xl, marginBottom: 10 }}>
            <ThemedText style={{
                fontSize: 17,
                fontWeight: '700',
                fontFamily: roundedFont('700'),
                color: theme.text,
                letterSpacing: -0.2,
            }}>
                {title}
            </ThemedText>
            {onSeeAll && <SeeAllDots onPress={onSeeAll} />}
        </View>
    );
}

function ReadingCard({ item, theme, onPress, onLongPress }: {
    item: ReadingListItem; theme: typeof Colors.light; onPress: () => void; onLongPress: () => void;
}) {
    return (
        <TouchableOpacity style={{ width: 108 }} activeOpacity={0.85} onPress={onPress} onLongPress={onLongPress}>
            <Image
                source={{ uri: item.coverUrl ?? undefined }}
                style={{ width: 108, aspectRatio: 2 / 3, borderRadius: 12, backgroundColor: theme.border }}
                contentFit="cover"
                transition={200}
            />
            <ThemedText style={{ fontSize: 13, fontWeight: '700', fontFamily: roundedFont('700'), color: theme.text, marginTop: 8, lineHeight: 17 }} numberOfLines={2}>
                {item.title || 'Unknown Title'}
            </ThemedText>
            <ThemedText style={{ fontSize: 11.5, fontWeight: '500', fontFamily: roundedFont('500'), color: theme.secondary, marginTop: 2 }} numberOfLines={1}>
                {item.authors?.join(', ') || 'Unknown Author'}
            </ThemedText>
        </TouchableOpacity>
    );
}

function CoverOnlyCard({ item, theme, onPress, onLongPress }: {
    item: ReadingListItem; theme: typeof Colors.light; onPress: () => void; onLongPress: () => void;
}) {
    return (
        <TouchableOpacity activeOpacity={0.85} onPress={onPress} onLongPress={onLongPress}>
            <Image
                source={{ uri: item.coverUrl ?? undefined }}
                style={{ width: 108, aspectRatio: 2 / 3, borderRadius: 12, backgroundColor: theme.border }}
                contentFit="cover"
                transition={200}
            />
        </TouchableOpacity>
    );
}

function EmptyDashedTile({ theme, text, width = 86 }: { theme: typeof Colors.light; text: string; width?: number }) {
    return (
        <View style={{
            width,
            aspectRatio: 2 / 3,
            borderRadius: 10,
            borderWidth: 1.5,
            borderStyle: 'dashed',
            borderColor: theme.border,
            alignItems: 'center',
            justifyContent: 'center',
            padding: 10,
        }}>
            <ThemedText style={{ fontSize: 12, fontWeight: '500', fontFamily: roundedFont('500'), color: theme.secondary, textAlign: 'center' }} numberOfLines={3}>
                {text}
            </ThemedText>
        </View>
    );
}

function FinishedRow({ item, theme, onPress, onMenuPress }: {
    item: ReadingListItem; theme: typeof Colors.light; onPress: () => void; onMenuPress: () => void;
}) {
    const { t } = useTranslation();
    const dateLabel = item.addedAt
        ? new Date(item.addedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
        : '';
    return (
        <TouchableOpacity
            onPress={onPress}
            activeOpacity={0.85}
            style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
                backgroundColor: theme.surface,
                borderRadius: 18,
                padding: 14,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 1 },
                shadowOpacity: 0.07,
                shadowRadius: 6,
                elevation: 2,
            }}
        >
            <Image
                source={{ uri: item.coverUrl ?? undefined }}
                style={{ width: 68, height: 102, borderRadius: 10, backgroundColor: theme.border }}
                contentFit="cover"
            />
            <View style={{ flex: 1 }}>
                <ThemedText style={{ fontSize: 16, fontWeight: '700', fontFamily: roundedFont('700'), color: theme.text }} numberOfLines={1}>
                    {item.title || 'Unknown Title'}
                </ThemedText>
                <ThemedText style={{ fontSize: 13.5, fontWeight: '500', fontFamily: roundedFont('500'), color: theme.secondary, marginTop: 4 }} numberOfLines={1}>
                    {(item.authors?.join(', ') || 'Unknown Author')}
                    {dateLabel ? ` · ${t('profileFinishedDate', { date: dateLabel })}` : ''}
                </ThemedText>
            </View>
            <TouchableOpacity onPress={onMenuPress} style={{ padding: 8 }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="ellipsis-vertical" size={20} color={theme.icon} />
            </TouchableOpacity>
        </TouchableOpacity>
    );
}

function EmptyDashedRow({ theme, text }: { theme: typeof Colors.light; text: string }) {
    return (
        <View style={{
            borderRadius: 16,
            borderWidth: 1.5,
            borderStyle: 'dashed',
            borderColor: theme.border,
            paddingVertical: 20,
            paddingHorizontal: Spacing.lg,
            alignItems: 'center',
        }}>
            <ThemedText style={{ fontSize: 13, fontWeight: '500', fontFamily: roundedFont('500'), color: theme.secondary, textAlign: 'center' }}>
                {text}
            </ThemedText>
        </View>
    );
}

/* ── Main Screen ─────────────────────────────────────────────────── */

export default function ProfileScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const { user } = useSession();
    const [readingList, setReadingList] = useState<ReadingListItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [menuItem, setMenuItem] = useState<ReadingListItem | null>(null);

    const colorScheme = useColorScheme() ?? 'light';
    const theme = Colors[colorScheme];

    const heroTint = useMemo(
        () => mixHex(theme.background, AccentPalette[1], colorScheme === 'dark' ? 0.1 : 0.06),
        [colorScheme, theme.background]
    );

    const scrollRef = useRef<ScrollView>(null);
    const sectionY = useRef<Record<ShelfKey, number>>({ reading: 0, wishlist: 0, finished: 0 });
    const scrollToSection = (key: ShelfKey) => {
        scrollRef.current?.scrollTo({ y: Math.max(0, sectionY.current[key] - Spacing.md), animated: true });
    };

    /* ── Data fetching ─────────────────────────────────────────── */

    const loadReadingList = useCallback(async () => {
        if (!user?.uid) return;
        setLoading(true);
        try {
            const { data: rlData, error } = await supabase
                .from('readingList')
                .select('bookId, status, progressPercentage, totalReadingTimeSeconds, addedAt, isReading')
                .eq('userId', user.uid);
            if (error) throw error;
            const itemsWithDetails = await Promise.all(
                (rlData ?? []).map(async (row: any) => {
                    const bookDetails = await getBookDetails(row.bookId);
                    return { ...row, ...bookDetails };
                })
            );
            setReadingList(itemsWithDetails as ReadingListItem[]);
        } catch (err) {
            console.error('Error loading reading list:', err);
        } finally {
            setLoading(false);
        }
    }, [user?.uid]);

    // Load once (on mount / when the user becomes available) and otherwise rely
    // on the realtime subscription below to keep the list in sync — NOT on
    // focus, which used to force a full reload every time this screen regained
    // focus (e.g. closing book-details). Requires readingList to have
    // REPLICA IDENTITY FULL (sql/migration_09) so realtime DELETEs are caught.
    useEffect(() => { loadReadingList(); }, [loadReadingList]);

    useEffect(() => {
        if (!user?.uid) return;
        const channel = supabase
            .channel(`reading-list-${user.uid}-${Date.now()}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'readingList', filter: `userId=eq.${user.uid}` },
                () => { loadReadingList(); })
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [user?.uid, loadReadingList]);

    const getBookDetails = async (bookId: string) => {
        const { data, error } = await supabase.from('books').select('*').eq('id', bookId).maybeSingle();
        if (error) console.error('getBookDetails error:', error);
        if (data) return data;
        return { id: bookId };
    };

    /* ── Derived data ──────────────────────────────────────────── */

    const readingBooks = readingList.filter(item => item.status === 'reading');
    const wishlistBooks = readingList.filter(item => item.status === 'wishlist');
    const finishedBooks = readingList.filter(item => item.status === 'completed');

    /* ── Navigation helper ─────────────────────────────────────── */

    const navigateToBook = (item: any) => {
        const bookId = item.bookId || item.id;
        if (user?.uid) {
            logUserActivity(user.uid, bookId, "view_details", "profile").catch(console.error);
        }
        const sanitizeForJson = (value: any): any => {
            if (value === null || value === undefined) return value;
            if (typeof value === 'function') return undefined;
            if (
                typeof value === 'object' &&
                typeof value.seconds === 'number' &&
                typeof value.nanoseconds === 'number'
            ) {
                return value.seconds * 1000 + Math.round(value.nanoseconds / 1e6);
            }
            if (value instanceof Date) return value.getTime();
            if (Array.isArray(value)) return value.map(sanitizeForJson);
            if (typeof value === 'object') {
                const out: Record<string, any> = {};
                for (const key of Object.keys(value)) {
                    const sanitized = sanitizeForJson(value[key]);
                    if (sanitized !== undefined) out[key] = sanitized;
                }
                return out;
            }
            return value;
        };

        const bookParam = sanitizeForJson({ ...item, id: bookId });
        router.push({
            pathname: "/book-details",
            params: {
                book: JSON.stringify(bookParam),
                origin: item.status === 'reading' ? 'readingList' : undefined,
            },
        });
    };

    /* ── Status menu handler ───────────────────────────────────── */

    const handleStatusChange = async (newStatus: 'wishlist' | 'reading' | 'completed' | null) => {
        if (!menuItem || !user?.uid) return;
        const bookId = menuItem.bookId || (menuItem as any).id;
        setMenuItem(null);
        if (!bookId) return;
        try {
            if (newStatus === null) {
                const { error } = await supabase.from('readingList').delete().eq('userId', user.uid).eq('bookId', bookId);
                if (error) throw error;
                logUserActivity(user.uid, bookId, 'remove_from_list', 'profile').catch(console.error);
            } else {
                const { error } = await supabase.from('readingList').update({ status: newStatus }).eq('userId', user.uid).eq('bookId', bookId);
                if (error) throw error;
                const action = newStatus === 'reading' ? 'add_to_reading'
                    : newStatus === 'completed' ? 'mark_completed'
                    : 'add_to_wishlist';
                logUserActivity(user.uid, bookId, action, 'profile').catch(console.error);
            }
        } catch (e) {
            console.error('Error updating status:', e);
        }
    };

    /* ── Guards ─────────────────────────────────────────────────── */

    if (!user) {
        return (
            <View style={{ flex: 1, backgroundColor: theme.background, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator color={theme.tint} />
            </View>
        );
    }

    /* ── Render ─────────────────────────────────────────────────── */

    return (
        <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: theme.background }}>
            <View style={{ flex: 1 }}>
            <ScrollView
                ref={scrollRef}
                contentContainerStyle={{ paddingBottom: TAB_BAR_CONTENT_CLEARANCE }}
                showsVerticalScrollIndicator={false}
            >
                {/* ── Hero ───────────────────────────────────────── */}
                <View style={{
                    backgroundColor: heroTint,
                    paddingHorizontal: Spacing.xl,
                    paddingTop: Spacing.lg,
                    paddingBottom: Spacing.lg,
                    borderBottomLeftRadius: BorderRadius.pill,
                    borderBottomRightRadius: BorderRadius.pill,
                }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md }}>
                        <ThemedText style={{ fontSize: 26, fontWeight: '700', fontFamily: roundedFont('700'), color: theme.text, letterSpacing: -0.3 }} numberOfLines={1}>
                            {t('profileYourLibrary')}
                        </ThemedText>
                        <TouchableOpacity
                            onPress={() => router.push('/settings')}
                            activeOpacity={0.7}
                            style={{ padding: 8 }}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                            <Ionicons name="settings-outline" size={24} color={theme.secondary} />
                        </TouchableOpacity>
                    </View>

                    {/* ── Counts card ───────────────────────────── */}
                    <View style={{
                        flexDirection: 'row',
                        backgroundColor: theme.surface,
                        borderRadius: BorderRadius.lg,
                        marginTop: Spacing.md,
                        overflow: 'hidden',
                        shadowColor: '#000',
                        shadowOffset: { width: 0, height: 1 },
                        shadowOpacity: 0.07,
                        shadowRadius: 8,
                        elevation: 2,
                    }}>
                        {([
                            { key: 'reading' as ShelfKey, icon: 'book' as const, labelKey: 'profileReading', color: theme.tabReading, count: readingBooks.length },
                            { key: 'wishlist' as ShelfKey, icon: 'heart' as const, labelKey: 'profileWishlist', color: theme.tabWishlist, count: wishlistBooks.length },
                            { key: 'finished' as ShelfKey, icon: 'checkmark-circle' as const, labelKey: 'profileFinished', color: theme.tabFinished, count: finishedBooks.length },
                        ]).map((col, i) => (
                            <React.Fragment key={col.key}>
                                {i > 0 && <View style={{ width: 1, height: 36, alignSelf: 'center', backgroundColor: theme.border }} />}
                                <TouchableOpacity
                                    onPress={() => scrollToSection(col.key)}
                                    activeOpacity={0.7}
                                    style={{ flex: 1, alignItems: 'center', paddingVertical: 14, paddingHorizontal: 6 }}
                                >
                                    <Ionicons name={col.icon} size={20} color={col.color} />
                                    <ThemedText style={{ fontSize: 27, lineHeight: 32, fontWeight: '700', fontFamily: roundedFont('700'), color: theme.text, marginTop: 9, letterSpacing: -0.3 }}>
                                        {loading ? '–' : col.count}
                                    </ThemedText>
                                    <ThemedText style={{ fontSize: 11, fontWeight: '600', fontFamily: roundedFont('600'), color: theme.secondary, marginTop: 4 }}>
                                        {t(col.labelKey)}
                                    </ThemedText>
                                </TouchableOpacity>
                            </React.Fragment>
                        ))}
                    </View>
                </View>

                {loading && (
                    <View style={{ padding: Spacing.xl, alignItems: 'center' }}>
                        <ActivityIndicator color={AccentPalette[1]} />
                    </View>
                )}

                {!loading && (
                    <>
                        {/* ── Currently reading ─────────────────── */}
                        <View
                            style={{ marginTop: Spacing.lg }}
                            onLayout={(e) => { sectionY.current.reading = e.nativeEvent.layout.y; }}
                        >
                            <ShelfHeader
                                title={t('profileCurrentlyReading')}
                                theme={theme}
                                onSeeAll={() => router.push({ pathname: '/book-list', params: { title: t('profileCurrentlyReading'), type: 'user-reading' } })}
                            />
                            {readingBooks.length === 0 ? (
                                <View style={{ paddingHorizontal: Spacing.xl }}>
                                    <EmptyDashedTile theme={theme} text={t('profileNoReadingHint')} width={108} />
                                </View>
                            ) : (
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: Spacing.xl, gap: 14 }}>
                                    {readingBooks.map((item) => (
                                        <ReadingCard
                                            key={item.bookId || item.id}
                                            item={item}
                                            theme={theme}
                                            onPress={() => navigateToBook(item)}
                                            onLongPress={() => setMenuItem(item)}
                                        />
                                    ))}
                                </ScrollView>
                            )}
                        </View>

                        {/* ── Wishlist ───────────────────────────── */}
                        <View
                            style={{ marginTop: Spacing.lg }}
                            onLayout={(e) => { sectionY.current.wishlist = e.nativeEvent.layout.y; }}
                        >
                            <ShelfHeader
                                title={t('profileYourWishlist')}
                                theme={theme}
                                onSeeAll={() => router.push({ pathname: '/book-list', params: { title: t('profileYourWishlist'), type: 'user-wishlist' } })}
                            />
                            {wishlistBooks.length === 0 ? (
                                <View style={{ paddingHorizontal: Spacing.xl }}>
                                    <EmptyDashedTile theme={theme} text={t('profileNoWishlistHint')} width={108} />
                                </View>
                            ) : (
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: Spacing.xl, gap: 12 }}>
                                    {wishlistBooks.map((item) => (
                                        <CoverOnlyCard
                                            key={item.bookId || item.id}
                                            item={item}
                                            theme={theme}
                                            onPress={() => navigateToBook(item)}
                                            onLongPress={() => setMenuItem(item)}
                                        />
                                    ))}
                                </ScrollView>
                            )}
                        </View>

                        {/* ── Finished ───────────────────────────── */}
                        <View
                            style={{ marginTop: Spacing.lg }}
                            onLayout={(e) => { sectionY.current.finished = e.nativeEvent.layout.y; }}
                        >
                            <ShelfHeader title={t('profileCompletedBooks')} theme={theme} />
                            <View style={{ paddingHorizontal: Spacing.xl, gap: 12 }}>
                                {finishedBooks.length === 0 ? (
                                    <EmptyDashedRow theme={theme} text={t('profileNoFinishedHint')} />
                                ) : (
                                    finishedBooks.map((item) => (
                                        <FinishedRow
                                            key={item.bookId || item.id}
                                            item={item}
                                            theme={theme}
                                            onPress={() => navigateToBook(item)}
                                            onMenuPress={() => setMenuItem(item)}
                                        />
                                    ))
                                )}
                            </View>
                        </View>
                    </>
                )}

            </ScrollView>

            <LinearGradient
                colors={[toTransparent(theme.background), theme.background]}
                locations={[0, 0.8]}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                pointerEvents="none"
                style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 40 }}
            />
            </View>

            <FeedbackButton />

            {/* ── Status Menu Modal ─────────────────────────────── */}
            <Modal
                visible={!!menuItem}
                transparent
                animationType="fade"
                onRequestClose={() => setMenuItem(null)}
            >
                <Pressable
                    style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}
                    onPress={() => setMenuItem(null)}
                >
                    <Pressable onPress={() => {}}>
                        <View style={{
                            backgroundColor: theme.surface,
                            borderTopLeftRadius: 28,
                            borderTopRightRadius: 28,
                            paddingTop: 12,
                            paddingBottom: 36,
                            paddingHorizontal: Spacing.xl,
                            shadowColor: '#000',
                            shadowOffset: { width: 0, height: -4 },
                            shadowOpacity: 0.12,
                            shadowRadius: 20,
                            elevation: 16,
                        }}>
                            {/* Grabber */}
                            <View style={{
                                width: 36,
                                height: 4,
                                borderRadius: 2,
                                backgroundColor: theme.border,
                                alignSelf: 'center',
                                marginBottom: 20,
                                opacity: 0.5,
                            }} />

                            {/* Book title */}
                            <ThemedText style={{
                                fontSize: 16,
                                fontWeight: '700',
                                color: theme.text,
                                fontFamily: roundedFont('700'),
                                marginBottom: 20,
                                letterSpacing: -0.3,
                            }} numberOfLines={1}>
                                {menuItem?.title || 'Book'}
                            </ThemedText>

                            {/* Status options */}
                            {menuItem?.status !== 'wishlist' && (
                                <TouchableOpacity
                                    onPress={() => handleStatusChange('wishlist')}
                                    activeOpacity={0.75}
                                    style={{
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        gap: 14,
                                        paddingVertical: 14,
                                        paddingHorizontal: 16,
                                        borderRadius: 16,
                                        backgroundColor: theme.tabWishlist + '18',
                                        marginBottom: 10,
                                    }}
                                >
                                    <View style={{
                                        width: 36, height: 36, borderRadius: 18,
                                        backgroundColor: theme.tabWishlist + '28',
                                        alignItems: 'center', justifyContent: 'center',
                                    }}>
                                        <Ionicons name="heart" size={18} color={theme.tabWishlist} />
                                    </View>
                                    <ThemedText style={{
                                        fontSize: 15, fontWeight: '600',
                                        color: theme.text, fontFamily: roundedFont('600'),
                                    }}>
                                        {t('profileMoveToWishlist')}
                                    </ThemedText>
                                </TouchableOpacity>
                            )}

                            {menuItem?.status !== 'reading' && (
                                <TouchableOpacity
                                    onPress={() => handleStatusChange('reading')}
                                    activeOpacity={0.75}
                                    style={{
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        gap: 14,
                                        paddingVertical: 14,
                                        paddingHorizontal: 16,
                                        borderRadius: 16,
                                        backgroundColor: theme.tabReading + '18',
                                        marginBottom: 10,
                                    }}
                                >
                                    <View style={{
                                        width: 36, height: 36, borderRadius: 18,
                                        backgroundColor: theme.tabReading + '28',
                                        alignItems: 'center', justifyContent: 'center',
                                    }}>
                                        <Ionicons name="book" size={18} color={theme.tabReading} />
                                    </View>
                                    <ThemedText style={{
                                        fontSize: 15, fontWeight: '600',
                                        color: theme.text, fontFamily: roundedFont('600'),
                                    }}>
                                        {t('profileMoveToReading')}
                                    </ThemedText>
                                </TouchableOpacity>
                            )}

                            {menuItem?.status !== 'completed' && (
                                <TouchableOpacity
                                    onPress={() => handleStatusChange('completed')}
                                    activeOpacity={0.75}
                                    style={{
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        gap: 14,
                                        paddingVertical: 14,
                                        paddingHorizontal: 16,
                                        borderRadius: 16,
                                        backgroundColor: theme.tabFinished + '18',
                                        marginBottom: 10,
                                    }}
                                >
                                    <View style={{
                                        width: 36, height: 36, borderRadius: 18,
                                        backgroundColor: theme.tabFinished + '28',
                                        alignItems: 'center', justifyContent: 'center',
                                    }}>
                                        <Ionicons name="checkmark-circle" size={18} color={theme.tabFinished} />
                                    </View>
                                    <ThemedText style={{
                                        fontSize: 15, fontWeight: '600',
                                        color: theme.text, fontFamily: roundedFont('600'),
                                    }}>
                                        {t('profileMarkFinished')}
                                    </ThemedText>
                                </TouchableOpacity>
                            )}

                            <TouchableOpacity
                                onPress={() => handleStatusChange(null)}
                                activeOpacity={0.75}
                                style={{
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    gap: 14,
                                    paddingVertical: 14,
                                    paddingHorizontal: 16,
                                    borderRadius: 16,
                                    backgroundColor: theme.error + '12',
                                    marginBottom: 16,
                                }}
                            >
                                <View style={{
                                    width: 36, height: 36, borderRadius: 18,
                                    backgroundColor: theme.error + '22',
                                    alignItems: 'center', justifyContent: 'center',
                                }}>
                                    <Ionicons name="trash-outline" size={18} color={theme.error} />
                                </View>
                                <ThemedText style={{
                                    fontSize: 15, fontWeight: '600',
                                    color: theme.error, fontFamily: roundedFont('600'),
                                }}>
                                    {t('profileRemoveFromList')}
                                </ThemedText>
                            </TouchableOpacity>

                            {/* Cancel */}
                            <TouchableOpacity
                                onPress={() => setMenuItem(null)}
                                activeOpacity={0.7}
                                style={{
                                    paddingVertical: 14,
                                    borderRadius: 16,
                                    backgroundColor: theme.background,
                                    alignItems: 'center',
                                }}
                            >
                                <ThemedText style={{
                                    fontSize: 15, fontWeight: '600',
                                    color: theme.secondary, fontFamily: roundedFont('600'),
                                }}>
                                    {t('profileCancel')}
                                </ThemedText>
                            </TouchableOpacity>
                        </View>
                    </Pressable>
                </Pressable>
            </Modal>

        </SafeAreaView>
    );
}
