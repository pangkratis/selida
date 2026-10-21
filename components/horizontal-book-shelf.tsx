import { ThemedText } from '@/components/themed-text';
import { Colors } from '@/constants/theme';
import { Book } from '@/constants/types';
import { HomeScrollContext } from '@/hooks/home-scroll-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Image } from 'expo-image';
import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, StyleSheet, TouchableOpacity, View, useWindowDimensions } from 'react-native';

const CARD_WIDTH = 140;
const CARD_GAP = 16;
const SNAP_STEP = CARD_WIDTH + CARD_GAP;
// A drag this long (dp) counts as "go to the next book"; a shorter but quicker
// flick does too.
const SWIPE_MIN_DISTANCE = 24;
const SWIPE_FLICK_MIN_DISTANCE = 8;
const SWIPE_MIN_VELOCITY = 0.3;

// Scroll offsets the shelf rests at when snapping: the first book sits at the
// left margin, every later book is centred on the screen (the margin is part
// of the maths, so the centring is exact). Where centring would need a negative
// offset (wide screens) those books share the first resting place.
const buildSnapOffsets = (count: number, left: number, viewport: number): number[] => {
  const offsets = [0];
  for (let i = 1; i < count; i++) {
    const centred = left + SNAP_STEP * i + CARD_WIDTH / 2 - viewport / 2;
    if (centred > offsets[offsets.length - 1] + 1) offsets.push(centred);
  }
  return offsets;
};

const nearestIndex = (offsets: number[], x: number): number => {
  let best = 0;
  for (let i = 1; i < offsets.length; i++) {
    if (Math.abs(offsets[i] - x) < Math.abs(offsets[best] - x)) best = i;
  }
  return best;
};

type HorizontalBookShelfProps = {
  books: Book[];
  onPressBook: (book: Book) => void;
  keyPrefix?: string;
  contentPaddingHorizontal?: number;
  onEndReached?: () => void;
  loadingMore?: boolean;
  // Every swipe, short or long, moves exactly one book to the centre (the first
  // book rests at the left margin). Full-width shelves only.
  snapCenter?: boolean;
};

export default function HorizontalBookShelf({
  books,
  onPressBook,
  keyPrefix = 'book',
  contentPaddingHorizontal = 20,
  onEndReached,
  loadingMore = false,
  snapCenter = false,
}: HorizontalBookShelfProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const { active, addScrollListener, claimHint } = useContext(HomeScrollContext);
  const containerRef = useRef<View>(null);
  const listRef = useRef<FlatList>(null);
  const hintFired = useRef(false);
  const { height: screenHeight, width } = useWindowDimensions();
  const [previewCover, setPreviewCover] = useState<string | null>(null);

  // One swipe = one book. The finger drags the shelf as usual; on release the
  // shelf always eases to the resting place next to where the drag started (or
  // back to it for a very short drag), so short, medium and long swipes all end
  // the same way. Native momentum is switched off so nothing competes with it.
  const snapOffsets = useMemo(
    () => (snapCenter ? buildSnapOffsets(books.length, contentPaddingHorizontal, width) : []),
    [snapCenter, books.length, contentPaddingHorizontal, width],
  );
  const dragStartIndex = useRef(0);
  const handleDragStart = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    dragStartIndex.current = nearestIndex(snapOffsets, e.nativeEvent.contentOffset.x);
  };
  const handleDragEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!snapCenter || snapOffsets.length === 0) return;
    const start = Math.min(dragStartIndex.current, snapOffsets.length - 1);
    const dragged = e.nativeEvent.contentOffset.x - snapOffsets[start];
    // Android reports the release velocity of the finger, iOS that of the
    // content, so the sign is flipped on Android.
    const velocity = (Platform.OS === 'android' ? -1 : 1) * (e.nativeEvent.velocity?.x ?? 0);
    let direction = 0;
    if (Math.abs(dragged) > SWIPE_MIN_DISTANCE) direction = Math.sign(dragged);
    else if (Math.abs(dragged) > SWIPE_FLICK_MIN_DISTANCE && Math.abs(velocity) > SWIPE_MIN_VELOCITY) direction = Math.sign(velocity);
    const target = Math.max(0, Math.min(snapOffsets.length - 1, start + direction));
    listRef.current?.scrollToOffset({ offset: snapOffsets[target], animated: true });
  };
  const rightPadding = snapCenter ? Math.max(contentPaddingHorizontal, (width - CARD_WIDTH) / 2) : contentPaddingHorizontal;

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
        decelerationRate={snapCenter ? 0 : 'fast'}
        onScrollBeginDrag={snapCenter ? handleDragStart : undefined}
        onScrollEndDrag={snapCenter ? handleDragEnd : undefined}
        onEndReached={onEndReached}
        onEndReachedThreshold={2}
        initialNumToRender={5}
        maxToRenderPerBatch={6}
        windowSize={7}
        keyExtractor={(item) => `${keyPrefix}-${item.id}`}
        contentContainerStyle={{ paddingLeft: contentPaddingHorizontal, paddingRight: rightPadding }}
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
        ListFooterComponent={loadingMore ? (
          <View style={styles.footer}>
            <ActivityIndicator size="small" color={theme.secondary} />
          </View>
        ) : null}
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
    width: CARD_WIDTH,
  },
  bookCover: {
    width: CARD_WIDTH,
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
    width: CARD_GAP,
  },
  footer: {
    width: 56,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
