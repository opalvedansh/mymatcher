import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  Image,
  Keyboard,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, Feather, MaterialIcons } from '@expo/vector-icons';
import { getMessages } from '@/api';
import { openSafetyMenu } from '@/components/safetyMenu';
import { socketService } from '@/api/socket';
import { useAuth } from '@/contexts/AuthContext';
import type { ChatMessage } from '@/api/types';

const AvatarImage = ({ uri, style }: { uri?: string, style: any }) => {
  const [error, setError] = useState(false);
  
  useEffect(() => {
    setError(false);
  }, [uri]);

  return (
    <Image
      source={{ uri: error || !uri ? 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&q=80' : uri }}
      style={style}
      onError={() => setError(true)}
    />
  );
};

interface Props {
  matchId: string;
  otherUserId: string;
  chatName: string;
  chatAvatar?: string;
  myAvatar?: string;
  onBack: () => void;
}

export function ConversationScreen({ matchId, otherUserId, chatName, chatAvatar, myAvatar, onBack }: Props) {
  const { user } = useAuth(); // Need to know who I am to determine isMe
  
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const flatListRef = useRef<FlatList>(null);

  // 1. Fetch initial messages
  useEffect(() => {
    let cancelled = false;
    const fetchHistory = async () => {
      try {
        setLoading(true);
        const res = await getMessages(matchId, 100);
        // messages are returned newest first by backend
        // We want to display oldest at top, newest at bottom, so we reverse it
        if (!cancelled) setMessages(res.data.reverse());
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? 'Failed to load messages');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchHistory();
    return () => { cancelled = true; };
  }, [matchId]);

  // 2. Setup WebSocket connection
  useEffect(() => {
    const setupSocket = async () => {
      await socketService.connect();
      socketService.joinMatch(matchId);
      
      const handleReceive = (msg: ChatMessage) => {
        setMessages((prev: ChatMessage[]) => {
          // Prevent duplicates if REST already caught it or we double-received
          if (prev.find((m: ChatMessage) => m.id === msg.id)) return prev;
          
          // If this is our own message coming back, replace the temp version
          if (msg.sender_id === user?.id) {
            const tempIndex = prev.findIndex(m => m.id.startsWith('temp-') && m.content === msg.content);
            if (tempIndex >= 0) {
              const updated = [...prev];
              updated[tempIndex] = msg; // replace temp with real
              return updated;
            }
          }
          
          return [...prev, msg];
        });
      };
      
      socketService.onReceiveMessage(handleReceive);
      
      return () => {
        socketService.offReceiveMessage(handleReceive);
      };
    };
    
    const cleanupPromise = setupSocket();
    
    return () => {
      cleanupPromise.then(cleanup => cleanup && cleanup());
    };
  }, [matchId]);

  const handleSend = () => {
    if (!inputText.trim()) return;
    
    const text = inputText.trim();
    setInputText('');
    Keyboard.dismiss();

    // Optimistically update UI
    const tempMsg: ChatMessage = {
      id: `temp-${Date.now()}-${Math.random()}`,
      sender_id: user?.id || 'unknown',
      content: text,
      created_at: new Date().toISOString(),
      read_at: null,
    };
    setMessages(prev => [...prev, tempMsg]);

    socketService.sendMessage(matchId, text);
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const isMe = item.sender_id === user?.id;

    return (
      <View style={[styles.messageRow, isMe ? styles.messageRowRight : styles.messageRowLeft]}>
        {!isMe && (
          <AvatarImage 
            uri={chatAvatar} 
            style={styles.avatarLeft} 
          />
        )}
        
        <View style={styles.messageContent}>
          <View
            style={[
              styles.bubble,
              isMe ? styles.bubbleRight : styles.bubbleLeft,
            ]}
          >
            <Text style={[styles.messageText, isMe ? styles.messageTextRight : styles.messageTextLeft]}>
              {item.content}
            </Text>
          </View>
          <Text style={[styles.timeText, isMe ? styles.timeTextRight : styles.timeTextLeft]}>
            {formatTime(item.created_at)}
          </Text>
        </View>

        {isMe && (
          <AvatarImage 
            uri={myAvatar} 
            style={styles.avatarRight} 
          />
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Pressable onPress={onBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={28} color="#FFF" />
          </Pressable>
          <Text style={styles.headerName}>{chatName}</Text>
        </View>
        <View style={styles.headerRight}>
          <Pressable
            accessibilityLabel="Report or block"
            hitSlop={8}
            onPress={() =>
              openSafetyMenu({
                userId: otherUserId,
                name: chatName,
                target: { type: 'message', id: matchId },
                onBlocked: onBack,
              })
            }
          >
            <Ionicons name="ellipsis-horizontal" size={26} color="#FFF" />
          </Pressable>
        </View>
      </View>

      {/* Message List */}
      <KeyboardAvoidingView 
        style={styles.flex1} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {loading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color="#FF6B2B" />
          </View>
        ) : error ? (
          <View style={styles.centerContainer}>
            <Text style={{ color: '#FF3B30' }}>⚠️ {error}</Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
            onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
          />
        )}

        {/* Input Area */}
        <View style={styles.inputContainer}>
          <View style={styles.inputBackground}>
            <Pressable style={styles.smileIcon}>
              <Feather name="smile" size={24} color="#555" />
            </Pressable>
            <TextInput
              style={styles.textInput}
              placeholder="Type message here..."
              placeholderTextColor="#888"
              value={inputText}
              onChangeText={setInputText}
              multiline
            />
            <Pressable style={styles.sendButton} onPress={handleSend}>
              <Feather name="send" size={18} color="#FFF" style={styles.sendIcon} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#121212',
  },
  flex1: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    padding: 8,
    marginRight: 8,
  },
  headerName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFF',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconButton: {
    padding: 8,
    marginLeft: 4,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingVertical: 20,
    gap: 16,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  messageRowLeft: {
    justifyContent: 'flex-start',
  },
  messageRowRight: {
    justifyContent: 'flex-end',
  },
  avatarLeft: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginRight: 12,
  },
  avatarRight: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginLeft: 12,
  },
  messageContent: {
    maxWidth: '75%',
  },
  bubble: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 24,
  },
  bubbleLeft: {
    backgroundColor: '#FFF',
  },
  bubbleRight: {
    backgroundColor: '#F2602D',
  },
  messageText: {
    fontSize: 15,
    lineHeight: 22,
  },
  messageTextLeft: {
    color: '#111',
  },
  messageTextRight: {
    color: '#FFF',
  },
  timeText: {
    fontSize: 10,
    color: '#555',
    marginTop: 6,
  },
  timeTextLeft: {
    textAlign: 'left',
    marginLeft: 8,
  },
  timeTextRight: {
    textAlign: 'right',
    marginRight: 8,
  },
  inputContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#121212',
  },
  inputBackground: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderRadius: 30,
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  smileIcon: {
    padding: 10,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    color: '#333',
    paddingHorizontal: 8,
    maxHeight: 100, // For multiline
  },
  sendButton: {
    backgroundColor: '#FF6B2B',
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendIcon: {
    marginLeft: -2, // slightly center the paper plane optically
    marginTop: 2,
  },
});
