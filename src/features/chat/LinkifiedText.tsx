import React, { memo } from 'react';
import { Linking, Platform, Text, type StyleProp, type TextStyle } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

// URLs with a scheme or a "www." prefix, and email addresses.
const LINK_RE = /((?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,;:!?)\]}])|([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

export function openLink(raw: string) {
  const url = raw.includes('@') && !/^https?:/i.test(raw) && !raw.startsWith('www.')
    ? `mailto:${raw}`
    : /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  if (url.startsWith('mailto:')) {
    Linking.openURL(url).catch(() => {});
  } else if (Platform.OS === 'web') {
    window.open(url, '_blank', 'noopener,noreferrer');
  } else {
    WebBrowser.openBrowserAsync(url).catch(() => Linking.openURL(url).catch(() => {}));
  }
}

/** Message text with tappable links and email addresses. */
export const LinkifiedText = memo(function LinkifiedText({
  text,
  style,
  linkStyle,
  children,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  linkStyle?: StyleProp<TextStyle>;
  /** Rendered after the text, inside the same Text (the time spacer). */
  children?: React.ReactNode;
}) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK_RE)) {
    const start = match.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    const value = match[0];
    parts.push(
      <Text
        key={`${start}-${value}`}
        style={[{ textDecorationLine: 'underline' }, linkStyle]}
        onPress={() => openLink(value)}
        accessibilityRole="link"
        suppressHighlighting
      >
        {value}
      </Text>,
    );
    last = start + value.length;
  }
  if (last < text.length) parts.push(text.slice(last));

  return (
    <Text style={style} selectable={Platform.OS === 'web'}>
      {parts}
      {children}
    </Text>
  );
});
