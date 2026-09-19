import { ThemedText } from '@/components/themed-text';
import { Colors } from '@/constants/theme';
import { Book } from '@/constants/types';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Image } from 'expo-image';
import React, { useMemo } from 'react';
import { FlatList, StyleSheet, TouchableOpacity, useWindowDimensions } from 'react-native';

type CompactBookGridProps = {
  books: Book[];
  onPressBook: (book: Book) => void;
  columns?: number;
  contentPaddingHorizontal?: number;
  contentPaddingBottom?: number;
  onEndReached?: () => void;
  onEndReachedThreshold?: number;
  ListFooterComponent?: React.ReactElement | null;
};

export default function CompactBookGrid({
  books,
  onPressBook,
  columns = 3,
  contentPaddingHorizontal = 20,
  contentPaddingBottom = 40,
  onEndReached,
  onEndReachedThreshold = 0.3,
  ListFooterComponent,
}: CompactBookGridProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const { width } = useWindowDimensions();

  const gap = 12;
  const cardWidth = useMemo(() => {
    return (width - contentPaddingHorizontal * 2 - gap * (columns - 1)) / columns;
  }, [width, contentPaddingHorizontal, gap, columns]);

  return (
    <FlatList
      data={books}
      numColumns={columns}
      key={columns}
      keyExtractor={(item, index) => `${item.id}-${index}`}
      contentContainerStyle={{
        paddingHorizontal: contentPaddingHorizontal,
        paddingTop: 4,
        paddingBottom: contentPaddingBottom,
      }}
      columnWrapperStyle={styles.gridRow}
      showsVerticalScrollIndicator={false}
      onEndReached={onEndReached}
      onEndReachedThreshold={onEndReachedThreshold}
      ListFooterComponent={ListFooterComponent}
      renderItem={({ item }) => {
        return (
          <TouchableOpacity style={[styles.gridCard, { width: cardWidth }]} onPress={() => onPressBook(item)} activeOpacity={0.85}>
            <Image
              source={{ uri: item.coverUrl || undefined }}
              style={[styles.gridCover, { backgroundColor: theme.border }]}
              contentFit="cover"
              transition={300}
            />
            <ThemedText style={styles.gridTitle} numberOfLines={2}>
              {item.title || 'Unknown Title'}
            </ThemedText>
            <ThemedText style={[styles.gridAuthor, { color: theme.secondary }]} numberOfLines={1}>
              {item.authors?.[0] || 'Unknown Author'}
            </ThemedText>
          </TouchableOpacity>
        );
      }}
      ItemSeparatorComponent={() => null}
    />
  );
}

const styles = StyleSheet.create({
  gridRow: {
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  gridCard: {
    padding: 0,
  },
  gridCover: {
    width: '100%',
    aspectRatio: 0.7,
    borderRadius: 10,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 5,
  },
  gridTitle: {
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 17,
  },
  gridAuthor: {
    marginTop: 3,
    fontSize: 11,
    fontWeight: '500',
  },
});
