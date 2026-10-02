import { useRef, useState, type RefObject } from 'react';
import { AntDesign } from '@expo/vector-icons';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { PackageIcon } from '@/components/PackageIcons';
import { colors } from '@/theme/colors';
import { sz } from '@/theme/scale';
import { tapFeedback } from '@/utils/optionalModules';
import { PACKAGE_OPTIONS, type PackageDraft, type PackageType } from '@/utils/packages';

/**
 * Pick packages and type a price for each. Tapping a card selects it and
 * opens its price field; tapping again removes it.
 *
 * Render it directly inside `scrollRef`'s content: the focused price field is
 * scrolled into view once the keyboard is up, using this view's offset there.
 */
export function PackagePriceEditor({
  drafts,
  onChange,
  showErrors,
  scrollRef,
}: {
  drafts: PackageDraft[];
  onChange: (next: PackageDraft[]) => void;
  /** Mark picked packages that still have no price. */
  showErrors?: boolean;
  scrollRef?: RefObject<ScrollView | null>;
}) {
  // Only a card the user just picked grabs focus, not ones restored on open.
  const [justPicked, setJustPicked] = useState<PackageType | null>(null);
  const editorY = useRef(0);
  const cardY = useRef<Partial<Record<PackageType, number>>>({});

  const toggle = (type: PackageType) => {
    tapFeedback('selection');
    if (drafts.some((d) => d.type === type)) {
      onChange(drafts.filter((d) => d.type !== type));
      if (justPicked === type) setJustPicked(null);
    } else {
      // Keep the list in display order so the saved packages read the same way.
      const next = [...drafts, { type, price: null }];
      onChange(PACKAGE_OPTIONS.flatMap((o) => next.filter((d) => d.type === o.type)));
      setJustPicked(type);
    }
  };

  const setPrice = (type: PackageType, text: string) => {
    const digits = text.replace(/\D/g, '').replace(/^0+/, '').slice(0, 8);
    onChange(drafts.map((d) => (d.type === type ? { ...d, price: digits ? Number(digits) : null } : d)));
  };

  const scrollToCard = (type: PackageType) => {
    const scroll = scrollRef?.current;
    if (!scroll) return;
    const y = Math.max(0, editorY.current + (cardY.current[type] ?? 0) - sz(12));
    const go = () => scroll.scrollTo({ y, animated: true });
    // The keyboard shrinks the visible area; scroll once it has.
    if (Keyboard.isVisible()) return go();
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      sub.remove();
      go();
    });
    setTimeout(() => sub.remove(), 1000);
  };

  return (
    <View style={styles.list} onLayout={(e) => { editorY.current = e.nativeEvent.layout.y; }}>
      {PACKAGE_OPTIONS.map((option) => {
        const draft = drafts.find((d) => d.type === option.type);
        const selected = !!draft;
        const missingPrice = selected && showErrors && draft.price == null;

        return (
          <View
            key={option.type}
            onLayout={(e) => { cardY.current[option.type] = e.nativeEvent.layout.y; }}
            style={[styles.card, selected && styles.cardSelected, missingPrice && styles.cardError]}
          >
            <Pressable
              onPress={() => toggle(option.type)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={option.name}
              style={({ pressed }) => [styles.cardHeader, pressed && styles.pressed]}
            >
              <View style={styles.icon}>
                <PackageIcon type={option.type} size={sz(24)} color={selected ? colors.primary : '#FFF'} />
              </View>
              <View style={styles.details}>
                <Text style={[styles.name, selected && styles.nameSelected]}>{option.name}</Text>
                <Text style={styles.desc}>{option.desc}</Text>
              </View>
              <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
                {selected && <AntDesign name="check" size={sz(14)} color="#000000" />}
              </View>
            </Pressable>

            {selected && (
              <>
                <View style={[styles.priceRow, missingPrice && styles.priceRowError]}>
                  <Text style={styles.rupee}>₹</Text>
                  <TextInput
                    style={styles.priceInput}
                    value={draft.price == null ? '' : String(draft.price)}
                    onChangeText={(text) => setPrice(option.type, text)}
                    onFocus={() => scrollToCard(option.type)}
                    placeholder="Your price"
                    placeholderTextColor="#555555"
                    keyboardType="number-pad"
                    returnKeyType="done"
                    maxLength={8}
                    autoFocus={justPicked === option.type}
                    selectionColor={colors.primary}
                    accessibilityLabel={`${option.name} price in rupees`}
                  />
                </View>
                {missingPrice && <Text style={styles.error}>Add your price for this package.</Text>}
              </>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: sz(14) },
  card: {
    borderRadius: sz(16),
    borderWidth: 1.5,
    borderColor: '#262626',
    backgroundColor: '#0A0A0A',
    overflow: 'hidden',
  },
  cardSelected: { borderColor: colors.primary, backgroundColor: 'rgba(240, 90, 40, 0.05)' },
  cardError: { borderColor: '#FF6B6B' },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: sz(16),
    paddingHorizontal: sz(16),
    gap: sz(14),
  },
  icon: { width: sz(32), alignItems: 'center' },
  details: { flex: 1 },
  name: { color: '#E0E0E0', fontSize: sz(16), fontWeight: '600', marginBottom: sz(4) },
  nameSelected: { color: colors.primary },
  desc: { color: '#8A8A8A', fontSize: sz(12), lineHeight: sz(16) },
  checkbox: {
    width: sz(24),
    height: sz(24),
    borderRadius: sz(12),
    borderWidth: 1.5,
    borderColor: '#444444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: sz(16),
    marginBottom: sz(16),
    paddingHorizontal: sz(14),
    height: sz(50),
    borderRadius: sz(12),
    borderWidth: 1,
    borderColor: '#333333',
    backgroundColor: '#000000',
  },
  priceRowError: { borderColor: '#FF6B6B' },
  rupee: { color: colors.text, fontSize: sz(18), fontWeight: '700', marginRight: sz(8) },
  priceInput: { flex: 1, color: colors.text, fontSize: sz(17), fontWeight: '600', paddingVertical: 0 },
  error: { color: '#FF6B6B', fontSize: sz(12), marginTop: sz(-8), marginBottom: sz(14), marginHorizontal: sz(16) },
  pressed: { opacity: 0.8 },
});
