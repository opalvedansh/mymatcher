import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
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
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { getCreatorReviews, removeCreatorReview, reviewCreator } from '@/api';
import type { CreatorReview, CreatorReviews as ReviewsData } from '@/api/types';
import { ApiError } from '@/api/client';
import { showAlert } from '@/components/ActionSheet';
import { openSafetyMenu } from '@/components/safetyMenu';
import { useAuth } from '@/contexts/AuthContext';
import { sz } from '@/theme/scale';

const ACCENT = '#FF6B2B';
const DANGER = '#FF6B6B';
const PLACEHOLDER = '#8A8A8A';
const QUOTE_MIN = 10;
const QUOTE_MAX = 600;

// react-native-web passes hover/focus to Pressable style callbacks; native typings only declare `pressed`.
type InteractionState = { pressed: boolean; hovered?: boolean; focused?: boolean };

// The focused box draws its own border, so drop the browser's default outline.
const webNoOutline = Platform.select({ web: { outlineStyle: 'none' } as any, default: undefined });

type Draft = { quote: string; name: string; title: string };
type DraftErrors = Partial<Record<keyof Draft, string>>;

const emptyDraft: Draft = { quote: '', name: '', title: '' };

function validate(draft: Draft): DraftErrors {
  const errors: DraftErrors = {};
  const quote = draft.quote.trim();
  if (quote.length < QUOTE_MIN) errors.quote = `Add at least ${QUOTE_MIN} characters.`;
  else if (quote.length > QUOTE_MAX) errors.quote = `Keep it under ${QUOTE_MAX} characters.`;
  if (!draft.name.trim()) errors.name = 'Add your name.';
  return errors;
}

// A 422 lists its reasons in `detail`; a 403 says why in `message`.
function saveErrorMessage(e: unknown) {
  if (e instanceof ApiError) {
    const reasons = e.detail as unknown;
    if (e.status === 422 && Array.isArray(reasons) && reasons[0]?.message) return String(reasons[0].message);
    if (e.status === 403 || e.status === 400) return e.message;
  }
  return 'Could not save. Check your connection and try again.';
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
  mine,
  onEdit,
  onMore,
}: {
  review: CreatorReview;
  width: number;
  /** Written by the brand viewing it, which can edit it. */
  mine: boolean;
  onEdit: () => void;
  onMore: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = review.quote.length > 220;
  const brandName = review.brand_name || 'a brand';

  return (
    <View style={[styles.card, { width }]}>
      <View style={styles.cardTop}>
        <View style={styles.reviewMark}>
          <Ionicons name="chatbubble-ellipses" size={sz(18)} color={ACCENT} />
        </View>
        <Pressable
          onPress={mine ? onEdit : onMore}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={mine ? 'Edit your review' : `Report or block ${brandName}`}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <Ionicons name={mine ? 'pencil' : 'ellipsis-horizontal'} size={sz(14)} color="#BDBDBD" />
        </Pressable>
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

      <View style={styles.brandRow}>
        <Text style={styles.brandText} numberOfLines={1}>Matched brand · {review.brand_name || 'Brand'}</Text>
        {review.brand_verified && (
          <MaterialCommunityIcons name="check-decagram" size={sz(13)} color={ACCENT} accessibilityLabel="Verified brand" />
        )}
      </View>
    </View>
  );
}

/**
 * Reviews of a creator. Only a brand that has matched with the creator can
 * write one (one each, editable); the creator only reads them. Whether the
 * viewer may write one is the server's call (`can_review`).
 */
export function CreatorReviews({
  creatorId,
  creatorName,
  isOwnProfile,
}: {
  creatorId: string;
  creatorName: string;
  isOwnProfile: boolean;
}) {
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const [data, setData] = useState<ReviewsData | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [focusedField, setFocusedField] = useState<keyof Draft | null>(null);
  const sheetAnim = useRef(new Animated.Value(0)).current;

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      setData(await getCreatorReviews(creatorId));
    } catch (e) {
      console.warn('[API] getCreatorReviews failed:', e);
      setLoadFailed(true);
    }
  }, [creatorId]);

  useEffect(() => {
    load();
  }, [load]);

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

  // Until the reviews arrive (or if they can't), the section still shows on
  // the creator's own profile, and a failed load offers a retry to anyone,
  // rather than the section silently vanishing.
  if (!data) {
    if (!isOwnProfile && !loadFailed) return null;
    return (
      <View style={styles.section}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Reviews</Text>
        </View>
        {loadFailed ? (
          <Pressable
            onPress={load}
            accessibilityRole="button"
            style={({ pressed }) => [styles.emptyCard, pressed && styles.pressed]}
          >
            <View style={styles.reviewMark}>
              <Ionicons name="chatbubble-ellipses" size={sz(18)} color={ACCENT} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.emptyTitle}>Couldn't load reviews</Text>
              <Text style={styles.emptyBody}>Check your connection and tap to try again.</Text>
            </View>
            <Ionicons name="refresh" size={sz(22)} color="#BDBDBD" />
          </Pressable>
        ) : (
          <View style={[styles.emptyCard, { justifyContent: 'center' }]}>
            <ActivityIndicator color="#BDBDBD" />
          </View>
        )}
      </View>
    );
  }
  const { reviews, my_review: myReview, can_review: canReview } = data;
  if (!isOwnProfile && reviews.length === 0 && !canReview) return null;

  const sheetTranslate = sheetAnim.interpolate({ inputRange: [0, 1], outputRange: [60, 0] });
  const quoteLength = draft.quote.trim().length;
  const counterColor = quoteLength > QUOTE_MAX ? DANGER : quoteLength > QUOTE_MAX - 60 ? '#FFB27A' : '#8A8A8A';
  const canSubmit = quoteLength > 0 && !!draft.name.trim();

  const contentWidth = Math.min(width, 560) - sz(40); // profile content has 20px side padding
  const cardWidth = reviews.length > 1 ? Math.min(contentWidth - sz(28), sz(340)) : contentWidth;
  const firstName = creatorName.split(' ')[0] || 'this creator';

  const openForm = () => {
    setDraft(
      myReview
        ? { quote: myReview.quote, name: myReview.reviewer_name, title: myReview.reviewer_title || '' }
        : emptyDraft,
    );
    setErrors({});
    setSubmitError(null);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    if (!saving) setIsFormOpen(false);
  };

  const run = async (request: () => Promise<ReviewsData>) => {
    setSaving(true);
    setSubmitError(null);
    try {
      setData(await request());
      setIsFormOpen(false);
    } catch (e) {
      setSubmitError(saveErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const submit = () => {
    const found = validate(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    run(() => reviewCreator(creatorId, {
      quote: draft.quote.trim(),
      reviewer_name: draft.name.trim(),
      reviewer_title: draft.title.trim() || null,
    }));
  };

  const confirmDelete = () => {
    showAlert('Remove your review?', `It will no longer show on ${firstName}'s profile.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => run(() => removeCreatorReview(creatorId)) },
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
          <Text style={styles.title}>Reviews</Text>
          {(reviews.length > 0 || isOwnProfile) && (
            <Text style={styles.subtitle}>
              {isOwnProfile ? 'From brands you have matched with' : `From brands ${firstName} has matched with`}
            </Text>
          )}
        </View>
        {canReview && !myReview && reviews.length > 0 && (
          <Pressable
            onPress={openForm}
            accessibilityRole="button"
            style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
          >
            <Ionicons name="add" size={sz(16)} color="#FFF" />
            <Text style={styles.addButtonText}>Add</Text>
          </Pressable>
        )}
      </View>

      {reviews.length === 0 ? (
        canReview ? (
          <Pressable
            onPress={openForm}
            accessibilityRole="button"
            style={({ pressed }) => [styles.emptyCard, pressed && styles.pressed]}
          >
            <View style={styles.reviewMark}>
              <Ionicons name="chatbubble-ellipses" size={sz(18)} color={ACCENT} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.emptyTitle}>Write a review</Text>
              <Text style={styles.emptyBody}>You matched with {firstName}. Tell other brands how working with them went.</Text>
            </View>
            <Ionicons name="add-circle" size={sz(26)} color={ACCENT} />
          </Pressable>
        ) : (
          <View style={styles.emptyCard}>
            <View style={styles.reviewMark}>
              <Ionicons name="chatbubble-ellipses" size={sz(18)} color={ACCENT} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.emptyTitle}>No reviews yet</Text>
              <Text style={styles.emptyBody}>Brands you match with can review your work here.</Text>
            </View>
          </View>
        )
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          // Must match the gap below or each snap drifts off the card edge.
          snapToInterval={cardWidth + sz(12)}
          decelerationRate="fast"
          contentContainerStyle={{ gap: sz(12) }}
          scrollEnabled={reviews.length > 1}
        >
          {reviews.map(review => (
            <ReviewCard
              key={review.id}
              review={review}
              width={cardWidth}
              mine={!!user?.id && review.brand_id === user.id}
              onEdit={openForm}
              onMore={() => openSafetyMenu({
                userId: review.brand_id,
                name: review.brand_name || 'this brand',
                target: { type: 'review', id: review.id },
                onBlocked: load,
              })}
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
                  <Ionicons name="chatbubble-ellipses" size={sz(20)} color={ACCENT} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sheetTitle} accessibilityRole="header">
                    {myReview ? 'Edit your review' : `Review ${firstName}`}
                  </Text>
                  <Text style={styles.sheetSubtitle}>
                    Your review shows on {firstName}'s profile with your brand name, so other brands can see how the collaboration went.
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
                  <Ionicons name="close" size={sz(20)} color="#FFF" />
                </Pressable>
              </View>

              <ScrollView
                style={styles.sheetBody}
                contentContainerStyle={styles.sheetBodyContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <Text style={styles.groupLabel}>Your review</Text>
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
                    placeholder={`What was it like working with ${firstName}?`}
                    placeholderTextColor={PLACEHOLDER}
                    multiline
                    maxLength={QUOTE_MAX + 50}
                    textAlignVertical="top"
                    accessibilityLabel="Your review"
                  />
                  <Text style={[styles.counter, { color: counterColor }]}>
                    {quoteLength}/{QUOTE_MAX}
                  </Text>
                </View>
                {errors.quote ? (
                  <Text style={styles.fieldError}>{errors.quote}</Text>
                ) : (
                  <Text style={styles.fieldHelp}>Keep it about the collaboration.</Text>
                )}

                <Text style={[styles.groupLabel, { marginTop: sz(24) }]}>Written by</Text>
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
                      accessibilityLabel="Your name"
                    />
                  </FieldRow>
                  <FieldRow
                    icon="briefcase-outline"
                    label="Role and company"
                    optional
                    focused={focusedField === 'title'}
                    error={errors.title}
                    last
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
                      accessibilityLabel="Your role and company"
                    />
                  </FieldRow>
                </View>
              </ScrollView>

              <View style={styles.sheetFooter}>
                {submitError && <Text style={[styles.fieldError, { marginBottom: sz(12) }]}>{submitError}</Text>}
                <View style={styles.footerRow}>
                  {myReview && (
                    <Pressable
                      onPress={confirmDelete}
                      disabled={saving}
                      accessibilityRole="button"
                      style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
                    >
                      <Ionicons name="trash-outline" size={sz(18)} color={DANGER} />
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
                      <Text style={styles.saveButtonText}>{myReview ? 'Save changes' : 'Post review'}</Text>
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
        size={sz(18)}
        color={error ? DANGER : focused ? ACCENT : '#8A8A8A'}
        style={styles.rowIcon}
      />
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, focused && { color: ACCENT }, !!error && { color: DANGER }]}>
          {label}
          {optional && <Text style={styles.rowOptional}>  Optional</Text>}
        </Text>
        {children}
        {!!error && <Text style={[styles.fieldError, { marginTop: sz(4) }]}>{error}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: sz(12), marginBottom: sz(28) },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: sz(16) },
  title: { fontSize: sz(24), fontWeight: '700', color: '#FFF' },
  subtitle: { fontSize: sz(12), color: '#9A9A9A', marginTop: sz(4) },
  addButton: {
    flexDirection: 'row', alignItems: 'center', gap: sz(4),
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', borderRadius: sz(12),
    paddingVertical: sz(7), paddingHorizontal: sz(12),
  },
  addButtonText: { color: '#FFF', fontSize: sz(13), fontWeight: '600' },
  card: {
    backgroundColor: '#050505',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: sz(16),
    padding: sz(20),
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: sz(14) },
  reviewMark: {
    width: sz(36), height: sz(36), borderRadius: sz(10), backgroundColor: 'rgba(255,107,43,0.12)',
    justifyContent: 'center', alignItems: 'center',
  },
  iconButton: {
    width: sz(32), height: sz(32), borderRadius: sz(16), backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center', alignItems: 'center',
  },
  quote: { color: '#E6E6E6', fontSize: sz(15), lineHeight: sz(23) },
  readMore: { color: '#BDBDBD', fontSize: sz(13), fontWeight: '600', marginTop: sz(6) },
  reviewerRow: { flexDirection: 'row', alignItems: 'center', gap: sz(12), marginTop: sz(20) },
  initials: {
    width: sz(40), height: sz(40), borderRadius: sz(20), backgroundColor: '#262626',
    justifyContent: 'center', alignItems: 'center',
  },
  initialsText: { color: '#FFF', fontSize: sz(14), fontWeight: '700' },
  reviewerName: { color: '#FFF', fontSize: sz(15), fontWeight: '600' },
  reviewerTitle: { color: '#9A9A9A', fontSize: sz(12), marginTop: sz(2) },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: sz(5), marginTop: sz(12) },
  brandText: { color: '#9A9A9A', fontSize: sz(12), flexShrink: 1 },
  emptyCard: {
    flexDirection: 'row', alignItems: 'center', gap: sz(14),
    borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: sz(16), padding: sz(16), backgroundColor: 'rgba(255,255,255,0.02)',
  },
  emptyTitle: { color: '#FFF', fontSize: sz(15), fontWeight: '600' },
  emptyBody: { color: '#9A9A9A', fontSize: sz(12), lineHeight: sz(17), marginTop: sz(3) },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end', alignItems: 'center' },
  sheet: {
    width: '100%',
    maxWidth: sz(560),
    maxHeight: '94%',
    backgroundColor: '#141414',
    borderTopLeftRadius: sz(28),
    borderTopRightRadius: sz(28),
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  grabber: {
    alignSelf: 'center', width: sz(36), height: sz(4), borderRadius: sz(2),
    backgroundColor: 'rgba(255,255,255,0.18)', marginTop: sz(10),
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'flex-start', gap: sz(14),
    paddingHorizontal: sz(24), paddingTop: sz(18), paddingBottom: sz(18),
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  headerMark: {
    width: sz(44), height: sz(44), borderRadius: sz(12), backgroundColor: 'rgba(255,107,43,0.12)',
    justifyContent: 'center', alignItems: 'center',
  },
  sheetTitle: { fontSize: sz(19), fontWeight: '700', color: '#FFF', letterSpacing: -0.3 },
  sheetSubtitle: { fontSize: sz(13), color: '#9A9A9A', lineHeight: sz(19), marginTop: sz(4) },
  closeButton: {
    width: sz(36), height: sz(36), borderRadius: sz(18), backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center', alignItems: 'center',
    ...Platform.select({ web: { outlineStyle: 'none' } as any, default: {} }),
  },
  closeButtonActive: { backgroundColor: 'rgba(255,255,255,0.16)' },
  sheetBody: { flexGrow: 0 },
  sheetBodyContent: { paddingHorizontal: sz(24), paddingTop: sz(20), paddingBottom: sz(8) },
  groupLabel: { color: '#E6E6E6', fontSize: sz(13), fontWeight: '600', marginBottom: sz(10) },
  textareaBox: {
    backgroundColor: '#1C1C1C', borderRadius: sz(16), borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: sz(16), paddingTop: sz(14), paddingBottom: sz(10),
  },
  boxFocused: { borderColor: ACCENT, backgroundColor: '#1F1F1F' },
  boxError: { borderColor: DANGER },
  textarea: { color: '#FFF', fontSize: sz(15), lineHeight: sz(22), minHeight: sz(112), padding: 0 },
  counter: { alignSelf: 'flex-end', fontSize: sz(12), marginTop: sz(6), fontVariant: ['tabular-nums'] },
  fieldHelp: { color: '#8A8A8A', fontSize: sz(12), lineHeight: sz(17), marginTop: sz(8) },
  fieldError: { color: DANGER, fontSize: sz(12), lineHeight: sz(17), marginTop: sz(8) },
  group: {
    backgroundColor: '#1C1C1C', borderRadius: sz(16), borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: sz(16), paddingVertical: sz(12) },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)' },
  rowFocused: { backgroundColor: 'rgba(255,107,43,0.06)' },
  rowIcon: { marginTop: sz(2), marginRight: sz(12), width: sz(20) },
  rowLabel: { color: '#9A9A9A', fontSize: sz(12), fontWeight: '500', marginBottom: sz(4) },
  rowOptional: { color: '#6F6F6F', fontWeight: '400' },
  rowInput: { color: '#FFF', fontSize: sz(15), paddingVertical: sz(2), paddingHorizontal: 0 },
  sheetFooter: {
    paddingHorizontal: sz(24), paddingTop: sz(14), paddingBottom: sz(28),
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#141414',
  },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: sz(10) },
  saveButton: {
    flex: 1, height: sz(52), borderRadius: sz(14), backgroundColor: ACCENT,
    justifyContent: 'center', alignItems: 'center',
  },
  saveButtonDisabled: { opacity: 0.45 },
  saveButtonText: { color: '#FFF', fontSize: sz(16), fontWeight: '700', letterSpacing: 0.1 },
  removeButton: {
    flexDirection: 'row', alignItems: 'center', gap: sz(6), height: sz(52), paddingHorizontal: sz(16),
    borderRadius: sz(14), backgroundColor: 'rgba(255,107,107,0.1)',
  },
  removeButtonText: { color: DANGER, fontSize: sz(15), fontWeight: '600' },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
});
