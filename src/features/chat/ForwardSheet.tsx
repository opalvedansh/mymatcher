import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getMatches } from '@/api';
import type { MatchRecord } from '@/api/types';
import { Avatar } from '@/components/ChatAvatar';
import { sz } from '@/theme/scale';
import { Sheet } from './Sheet';

const ACCENT = '#FF6B2B';
const MAX_TARGETS = 5; // matches the server's limit

const webNoOutline = Platform.select({ web: { outlineStyle: 'none' } as any, default: undefined });

type Person = { matchId: string; name: string; avatar: string | null };

/** Pick up to five chats to forward a message to. */
export function ForwardSheet({
  visible,
  role,
  onClose,
  onForward,
}: {
  visible: boolean;
  role?: 'brand' | 'influencer';
  onClose: () => void;
  onForward: (matchIds: string[]) => Promise<void>;
}) {
  const [matches, setMatches] = useState<MatchRecord[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setSelected([]);
    setQuery('');
    let cancelled = false;
    getMatches()
      .then((res) => {
        if (!cancelled) setMatches(Array.isArray(res) ? res : res?.data ?? []);
      })
      .catch(() => {
        if (!cancelled) setMatches([]);
      });
    return () => { cancelled = true; };
  }, [visible]);

  const people = useMemo<Person[]>(() => {
    const list = (matches ?? []).map((m) => (role === 'brand'
      ? { matchId: m.match_id, name: m.influencer_name || 'Creator', avatar: m.influencer_avatar }
      : { matchId: m.match_id, name: m.brand_name || 'Brand', avatar: m.brand_logo }));
    const q = query.trim().toLowerCase();
    return q ? list.filter((p) => p.name.toLowerCase().includes(q)) : list;
  }, [matches, role, query]);

  const toggle = (matchId: string) => setSelected((prev) => (
    prev.includes(matchId) ? prev.filter((id) => id !== matchId) : prev.length >= MAX_TARGETS ? prev : [...prev, matchId]
  ));

  const send = async () => {
    if (!selected.length || sending) return;
    setSending(true);
    try {
      await onForward(selected);
      onClose();
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Forward to">
      <View style={styles.search}>
        <Ionicons name="search" size={sz(16)} color="#8A8A8A" />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search chats"
          placeholderTextColor="#8A8A8A"
          style={[styles.searchInput, webNoOutline]}
          autoCorrect={false}
        />
      </View>

      {matches === null ? (
        <ActivityIndicator color={ACCENT} style={{ marginVertical: sz(30) }} />
      ) : (
        <FlatList
          data={people}
          keyExtractor={(p) => p.matchId}
          style={styles.list}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Text style={styles.empty}>No chats to forward to</Text>}
          renderItem={({ item }) => {
            const on = selected.includes(item.matchId);
            return (
              <Pressable
                onPress={() => toggle(item.matchId)}
                style={({ pressed }) => [styles.person, pressed && { backgroundColor: 'rgba(255,255,255,0.05)' }]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
              >
                <Avatar uri={item.avatar} name={item.name} size={sz(40)} />
                <Text style={styles.personName} numberOfLines={1}>{item.name}</Text>
                <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={sz(24)} color={on ? ACCENT : '#555'} />
              </Pressable>
            );
          }}
        />
      )}

      <View style={styles.footer}>
        <Text style={styles.count}>
          {selected.length ? `${selected.length} selected${selected.length >= MAX_TARGETS ? ' (max)' : ''}` : `Up to ${MAX_TARGETS} chats`}
        </Text>
        <Pressable
          onPress={send}
          disabled={!selected.length || sending}
          style={[styles.send, (!selected.length || sending) && { opacity: 0.5 }]}
          accessibilityRole="button"
          accessibilityLabel="Forward"
        >
          {sending ? <ActivityIndicator color="#FFF" /> : <Ionicons name="send" size={sz(18)} color="#FFF" />}
        </Pressable>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row', alignItems: 'center', gap: sz(8), height: sz(42), paddingHorizontal: sz(14),
    borderRadius: sz(21), backgroundColor: '#1E1E1E',
  },
  searchInput: { flex: 1, color: '#FFF', fontSize: sz(15), paddingVertical: 0 },
  list: { maxHeight: sz(360), marginTop: sz(8) },
  person: { flexDirection: 'row', alignItems: 'center', gap: sz(12), paddingVertical: sz(9), paddingHorizontal: sz(4), borderRadius: sz(12) },
  personName: { flex: 1, color: '#FFF', fontSize: sz(15), fontWeight: '600' },
  empty: { color: '#8A8A8A', textAlign: 'center', marginVertical: sz(24) },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: sz(12) },
  count: { color: '#9A9A9A', fontSize: sz(13) },
  send: { width: sz(48), height: sz(48), borderRadius: sz(24), backgroundColor: ACCENT, justifyContent: 'center', alignItems: 'center' },
});
