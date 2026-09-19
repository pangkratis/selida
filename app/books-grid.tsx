import { useSession } from '@/app/ctx';
import CompactBookGrid from '@/components/compact-book-grid';
import { ThemedText } from '@/components/themed-text';
import { Colors, toTransparent } from '@/constants/theme';
import { Book } from '@/constants/types';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { incrementBookView } from '@/services/bookStats';
import { supabase } from '@/services/supabaseConfig';
import { logUserActivity } from '@/services/userActivity';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type GridMode = 'search' | 'all';

export default function BooksGridScreen() {
  const { user } = useSession();
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string; q?: string; title?: string }>();

  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];

  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);

  const mode: GridMode = params.mode === 'all' ? 'all' : 'search';
  const queryText = typeof params.q === 'string' ? params.q : '';
  const title = typeof params.title === 'string' ? params.title : `"${queryText}"`;

  const mapDocToBook = (id: string, data: any): Book => ({
    id,
    title: data.title,
    authors: data.authors || ['Unknown Author'],
    coverUrl: data.coverUrl || null,
    publishedYear: data.publishedYear || null,
    isbn: data.isbn || null,
    isbn10: data.isbn10 || null,
    isbn13: data.isbn13 || null,
    language: data.language || 'en',
    lastFetchedAt: data.lastFetchedAt ? new Date(data.lastFetchedAt) : new Date(),
    description: data.description || '',
    categories: data.categories || [],
    subcategories: data.subcategories || [],
    edition: data.edition || '',
    isActive: data.isActive ?? true,
    popularityCount: data.popularityCount || 0,
    publisher: data.publisher || '',
    pageCount: data.pageCount || 100,
    source: data.source,
  });

  const fetchSearchResults = async (text: string): Promise<Book[]> => {
    const trimmed = text.trim();
    if (!trimmed) return [];
    const { data, error } = await supabase.rpc('search_books', { p_query: trimmed, p_limit: 200 });
    if (error) { console.error('Search error:', error); return []; }
    const seen = new Set<string>();
    return (data ?? []).map((d: any) => mapDocToBook(d.id, d)).filter((b: Book) => {
      if (seen.has(b.id)) return false;
      seen.add(b.id);
      return true;
    });
  };

  const fetchAllResults = async (): Promise<Book[]> => {
    const { data, error } = await supabase.from('books').select('*').limit(500);
    if (error) { console.error('Fetch all error:', error); return []; }
    const seen = new Set<string>();
    return (data ?? []).map((d: any) => mapDocToBook(d.id, d)).filter((b: Book) => {
      if (seen.has(b.id)) return false;
      seen.add(b.id);
      return true;
    });
  };

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      try {
        const result = mode === 'all'
          ? await fetchAllResults()
          : await fetchSearchResults(queryText);
        if (mounted) setBooks(result);
      } catch (error) {
        console.error('Error loading books grid:', error);
        if (mounted) setBooks([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => { mounted = false; };
  }, [mode, queryText]);

  const handleBookPress = (book: Book) => {
    if (user?.uid) {
      logUserActivity(user.uid, book.id, 'view_details', 'search_results').catch(console.error);
    }
    incrementBookView(book.id).catch(console.error);
    router.push({ pathname: '/book-details', params: { book: JSON.stringify(book) } });
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <View style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[styles.headerButton, { backgroundColor: theme.surface, borderColor: theme.border }]}
          >
            <Ionicons name="arrow-back" size={18} color={theme.text} />
          </TouchableOpacity>
          <View style={styles.headerTextWrap}>
            <ThemedText style={styles.headerTitle} numberOfLines={1}>{title}</ThemedText>
            {!loading && (
              <ThemedText style={[styles.headerMeta, { color: theme.secondary }]}>
                {books.length} book{books.length === 1 ? '' : 's'}
              </ThemedText>
            )}
          </View>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={theme.primary} />
            <ThemedText style={[styles.helperText, { color: theme.secondary }]}>Finding books...</ThemedText>
          </View>
        ) : books.length === 0 ? (
          <View style={styles.center}>
            <ThemedText style={styles.emptyEmoji}>📚</ThemedText>
            <ThemedText style={[styles.helperText, { color: theme.secondary }]}>No books found.</ThemedText>
          </View>
        ) : (
          <CompactBookGrid
            books={books}
            onPressBook={handleBookPress}
            contentPaddingBottom={30}
          />
        )}

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
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 14,
  },
  headerButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextWrap: {
    flex: 1,
    paddingHorizontal: 12,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  headerMeta: {
    fontSize: 12,
    marginTop: 2,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  helperText: { fontSize: 14 },
  emptyEmoji: { fontSize: 36, lineHeight: 44 },
  fadeBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 40,
  },
});