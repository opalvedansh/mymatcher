import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { sz } from '@/theme/scale';
import { Sheet } from './Sheet';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export type AttachmentChoice = 'library' | 'camera' | 'document';

const OPTIONS: { key: AttachmentChoice; label: string; icon: IconName; color: string }[] = [
  { key: 'library', label: 'Photos & videos', icon: 'images', color: '#4C8DF6' },
  { key: 'camera', label: 'Camera', icon: 'camera', color: '#F4574B' },
  { key: 'document', label: 'Document', icon: 'document-text', color: '#8E6CF0' },
];

export function AttachmentSheet({
  visible,
  onClose,
  onChoose,
  available,
}: {
  visible: boolean;
  onClose: () => void;
  onChoose: (choice: AttachmentChoice) => void;
  /** Hides options this build cannot do (e.g. documents before an app update). */
  available: Record<AttachmentChoice, boolean>;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Send">
      <View style={styles.grid}>
        {OPTIONS.filter((o) => available[o.key]).map((o) => (
          <Pressable
            key={o.key}
            onPress={() => {
              onClose();
              // Browsers only open a file picker inside the click itself. iOS
              // will not present one over a modal still on screen, so there
              // it waits for the sheet to go.
              if (Platform.OS === 'web') onChoose(o.key);
              else setTimeout(() => onChoose(o.key), 350);
            }}
            style={({ pressed }) => [styles.option, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel={o.label}
          >
            <View style={[styles.icon, { backgroundColor: o.color }]}>
              <Ionicons name={o.icon} size={sz(24)} color="#FFF" />
            </View>
            <Text style={styles.label}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: sz(8) },
  option: { alignItems: 'center', width: sz(100), gap: sz(8) },
  icon: { width: sz(58), height: sz(58), borderRadius: sz(29), justifyContent: 'center', alignItems: 'center' },
  label: { color: '#E0E0E0', fontSize: sz(13), textAlign: 'center' },
});
