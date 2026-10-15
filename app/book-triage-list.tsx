import { useSession } from '@/app/ctx';
import { ThemedText } from '@/components/themed-text';
import { AccentPalette, Colors, roundedFont } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  TRIAGE_LIST_PAGE_SIZE,
  TriageBook,
  TriageDecision,
  fetchTriageList,
  moveToSyncList,
} from '@/services/book-triage';
import { logError } from '@/services/errorLog';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, FlatList, Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const LIKE_COLOR = AccentPalette[3];

// Books set aside in triage ("not yet" or "review"); any of them can be moved
// to the sync list from here.
export default function BookTriageListScreen() {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const { decision: rawDecision } = useLocalSearchParams<{ decision?: string }>();
  const decision: TriageDecision = rawDecision === 'review' ? 'review' : 'skip';
  const isAdmin = !!(user as any)?.isAdmin;
  const isGreek = i18n.language.startsWith('el');

  const [books, setBooks] = useState<TriageBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState(false);
  const fetching = useRef(false);

  const load = useCallback(async (offset: number) => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const page = await fetchTriageList(decision, offset);
      setHasMore(page.length >= TRIAGE_LIST_PAGE_SIZE);
      setBooks(prev => {
        if (offset === 0) return page;
        const known = new Set(prev.map(b => b.id));
        return [...prev, ...page.filter(b => !known.has(b.id))];
      });
    } catch (e) {
      void logError(e, 'book-triage-list/load');
    } finally {
      fetching.current = false;
      setLoading(false);
    }
  }, [decision]);

  useEffect(() => {
    if (isAdmin) void load(0);
  }, [isAdmin, load]);

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allSelected = books.length > 0 && books.every(b => selected.has(b.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(books.map(b => b.id)));

  const moveSelected = async () => {
    const uid = user?.uid;
    if (!uid || selected.size === 0) return;
    const ids = [...selected];
    setMoving(true);
    try {
      await moveToSyncList(ids, uid);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setBooks(prev => prev.filter(b => !selected.has(b.id)));
      setSelected(new Set());
    } catch (e) {
      void logError(e, 'book-triage-list/move');
      Alert.alert(t('triageMoveFailed'));
    } finally {
      setMoving(false);
    }
  };

  if (!isAdmin) {
    return (
      <SafeAreaView style={[styles.screen, styles.center, { backgroundColor: theme.background }]}>
        <ThemedText style={{ color: theme.secondary }}>Not authorized</ThemedText>
      </SafeAreaView>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.iconButton, { backgroundColor: theme.surface }]}>
          <Ionicons name="arrow-back" size={18} color={theme.text} />
        </TouchableOpacity>
        <ThemedText style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>
          {decision === 'review' ? t('triageReviewTitle') : t('triageSkippedTitle')}
        </ThemedText>
        {books.length > 0 && (
          <TouchableOpacity onPress={toggleAll} style={styles.selectAll}>
            <ThemedText style={[styles.selectAllText, { color: AccentPalette[1] }]}>
              {allSelected ? t('triageClearSelection') : t('triageSelectAll')}
            </ThemedText>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={books}
        keyExtractor={b => b.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 110 }}
        onEndReached={() => { if (hasMore && !loading) void load(books.length); }}
        onEndReachedThreshold={0.6}
        ListEmptyComponent={loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} size="small" color={theme.secondary} />
        ) : (
          <ThemedText style={[styles.empty, { color: theme.secondary }]}>{t('triageListEmpty')}</ThemedText>
        )}
        renderItem={({ item }) => {
          const isSelected = selected.has(item.id);
          const genres = item.genres.map(g => (isGreek ? g.nameEl : g.nameEn));
          const tags = [...genres, ...(item.categories ?? [])];
          return (
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => toggle(item.id)}
              style={[
                styles.row,
                { backgroundColor: theme.surface, borderColor: isSelected ? LIKE_COLOR : theme.border },
              ]}
            >
              <Image
                source={{ uri: item.coverUrl || undefined }}
                style={[styles.thumb, { backgroundColor: theme.border }]}
                contentFit="cover"
              />
              <View style={styles.rowBody}>
                <ThemedText style={[styles.rowTitle, { color: theme.text }]} numberOfLines={2}>
                  {item.title || t('unknownTitle')}
                </ThemedText>
                <ThemedText style={[styles.rowAuthor, { color: theme.secondary }]} numberOfLines={1}>
                  {item.authors?.join(', ') || t('unknownAuthor')}
                </ThemedText>
                <ThemedText style={[styles.rowTags, { color: AccentPalette[1] }]} numberOfLines={1}>
                  {tags.join(' · ') || t('triageNoGenre')}
                </ThemedText>
                {!!item.description && (
                  <ThemedText style={[styles.rowDescription, { color: theme.secondary }]} numberOfLines={2}>
                    {item.description.trim()}
                  </ThemedText>
                )}
              </View>
              <View style={[
                styles.check,
                isSelected ? { backgroundColor: LIKE_COLOR, borderColor: LIKE_COLOR } : { borderColor: theme.border },
              ]}>
                {isSelected && <Ionicons name="checkmark" size={16} color="#fff" />}
              </View>
            </TouchableOpacity>
          );
        }}
      />

      {selected.size > 0 && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 16, backgroundColor: theme.background }]}>
          <TouchableOpacity
            style={[styles.moveButton, { backgroundColor: LIKE_COLOR, opacity: moving ? 0.6 : 1 }]}
            onPress={moveSelected}
            disabled={moving}
            activeOpacity={0.85}
          >
            {moving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="heart" size={18} color="#fff" />
                <ThemedText style={styles.moveText}>{t('triageMoveToList', { count: selected.size })}</ThemedText>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 12 },
  iconButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 22, lineHeight: 28, fontWeight: '800', fontFamily: roundedFont('800') },
  selectAll: { paddingVertical: 6, paddingHorizontal: 4 },
  selectAllText: { fontSize: 14, fontWeight: '700', fontFamily: roundedFont('700') },
  empty: { textAlign: 'center', marginTop: 40, fontSize: 15 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    marginBottom: 10,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  thumb: { width: 56, height: 84, borderRadius: 8 },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: '700', fontFamily: roundedFont('700') },
  rowAuthor: { fontSize: 13 },
  rowTags: { fontSize: 12, fontWeight: '600', fontFamily: roundedFont('600'), marginTop: 2 },
  rowDescription: { fontSize: 12, lineHeight: 16, marginTop: 2 },
  check: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 12 },
  moveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    borderRadius: 26,
  },
  moveText: { color: '#fff', fontSize: 16, fontWeight: '700', fontFamily: roundedFont('700') },
});
