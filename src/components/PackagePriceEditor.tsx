import { useRef, useState, type RefObject } from 'react';
import { AntDesign, Ionicons } from '@expo/vector-icons';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { PackageIcon } from '@/components/PackageIcons';
import { colors } from '@/theme/colors';
import { sz } from '@/theme/scale';
import { tapFeedback } from '@/utils/optionalModules';
import {
  CUSTOM_DESC_MAX,
  CUSTOM_NAME_MAX,
  MAX_CUSTOM_PACKAGES,
  PACKAGE_OPTIONS,
  draftId,
  draftProblem,
  isCustomDraft,
  newCustomDraft,
  orderDrafts,
  type CustomDraft,
  type PackageDraft,
  type PackageType,
} from '@/utils/packages';

/**
 * Pick packages and type a price for each. Tapping a preset card selects it
 * and opens its price field; tapping again removes it. Below the presets the
 * creator can add packages of their own, each with a name and price.
 *
 * Render it directly inside `scrollRef`'s content: the focused field's card is
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
  /** Mark picked packages that still have no price (or, if custom, no name). */
  showErrors?: boolean;
  scrollRef?: RefObject<ScrollView | null>;
}) {
  // Only a card the user just picked or added grabs focus, not ones restored on open.
  const [justPicked, setJustPicked] = useState<string | null>(null);
  const editorY = useRef(0);
  const cardY = useRef<Record<string, number>>({});
  const customs = drafts.filter(isCustomDraft);

  const toggle = (type: PackageType) => {
    tapFeedback('selection');
    if (drafts.some((d) => d.type === type)) {
      onChange(drafts.filter((d) => d.type !== type));
      if (justPicked === type) setJustPicked(null);
    } else {
      // Keep the list in display order so the saved packages read the same way.
      onChange(orderDrafts([...drafts, { type, price: null }]));
      setJustPicked(type);
    }
  };

  const addCustom = () => {
    if (customs.length >= MAX_CUSTOM_PACKAGES) return;
    tapFeedback('selection');
    const draft = newCustomDraft();
    onChange([...drafts, draft]);
    setJustPicked(draft.key);
  };

  const removeCustom = (key: string) => {
    tapFeedback('selection');
    onChange(drafts.filter((d) => draftId(d) !== key));
    if (justPicked === key) setJustPicked(null);
  };

  const update = (id: string, patch: Partial<CustomDraft>) =>
    onChange(drafts.map((d) => (draftId(d) === id ? ({ ...d, ...patch } as PackageDraft) : d)));

  const setPrice = (id: string, text: string) => {
    const digits = text.replace(/\D/g, '').replace(/^0+/, '').slice(0, 8);
    update(id, { price: digits ? Number(digits) : null });
  };

  const scrollToCard = (id: string) => {
    const scroll = scrollRef?.current;
    if (!scroll) return;
    const y = Math.max(0, editorY.current + (cardY.current[id] ?? 0) - sz(12));
    const go = () => scroll.scrollTo({ y, animated: true });
    // The keyboard shrinks the visible area; scroll once it has.
    if (Keyboard.isVisible()) return go();
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      sub.remove();
      go();
    });
    setTimeout(() => sub.remove(), 1000);
  };

  const priceField = (draft: PackageDraft, label: string, missing: boolean, autoFocus: boolean) => (
    <>
      <View style={[styles.field, missing && styles.fieldError]}>
        <Text style={styles.rupee}>₹</Text>
        <TextInput
          style={styles.input}
          value={draft.price == null ? '' : String(draft.price)}
          onChangeText={(text) => setPrice(draftId(draft), text)}
          onFocus={() => scrollToCard(draftId(draft))}
          placeholder="Your price"
          placeholderTextColor="#555555"
          keyboardType="number-pad"
          returnKeyType="done"
          maxLength={8}
          autoFocus={autoFocus}
          selectionColor={colors.primary}
          accessibilityLabel={`${label} price in rupees`}
        />
      </View>
      {missing && <Text style={styles.error}>Add your price for this package.</Text>}
    </>
  );

  return (
    <View style={styles.list} onLayout={(e) => { editorY.current = e.nativeEvent.layout.y; }}>
      {PACKAGE_OPTIONS.map((option) => {
        const draft = drafts.find((d) => d.type === option.type);
        const selected = !!draft;
        const missingPrice = selected && showErrors && draftProblem(draft) === 'price';

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

            {selected && priceField(draft, option.name, !!missingPrice, justPicked === option.type)}
          </View>
        );
      })}

      {customs.map((draft) => {
        const problem = showErrors ? draftProblem(draft) : null;
        const label = draft.name.trim() || 'Custom package';
        return (
          <View
            key={draft.key}
            onLayout={(e) => { cardY.current[draft.key] = e.nativeEvent.layout.y; }}
            style={[styles.card, styles.cardSelected, problem && styles.cardError]}
          >
            <View style={styles.customHeader}>
              <View style={styles.icon}>
                <PackageIcon type="custom" size={sz(24)} color={colors.primary} />
              </View>
              <Text style={[styles.name, styles.nameSelected, styles.customTitle]} numberOfLines={1}>
                {label}
              </Text>
              <Pressable
                onPress={() => removeCustom(draft.key)}
                hitSlop={sz(10)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${label}`}
                style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
              >
                <Ionicons name="close" size={sz(16)} color="#BDBDBD" />
              </Pressable>
            </View>

            <View style={[styles.field, problem === 'name' && styles.fieldError]}>
              <TextInput
                style={styles.input}
                value={draft.name}
                onChangeText={(name) => update(draft.key, { name })}
                onFocus={() => scrollToCard(draft.key)}
                placeholder="Package name, e.g. YouTube video"
                placeholderTextColor="#555555"
                maxLength={CUSTOM_NAME_MAX}
                autoCapitalize="words"
                autoFocus={justPicked === draft.key}
                selectionColor={colors.primary}
                accessibilityLabel="Package name"
              />
            </View>
            {problem === 'name' && <Text style={styles.error}>Name this package.</Text>}

            <View style={styles.field}>
              <TextInput
                style={styles.input}
                value={draft.desc}
                onChangeText={(desc) => update(draft.key, { desc })}
                onFocus={() => scrollToCard(draft.key)}
                placeholder="What's included (optional)"
                placeholderTextColor="#555555"
                maxLength={CUSTOM_DESC_MAX}
                selectionColor={colors.primary}
                accessibilityLabel="What's included"
              />
            </View>

            {priceField(draft, label, problem === 'price', false)}
          </View>
        );
      })}

      {customs.length < MAX_CUSTOM_PACKAGES ? (
        <Pressable
          onPress={addCustom}
          accessibilityRole="button"
          style={({ pressed }) => [styles.card, styles.addCard, pressed && styles.pressed]}
        >
          <View style={styles.icon}>
            <Ionicons name="add-circle" size={sz(26)} color={colors.primary} />
          </View>
          <View style={styles.details}>
            <Text style={styles.name}>Add a custom package</Text>
            <Text style={styles.desc}>Offer something else at your own price</Text>
          </View>
        </Pressable>
      ) : (
        <Text style={styles.limit}>You can add up to {MAX_CUSTOM_PACKAGES} custom packages.</Text>
      )}
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
  customHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: sz(16),
    paddingBottom: sz(12),
    paddingHorizontal: sz(16),
    gap: sz(14),
  },
  customTitle: { flex: 1, marginBottom: 0 },
  removeButton: {
    width: sz(28),
    height: sz(28),
    borderRadius: sz(14),
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: sz(16),
    paddingHorizontal: sz(16),
    gap: sz(14),
    borderStyle: 'dashed',
    borderColor: '#3A3A3A',
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
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: sz(16),
    marginBottom: sz(12),
    paddingHorizontal: sz(14),
    height: sz(50),
    borderRadius: sz(12),
    borderWidth: 1,
    borderColor: '#333333',
    backgroundColor: '#000000',
  },
  fieldError: { borderColor: '#FF6B6B' },
  rupee: { color: colors.text, fontSize: sz(18), fontWeight: '700', marginRight: sz(8) },
  input: { flex: 1, color: colors.text, fontSize: sz(16), fontWeight: '600', paddingVertical: 0 },
  error: { color: '#FF6B6B', fontSize: sz(12), marginTop: sz(-6), marginBottom: sz(12), marginHorizontal: sz(16) },
  limit: { color: '#8A8A8A', fontSize: sz(12), textAlign: 'center' },
  pressed: { opacity: 0.8 },
});
