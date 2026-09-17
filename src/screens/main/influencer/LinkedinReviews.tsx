import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { FontAwesome6, Ionicons } from '@expo/vector-icons';
import type { LinkedinReview } from '@/api/types';
import { ApiError } from '@/api/client';
import { showAlert } from '@/components/ActionSheet';

const ACCENT = '#FF6B2B';
const LINKEDIN_BLUE = '#0A66C2';
const DANGER = '#FF6B6B';
const PLACEHOLDER = '#8A8A8A';
const MAX_REVIEWS = 10;
const QUOTE_MIN = 10;
const QUOTE_MAX = 600;
// Mirrors the server check in profileController.cleanLinkedinReviews.
const LINKEDIN_URL = /^https:\/\/([a-z0-9-]+\.)*(linkedin\.com|lnkd\.in)(\/|$)/i;

// react-native-web passes hover/focus to Pressable style callbacks; native typings only declare `pressed`.
type InteractionState = { pressed: boolean; hovered?: boolean; focused?: boolean };

// The focused box draws its own border, so drop the browser's default outline.
const webNoOutline = Platform.select({ web: { outlineStyle: 'none' } as any, default: undefined });

type Draft = { quote: string; name: string; title: string; url: string };
type DraftErrors = Partial<Record<keyof Draft, string>>;

const emptyDraft: Draft = { quote: '', name: '', title: '', url: '' };

function normalizeUrl(raw: string) {
  const url = raw.trim();
  if (!url) return url;
  return /^https?:\/\//i.test(url) ? url.replace(/^http:\/\//i, 'https://') : `https://${url}`;
}

function validate(draft: Draft): DraftErrors {
  const errors: DraftErrors = {};
  const quote = draft.quote.trim();
  if (quote.length < QUOTE_MIN) errors.quote = `Add at least ${QUOTE_MIN} characters.`;
  else if (quote.length > QUOTE_MAX) errors.quote = `Keep it under ${QUOTE_MAX} characters.`;
  if (!draft.name.trim()) errors.name = 'Add the name of the person who wrote it.';
  if (!LINKEDIN_URL.test(normalizeUrl(draft.url))) {
    errors.url = 'Paste a linkedin.com link to the recommendation or the reviewer’s profile.';
  }
  return errors;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0].toUpperCase())
    .join('');
}

function ReviewCard({
  review,
  width,
  editable,
  onEdit,
}: {
  review: LinkedinReview;
  width: number;
  editable: boolean;
  onEdit: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = review.quote.length > 220;

  return (
    <View style={[styles.card, { width }]}>
      <View style={styles.cardTop}>
        <View style={styles.linkedinMark}>
          <FontAwesome6 name="linkedin" size={20} color={LINKEDIN_BLUE} />
        </View>
        {editable && (
          <Pressable
            onPress={onEdit}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`Edit review from ${review.reviewer_name}`}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Ionicons name="pencil" size={14} color="#BDBDBD" />
          </Pressable>
        )}
      </View>

      <Text style={styles.quote} numberOfLines={expanded ? undefined : 6}>
        “{review.quote}”
      </Text>
      {isLong && (
        <Pressable onPress={() => setExpanded(v => !v)} hitSlop={6} accessibilityRole="button">
          <Text style={styles.readMore}>{expanded ? 'Show less' : 'Read more'}</Text>
        </Pressable>
      )}

      <View style={styles.reviewerRow}>
        <View style={styles.initials}>
          <Text style={styles.initialsText}>{initials(review.reviewer_name)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.reviewerName} numberOfLines={1}>{review.reviewer_name}</Text>
          {!!review.reviewer_title && (
            <Text style={styles.reviewerTitle} numberOfLines={2}>{review.reviewer_title}</Text>
          )}
        </View>
      </View>

      <Pressable
        onPress={() => Linking.openURL(review.linkedin_url).catch(() => {})}
        accessibilityRole="link"
        style={({ pressed }) => [styles.viewLink, pressed && styles.pressed]}
      >
        <Text style={styles.viewLinkText}>View on LinkedIn</Text>
        <Ionicons name="open-outline" size={14} color="#BDBDBD" />
      </Pressable>
    </View>
  );
}

export function LinkedinReviews({
  reviews,
  editable,
  ownerName,
  onSave,
}: {
  reviews: LinkedinReview[];
  editable: boolean;
  ownerName: string;
  /** Persists the full list; should throw on failure. */
  onSave: (next: LinkedinReview[]) => Promise<void>;
}) {
  const { width } = useWindowDimensions();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [focusedField, setFocusedField] = useState<keyof Draft | null>(null);
  const sheetAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isFormOpen) return;
    sheetAnim.setValue(0);
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then(reduce => {
        Animated.spring(sheetAnim, {
          toValue: 1,
          useNativeDriver: Platform.OS !== 'web',
          ...(reduce ? { overshootClamping: true, speed: 1000 } : { damping: 24, stiffness: 220 }),
        }).start();
      });
  }, [isFormOpen, sheetAnim]);

  if (!editable && reviews.length === 0) return null;

  const sheetTranslate = sheetAnim.interpolate({ inputRange: [0, 1], outputRange: [60, 0] });
  const quoteLength = draft.quote.trim().length;
  const counterColor = quoteLength > QUOTE_MAX ? DANGER : quoteLength > QUOTE_MAX - 60 ? '#FFB27A' : '#8A8A8A';
  const canSubmit = quoteLength > 0 && !!draft.name.trim() && !!draft.url.trim();

  const contentWidth = Math.min(width, 560) - 40; // profile content has 20px side padding
  const cardWidth = reviews.length > 1 ? Math.min(contentWidth - 28, 340) : contentWidth;
  const firstName = ownerName.split(' ')[0] || 'the creator';

  const openForm = (review?: LinkedinReview) => {
    setEditingId(review?.id ?? null);
    setDraft(
      review
        ? { quote: review.quote, name: review.reviewer_name, title: review.reviewer_title || '', url: review.linkedin_url }
        : emptyDraft,
    );
    setErrors({});
    setSubmitError(null);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    if (!saving) setIsFormOpen(false);
  };

  const persist = async (next: LinkedinReview[]) => {
    setSaving(true);
    setSubmitError(null);
    try {
      await onSave(next);
      setIsFormOpen(false);
    } catch (e) {
      setSubmitError(
        e instanceof ApiError && e.status === 400 ? e.message : 'Could not save. Check your connection and try again.',
      );
    } finally {
      setSaving(false);
    }
  };

  const submit = () => {
    const found = validate(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const entry: LinkedinReview = {
      id: editingId || `rev-${Date.now().toString(36)}`,
      quote: draft.quote.trim(),
      reviewer_name: draft.name.trim(),
      reviewer_title: draft.title.trim() || null,
      linkedin_url: normalizeUrl(draft.url),
      added_at: reviews.find(r => r.id === editingId)?.added_at || new Date().toISOString(),
    };
    persist(editingId ? reviews.map(r => (r.id === editingId ? entry : r)) : [entry, ...reviews]);
  };

  const confirmDelete = () => {
    const target = reviews.find(r => r.id === editingId);
    if (!target) return;
    showAlert('Remove this review?', `The review from ${target.reviewer_name} will no longer show on your profile.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => persist(reviews.filter(r => r.id !== editingId)) },
    ]);
  };

  const setField = (key: keyof Draft) => (value: string) => {
    setDraft(prev => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors(prev => ({ ...prev, [key]: undefined }));
  };

  return (
    <View style={styles.section}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>LinkedIn reviews</Text>
          {reviews.length > 0 && (
            <Text style={styles.subtitle}>
              {editable ? 'Added by you, each linked to LinkedIn' : `Added by ${firstName}, each linked to LinkedIn`}
            </Text>
          )}
        </View>
        {editable && reviews.length > 0 && reviews.length < MAX_REVIEWS && (
          <Pressable
            onPress={() => openForm()}
            accessibilityRole="button"
            style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
          >
            <Ionicons name="add" size={16} color="#FFF" />
            <Text style={styles.addButtonText}>Add</Text>
          </Pressable>
        )}
      </View>

      {reviews.length === 0 ? (
        <Pressable
          onPress={() => openForm()}
          accessibilityRole="button"
          style={({ pressed }) => [styles.emptyCard, pressed && styles.pressed]}
        >
          <View style={styles.linkedinMark}>
            <FontAwesome6 name="linkedin" size={20} color={LINKEDIN_BLUE} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.emptyTitle}>Add a LinkedIn review</Text>
            <Text style={styles.emptyBody}>Show brands what past clients said, with a link to the original.</Text>
          </View>
          <Ionicons name="add-circle" size={26} color={ACCENT} />
        </Pressable>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={cardWidth + 12}
          decelerationRate="fast"
          contentContainerStyle={{ gap: 12 }}
          scrollEnabled={reviews.length > 1}
        >
          {reviews.map(review => (
            <ReviewCard
              key={review.id}
              review={review}
              width={cardWidth}
              editable={editable}
              onEdit={() => openForm(review)}
            />
          ))}
        </ScrollView>
      )}

      <Modal visible={isFormOpen} transparent animationType="fade" onRequestClose={closeForm}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={closeForm} accessibilityLabel="Close form" />
            <Animated.View style={[styles.sheet, { opacity: sheetAnim, transform: [{ translateY: sheetTranslate }] }]}>
              <View style={styles.grabber} />

              <View style={styles.sheetHeader}>
                <View style={styles.headerMark}>
                  <FontAwesome6 name="linkedin" size={22} color={LINKEDIN_BLUE} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sheetTitle} accessibilityRole="header">
                    {editingId ? 'Edit review' : 'Add LinkedIn review'}
                  </Text>
                  <Text style={styles.sheetSubtitle}>
                    Copy a recommendation from your LinkedIn profile. Brands can open the link to check it.
                  </Text>
                </View>
                <Pressable
                  onPress={closeForm}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  style={(state) => {
                    const { pressed, focused, hovered } = state as InteractionState;
                    return [styles.closeButton, (hovered || focused) && styles.closeButtonActive, pressed && styles.pressed];
                  }}
                >
                  <Ionicons name="close" size={20} color="#FFF" />
                </Pressable>
              </View>

              <ScrollView
                style={styles.sheetBody}
                contentContainerStyle={styles.sheetBodyContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <Text style={styles.groupLabel}>Recommendation</Text>
                <View
                  style={[
                    styles.textareaBox,
                    focusedField === 'quote' && styles.boxFocused,
                    errors.quote && styles.boxError,
                  ]}
                >
                  <TextInput
                    style={[styles.textarea, webNoOutline]}
                    value={draft.quote}
                    onChangeText={setField('quote')}
                    onFocus={() => setFocusedField('quote')}
                    onBlur={() => setFocusedField(null)}
                    placeholder="What they wrote about working with you"
                    placeholderTextColor={PLACEHOLDER}
                    multiline
                    maxLength={QUOTE_MAX + 50}
                    textAlignVertical="top"
                    accessibilityLabel="Recommendation"
                  />
                  <Text style={[styles.counter, { color: counterColor }]}>
                    {quoteLength}/{QUOTE_MAX}
                  </Text>
                </View>
                {errors.quote ? (
                  <Text style={styles.fieldError}>{errors.quote}</Text>
                ) : (
                  <Text style={styles.fieldHelp}>Paste it exactly as it appears on LinkedIn.</Text>
                )}

                <Text style={[styles.groupLabel, { marginTop: 24 }]}>Reviewer</Text>
                <View style={styles.group}>
                  <FieldRow
                    icon="person-outline"
                    label="Name"
                    focused={focusedField === 'name'}
                    error={errors.name}
                  >
                    <TextInput
                      style={[styles.rowInput, webNoOutline]}
                      value={draft.name}
                      onChangeText={setField('name')}
                      onFocus={() => setFocusedField('name')}
                      onBlur={() => setFocusedField(null)}
                      placeholder="e.g. Riya Menon"
                      placeholderTextColor={PLACEHOLDER}
                      maxLength={80}
                      autoCapitalize="words"
                      accessibilityLabel="Reviewer name"
                    />
                  </FieldRow>
                  <FieldRow
                    icon="briefcase-outline"
                    label="Role and company"
                    optional
                    focused={focusedField === 'title'}
                    error={errors.title}
                  >
                    <TextInput
                      style={[styles.rowInput, webNoOutline]}
                      value={draft.title}
                      onChangeText={setField('title')}
                      onFocus={() => setFocusedField('title')}
                      onBlur={() => setFocusedField(null)}
                      placeholder="e.g. Brand Manager at Mamaearth"
                      placeholderTextColor={PLACEHOLDER}
                      maxLength={100}
                      accessibilityLabel="Reviewer role and company"
                    />
                  </FieldRow>
                  <FieldRow
                    icon="link-outline"
                    label="LinkedIn link"
                    focused={focusedField === 'url'}
                    error={errors.url}
                    last
                  >
                    <TextInput
                      style={[styles.rowInput, webNoOutline]}
                      value={draft.url}
                      onChangeText={setField('url')}
                      onFocus={() => setFocusedField('url')}
                      onBlur={() => setFocusedField(null)}
                      placeholder="linkedin.com/in/..."
                      placeholderTextColor={PLACEHOLDER}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      accessibilityLabel="LinkedIn link"
                    />
                  </FieldRow>
                </View>
              </ScrollView>

              <View style={styles.sheetFooter}>
                {submitError && <Text style={[styles.fieldError, { marginBottom: 12 }]}>{submitError}</Text>}
                <View style={styles.footerRow}>
                  {editingId && (
                    <Pressable
                      onPress={confirmDelete}
                      disabled={saving}
                      accessibilityRole="button"
                      style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
                    >
                      <Ionicons name="trash-outline" size={18} color={DANGER} />
                      <Text style={styles.removeButtonText}>Remove</Text>
                    </Pressable>
                  )}
                  <Pressable
                    onPress={submit}
                    disabled={saving || !canSubmit}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: saving || !canSubmit }}
                    style={({ pressed }) => [
                      styles.saveButton,
                      !canSubmit && styles.saveButtonDisabled,
                      pressed && styles.pressed,
                    ]}
                  >
                    {saving ? (
                      <ActivityIndicator color="#FFF" />
                    ) : (
                      <Text style={styles.saveButtonText}>{editingId ? 'Save changes' : 'Save review'}</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            </Animated.View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function FieldRow({
  icon,
  label,
  optional,
  focused,
  error,
  last,
  children,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  optional?: boolean;
  focused: boolean;
  error?: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.row, !last && styles.rowDivider, focused && styles.rowFocused]}>
      <Ionicons
        name={icon}
        size={18}
        color={error ? DANGER : focused ? ACCENT : '#8A8A8A'}
        style={styles.rowIcon}
      />
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, focused && { color: ACCENT }, !!error && { color: DANGER }]}>
          {label}
          {optional && <Text style={styles.rowOptional}>  Optional</Text>}
        </Text>
        {children}
        {!!error && <Text style={[styles.fieldError, { marginTop: 4 }]}>{error}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 12, marginBottom: 28 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 24, fontWeight: '700', color: '#FFF' },
  subtitle: { fontSize: 12, color: '#9A9A9A', marginTop: 4 },
  addButton: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', borderRadius: 12,
    paddingVertical: 7, paddingHorizontal: 12,
  },
  addButtonText: { color: '#FFF', fontSize: 13, fontWeight: '600' },
  card: {
    backgroundColor: '#050505',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 16,
    padding: 20,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  linkedinMark: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: '#FFF',
    justifyContent: 'center', alignItems: 'center',
  },
  iconButton: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center', alignItems: 'center',
  },
  quote: { color: '#E6E6E6', fontSize: 15, lineHeight: 23 },
  readMore: { color: '#BDBDBD', fontSize: 13, fontWeight: '600', marginTop: 6 },
  reviewerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20 },
  initials: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#262626',
    justifyContent: 'center', alignItems: 'center',
  },
  initialsText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  reviewerName: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  reviewerTitle: { color: '#9A9A9A', fontSize: 12, marginTop: 2 },
  viewLink: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    marginTop: 16, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.12)', width: '100%',
  },
  viewLinkText: { color: '#BDBDBD', fontSize: 13, fontWeight: '600' },
  emptyCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 16, padding: 16, backgroundColor: 'rgba(255,255,255,0.02)',
  },
  emptyTitle: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  emptyBody: { color: '#9A9A9A', fontSize: 12, lineHeight: 17, marginTop: 3 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end', alignItems: 'center' },
  sheet: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '94%',
    backgroundColor: '#141414',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  grabber: {
    alignSelf: 'center', width: 36, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)', marginTop: 10,
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 14,
    paddingHorizontal: 24, paddingTop: 18, paddingBottom: 18,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  headerMark: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: '#FFF',
    justifyContent: 'center', alignItems: 'center',
  },
  sheetTitle: { fontSize: 19, fontWeight: '700', color: '#FFF', letterSpacing: -0.3 },
  sheetSubtitle: { fontSize: 13, color: '#9A9A9A', lineHeight: 19, marginTop: 4 },
  closeButton: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center', alignItems: 'center',
    ...Platform.select({ web: { outlineStyle: 'none' } as any, default: {} }),
  },
  closeButtonActive: { backgroundColor: 'rgba(255,255,255,0.16)' },
  sheetBody: { flexGrow: 0 },
  sheetBodyContent: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 8 },
  groupLabel: { color: '#E6E6E6', fontSize: 13, fontWeight: '600', marginBottom: 10 },
  textareaBox: {
    backgroundColor: '#1C1C1C', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10,
  },
  boxFocused: { borderColor: ACCENT, backgroundColor: '#1F1F1F' },
  boxError: { borderColor: DANGER },
  textarea: { color: '#FFF', fontSize: 15, lineHeight: 22, minHeight: 112, padding: 0 },
  counter: { alignSelf: 'flex-end', fontSize: 12, marginTop: 6, fontVariant: ['tabular-nums'] },
  fieldHelp: { color: '#8A8A8A', fontSize: 12, lineHeight: 17, marginTop: 8 },
  fieldError: { color: DANGER, fontSize: 12, lineHeight: 17, marginTop: 8 },
  group: {
    backgroundColor: '#1C1C1C', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingVertical: 12 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)' },
  rowFocused: { backgroundColor: 'rgba(255,107,43,0.06)' },
  rowIcon: { marginTop: 2, marginRight: 12, width: 20 },
  rowLabel: { color: '#9A9A9A', fontSize: 12, fontWeight: '500', marginBottom: 4 },
  rowOptional: { color: '#6F6F6F', fontWeight: '400' },
  rowInput: { color: '#FFF', fontSize: 15, paddingVertical: 2, paddingHorizontal: 0 },
  sheetFooter: {
    paddingHorizontal: 24, paddingTop: 14, paddingBottom: 28,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#141414',
  },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  saveButton: {
    flex: 1, height: 52, borderRadius: 14, backgroundColor: ACCENT,
    justifyContent: 'center', alignItems: 'center',
  },
  saveButtonDisabled: { opacity: 0.45 },
  saveButtonText: { color: '#FFF', fontSize: 16, fontWeight: '700', letterSpacing: 0.1 },
  removeButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6, height: 52, paddingHorizontal: 16,
    borderRadius: 14, backgroundColor: 'rgba(255,107,107,0.1)',
  },
  removeButtonText: { color: DANGER, fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
});
