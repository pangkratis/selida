import { ThemedText } from '@/components/themed-text';
import { AccentPalette, BorderRadius, Colors, roundedFont } from '@/constants/theme';
import { IngestionResult, SubSyncResult, clearBookDatabase, readCursor, resetCursor, runCatalogIngestion, syncSubcategories } from '@/services/catalog-ingestion';
import { supabase } from '@/services/supabaseConfig';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

interface IngestionState {
  status: 'idle' | 'running' | 'done' | 'error';
  result: IngestionResult | null;
  totalSaved: number;
}

/* ── Book Detail Modal ─────────────────────────────────────────────── */

function BookDetailModal({ book, onClose }: { book: any; onClose: () => void }) {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const insets = useSafeAreaInsets();

  const Field = ({ label, value }: { label: string; value?: string | number | null }) => {
    if (!value && value !== 0) return null;
    return (
      <View style={modalStyles.field}>
        <ThemedText style={[modalStyles.fieldLabel, { color: theme.secondary, fontFamily: roundedFont('600') }]}>
          {label}
        </ThemedText>
        <ThemedText style={[modalStyles.fieldValue, { color: theme.text, fontFamily: roundedFont('400') }]}>
          {String(value)}
        </ThemedText>
      </View>
    );
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[modalStyles.container, { backgroundColor: theme.background }]}>
        {/* Header */}
        <View style={[modalStyles.header, { borderBottomColor: theme.border }]}>
          <ThemedText style={[modalStyles.headerTitle, { color: theme.text, fontFamily: roundedFont('700') }]} numberOfLines={1}>
            Book Details
          </ThemedText>
          <TouchableOpacity onPress={onClose} style={[modalStyles.closeBtn, { backgroundColor: theme.surface }]}>
            <Ionicons name="close" size={18} color={theme.text} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={[modalStyles.scrollContent, { paddingBottom: insets.bottom + 24 }]}>
          {/* Cover + title */}
          <View style={modalStyles.heroRow}>
            {book.coverUrl ? (
              <Image
                source={{ uri: book.coverUrl }}
                style={[modalStyles.cover, { backgroundColor: theme.border }]}
                contentFit="cover"
              />
            ) : (
              <View style={[modalStyles.cover, modalStyles.coverPlaceholder, { backgroundColor: theme.surface }]}>
                <Ionicons name="book-outline" size={32} color={theme.secondary} />
              </View>
            )}
            <View style={modalStyles.heroInfo}>
              <ThemedText style={[modalStyles.bookTitle, { color: theme.text, fontFamily: roundedFont('700') }]}>
                {book.title}
              </ThemedText>
              {book.subtitle ? (
                <ThemedText style={[modalStyles.bookSubtitle, { color: theme.secondary, fontFamily: roundedFont('400') }]}>
                  {book.subtitle}
                </ThemedText>
              ) : null}
              {book.authors?.length > 0 && (
                <ThemedText style={[modalStyles.bookAuthor, { color: AccentPalette[0], fontFamily: roundedFont('600') }]}>
                  {book.authors.join(', ')}
                </ThemedText>
              )}
            </View>
          </View>

          {/* Identification */}
          <View style={[modalStyles.section, { backgroundColor: theme.surface }]}>
            <ThemedText style={[modalStyles.sectionTitle, { color: theme.secondary, fontFamily: roundedFont('700') }]}>
              IDENTIFICATION
            </ThemedText>
            <Field label="Biblionet ID" value={book.biblionetId} />
            <Field label="Supabase ID" value={book.id} />
            <Field label="ISBN" value={book.isbn} />
            <Field label="ISBN 2" value={book.isbn_2 ?? book.isbn2} />
            <Field label="ISBN 3" value={book.isbn_3 ?? book.isbn3} />
            <Field label="ISMN" value={book.ismn} />
          </View>

          {/* Classification */}
          <View style={[modalStyles.section, { backgroundColor: theme.surface }]}>
            <ThemedText style={[modalStyles.sectionTitle, { color: theme.secondary, fontFamily: roundedFont('700') }]}>
              CLASSIFICATION
            </ThemedText>
            <Field label="Category" value={book.categories?.[0] ?? book.category} />
            <Field label="Category ID" value={book.categoryId ?? book.CategoryID} />
            <Field label="Series" value={book.series} />
            <Field label="Sub-series" value={book.subSeries} />
            <Field label="Title Type" value={book.titleType ?? book.TitleType} />
          </View>

          {/* Publication */}
          <View style={[modalStyles.section, { backgroundColor: theme.surface }]}>
            <ThemedText style={[modalStyles.sectionTitle, { color: theme.secondary, fontFamily: roundedFont('700') }]}>
              PUBLICATION
            </ThemedText>
            <Field label="Publisher" value={book.publisher} />
            <Field label="Published Year" value={book.publishedYear} />
            <Field label="Place" value={book.place ?? book.Place} />
            <Field label="Edition" value={book.edition ?? book.EditionNo} />
            <Field label="Price" value={book.price ? `€${book.price}` : null} />
            <Field label="VAT" value={book.vat ? `${book.vat}%` : null} />
            <Field label="Availability" value={book.availability} />
          </View>

          {/* Physical */}
          <View style={[modalStyles.section, { backgroundColor: theme.surface }]}>
            <ThemedText style={[modalStyles.sectionTitle, { color: theme.secondary, fontFamily: roundedFont('700') }]}>
              PHYSICAL
            </ThemedText>
            <Field label="Pages" value={book.pageCount} />
            <Field label="Dimensions" value={book.dimensions ?? book.Dimensions} />
            <Field label="Cover type" value={book.cover ?? book.Cover} />
            <Field label="Weight" value={book.weight ?? book.Weight} />
            <Field label="Age range" value={book.ageFrom || book.ageTo ? `${book.ageFrom ?? '?'} – ${book.ageTo ?? '?'}` : null} />
          </View>

          {/* Language */}
          <View style={[modalStyles.section, { backgroundColor: theme.surface }]}>
            <ThemedText style={[modalStyles.sectionTitle, { color: theme.secondary, fontFamily: roundedFont('700') }]}>
              LANGUAGE
            </ThemedText>
            <Field label="Language" value={book.language} />
            <Field label="Original language" value={book.languageOriginal ?? book.LanguageOriginal} />
            <Field label="Translated from" value={book.languageTranslatedFrom ?? book.LanguageTranslatedFrom} />
            <Field label="Original title" value={book.originalTitle ?? book.OriginalTitle} />
            <Field label="Parallel title" value={book.parallelTitle ?? book.ParallelTitle} />
          </View>

          {/* Description */}
          {book.description ? (
            <View style={[modalStyles.section, { backgroundColor: theme.surface }]}>
              <ThemedText style={[modalStyles.sectionTitle, { color: theme.secondary, fontFamily: roundedFont('700') }]}>
                DESCRIPTION
              </ThemedText>
              <ThemedText style={[modalStyles.description, { color: theme.text, fontFamily: roundedFont('400') }]}>
                {book.description}
              </ThemedText>
            </View>
          ) : null}

          {/* Search tags */}
          {book.searchTags?.length > 0 && (
            <View style={[modalStyles.section, { backgroundColor: theme.surface }]}>
              <ThemedText style={[modalStyles.sectionTitle, { color: theme.secondary, fontFamily: roundedFont('700') }]}>
                SEARCH TAGS ({book.searchTags.length})
              </ThemedText>
              <View style={modalStyles.tagWrap}>
                {book.searchTags.slice(0, 60).map((tag: string) => (
                  <View key={tag} style={[modalStyles.tag, { backgroundColor: AccentPalette[1] + '18' }]}>
                    <ThemedText style={[modalStyles.tagText, { color: AccentPalette[1], fontFamily: roundedFont('500') }]}>
                      {tag}
                    </ThemedText>
                  </View>
                ))}
              </View>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

/* ── Main Screen ───────────────────────────────────────────────────── */

export default function CatalogIngestionScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [searchText, setSearchText] = useState('');
  const inputRef = useRef<TextInput>(null);
  const [ingestion, setIngestion] = useState<IngestionState>({
    status: 'idle',
    result: null,
    totalSaved: 0,
  });
  const [books, setBooks] = useState<any[]>([]);
  const [booksLoading, setBooksLoading] = useState(false);
  const [selectedBook, setSelectedBook] = useState<any | null>(null);
  const [lookupStatus, setLookupStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [subSync, setSubSync] = useState<{ status: 'idle' | 'running' | 'done' | 'error'; result: SubSyncResult | null }>({ status: 'idle', result: null });

  const accent = AccentPalette[1];

  const fetchLatestBooks = useCallback(async () => {
    setBooksLoading(true);
    try {
      const { data, error } = await supabase.from('books').select('*').order('createdAt', { ascending: false }).limit(100);
      if (error) throw error;
      setBooks(data ?? []);
    } catch (e) {
      console.error('[Ingestion] Failed to fetch books:', e);
    } finally {
      setBooksLoading(false);
    }
  }, []);

  useEffect(() => {
    readCursor().then(cursor => {
      setIngestion(prev => ({
        ...prev,
        result: prev.result ?? { cursor, count: 0, newCount: 0, updatedCount: 0, next: cursor, done: false },
      }));
    });
    fetchLatestBooks();
  }, [fetchLatestBooks]);

  const handleClearDatabase = () => {
    Alert.alert(
      'Clear database',
      'This will delete all books, stats, activity, sessions, and reading lists. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear everything', style: 'destructive',
          onPress: async () => {
            setIngestion(prev => ({ ...prev, status: 'running' }));
            const { total } = await clearBookDatabase();
            setIngestion(prev => ({ ...prev, status: 'idle', totalSaved: 0 }));
            setBooks([]);
            Alert.alert('Done', `Deleted ${total} documents.`);
          },
        },
      ]
    );
  };

  const handleReset = async () => {
    await resetCursor();
    const cursor = await readCursor();
    setIngestion({ status: 'idle', result: { cursor, count: 0, newCount: 0, updatedCount: 0, next: cursor, done: false }, totalSaved: 0 });
  };

  const handleRun = async () => {
    if (ingestion.status === 'running') return;
    setIngestion(prev => ({ ...prev, status: 'running' }));
    const result = await runCatalogIngestion();
    if (!result) {
      setIngestion(prev => ({ ...prev, status: 'idle' }));
      return;
    }
    setIngestion(prev => ({
      status: result.error ? 'error' : 'done',
      result,
      totalSaved: prev.totalSaved + result.count,
    }));
    fetchLatestBooks();
  };

  const handleSyncSubcategories = async () => {
    if (subSync.status === 'running') return;
    setSubSync({ status: 'running', result: null });
    const result = await syncSubcategories();
    if (!result) { setSubSync({ status: 'idle', result: null }); return; }
    setSubSync({ status: result.error ? 'error' : 'done', result });
    fetchLatestBooks();
  };

  const handleBookLookup = async () => {
    const bookId = searchText.trim();
    if (!bookId) return;
    setLookupStatus('running');
    try {
      const { data: bookData, error: bookError } = await supabase.from('books').select('*').eq('biblionetId', bookId).maybeSingle();
      if (bookError || !bookData) {
        console.log(`[Lookup] No book found in Supabase for id: ${bookId}`);
        setLookupStatus('error');
        return;
      }
      const isbn = bookData.isbn ?? '';
      console.log(`[Lookup] Book: "${bookData.title}" | isbn: "${isbn}"`);

      const { data, error: proxyError } = await supabase.functions.invoke('biblionet-proxy', {
        body: { endpoint: 'get_title', params: { titleid: bookId, isbn } },
      });
      if (proxyError) {
        console.error('[Lookup] proxy error:', proxyError);
        setLookupStatus('error');
        return;
      }
      console.log('[Lookup] Full API response:', JSON.stringify(data, null, 2));
      setLookupStatus('done');
    } catch (err) {
      console.error('[Lookup] Error:', err);
      setLookupStatus('error');
    }
  };

  const cursorDisplay = ingestion.result?.cursor;
  const monthName = cursorDisplay
    ? new Date(cursorDisplay.year, cursorDisplay.month - 1).toLocaleString('en', { month: 'long' })
    : null;

  const ListHeader = (
    <View>
      {/* Stage */}
      <View style={[styles.stage, { paddingTop: insets.top + 56 }]}>

        <View style={[styles.iconOrb, { backgroundColor: accent + '16' }]}>
          <Ionicons name="server-outline" size={32} color={accent} />
        </View>

        <ThemedText style={[styles.headline, { color: theme.text, fontFamily: roundedFont('800') }]}>
          Catalog{'\n'}ingestion
        </ThemedText>

        {cursorDisplay && (
          <View style={[styles.cursorCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.cursorRow}>
              <View style={[styles.cursorChip, { backgroundColor: AccentPalette[0] + '18' }]}>
                <ThemedText style={[styles.cursorChipText, { color: AccentPalette[0], fontFamily: roundedFont('700') }]}>
                  {cursorDisplay.year}
                </ThemedText>
              </View>
              <View style={[styles.cursorChip, { backgroundColor: AccentPalette[1] + '18' }]}>
                <ThemedText style={[styles.cursorChipText, { color: AccentPalette[1], fontFamily: roundedFont('700') }]}>
                  {monthName}
                </ThemedText>
              </View>
              <View style={[styles.cursorChip, { backgroundColor: AccentPalette[2] + '18' }]}>
                <ThemedText style={[styles.cursorChipText, { color: AccentPalette[2], fontFamily: roundedFont('700') }]}>
                  page {cursorDisplay.page}
                </ThemedText>
              </View>
              <TouchableOpacity
                onPress={handleReset}
                style={[styles.cursorChip, { backgroundColor: theme.error + '18', marginLeft: 'auto' }]}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <ThemedText style={[styles.cursorChipText, { color: theme.error, fontFamily: roundedFont('600') }]}>
                  reset
                </ThemedText>
              </TouchableOpacity>
            </View>

            {ingestion.status !== 'idle' && (
              <View style={styles.resultRow}>
                {ingestion.status === 'running' ? (
                  <ActivityIndicator size="small" color={accent} />
                ) : ingestion.status === 'error' ? (
                  <ThemedText style={[styles.resultText, { color: theme.error, fontFamily: roundedFont('500') }]}>
                    {ingestion.result?.error ?? 'Unknown error'}
                  </ThemedText>
                ) : (
                  <ThemedText style={[styles.resultText, { color: theme.secondary, fontFamily: roundedFont('500') }]}>
                    {ingestion.result!.count > 0
                      ? `Saved ${ingestion.result!.count} books (${ingestion.result!.newCount} new, ${ingestion.result!.updatedCount} already known)`
                      : 'No books for this period — advancing'}
                    {ingestion.result!.done ? '  ·  Catalog complete!' : ''}
                  </ThemedText>
                )}
              </View>
            )}

            {ingestion.totalSaved > 0 && (
              <ThemedText style={[styles.tallyText, { color: theme.secondary, fontFamily: roundedFont('400') }]}>
                {ingestion.totalSaved} total books saved this session
              </ThemedText>
            )}
          </View>
        )}

        <TouchableOpacity
          style={[
            styles.searchCard,
            {
              backgroundColor: theme.surface,
              borderColor: searchText.length > 0 ? AccentPalette[0] : theme.border,
              shadowColor: searchText.length > 0 ? AccentPalette[0] : '#000',
              shadowOpacity: searchText.length > 0 ? 0.2 : 0.06,
            },
          ]}
          activeOpacity={1}
          onPress={() => inputRef.current?.focus()}
        >
          <Ionicons name="search-outline" size={21} color={searchText.length > 0 ? AccentPalette[0] : theme.secondary} />
          <TextInput
            ref={inputRef}
            style={[styles.searchInput, { color: theme.text, fontFamily: roundedFont('500') }]}
            placeholder="Enter Biblionet ID…"
            placeholderTextColor={theme.secondary}
            value={searchText}
            onChangeText={t => { setSearchText(t); setLookupStatus('idle'); }}
            onSubmitEditing={handleBookLookup}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
          />
          {searchText.length > 0 && (
            <TouchableOpacity onPress={() => { setSearchText(''); setLookupStatus('idle'); }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close-circle" size={19} color={theme.secondary} />
            </TouchableOpacity>
          )}
        </TouchableOpacity>

        {searchText.length > 0 && (
          <TouchableOpacity
            style={[styles.submitButton, { backgroundColor: lookupStatus === 'running' ? AccentPalette[0] + '80' : AccentPalette[0] }]}
            onPress={handleBookLookup}
            activeOpacity={0.82}
            disabled={lookupStatus === 'running'}
          >
            {lookupStatus === 'running' ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <ThemedText style={[styles.submitText, { fontFamily: roundedFont('700') }]}>
                  Lookup book
                </ThemedText>
                <Ionicons name="search" size={17} color="#fff" />
              </>
            )}
          </TouchableOpacity>
        )}

        {lookupStatus === 'done' && (
          <ThemedText style={[styles.hint, { color: AccentPalette[3], fontFamily: roundedFont('500') }]}>
            Response logged to console
          </ThemedText>
        )}
        {lookupStatus === 'error' && (
          <ThemedText style={[styles.hint, { color: theme.error, fontFamily: roundedFont('500') }]}>
            Book not found or API error — check console
          </ThemedText>
        )}

        <TouchableOpacity
          style={[styles.submitButton, { backgroundColor: ingestion.status === 'running' ? accent + '80' : accent }]}
          onPress={handleRun}
          activeOpacity={0.82}
          disabled={ingestion.status === 'running'}
        >
          {ingestion.status === 'running' ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <ThemedText style={[styles.submitText, { fontFamily: roundedFont('700') }]}>
                Fetch next batch
              </ThemedText>
              <Ionicons name="arrow-forward" size={17} color="#fff" />
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.submitButton, { backgroundColor: subSync.status === 'running' ? AccentPalette[3] + '80' : AccentPalette[3] }]}
          onPress={handleSyncSubcategories}
          activeOpacity={0.82}
          disabled={subSync.status === 'running'}
        >
          {subSync.status === 'running' ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <ThemedText style={[styles.submitText, { fontFamily: roundedFont('700') }]}>
                Sync subcategories
              </ThemedText>
              <Ionicons name="list-outline" size={17} color="#fff" />
            </>
          )}
        </TouchableOpacity>

        {subSync.status === 'done' && subSync.result && (
          <ThemedText style={[styles.hint, { color: AccentPalette[3], fontFamily: roundedFont('500') }]}>
            Synced {subSync.result.synced} books · {subSync.result.remaining} remaining
            {subSync.result.stoppedEarly ? ' · stopped early, likely hit today’s rate limit' : ''}
          </ThemedText>
        )}
        {subSync.status === 'error' && (
          <ThemedText style={[styles.hint, { color: theme.error, fontFamily: roundedFont('500') }]}>
            Sync error — check console
          </ThemedText>
        )}
      </View>

      {/* Books section header */}
      <View style={styles.booksSectionHeader}>
        <ThemedText style={[styles.booksSectionTitle, { color: theme.text, fontFamily: roundedFont('700') }]}>
          Database ({books.length})
        </ThemedText>
        <TouchableOpacity onPress={fetchLatestBooks} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          {booksLoading
            ? <ActivityIndicator size="small" color={accent} />
            : <Ionicons name="refresh-outline" size={20} color={accent} />
          }
        </TouchableOpacity>
      </View>
    </View>
  );

  const ListFooter = (
    <View>
      <TouchableOpacity
        onPress={handleClearDatabase}
        disabled={ingestion.status === 'running'}
        style={[styles.clearButton, { borderColor: theme.error + '40' }]}
      >
        <Ionicons name="trash-outline" size={15} color={theme.error} />
        <ThemedText style={[styles.clearButtonText, { color: theme.error, fontFamily: roundedFont('600') }]}>
          Clear database
        </ThemedText>
      </TouchableOpacity>

      <View style={[styles.bottomAnchor, { paddingBottom: insets.bottom + 16 }]}>
        <ThemedText style={[styles.bottomText, { color: theme.secondary + '70', fontFamily: roundedFont('600') }]}>
          SELIDA · DEV INGESTION
        </ThemedText>
      </View>
    </View>
  );

  return (
    <SafeAreaView edges={['bottom']} style={[styles.container, { backgroundColor: theme.background }]}>

      {/* Back button */}
      <TouchableOpacity
        onPress={() => router.back()}
        style={[styles.backButton, { top: insets.top + 12, backgroundColor: theme.surface }]}
      >
        <Ionicons name="arrow-back" size={18} color={theme.text} />
      </TouchableOpacity>

      <FlatList
        data={books}
        keyExtractor={item => item.id}
        ListHeaderComponent={ListHeader}
        ListFooterComponent={ListFooter}
        ListEmptyComponent={
          booksLoading ? null : (
            <ThemedText style={[styles.emptyText, { color: theme.secondary, fontFamily: roundedFont('400') }]}>
              No books in database yet.
            </ThemedText>
          )
        }
        renderItem={({ item, index }) => (
          <TouchableOpacity
            style={[styles.bookRow, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}
            onPress={() => setSelectedBook(item)}
            activeOpacity={0.7}
          >
            <ThemedText style={[styles.bookRowIndex, { color: theme.secondary, fontFamily: roundedFont('600') }]}>
              {index + 1}
            </ThemedText>
            {item.coverUrl ? (
              <Image
                source={{ uri: item.coverUrl }}
                style={[styles.bookRowThumb, { backgroundColor: theme.border }]}
                contentFit="cover"
              />
            ) : (
              <View style={[styles.bookRowThumb, styles.bookRowThumbPlaceholder, { backgroundColor: theme.border }]}>
                <Ionicons name="book-outline" size={14} color={theme.secondary} />
              </View>
            )}
            <View style={styles.bookRowInfo}>
              <ThemedText style={[styles.bookRowTitle, { color: theme.text, fontFamily: roundedFont('600') }]} numberOfLines={1}>
                {item.title}
              </ThemedText>
              <ThemedText style={[styles.bookRowMeta, { color: theme.secondary, fontFamily: roundedFont('400') }]} numberOfLines={1}>
                {item.authors?.[0] ?? '—'} · {item.categories?.[0] ?? '—'}
              </ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={15} color={theme.secondary} />
          </TouchableOpacity>
        )}
      />

      {selectedBook && (
        <BookDetailModal book={selectedBook} onClose={() => setSelectedBook(null)} />
      )}

    </SafeAreaView>
  );
}

/* ── Styles ────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  container: { flex: 1 },
  backButton: {
    position: 'absolute',
    left: 20,
    zIndex: 10,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  stage: {
    paddingHorizontal: 24,
    gap: 20,
    paddingBottom: 32,
  },
  iconOrb: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  headline: {
    fontSize: 38,
    fontWeight: '800',
    lineHeight: 44,
    letterSpacing: -1.1,
  },
  cursorCard: {
    borderRadius: 20,
    borderWidth: 1.5,
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 12,
  },
  cursorRow: { flexDirection: 'row', gap: 8 },
  cursorChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  cursorChipText: { fontSize: 14, fontWeight: '700' },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resultText: { fontSize: 14 },
  tallyText: { fontSize: 12, opacity: 0.7 },
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
  searchInput: { flex: 1, fontSize: 16, height: '100%' },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 54,
    borderRadius: 18,
    shadowColor: AccentPalette[1],
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 5,
  },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  hint: { fontSize: 14, textAlign: 'center', opacity: 0.7 },
  booksSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  booksSectionTitle: { fontSize: 17, fontWeight: '700' },
  emptyText: { textAlign: 'center', padding: 24, fontSize: 14 },
  bookRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  bookRowIndex: { fontSize: 12, width: 28, textAlign: 'right' },
  bookRowThumb: { width: 38, height: 54, borderRadius: 6 },
  bookRowThumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  bookRowInfo: { flex: 1 },
  bookRowTitle: { fontSize: 14, fontWeight: '600', marginBottom: 2 },
  bookRowMeta: { fontSize: 12 },
  clearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    marginHorizontal: 24,
    marginTop: 16,
    marginBottom: 8,
    borderRadius: 14,
    borderWidth: 1,
  },
  clearButtonText: { fontSize: 14, fontWeight: '600' },
  bottomAnchor: { alignItems: 'center', paddingBottom: 8 },
  bottomText: { fontSize: 10, fontWeight: '600', letterSpacing: 2 },
});

const modalStyles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 17, fontWeight: '700', flex: 1, marginRight: 12 },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: { padding: 20, gap: 12 },
  heroRow: { flexDirection: 'row', gap: 16, marginBottom: 4 },
  cover: { width: 90, height: 130, borderRadius: BorderRadius.md },
  coverPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  heroInfo: { flex: 1, gap: 4, justifyContent: 'center' },
  bookTitle: { fontSize: 18, fontWeight: '700', lineHeight: 24 },
  bookSubtitle: { fontSize: 14, lineHeight: 20 },
  bookAuthor: { fontSize: 14, fontWeight: '600', marginTop: 4 },
  section: {
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 2,
  },
  field: { gap: 2 },
  fieldLabel: { fontSize: 11, fontWeight: '600', opacity: 0.7 },
  fieldValue: { fontSize: 14 },
  description: { fontSize: 14, lineHeight: 22 },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tagText: { fontSize: 11, fontWeight: '500' },
});