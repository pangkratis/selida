import { useSession } from '@/app/ctx';
import HorizontalBookShelf from '@/components/horizontal-book-shelf';
import { ThemedText } from '@/components/themed-text';
import { TAB_BAR_CONTENT_CLEARANCE } from '@/constants/tab-bar';
import { AccentPalette, Colors, roundedFont, toTransparent } from '@/constants/theme';
import { Book } from '@/constants/types';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { supabase } from '@/services/supabaseConfig';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const STORAGE_KEY = 'selida_recent_searches';
const MAX_RECENT = 8;
const MAX_VISIBLE = 5;

export default function ExploreScreen() {
  const { t } = useTranslation();
  const { user } = useSession();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [searchText, setSearchText] = useState('');
  const [focused, setFocused] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [recentlyViewed, setRecentlyViewed] = useState<Book[]>([]);
  const inputRef = useRef<TextInput>(null);

  const accent = AccentPalette[1];

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(json => { if (json) setRecentSearches(JSON.parse(json)); })
      .catch(() => null);
  }, []);

  const loadRecentlyViewed = useCallback(async () => {
    if (!user?.uid) return;
    const { data: activity } = await supabase
      .from('userActivity')
      .select('bookId')
      .eq('userId', user.uid)
      .eq('action', 'view_details')
      .eq('context', 'search_results')
      .order('createdAt', { ascending: false })
      .limit(40);
    if (!activity || activity.length === 0) return;
    const seen = new Set<string>();
    const uniqueIds: string[] = [];
    for (const row of activity) {
      if (row.bookId && !seen.has(row.bookId) && !row.bookId.includes('/') && !row.bookId.includes('http')) {
        seen.add(row.bookId);
        uniqueIds.push(row.bookId);
        if (uniqueIds.length >= 12) break;
      }
    }
    if (uniqueIds.length === 0) return;
    const { data: books } = await supabase.from('books').select('*').in('id', uniqueIds);
    if (!books) return;
    const booksMap = new Map(books.map((b: Book) => [b.id, b]));
    setRecentlyViewed(uniqueIds.map(id => booksMap.get(id)).filter(Boolean) as Book[]);
  }, [user?.uid]);

  useFocusEffect(useCallback(() => { loadRecentlyViewed(); }, [loadRecentlyViewed]));

  const saveAndNavigate = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    const updated = [trimmed, ...recentSearches.filter(s => s !== trimmed)].slice(0, MAX_RECENT);
    setRecentSearches(updated);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated)).catch(() => null);
    router.push({ pathname: '/books-grid', params: { mode: 'search', q: trimmed, title: `"${trimmed}"` } });
  };

  const removeRecent = (search: string) => {
    const updated = recentSearches.filter(s => s !== search);
    setRecentSearches(updated);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated)).catch(() => null);
  };

  const clearAllRecent = () => {
    setRecentSearches([]);
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => null);
  };

  return (
    <SafeAreaView edges={['bottom']} style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={{ flex: 1 }}>
        {/* Background watermarks */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <ThemedText style={[styles.watermark, {
            color: AccentPalette[1] + '0C',
            fontFamily: roundedFont('800'),
            position: 'absolute',
            top: insets.top - 30,
            right: -20,
            fontSize: 320,
            lineHeight: 300,
          }]}>?</ThemedText>

          <ThemedText style={[styles.watermark, {
            color: AccentPalette[2] + '0D',
            fontFamily: roundedFont('800'),
            position: 'absolute',
            bottom: 60,
            left: -40,
            fontSize: 200,
            lineHeight: 200,
            transform: [{ rotate: '-15deg' }],
          }]}>?</ThemedText>

          <ThemedText style={[styles.watermark, {
            color: AccentPalette[0] + '0E',
            fontFamily: roundedFont('800'),
            position: 'absolute',
            top: insets.top + 60,
            left: 10,
            fontSize: 110,
            lineHeight: 110,
            transform: [{ rotate: '12deg' }],
          }]}>?</ThemedText>

          <ThemedText style={[styles.watermark, {
            color: AccentPalette[3] + '10',
            fontFamily: roundedFont('800'),
            position: 'absolute',
            bottom: 120,
            right: 24,
            fontSize: 80,
            lineHeight: 80,
            transform: [{ rotate: '-8deg' }],
          }]}>?</ThemedText>

          <ThemedText style={[styles.watermark, {
            color: AccentPalette[4] + '0A',
            fontFamily: roundedFont('800'),
            position: 'absolute',
            top: '38%',
            left: -10,
            fontSize: 140,
            lineHeight: 140,
            transform: [{ rotate: '20deg' }],
          }]}>?</ThemedText>
        </View>

        {/* Top-aligned stage — a real ScrollView, not a flex:1 "push to bottom" layout, so a
            long recent-searches list (up to MAX_VISIBLE) can never overflow into and visually
            overlap the "Recently viewed" shelf below it; it just scrolls instead. */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.stage, { paddingTop: insets.top + 80 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

          {/* Headline */}
          <ThemedText style={[styles.headline, { color: theme.text, fontFamily: roundedFont('800') }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {t('exploreHeadline')}
          </ThemedText>

          {/* Search card */}
          <TouchableOpacity
            style={[
              styles.searchCard,
              {
                backgroundColor: theme.surface,
                borderColor: focused || searchText.length > 0 ? accent : theme.border,
                shadowColor: focused || searchText.length > 0 ? accent : '#000',
                shadowOpacity: focused || searchText.length > 0 ? 0.2 : 0.06,
              },
            ]}
            activeOpacity={1}
            onPress={() => inputRef.current?.focus()}
          >
            <Ionicons name="search-outline" size={21} color={focused || searchText.length > 0 ? accent : theme.secondary} />
            <TextInput
              ref={inputRef}
              style={[styles.searchInput, { color: theme.text, fontFamily: roundedFont('500') }]}
              placeholder={t('explorePlaceholder')}
              placeholderTextColor={theme.secondary}
              value={searchText}
              onChangeText={setSearchText}
              onSubmitEditing={() => saveAndNavigate(searchText)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              returnKeyType="search"
              autoCorrect={false}
            />
            {searchText.length > 0 && (
              <TouchableOpacity
                style={[styles.inlineSearchButton, { backgroundColor: accent }]}
                onPress={() => saveAndNavigate(searchText)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="arrow-forward" size={17} color="#fff" />
              </TouchableOpacity>
            )}
          </TouchableOpacity>

          {/* Recent searches / hint — stays static regardless of typing, so the page doesn't
              shift as the user types */}
          {recentSearches.length > 0 ? (
            <View style={styles.recentContainer}>
              {/* Header row */}
              <View style={styles.recentHeader}>
                <ThemedText style={[styles.recentLabel, { color: theme.secondary, fontFamily: roundedFont('600') }]}>
                  Your recent searches
                </ThemedText>
                <TouchableOpacity onPress={clearAllRecent} hitSlop={{ top: 8, bottom: 8, left: 12, right: 4 }} activeOpacity={0.6}>
                  <ThemedText style={[styles.clearAllText, { color: theme.secondary, fontFamily: roundedFont('500') }]}>
                    Clear all
                  </ThemedText>
                </TouchableOpacity>
              </View>

              {/* List */}
              {recentSearches.slice(0, MAX_VISIBLE).map((s, i) => (
                <TouchableOpacity
                  key={i}
                  style={[styles.recentItem, { borderBottomColor: theme.border + '60' }, i < Math.min(recentSearches.length, MAX_VISIBLE) - 1 && { borderBottomWidth: StyleSheet.hairlineWidth }]}
                  onPress={() => saveAndNavigate(s)}
                  activeOpacity={0.65}
                >
                  <Ionicons name="time-outline" size={15} color={theme.secondary} style={{ opacity: 0.5 }} />
                  <ThemedText style={[styles.recentText, { color: theme.text, fontFamily: roundedFont('500') }]} numberOfLines={1}>
                    {s}
                  </ThemedText>
                  <TouchableOpacity
                    onPress={() => removeRecent(s)}
                    hitSlop={{ top: 8, bottom: 8, left: 12, right: 4 }}
                  >
                    <Ionicons name="close" size={14} color={theme.secondary} style={{ opacity: 0.4 }} />
                  </TouchableOpacity>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <ThemedText style={[styles.hint, { color: theme.secondary, fontFamily: roundedFont('400') }]}>
              {t('exploreHint')}
            </ThemedText>
          )}

          {/* Recently viewed books — now just the next item in scroll flow, not pinned via
              flex:1 push-to-bottom (that let a long recent-searches list overflow past its box
              and visually overlap this section). */}
          {recentlyViewed.length > 0 && (
            <View style={styles.recentlyViewedSection}>
              <ThemedText style={[styles.recentlyViewedLabel, { color: theme.secondary, fontFamily: roundedFont('600') }]}>
                Recently viewed
              </ThemedText>
              <HorizontalBookShelf
                books={recentlyViewed}
                keyPrefix="rv"
                contentPaddingHorizontal={0}
                onPressBook={book => router.push({ pathname: '/book-details', params: { book: JSON.stringify(book) } })}
              />
            </View>
          )}
        </ScrollView>

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
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  watermark: { fontWeight: '900' },
  stage: {
    paddingHorizontal: 24,
    paddingBottom: TAB_BAR_CONTENT_CLEARANCE,
    alignItems: 'stretch',
    gap: 20,
    zIndex: 1,
  },
  headline: {
    fontSize: 38,
    fontWeight: '800',
    lineHeight: 44,
    letterSpacing: -1.1,
  },
  searchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    height: 60,
    borderRadius: 20,
    borderWidth: 1.5,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 16,
    elevation: 3,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    height: '100%',
  },
  inlineSearchButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    fontSize: 14,
    textAlign: 'center',
    opacity: 0.7,
  },
  recentContainer: {
    gap: 0,
  },
  recentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 8,
  },
  recentLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  recentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
  },
  recentText: {
    flex: 1,
    fontSize: 13,
  },
  clearAllText: {
    fontSize: 13,
    opacity: 0.6,
  },
  recentlyViewedSection: {
    paddingTop: 24,
    gap: 14,
  },
  recentlyViewedLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  fadeBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: TAB_BAR_CONTENT_CLEARANCE + 24,
  },
});