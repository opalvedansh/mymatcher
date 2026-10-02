import type { ViewStyle } from 'react-native';
import { sz, TAB_BAR_EXTRA_BOTTOM } from '@/theme/scale';

/** Full height of the tab bar, including the bottom safe area it covers. */
export const TAB_BAR_HEIGHT = sz(55) + TAB_BAR_EXTRA_BOTTOM;

// Floating tab bar shared by the brand and influencer tab layouts. Screens that
// hide it (an open chat) restore this exact style when they are done.
export const TAB_BAR_STYLE: ViewStyle = {
  backgroundColor: '#FFFFFF',
  borderTopWidth: 0,
  height: TAB_BAR_HEIGHT,
  paddingBottom: sz(5) + TAB_BAR_EXTRA_BOTTOM,
  paddingTop: sz(5),
  borderTopLeftRadius: sz(25),
  borderTopRightRadius: sz(25),
  position: 'absolute', // To show rounded corners over content
  elevation: 10, // For Android shadow
  shadowColor: '#000',
  shadowOffset: { width: 0, height: -2 },
  shadowOpacity: 0.1,
  shadowRadius: 10,
};

export const HIDDEN_TAB_BAR_STYLE: ViewStyle = { ...TAB_BAR_STYLE, display: 'none' };
