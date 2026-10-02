import { Dimensions, PixelRatio } from 'react-native';
import { initialWindowMetrics } from 'react-native-safe-area-context';

// Every screen was designed on an iPhone 16. Sizes in the code are iPhone 16
// points; `sz()` converts them for the phone the app is running on so each
// screen keeps the same proportions everywhere, instead of crowding on small
// phones and floating in empty space on large ones.
//
// Wrap literal sizes (width, height, padding, margins, radii, font sizes,
// icon sizes) in `sz()`. Leave values already derived from the window size, and
// hairline borders, as they are.
const DESIGN_WIDTH = 393;
// iPhone 16 height (852) minus its safe areas (59 top, 34 bottom): the space a
// screen actually lays out in.
const DESIGN_USABLE_HEIGHT = 759;

const window = Dimensions.get('window');
const insets = initialWindowMetrics?.insets;
const usableHeight = window.height - (insets?.top ?? 0) - (insets?.bottom ?? 0);

// Bound by whichever dimension is tighter, so a short phone (iPhone SE) shrinks
// the layout enough to fit rather than only matching its width. Clamped so a
// tablet doesn't blow the phone layout up past readability, and a tiny screen
// doesn't shrink text below it.
export const SCALE = Math.min(
  1.25,
  Math.max(0.8, Math.min(window.width / DESIGN_WIDTH, usableHeight / DESIGN_USABLE_HEIGHT)),
);

/** Scales an iPhone 16 size to this device, snapped to the pixel grid. */
export function sz(size: number): number {
  return PixelRatio.roundToNearestPixel(size * SCALE);
}

// The tab bar grows by the bottom safe area so its icons sit above the iPhone
// home indicator and Android's navigation buttons, not underneath them.
export const TAB_BAR_EXTRA_BOTTOM = insets?.bottom ?? 0;

/** Bottom padding that clears the floating tab bar (`size` in iPhone 16 points). */
export function tabBarClearance(size: number): number {
  return sz(size) + TAB_BAR_EXTRA_BOTTOM;
}
