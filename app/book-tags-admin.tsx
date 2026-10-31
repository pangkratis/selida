import { useSession } from '@/app/ctx';
import { useDialog } from '@/components/app-dialog';
import { ThemedText } from '@/components/themed-text';
import { AccentPalette, Colors, mixHex, roundedFont } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  BookTag,
  ENRICHED_PAGE_SIZE,
  EnrichOverview,
  EnrichedBook,
  EnrichedFilter,
  fetchEnrichOverview,
  fetchEnrichedBooks,
  removeBookTag,
  requeueBookEnrichment,
  setEnrichEnabled,
  tagLabel,
} from '@/services/book-tags';
import { logError } from '@/services/errorLog';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const RUNNING_COLOR = AccentPalette[3];
const FILTERS: EnrichedFilter[] = ['all', 'thin', 'failed', 'skipped'];

// Settings → Admin → "Book tags": the daily enrichment job's state, and every
// enriched book with its tags. Admins can pause the job, remove a wrong tag,
// or send a book back to the queue to be tagged again.
export default function BookTagsAdminScreen() {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const router = useRouter();
  const dialog = useDialog();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const isAdmin = !!(user as any)?.isAdmin;
  const isGreek = i18n.language.startsWith('el');

  const [overview, setOverview] = useState<EnrichOverview | null>(null);
  const [toggling, setToggling] = useState(false);
  const [filter, setFilter] = useState<EnrichedFilter>('all');
  const [search, setSearch] = useState('');
  const [books, setBooks] = useState<EnrichedBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const fetching = useRef(false);
  const requestId = useRef(0);

  const loadOverview = useCallback(async () => {
    try {
      setOverview(await fetchEnrichOverview());
    } catch (e) {
      void logError(e, 'book-tags-admin/loadOverview');
    }
  }, []);

  const loadBooks = useCallback(async (offset: number) => {
    if (offset > 0 && fetching.current) return;
    fetching.current = true;
    const id = ++requestId.current;
    try {
      const page = await fetchEnrichedBooks(filter, search.trim(), offset);
      if (id !== requestId.current) return; // a newer filter/search won
      setHasMore(page.length >= ENRICHED_PAGE_SIZE);
      setBooks(prev => {
        if (offset === 0) return page;
        const known = new Set(prev.map(b => b.id));
        return [...prev, ...page.filter(b => !known.has(b.id))];
      });
    } catch (e) {
      void logError(e, 'book-tags-admin/loadBooks');
    } finally {
      if (id === requestId.current) {
        fetching.current = false;
        setLoading(false);
      }
    }
  }, [filter, search]);

  // Overview refreshes whenever the screen comes back into view (e.g. after
  // opening a book), so the counts follow the job.
  useFocusEffect(useCallback(() => {
    if (isAdmin) void loadOverview();
  }, [isAdmin, loadOverview]));

  // New filter or search: start the list over (search waits for typing to pause).
  useEffect(() => {
    if (!isAdmin) return;
    setLoading(true);
    const timer = setTimeout(() => void loadBooks(0), search ? 350 : 0);
    return () => clearTimeout(timer);
  }, [isAdmin, loadBooks, search]);

  const toggleJob = async () => {
    if (!overview) return;
    setToggling(true);
    try {
      await setEnrichEnabled(!overview.enabled);
      setOverview({ ...overview, enabled: !overview.enabled });
    } catch (e) {
      void logError(e, 'book-tags-admin/toggleJob');
      void dialog.alert({ title: t('tagsActionFailed'), okLabel: t('dialogOk') });
    } finally {
      setToggling(false);
    }
  };

  const confirmRemoveTag = async (book: EnrichedBook, tag: BookTag) => {
    const label = tagLabel(tag, isGreek);
    const ok = await dialog.confirm({
      title: t('tagsRemoveTitle', { tag: label }),
      message: t('tagsRemoveMessage'),
      icon: 'pricetag-outline',
      confirmLabel: t('tagsRemove'),
      cancelLabel: t('cancel'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await removeBookTag(book.id, tag.tagId);
      setBooks(prev => prev.map(b => (b.id === book.id ? { ...b, tags: b.tags.filter(x => x.tagId !== tag.tagId) } : b)));
    } catch (e) {
      void logError(e, 'book-tags-admin/removeTag');
      void dialog.alert({ title: t('tagsActionFailed'), okLabel: t('dialogOk') });
    }
  };

  const confirmRequeue = async (book: EnrichedBook) => {
    const ok = await dialog.confirm({
      title: t('tagsRequeueTitle'),
      message: t('tagsRequeueMessage'),
      icon: 'refresh-outline',
      confirmLabel: t('tagsRequeue'),
      cancelLabel: t('cancel'),
    });
    if (!ok) return;
    try {
      await requeueBookEnrichment(book.id);
      setBooks(prev => prev.filter(b => b.id !== book.id));
      setExpanded(null);
      void loadOverview();
    } catch (e) {
      void logError(e, 'book-tags-admin/requeue');
      void dialog.alert({ title: t('tagsActionFailed'), okLabel: t('dialogOk') });
    }
  };

  const openBook = (book: EnrichedBook) => {
    const { status, evidence, model, error, enrichedAt, copies, tags, enriched_at, ...rest } = book as any;
    router.push({ pathname: '/book-details', params: { book: JSON.stringify(rest) } });
  };

  if (!isAdmin) {
    return (
      <SafeAreaView style={[styles.screen, styles.center, { backgroundColor: theme.background }]}>
        <ThemedText style={{ color: theme.secondary }}>Not authorized</ThemedText>
      </SafeAreaView>
    );
  }

  const filterLabel = (f: EnrichedFilter) =>
    f === 'thin' ? t('tagsFilterThin')
      : f === 'failed' ? t('tagsFilterFailed')
        : f === 'skipped' ? t('tagsFilterSkipped')
          : t('tagsFilterAll');

  const header = (
    <View style={styles.listHeader}>
      {overview && (
        <View style={[styles.jobCard, { backgroundColor: theme.surface }]}>
          <View style={styles.jobTop}>
            <View style={[styles.statusDot, { backgroundColor: overview.enabled ? RUNNING_COLOR : theme.secondary }]} />
            <View style={{ flex: 1 }}>
              <ThemedText style={[styles.jobTitle, { color: theme.text }]}>
                {overview.enabled ? t('tagsJobRunning') : t('tagsJobPaused')}
              </ThemedText>
              <ThemedText style={[styles.jobMeta, { color: theme.secondary }]}>
                {overview.batchOpen ? t('tagsBatchOpen') : t('tagsJobLimit', { count: overview.dailyLimit })}
              </ThemedText>
            </View>
            <TouchableOpacity
              onPress={toggleJob}
              disabled={toggling}
              style={[styles.jobButton, { borderColor: theme.border, opacity: toggling ? 0.5 : 1 }]}
            >
              <Ionicons name={overview.enabled ? 'pause' : 'play'} size={14} color={theme.text} />
              <ThemedText style={[styles.jobButtonText, { color: theme.text }]}>
                {overview.enabled ? t('tagsPause') : t('tagsResume')}
              </ThemedText>
            </TouchableOpacity>
          </View>

          <View style={styles.stats}>
            {[
              { label: t('tagsStatDone'), value: overview.done },
              { label: t('tagsStatEditions'), value: overview.editions },
              { label: t('tagsStatWaiting'), value: overview.waiting },
              { label: t('tagsStatThin'), value: overview.thin },
              { label: t('tagsStatFailed'), value: overview.failed },
              { label: t('tagsStatSkipped'), value: overview.skipped },
            ].map(stat => (
              <View key={stat.label} style={styles.stat}>
                <ThemedText style={[styles.statValue, { color: theme.text }]}>
                  {stat.value.toLocaleString(i18n.language)}
                </ThemedText>
                <ThemedText style={[styles.statLabel, { color: theme.secondary }]} numberOfLines={2}>{stat.label}</ThemedText>
              </View>
            ))}
          </View>

          {overview.lastRunAt && (
            <View style={[styles.lastRun, { borderTopColor: theme.border }]}>
              <ThemedText style={[styles.jobMeta, { color: theme.secondary }]}>
                {t('tagsLastRun', { when: new Date(overview.lastRunAt).toLocaleString(i18n.language) })}
              </ThemedText>
              {!!overview.lastResult && (
                <ThemedText style={[styles.lastResult, { color: theme.secondary }]} numberOfLines={3}>
                  {overview.lastResult}
                </ThemedText>
              )}
            </View>
          )}
        </View>
      )}

      <View style={[styles.search, { backgroundColor: theme.surface }]}>
        <Ionicons name="search" size={16} color={theme.secondary} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={t('tagsSearch')}
          placeholderTextColor={theme.secondary}
          style={[styles.searchInput, { color: theme.text }]}
          autoCorrect={false}
          returnKeyType="search"
        />
        {!!search && (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={10}>
            <Ionicons name="close-circle" size={16} color={theme.secondary} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.filters}>
        {FILTERS.map(f => {
          const active = f === filter;
          return (
            <TouchableOpacity
              key={f}
              onPress={() => setFilter(f)}
              style={[styles.filter, { backgroundColor: active ? AccentPalette[1] : theme.surface }]}
            >
              <ThemedText style={[styles.filterText, { color: active ? '#fff' : theme.text }]}>{filterLabel(f)}</ThemedText>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.iconButton, { backgroundColor: theme.surface }]}>
          <Ionicons name="arrow-back" size={18} color={theme.text} />
        </TouchableOpacity>
        <ThemedText style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>{t('tagsAdminTitle')}</ThemedText>
      </View>

      <FlatList
        data={books}
        keyExtractor={b => b.id}
        ListHeaderComponent={header}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40 }}
        onEndReached={() => { if (hasMore && !loading) void loadBooks(books.length); }}
        onEndReachedThreshold={0.6}
        ListEmptyComponent={loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} size="small" color={theme.secondary} />
        ) : (
          <ThemedText style={[styles.empty, { color: theme.secondary }]}>{t('tagsEmpty')}</ThemedText>
        )}
        renderItem={({ item }) => {
          const open = expanded === item.id;
          const chipTint = mixHex(theme.surface, AccentPalette[1], colorScheme === 'dark' ? 0.22 : 0.12);
          const visibleTags = item.tags.filter(tag => tag.slug !== 'fiction');
          return (
            <View style={[styles.row, { backgroundColor: theme.surface, borderColor: open ? AccentPalette[1] : theme.border }]}>
              <TouchableOpacity activeOpacity={0.8} onPress={() => setExpanded(open ? null : item.id)} style={styles.rowTop}>
                <Image source={{ uri: item.coverUrl || undefined }} style={[styles.thumb, { backgroundColor: theme.border }]} contentFit="cover" />
                <View style={styles.rowBody}>
                  <ThemedText style={[styles.rowTitle, { color: theme.text }]} numberOfLines={2}>
                    {item.title || t('unknownTitle')}
                  </ThemedText>
                  <ThemedText style={[styles.rowAuthor, { color: theme.secondary }]} numberOfLines={1}>
                    {item.authors?.join(', ') || t('unknownAuthor')}
                  </ThemedText>
                  <View style={styles.badges}>
                    {item.evidence === 'thin' && (
                      <View style={[styles.badge, { backgroundColor: mixHex(theme.surface, AccentPalette[0], 0.18) }]}>
                        <ThemedText style={[styles.badgeText, { color: theme.text }]}>{t('tagsThinBadge')}</ThemedText>
                      </View>
                    )}
                    {item.copies > 0 && (
                      <View style={[styles.badge, { backgroundColor: theme.background }]}>
                        <ThemedText style={[styles.badgeText, { color: theme.secondary }]}>{t('tagsCopies', { count: item.copies })}</ThemedText>
                      </View>
                    )}
                  </View>
                  {!open && (
                    <ThemedText style={[styles.rowTags, { color: AccentPalette[1] }]} numberOfLines={2}>
                      {item.status !== 'done'
                        ? item.error
                        : visibleTags.map(tag => tagLabel(tag, isGreek)).join(' · ') || t('tagsNone')}
                    </ThemedText>
                  )}
                </View>
                <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={theme.secondary} />
              </TouchableOpacity>

              {open && (
                <View style={[styles.detail, { borderTopColor: theme.border }]}>
                  {item.status !== 'done' && !!item.error && (
                    <ThemedText style={[styles.errorText, { color: item.status === 'failed' ? theme.error : theme.secondary }]}>
                      {item.error}
                    </ThemedText>
                  )}
                  {visibleTags.length > 0 && (
                    <>
                      <ThemedText style={[styles.hint, { color: theme.secondary }]}>{t('tagsRemoveHint')}</ThemedText>
                      <View style={styles.chips}>
                        {visibleTags.map(tag => (
                          <TouchableOpacity
                            key={tag.tagId}
                            onPress={() => confirmRemoveTag(item, tag)}
                            style={[styles.chip, { backgroundColor: chipTint, opacity: tag.strength === 'implied' ? 0.7 : 1 }]}
                          >
                            <ThemedText style={[styles.chipText, { color: theme.text }]}>
                              {tagLabel(tag, isGreek)}{tag.strength === 'implied' ? ' ?' : ''}
                            </ThemedText>
                            <Ionicons name="close" size={12} color={theme.secondary} />
                          </TouchableOpacity>
                        ))}
                      </View>
                    </>
                  )}
                  {!!item.description && (
                    <ThemedText style={[styles.description, { color: theme.secondary }]} numberOfLines={6}>
                      {item.description.trim()}
                    </ThemedText>
                  )}
                  <View style={styles.actions}>
                    <TouchableOpacity onPress={() => openBook(item)} style={[styles.action, { borderColor: theme.border }]}>
                      <Ionicons name="book-outline" size={15} color={theme.text} />
                      <ThemedText style={[styles.actionText, { color: theme.text }]}>{t('tagsOpenBook')}</ThemedText>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => confirmRequeue(item)} style={[styles.action, { borderColor: theme.border }]}>
                      <Ionicons name="refresh-outline" size={15} color={theme.text} />
                      <ThemedText style={[styles.actionText, { color: theme.text }]}>{t('tagsRequeue')}</ThemedText>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 12 },
  iconButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 22, lineHeight: 28, fontWeight: '800', fontFamily: roundedFont('800') },
  listHeader: { gap: 12, marginBottom: 12 },
  jobCard: { borderRadius: 18, padding: 14, gap: 14 },
  jobTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  jobTitle: { fontSize: 15, fontWeight: '700', fontFamily: roundedFont('700') },
  jobMeta: { fontSize: 12, lineHeight: 17 },
  jobButton: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12 },
  jobButtonText: { fontSize: 13, fontWeight: '700', fontFamily: roundedFont('700') },
  stats: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 12 },
  stat: { width: '33.33%', gap: 2, paddingRight: 6 },
  statValue: { fontSize: 17, lineHeight: 22, fontWeight: '800', fontFamily: roundedFont('800'), fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 10, lineHeight: 13 },
  lastRun: { borderTopWidth: 1, paddingTop: 10, gap: 4 },
  lastResult: { fontSize: 11, lineHeight: 15 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, paddingHorizontal: 12, height: 42 },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  filters: { flexDirection: 'row', gap: 8 },
  filter: { borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14 },
  filterText: { fontSize: 13, fontWeight: '700', fontFamily: roundedFont('700') },
  empty: { textAlign: 'center', marginTop: 40, fontSize: 15 },
  row: { borderRadius: 16, borderWidth: 1.5, marginBottom: 10, overflow: 'hidden' },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10 },
  thumb: { width: 52, height: 78, borderRadius: 8 },
  rowBody: { flex: 1, gap: 3 },
  rowTitle: { fontSize: 15, fontWeight: '700', fontFamily: roundedFont('700') },
  rowAuthor: { fontSize: 13 },
  rowTags: { fontSize: 12, lineHeight: 16, fontWeight: '600', fontFamily: roundedFont('600') },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: { borderRadius: 999, paddingVertical: 2, paddingHorizontal: 8 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  detail: { borderTopWidth: 1, padding: 12, gap: 10 },
  hint: { fontSize: 11 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingVertical: 5, paddingLeft: 11, paddingRight: 8 },
  chipText: { fontSize: 13, fontWeight: '600' },
  errorText: { fontSize: 12 },
  description: { fontSize: 13, lineHeight: 19 },
  actions: { flexDirection: 'row', gap: 8 },
  action: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderRadius: 12, height: 40 },
  actionText: { fontSize: 13, fontWeight: '700', fontFamily: roundedFont('700') },
});
