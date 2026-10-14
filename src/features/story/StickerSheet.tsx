import React from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sz } from '@/theme/scale';

const EMOJI = (
  '😀 😂 🥹 😍 🥰 😘 😎 🤩 🥳 😇 🤔 🤫 😴 🥲 😭 😡 🤯 🥶 🤗 🙃 ' +
  '👍 👎 👏 🙌 🙏 💪 👀 ✌️ 🤞 👋 🫶 🤝 💅 🔥 ✨ 💯 ⚡ 🌟 ⭐ 💥 ' +
  '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💖 💘 💌 🎉 🎊 🎁 🎈 🏆 🥇 🎯 🚀 ' +
  '📸 🎥 🎬 🎤 🎧 🎵 📱 💻 💡 📈 💰 💸 🛍️ 👗 👟 💄 👜 🕶️ 💍 ⌚ ' +
  '☕ 🍕 🍔 🍟 🍣 🍩 🍰 🍓 🥑 🍹 🌈 ☀️ 🌙 🌊 🌸 🌴 🏖️ ✈️ 🗺️ 📍'
).split(' ');

type Special = { key: string; label: string; onPress: () => void };

/** The sticker tray: time, date, mention, hashtag and location stickers, then emoji. */
export function StickerSheet({
  visible,
  onClose,
  onEmoji,
  onTime,
  onDate,
  onTextSticker,
}: {
  visible: boolean;
  onClose: () => void;
  onEmoji: (e: string) => void;
  onTime: () => void;
  onDate: () => void;
  /** Mention, hashtag and location open the text tool with this prefix. */
  onTextSticker: (prefix: string) => void;
}) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const specials: Special[] = [
    { key: 'time', label: clockNow(), onPress: onTime },
    { key: 'date', label: dateNow(), onPress: onDate },
    { key: 'mention', label: '@MENTION', onPress: () => onTextSticker('@') },
    { key: 'hashtag', label: '#HASHTAG', onPress: () => onTextSticker('#') },
    { key: 'location', label: '📍 LOCATION', onPress: () => onTextSticker('📍 ') },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close stickers" />
        <View style={[styles.sheet, { height: height * 0.62, paddingBottom: insets.bottom }]}>
          <View style={styles.handle} />
          <FlatList
            data={EMOJI}
            keyExtractor={(e, i) => `${e}${i}`}
            numColumns={6}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <View style={styles.specials}>
                {specials.map((s) => (
                  <Pressable
                    key={s.key}
                    onPress={s.onPress}
                    style={({ pressed }) => [styles.special, pressed && styles.pressed]}
                    accessibilityRole="button"
                  >
                    <Text style={styles.specialText}>{s.label}</Text>
                  </Pressable>
                ))}
              </View>
            }
            renderItem={({ item }) => (
              <Pressable
                onPress={() => onEmoji(item)}
                style={({ pressed }) => [styles.emojiCell, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={item}
              >
                <Text style={styles.emoji}>{item}</Text>
              </Pressable>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function clockNow() {
  const d = new Date();
  const h = d.getHours() % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}

export function dateNow() {
  const d = new Date();
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    backgroundColor: 'rgba(28,28,28,0.98)',
    borderTopLeftRadius: sz(18),
    borderTopRightRadius: sz(18),
    paddingHorizontal: sz(12),
  },
  handle: {
    alignSelf: 'center',
    width: sz(40),
    height: sz(4),
    borderRadius: sz(2),
    backgroundColor: 'rgba(255,255,255,0.3)',
    marginTop: sz(10),
    marginBottom: sz(14),
  },
  specials: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: sz(10),
    paddingHorizontal: sz(4),
    paddingBottom: sz(16),
  },
  special: {
    backgroundColor: '#FFF',
    borderRadius: sz(10),
    paddingHorizontal: sz(12),
    paddingVertical: sz(9),
  },
  specialText: {
    color: '#FF6B2B',
    fontSize: sz(15),
    fontWeight: '800',
  },
  emojiCell: {
    flex: 1 / 6,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: sz(34),
  },
  pressed: {
    opacity: 0.6,
  },
});
