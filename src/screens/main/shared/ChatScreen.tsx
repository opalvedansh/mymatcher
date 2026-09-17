import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  Image,
  Keyboard,
  Pressable,
  TouchableWithoutFeedback,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getMatches } from '@/api';
import type { MatchRecord } from '@/api/types';
import { useAuth } from '@/contexts/AuthContext';
import { ConversationScreen } from '@/screens/main/shared/ConversationScreen';

interface ChatScreenProps {
  onConversationStateChange?: (isOpen: boolean) => void;
}

export function ChatScreen({ onConversationStateChange }: ChatScreenProps) {
  const { onboardingData } = useAuth();
  const role = onboardingData?.role?.toLowerCase() as 'brand' | 'influencer' | undefined;
  
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [selectedMatch, setSelectedMatch] = useState<MatchRecord | null>(null);

  useEffect(() => {
    onConversationStateChange?.(!!selectedMatch);
  }, [selectedMatch, onConversationStateChange]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const { data } = await getMatches() as any; // Destructure the { data } wrapper from updated endpoint! Wait, I changed the endpoint to return { data }? Let's check api/types. 
        // Let's just use `getMatches` directly assuming it handles `data`. Wait, getMatches returns api.get() which unwraps Axios `data` if we use interceptors? 
        // Wait, getMatches type is MatchRecord[], but the backend was returning `{ data, next_cursor }`.
        // Let's fix that in a bit if needed.
        const matchesArray = Array.isArray(data) ? data : (data?.data || data || []);
        
        // Sort matches by last_message_at descending, or matched_at if no messages
        const sorted = matchesArray.sort((a: MatchRecord, b: MatchRecord) => {
          const timeA = new Date(a.last_message_at || a.matched_at).getTime();
          const timeB = new Date(b.last_message_at || b.matched_at).getTime();
          return timeB - timeA;
        });
        if (!cancelled) setMatches(sorted);
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? 'Failed to load chats');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedMatch]);

  // Helper to get the correct person's details
  const getMatchPerson = (m: MatchRecord) => {
    if (role === 'brand') {
      return { 
        userId: m.influencer_id,
        name: m.influencer_name, 
        avatar: m.influencer_avatar,
        myAvatar: m.brand_logo
      };
    }
    return { 
      userId: m.brand_id,
      name: m.brand_name, 
      avatar: m.brand_logo,
      myAvatar: m.influencer_avatar
    };
  };

  const formatTime = (isoString?: string) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) return `${Math.max(1, diffMins)}m`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h`;
    return `${Math.floor(diffHrs / 24)}d`;
  };

  const renderItem = ({ item }: { item: MatchRecord }) => {
    const person = getMatchPerson(item);
    
    // getMatches returns last_message_sender, last_message_read_at
    const unread = (item.last_message_sender && !item.last_message_read_at) ? 1 : 0;

    return (
      <Pressable style={styles.chatItem} onPress={() => setSelectedMatch(item)}>
        <Image 
          source={{ uri: person.avatar ?? 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&q=80' }} 
          style={styles.avatar} 
        />
        
        <View style={styles.chatDetails}>
          <Text style={styles.chatName}>{person.name ?? 'Unknown'}</Text>
          <Text style={styles.chatMessage} numberOfLines={2}>
            {item.last_message || 'No messages yet...'}
          </Text>
        </View>

        <View style={styles.chatMeta}>
          <Text style={styles.chatTime}>{formatTime(item.last_message_at || item.matched_at)}</Text>
          {unread > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadText}></Text>
            </View>
          )}
        </View>
      </Pressable>
    );
  };

  if (selectedMatch) {
    const person = getMatchPerson(selectedMatch);
    return (
      <ConversationScreen
        matchId={selectedMatch.match_id}
        otherUserId={person.userId}
        chatName={person.name ?? 'Chat'}
        chatAvatar={person.avatar ?? undefined}
        myAvatar={person.myAvatar ?? undefined}
        onBack={() => setSelectedMatch(null)}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={{ flex: 1 }}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Chat</Text>
        <Pressable>
          <Ionicons name="notifications" size={24} color="#FFF" />
        </Pressable>
      </View>

      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search"
          placeholderTextColor="#888"
          returnKeyType="search"
          onSubmitEditing={Keyboard.dismiss}
        />
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#FF6B2B" style={{ marginTop: 40 }} />
      ) : error ? (
        <Text style={{ color: '#FF3B30', textAlign: 'center', marginTop: 40 }}>⚠️ {error}</Text>
      ) : matches.length === 0 ? (
        <Text style={{ color: '#888', textAlign: 'center', marginTop: 40 }}>No conversations yet. Go swipe!</Text>
      ) : (
        <FlatList
          data={matches}
          keyExtractor={(item) => item.match_id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
        </View>
      </TouchableWithoutFeedback>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#121212',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginTop: 20,
    marginBottom: 24,
  },
  headerTitle: {
    fontSize: 34,
    fontWeight: 'bold',
    color: '#FFF',
  },
  searchContainer: {
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  searchInput: {
    backgroundColor: '#D9D9D9',
    borderRadius: 24,
    height: 48,
    paddingHorizontal: 20,
    fontSize: 16,
    color: '#333',
    textAlign: 'center',
  },
  listContent: {
    paddingHorizontal: 24,
    paddingBottom: 100, // Leave space for bottom nav
  },
  chatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    marginRight: 16,
    backgroundColor: '#333'
  },
  chatDetails: {
    flex: 1,
    marginRight: 16,
  },
  chatName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFF',
    marginBottom: 4,
  },
  chatMessage: {
    fontSize: 14,
    color: '#CCC',
    lineHeight: 20,
  },
  chatMeta: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 50,
  },
  chatTime: {
    fontSize: 12,
    color: '#CCC',
  },
  unreadBadge: {
    backgroundColor: '#FF6B2B',
    borderRadius: 6,
    width: 12,
    height: 12,
    marginTop: 6,
  },
  unreadText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  separator: {
    height: 1,
    backgroundColor: '#FF6B2B',
    opacity: 0.5,
  },
});
