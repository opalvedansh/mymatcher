import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { sz } from '@/theme/scale';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// react-native-web passes hover/focus state to Pressable style callbacks; the
// native typings only declare `pressed`.
type InteractionState = { pressed: boolean; hovered?: boolean; focused?: boolean };

/** Bottom sheet with the same look as ActionSheet, for chat menus with custom content. */
export function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    slide.setValue(0);
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        Animated.spring(slide, {
          toValue: 1,
          useNativeDriver: Platform.OS !== 'web',
          ...(reduce ? { overshootClamping: true, speed: 1000 } : { damping: 22, stiffness: 220 }),
        }).start();
      });
  }, [visible, slide]);

  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [48, 0] });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose} accessibilityLabel="Close menu">
        <Animated.View style={[styles.sheet, { opacity: slide, transform: [{ translateY }] }]}>
          <Pressable
            onPress={() => {}}
            style={[styles.body, { paddingBottom: Math.max(insets.bottom, sz(16)) + sz(8) }, { cursor: 'auto' } as any]}
          >
            <View style={styles.grabber} />
            {title ? <Text style={styles.title} accessibilityRole="header">{title}</Text> : null}
            {children}
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

/** A row in a sheet's action group. */
export function SheetAction({
  icon,
  label,
  onPress,
  destructive,
  first,
  detail,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  destructive?: boolean;
  first?: boolean;
  detail?: string;
}) {
  const tint = destructive ? '#FF5A4F' : '#FFF';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="menuitem"
      style={(state) => {
        const { pressed, hovered, focused } = state as InteractionState;
        return [
          styles.action,
          !first && styles.actionDivider,
          (hovered || focused) && styles.actionHover,
          pressed && styles.actionPressed,
        ];
      }}
    >
      <View style={[styles.iconWrap, destructive && styles.iconWrapDestructive]}>
        <Ionicons name={icon} size={sz(18)} color={tint} />
      </View>
      <Text style={[styles.actionText, { color: tint }]}>{label}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    </Pressable>
  );
}

export function SheetGroup({ children }: { children: React.ReactNode }) {
  return <View style={styles.group}>{children}</View>;
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
    maxWidth: sz(480),
    maxHeight: '88%',
    backgroundColor: '#141414',
    borderTopLeftRadius: sz(24),
    borderTopRightRadius: sz(24),
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  body: { paddingHorizontal: sz(20), paddingTop: sz(10) },
  grabber: {
    alignSelf: 'center',
    width: sz(36),
    height: sz(4),
    borderRadius: sz(2),
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginBottom: sz(14),
  },
  title: { color: '#FFF', fontSize: sz(20), fontWeight: '700', letterSpacing: -0.3, marginBottom: sz(14) },
  group: { borderRadius: sz(16), backgroundColor: '#1C1C1C', overflow: 'hidden', marginTop: sz(10) },
  action: { flexDirection: 'row', alignItems: 'center', gap: sz(12), minHeight: sz(54), paddingHorizontal: sz(14) },
  actionDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)' },
  actionHover: { backgroundColor: 'rgba(255,255,255,0.05)' },
  actionPressed: { backgroundColor: 'rgba(255,255,255,0.09)' },
  iconWrap: {
    width: sz(32), height: sz(32), borderRadius: sz(10), backgroundColor: 'rgba(255,255,255,0.07)',
    justifyContent: 'center', alignItems: 'center',
  },
  iconWrapDestructive: { backgroundColor: 'rgba(255,90,79,0.12)' },
  actionText: { flex: 1, fontSize: sz(16), fontWeight: '500' },
  detail: { color: '#8A8A8A', fontSize: sz(13) },
});
