/**
 * Bright Baby Theme - Book Recommendation App
 * Cheerful mobile app design using bright pastel baby colors with leaf green as the main theme.
 */

import { Platform } from 'react-native';

// Primary Green Palette
// Ranges from #F2F9F3 (lightest) to #2F6E38 (darkest)
// Main accents: #6FB87A and #4CA55A

export const Colors = {
  light: {
    // Base - Fresh & Cheerful
    text: '#2D3A2D', // Dark green-gray
    background: '#fefbf8ff', // Soft warm white
    surface: '#FFFFFF', // Pure white cards

    // Primary - Leaf Green
    tint: '#4CA55A',
    primary: '#4CA55A',
    primaryLight: '#6FB87A',
    primaryDark: '#2F6E38',
    primaryBackground: '#F2F9F3',

    // Supporting
    secondary: '#6B7A6B', // Muted green-gray
    border: '#E6EDE6', // Light green-gray border
    icon: '#6B7A6B',
    tabIconDefault: '#9BA89B',
    tabIconSelected: '#4CA55A',

    // Status Colors
    error: '#E85555',
    success: '#4CA55A',
    warning: '#FADB5C',

    // Gradient Colors (fresh green gradient)
    gradientStart: '#F2F9F3', // Lightest green
    gradientMid: '#6FB87A', // Mid green
    gradientEnd: '#4CA55A', // Primary green

    // Accent
    accent: '#6FB87A',

    // Section-Specific Accent Colors
    sectionForYou: '#FADB5C', // Yellow
    sectionForYouBg: '#FEF9E0',
    sectionBecauseLiked: '#ED85A2', // Pink
    sectionBecauseLikedBg: '#FCE8ED',
    sectionTrending: '#5CB8E4', // Blue
    sectionTrendingBg: '#E0F2FA',
    sectionNewReleases: '#BA9DE3', // Purple
    sectionNewReleasesBg: '#F2ECFA',
    sectionPeach: '#F8AD70', // Peach
    sectionPeachBg: '#FEEFE4',

    // Profile Tab Colors
    tabReading: '#5CB8E4', // Blue
    tabReadingBg: '#E0F2FA',
    tabWishlist: '#ED85A2', // Pink
    tabWishlistBg: '#FCE8ED',
    tabFinished: '#4CA55A', // Green
    tabFinishedBg: '#F2F9F3',
  },
  dark: {
    // Base - Deep Forest Night
    text: '#F2F9F3', // Light green-white
    background: '#1F1C18', // Deep warm dark
    surface: '#2C2820', // Elevated warm dark surface

    // Primary - Brighter Green for visibility
    tint: '#6FB87A',
    primary: '#6FB87A',
    primaryLight: '#8ECC98',
    primaryDark: '#4CA55A',
    primaryBackground: '#243324',

    // Supporting
    secondary: '#8B9A8B',
    border: '#3D4A3D',
    icon: '#8B9A8B',
    tabIconDefault: '#5A6A5A',
    tabIconSelected: '#6FB87A',

    // Status
    error: '#F07070',
    success: '#6FB87A',
    warning: '#FADB5C',

    // Gradient Colors
    gradientStart: '#243324',
    gradientMid: '#4CA55A',
    gradientEnd: '#6FB87A',

    // Accent
    accent: '#8ECC98',

    // Section-Specific Accent Colors (slightly muted for dark mode)
    sectionForYou: '#FADB5C',
    sectionForYouBg: '#3A3520',
    sectionBecauseLiked: '#ED85A2',
    sectionBecauseLikedBg: '#3A2530',
    sectionTrending: '#5CB8E4',
    sectionTrendingBg: '#1A3040',
    sectionNewReleases: '#BA9DE3',
    sectionNewReleasesBg: '#2A2540',
    sectionPeach: '#F8AD70',
    sectionPeachBg: '#3A2A1A',

    // Profile Tab Colors
    tabReading: '#5CB8E4',
    tabReadingBg: '#1A3040',
    tabWishlist: '#ED85A2',
    tabWishlistBg: '#3A2530',
    tabFinished: '#6FB87A',
    tabFinishedBg: '#243324',
  },
};

// Cycling accent palette used across cards throughout the app
// Previous palette (vibrant):
// export const AccentPalette = ['#C07ED6', '#6BA3D6', '#f8ad70', '#7EC87E', '#f07070'];
// export const AccentPalette = ['#C07ED6', '#7EC87E', '#6BA3D6', '#D6A56B', '#D67E8E'];
// Warm Mediterranean (muted):
// export const AccentPalette = ['#E8B44C', '#4A9A9A', '#C4804A', '#8AAD7B', '#C47272'];
// Warm + cheerful:
// export const AccentPalette = ['#E8B44C', '#4A9A9A', '#C07ED6', '#6BC48C', '#E87490'];
// Current palette (bold + cheerful):
export const AccentPalette = ['#F7C81F', '#2D8FD5', '#F25577', '#34C759', '#C07ED6'];

// Design Tokens
export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const BorderRadius = {
  sm: 8,
  md: 16,
  lg: 20,
  pill: 24,
  full: 9999,
};

export const Fonts = Platform.select({
  ios: {
    /** Rounded system font for headings */
    heading: 'System',
    /** Regular system font for body */
    body: 'System',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    heading: 'Nunito_400Regular',
    body: 'Nunito_400Regular',
    rounded: 'Nunito_400Regular',
    mono: 'monospace',
  },
  web: {
    heading: 'Nunito_400Regular',
    body: 'Nunito_400Regular',
    rounded: 'Nunito_400Regular',
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
});

/**
 * Map of Nunito font family names per weight for Android/web.
 * Only includes weights that are actually loaded in app/_layout.tsx (400–800).
 * Any unmapped weight falls back to Nunito_400Regular via roundedFont().
 */
const NUNITO_WEIGHT_MAP: Record<string, string> = {
  '400': 'Nunito_400Regular',
  '500': 'Nunito_500Medium',
  '600': 'Nunito_600SemiBold',
  '700': 'Nunito_700Bold',
  '800': 'Nunito_800ExtraBold',
  'normal': 'Nunito_400Regular',
  'bold': 'Nunito_700Bold',
};

/**
 * Returns the correct rounded fontFamily for the given weight.
 * - iOS: always `'ui-rounded'` (SF Pro Rounded — the OS handles weight natively)
 * - Android / Web: the matching named Nunito font file
 */
export function roundedFont(weight: string = '400'): string {
  if (Platform.OS === 'ios') return 'ui-rounded';
  return NUNITO_WEIGHT_MAP[weight] ?? 'Nunito_400Regular';
}

/* ── Color Utilities ─────────────────────────────────────────────── */

const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  const clean = (hex || '').replace('#', '').trim();
  if (clean.length !== 6) return null;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return { r, g, b };
};

const rgbToHex = ({ r, g, b }: { r: number; g: number; b: number }): string => {
  const toHex = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

/**
 * Linearly blends two hex colours.
 * @param baseHex   The starting colour (ratio = 0).
 * @param accentHex The target colour  (ratio = 1).
 * @param ratio     Mix weight in [0, 1].
 */
export function mixHex(baseHex: string, accentHex: string, ratio: number): string {
  const base = hexToRgb(baseHex);
  const accent = hexToRgb(accentHex);
  if (!base || !accent) return baseHex;
  const w = Math.max(0, Math.min(1, ratio));
  return rgbToHex({
    r: base.r + (accent.r - base.r) * w,
    g: base.g + (accent.g - base.g) * w,
    b: base.b + (accent.b - base.b) * w,
  });
}

/**
 * Returns a fully-transparent version of `hex`, preserving its RGB channels.
 *
 * Use this instead of the literal string `'transparent'` as a LinearGradient
 * endpoint. `'transparent'` is `rgba(0,0,0,0)` — interpolating an opaque color
 * toward it also interpolates the RGB channels toward black, so a fade to
 * "transparent" visibly passes through a gray/muddy band partway through
 * instead of just fading out in the original hue.
 */
export function toTransparent(hex: string): string {
  const rgbOnly = hex.length >= 7 ? hex.slice(0, 7) : hex;
  return `${rgbOnly}00`;
}

/**
 * Bounds `preferred` to [min, max]. Use this — paired with `useWindowDimensions()`
 * at the call site — for the small class of elements whose size is deliberately
 * NOT full-width/flex-driven but should still track screen width within limits
 * (a floating pill, a centered hero image): e.g.
 * `clamp(190, screenWidth * 0.55, 236)`.
 *
 * Do NOT reach for this for spacing, font sizes, icon sizes, or border radii —
 * those are already device-density-independent as plain point values and stay
 * static across the phone-width range; scaling them by screen width would
 * introduce inconsistency that isn't currently a problem, not fix one. This
 * also isn't for content that should just fill available space — use Flexbox/
 * percentage width for that instead, no formula needed.
 */
export function clamp(min: number, preferred: number, max: number): number {
  return Math.min(Math.max(preferred, min), max);
}
