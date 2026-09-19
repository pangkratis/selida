import HorizontalBookShelf from '@/components/horizontal-book-shelf';
import { ThemedText } from '@/components/themed-text';
import { TAB_BAR_CONTENT_CLEARANCE } from '@/constants/tab-bar';
import { AccentPalette, Colors, roundedFont, toTransparent } from '@/constants/theme';
import { Book } from '@/constants/types';
import { HomeScrollContext, HomeScrollContextValue, HomeScrollListener } from '@/hooks/home-scroll-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { supabase } from '@/services/supabaseConfig';
import { getRecommendationsForUser, getTrendingBooksByViews, invalidateRecommendationsCache } from '@/services/recommendations';
import { logUserActivity } from '@/services/userActivity';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, StyleSheet, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../ctx';

/* ── Constants ─────────────────────────────────────────────────────── */

const SECTION_CACHE_TTL = 10 * 60 * 1000;
const READING_LIST_CACHE_TTL = 5 * 60 * 1000;
const TOTAL_SECTIONS = 11;
const INITIAL_REVEALED = 4;

/* ── Types ─────────────────────────────────────────────────────────── */

type ReadingEntry = { bookId: string; status?: string; addedAt?: any };

interface BYRSeed { bookId: string; title: string; category: string; }
interface MFASeed { author: string; }
interface DynamicPlan {
  becauseYouRead: BYRSeed[];
  moreFromAuthor: MFASeed[];
  popularCategory: string | null;
}

/* ── Module-level caches ───────────────────────────────────────────── */

const newArrivalsCache = new Map<string, { books: Book[]; ts: number }>();
const readingListCache = new Map<string, { entries: ReadingEntry[]; ts: number }>();
const recentlyViewedCache = new Map<string, { books: Book[]; ts: number }>();
const dynamicPlanCache = new Map<string, { plan: DynamicPlan; ts: number }>();
const byrShelfCache = new Map<string, { books: Book[]; ts: number }>();
const mfaShelfCache = new Map<string, { books: Book[]; ts: number }>();
const picShelfCache = new Map<string, { books: Book[]; ts: number }>();
const quickReadsCache = new Map<string, { books: Book[]; ts: number }>();

/* ── Helpers ───────────────────────────────────────────────────────── */

const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return { key: 'homeGreetingMorning' as const, emoji: '☀️' };
  if (hour < 17) return { key: 'homeGreetingAfternoon' as const, emoji: '⛅' };
  return { key: 'homeGreetingEvening' as const, emoji: '🌙' };
};

function SeeAllDots({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingLeft: 8 }}>
      {[AccentPalette[0], AccentPalette[1], AccentPalette[2]].map((color, i) => (
        <View key={i} style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: color }} />
      ))}
    </TouchableOpacity>
  );
}

/* ── Dynamic plan computation ──────────────────────────────────────── */

async function computeDynamicPlan(uid: string, entries: ReadingEntry[], refreshKey: number): Promise<DynamicPlan> {
  const cacheKey = `plan-${uid}-${refreshKey}`;
  const cached = dynamicPlanCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < SECTION_CACHE_TTL) return cached.plan;

  if (entries.length === 0) return { becauseYouRead: [], moreFromAuthor: [], popularCategory: null };

  // Shuffle for variety — different seeds each session/refresh
  const shuffled = [...entries].sort(() => Math.random() - 0.5);
  const sampleIds = [...new Set(shuffled.map(e => e.bookId))].slice(0, 7);

  const { data: snapData } = await supabase.from('books').select('*').in('id', sampleIds);
  const bookMap = new Map((snapData ?? []).map((d: any) => [d.id, d as Book]));

  // Up to 3 unique-category seeds for BecauseYouRead
  const usedCategories = new Set<string>();
  const byrSeeds: BYRSeed[] = [];
  for (const id of sampleIds) {
    const book = bookMap.get(id);
    if (!book?.categories?.[0]) continue;
    const cat = book.categories[0];
    if (!usedCategories.has(cat)) {
      usedCategories.add(cat);
      byrSeeds.push({ bookId: id, title: book.title, category: cat });
    }
    if (byrSeeds.length >= 3) break;
  }

  // Up to 2 unique-author seeds for MoreFromAuthor
  const usedAuthors = new Set<string>();
  const mfaSeeds: MFASeed[] = [];
  for (const id of sampleIds) {
    const book = bookMap.get(id);
    if (!book?.authors?.[0]) continue;
    const author = book.authors[0];
    if (!usedAuthors.has(author)) {
      usedAuthors.add(author);
      mfaSeeds.push({ author });
    }
    if (mfaSeeds.length >= 2) break;
  }

  // Popular category — prefer one not already covered by BYR
  let popularCategory: string | null = null;
  for (const id of sampleIds) {
    const book = bookMap.get(id);
    if (!book?.categories?.[0]) continue;
    const cat = book.categories[0];
    if (!usedCategories.has(cat)) { popularCategory = cat; break; }
  }
  if (!popularCategory && byrSeeds.length > 0) {
    popularCategory = byrSeeds[Math.floor(Math.random() * byrSeeds.length)].category;
  }

  const plan: DynamicPlan = { becauseYouRead: byrSeeds, moreFromAuthor: mfaSeeds, popularCategory };
  dynamicPlanCache.set(cacheKey, { plan, ts: Date.now() });
  return plan;
}

/* ── HomeScreen ────────────────────────────────────────────────────── */

export default function HomeScreen() {
  const { t } = useTranslation();
  const { user } = useSession();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [readingListEntries, setReadingListEntries] = useState<ReadingEntry[]>([]);
  const [dynamicPlan, setDynamicPlan] = useState<DynamicPlan | null>(null);
  const [revealedCount, setRevealedCount] = useState(INITIAL_REVEALED);

  const scrollListeners = useRef(new Set<HomeScrollListener>());
  const hintClaimed = useRef(false);
  const scrollContextValue = useMemo<HomeScrollContextValue>(() => ({
    active: true,
    addScrollListener: (fn) => {
      scrollListeners.current.add(fn);
      return () => scrollListeners.current.delete(fn);
    },
    claimHint: () => {
      if (hintClaimed.current) return false;
      hintClaimed.current = true;
      return true;
    },
  }), []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    if (user?.uid) {
      readingListCache.delete(user.uid);
      recentlyViewedCache.delete(user.uid);
      invalidateRecommendationsCache(user.uid);
    }
    newArrivalsCache.clear();
    dynamicPlanCache.clear();
    byrShelfCache.clear();
    mfaShelfCache.clear();
    picShelfCache.clear();
    quickReadsCache.clear();
    hintClaimed.current = false;
    setDynamicPlan(null);
    setRevealedCount(INITIAL_REVEALED);
    setRefreshKey(prev => prev + 1);
    setTimeout(() => setRefreshing(false), 1500);
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    const uid = user.uid;
    const cached = readingListCache.get(uid);
    if (cached && Date.now() - cached.ts < READING_LIST_CACHE_TTL) {
      setReadingListEntries(cached.entries);
      return;
    }
    supabase.from('readingList').select('bookId, status, addedAt').eq('userId', uid).limit(50)
      .then(({ data, error }) => {
        if (error) { console.error(error); return; }
        const entries = (data ?? []) as ReadingEntry[];
        readingListCache.set(uid, { entries, ts: Date.now() });
        setReadingListEntries(entries);
      });
  }, [user?.uid, refreshKey]);

  useEffect(() => {
    if (!user?.uid) return;
    if (readingListEntries.length === 0) {
      setDynamicPlan({ becauseYouRead: [], moreFromAuthor: [], popularCategory: null });
      return;
    }
    computeDynamicPlan(user.uid, readingListEntries, refreshKey)
      .then(setDynamicPlan)
      .catch(console.error);
  }, [user?.uid, readingListEntries, refreshKey]);

  const handleScroll = useCallback(({ nativeEvent }: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
    if (contentSize.height - contentOffset.y - layoutMeasurement.height < 600) {
      setRevealedCount(c => Math.min(c + 1, TOTAL_SECTIONS));
    }
    scrollListeners.current.forEach(fn => fn());
  }, []);

  return (
    <HomeScrollContext.Provider value={scrollContextValue}>
      <SafeAreaView edges={['bottom']} style={[styles.safeArea, { backgroundColor: theme.background }]}>
        <View style={styles.fadeContainer}>
          <ScrollView
            onScroll={handleScroll}
            scrollEventThrottle={150}
            decelerationRate={0.92}
            contentContainerStyle={styles.scrollContent}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={theme.primary}
                colors={[theme.primary]}
              />
            }
          >
            <View style={[styles.header, { paddingTop: insets.top + 24 }]}>
              <ThemedText style={[styles.headerGreeting, { color: theme.secondary }]}>
                {getGreeting().emoji}  {t(getGreeting().key)},
              </ThemedText>
              <ThemedText style={[styles.headerName, { color: theme.text }]}>
                {user?.displayName || 'Reader'}
              </ThemedText>
              <ThemedText style={[styles.headerSubtitle, { color: theme.secondary }]}>
                {t('homeSubtitle')}
              </ThemedText>
            </View>

            {/* sections 0–1: always loaded */}
            <RecommendationSection refreshKey={refreshKey} readingListEntries={readingListEntries} />
            <TrendingSection refreshKey={refreshKey} readingListEntries={readingListEntries} />

            {/* sections 2–10: revealed as user scrolls */}
            {revealedCount > 2 && dynamicPlan?.becauseYouRead[0] && (
              <BecauseYouReadShelf
                key={`byr-0-${dynamicPlan.becauseYouRead[0].bookId}`}
                seed={dynamicPlan.becauseYouRead[0]}
                readingListEntries={readingListEntries}
              />
            )}
            {revealedCount > 3 && dynamicPlan?.moreFromAuthor[0] && (
              <MoreFromAuthorShelf
                key={`mfa-0-${dynamicPlan.moreFromAuthor[0].author}`}
                seed={dynamicPlan.moreFromAuthor[0]}
                readingListEntries={readingListEntries}
              />
            )}
            {revealedCount > 4 && dynamicPlan?.becauseYouRead[1] && (
              <BecauseYouReadShelf
                key={`byr-1-${dynamicPlan.becauseYouRead[1].bookId}`}
                seed={dynamicPlan.becauseYouRead[1]}
                readingListEntries={readingListEntries}
              />
            )}
            {revealedCount > 5 && dynamicPlan?.popularCategory && (
              <PopularInCategoryShelf
                key={`pic-${dynamicPlan.popularCategory}`}
                category={dynamicPlan.popularCategory}
                readingListEntries={readingListEntries}
              />
            )}
            {revealedCount > 6 && dynamicPlan?.becauseYouRead[2] && (
              <BecauseYouReadShelf
                key={`byr-2-${dynamicPlan.becauseYouRead[2].bookId}`}
                seed={dynamicPlan.becauseYouRead[2]}
                readingListEntries={readingListEntries}
              />
            )}
            {revealedCount > 7 && dynamicPlan?.moreFromAuthor[1] && (
              <MoreFromAuthorShelf
                key={`mfa-1-${dynamicPlan.moreFromAuthor[1].author}`}
                seed={dynamicPlan.moreFromAuthor[1]}
                readingListEntries={readingListEntries}
              />
            )}
            {revealedCount > 8 && <QuickReadsSection refreshKey={refreshKey} readingListEntries={readingListEntries} />}
            {revealedCount > 9 && <RecentlyViewedSection refreshKey={refreshKey} readingListEntries={readingListEntries} />}
            {revealedCount > 10 && <NewArrivalsSection refreshKey={refreshKey} readingListEntries={readingListEntries} />}

            {revealedCount < TOTAL_SECTIONS && (
              <View style={styles.bottomLoader}>
                <ActivityIndicator size="small" color={theme.secondary} />
              </View>
            )}

          </ScrollView>

          <LinearGradient
            colors={[theme.background, theme.background, toTransparent(theme.background)]}
            locations={[0, 0.6, 1]}
            pointerEvents="none"
            style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top + 32 }}
          />
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
    </HomeScrollContext.Provider>
  );
}

/* ── RecommendationSection ─────────────────────────────────────────── */

function RecommendationSection({ refreshKey, readingListEntries }: { refreshKey: number; readingListEntries: ReadingEntry[] }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const [recommendations, setRecommendations] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const router = useRouter();

  useEffect(() => {
    async function fetchRecommendations() {
      setLoading(true);
      if (!user?.uid) { setLoading(false); return; }
      try {
        const preloaded = readingListEntries.length > 0 ? readingListEntries : undefined;
        const books = await getRecommendationsForUser(user.uid, 50, undefined, preloaded);
        setRecommendations(books);
      } catch (e) {
        console.error('Error fetching recommendations:', e);
      } finally {
        setLoading(false);
      }
    }
    fetchRecommendations();
  }, [user?.uid, refreshKey, readingListEntries]);

  if (loading) return <View style={styles.loadingContainer}><ActivityIndicator size="small" /></View>;
  if (recommendations.length === 0) return null;

  return (
    <View style={styles.sectionContainer}>
      <TouchableOpacity style={styles.sectionHeader} activeOpacity={0.7} onPress={() => router.push({ pathname: '/book-list', params: { title: t('homeRecommended'), type: 'recommendations' } })}>
        <ThemedText style={[styles.sectionLabel, { color: theme.secondary }]}>{t('homeRecommended')}</ThemedText>
        <SeeAllDots onPress={() => router.push({ pathname: '/book-list', params: { title: t('homeRecommended'), type: 'recommendations' } })} />
      </TouchableOpacity>
      <HorizontalBookShelf
        books={recommendations}
        keyPrefix="home-recommendation"
        onPressBook={(item) => {
          if (user?.uid) logUserActivity(user.uid, item.id, 'view_details', 'home_recommendations').catch(console.error);
          router.push({ pathname: '/book-details', params: { book: JSON.stringify(item) } });
        }}
      />
    </View>
  );
}

/* ── TrendingSection ───────────────────────────────────────────────── */

function TrendingSection({ refreshKey, readingListEntries }: { refreshKey: number; readingListEntries: ReadingEntry[] }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const [trendingBooks, setTrendingBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const router = useRouter();
  const { addScrollListener, claimHint } = useContext(HomeScrollContext);
  const containerRef = useRef<View>(null);
  const listRef = useRef<FlatList>(null);
  const hintFired = useRef(false);
  const { height: screenHeight } = useWindowDimensions();

  useEffect(() => {
    if (trendingBooks.length === 0) return;

    let unsubscribe: () => void;

    const checkPosition = () => {
      if (hintFired.current) { unsubscribe?.(); return; }
      containerRef.current?.measureInWindow((_x, y) => {
        if (y > screenHeight * 0.45 && y < screenHeight) {
          hintFired.current = true;
          unsubscribe?.();
          if (!claimHint()) return;
          setTimeout(() => listRef.current?.scrollToOffset({ offset: 52, animated: true }), 80);
          setTimeout(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }), 780);
        }
      });
    };

    unsubscribe = addScrollListener(checkPosition);
    const timer = setTimeout(checkPosition, 200);

    return () => { unsubscribe(); clearTimeout(timer); };
  }, [trendingBooks.length, addScrollListener, screenHeight]);

  useEffect(() => {
    async function fetchTrending() {
      setLoading(true);
      if (!user?.uid) { setLoading(false); return; }
      try {
        const books = await getTrendingBooksByViews(25);
        setTrendingBooks(books);
      } catch (e) {
        console.error('Error fetching trending books:', e);
      } finally {
        setLoading(false);
      }
    }
    fetchTrending();
  }, [user?.uid, refreshKey]);

  if (loading) return <View style={styles.loadingContainer}><ActivityIndicator size="small" /></View>;

  const readSet = new Set(readingListEntries.map(e => e.bookId));
  const filtered = trendingBooks.filter(b => !readSet.has(b.id));
  if (filtered.length === 0) return null;

  return (
    <View style={styles.sectionContainer}>
      <TouchableOpacity style={styles.sectionHeader} activeOpacity={0.7} onPress={() => router.push({ pathname: '/book-list', params: { title: t('homeTrending'), type: 'trending' } })}>
        <ThemedText style={[styles.sectionLabel, { color: theme.secondary }]}>{t('homeTrending')}</ThemedText>
        <SeeAllDots onPress={() => router.push({ pathname: '/book-list', params: { title: t('homeTrending'), type: 'trending' } })} />
      </TouchableOpacity>
      <View ref={containerRef}>
        <FlatList
          ref={listRef}
          data={filtered}
          horizontal
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          contentContainerStyle={{ paddingHorizontal: 20 }}
          keyExtractor={(item) => `trending-${item.id}`}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.bookCard}
              onPress={() => {
                if (user?.uid) logUserActivity(user.uid, item.id, 'view_details', 'home_trending').catch(console.error);
                      router.push({ pathname: '/book-details', params: { book: JSON.stringify(item) } });
              }}
            >
              <Image
                source={{ uri: item.coverUrl || undefined }}
                style={[styles.bookCover, { backgroundColor: theme.border }]}
                contentFit="cover"
                transition={200}
              />
              <ThemedText style={styles.bookTitle} numberOfLines={1}>{item.title}</ThemedText>
              <ThemedText style={[styles.bookAuthor, { color: theme.secondary }]} numberOfLines={1}>{item.authors?.[0]}</ThemedText>
            </TouchableOpacity>
          )}
        />
      </View>
    </View>
  );
}

/* ── BecauseYouReadShelf ───────────────────────────────────────────── */

function BecauseYouReadShelf({ seed, readingListEntries }: { seed: BYRSeed; readingListEntries: ReadingEntry[] }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const router = useRouter();

  useEffect(() => {
    if (!user?.uid) { setLoading(false); return; }
    const cacheKey = `byr-${user.uid}-${seed.bookId}`;
    const cached = byrShelfCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < SECTION_CACHE_TTL) {
      setBooks(cached.books);
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const { data, error } = await supabase.from('books').select('*').contains('categories', [seed.category]).limit(20);
        if (error) throw error;
        const readSet = new Set(readingListEntries.map(e => e.bookId));
        const result = (data ?? [])
          .filter((b: any) => !readSet.has(b.id) && b.id !== seed.bookId)
          .sort((a: any, b: any) => (b.popularityCount || 0) - (a.popularityCount || 0)) as Book[];
        byrShelfCache.set(cacheKey, { books: result, ts: Date.now() });
        setBooks(result);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, [seed.bookId, seed.category, user?.uid]);

  if (loading) return <View style={styles.loadingContainer}><ActivityIndicator size="small" /></View>;
  if (books.length === 0) return null;

  const titleLabel = seed.title.length > 22 ? seed.title.substring(0, 22).trimEnd() + '…' : seed.title;

  return (
    <View style={styles.sectionContainer}>
      <View style={styles.sectionHeader}>
        <ThemedText style={[styles.sectionLabel, { color: theme.secondary }]} numberOfLines={1}>
          {t('homeBecauseYouRead', { title: titleLabel })}
        </ThemedText>
      </View>
      <HorizontalBookShelf
        books={books}
        keyPrefix={`byr-${seed.bookId}`}
        onPressBook={(item) => {
          if (user?.uid) logUserActivity(user.uid, item.id, 'view_details', 'home_because_you_read').catch(console.error);
          router.push({ pathname: '/book-details', params: { book: JSON.stringify(item) } });
        }}
      />
    </View>
  );
}

/* ── MoreFromAuthorShelf ───────────────────────────────────────────── */

function MoreFromAuthorShelf({ seed, readingListEntries }: { seed: MFASeed; readingListEntries: ReadingEntry[] }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const router = useRouter();

  useEffect(() => {
    if (!user?.uid) { setLoading(false); return; }
    const cacheKey = `mfa-${user.uid}-${seed.author}`;
    const cached = mfaShelfCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < SECTION_CACHE_TTL) {
      setBooks(cached.books);
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const { data, error } = await supabase.from('books').select('*').contains('authors', [seed.author]).limit(20);
        if (error) throw error;
        const readSet = new Set(readingListEntries.map(e => e.bookId));
        const result = (data ?? [])
          .filter((b: any) => !readSet.has(b.id))
          .sort((a: any, b: any) => (b.popularityCount || 0) - (a.popularityCount || 0)) as Book[];
        mfaShelfCache.set(cacheKey, { books: result, ts: Date.now() });
        setBooks(result);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, [seed.author, user?.uid]);

  if (loading) return <View style={styles.loadingContainer}><ActivityIndicator size="small" /></View>;
  if (books.length === 0) return null;

  const authorLabel = seed.author.length > 25 ? seed.author.substring(0, 25).trimEnd() + '…' : seed.author;

  return (
    <View style={styles.sectionContainer}>
      <View style={styles.sectionHeader}>
        <ThemedText style={[styles.sectionLabel, { color: theme.secondary }]} numberOfLines={1}>
          {t('homeMoreFromAuthor', { author: authorLabel })}
        </ThemedText>
      </View>
      <HorizontalBookShelf
        books={books}
        keyPrefix={`mfa-${seed.author}`}
        onPressBook={(item) => {
          if (user?.uid) logUserActivity(user.uid, item.id, 'view_details', 'home_more_from_author').catch(console.error);
          router.push({ pathname: '/book-details', params: { book: JSON.stringify(item) } });
        }}
      />
    </View>
  );
}

/* ── PopularInCategoryShelf ────────────────────────────────────────── */

function PopularInCategoryShelf({ category, readingListEntries }: { category: string; readingListEntries: ReadingEntry[] }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const router = useRouter();

  useEffect(() => {
    if (!user?.uid) { setLoading(false); return; }
    const cacheKey = `pic-${user.uid}-${category}`;
    const cached = picShelfCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < SECTION_CACHE_TTL) {
      setBooks(cached.books);
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const { data, error } = await supabase.from('books').select('*').contains('categories', [category]).limit(20);
        if (error) throw error;
        const readSet = new Set(readingListEntries.map(e => e.bookId));
        const result = (data ?? [])
          .filter((b: any) => !readSet.has(b.id))
          .sort((a: any, b: any) => (b.popularityCount || 0) - (a.popularityCount || 0)) as Book[];
        picShelfCache.set(cacheKey, { books: result, ts: Date.now() });
        setBooks(result);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, [category, user?.uid]);

  if (loading) return <View style={styles.loadingContainer}><ActivityIndicator size="small" /></View>;
  if (books.length === 0) return null;

  const catLabel = category.length > 25 ? category.substring(0, 25).trimEnd() + '…' : category;

  return (
    <View style={styles.sectionContainer}>
      <View style={styles.sectionHeader}>
        <ThemedText style={[styles.sectionLabel, { color: theme.secondary }]} numberOfLines={1}>
          {t('homePopularIn', { category: catLabel })}
        </ThemedText>
      </View>
      <HorizontalBookShelf
        books={books}
        keyPrefix={`pic-${category}`}
        onPressBook={(item) => {
          if (user?.uid) logUserActivity(user.uid, item.id, 'view_details', 'home_popular_category').catch(console.error);
          router.push({ pathname: '/book-details', params: { book: JSON.stringify(item) } });
        }}
      />
    </View>
  );
}

/* ── QuickReadsSection ─────────────────────────────────────────────── */

function QuickReadsSection({ refreshKey, readingListEntries }: { refreshKey: number; readingListEntries: ReadingEntry[] }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const router = useRouter();

  useEffect(() => {
    if (!user?.uid) { setLoading(false); return; }
    const cacheKey = 'quick-reads';
    const cached = quickReadsCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < SECTION_CACHE_TTL) {
      setBooks(cached.books);
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const { data, error } = await supabase.from('books').select('*').gte('pageCount', 60).lte('pageCount', 120).limit(25);
        if (error) throw error;
        const result = (data ?? [])
          .sort((a: any, b: any) => (b.popularityCount || 0) - (a.popularityCount || 0)) as Book[];
        quickReadsCache.set(cacheKey, { books: result, ts: Date.now() });
        setBooks(result);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, [user?.uid, refreshKey]);

  if (loading) return <View style={styles.loadingContainer}><ActivityIndicator size="small" /></View>;

  const readSet = new Set(readingListEntries.map(e => e.bookId));
  const filtered = books.filter(b => !readSet.has(b.id));
  if (filtered.length === 0) return null;

  return (
    <View style={styles.sectionContainer}>
      <View style={styles.sectionHeader}>
        <ThemedText style={[styles.sectionLabel, { color: theme.secondary }]}>{t('homeQuickReads')}</ThemedText>
      </View>
      <HorizontalBookShelf
        books={filtered}
        keyPrefix="home-quick-reads"
        onPressBook={(item) => {
          if (user?.uid) logUserActivity(user.uid, item.id, 'view_details', 'home_quick_reads').catch(console.error);
          router.push({ pathname: '/book-details', params: { book: JSON.stringify(item) } });
        }}
      />
    </View>
  );
}

/* ── RecentlyViewedSection ─────────────────────────────────────────── */

function RecentlyViewedSection({ refreshKey, readingListEntries }: { refreshKey: number; readingListEntries: ReadingEntry[] }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const router = useRouter();

  useEffect(() => {
    async function fetch() {
      setLoading(true);
      if (!user?.uid) { setLoading(false); return; }
      try {
        const cached = recentlyViewedCache.get(user.uid);
        if (cached && Date.now() - cached.ts < SECTION_CACHE_TTL) {
          setBooks(cached.books);
          setLoading(false);
          return;
        }

        const { data: activityData } = await supabase
          .from('userActivity')
          .select('bookId, action, createdAt')
          .eq('userId', user.uid)
          .eq('action', 'view_details')
          .order('createdAt', { ascending: false })
          .limit(30);

        const seen = new Set<string>();
        const bookIds: string[] = [];
        for (const d of activityData ?? []) {
          const id = d.bookId as string;
          if (id && !seen.has(id)) { seen.add(id); bookIds.push(id); }
          if (bookIds.length >= 30) break;
        }
        if (bookIds.length === 0) { setLoading(false); return; }

        const { data: booksData } = await supabase.from('books').select('*').in('id', bookIds);
        const bookMap = new Map<string, Book>((booksData ?? []).map((d: any) => [d.id, d as Book]));
        const result = bookIds.map(id => bookMap.get(id)).filter((b): b is Book => !!b);

        recentlyViewedCache.set(user.uid, { books: result, ts: Date.now() });
        setBooks(result);
      } catch (e) {
        console.error('Error fetching recently viewed:', e);
      } finally {
        setLoading(false);
      }
    }
    fetch();
  }, [user?.uid, refreshKey]);

  if (loading) return <View style={styles.loadingContainer}><ActivityIndicator size="small" /></View>;

  const readSet = new Set(readingListEntries.map(e => e.bookId));
  const filtered = books.filter(b => !readSet.has(b.id));
  if (filtered.length === 0) return null;

  return (
    <View style={styles.sectionContainer}>
      <View style={styles.sectionHeader}>
        <ThemedText style={[styles.sectionLabel, { color: theme.secondary }]}>{t('homeRecentlyViewed')}</ThemedText>
      </View>
      <HorizontalBookShelf
        books={filtered}
        keyPrefix="home-recently-viewed"
        onPressBook={(item) => {
          if (user?.uid) logUserActivity(user.uid, item.id, 'view_details', 'home_recently_viewed').catch(console.error);
          router.push({ pathname: '/book-details', params: { book: JSON.stringify(item) } });
        }}
      />
    </View>
  );
}

/* ── NewArrivalsSection ────────────────────────────────────────────── */

function NewArrivalsSection({ refreshKey, readingListEntries }: { refreshKey: number; readingListEntries: ReadingEntry[] }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const router = useRouter();

  useEffect(() => {
    async function fetchNewArrivals() {
      setLoading(true);
      if (!user?.uid) { setLoading(false); return; }
      try {
        const cacheKey = 'new-arrivals';
        const cached = newArrivalsCache.get(cacheKey);
        if (cached && Date.now() - cached.ts < SECTION_CACHE_TTL) {
          setBooks(cached.books);
          setLoading(false);
          return;
        }
        const { data: newData } = await supabase.from('books').select('*').order('createdAt', { ascending: false }).limit(40);
        const results: Book[] = (newData ?? []) as Book[];
        newArrivalsCache.set(cacheKey, { books: results, ts: Date.now() });
        setBooks(results);
      } catch (e) {
        console.error('Error fetching new arrivals:', e);
      } finally {
        setLoading(false);
      }
    }
    fetchNewArrivals();
  }, [user?.uid, refreshKey]);

  if (loading) return <View style={styles.loadingContainer}><ActivityIndicator size="small" /></View>;

  const readSet = new Set(readingListEntries.map(e => e.bookId));
  const filtered = books.filter(b => !readSet.has(b.id));
  if (filtered.length === 0) return null;

  return (
    <View style={styles.sectionContainer}>
      <View style={styles.sectionHeader}>
        <ThemedText style={[styles.sectionLabel, { color: theme.secondary }]}>{t('homeNewArrivals')}</ThemedText>
      </View>
      <HorizontalBookShelf
        books={filtered}
        keyPrefix="home-new-arrivals"
        onPressBook={(item) => {
          if (user?.uid) logUserActivity(user.uid, item.id, 'view_details', 'home_new_arrivals').catch(console.error);
          router.push({ pathname: '/book-details', params: { book: JSON.stringify(item) } });
        }}
      />
    </View>
  );
}

/* ── Styles ────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  fadeContainer: { flex: 1 },
  fadeBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: TAB_BAR_CONTENT_CLEARANCE + 24,
  },
  scrollContent: { paddingBottom: TAB_BAR_CONTENT_CLEARANCE },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 28,
  },
  headerGreeting: {
    fontSize: 14,
    fontWeight: '500',
    fontFamily: roundedFont('500'),
    marginBottom: 8,
  },
  headerName: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '800',
    fontFamily: roundedFont('800'),
    letterSpacing: -1,
    marginBottom: 6,
  },
  headerSubtitle: {
    fontSize: 14,
    fontWeight: '400',
    fontFamily: roundedFont('400'),
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.1,
    flex: 1,
  },
  sectionContainer: { marginBottom: 32 },
  loadingContainer: {
    padding: 20,
    alignItems: 'center',
  },
  bottomLoader: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  bookCard: {
    width: 140,
    marginRight: 16,
  },
  bookCover: {
    width: 140,
    height: 200,
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
  },
  bookTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  bookAuthor: { fontSize: 12 },
});