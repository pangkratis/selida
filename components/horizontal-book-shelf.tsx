import { ThemedText } from '@/components/themed-text';
import { Colors } from '@/constants/theme';
import { Book } from '@/constants/types';
import { HomeScrollContext } from '@/hooks/home-scroll-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Image } from 'expo-image';
import React, { useContext, useEffect, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, TouchableOpacity, View, useWindowDimensions } from 'react-native';

type HorizontalBookShelfProps = {
  books: Book[];
  onPressBook: (book: Book) => void;
  keyPrefix?: string;
  contentPaddingHorizontal?: number;
};

export default function HorizontalBookShelf({
  books,
  onPressBook,
  keyPrefix = 'book',
  contentPaddingHorizontal = 20,
}: HorizontalBookShelfProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const { active, addScrollListener, claimHint } = useContext(HomeScrollContext);
  const containerRef = useRef<View>(null);
  const listRef = useRef<FlatList>(null);
  const hintFired = useRef(false);
  const { height: screenHeight, width } = useWindowDimensions();
  const [previewCover, setPreviewCover] = useState<string | null>(null);

  useEffect(() => {
    if (books.length === 0 || !active) return;

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
  }, [books.length, active, addScrollListener, screenHeight]);

  return (
    <View ref={containerRef}>
      <FlatList
        ref={listRef}
        data={books}
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        keyExtractor={(item) => `${keyPrefix}-${item.id}`}
        contentContainerStyle={{ paddingHorizontal: contentPaddingHorizontal }}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.bookCard}
            onPress={() => onPressBook(item)}
            onLongPress={() => { if (item.coverUrl) setPreviewCover(item.coverUrl); }}
            delayLongPress={350}
            activeOpacity={0.85}
          >
            <Image
              source={{ uri: item.coverUrl || undefined }}
              style={[styles.bookCover, { backgroundColor: theme.border }]}
              contentFit="cover"
              transition={200}
            />
            <ThemedText style={styles.bookTitle} numberOfLines={1}>
              {item.title || 'Unknown Title'}
            </ThemedText>
            <ThemedText style={[styles.bookAuthor, { color: theme.secondary }]} numberOfLines={1}>
              {item.authors?.[0] || 'Unknown Author'}
            </ThemedText>
          </TouchableOpacity>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />

      <Modal visible={!!previewCover} transparent statusBarTranslucent animationType="fade" onRequestClose={() => setPreviewCover(null)}>
        <Pressable style={styles.backdrop} onPress={() => setPreviewCover(null)}>
          <View style={{ width: width * 0.85, aspectRatio: 0.67, borderRadius: 14, overflow: 'hidden' }}>
            <Image
              source={{ uri: previewCover || undefined }}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
              transition={200}
            />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  bookCard: {
    width: 140,
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
    elevation: 3,
  },
  bookTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  bookAuthor: {
    fontSize: 12,
  },
  separator: {
    width: 16,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
