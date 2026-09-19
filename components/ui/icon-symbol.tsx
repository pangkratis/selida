// Fallback for using Ionicons on Android and web.
// iOS uses icon-symbol.ios.tsx which renders native SF Symbols via expo-symbols.

import { Ionicons } from '@expo/vector-icons';
import { SymbolViewProps, SymbolWeight } from 'expo-symbols';
import { ComponentProps } from 'react';
import { OpaqueColorValue, StyleProp, TextStyle } from 'react-native';

type IoniconsName = ComponentProps<typeof Ionicons>['name'];

const MAPPING: Partial<Record<SymbolViewProps['name'], IoniconsName>> = {
  'house': 'home-outline',
  'house.fill': 'home',
  'safari': 'compass-outline',
  'safari.fill': 'compass',
  'chevron.left.forwardslash.chevron.right': 'code-slash',
  'chevron.right': 'chevron-forward',
  'person': 'person-outline',
  'person.fill': 'person',
};

/**
 * An icon component that uses native SF Symbols on iOS, and Ionicons on Android and web.
 * Icon `name`s are SF Symbol names; they are mapped to Ionicons equivalents on non-iOS platforms.
 */
export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: SymbolViewProps['name'];
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  const ioniconsName = MAPPING[name] ?? 'help-circle-outline';
  return <Ionicons name={ioniconsName} size={size} color={color} style={style as any} />;
}
