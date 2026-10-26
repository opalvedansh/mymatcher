import React from 'react';
import { View, Text, TextInput, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { PlatformFollowers } from '@/api/types';
import { compactCount, isSyncedCount, HANDLE_PLACEHOLDERS } from '@/utils/followers';
import { sz } from '@/theme/scale';

export interface FollowerInputRow {
  key: string;
  label: string;
  /** The platform's icon, already drawn in its badge. */
  icon: React.ReactNode;
  /** False hides the account field (a creator's Instagram has its own sync). */
  showHandle?: boolean;
}

// Ten digits covers the largest account on any platform.
const MAX_DIGITS = 10;
const webNoOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : undefined;

/**
 * One row per platform, shared by the creator and brand profile editors: the
 * account to fetch followers for, and the count. A fetched count shows as
 * read-only; until then, or when an account can't be read, the user can type
 * the count themselves.
 */
export function PlatformFollowerInputs({ rows, drafts, handles, followers, onChange, onHandleChange }: {
  rows: FollowerInputRow[];
  drafts: Record<string, string>;
  handles: Record<string, string>;
  followers?: PlatformFollowers;
  onChange: (platform: string, text: string) => void;
  onHandleChange: (platform: string, text: string) => void;
}) {
  return (
    <View style={styles.list}>
      {rows.map(({ key, label, icon, showHandle = true }) => {
        const synced = isSyncedCount(followers, key);
        return (
          <View key={key} style={styles.row}>
            <View style={styles.topLine}>
              {icon}
              <Text style={styles.label} numberOfLines={1}>{label}</Text>
              {synced ? (
                <View style={styles.synced} accessibilityLabel={`${label}: ${followers![key].count} followers, synced`}>
                  <Text style={styles.syncedCount}>{compactCount(followers![key].count)}</Text>
                  <Ionicons name="checkmark-circle" size={sz(14)} color="#4CD964" />
                  <Text style={styles.syncedTxt}>Synced</Text>
                </View>
              ) : (
                <TextInput
                  style={[styles.countInput, webNoOutline]}
                  value={drafts[key] ?? ''}
                  onChangeText={(t) => onChange(key, t.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '').slice(0, MAX_DIGITS))}
                  placeholder="Followers"
                  placeholderTextColor="#666"
                  keyboardType="number-pad"
                  returnKeyType="done"
                  accessibilityLabel={`${label} followers`}
                />
              )}
            </View>
            {showHandle && (
              <TextInput
                style={[styles.handleInput, webNoOutline]}
                value={handles[key] ?? ''}
                onChangeText={(t) => onHandleChange(key, t.slice(0, 300))}
                placeholder={HANDLE_PLACEHOLDERS[key] ?? 'Username or profile link'}
                placeholderTextColor="#666"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType={Platform.OS === 'ios' ? 'url' : 'default'}
                returnKeyType="done"
                accessibilityLabel={`${label} account`}
              />
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: sz(8) },
  row: {
    gap: sz(8),
    paddingVertical: sz(8),
    paddingLeft: sz(10),
    paddingRight: sz(6),
    borderRadius: sz(14),
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  topLine: { flexDirection: 'row', alignItems: 'center', gap: sz(10) },
  label: { flex: 1, color: '#FFF', fontSize: sz(14) },
  countInput: {
    width: sz(120),
    height: sz(38),
    paddingHorizontal: sz(12),
    borderRadius: sz(10),
    backgroundColor: '#111',
    color: '#FFF',
    fontSize: sz(15),
    textAlign: 'right',
  },
  handleInput: {
    height: sz(38),
    paddingHorizontal: sz(12),
    borderRadius: sz(10),
    backgroundColor: '#111',
    color: '#FFF',
    fontSize: sz(14),
  },
  synced: { flexDirection: 'row', alignItems: 'center', gap: sz(4), height: sz(38), paddingHorizontal: sz(8) },
  syncedCount: { color: '#FFF', fontSize: sz(15), fontWeight: '600', marginRight: sz(4) },
  syncedTxt: { color: '#9A9A9A', fontSize: sz(12) },
});
