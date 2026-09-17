import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Alert,
  Animated,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AlertButton,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/** Alert.alert button plus an optional icon; native alerts ignore the icon. */
export type SheetButton = AlertButton & { icon?: React.ComponentProps<typeof Ionicons>['name'] };

type SheetRequest = { title: string; message?: string; buttons: SheetButton[] };

let presentSheet: ((req: SheetRequest) => void) | null = null;

/**
 * Drop-in for Alert.alert. react-native-web's Alert is a no-op, so on web the
 * same title/message/buttons render in an in-app bottom sheet instead.
 * Requires <ActionSheetHost /> to be mounted once near the app root.
 */
export function showAlert(title: string, message?: string, buttons?: SheetButton[]) {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, buttons);
    return;
  }
  const list = buttons?.length ? buttons : [{ text: 'OK' }];
  if (presentSheet) {
    presentSheet({ title, message, buttons: list });
  } else if (typeof window !== 'undefined') {
    window.alert([title, message].filter(Boolean).join('\n\n'));
  }
}

// react-native-web passes hover/focus state to Pressable style callbacks; the
// native typings only declare `pressed`.
type InteractionState = { pressed: boolean; hovered?: boolean; focused?: boolean };

export function ActionSheetHost() {
  const [request, setRequest] = useState<SheetRequest | null>(null);
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    presentSheet = setRequest;
    return () => { presentSheet = null; };
  }, []);

  useEffect(() => {
    if (!request) return;
    slide.setValue(0);
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then(reduce => {
        Animated.spring(slide, {
          toValue: 1,
          useNativeDriver: Platform.OS !== 'web',
          ...(reduce ? { overshootClamping: true, speed: 1000 } : { damping: 22, stiffness: 220 }),
        }).start();
      });
  }, [request, slide]);

  if (!request) return null;

  const actions = request.buttons.filter(b => b.style !== 'cancel');
  const cancel = request.buttons.find(b => b.style === 'cancel');
  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [48, 0] });

  // Close first, so a button that opens a follow-up sheet (e.g. a delete
  // confirmation) replaces this one instead of being cleared by it.
  const choose = (button?: SheetButton) => {
    setRequest(null);
    button?.onPress?.();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => choose(cancel)}>
      <Pressable style={styles.overlay} onPress={() => choose(cancel)} accessibilityLabel="Close menu">
        <Animated.View style={[styles.sheet, { opacity: slide, transform: [{ translateY }] }]}>
          <Pressable onPress={() => {}} accessibilityRole="menu" style={[styles.sheetBody, { cursor: 'auto' } as any]}>
            <View style={styles.grabber} />
            <Text style={styles.title} accessibilityRole="header">{request.title}</Text>
            {request.message ? <Text style={styles.message}>{request.message}</Text> : null}

            <View style={styles.actions}>
              {actions.map((button, i) => {
                const destructive = button.style === 'destructive';
                const tint = destructive ? '#FF5A4F' : '#FFF';
                return (
                  <Pressable
                    key={button.text}
                    onPress={() => choose(button)}
                    accessibilityRole="menuitem"
                    style={(state) => {
                      const { pressed, hovered, focused } = state as InteractionState;
                      return [
                        styles.action,
                        i > 0 && styles.actionDivider,
                        (hovered || focused) && styles.actionHover,
                        pressed && styles.actionPressed,
                      ];
                    }}
                  >
                    {button.icon && (
                      <View style={[styles.iconWrap, destructive && styles.iconWrapDestructive]}>
                        <Ionicons name={button.icon} size={18} color={tint} />
                      </View>
                    )}
                    <Text style={[styles.actionText, { color: tint }]}>{button.text}</Text>
                    {!destructive && <Ionicons name="chevron-forward" size={16} color="#666" />}
                  </Pressable>
                );
              })}
            </View>

            {cancel && (
              <Pressable
                onPress={() => choose(cancel)}
                accessibilityRole="button"
                style={(state) => {
                  const { pressed, hovered, focused } = state as InteractionState;
                  return [styles.cancel, (hovered || focused) && styles.actionHover, pressed && styles.actionPressed];
                }}
              >
                <Text style={styles.cancelText}>{cancel.text || 'Cancel'}</Text>
              </Pressable>
            )}
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  sheet: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#141414',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  sheetBody: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 28,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginBottom: 18,
  },
  title: { color: '#FFF', fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  message: { color: '#9A9A9A', fontSize: 13, lineHeight: 19, marginTop: 4 },
  actions: {
    marginTop: 18,
    borderRadius: 16,
    backgroundColor: '#1C1C1C',
    overflow: 'hidden',
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 14,
  },
  actionDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  actionHover: { backgroundColor: 'rgba(255,255,255,0.05)' },
  actionPressed: { backgroundColor: 'rgba(255,255,255,0.09)' },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.07)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconWrapDestructive: { backgroundColor: 'rgba(255,90,79,0.12)' },
  actionText: { flex: 1, fontSize: 16, fontWeight: '500' },
  cancel: {
    marginTop: 10,
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: '#1C1C1C',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
});
