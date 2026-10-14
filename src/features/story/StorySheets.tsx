import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { getStoryAudience, searchStoryMusic, setCloseFriends, type StoryAudienceMember } from '@/api';
import { getAudio } from '@/utils/optionalModules';
import { sz } from '@/theme/scale';
import type { Track } from './layout';

const ACCENT = '#FF6B2B';
export const CLOSE_FRIENDS_GREEN = '#1DB954';

function Sheet({
  visible,
  onClose,
  title,
  children,
  footer,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={`Close ${title}`} />
        <View style={[styles.sheet, { height: height * 0.75, paddingBottom: insets.bottom + sz(8) }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={sz(10)} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={sz(24)} color="#FFF" />
            </Pressable>
          </View>
          {children}
          {footer}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <View style={styles.search}>
      <Ionicons name="search" size={sz(17)} color="rgba(255,255,255,0.5)" />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="rgba(255,255,255,0.45)"
        style={styles.searchInput}
        autoCorrect={false}
        returnKeyType="search"
      />
      {!!value && (
        <Pressable onPress={() => onChange('')} hitSlop={sz(8)} accessibilityLabel="Clear search">
          <Ionicons name="close-circle" size={sz(17)} color="rgba(255,255,255,0.5)" />
        </Pressable>
      )}
    </View>
  );
}

function StateText({ loading, text }: { loading?: boolean; text?: string }) {
  return (
    <View style={styles.state}>
      {loading ? <ActivityIndicator color="rgba(255,255,255,0.6)" /> : <Text style={styles.stateText}>{text}</Text>}
    </View>
  );
}

// ─── Music ────────────────────────────────────────────────────────

/** Search Apple Music previews; tap a song to put it on the story. */
export function MusicSheet({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (t: Track) => void }) {
  const [query, setQuery] = useState('');
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [previewing, setPreviewing] = useState<number | null>(null);
  const audio = getAudio();
  const previewPlayer = useRef<ReturnType<NonNullable<typeof audio>['createAudioPlayer']> | null>(null);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    setFailed(false);
    // Typing waits a moment so each keystroke isn't a search.
    const t = setTimeout(() => {
      setTracks(null);
      searchStoryMusic(query.trim())
        .then((r) => live && setTracks(r))
        .catch(() => live && (setFailed(true), setTracks([])));
    }, query ? 350 : 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, visible]);

  const stopPreview = () => {
    previewPlayer.current?.remove();
    previewPlayer.current = null;
    setPreviewing(null);
  };
  useEffect(() => {
    if (!visible) stopPreview();
  }, [visible]);
  useEffect(() => stopPreview, []);

  const togglePreview = (t: Track) => {
    if (previewing === t.id) {
      stopPreview();
      return;
    }
    stopPreview();
    if (!audio) return;
    audio.setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {});
    const p = audio.createAudioPlayer({ uri: t.preview });
    p.play();
    previewPlayer.current = p;
    setPreviewing(t.id);
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Music"
      footer={<Text style={styles.attribution}>Song previews from Apple Music</Text>}
    >
      <SearchBox value={query} onChange={setQuery} placeholder="Search music" />
      {!query && tracks?.length ? <Text style={styles.section}>Popular</Text> : null}
      {tracks === null ? (
        <StateText loading />
      ) : !tracks.length ? (
        <StateText text={failed ? 'Music isn’t available right now. Try again in a bit.' : 'No songs found.'} />
      ) : (
        <FlatList
          data={tracks}
          keyExtractor={(t) => String(t.id)}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item: t }) => (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              onPress={() => {
                stopPreview();
                onPick(t);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${t.title} by ${t.artist}`}
            >
              {t.artwork ? (
                <Image source={{ uri: t.artwork }} style={styles.artwork} cachePolicy="memory-disk" />
              ) : (
                <View style={[styles.artwork, styles.artworkFallback]}>
                  <Ionicons name="musical-notes" size={sz(20)} color="#FFF" />
                </View>
              )}
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>{t.title}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>{t.artist}</Text>
              </View>
              {audio && (
                <Pressable
                  onPress={() => togglePreview(t)}
                  hitSlop={sz(10)}
                  style={styles.playBtn}
                  accessibilityRole="button"
                  accessibilityLabel={previewing === t.id ? 'Stop preview' : 'Play preview'}
                >
                  <Ionicons name={previewing === t.id ? 'pause' : 'play'} size={sz(18)} color="#FFF" />
                </Pressable>
              )}
            </Pressable>
          )}
        />
      )}
    </Sheet>
  );
}

// ─── People: @mentions and Close Friends ──────────────────────────

function useAudience(visible: boolean) {
  const [people, setPeople] = useState<StoryAudienceMember[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!visible) return;
    let live = true;
    setFailed(false);
    getStoryAudience()
      .then((r) => live && setPeople(r))
      .catch(() => live && (setFailed(true), setPeople([])));
    return () => {
      live = false;
    };
  }, [visible]);
  return { people, failed };
}

function Avatar({ uri }: { uri: string | null }) {
  return uri ? (
    <Image source={{ uri }} style={styles.avatar} cachePolicy="memory-disk" />
  ) : (
    <View style={[styles.avatar, styles.avatarFallback]}>
      <Ionicons name="person" size={sz(18)} color="#777" />
    </View>
  );
}

function filterPeople(people: StoryAudienceMember[] | null, q: string) {
  if (!people) return null;
  const s = q.trim().toLowerCase();
  return s ? people.filter((p) => p.name.toLowerCase().includes(s)) : people;
}

const NO_MATCHES = 'Only your matches see your stories. Match with someone to add them here.';

/** Pick a match to @mention. */
export function MentionSheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (p: StoryAudienceMember) => void;
}) {
  const { people, failed } = useAudience(visible);
  const [query, setQuery] = useState('');
  const shown = useMemo(() => filterPeople(people, query), [people, query]);
  useEffect(() => {
    if (!visible) setQuery('');
  }, [visible]);

  return (
    <Sheet visible={visible} onClose={onClose} title="Mention">
      <SearchBox value={query} onChange={setQuery} placeholder="Search your matches" />
      {shown === null ? (
        <StateText loading />
      ) : !shown.length ? (
        <StateText text={failed ? 'Couldn’t load your matches.' : query ? 'No one by that name.' : NO_MATCHES} />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(p) => p.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item: p }) => (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              onPress={() => onPick(p)}
              accessibilityRole="button"
              accessibilityLabel={`Mention ${p.name}`}
            >
              <Avatar uri={p.avatar} />
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>{p.name}</Text>
                <Text style={styles.rowSub}>{p.role === 'brand' ? 'Brand' : 'Creator'}</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </Sheet>
  );
}

/**
 * Edit the Close Friends list. With `shareLabel`, the button also shares the
 * story to it once saved.
 */
export function CloseFriendsSheet({
  visible,
  onClose,
  onSaved,
  shareLabel,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved: (ids: string[]) => void;
  shareLabel?: string;
}) {
  const { people, failed } = useAudience(visible);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);
  const shown = useMemo(() => filterPeople(people, query), [people, query]);

  useEffect(() => {
    if (people) setSelected(new Set(people.filter((p) => p.close_friend).map((p) => p.id)));
  }, [people]);
  useEffect(() => {
    if (!visible) {
      setQuery('');
      setSelected(null);
    }
  }, [visible]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = async () => {
    if (!selected || saving) return;
    setSaving(true);
    try {
      const { ids } = await setCloseFriends([...selected]);
      onSaved(ids);
    } catch {
      // Stays open so nothing is lost; the button can be tried again.
    } finally {
      setSaving(false);
    }
  };

  const count = selected?.size ?? 0;
  const canShare = !shareLabel || count > 0;
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Close Friends"
      footer={
        <Pressable
          style={({ pressed }) => [styles.cfButton, (!selected || !canShare) && styles.disabled, pressed && styles.pressed]}
          onPress={save}
          disabled={!selected || saving || !canShare}
          accessibilityRole="button"
        >
          {saving ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.cfButtonText}>{shareLabel ?? 'Done'}</Text>
          )}
        </Pressable>
      }
    >
      <Text style={styles.cfHint}>
        Only the people you pick see stories you share to Close Friends. Nobody is told when you add or remove them.
      </Text>
      <SearchBox value={query} onChange={setQuery} placeholder="Search your matches" />
      {shown === null || selected === null ? (
        <StateText loading={!failed} text="Couldn’t load your matches." />
      ) : !shown.length ? (
        <StateText text={query ? 'No one by that name.' : NO_MATCHES} />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(p) => p.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item: p }) => {
            const on = selected.has(p.id);
            return (
              <Pressable
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                onPress={() => toggle(p.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={p.name}
              >
                <Avatar uri={p.avatar} />
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{p.name}</Text>
                  <Text style={styles.rowSub}>{p.role === 'brand' ? 'Brand' : 'Creator'}</Text>
                </View>
                <View style={[styles.check, on && styles.checkOn]}>
                  {on && <Ionicons name="checkmark" size={sz(16)} color="#FFF" />}
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: '#1C1C1C',
    borderTopLeftRadius: sz(18),
    borderTopRightRadius: sz(18),
  },
  handle: {
    alignSelf: 'center',
    width: sz(40),
    height: sz(4),
    borderRadius: sz(2),
    backgroundColor: 'rgba(255,255,255,0.3)',
    marginTop: sz(10),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: sz(16),
    paddingVertical: sz(12),
  },
  title: {
    color: '#FFF',
    fontSize: sz(17),
    fontWeight: '700',
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sz(8),
    marginHorizontal: sz(16),
    marginBottom: sz(8),
    paddingHorizontal: sz(12),
    height: sz(40),
    borderRadius: sz(10),
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  searchInput: {
    flex: 1,
    color: '#FFF',
    fontSize: sz(15),
    padding: 0,
  },
  section: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: sz(13),
    fontWeight: '700',
    paddingHorizontal: sz(16),
    paddingVertical: sz(6),
  },
  state: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: sz(32),
  },
  stateText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: sz(14),
    textAlign: 'center',
    lineHeight: sz(20),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sz(12),
    paddingHorizontal: sz(16),
    paddingVertical: sz(8),
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    color: '#FFF',
    fontSize: sz(15),
    fontWeight: '600',
  },
  rowSub: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: sz(13),
    marginTop: sz(2),
  },
  artwork: {
    width: sz(48),
    height: sz(48),
    borderRadius: sz(6),
  },
  artworkFallback: {
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtn: {
    width: sz(34),
    height: sz(34),
    borderRadius: sz(17),
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attribution: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: sz(11),
    textAlign: 'center',
    paddingTop: sz(6),
  },
  avatar: {
    width: sz(44),
    height: sz(44),
    borderRadius: sz(22),
  },
  avatarFallback: {
    backgroundColor: '#2A2A2A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cfHint: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: sz(13),
    lineHeight: sz(18),
    paddingHorizontal: sz(16),
    paddingBottom: sz(10),
  },
  check: {
    width: sz(24),
    height: sz(24),
    borderRadius: sz(12),
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: {
    backgroundColor: CLOSE_FRIENDS_GREEN,
    borderColor: CLOSE_FRIENDS_GREEN,
  },
  cfButton: {
    marginHorizontal: sz(16),
    marginTop: sz(8),
    height: sz(48),
    borderRadius: sz(12),
    backgroundColor: CLOSE_FRIENDS_GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cfButtonText: {
    color: '#FFF',
    fontSize: sz(16),
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.7,
  },
});
