import { useLayoutEffect, type RefObject } from 'react';
import { Platform, type TextInput } from 'react-native';

/** Spread onto a multiline TextInput: on web it starts one row tall, not the browser's two. */
export const SINGLE_ROW_ON_WEB = Platform.OS === 'web' ? { rows: 1 } : {};

/**
 * Web only. A multiline TextInput is a <textarea> there, which does not grow
 * with its text the way the native input does. After every change this sizes
 * it to its content, up to `maxHeight`, then scrolls. Shrinks again as lines
 * are deleted or the text is cleared.
 */
export function useAutoGrowInput(ref: RefObject<TextInput | null>, value: string, maxHeight: number) {
  useLayoutEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = ref.current as unknown as HTMLTextAreaElement | null;
    if (!node?.style || typeof node.scrollHeight !== 'number') return;
    node.style.height = 'auto';
    const content = node.scrollHeight;
    node.style.height = `${Math.min(content, maxHeight)}px`;
    node.style.overflowY = content > maxHeight ? 'auto' : 'hidden';
  }, [ref, value, maxHeight]);
}
