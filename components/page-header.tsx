import { ThemedText } from '@/components/themed-text';
import { Colors, mixHex } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

type PageHeaderProps = {
  eyebrow: string;
  title: string;
  rightSlot?: React.ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
};

export default function PageHeader({ eyebrow, title, rightSlot, containerStyle }: PageHeaderProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const titleColor = mixHex(theme.text, theme.secondary, colorScheme === 'dark' ? 0.22 : 0.32);

  return (
    <View style={[styles.container, containerStyle]}>
      <View style={styles.leftBlock}>
        <ThemedText style={[styles.eyebrow, { color: theme.secondary }]}>{eyebrow}</ThemedText>
        <ThemedText style={[styles.title, { color: titleColor }]}>{title}</ThemedText>
      </View>
      {rightSlot ? <View style={styles.rightBlock}>{rightSlot}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  leftBlock: {
    flex: 1,
  },
  rightBlock: {
    marginLeft: 12,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.3,
    lineHeight: 32,
  },
});
