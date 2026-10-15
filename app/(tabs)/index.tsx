import HorizontalBookShelf from '@/components/horizontal-book-shelf';
import { ThemedText } from '@/components/themed-text';
import { TAB_BAR_CONTENT_CLEARANCE } from '@/constants/tab-bar';
import { AccentPalette, Colors, roundedFont, toTransparent } from '@/constants/theme';
import { Book } from '@/constants/types';
import { HomeScrollContext, HomeScrollContextValue, HomeScrollListener } from '@/hooks/home-scroll-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { clearPagedShelfCache, usePagedShelf } from '@/hooks/use-paged-shelf';
import { logError, reportError } from '@/services/errorLog';
import { supabase } from '@/services/supabaseConfig';
import { getRecommendationPage, invalidateRecommendationsCache } from '@/services/recommendations';
import { fetchShelfPage } from '@/services/shelves';
import { logUserActivity } from '@/services/userActivity';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../ctx';

/* ── Constants ─────────────────────────────────────────────────────── */

const SECTION_CACHE_TTL = 10 * 60 * 1000;
const READING_LIST_CACHE_TTL = 5 * 60 * 1000;
const TOTAL_SECTIONS = 11;
const INITIAL_REVEALED = 4;
// A genre or subject heading needs this many books to be worth a shelf.
const MIN_TOPIC_BOOKS = 40;

/* ── Types ─────────────────────────────────────────────────────────── */

type ReadingEntry = { bookId: string; status?: string; addedAt?: any };

interface ShelfTopic { kind: 'genre' | 'subcategory'; key: string; labelEn: string; labelEl: string; }
interface BYRSeed { bookId: string; title: string; topic: ShelfTopic; }
interface MFASeed { author: string; }
interface DynamicPlan {
  becauseYouRead: BYRSeed[];
  moreFromAuthor: MFASeed[];
  popularTopic: ShelfTopic | null;
}

/* ── Module-level caches ───────────────────────────────────────────── */

const readingListCache = new Map<string, { entries: ReadingEntry[]; ts: number }>();
const recentlyViewedCache = new Map<string, { books: Book[]; ts: number }>();
const dynamicPlanCache = new Map<string, { plan: DynamicPlan; ts: number }>();

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

const topicId = (t: ShelfTopic) => `${t.kind}:${t.key}`;

async function computeDynamicPlan(uid: string, entries: ReadingEntry[], refreshKey: number): Promise<DynamicPlan> {
  const cacheKey = `plan-${uid}-${refreshKey}`;
  const cached = dynamicPlanCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < SECTION_CACHE_TTL) return cached.plan;

  if (entries.length === 0) return { becauseYouRead: [], moreFromAuthor: [], popularTopic: null };

  // Shuffle for variety — different seeds each session/refresh
  const shuffled = [...entries].sort(() => Math.random() - 0.5);
  const sampleIds = [...new Set(shuffled.map(e => e.bookId))].slice(0, 7);

  const [booksRes, genresRes, browsableRes] = await Promise.all([
    supabase.from('books').select('*').in('id', sampleIds),
    supabase.from('book_genres').select('book_id, confidence, genres(slug, name_en, name_el)').in('book_id', sampleIds),
    supabase.rpc('get_browsable_genres', { p_min_books: MIN_TOPIC_BOOKS }),
  ]);
  const bookMap = new Map((booksRes.data ?? []).map((d: any) => [d.id, d as Book]));
  const allowedGenres = new Set(((browsableRes.data ?? []) as { slug: string }[]).map(g => g.slug));

  // Subject headings are only worth a shelf when enough books carry them.
  const subjectNames = [...new Set([...bookMap.values()].flatMap(b => b.subcategories ?? []))];
  const subjectCounts = new Map<string, number>();
  if (subjectNames.length > 0) {
    const { data } = await supabase.from('subcategories').select('name, book_subcategories(count)').in('name', subjectNames);
    for (const row of (data ?? []) as any[]) subjectCounts.set(row.name, row.book_subcategories?.[0]?.count ?? 0);
  }

  const genreByBook = new Map<string, { conf: number; topic: ShelfTopic }>();
  for (const row of (genresRes.data ?? []) as any[]) {
    const g = row.genres;
    if (!g || !allowedGenres.has(g.slug)) continue;
    const best = genreByBook.get(row.book_id);
    if (!best || row.confidence > best.conf) {
      genreByBook.set(row.book_id, { conf: row.confidence, topic: { kind: 'genre', key: g.slug, labelEn: g.name_en, labelEl: g.name_el } });
    }
  }

  // The most specific subject heading that still has enough books, else the book's genre.
  const topicFor = (book: Book): ShelfTopic | null => {
    const subject = (book.subcategories ?? [])
      .filter(name => (subjectCounts.get(name) ?? 0) >= MIN_TOPIC_BOOKS)
      .sort((a, b) => (subjectCounts.get(a) ?? 0) - (subjectCounts.get(b) ?? 0))[0];
    if (subject) return { kind: 'subcategory', key: subject, labelEn: subject, labelEl: subject };
    return genreByBook.get(book.id)?.topic ?? null;
  };

  // Up to 3 seeds with different topics for BecauseYouRead
  const usedTopics = new Set<string>();
  const byrSeeds: BYRSeed[] = [];
  for (const id of sampleIds) {
    const book = bookMap.get(id);
    const topic = book && topicFor(book);
    if (!book || !topic || usedTopics.has(topicId(topic))) continue;
    usedTopics.add(topicId(topic));
    byrSeeds.push({ bookId: id, title: book.title, topic });
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

  // Popular shelf: a topic not already covered above. No fallback — repeating
  // a Because-you-read topic would show nearly the same books twice.
  let popularTopic: ShelfTopic | null = null;
  for (const id of sampleIds) {
    const book = bookMap.get(id);
    const topic = book && topicFor(book);
    if (topic && !usedTopics.has(topicId(topic))) { popularTopic = topic; break; }
  }

  const plan: DynamicPlan = { becauseYouRead: byrSeeds, moreFromAuthor: mfaSeeds, popularTopic };
  dynamicPlanCache.set(cacheKey, { plan, ts: Date.now() });
  return plan;
}

/* ── HomeScreen ────────────────────────────────────────────────────── */

export default function HomeScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<BottomTabNavigationProp<Record<string, undefined>>>();
  const scrollRef = useRef<ScrollView>(null);

  // Pressing the Home tab while already on Home scrolls back to the top,
  // the same as most tab bars. Tab presses on other tabs don't reach here.
  useEffect(() => {
    return navigation.addListener('tabPress', () => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    });
  }, [navigation]);

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
    clearPagedShelfCache();
    dynamicPlanCache.clear();
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
        if (error) { void logError(error, 'home/readingList'); return; }
        const entries = (data ?? []) as ReadingEntry[];
        readingListCache.set(uid, { entries, ts: Date.now() });
        setReadingListEntries(entries);
      });
  }, [user?.uid, refreshKey]);

  useEffect(() => {
    if (!user?.uid) return;
    if (readingListEntries.length === 0) {
      setDynamicPlan({ becauseYouRead: [], moreFromAuthor: [], popularTopic: null });
      return;
    }
    computeDynamicPlan(user.uid, readingListEntries, refreshKey)
      .then(setDynamicPlan)
      .catch(reportError('home/computeDynamicPlan'));
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
            ref={scrollRef}
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
            {revealedCount > 5 && dynamicPlan?.popularTopic && (
              <PopularInTopicShelf
                key={`pit-${topicId(dynamicPlan.popularTopic)}`}
                topic={dynamicPlan.popularTopic}
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

/* ── PagedShelfSection ─────────────────────────────────────────────── */

type PagedShelfSectionProps = {
  cacheKey: string | null;
  errorContext: string;
  load: (offset: number, limit: number) => Promise<Book[]>;
  title: string;
  keyPrefix: string;
  activityContext: string;
  readingListEntries: ReadingEntry[];
  seeAllType?: string;
};

// One shelf that keeps loading as the user scrolls it; "see all" (when given)
// is the fallback for browsing the same list as a grid.
function PagedShelfSection({
  cacheKey, errorContext, load, title, keyPrefix, activityContext, readingListEntries, seeAllType,
}: PagedShelfSectionProps) {
  const { user } = useSession();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const router = useRouter();
  const { books, loading, loadingMore, loadMore } = usePagedShelf(cacheKey, errorContext, load);

  const visible = useMemo(() => {
    const readSet = new Set(readingListEntries.map(e => e.bookId));
    return books.filter(b => !readSet.has(b.id));
  }, [books, readingListEntries]);

  if (loading) return <View style={styles.loadingContainer}><ActivityIndicator size="small" /></View>;
  if (visible.length === 0) return null;

  const openSeeAll = () => router.push({ pathname: '/book-list', params: { title, type: seeAllType } });

  return (
    <View style={styles.sectionContainer}>
      {seeAllType ? (
        <TouchableOpacity style={styles.sectionHeader} activeOpacity={0.7} onPress={openSeeAll}>
          <ThemedText style={[styles.sectionLabel, { color: theme.secondary }]}>{title}</ThemedText>
          <SeeAllDots onPress={openSeeAll} />
        </TouchableOpacity>
      ) : (
        <View style={styles.sectionHeader}>
          <ThemedText style={[styles.sectionLabel, { color: theme.secondary }]} numberOfLines={1}>{title}</ThemedText>
        </View>
      )}
      <HorizontalBookShelf
        books={visible}
        keyPrefix={keyPrefix}
        onEndReached={loadMore}
        loadingMore={loadingMore}
        snapCenter
        onPressBook={(item) => {
          if (user?.uid) logUserActivity(user.uid, item.id, 'view_details', activityContext);
          router.push({ pathname: '/book-details', params: { book: JSON.stringify(item) } });
        }}
      />
    </View>
  );
}

const shortLabel = (text: string, max: number) => (text.length > max ? text.substring(0, max).trimEnd() + '…' : text);

/* ── Shelves ───────────────────────────────────────────────────────── */

type ShelfProps = { readingListEntries: ReadingEntry[] };
type KeyedShelfProps = ShelfProps & { refreshKey: number };

function RecommendationSection({ refreshKey, readingListEntries }: KeyedShelfProps) {
  const { t } = useTranslation();
  const uid = useSession().user?.uid;
  return (
    <PagedShelfSection
      cacheKey={uid ? `recs-${uid}-${refreshKey}` : null}
      errorContext="home/recommendations"
      load={(offset, limit) => getRecommendationPage(uid ?? '', offset, limit)}
      title={t('homeRecommended')}
      keyPrefix="home-recommendation"
      activityContext="home_recommendations"
      readingListEntries={readingListEntries}
      seeAllType="recommendations"
    />
  );
}

function TrendingSection({ refreshKey, readingListEntries }: KeyedShelfProps) {
  const { t } = useTranslation();
  const uid = useSession().user?.uid;
  return (
    <PagedShelfSection
      cacheKey={uid ? `trending-${uid}-${refreshKey}` : null}
      errorContext="home/trending"
      load={(offset, limit) => fetchShelfPage('trending', null, offset, limit)}
      title={t('homeTrending')}
      keyPrefix="trending"
      activityContext="home_trending"
      readingListEntries={readingListEntries}
      seeAllType="trending"
    />
  );
}

function BecauseYouReadShelf({ seed, readingListEntries }: ShelfProps & { seed: BYRSeed }) {
  const { t } = useTranslation();
  const uid = useSession().user?.uid;
  return (
    <PagedShelfSection
      cacheKey={uid ? `byr-${uid}-${seed.bookId}-${topicId(seed.topic)}` : null}
      errorContext="home/becauseYouRead"
      load={(offset, limit) => fetchShelfPage(seed.topic.kind, seed.topic.key, offset, limit, seed.bookId)}
      title={t('homeBecauseYouRead', { title: shortLabel(seed.title, 22) })}
      keyPrefix={`byr-${seed.bookId}`}
      activityContext="home_because_you_read"
      readingListEntries={readingListEntries}
    />
  );
}

function MoreFromAuthorShelf({ seed, readingListEntries }: ShelfProps & { seed: MFASeed }) {
  const { t } = useTranslation();
  const uid = useSession().user?.uid;
  return (
    <PagedShelfSection
      cacheKey={uid ? `mfa-${uid}-${seed.author}` : null}
      errorContext="home/moreFromAuthor"
      load={(offset, limit) => fetchShelfPage('author', seed.author, offset, limit)}
      title={t('homeMoreFromAuthor', { author: shortLabel(seed.author, 25) })}
      keyPrefix={`mfa-${seed.author}`}
      activityContext="home_more_from_author"
      readingListEntries={readingListEntries}
    />
  );
}

function PopularInTopicShelf({ topic, readingListEntries }: ShelfProps & { topic: ShelfTopic }) {
  const { t, i18n } = useTranslation();
  const uid = useSession().user?.uid;
  const label = i18n.language.startsWith('el') ? topic.labelEl : topic.labelEn;
  return (
    <PagedShelfSection
      cacheKey={uid ? `pit-${uid}-${topicId(topic)}` : null}
      errorContext="home/popularTopic"
      load={(offset, limit) => fetchShelfPage(topic.kind, topic.key, offset, limit)}
      title={t('homePopularIn', { category: shortLabel(label, 25) })}
      keyPrefix={`pit-${topicId(topic)}`}
      activityContext="home_popular_category"
      readingListEntries={readingListEntries}
    />
  );
}

function QuickReadsSection({ refreshKey, readingListEntries }: KeyedShelfProps) {
  const { t } = useTranslation();
  const uid = useSession().user?.uid;
  return (
    <PagedShelfSection
      cacheKey={uid ? `quick-${uid}-${refreshKey}` : null}
      errorContext="home/quickReads"
      load={(offset, limit) => fetchShelfPage('quick', null, offset, limit)}
      title={t('homeQuickReads')}
      keyPrefix="home-quick-reads"
      activityContext="home_quick_reads"
      readingListEntries={readingListEntries}
    />
  );
}

function NewArrivalsSection({ refreshKey, readingListEntries }: KeyedShelfProps) {
  const { t } = useTranslation();
  const uid = useSession().user?.uid;
  return (
    <PagedShelfSection
      cacheKey={uid ? `new-${uid}-${refreshKey}` : null}
      errorContext="home/newArrivals"
      load={(offset, limit) => fetchShelfPage('new', null, offset, limit)}
      title={t('homeNewArrivals')}
      keyPrefix="home-new-arrivals"
      activityContext="home_new_arrivals"
      readingListEntries={readingListEntries}
    />
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
        void logError(e, 'home/recentlyViewed');
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
          if (user?.uid) logUserActivity(user.uid, item.id, 'view_details', 'home_recently_viewed');
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
});