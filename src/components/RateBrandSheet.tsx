import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { getBrandRating, rateBrand, removeBrandRating } from '@/api';
import type { BrandRating } from '@/api/types';

const ACCENT = '#FF6B2B';
const DANGER = '#FF6B6B';
const MUTED = '#8A8A8A';

const SCORE_WORDS: Record<number, string> = {
  1: 'Poor experience',
  2: 'Below expectations',
  3: 'Fine',
  4: 'Good to work with',
  5: 'Would work with again',
};

/**
 * Lets a creator rate a brand they matched with. The server decides whether
 * they may: a rating from someone who never matched is refused there, not here.
 */
export function RateBrandSheet({
  visible,
  brandId,
  brandName,
  onClose,
  onRated,
}: {
  visible: boolean;
  brandId: string;
  brandName: string;
  onClose: () => void;
  onRated?: (rating: BrandRating) => void;
}) {
  const [rating, setRating] = useState<BrandRating | null>(null);
  const [score, setScore] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getBrandRating(brandId);
      setRating(res);
      setScore(res.my_score ?? 0);
    } catch (err) {
      console.warn('Failed to load rating', err);
      setError('Could not load your rating.');
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  const submit = async () => {
    if (!score || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await rateBrand(brandId, score);
      onRated?.(res);
      onClose();
    } catch (err) {
      console.error('Failed to save rating', err);
      setError('Could not save that. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await removeBrandRating(brandId);
      onClose();
    } catch (err) {
      console.error('Failed to remove rating', err);
      setError('Could not remove that. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const canRate = rating?.can_rate !== false;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close rating" />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetWrap}
        >
          <View style={styles.sheet}>
            <View style={styles.grabber} />

            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title} accessibilityRole="header">Rate {brandName}</Text>
                <Text style={styles.subtitle}>
                  Only the average and the number of ratings appear on their profile. Your name is not shown.
                </Text>
              </View>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close"
                style={({ pressed }) => [styles.close, pressed && styles.pressed]}
              >
                <Ionicons name="close" size={20} color="#DDD" />
              </Pressable>
            </View>

            {loading ? (
              <View style={styles.centre}>
                <ActivityIndicator color={ACCENT} />
              </View>
            ) : !canRate ? (
              <Text style={styles.note}>
                You can rate a brand once you have matched with them.
              </Text>
            ) : (
              <>
                <View style={styles.stars}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Pressable
                      key={n}
                      onPress={() => setScore(n)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: score === n }}
                      accessibilityLabel={`${n} out of 5`}
                      hitSlop={6}
                      style={({ pressed }) => [styles.star, pressed && styles.pressed]}
                    >
                      <Ionicons
                        name={n <= score ? 'star' : 'star-outline'}
                        size={34}
                        color={n <= score ? ACCENT : '#4A4A4A'}
                      />
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.scoreWord}>
                  {score ? SCORE_WORDS[score] : 'Tap a star'}
                </Text>
              </>
            )}

            {error && (
              <View style={styles.errorRow}>
                <Ionicons name="alert-circle" size={16} color={DANGER} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {canRate && !loading && (
              <>
                <Pressable
                  onPress={submit}
                  disabled={!score || saving}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !score || saving, busy: saving }}
                  style={({ pressed }) => [
                    styles.saveBtn,
                    (!score || saving) && styles.saveBtnDisabled,
                    pressed && !!score && styles.pressed,
                  ]}
                >
                  {saving ? (
                    <ActivityIndicator color="#FFF" size="small" />
                  ) : (
                    <Text style={[styles.saveTxt, !score && styles.saveTxtDisabled]}>
                      {rating?.my_score ? 'Update rating' : 'Submit rating'}
                    </Text>
                  )}
                </Pressable>

                {!!rating?.my_score && (
                  <Pressable
                    onPress={remove}
                    disabled={saving}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.removeBtn, pressed && styles.pressed]}
                  >
                    <Text style={styles.removeTxt}>Remove my rating</Text>
                  </Pressable>
                )}
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.75)' },
  sheetWrap: { width: '100%', maxWidth: 520, alignSelf: 'center' },
  sheet: {
    backgroundColor: '#141414',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 28,
  },
  grabber: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignSelf: 'center', marginBottom: 18,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 22 },
  title: { color: '#FFF', fontSize: 21, fontWeight: '700', letterSpacing: -0.4 },
  subtitle: { color: MUTED, fontSize: 13, lineHeight: 18, marginTop: 4 },
  close: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: '#1F1F1F',
    alignItems: 'center', justifyContent: 'center',
  },
  centre: { paddingVertical: 28, alignItems: 'center' },
  note: { color: MUTED, fontSize: 14, lineHeight: 20, paddingVertical: 12 },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  star: { padding: 4 },
  scoreWord: { color: '#FFF', fontSize: 15, fontWeight: '600', textAlign: 'center', marginTop: 14, minHeight: 22 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18 },
  errorText: { color: DANGER, fontSize: 13, flexShrink: 1 },
  saveBtn: {
    backgroundColor: ACCENT,
    borderRadius: 16,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  saveBtnDisabled: {
    backgroundColor: '#1E1E1E',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  saveTxt: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  saveTxtDisabled: { color: '#6F6F6F' },
  removeBtn: { alignSelf: 'center', paddingVertical: 14 },
  removeTxt: { color: MUTED, fontSize: 14, fontWeight: '500' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
});
