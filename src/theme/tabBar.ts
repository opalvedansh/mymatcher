import type { ViewStyle } from 'react-native';
import { sz, TAB_BAR_EXTRA_BOTTOM } from '@/theme/scale';

const PILL_HEIGHT = sz(60);
// Floats the pill just above the home indicator, or a small gap off the bottom
// edge on phones without one, so the screen's rounded corners never clip it.
const BOTTOM_GAP = Math.max(TAB_BAR_EXTRA_BOTTOM - sz(8), sz(12));

/** Space the floating tab bar takes up from the bottom of the screen. */
export const TAB_BAR_HEIGHT = PILL_HEIGHT + BOTTOM_GAP;

// Floating tab bar shared by the brand and influencer tab layouts. Screens that
// hide it (an open chat) restore this exact style when they are done.
export const TAB_BAR_STYLE: ViewStyle = {
  backgroundColor: '#FFFFFF',
  borderTopWidth: 0,
  height: PILL_HEIGHT,
  paddingTop: 0,
  paddingBottom: 0,
  paddingHorizontal: sz(8),
  borderRadius: PILL_HEIGHT / 2,
  position: 'absolute', // Floats over content so it shows around the pill
  left: sz(16),
  right: sz(16),
  bottom: BOTTOM_GAP,
  elevation: 10, // For Android shadow
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.15,
  shadowRadius: 12,
};

export const HIDDEN_TAB_BAR_STYLE: ViewStyle = { ...TAB_BAR_STYLE, display: 'none' };
