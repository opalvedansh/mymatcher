import { useState, ReactNode, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  FlatList,
  Image,
  Platform,
  Pressable,
  Dimensions,
  ScrollView,
} from 'react-native';
import { AntDesign, Feather, FontAwesome5, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { NavHomeIcon, NavProfileIcon, NavHeartIcon, NavMatchIcon, NavMessageIcon } from '@/components/BottomNavIcons';
import { ChatScreen } from '@/screens/main/shared/ChatScreen';
import { LikesScreen } from '@/screens/main/shared/LikesScreen';
import { BrandSwipeScreen } from '@/screens/main/brand/BrandSwipeScreen';
import { BrandProfileScreen } from '@/screens/main/brand/BrandProfileScreen';
import { InfluencerProfileScreen } from '@/screens/main/influencer/InfluencerProfileScreen';
import { useWindowDimensions } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { getFeedStories, uploadImage, uploadStory } from '@/api';
import { StoryViewer } from '@/components/StoryViewer';

// ─── Mock Data ───────────────────────────────────────────────────
const FEED_POSTS = [
  {
    id: '1',
    influencerName: 'Kartik Aryan',
    influencerAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&q=80',
    category: 'Fashion & Lifestyle',
    isVerified: true,
    isFollowing: false,
    postImage: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800&q=80',
    brandWatermark: 'NITRO',
    brandTagline: 'HI-PERFORMANCE INNERWEAR',
    campaignText: 'Yeh Andar\nKi Baat Hai ✦',
    likes: '1,139',
    shares: '128',
  },
  {
    id: '2',
    influencerName: 'Bhuvan Bam',
    influencerAvatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&q=80',
    category: 'Fashion & Lifestyle',
    isVerified: true,
    isFollowing: true,
    postImage: 'https://images.unsplash.com/photo-1559056199-641a0ac8b55e?w=800&q=80',
    brandWatermark: 'lenskart.com',
    brandTagline: '',
    campaignText: 'Lenskart Air',
    likes: '8,432',
    shares: '421',
  },
  {
    id: '3',
    influencerName: 'Prajakta Koli',
    influencerAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&q=80',
    category: 'Lifestyle & Comedy',
    isVerified: true,
    isFollowing: false,
    postImage: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=800&q=80',
    brandWatermark: 'SUGAR',
    brandTagline: 'COSMETICS',
    campaignText: 'Be Bold,\nBe You ✨',
    likes: '3,201',
    shares: '244',
  },
];

// ─── Feed Post Card ───────────────────────────────────────────────
function PostCard({ item, width }: { item: typeof FEED_POSTS[0], width: number }) {
  const [following, setFollowing] = useState(item.isFollowing);

  return (
    <View style={[fc.card, { width: width - 32 }]}>
      {/* Background image */}
      <Image source={{ uri: item.postImage }} style={fc.image} resizeMode="cover" />

      {/* Black shadow at the top of the card — behind header */}
      <LinearGradient
        colors={['rgba(0,0,0,0.75)', 'rgba(0,0,0,0.30)', 'transparent']}
        style={fc.topShadow}
      />

      {/* Dark gradient at the bottom */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.85)']}
        style={fc.bottomShadow}
      />

      {/* Header: avatar + name + follow button on one row */}
      <View style={fc.header}>
        <Image source={{ uri: item.influencerAvatar }} style={fc.avatar} />
        <View style={fc.headerInfo}>
          <View style={fc.nameRow}>
            <Text style={fc.name}>{item.influencerName}</Text>
            {item.isVerified && (
              <MaterialCommunityIcons name="check-decagram" size={15} color="#1DA1F2" style={{ marginLeft: 4 }} />
            )}
          </View>
          <Text style={fc.category}>{item.category}</Text>
        </View>
        <Pressable
          style={[fc.followBtn, following && fc.followingBtn]}
          onPress={() => setFollowing(f => !f)}
        >
          <Text style={[fc.followTxt, following && fc.followingTxt]}>
            {following ? 'Following' : 'Follow'}
          </Text>
        </Pressable>
      </View>

      {/* Brand watermark — below the header so it doesn't overlap Follow */}
      <View style={fc.watermark}>
        <Text style={fc.watermarkName}>{item.brandWatermark}</Text>
        {item.brandTagline ? <Text style={fc.watermarkSub}>{item.brandTagline}</Text> : null}
      </View>

      {/* Campaign text bottom-left */}
      <View style={fc.campaignBox}>
        <Text style={fc.campaignText}>{item.campaignText}</Text>
      </View>

      {/* Soft fade above the glass bar */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.55)']}
        style={fc.statsFade}
      />

      {/* Glass stats bar */}
      <BlurView style={fc.glassBar} intensity={40} tint="dark">
        <View style={fc.stat}>
          <AntDesign name="heart" size={20} color="#FF3B30" />
          <Text style={fc.statTxt}>{item.likes}</Text>
        </View>
        <View style={fc.stat}>
          <Feather name="send" size={20} color="#FFF" />
          <Text style={fc.statTxt}>{item.shares}</Text>
        </View>
      </BlurView>
    </View>
  );
}


export default function BrandHomeScreen() {
  const [stories, setStories] = useState<any[]>([]);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [selectedGroupIndex, setSelectedGroupIndex] = useState(0);
  const { width } = useWindowDimensions();

  const fetchStories = async () => {
    try {
      const res = await getFeedStories() as any;
      setStories(res.data || res);
    } catch (e) {
      console.log('Failed to fetch stories', e);
    }
  };

  useEffect(() => {
    fetchStories();
  }, []);

  const handleAddStory = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.5,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      try {
        await uploadStory(await uploadImage(result.assets[0].uri));
        fetchStories();
      } catch (err) {
        console.error('Failed to upload story', err);
      }
    }
  };

  const renderStoryItem = (item: any, index: number) => {
    return (
      <Pressable key={item.id} style={st.storyWrap} onPress={() => {
        if (item.isMe && (!item.items || item.items.length === 0)) {
          handleAddStory();
        } else {
          setSelectedGroupIndex(index);
          setViewerVisible(true);
        }
      }}>
        <LinearGradient
          colors={['#FF6B2B', '#FF3E6C']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={st.ring}
        >
          <View style={[st.logoCircle, { backgroundColor: item.bg || '#1E1E1E' }]}>
            <Image source={{ uri: item.avatar || item.logo }} style={st.logoImg} resizeMode="cover" />
          </View>
        </LinearGradient>
        {item.isMe && (
          <Pressable style={st.plusBadge} onPress={handleAddStory}>
            <AntDesign name="plus" size={10} color="#FFF" />
          </Pressable>
        )}
        <Text style={st.storyName} numberOfLines={1}>{item.name}</Text>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#121212' }}>
      <FlatList
        data={FEED_POSTS}
        keyExtractor={i => i.id}
        renderItem={({ item }) => <PostCard item={item} width={width} />}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.feedContent}
        ListHeaderComponent={() => (
          <View style={s.storiesSection}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.storiesRow}
            >
              {stories.map((item, index) => renderStoryItem(item, index))}
            </ScrollView>
          </View>
        )}
      />

      <StoryViewer
        visible={viewerVisible}
        stories={stories}
        initialGroupIndex={selectedGroupIndex}
        onClose={() => setViewerVisible(false)}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────
const st = StyleSheet.create({
  storyWrap: { alignItems: 'center', width: 72, marginRight: 14 },
  ring: { width: 72, height: 72, borderRadius: 36, padding: 3, justifyContent: 'center', alignItems: 'center' },
  logoCircle: { width: '100%', height: '100%', borderRadius: 33, justifyContent: 'center', alignItems: 'center', padding: 10, borderWidth: 3, borderColor: '#121212' },
  logoImg: { width: '100%', height: '100%' },
  plusBadge: { position: 'absolute', bottom: 20, right: 0, width: 22, height: 22, borderRadius: 11, backgroundColor: '#FF6B2B', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#121212' },
  storyName: { color: '#CCC', fontSize: 11, marginTop: 6, textAlign: 'center' },
});

const fc = StyleSheet.create({
  card: { alignSelf: 'center', aspectRatio: 0.78, borderRadius: 28, overflow: 'hidden', backgroundColor: '#1A1A1A', marginBottom: 20 },
  image: { ...StyleSheet.absoluteFill as any },
  // Top shadow: dark black fading to transparent — covers the header area
  topShadow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 160,
  },
  // Bottom shadow: transparent to dark — covers campaign text + stats
  bottomShadow: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 200,
  },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 10 },
  avatar: { width: 42, height: 42, borderRadius: 21, borderWidth: 2, borderColor: '#FFF' },
  headerInfo: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  name: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  category: { color: 'rgba(255,255,255,0.65)', fontSize: 11, marginTop: 1 },
  followBtn: { backgroundColor: '#FF6B2B', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  followingBtn: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.6)' },
  followTxt: { color: '#FFF', fontSize: 12, fontWeight: '700' },
  followingTxt: { color: 'rgba(255,255,255,0.8)' },
  // Watermark sits below the header (~80px from top) so it never overlaps the Follow button
  watermark: { position: 'absolute', top: 84, right: 16, alignItems: 'flex-end' },
  watermarkName: { color: '#FFF', fontSize: 16, fontWeight: '900', letterSpacing: 1 },
  watermarkSub: { color: 'rgba(255,255,255,0.75)', fontSize: 8, letterSpacing: 1.5, marginTop: 2, textAlign: 'right' },
  campaignBox: { position: 'absolute', bottom: 76, left: 20, right: 20 },
  campaignText: { color: '#FFF', fontSize: 26, fontWeight: '800', lineHeight: 34 },
  // Fade gradient bridging campaign text to glass bar
  statsFade: {
    position: 'absolute',
    bottom: 62,
    left: 0,
    right: 0,
    height: 60,
  },
  // Glass stats bar
  glassBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 62,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 28,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.15)',
    overflow: 'hidden',
  },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statTxt: { color: '#FFF', fontSize: 15, fontWeight: '600' },
});

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#121212' },
  storiesSection: { paddingTop: 16, paddingBottom: 8 },
  storiesRow: { paddingHorizontal: 16 },
  feedContent: { paddingBottom: 90 },
  nav: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    height: 62, backgroundColor: '#FFF',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center',
    paddingBottom: 4,
  },
  navBtn: { width: 42, height: 42, justifyContent: 'center', alignItems: 'center' },
});
