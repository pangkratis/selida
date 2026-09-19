import { roundedFont } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { StyleSheet, Text, type TextProps } from 'react-native';

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
