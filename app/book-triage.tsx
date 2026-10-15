import { useSession } from '@/app/ctx';
import { ThemedText } from '@/components/themed-text';
import { AccentPalette, Colors, roundedFont } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  TRIAGE_PAGE_SIZE,
  TriageBook,
  TriageCounts,
  TriageDecision,
  clearTriageDecision,
  fetchTriageCounts,
  fetchTriageDeck,
  saveTriageDecision,
} from '@/services/book-triage';
import { logError } from '@/services/errorLog';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Platform, StyleSheet, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView, ScrollView } from 'react-native-gesture-handler';
import Animated, { Extrapolation, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const LIKE_COLOR = AccentPalette[3];
const SKIP_COLOR = AccentPalette[2];
const REVIEW_COLOR = AccentPalette[0];
const REFILL_BELOW = 6;

type Decided = { book: TriageBook; decision: TriageDecision };

const adjustCounts = (c: TriageCounts | null, decision: TriageDecision, delta: 1 | -1): TriageCounts | null => {
  if (!c) return c;
  if (decision === 'priority') return { ...c, inList: Math.max(0, c.inList + delta) };
  if (decision === 'review') return { ...c, inReview: Math.max(0, c.inReview + delta) };
  return { ...c, skipped: Math.max(0, c.skipped + delta) };
};

/* ── SwipeCard ─────────────────────────────────────────────────────── */

type SwipeCardHandle = { swipe: (decision: TriageDecision) => void };

function SwipeCard({ book, onDecide, ref }: {
  book: TriageBook;
  onDecide: (decision: TriageDecision) => void;
  ref?: React.Ref<SwipeCardHandle>;
}) {
  const { t } = useTranslation();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const { width, height } = useWindowDimensions();
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const decided = useSharedValue(false);
  const threshold = width * 0.28;

  const swipe = (decision: TriageDecision) => {
    if (decided.value) return;
    decided.value = true;
    if (decision === 'review') {
      ty.value = withTiming(-height, { duration: 260 }, () => runOnJS(onDecide)(decision));
    } else {
      const dir = decision === 'priority' ? 1 : -1;
      tx.value = withTiming(dir * width * 1.5, { duration: 260 }, () => runOnJS(onDecide)(decision));
    }
  };
  useImperativeHandle(ref, () => ({ swipe }));

  // Horizontal drags swipe the card; vertical drags fail the pan and scroll
  // the details instead.
  const pan = Gesture.Pan()
    .activeOffsetX([-14, 14])
    .failOffsetY([-14, 14])
    .onUpdate(e => {
      tx.value = e.translationX;
      ty.value = e.translationY * 0.15;
    })
    .onEnd(e => {
      const passed = Math.abs(e.translationX) > threshold;
      const flung = Math.abs(e.velocityX) > 900;
      if ((passed || flung) && !decided.value) {
        decided.value = true;
        const dir = passed ? Math.sign(e.translationX) : Math.sign(e.velocityX);
        tx.value = withTiming(dir * width * 1.5, { duration: 220 }, () =>
          runOnJS(onDecide)(dir > 0 ? 'priority' : 'skip'),
        );
      } else {
        tx.value = withSpring(0);
        ty.value = withSpring(0);
      }
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { rotate: `${interpolate(tx.value, [-width, width], [-12, 12])}deg` },
    ],
  }));
  const likeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [16, threshold], [0, 1], Extrapolation.CLAMP),
  }));
  const skipStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [-threshold, -16], [1, 0], Extrapolation.CLAMP),
  }));
  const reviewStyle = useAnimatedStyle(() => ({
    opacity: interpolate(ty.value, [-height * 0.3, -40], [1, 0], Extrapolation.CLAMP),
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }, cardStyle]}>
        <BookCardContent book={book} />

        <Animated.View pointerEvents="none" style={[styles.stamp, styles.stampLeft, { borderColor: LIKE_COLOR }, likeStyle]}>
          <ThemedText style={[styles.stampText, { color: LIKE_COLOR }]}>{t('triageAdd')}</ThemedText>
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.stamp, styles.stampRight, { borderColor: SKIP_COLOR }, skipStyle]}>
          <ThemedText style={[styles.stampText, { color: SKIP_COLOR }]}>{t('triageSkip')}</ThemedText>
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.stamp, styles.stampCenter, { borderColor: REVIEW_COLOR }, reviewStyle]}>
          <ThemedText style={[styles.stampText, { color: REVIEW_COLOR }]}>{t('triageReview')}</ThemedText>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

/* ── Card content: cover first, details further down ───────────────── */

function BookCardContent({ book, scrollable = true }: { book: TriageBook; scrollable?: boolean }) {
  const { t, i18n } = useTranslation();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const isGreek = i18n.language.startsWith('el');
  const genreNames = book.genres.map(g => (isGreek ? g.nameEl : g.nameEn));
  const meta = [
    book.publishedYear,
    book.pageCount ? t('bookPages', { count: book.pageCount }) : null,
    book.publisher,
  ].filter(Boolean) as string[];
  const details: [string, string | null | undefined][] = [
    [t('triageGenres'), genreNames.join(', ') || t('triageNoGenre')],
    [t('triageCategory'), book.categories?.join(' · ')],
    [t('triagePublisher'), book.publisher],
    [t('triageSeries'), [book.series, book.subSeries].filter(Boolean).join(' · ')],
    [t('triageEdition'), book.edition],
    [t('triageLanguage'), book.language],
    [t('bookIsbn'), book.isbn],
  ];

  return (
    <ScrollView
      scrollEnabled={scrollable}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.cardContent}
    >
      <Image
        source={{ uri: book.coverUrl || undefined }}
        style={[styles.cover, { backgroundColor: theme.border }]}
        contentFit="cover"
        transition={150}
      />
      <ThemedText style={[styles.title, { color: theme.text }]} numberOfLines={3}>
        {book.title || t('unknownTitle')}
      </ThemedText>
      <ThemedText style={[styles.author, { color: theme.secondary }]} numberOfLines={2}>
        {book.authors?.join(', ') || t('unknownAuthor')}
      </ThemedText>

      <View style={styles.metaRow}>
        {genreNames.length > 0 ? genreNames.map(g => (
          <View key={`g-${g}`} style={[styles.metaChip, { backgroundColor: AccentPalette[1] + '22' }]}>
            <ThemedText style={[styles.metaText, { color: AccentPalette[1] }]} numberOfLines={1}>{g}</ThemedText>
          </View>
        )) : (
          <View style={[styles.metaChip, { backgroundColor: theme.background }]}>
            <ThemedText style={[styles.metaText, { color: theme.secondary }]}>{t('triageNoGenre')}</ThemedText>
          </View>
        )}
        {(book.categories ?? []).map(c => (
          <View key={`c-${c}`} style={[styles.metaChip, { backgroundColor: AccentPalette[4] + '22' }]}>
            <ThemedText style={[styles.metaText, { color: AccentPalette[4] }]} numberOfLines={1}>{c}</ThemedText>
          </View>
        ))}
      </View>
      {meta.length > 0 && (
        <View style={styles.metaRow}>
          {meta.map(m => (
            <View key={m} style={[styles.metaChip, { backgroundColor: theme.background }]}>
              <ThemedText style={[styles.metaText, { color: theme.secondary }]} numberOfLines={1}>{m}</ThemedText>
            </View>
          ))}
        </View>
      )}

      {scrollable && (
        <View style={styles.scrollHint}>
          <Ionicons name="chevron-down" size={16} color={theme.secondary} />
          <ThemedText style={[styles.scrollHintText, { color: theme.secondary }]}>{t('triageScrollHint')}</ThemedText>
        </View>
      )}

      {scrollable && (
        <View style={styles.details}>
          <ThemedText style={[styles.detailsHeading, { color: theme.text }]}>{t('bookAbout')}</ThemedText>
          <ThemedText style={[styles.description, { color: theme.text }]}>
            {book.description?.trim() || t('bookNoDescription')}
          </ThemedText>
          <View style={[styles.detailTable, { borderColor: theme.border }]}>
            {details.filter(([, v]) => !!v).map(([label, value]) => (
              <View key={label} style={[styles.detailRow, { borderColor: theme.border }]}>
                <ThemedText style={[styles.detailLabel, { color: theme.secondary }]}>{label}</ThemedText>
                <ThemedText style={[styles.detailValue, { color: theme.text }]}>{value}</ThemedText>
              </View>
            ))}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

/* ── Screen ────────────────────────────────────────────────────────── */

export default function BookTriageScreen() {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];

  const [deck, setDeck] = useState<TriageBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [exhausted, setExhausted] = useState(false);
  const [counts, setCounts] = useState<TriageCounts | null>(null);
  const [history, setHistory] = useState<Decided[]>([]);

  const cardRef = useRef<SwipeCardHandle>(null);
  const fetching = useRef(false);
  // Writes run one after another so an undo never overtakes its own save.
  const writes = useRef<Promise<void>>(Promise.resolve());
  const isAdmin = !!(user as any)?.isAdmin;

  const loadMore = useCallback(async (current: TriageBook[]) => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const next = await fetchTriageDeck(current.map(b => b.id));
      if (next.length < TRIAGE_PAGE_SIZE) setExhausted(true);
      setDeck(prev => {
        const known = new Set(prev.map(b => b.id));
        return [...prev, ...next.filter(b => !known.has(b.id))];
      });
    } catch (e) {
      void logError(e, 'book-triage/loadDeck');
    } finally {
      fetching.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void loadMore([]);
  }, [isAdmin, loadMore]);

  // Refetch on focus so moves made on the list screen show up when coming back.
  useFocusEffect(useCallback(() => {
    if (!isAdmin) return;
    fetchTriageCounts().then(setCounts).catch(e => void logError(e, 'book-triage/counts'));
  }, [isAdmin]));

  useEffect(() => {
    if (!loading && !exhausted && deck.length < REFILL_BELOW) void loadMore(deck);
  }, [deck, loading, exhausted, loadMore]);

  const handleDecided = useCallback((book: TriageBook, decision: TriageDecision) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDeck(prev => prev.filter(b => b.id !== book.id));
    setHistory(prev => [...prev.slice(-19), { book, decision }]);
    setCounts(c => adjustCounts(c, decision, 1));

    const uid = user?.uid;
    if (!uid) return;
    writes.current = writes.current
      .then(() => saveTriageDecision(book.id, decision, uid))
      .catch(e => {
        void logError(e, 'book-triage/save');
        setDeck(prev => [book, ...prev.filter(b => b.id !== book.id)]);
        setHistory(prev => prev.filter(h => h.book.id !== book.id));
        setCounts(c => adjustCounts(c, decision, -1));
        Alert.alert(t('triageSaveFailed'));
      });
  }, [user?.uid, t]);

  const undo = useCallback(() => {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory(prev => prev.slice(0, -1));
    setDeck(prev => [last.book, ...prev.filter(b => b.id !== last.book.id)]);
    setCounts(c => adjustCounts(c, last.decision, -1));
    writes.current = writes.current
      .then(() => clearTriageDecision(last.book.id))
      .catch(e => void logError(e, 'book-triage/undo'));
  }, [history]);

  const fmt = (n: number) => n.toLocaleString(i18n.language);

  if (!isAdmin) {
    return (
      <SafeAreaView style={[styles.screen, styles.center, { backgroundColor: theme.background }]}>
        <ThemedText style={{ color: theme.secondary }}>Not authorized</ThemedText>
      </SafeAreaView>
    );
  }

  const top = deck[0];
  const next = deck[1];

  return (
    <GestureHandlerRootView style={[styles.screen, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.iconButton, { backgroundColor: theme.surface }]}>
          <Ionicons name="arrow-back" size={18} color={theme.text} />
        </TouchableOpacity>
        <ThemedText style={[styles.headerTitle, { color: theme.text }]}>{t('triageTitle')}</ThemedText>
      </View>

      <View style={styles.counters}>
        <View style={[styles.counter, { backgroundColor: theme.surface }]}>
          <ThemedText style={[styles.counterText, { color: theme.secondary }]}>
            {counts ? t('triageUnsynced', { count: fmt(counts.unsynced) as any }) : '…'}
          </ThemedText>
        </View>
        <View style={[styles.counter, { backgroundColor: LIKE_COLOR + '22' }]}>
          <ThemedText style={[styles.counterText, { color: theme.text }]}>
            {counts ? t('triageInList', { count: fmt(counts.inList) as any }) : '…'}
          </ThemedText>
        </View>
        <TouchableOpacity
          style={[styles.counter, styles.counterLink, { backgroundColor: SKIP_COLOR + '22' }]}
          onPress={() => router.push({ pathname: '/book-triage-list', params: { decision: 'skip' } })}
        >
          <ThemedText style={[styles.counterText, { color: theme.text }]}>
            {counts ? t('triageSkipped', { count: fmt(counts.skipped) as any }) : '…'}
          </ThemedText>
          <Ionicons name="chevron-forward" size={14} color={theme.secondary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.counter, styles.counterLink, { backgroundColor: REVIEW_COLOR + '33' }]}
          onPress={() => router.push({ pathname: '/book-triage-list', params: { decision: 'review' } })}
        >
          <ThemedText style={[styles.counterText, { color: theme.text }]}>
            {counts ? t('triageInReview', { count: fmt(counts.inReview) as any }) : '…'}
          </ThemedText>
          <Ionicons name="chevron-forward" size={14} color={theme.secondary} />
        </TouchableOpacity>
      </View>

      <View style={styles.deck}>
        {loading && !top ? (
          <ActivityIndicator size="small" color={theme.secondary} />
        ) : !top ? (
          <View style={styles.center}>
            <Ionicons name="checkmark-done" size={36} color={theme.secondary} />
            <ThemedText style={[styles.emptyText, { color: theme.secondary }]}>{t('triageEmpty')}</ThemedText>
          </View>
        ) : (
          <View style={styles.cardSlot}>
            {next && (
              <View
                key={`next-${next.id}`}
                pointerEvents="none"
                style={[styles.card, styles.nextCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
              >
                <BookCardContent book={next} scrollable={false} />
              </View>
            )}
            <SwipeCard key={top.id} ref={cardRef} book={top} onDecide={d => handleDecided(top, d)} />
          </View>
        )}
      </View>

      <View style={[styles.actions, { paddingBottom: insets.bottom + 16 }]}>
        <ActionButton icon="arrow-undo" color={theme.secondary} size={46} label={t('triageUndo')}
          disabled={history.length === 0} onPress={undo} />
        <ActionButton icon="close" color={SKIP_COLOR} size={64} label={t('triageSkip')}
          disabled={!top} onPress={() => cardRef.current?.swipe('skip')} />
        <ActionButton icon="bookmark" color={REVIEW_COLOR} size={52} label={t('triageReview')}
          disabled={!top} onPress={() => cardRef.current?.swipe('review')} />
        <ActionButton icon="heart" color={LIKE_COLOR} size={64} label={t('triageAdd')}
          disabled={!top} onPress={() => cardRef.current?.swipe('priority')} />
      </View>
    </GestureHandlerRootView>
  );
}

function ActionButton({ icon, color, size, label, disabled, onPress }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
  size: number;
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  return (
    <TouchableOpacity
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
      style={[
        styles.actionButton,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: theme.surface, opacity: disabled ? 0.4 : 1 },
      ]}
    >
      <Ionicons name={icon} size={size * 0.45} color={color} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 12 },
  iconButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 22, lineHeight: 28, fontWeight: '800', fontFamily: roundedFont('800') },
  counters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 20, paddingBottom: 12 },
  counter: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  counterText: { fontSize: 13, fontWeight: '600', fontFamily: roundedFont('600') },
  counterLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  deck: { flex: 1, paddingHorizontal: 32, paddingVertical: 8, alignItems: 'center', justifyContent: 'center' },
  cardSlot: { width: '100%', maxWidth: 340, height: '100%', maxHeight: 540 },
  card: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 4,
  },
  nextCard: { transform: [{ scale: 0.95 }, { translateY: 10 }] },
  cardContent: { alignItems: 'center', padding: 16, paddingBottom: 28 },
  cover: { width: '56%', aspectRatio: 0.67, borderRadius: 12 },
  title: { marginTop: 14, fontSize: 20, lineHeight: 26, fontWeight: '800', fontFamily: roundedFont('800'), textAlign: 'center' },
  author: { marginTop: 6, fontSize: 15, fontWeight: '500', fontFamily: roundedFont('500'), textAlign: 'center' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 12 },
  metaChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, maxWidth: '100%' },
  metaText: { fontSize: 12, fontWeight: '600', fontFamily: roundedFont('600') },
  scrollHint: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 16 },
  scrollHintText: { fontSize: 12, fontWeight: '500', fontFamily: roundedFont('500') },
  details: { alignSelf: 'stretch', marginTop: 20, gap: 10 },
  detailsHeading: { fontSize: 16, fontWeight: '700', fontFamily: roundedFont('700') },
  description: { fontSize: 15, lineHeight: 22 },
  detailTable: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 6 },
  detailRow: { flexDirection: 'row', gap: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  detailLabel: { width: 96, fontSize: 13, fontWeight: '600', fontFamily: roundedFont('600') },
  detailValue: { flex: 1, fontSize: 13 },
  stamp: { position: 'absolute', top: 28, borderWidth: 3, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  stampLeft: { left: 20, transform: [{ rotate: '-14deg' }] },
  stampRight: { right: 20, transform: [{ rotate: '14deg' }] },
  stampCenter: { alignSelf: 'center', top: 40 },
  stampText: { fontSize: 20, lineHeight: 26, fontWeight: '800', fontFamily: roundedFont('800'), textTransform: 'uppercase' },
  emptyText: { fontSize: 15, textAlign: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18, paddingTop: 16 },
  actionButton: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 3,
  },
});
