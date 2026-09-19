import { clamp } from './theme';

/**
 * Shared dimensions for the floating "island" tab bar (app/(tabs)/_layout.tsx).
 *
 * Every tab screen's scrollable content needs enough bottom padding to clear
 * the island — since the bar is `position: 'absolute'`, content scrolls
 * underneath it rather than the layout reserving space automatically.
 * `TAB_BAR_CONTENT_CLEARANCE` is that padding. All three tab screens already
 * reserve `insets.bottom` via their own `SafeAreaView`, so this clearance only
 * needs to cover the island itself (gap + height) plus a bit of breathing room
 * — it must NOT also include `insets.bottom`, or the gap doubles up.
 */
export const TAB_BAR_ISLAND_HEIGHT = 60;
export const TAB_BAR_ISLAND_GAP = 10; // island's bottom edge to the safe-area bottom edge

/**
 * Content-hugging width, clamped rather than a single fixed number — a bare
 * fixed width (216, the original value) looks fine on the phone it was tuned
 * against but drifts noticeably off-balance at the extremes: at ~320pt
 * (small phones) 216px is ~67% of the screen, crowding the edges; at ~430pt
 * (large phones) it's only ~50%, leaving the pill looking small/adrift. The
 * pill's whole visual identity is "centered with balanced margin," so unlike
 * plain spacing/font sizes (which stay static — see `clamp()`'s own doc
 * comment in `theme.ts`), this one element's size legitimately needs to
 * track screen width, bounded so it never gets uncomfortably narrow (below
 * the 3 icon buttons' own content width) or implausibly wide.
 */
const TAB_BAR_ISLAND_WIDTH_MIN = 190;
const TAB_BAR_ISLAND_WIDTH_MAX = 236;
const TAB_BAR_ISLAND_WIDTH_RATIO = 0.55;

export function getTabBarIslandWidth(screenWidth: number): number {
  return clamp(TAB_BAR_ISLAND_WIDTH_MIN, screenWidth * TAB_BAR_ISLAND_WIDTH_RATIO, TAB_BAR_ISLAND_WIDTH_MAX);
}

export const TAB_BAR_CONTENT_CLEARANCE = TAB_BAR_ISLAND_GAP + TAB_BAR_ISLAND_HEIGHT + 24;
