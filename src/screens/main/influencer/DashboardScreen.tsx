import { AntDesign, FontAwesome5, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import {
  FlatList,
  Image,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useState, useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useSocketStatus } from '@/hooks/useSocketStatus';

import { colors } from '@/theme/colors';
import { NavHomeIcon, NavProfileIcon, NavHeartIcon, NavMatchIcon, NavMessageIcon } from '@/components/BottomNavIcons';
import { SwipeScreen } from '@/screens/main/influencer/SwipeScreen';
import { ChatScreen } from '@/screens/main/shared/ChatScreen';
import { LikesScreen } from '@/screens/main/shared/LikesScreen';
import { InfluencerProfileScreen } from '@/screens/main/influencer/InfluencerProfileScreen';
import { BrandProfileScreen } from '@/screens/main/brand/BrandProfileScreen';

import * as ImagePicker from 'expo-image-picker';
import { getFeedStories } from '@/api';
import { StoryViewer } from '@/components/StoryViewer';
import { PostCard, Post } from '@/components/PostCard';
import api from '@/api/client';


export function DashboardScreen() {
  const router = useRouter();
  const [stories, setStories] = useState<any[]>([]);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [selectedGroupIndex, setSelectedGroupIndex] = useState(0);
  const [viewingProfileId, setViewingProfileId] = useState<string | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [postsRefreshing, setPostsRefreshing] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);

  const fetchStories = async () => {
    try {
      const res = await getFeedStories() as any;
      setStories(res.data || res);
    } catch (e) {
      console.log('Failed to fetch stories', e);
    }
  };

  const fetchPosts = async (refresh = false) => {
    try {
      if (refresh) setPostsRefreshing(true);
      else setPostsLoading(true);
      const res = await api.get('/api/posts/feed') as any;
      setPosts(res.data?.posts || res.posts || []);
    } catch (e) {
      console.log('Failed to fetch posts', e);
    } finally {
      setPostsLoading(false);
      setPostsRefreshing(false);
    }
  };

  const handleLikeToggle = (postId: string, liked: boolean, newCount: number) => {
    setPosts(prev => prev.map(p => p.id === postId ? { ...p, liked_by_me: liked, likes_count: newCount } : p));
  };

  useEffect(() => {
    fetchStories();
    fetchPosts();
  }, []);

  const handleAddStory = () => {
    setShowAddMenu(false);
    setTimeout(() => router.push('/story-camera'), 200);
  };

  const handleAddPost = () => {
    setShowAddMenu(false);
    setTimeout(() => router.push('/create-post'), 200);
  };

  const renderStory = ({ item, index }: { item: any; index: number }) => {
    return (
      <Pressable
        style={styles.storyContainer}
        onPress={() => {
          if (item.isMe) {
            // Always show the action sheet for the user's own story bubble
            setShowAddMenu(true);
          } else {
            setSelectedGroupIndex(index);
            setViewerVisible(true);
          }
        }}
      >
        <LinearGradient
          colors={item.isMe ? ['#FF4500', '#FF8C00'] : ['#FF4500', '#FF8C00']}
          style={styles.storyRing}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <View style={styles.storyAvatarContainer}>
            <Image source={{ uri: item.avatar }} style={styles.storyAvatar} />
          </View>
        </LinearGradient>
        {item.isMe && (
          <Pressable
            style={styles.addStoryButton}
            onPress={(e) => {
              // Stop propagation so the outer Pressable doesn't also fire
              e.stopPropagation?.();
              setShowAddMenu(true);
            }}
          >
            <AntDesign name="plus" size={14} color="#FFF" />
          </Pressable>
        )}
        <Text style={styles.storyName} numberOfLines={1}>
          {item.name}
        </Text>
      </Pressable>
    );
  };



  const ListHeader = () => (
    <View style={styles.header}>
      <FlatList
        data={stories}
        renderItem={(props) => renderStory({ ...props, index: props.index })}
        keyExtractor={(item) => item.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.storiesContent}
      />
      {/* Divider */}
      <View style={styles.feedDivider} />
    </View>
  );

  const ListEmpty = () => (
    <View style={styles.emptyFeed}>
      <Ionicons name="images-outline" size={48} color="#333" />
      <Text style={styles.emptyFeedTitle}>No posts yet</Text>
      <Text style={styles.emptyFeedSub}>Be the first to share something!</Text>
    </View>
  );

  const [activeTab, setActiveTab] = useState<'match' | 'home' | 'likes' | 'messages' | 'profile'>('match');
  const [isConversationOpen, setIsConversationOpen] = useState(false);
  const { isConnected } = useSocketStatus();

  return (
    <View style={styles.container}>
      {viewingProfileId ? (
        <BrandProfileScreen 
          publicUserId={viewingProfileId} 
          onBack={() => setViewingProfileId(null)} 
        />
      ) : activeTab === 'home' ? (
        <SafeAreaView style={{ flex: 1 }}>
          <FlatList
            data={posts}
            renderItem={({ item }) => (
              <PostCard
                post={item}
                onLikeToggle={handleLikeToggle}
                onViewProfile={(id) => setViewingProfileId(id)}
                onAuthorBlocked={(authorId) => setPosts(prev => prev.filter(p => p.user_id !== authorId))}
              />
            )}
            keyExtractor={(item) => item.id}
            ListHeaderComponent={ListHeader}
            ListEmptyComponent={postsLoading ? null : ListEmpty}
            contentContainerStyle={styles.feedContent}
            showsVerticalScrollIndicator={false}
            onRefresh={() => fetchPosts(true)}
            refreshing={postsRefreshing}
            ItemSeparatorComponent={() => <View style={styles.postSeparator} />}
          />
        </SafeAreaView>
      ) : activeTab === 'match' ? (
        <SwipeScreen onViewProfile={(id) => setViewingProfileId(id)} onNavigateToMessages={() => setActiveTab('messages')} />
      ) : activeTab === 'likes' ? (
        <LikesScreen />
      ) : activeTab === 'messages' ? (
        <ChatScreen onConversationStateChange={setIsConversationOpen} />
      ) : activeTab === 'profile' ? (
        <InfluencerProfileScreen />
      ) : (
        <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: '#FFF' }}>Coming Soon</Text>
        </SafeAreaView>
      )}

      {/* Fix 4: Real-time connection status banner */}
      {!isConnected && (
        <View style={styles.reconnectingBanner}>
          <Ionicons name="wifi-outline" size={14} color="#1a1a1a" style={{ marginRight: 6 }} />
          <Text style={styles.reconnectingText}>Reconnecting...</Text>
        </View>
      )}

      {/* Custom Bottom Navigation Bar */}
      {!isConversationOpen && (
        <View style={styles.bottomNav}>
          <Pressable style={styles.navItem} onPress={() => setActiveTab('match')}>
            <NavMatchIcon size={24} color={activeTab === 'match' ? '#FF6B2B' : '#555'} />
          </Pressable>
          <Pressable style={styles.navItem} onPress={() => setActiveTab('home')}>
            <NavHomeIcon size={24} color={activeTab === 'home' ? '#FF6B2B' : '#555'} />
          </Pressable>
          <Pressable style={styles.navItem} onPress={() => setActiveTab('likes')}>
            <NavHeartIcon size={26} color={activeTab === 'likes' ? '#FF6B2B' : '#555'} />
          </Pressable>
          <Pressable style={styles.navItem} onPress={() => setActiveTab('messages')}>
            <NavMessageIcon size={24} color={activeTab === 'messages' ? '#FF6B2B' : '#555'} />
          </Pressable>
          <Pressable style={styles.navItem} onPress={() => setActiveTab('profile')}>
            <NavProfileIcon size={24} color={activeTab === 'profile' ? '#FF6B2B' : '#555'} />
          </Pressable>
        </View>
      )}

      <StoryViewer
        visible={viewerVisible}
        stories={stories}
        initialGroupIndex={selectedGroupIndex}
        onClose={() => setViewerVisible(false)}
      />

      {/* ── Add Content Action Sheet (absolute overlay — works on web + native) ── */}
      {showAddMenu && (
        <View style={addMenuStyles.overlay}>
          {/* Dark backdrop */}
          <Pressable style={addMenuStyles.backdrop} onPress={() => setShowAddMenu(false)} />

          {/* Sheet panel */}
          <View style={addMenuStyles.sheet}>
            {/* Handle bar */}
            <View style={addMenuStyles.handle} />

            <Text style={addMenuStyles.title}>Create</Text>

            {/* Add Story */}
            <TouchableOpacity style={addMenuStyles.option} onPress={handleAddStory} activeOpacity={0.8}>
              <LinearGradient
                colors={['#FF4500', '#FF8C00']}
                style={addMenuStyles.iconGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <Ionicons name="camera" size={24} color="#FFF" />
              </LinearGradient>
              <View style={addMenuStyles.optionText}>
                <Text style={addMenuStyles.optionTitle}>Add Story</Text>
                <Text style={addMenuStyles.optionDesc}>Share a photo or video for 24 hours</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#555" />
            </TouchableOpacity>

            {/* Add Post */}
            <TouchableOpacity style={addMenuStyles.option} onPress={handleAddPost} activeOpacity={0.8}>
              <LinearGradient
                colors={['#6C63FF', '#A855F7']}
                style={addMenuStyles.iconGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <Ionicons name="grid" size={22} color="#FFF" />
              </LinearGradient>
              <View style={addMenuStyles.optionText}>
                <Text style={addMenuStyles.optionTitle}>Add Post</Text>
                <Text style={addMenuStyles.optionDesc}>Share a permanent post to your profile</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#555" />
            </TouchableOpacity>

            {/* Cancel */}
            <TouchableOpacity style={addMenuStyles.cancel} onPress={() => setShowAddMenu(false)} activeOpacity={0.7}>
              <Text style={addMenuStyles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212', // Dark background exactly like design
  },
  header: {
    paddingVertical: 16,
  },
  storiesContent: {
    paddingHorizontal: 16,
    gap: 16,
  },
  storyContainer: {
    alignItems: 'center',
    width: 76,
  },
  storyRing: {
    width: 76,
    height: 76,
    borderRadius: 38,
    padding: 3, // Ring thickness
    justifyContent: 'center',
    alignItems: 'center',
  },
  storyAvatarContainer: {
    width: '100%',
    height: '100%',
    backgroundColor: '#121212',
    borderRadius: 35,
    padding: 3, // Gap between ring and avatar
    justifyContent: 'center',
    alignItems: 'center',
  },
  storyAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 35,
  },
  addStoryButton: {
    position: 'absolute',
    bottom: 22,
    right: 0,
    backgroundColor: '#000',
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#121212',
    justifyContent: 'center',
    alignItems: 'center',
  },
  storyName: {
    color: '#FFF',
    fontSize: 12,
    marginTop: 8,
    fontWeight: '400',
  },
  feedContent: {
    paddingBottom: 100,
  },
  feedDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginHorizontal: 16,
  },
  postSeparator: {
    height: 8,
    backgroundColor: '#0A0A0A',
  },
  emptyFeed: {
    alignItems: 'center',
    paddingTop: 60,
    gap: 10,
  },
  emptyFeedTitle: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 8,
  },
  emptyFeedSub: {
    color: '#555',
    fontSize: 14,
  },
  postContainer: {
    width: '100%',
    aspectRatio: 0.85,
    backgroundColor: '#222',
    borderRadius: 32,
    marginBottom: 24,
    overflow: 'hidden',
  },
  postImage: {
    width: '100%',
    height: '100%',
    position: 'absolute',
  },
  // Black shadow behind the header so text reads clearly over any image
  postHeaderShadow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 130,
  },
  postHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
  },
  postBrandLogo: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: '#FFF',
  },
  postBrandInfo: {
    marginLeft: 12,
  },
  postBrandNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  postBrandName: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
  postCategory: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    marginTop: 2,
  },
  postFooterFade: {
    // kept for legacy reference — removed from JSX
    position: 'absolute', bottom: 60, left: 0, right: 0, height: 0,
  },
  // Tall glass container — blur/tint blend gradually
  glassContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 110,            // taller = longer blend zone
    justifyContent: 'flex-end',
    overflow: 'hidden',
    ...Platform.select({
      web: {
        // backdropFilter covers the full 110px zone;
        // maskImage makes it gradually appear from transparent at top
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        maskImage: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.4) 35%, black 65%)',
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.4) 35%, black 65%)',
      } as any,
      default: {},
    }),
  },
  // Stats row at the bottom of the glass container
  statsContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 48,
    paddingBottom: 18,
    paddingTop: 10,
    borderTopWidth: 0,      // no hard border — tint gradient handles the edge
  },
  // Legacy
  glassBar: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 0 },
  postStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  postStatText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  bottomNav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 58,
    backgroundColor: '#FFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingBottom: 4,
    paddingHorizontal: 12,
  },
  navItem: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 38,
    height: 38,
  },
  reconnectingBanner: {
    position: 'absolute',
    bottom: 58,  // sits just above the bottom nav bar
    left: 0,
    right: 0,
    backgroundColor: '#F5C518',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    zIndex: 100,
  },
  reconnectingText: {
    color: '#1a1a1a',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});

const addMenuStyles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
    justifyContent: 'flex-end',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  sheet: {
    backgroundColor: '#1A1A1A',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingBottom: 40,
    paddingTop: 12,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 20,
    letterSpacing: -0.3,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#242424',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    gap: 14,
  },
  iconGradient: {
    width: 50,
    height: 50,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionText: {
    flex: 1,
  },
  optionTitle: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 3,
  },
  optionDesc: {
    color: '#888',
    fontSize: 12,
    lineHeight: 16,
  },
  cancel: {
    marginTop: 4,
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: '#242424',
    borderRadius: 16,
  },
  cancelText: {
    color: '#FF4500',
    fontSize: 16,
    fontWeight: '600',
  },
});

