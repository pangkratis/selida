import { roundedFont } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { Platform, StyleSheet, Text, type TextProps } from 'react-native';

export type ThemedTextProps = TextProps & {
  lightColor?: string;
  darkColor?: string;
  type?: 'default' | 'title' | 'defaultSemiBold' | 'subtitle' | 'link';
};

export function ThemedText({
  style,
  lightColor,
  darkColor,
  type = 'default',
  ...rest
}: ThemedTextProps) {
  const color = useThemeColor({ light: lightColor, dark: darkColor }, 'text');

  // Derive fontFamily from the effective fontWeight so the rounded font is
  // used at every weight on Android/web (iOS uses ui-rounded natively).
  // Merge type-preset weight first so that e.g. type='defaultSemiBold' (which
  // sets fontWeight:'600' in the static StyleSheet) resolves the correct font
  // family even when the caller passes no explicit fontWeight.
  const typePresetWeight =
    type === 'defaultSemiBold' ? '600'
    : type === 'title' || type === 'subtitle' ? 'bold'
    : undefined;
  const flatStyle = StyleSheet.flatten(style);
  const fontWeight = flatStyle?.fontWeight ?? typePresetWeight ?? '400';
  const fontFamily = roundedFont(String(fontWeight));

  // The 'default' preset's lineHeight (24) is too short for big text, which
  // then gets its descenders cut off (the "y" in "My Library"). When a caller
  // makes the text bigger without giving a lineHeight, size the line to fit.
  const fontSize = typeof flatStyle?.fontSize === 'number' ? flatStyle.fontSize : undefined;
  const autoLineHeight =
    fontSize !== undefined && flatStyle?.lineHeight === undefined && fontSize * 1.25 > 24
      ? { lineHeight: Math.ceil(fontSize * 1.25) }
      : undefined;

  return (
    <Text
      style={[
        { color, fontFamily },
        type === 'default' ? styles.default : undefined,
        type === 'title' ? styles.title : undefined,
        type === 'defaultSemiBold' ? styles.defaultSemiBold : undefined,
        type === 'subtitle' ? styles.subtitle : undefined,
        type === 'link' ? styles.link : undefined,
        style,
        autoLineHeight,
        // Android: each weight is its own font file (OpenRunde-Bold…), so the
        // weight is already in the font. Passing fontWeight as well makes
        // Android fake-bold it again, drawing text wider than it measured —
        // Greek headings wrapped and lost their last word. Keep the family,
        // drop the weight.
        Platform.OS === 'android' ? { fontFamily, fontWeight: 'normal' as const } : undefined,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  default: {
    fontSize: 16,
    lineHeight: 24,
  },
  defaultSemiBold: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    lineHeight: 32,
  },
  subtitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  link: {
    lineHeight: 30,
    fontSize: 16,
    color: '#0a7ea4',
  },
});
