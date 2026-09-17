import type { ViewStyle } from 'react-native';

// Floating tab bar shared by the brand and influencer tab layouts. Screens that
// hide it (an open chat) restore this exact style when they are done.
export const TAB_BAR_STYLE: ViewStyle = {
  backgroundColor: '#FFFFFF',
  borderTopWidth: 0,
  height: 55,
  paddingBottom: 5,
  paddingTop: 5,
  borderTopLeftRadius: 25,
  borderTopRightRadius: 25,
  position: 'absolute', // To show rounded corners over content
  elevation: 10, // For Android shadow
  shadowColor: '#000',
  shadowOffset: { width: 0, height: -2 },
  shadowOpacity: 0.1,
  shadowRadius: 10,
};

export const HIDDEN_TAB_BAR_STYLE: ViewStyle = { ...TAB_BAR_STYLE, display: 'none' };
