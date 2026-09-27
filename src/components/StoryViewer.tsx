import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  Dimensions,
  Animated,
  SafeAreaView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons, Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { recordStoryView, getStoryViewers } from '@/api';
import { openSafetyMenu } from '@/components/safetyMenu';
import { sz } from '@/theme/scale';

const { width, height } = Dimensions.get('window');

type StoryItem = {
  id: string;
  media_url: string;
};

type StoryGroup = {
  id: string;
  name: string;
  avatar: string;
  isMe?: boolean;
  items: StoryItem[];
};

interface StoryViewerProps {
  visible: boolean;
  stories: StoryGroup[];
  initialGroupIndex?: number;
  onClose: () => void;
}

const STORY_DURATION = 5000; // 5 seconds per story

export function StoryViewer({ visible, stories, initialGroupIndex = 0, onClose }: StoryViewerProps) {
  const [currentGroupIndex, setCurrentGroupIndex] = useState(initialGroupIndex);
  const [currentItemIndex, setCurrentItemIndex] = useState(0);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [showViewers, setShowViewers] = useState(false);
  const [viewersList, setViewersList] = useState<any[]>([]);
  
  const progressAnim = useRef(new Animated.Value(0)).current;
  const isPaused = useRef(false);

  useEffect(() => {
    if (visible && stories.length > 0) {
      const currentGroup = stories[currentGroupIndex];
      const currentItem = currentGroup?.items[currentItemIndex];
      if (currentGroup && currentItem && !currentGroup.isMe) {
        recordStoryView(currentItem.id).catch(console.error);
      }
    }
  }, [visible, currentGroupIndex, currentItemIndex, stories]);

  useEffect(() => {
    if (visible) {
      setCurrentGroupIndex(initialGroupIndex);
      setCurrentItemIndex(0);
    }
  }, [visible, initialGroupIndex]);

  useEffect(() => {
    if (visible && stories.length > 0) {
      startAnimation();
    } else {
      progressAnim.setValue(0);
    }
    return () => {
      progressAnim.stopAnimation();
    };
  }, [currentGroupIndex, currentItemIndex, visible]);

  const startAnimation = () => {
    progressAnim.setValue(0);
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: STORY_DURATION,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished && !isPaused.current) {
        goToNext();
      }
    });
  };

  const goToNext = () => {
    const currentGroup = stories[currentGroupIndex];
    if (!currentGroup) return;

    if (currentItemIndex < currentGroup.items.length - 1) {
      setCurrentItemIndex(prev => prev + 1);
    } else {
      if (currentGroupIndex < stories.length - 1) {
        setCurrentGroupIndex(prev => prev + 1);
        setCurrentItemIndex(0);
      } else {
        onClose();
      }
    }
  };

  const goToPrev = () => {
    if (currentItemIndex > 0) {
      setCurrentItemIndex(prev => prev - 1);
    } else {
      if (currentGroupIndex > 0) {
        const prevGroup = stories[currentGroupIndex - 1];
        setCurrentGroupIndex(prevGroupIndex => prevGroupIndex - 1);
        setCurrentItemIndex(prevGroup.items.length - 1);
      } else {
        progressAnim.setValue(0);
        startAnimation();
      }
    }
  };

  const handlePress = (evt: any) => {
    const x = evt.nativeEvent.locationX;
    if (x < width / 2) {
      goToPrev();
    } else {
      goToNext();
    }
  };

  const handleLongPress = () => {
    isPaused.current = true;
    progressAnim.stopAnimation();
  };

  const handlePressOut = () => {
    if (isPaused.current) {
      isPaused.current = false;
      startAnimation();
    }
  };

  const togglePause = () => {
    if (isPaused.current) {
      isPaused.current = false;
      startAnimation();
    } else {
      isPaused.current = true;
      progressAnim.stopAnimation();
    }
  };

  const handleSendReply = () => {
    if (replyText.trim()) {
      Alert.alert('Sent', `Your reply to ${stories[currentGroupIndex]?.name} was sent!`);
      setReplyText('');
      // Resume if we hit send and the keyboard closes
    }
  };

  const handleLike = () => {
    Alert.alert('Liked', 'You liked this story!');
  };

  const handleShare = () => {
    Alert.alert('Share', 'Share functionality coming soon!');
  };

  const handleOpenViewers = async () => {
    try {
      isPaused.current = true;
      progressAnim.stopAnimation();
      
      const currentItem = stories[currentGroupIndex].items[currentItemIndex];
      const data = await getStoryViewers(currentItem.id);
      setViewersList(data);
      setShowViewers(true);
    } catch (err) {
      console.error('Failed to get viewers:', err);
      Alert.alert('Error', 'Could not load viewers.');
      isPaused.current = false;
      startAnimation();
    }
  };

  const closeViewers = () => {
    setShowViewers(false);
    isPaused.current = false;
    startAnimation();
  };

  if (!visible || stories.length === 0) return null;

  const currentGroup = stories[currentGroupIndex];
  if (!currentGroup || currentGroup.items.length === 0) return null;
  const currentItem = currentGroup.items[currentItemIndex];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView 
        style={styles.container} 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.container}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={handlePress}
            onLongPress={handleLongPress}
            onPressOut={handlePressOut}
            delayLongPress={200}
          >
            <Image
              source={{ uri: currentItem.media_url }}
              style={styles.image}
              contentFit="cover"
            />
          </Pressable>

          {/* Top Gradient for header readability */}
          <LinearGradient
            colors={['rgba(0,0,0,0.6)', 'transparent']}
            style={styles.topGradient}
            pointerEvents="none"
          />

          <SafeAreaView style={styles.overlay}>
            {/* Progress Bars */}
            <View style={styles.progressContainer}>
              {currentGroup.items.map((item, index) => {
                return (
                  <View key={item.id} style={styles.progressBarBg}>
                    <Animated.View
                      style={[
                        styles.progressBarFg,
                        {
                          width: index === currentItemIndex
                            ? progressAnim.interpolate({
                                inputRange: [0, 1],
                                outputRange: ['0%', '100%'],
                              })
                            : index < currentItemIndex
                            ? '100%'
                            : '0%',
                        },
                      ]}
                    />
                  </View>
                );
              })}
            </View>

            {/* Header */}
            <View style={styles.header}>
              <View style={styles.userInfo}>
                <Image source={{ uri: currentGroup.avatar }} style={styles.avatar} />
                <Text style={styles.username}>{currentGroup.name}</Text>
                <Text style={styles.timeElapsed}>2 h</Text>
              </View>
              <View style={styles.headerRight}>
                <Pressable onPress={togglePause} style={styles.headerIconBtn}>
                  <Ionicons name={isPaused.current ? "play" : "pause"} size={sz(22)} color="#FFF" />
                </Pressable>
                {!currentGroup.isMe && (
                  <Pressable
                    accessibilityLabel="Report or block"
                    style={styles.headerIconBtn}
                    onPress={() => {
                      isPaused.current = true;
                      progressAnim.stopAnimation();
                      // The story group id is the author's user id.
                      openSafetyMenu({
                        userId: currentGroup.id,
                        name: currentGroup.name,
                        target: { type: 'story', id: currentItem.id },
                        onBlocked: onClose,
                      });
                    }}
                  >
                    <Ionicons name="ellipsis-horizontal" size={sz(24)} color="#FFF" />
                  </Pressable>
                )}
                <Pressable accessibilityLabel="Close" onPress={onClose} style={styles.headerIconBtn}>
                  <Ionicons name="close" size={sz(26)} color="#FFF" />
                </Pressable>
              </View>
            </View>

            <View style={{ flex: 1 }} pointerEvents="none" />

            {/* Bottom Gradient for input readability */}
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.7)']}
              style={styles.bottomGradient}
              pointerEvents="none"
            />

            {/* Bottom Bar */}
            <View style={styles.bottomBar}>
              {currentGroup.isMe ? (
                <View style={styles.viewersBarContainer}>
                  <Pressable style={styles.viewersBtn} onPress={handleOpenViewers}>
                    <Ionicons name="eye-outline" size={sz(24)} color="#FFF" />
                    <Text style={styles.viewersText}>Viewers</Text>
                  </Pressable>
                  <Pressable style={styles.actionBtn} onPress={handleShare}>
                    <Ionicons name="ellipsis-horizontal" size={sz(28)} color="#FFF" />
                  </Pressable>
                </View>
              ) : (
                <>
                  <View style={styles.inputContainer}>
                    <TextInput
                      style={styles.input}
                      placeholder={`Reply to ${currentGroup.name}...`}
                      placeholderTextColor="#FFF"
                      value={replyText}
                      onChangeText={setReplyText}
                      onSubmitEditing={handleSendReply}
                      returnKeyType="send"
                      onFocus={() => {
                        isPaused.current = true;
                        progressAnim.stopAnimation();
                        setIsKeyboardVisible(true);
                      }}
                      onBlur={() => {
                        isPaused.current = false;
                        startAnimation();
                        setIsKeyboardVisible(false);
                      }}
                    />
                  </View>

                  {!isKeyboardVisible && (
                    <View style={styles.actionButtons}>
                      <Pressable style={styles.actionBtn} onPress={handleLike}>
                        <Ionicons name="heart-outline" size={sz(30)} color="#FFF" />
                      </Pressable>
                      <Pressable style={styles.actionBtn} onPress={handleShare}>
                        <Ionicons name="paper-plane-outline" size={sz(28)} color="#FFF" />
                      </Pressable>
                    </View>
                  )}
                </>
              )}
            </View>
          </SafeAreaView>

          {/* Viewers Bottom Sheet */}
          <Modal visible={showViewers} transparent animationType="slide" onRequestClose={closeViewers}>
            <Pressable style={styles.viewersModalOverlay} onPress={closeViewers}>
              <Pressable style={styles.viewersSheet} onPress={(e) => e.stopPropagation()}>
                <View style={styles.viewersSheetHeader}>
                  <View style={styles.dragHandle} />
                  <Text style={styles.viewersSheetTitle}>Viewers</Text>
                </View>
                {viewersList.length === 0 ? (
                  <Text style={styles.emptyViewersText}>No viewers yet.</Text>
                ) : (
                  viewersList.map((viewer) => (
                    <View key={viewer.user_id} style={styles.viewerRow}>
                      <Image source={{ uri: viewer.avatar }} style={styles.viewerAvatar} />
                      <Text style={styles.viewerName}>{viewer.name}</Text>
                    </View>
                  ))
                )}
              </Pressable>
            </Pressable>
          </Modal>

        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  topGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: sz(120),
  },
  bottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: sz(150),
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    pointerEvents: 'box-none',
  },
  progressContainer: {
    flexDirection: 'row',
    paddingHorizontal: sz(10),
    paddingTop: sz(10),
    gap: sz(4),
  },
  progressBarBg: {
    flex: 1,
    height: sz(2.5),
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: sz(2),
    overflow: 'hidden',
  },
  progressBarFg: {
    height: '100%',
    backgroundColor: '#FFF',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: sz(16),
    paddingTop: sz(12),
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: sz(34),
    height: sz(34),
    borderRadius: sz(17),
    marginRight: sz(10),
    borderWidth: 1,
    borderColor: '#FFF',
  },
  username: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: sz(14),
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: sz(2),
  },
  timeElapsed: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: sz(14),
    marginLeft: sz(8),
    fontWeight: '600',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sz(16),
  },
  headerIconBtn: {
    padding: sz(4),
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: sz(16),
    paddingBottom: Platform.OS === 'ios' ? sz(10) : sz(20),
    gap: sz(16),
  },
  inputContainer: {
    flex: 1,
    height: sz(48),
    borderRadius: sz(24),
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.7)',
    justifyContent: 'center',
    paddingHorizontal: sz(16),
  },
  input: {
    color: '#FFF',
    fontSize: sz(15),
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sz(16),
  },
  actionBtn: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewersBarContainer: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: sz(8),
  },
  viewersBtn: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewersText: {
    color: '#FFF',
    fontSize: sz(12),
    fontWeight: '600',
    marginTop: sz(2),
  },
  viewersModalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  viewersSheet: {
    backgroundColor: '#1E1E1E',
    borderTopLeftRadius: sz(16),
    borderTopRightRadius: sz(16),
    padding: sz(16),
    minHeight: sz(300),
    maxHeight: height * 0.8,
  },
  viewersSheetHeader: {
    alignItems: 'center',
    marginBottom: sz(20),
  },
  dragHandle: {
    width: sz(40),
    height: sz(4),
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: sz(2),
    marginBottom: sz(16),
  },
  viewersSheetTitle: {
    color: '#FFF',
    fontSize: sz(16),
    fontWeight: 'bold',
  },
  emptyViewersText: {
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    marginTop: sz(20),
  },
  viewerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: sz(16),
  },
  viewerAvatar: {
    width: sz(44),
    height: sz(44),
    borderRadius: sz(22),
    marginRight: sz(12),
  },
  viewerName: {
    color: '#FFF',
    fontSize: sz(16),
    fontWeight: '500',
  }
});
