import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Image,
  Platform,
  Keyboard,
  Pressable,
  Dimensions,
  ActivityIndicator,
  Animated,
  PanResponder,
  Modal,
  TextInput,
  Linking,

  AccessibilityInfo,
} from 'react-native';
import { Ionicons, MaterialIcons, Feather, MaterialCommunityIcons, FontAwesome6 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useWindowDimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import * as ImagePicker from 'expo-image-picker';
import { getMyProfile, updateMyProfile, getProfileById, syncInstagram, uploadImage, recordSwipe } from '@/api';
import { ApiError } from '@/api/client';
import { openAccountMenu, openSafetyMenu } from '@/components/safetyMenu';
import { showAlert } from '@/components/ActionSheet';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { InfluencerProfile } from '@/api/types';
import { StoryPackageIcon, UgcPackageIcon, BrandPackageIcon, ReelPackageIcon } from '@/components/PackageIcons';
import { VerificationModal } from './VerificationModal';
import { LinkedinReviews } from './LinkedinReviews';
import type { LinkedinReview } from '@/api/types';
import { TouchableOpacity } from 'react-native';

// ──────────────────────── Line Chart ────────────────────────
const CHART_DATA = [100, 98, 85, 60, 40, 25, 8, 2, 1, 0];
const CHART_H = 160;
const MAX_Y = 120;
const Y_LABEL_W = 32;  // reserved width for y-axis labels
const DOT_R = 5;       // dot radius

function LineChart({ width }: { width: number }) {
  const PLOT_W = width - 48 - Y_LABEL_W - 12;
  const pts = CHART_DATA.map((v, i) => ({
    x: Y_LABEL_W + (i / (CHART_DATA.length - 1)) * PLOT_W,
    y: CHART_H - (v / MAX_Y) * CHART_H,
  }));
  const gridLines = [0, 30, 60, 90, 120];

  return (
    <View style={{ width: width - 48, height: CHART_H + 28, position: 'relative' }}>
      {gridLines.map((val) => {
        const y = CHART_H - (val / MAX_Y) * CHART_H;
        return (
          <View key={val} style={{ position: 'absolute', top: y, left: 0, right: 0, flexDirection: 'row', alignItems: 'center' }}>
            <Text style={chartSt.yLabel}>{val}</Text>
            <View style={chartSt.gridLine} />
          </View>
        );
      })}
      {pts.slice(0, -1).map((p, i) => {
        const next = pts[i + 1];
        const dx = next.x - p.x;
        const dy = next.y - p.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        return (
          <View
            key={`line-${i}`}
            style={{
              position: 'absolute',
              left: p.x,
              top: p.y,
              width: length,
              height: 2,
              backgroundColor: '#FF6B2B',
              transformOrigin: '0 50%',
              transform: [{ rotate: `${angle}deg` }],
            }}
          />
        );
      })}
      {pts.map((p, i) => (
        <View key={`dot-${i}`} style={[chartSt.dot, { left: p.x - DOT_R, top: p.y - DOT_R }]} />
      ))}
      {pts.map((p, i) => (
        <Text
          key={`xlabel-${i}`}
          style={[chartSt.xLabel, {
            position: 'absolute',
            top: CHART_H + 8,
            left: p.x - 8,
            width: 18,
            textAlign: 'center',
          }]}
        >
          {i + 1}
        </Text>
      ))}

    </View>
  );
}

const chartSt = StyleSheet.create({
  yLabel: { color: '#666', fontSize: 10, width: 28, textAlign: 'right' },
  gridLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.15)', marginLeft: 4 },
  dot: {
    position: 'absolute',
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: '#FF6B2B', borderWidth: 2, borderColor: '#121212',
  },
  xLabel: { color: '#666', fontSize: 10 },
  addReelCard: {
    width: 100,
    height: 150,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  addReelIconBg: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  addReelText: {
    color: '#888',
    fontSize: 12,
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#111111',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    minHeight: 250,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFF',
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#AAA',
    marginBottom: 24,
    lineHeight: 20,
  },
  modalInput: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#FFF',
    fontSize: 14,
    marginBottom: 24,
  },
  modalButton: {
    backgroundColor: '#FF6B2B',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  modalButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
});

type Tab = 'overview' | 'engagement' | 'audience';

// Brands offered in the Worked With picker. `icon` is a FontAwesome6 brand
// glyph; brands without one show their initials on the brand colour.
const COMPANY_CATALOG: { name: string, icon?: string, bg: string, fg?: string }[] = [
  { name: 'Nike', bg: '#111111' },
  { name: 'Adidas', bg: '#000000' },
  { name: 'Puma', bg: '#1A1A1A' },
  { name: 'Apple', icon: 'apple', bg: '#000000' },
  { name: 'Samsung', bg: '#1428A0' },
  { name: 'Google', icon: 'google', bg: '#4285F4' },
  { name: 'Amazon', icon: 'amazon', bg: '#FF9900' },
  { name: 'Microsoft', icon: 'microsoft', bg: '#00A4EF' },
  { name: 'Meta', icon: 'meta', bg: '#0866FF' },
  { name: 'Flipkart', bg: '#2874F0' },
  { name: 'Myntra', bg: '#FF3F6C' },
  { name: 'Nykaa', bg: '#FC2779' },
  { name: 'Mamaearth', bg: '#00AEEF' },
  { name: 'boAt', bg: '#E4002B' },
  { name: 'Zomato', bg: '#E23744' },
  { name: 'Swiggy', bg: '#FC8019' },
  { name: 'Netflix', bg: '#E50914' },
  { name: 'Spotify', icon: 'spotify', bg: '#1DB954' },
  { name: 'Coca-Cola', bg: '#F40009' },
  { name: 'Pepsi', bg: '#004B93' },
  { name: 'Red Bull', bg: '#DB0A40' },
  { name: 'Uber', icon: 'uber', bg: '#000000' },
  { name: 'Airbnb', icon: 'airbnb', bg: '#FF5A5F' },
  { name: 'Shopify', icon: 'shopify', bg: '#96BF48' },
  { name: 'PlayStation', icon: 'playstation', bg: '#003791' },
  { name: 'PayPal', icon: 'paypal', bg: '#003087' },
  { name: 'Zara', bg: '#000000' },
  { name: 'H&M', bg: '#E50010' },
  { name: 'OnePlus', bg: '#EB0028' },
  { name: 'Sugar Cosmetics', bg: '#000000' },
];

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Matches a catalog brand when its name appears as a whole word ("Apple India"),
// so short names like "Meta" don't light up on unrelated companies.
function findCatalogCompany(company: string) {
  const lower = company.trim().toLowerCase();
  return COMPANY_CATALOG.find(c => c.name.toLowerCase() === lower)
    || COMPANY_CATALOG.find(c => new RegExp(`(^|\\s)${escapeRegExp(c.name.toLowerCase())}(\\s|$)`).test(lower));
}

function companyLogo(company: string): { bg: string, icon: React.ReactNode } {
  const known = findCatalogCompany(company);
  const fg = known?.fg || '#FFF';
  if (known?.icon) return { bg: known.bg, icon: <FontAwesome6 name={known.icon as any} size={14} color={fg} /> };
  return {
    bg: known?.bg || '#FF6B2B',
    icon: <Text style={{ color: fg, fontSize: 10, fontWeight: '700' }}>{company.trim().substring(0, 2).toUpperCase()}</Text>,
  };
}

export function InfluencerProfileScreen({ publicUserId, onBack }: { publicUserId?: string, onBack?: () => void }) {
  const { user, signOut, deleteAccount } = useAuth();
  const { width, height } = useWindowDimensions();
  const scrollY = useRef(new Animated.Value(0)).current;
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const isPremium = false; // Mock premium check
  const [activeProfile, setActiveProfile] = useState<InfluencerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Tinder carousel state
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);

  const [isAddReelVisible, setIsAddReelVisible] = useState(false);
  const [isEditInstagramVisible, setIsEditInstagramVisible] = useState(false);
  const [editInstagramHandle, setEditInstagramHandle] = useState('');
  const [isUpdatingInstagram, setIsUpdatingInstagram] = useState(false);
  const [isVerificationModalVisible, setIsVerificationModalVisible] = useState(false);
  // Expressing interest from a public profile is the same act as a right swipe.
  const [interested, setInterested] = useState(false);
  const [sendingInterest, setSendingInterest] = useState(false);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [isEditWorkedWithVisible, setIsEditWorkedWithVisible] = useState(false);
  const [newWorkedWith, setNewWorkedWith] = useState('');
  const [draftWorkedWith, setDraftWorkedWith] = useState<string[]>([]);
  const [isSavingWorkedWith, setIsSavingWorkedWith] = useState(false);
  const [isEditPlatformsVisible, setIsEditPlatformsVisible] = useState(false);
  const [draftPlatforms, setDraftPlatforms] = useState<string[]>([]);
  const [isSavingPlatforms, setIsSavingPlatforms] = useState(false);
  const [newReelUrl, setNewReelUrl] = useState('');
  // We use activeProfile?.reels, but keep a local state if optimistic UI is desired, 
  // or just depend on activeProfile.reels directly. Let's use activeProfile for consistency.
  const reels = activeProfile?.reels || [];

  const [isSyncing, setIsSyncing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  const retryLoad = () => {
    setError(null);
    setLoading(true);
    setReloadKey(k => k + 1);
  };

  useEffect(() => {
    async function loadProfile() {
      try {
        const profile = publicUserId ? await getProfileById(publicUserId) : await getMyProfile();
        setActiveProfile(profile as InfluencerProfile);
        
        // Auto-trigger sync if user has an instagram handle but no stats yet
        const p = profile as InfluencerProfile;
        if (!publicUserId && p.instagram_handle && !p.followers) {
          setIsSyncing(true);
          syncInstagram(p.instagram_handle)
            .then(() => {
              // Start polling every 15s for updated stats
              let attempts = 0;
              const maxAttempts = 12; // poll for up to 3 minutes
              const poll = setInterval(async () => {
                attempts++;
                try {
                  const updated = await getMyProfile();
                  const up = updated as InfluencerProfile;
                  setActiveProfile(up);
                  // Stop polling once we have real stats
                  if (up.followers > 0 || attempts >= maxAttempts) {
                    clearInterval(poll);
                    setIsSyncing(false);
                  }
                } catch {
                  if (attempts >= maxAttempts) {
                    clearInterval(poll);
                    setIsSyncing(false);
                  }
                }
              }, 15_000);
            })
            .catch(() => setIsSyncing(false));
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load profile');
      } finally {
        setLoading(false);
      }
    }
    loadProfile();
  }, [reloadKey]);

  if (loading) {
    // Skeleton in the shape of the loaded page: photo header, avatar, name, stats.
    return (
      <View style={styles.container} accessibilityLabel="Loading profile">
        <View style={{ height: height * 0.7, backgroundColor: '#1A1A1A' }} />
        <View style={[styles.mainContentContainer, { alignItems: 'center' }]}>
          <View style={[styles.avatarContainer, { backgroundColor: '#222' }]} />
          <View style={[styles.skeletonLine, { width: 160, height: 20 }]} />
          <View style={[styles.skeletonLine, { width: 110 }]} />
          <View style={[styles.skeletonLine, { width: 220, marginBottom: 32 }]} />
          <View style={[styles.skeletonLine, { alignSelf: 'stretch', height: 56 }]} />
        </View>
      </View>
    );
  }

  if (error || !activeProfile) {
    return (
      <View style={[styles.center, { paddingHorizontal: 32 }]}>
        <Ionicons name="cloud-offline-outline" size={32} color="#9A9A9A" />
        <Text style={styles.errorTitle}>Couldn't load this profile</Text>
        <Text style={styles.errorBody}>{error || 'No profile found'}</Text>
        <Pressable
          onPress={retryLoad}
          style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={styles.retryButtonText}>Try again</Text>
        </Pressable>
        {onBack && (
          <Pressable onPress={onBack} style={{ marginTop: 16, padding: 8 }} accessibilityRole="button">
            <Text style={{ color: '#9A9A9A', fontSize: 14 }}>Go back</Text>
          </Pressable>
        )}
      </View>
    );
  }

  const isValidUrl = (url?: string | null) => {
    if (!url) return false;
    if (url.startsWith('blob:') || url.startsWith('file://')) return false;
    return true;
  };

  // No stock-photo fallbacks: until the user uploads their own images, show placeholders.
  const coverImage = isValidUrl(activeProfile.cover_url) ? (activeProfile.cover_url as string) : null;
  const avatarImage = isValidUrl(activeProfile.avatar_url) ? (activeProfile.avatar_url as string) : null;

  // Combine all photos for the carousel and filter out invalid blob urls
  const validPhotos = activeProfile.photos ? activeProfile.photos.filter(isValidUrl) : [];
  const photos = validPhotos.length > 0
    ? validPhotos
    : [avatarImage, coverImage].filter((uri): uri is string => !!uri);


  const handleAddReel = async () => {
    if (publicUserId) return;
    if (!newReelUrl.trim() || !activeProfile) return;
    
    // Create a new reel object from the URL
    const newId = Math.random().toString(36).substring(7);
    const newReel = { id: newId, url: newReelUrl.trim(), views: '0' };
    const updatedReels = [newReel, ...reels];

    try {
      // Optimistically update UI
      setActiveProfile({ ...activeProfile, reels: updatedReels });
      setIsAddReelVisible(false);
      setNewReelUrl('');

      // The server fetches the thumbnail, so take its copy of the reels.
      const saved = await updateMyProfile({ reels: updatedReels }) as InfluencerProfile;
      setActiveProfile(prev => prev ? { ...prev, reels: saved.reels } : prev);
    } catch (err) {
      console.error('Failed to save reel:', err);
      // Revert on failure
      setActiveProfile({ ...activeProfile, reels });
      showAlert('Save failed', err instanceof ApiError && err.status === 400 ? err.message : 'Could not save reel. Restoring previous state.');
    }
  };

  const handleUpdateInstagram = async () => {
    if (!editInstagramHandle.trim()) return;
    try {
      setIsUpdatingInstagram(true);
      const cleanHandle = editInstagramHandle.replace(/^@/, '').trim().toLowerCase();
      // Optimistic update
      setActiveProfile(prev => prev ? { ...prev, instagram_handle: cleanHandle } : prev);
      
      // Update in DB
      await updateMyProfile({ instagram_handle: cleanHandle });
      
      // Trigger sync
      setIsEditInstagramVisible(false);
      setEditInstagramHandle('');
      
      // We don't await this so it happens in the background, which will trigger the polling UI
      syncInstagram(cleanHandle);
    } catch (e: any) {
      showAlert('Update failed', e.message || 'Could not update Instagram handle.');
    } finally {
      setIsUpdatingInstagram(false);
    }
  };

  const openEditWorkedWith = () => {
    setDraftWorkedWith(activeProfile?.worked_with || []);
    setNewWorkedWith('');
    setIsEditWorkedWithVisible(true);
  };

  const toggleDraftCompany = (company: string) => {
    const key = company.toLowerCase();
    setDraftWorkedWith(prev => prev.some(c => c.toLowerCase() === key)
      ? prev.filter(c => c.toLowerCase() !== key)
      : [...prev, company]);
  };

  const handleAddCustomCompany = () => {
    const added = newWorkedWith.trim();
    if (!added) return;
    // Use the catalog spelling when the typed name is a known brand.
    const name = COMPANY_CATALOG.find(c => c.name.toLowerCase() === added.toLowerCase())?.name || added;
    setDraftWorkedWith(prev => prev.some(c => c.toLowerCase() === name.toLowerCase()) ? prev : [...prev, name]);
    setNewWorkedWith('');
  };

  const handleSaveWorkedWith = async () => {
    const previous = activeProfile?.worked_with || [];
    try {
      setIsSavingWorkedWith(true);
      setActiveProfile(prev => prev ? { ...prev, worked_with: draftWorkedWith } : prev);
      await updateMyProfile({ worked_with: draftWorkedWith });
      setIsEditWorkedWithVisible(false);
    } catch (e) {
      setActiveProfile(prev => prev ? { ...prev, worked_with: previous } : prev);
      showAlert('Error', 'Could not update your Worked With list');
    } finally {
      setIsSavingWorkedWith(false);
    }
  };

  // Throws on failure so the review form can show the error inline.
  const handleInterested = async () => {
    if (!publicUserId || interested || sendingInterest) return;
    setSendingInterest(true);
    try {
      const res = await recordSwipe(publicUserId, 'like');
      setInterested(true);
      if (res.matched) {
        showAlert('You matched', `You and ${activeProfile?.name || 'this creator'} can talk now.`, [
          { text: 'Open chat', onPress: () => router.replace('/(brand-tabs)/messages') },
          { text: 'Later', style: 'cancel' },
        ]);
      } else {
        showAlert('Interest sent', 'If they like you back, you will match and can start talking.');
      }
    } catch (err) {
      console.error('Failed to record interest:', err);
      showAlert('Could not send that', 'Check your connection and try again.');
    } finally {
      setSendingInterest(false);
    }
  };

  const handleSaveLinkedinReviews = async (next: LinkedinReview[]) => {
    const saved = await updateMyProfile({ linkedin_reviews: next }) as InfluencerProfile;
    setActiveProfile(prev => prev ? { ...prev, linkedin_reviews: saved.linkedin_reviews ?? next } : prev);
  };

  const openEditPlatforms = () => {
    setDraftPlatforms((activeProfile?.platforms || []).map(p => p.toLowerCase()));
    setIsEditPlatformsVisible(true);
  };

  const toggleDraftPlatform = (key: string) => {
    setDraftPlatforms(prev => prev.includes(key) ? prev.filter(p => p !== key) : [...prev, key]);
  };

  const handleSavePlatforms = async () => {
    const previous = activeProfile?.platforms || [];
    try {
      setIsSavingPlatforms(true);
      setActiveProfile(prev => prev ? { ...prev, platforms: draftPlatforms } : prev);
      await updateMyProfile({ platforms: draftPlatforms });
      setIsEditPlatformsVisible(false);
    } catch (e) {
      setActiveProfile(prev => prev ? { ...prev, platforms: previous } : prev);
      showAlert('Error', 'Could not update your platforms');
    } finally {
      setIsSavingPlatforms(false);
    }
  };

  const handlePickImage = async () => {
    if (publicUserId) return;
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      const previousAvatar = activeProfile?.avatar_url;
      try {
        const uri = result.assets[0].uri;
        setActiveProfile(prev => prev ? { ...prev, avatar_url: uri } : prev);

        // Upload through /api/upload: face verification only accepts
        // photos stored under the user's own uploads folder.
        const publicUrl = await uploadImage(uri);
        await updateMyProfile({ avatar_url: publicUrl });
        setActiveProfile(prev => prev ? { ...prev, avatar_url: publicUrl } : prev);
      } catch (e) {
        setActiveProfile(prev => prev ? { ...prev, avatar_url: previousAvatar } : prev);
        showAlert('Update failed', 'Could not upload image. Reverted changes.');
      }
    }
  };



  // Placeholder prompts are for the owner only; brands viewing the profile see nothing instead.
  const name = activeProfile.name || (publicUserId ? 'Creator' : 'Your Profile');
  const niche = (activeProfile.categories || []).join(', ') || 'Creator';
  const location = activeProfile.location || (publicUserId ? null : 'Add your location');
  const bio = activeProfile.bio || (publicUserId ? null : 'Add a bio so brands know what you make.');

  const followersStr = activeProfile.followers >= 1_000_000 
    ? `${(activeProfile.followers / 1_000_000).toFixed(1)}M` 
    : activeProfile.followers >= 1000 ? `${(activeProfile.followers / 1000).toFixed(0)}k` : String(activeProfile.followers || 0);
  
  const viewsStr = activeProfile.avg_views >= 1_000_000 
    ? `${(activeProfile.avg_views / 1_000_000).toFixed(1)}M` 
    : activeProfile.avg_views >= 1000 ? `${(activeProfile.avg_views / 1000).toFixed(0)}k` : String(activeProfile.avg_views || 0);

  const engagementStr = activeProfile.engagement_rate ? `${activeProfile.engagement_rate}%` : '0%';

  const PLATFORMS_DB: Record<string, { label: string, bg: string, icon: React.ReactNode }> = {
    instagram: { label: 'Instagram', bg: '#E1306C', icon: <FontAwesome6 name="instagram" size={16} color="#FFF" /> },
    youtube: { label: 'YouTube', bg: '#FF0000', icon: <FontAwesome6 name="youtube" size={16} color="#FFF" /> },
    tiktok: { label: 'TikTok', bg: '#000000', icon: <FontAwesome6 name="tiktok" size={16} color="#FFF" /> },
    x: { label: 'X', bg: '#000000', icon: <FontAwesome6 name="x-twitter" size={16} color="#FFF" /> },
    twitter: { label: 'Twitter', bg: '#1DA1F2', icon: <FontAwesome6 name="twitter" size={16} color="#FFF" /> },
    reddit: { label: 'Reddit', bg: '#FF6B2B', icon: <FontAwesome6 name="reddit-alien" size={16} color="#FFF" /> },
    pinterest: { label: 'Pinterest', bg: '#E60023', icon: <FontAwesome6 name="pinterest" size={16} color="#FFF" /> },
    facebook: { label: 'Facebook', bg: '#1877F2', icon: <FontAwesome6 name="facebook-f" size={16} color="#FFF" /> },
    linkedin: { label: 'LinkedIn', bg: '#0A66C2', icon: <FontAwesome6 name="linkedin-in" size={16} color="#FFF" /> },
    snapchat: { label: 'Snapchat', bg: '#FFFC00', icon: <FontAwesome6 name="snapchat" size={16} color="#000" /> },
    threads: { label: 'Threads', bg: '#000000', icon: <FontAwesome6 name="threads" size={16} color="#FFF" /> },
    spotify: { label: 'Spotify', bg: '#1DB954', icon: <FontAwesome6 name="spotify" size={16} color="#FFF" /> },
    twitch: { label: 'Twitch', bg: '#9146FF', icon: <FontAwesome6 name="twitch" size={16} color="#FFF" /> },
    discord: { label: 'Discord', bg: '#5865F2', icon: <FontAwesome6 name="discord" size={16} color="#FFF" /> },
    behance: { label: 'Behance', bg: '#1769FF', icon: <FontAwesome6 name="behance" size={16} color="#FFF" /> },
    dribbble: { label: 'Dribbble', bg: '#EA4C89', icon: <FontAwesome6 name="dribbble" size={16} color="#FFF" /> },
  };

  const platformsList = (activeProfile.platforms || []).map(p => {
    const matchedKey = Object.keys(PLATFORMS_DB).find(k => k.toLowerCase() === p.toLowerCase());
    return {
      name: p,
      ...(matchedKey ? PLATFORMS_DB[matchedKey] : { label: p, bg: '#FF6B2B', icon: <FontAwesome6 name="star" size={16} color="#FFF" /> })
    };
  });
  const workedWith = activeProfile.worked_with || [];

  // Catalog brands first, then any custom companies the user has saved or just added.
  const companyOptions = [
    ...COMPANY_CATALOG.map(c => c.name),
    ...[...workedWith, ...draftWorkedWith].filter((c, i, all) =>
      !COMPANY_CATALOG.some(k => k.name.toLowerCase() === c.toLowerCase())
      && all.findIndex(o => o.toLowerCase() === c.toLowerCase()) === i),
  ];

  // `twitter` stays in PLATFORMS_DB so older profiles still render, but new picks use X.
  const pickablePlatforms = Object.keys(PLATFORMS_DB).filter(k => k !== 'twitter');

  const packages = [
    { type: 'story', name: 'Story Package', desc: '1 Instagram Story · 24hr visibility', price: '1000' },
    { type: 'reel', name: 'Reel Package', desc: '1 Reel (30-60 sec) · Edited & tagged', price: '8000' },
    { type: 'ugc', name: 'UGC Package', desc: '1 UGC Video · Raw + Edited', price: '12000' },
    { type: 'brand', name: 'Brand Partnership', desc: 'Custom scope, agreed with the brand', price: '20000' },
  ];

  const headerTranslateY = scrollY.interpolate({
    inputRange: [0, height],
    outputRange: [0, reduceMotion ? 0 : height * 0.5],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.container}>
      {onBack && (
        <View style={{ position: 'absolute', top: insets.top + 8, left: 16, zIndex: 10 }}>
          <Pressable onPress={onBack} style={{ width: 40, height: 40, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, justifyContent: 'center', alignItems: 'center' }}>
            <Ionicons name="arrow-back" size={24} color="#FFF" />
          </Pressable>
        </View>
      )}

      <View style={{ position: 'absolute', top: insets.top + 8, right: 16, zIndex: 10 }}>
        <Pressable
          accessibilityLabel={publicUserId ? 'Report or block' : 'Account options'}
          onPress={() =>
            publicUserId
              ? openSafetyMenu({
                  userId: publicUserId,
                  name: activeProfile?.name || 'this user',
                  target: { type: 'user', id: publicUserId },
                  onBlocked: onBack,
                })
              : openAccountMenu({ signOut, deleteAccount, email: user?.email })
          }
          accessibilityRole="button"
          hitSlop={8}
          style={({ pressed }) => [{ width: 40, height: 40, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, justifyContent: 'center', alignItems: 'center' }, pressed && styles.pressed]}
        >
          <Ionicons name={publicUserId ? 'ellipsis-horizontal' : 'settings-outline'} size={20} color="#FFF" />
        </Pressable>
      </View>

      <Animated.ScrollView 
        style={{ flex: 1 }} 
        bounces={false} 
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true }
        )}
      >
        {/* ── Carousel Header ── */}
        <Animated.View style={{ height: height * 0.7, width, transform: [{ translateY: headerTranslateY }] }}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            bounces={false}
            onMomentumScrollEnd={(e) => {
              const newIndex = Math.round(e.nativeEvent.contentOffset.x / width);
              setCurrentPhotoIndex(newIndex);
            }}
            style={StyleSheet.absoluteFill}
          >
            {photos.length === 0 && (
              <View style={{ width, height: height * 0.7, backgroundColor: '#1A1A1A', justifyContent: 'center', alignItems: 'center' }}>
                <Ionicons name="images-outline" size={36} color="#555" />
                <Text style={{ color: '#9A9A9A', fontSize: 13, marginTop: 8 }}>
                  {publicUserId ? 'No photos yet' : 'Tap your avatar below to add a photo'}
                </Text>
              </View>
            )}
            {photos.map((photoUri, idx) => (
              <Image 
                key={idx}
                source={{ uri: photoUri }} 
                style={{ width, height: height * 0.7 }}
                resizeMode="cover"
              />
            ))}
          </ScrollView>
          <LinearGradient
            colors={['rgba(0,0,0,0.3)', 'transparent', 'rgba(17,17,17,0.5)', '#111111']}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          {/* Progress Bars */}
          <View style={[styles.progressContainer, { pointerEvents: 'none', position: 'absolute', left: 16, right: 16 }]}>
            {photos.length > 1 && photos.map((_, i) => (
              <View key={i} style={[styles.progressBar, i <= currentPhotoIndex ? styles.progressBarActive : {}]} />
            ))}
          </View>
        </Animated.View>

        {/* ── Main Content Area (Overlapping) ── */}
        <View style={[styles.mainContentContainer, { minHeight: height }]} >
        
        {/* ── Avatar Image (Overlapping) ── */}
        <Pressable style={styles.avatarContainer} onPress={handlePickImage}>
          {avatarImage ? (
            <Image
              source={{ uri: avatarImage }}
              style={styles.avatar}
            />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Ionicons name="person" size={40} color="#777" />
            </View>
          )}
          {!publicUserId && (
            <View style={{ position: 'absolute', bottom: 4, right: 4, backgroundColor: '#FF6B2B', borderRadius: 14, width: 28, height: 28, justifyContent: 'center', alignItems: 'center', elevation: 4, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.3, shadowRadius: 3 }}>
              <Ionicons name="camera" size={14} color="#FFF" />
            </View>
          )}
        </Pressable>

        {/* ── Info Section ── */}
        <View style={styles.infoSection}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{name}{activeProfile.age ? `, ${activeProfile.age}` : ''}</Text>
            {activeProfile.verified ? (
              <MaterialIcons name="verified" size={20} color="#FF6B2B" style={{ marginLeft: 8 }} />
            ) : !publicUserId ? (
              <TouchableOpacity style={styles.verifyButton} onPress={() => setIsVerificationModalVisible(true)}>
                <Text style={styles.verifyButtonText}>Get Verified</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {/* ── Instagram Handle ── */}
          {activeProfile.instagram_handle ? (
            <TouchableOpacity 
              style={styles.instagramHandleRow}
              onPress={() => {
                if (!publicUserId) {
                  setEditInstagramHandle(activeProfile.instagram_handle || '');
                  setIsEditInstagramVisible(true);
                }
              }}
              disabled={!!publicUserId}
            >
              <FontAwesome6 name="instagram" size={13} color="#E1306C" />
              <Text style={styles.instagramHandleText}>@{activeProfile.instagram_handle}</Text>
              {!publicUserId && <Ionicons name="pencil" size={12} color="#888" style={{ marginLeft: 4 }} />}
            </TouchableOpacity>
          ) : !publicUserId ? (
            <TouchableOpacity 
              style={styles.instagramHandleRow}
              onPress={() => {
                setEditInstagramHandle('');
                setIsEditInstagramVisible(true);
              }}
            >
              <FontAwesome6 name="instagram" size={13} color="#888" />
              <Text style={[styles.instagramHandleText, { color: '#888' }]}>Add Instagram Handle</Text>
            </TouchableOpacity>
          ) : null}

          <Text style={styles.niche}>{niche}</Text>

          {location && (
            <View style={styles.locationRow}>
              <Ionicons name="location-sharp" size={13} color="#9A9A9A" />
              <Text style={styles.locationText}>{location}</Text>
            </View>
          )}

          {bio && <Text style={styles.bio}>{bio}</Text>}
        </View>

        {/* ── Stats Row ── */}
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statVal}>{followersStr}</Text>
            <Text style={styles.statLbl}>Followers</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={styles.statVal}>{engagementStr}</Text>
            <Text style={styles.statLbl}>Engagement</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={styles.statVal}>{viewsStr}</Text>
            <Text style={styles.statLbl}>Avg Views</Text>
          </View>
        </View>

        {/* ── Instagram Sync Banner ── */}
        {isSyncing && (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 8, gap: 8 }}>
            <ActivityIndicator size="small" color="#FF6B2B" />
            <Text style={{ color: '#AAA', fontSize: 12 }}>Fetching Instagram stats…</Text>
          </View>
        )}

        {/* ── Worked With ── */}
        {(workedWith.length > 0 || !publicUserId) && (
          <View style={styles.sectionCentered}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
              <Text style={[styles.smallSubtitleCentered, { marginBottom: 0 }]}>Worked With</Text>
              {!publicUserId && (
                <TouchableOpacity onPress={openEditWorkedWith} style={{ marginLeft: 8 }} accessibilityLabel="Edit worked with">
                  <Ionicons name="pencil" size={14} color="#888" />
                </TouchableOpacity>
              )}
            </View>
            {workedWith.length > 0 ? (
              <View style={styles.platformRow}>
                {workedWith.map((company) => {
                  const logo = companyLogo(company);
                  return (
                    <View key={company} style={[styles.platformCircle, { backgroundColor: logo.bg }]} accessibilityLabel={company}>
                      {logo.icon}
                    </View>
                  );
                })}
              </View>
            ) : (
              <TouchableOpacity onPress={openEditWorkedWith}>
                <Text style={{ color: '#888', fontSize: 13 }}>Add companies you've worked with</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── Available On ── */}
        {(platformsList.length > 0 || !publicUserId) && (
          <View style={styles.sectionCentered}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
              <Text style={[styles.smallSubtitleCentered, { marginBottom: 0 }]}>Available on</Text>
              {!publicUserId && (
                <TouchableOpacity onPress={openEditPlatforms} style={{ marginLeft: 8 }} accessibilityLabel="Edit platforms">
                  <Ionicons name="pencil" size={14} color="#888" />
                </TouchableOpacity>
              )}
            </View>
            {platformsList.length > 0 ? (
              <View style={styles.platformRow}>
                {platformsList.map((p) => (
                  <View key={p.name} style={[styles.platformCircle, { backgroundColor: p.bg }]} accessibilityLabel={p.label}>
                    {p.icon}
                  </View>
                ))}
              </View>
            ) : (
              <TouchableOpacity onPress={openEditPlatforms}>
                <Text style={{ color: '#888', fontSize: 13 }}>Add the platforms you create on</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── Top Reels ── */}
        {(reels.length > 0 || !publicUserId) && (
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.smallSubtitle}>Top Reels</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
             {/* Add Reel Button */}
            {!publicUserId && (
              <Pressable
                style={({ pressed }) => [styles.addReelCard, pressed && styles.pressed]}
                onPress={() => setIsAddReelVisible(true)}
                accessibilityRole="button"
              >
                <View style={styles.addReelIconBg}>
                  <Ionicons name="add" size={32} color="#888" />
                </View>
                <Text style={styles.addReelText}>Add Reel</Text>
              </Pressable>
            )}

             {reels.map((item) => (
               <Pressable 
                 key={item.id} 
                 style={styles.dummyReel}
                 onPress={() => {
                   if (item.url) {
                     Linking.openURL(item.url).catch(err => console.error("Couldn't open reel URL", err));
                   }
                 }}
               >
                 <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }]}>
                   {item.thumbnail_url ? (
                     <Image source={{ uri: item.thumbnail_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                   ) : (
                     <View style={{ padding: 8, alignItems: 'center' }}>
                       <Ionicons name="logo-instagram" size={24} color="#888" />
                       <Text style={{color: '#888', fontSize: 10, marginTop: 8, textAlign: 'center'}} numberOfLines={2}>
                         {item.url.replace('https://www.instagram.com/', '')}
                       </Text>
                     </View>
                   )}
                 </View>
                 <View style={styles.reelViewsOverlay}>
                   <Ionicons name="play-outline" size={10} color="#FFF" />
                   <Text style={styles.reelViewsText}>{item.views}</Text>
                 </View>
               </Pressable>
             ))}
          </ScrollView>
        </View>
        )}

        {/* ── Tabs ── */}
        <View style={styles.tabRow}>
          {(['overview', 'engagement', 'audience'] as Tab[]).map((t) => (
            <Pressable
              key={t}
              style={[styles.tabPill, activeTab === t && styles.tabPillActive]}
              onPress={() => setActiveTab(t)}
            >
              <Text style={[styles.tabPillText, activeTab === t && styles.tabPillTextActive]}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* ── Tab Content ── */}
        <View style={{ position: 'relative', overflow: 'hidden', minHeight: 400 }}>
        {activeTab === 'overview' && (
          <View style={styles.tabContent}>
            <Text style={styles.bigSectionTitle}>Summary</Text>
            <View style={styles.summaryGrid}>
              {[
                [{ label: 'Views', value: '3,476' }, { label: 'Accounts Reached', value: '3,476' }],
                [{ label: 'Average Watch Time', value: '4h 15m' }, { label: 'Follows', value: '500' }],
              ].map((row, rowIdx) => (
                <View key={rowIdx} style={styles.summaryRow}>
                  {row.map((item) => (
                    <View key={item.label} style={styles.summaryCard}>
                      <Text style={styles.summaryCardLabel}>{item.label}</Text>
                      <Text style={styles.summaryCardValue}>{item.value}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>

            <View style={{ marginTop: 24, marginBottom: 24 }}>
              <Text style={styles.bigSectionTitle}>What affects their views</Text>
              <Text style={styles.sectionSubtitle}>Rates are listed in order of importance to reach</Text>
              <View style={styles.ratesList}>
                {[
                  { label: 'Skip Rate', val: '58.7%', icon: 'clock', type: 'feather' },
                  { label: 'Share Rate', val: '1.0%', icon: 'send', type: 'feather' },
                  { label: 'Like Rate', val: '1.7%', icon: 'heart', type: 'feather' },
                  { label: 'Save Rate', val: '0.8%', icon: 'bookmark', type: 'feather' },
                  { label: 'Repost Rate', val: '0.2%', icon: 'repeat', type: 'feather' },
                  { label: 'Comment Rate', val: '0.3%', icon: 'message-circle', type: 'feather' },
                ].map((rate, idx) => (
                  <View key={idx} style={styles.rateRow}>
                    <View style={styles.rateIconBox}>
                      <Feather name={rate.icon as any} size={16} color="#aaa" />
                    </View>
                    <Text style={styles.rateLabel}>{rate.label}</Text>
                    <Text style={styles.rateValue}>{rate.val}</Text>
                  </View>
                ))}
              </View>
            </View>
            
            <View style={{ alignItems: 'center', marginBottom: 40 }}>
              <Text style={[styles.bigSectionTitle, { textAlign: 'center', width: 200, marginBottom: 40 }]}>How long people have watched their reel</Text>
              <View style={{ alignSelf: 'stretch', alignItems: 'center', paddingRight: 20 }}>
                <LineChart width={width - 24} />
              </View>
            </View>
          </View>
        )}

        {activeTab === 'engagement' && (
          <View style={styles.tabContent}>
            
            <Text style={[styles.bigSectionTitle, { marginBottom: 20 }]}>Actions after viewing</Text>
            
            <View style={{ marginBottom: 40 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <Text style={{ color: '#E0E0E0', fontSize: 15 }}>Profile Visits</Text>
                <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '600' }}>5</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <Text style={{ color: '#E0E0E0', fontSize: 15 }}>Follows</Text>
                <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '600' }}>8</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <Text style={{ color: '#E0E0E0', fontSize: 15 }}>Bio link taps</Text>
                <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '600' }}>4</Text>
              </View>
            </View>

            <Text style={[styles.bigSectionTitle, { marginBottom: 20 }]}>Interactions</Text>
            
            <View style={{ marginBottom: 20 }}>
              <View style={{ marginBottom: 20 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <Text style={{ color: '#E0E0E0', fontSize: 15 }}>Likes and Reactions</Text>
                  <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '600' }}>47</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <Text style={{ color: '#888', fontSize: 11, fontWeight: '500' }}>Instagram</Text>
                  <Text style={{ color: '#888', fontSize: 11, fontWeight: '600' }}>23</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: '#888', fontSize: 11, fontWeight: '500' }}>Facebook</Text>
                  <Text style={{ color: '#888', fontSize: 11, fontWeight: '600' }}>24</Text>
                </View>
              </View>

              <View style={{ marginBottom: 20 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <Text style={{ color: '#E0E0E0', fontSize: 15 }}>Comments</Text>
                  <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '600' }}>8</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <Text style={{ color: '#888', fontSize: 11, fontWeight: '500' }}>Instagram</Text>
                  <Text style={{ color: '#888', fontSize: 11, fontWeight: '600' }}>5</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: '#888', fontSize: 11, fontWeight: '500' }}>Facebook</Text>
                  <Text style={{ color: '#888', fontSize: 11, fontWeight: '600' }}>3</Text>
                </View>
              </View>

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <Text style={{ color: '#E0E0E0', fontSize: 15 }}>Reposts</Text>
                <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '600' }}>5</Text>
              </View>
              
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <Text style={{ color: '#E0E0E0', fontSize: 15 }}>Shares</Text>
                <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '600' }}>28</Text>
              </View>

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <Text style={{ color: '#E0E0E0', fontSize: 15 }}>Saves</Text>
                <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '600' }}>23</Text>
              </View>
            </View>

            <View style={{ alignItems: 'center', marginTop: 10, marginBottom: 40 }}>
              <Text style={[styles.bigSectionTitle, { textAlign: 'center', marginBottom: 40 }]}>When people liked their reel</Text>
              <View style={{ alignSelf: 'stretch', alignItems: 'center', paddingRight: 20 }}>
                <LineChart width={width - 24} />
              </View>
            </View>

          </View>
        )}

        {activeTab === 'audience' && (
          <View style={styles.tabContent}>
            
            {/* Demographics Filters (Pills) */}
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 12, marginBottom: 40, marginTop: 10 }}>
              <View style={{ backgroundColor: '#FFF', paddingVertical: 8, paddingHorizontal: 24, borderRadius: 20 }}>
                <Text style={{ color: '#000', fontSize: 13, fontWeight: '600' }}>Age</Text>
              </View>
              <View style={{ backgroundColor: 'rgba(255,255,255,0.1)', paddingVertical: 8, paddingHorizontal: 24, borderRadius: 20 }}>
                <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '600' }}>Gender</Text>
              </View>
              <View style={{ backgroundColor: 'rgba(255,255,255,0.1)', paddingVertical: 8, paddingHorizontal: 24, borderRadius: 20 }}>
                <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '600' }}>Locations</Text>
              </View>
            </View>

            {/* Horizontal Bar Chart */}
            <View style={{ marginBottom: 40 }}>
              {[
                { label: '13-17', val: 5 },
                { label: '18-24', val: 25 },
                { label: '25-34', val: 40 },
                { label: '35-44', val: 20 },
                { label: '45-54', val: 8 },
                { label: '55+', val: 2 },
              ].map((row, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                  <Text style={{ color: '#E0E0E0', fontSize: 12, width: 45 }}>{row.label}</Text>
                  <View style={{ flex: 1, height: 8, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 4, marginHorizontal: 12, overflow: 'hidden' }}>
                    <View style={{ width: `${row.val}%`, height: '100%', backgroundColor: '#FF6B2B', borderRadius: 4 }} />
                  </View>
                  <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '600', width: 35, textAlign: 'right' }}>{row.val}%</Text>
                </View>
              ))}
            </View>

          </View>
        )}
        
          {/* Premium Overlay */}
          {!isPremium && (
            <BlurView intensity={30} tint="dark" style={[StyleSheet.absoluteFill, { zIndex: 10, justifyContent: 'center', alignItems: 'center' }]}>
              <View style={styles.premiumBanner}>
                <View style={styles.heartCircle}>
                  <Ionicons name="lock-closed" size={24} color="#FF6B2B" />
                </View>
                <Text style={styles.premiumTitle}>Unlock Analytics</Text>
                <Text style={styles.premiumSubtitle}>
                  Activate Matchr Premium to see advanced insights and analytics for this profile.
                </Text>
                <Pressable style={styles.premiumBtn}>
                  <Text style={styles.premiumBtnText}>Activate Premium</Text>
                </Pressable>
              </View>
            </BlurView>
          )}
        </View>

        {/* ── Rates (Packages) ── */}
        <View style={[styles.section, { paddingTop: 20 }]}>
          <Text style={[styles.packagesTitle, { marginBottom: 20 }]}>Packages</Text>
          <View style={styles.packagesContainer}>
            {packages.map((pkg, idx) => (
              <View key={idx} style={styles.packageCard}>
                <View style={styles.packageIconContainer}>
                  {pkg.type === 'story' && (
                    <StoryPackageIcon size={28} color="#FFF" />
                  )}
                  {pkg.type === 'reel' && (
                    <ReelPackageIcon size={28} color="#FFF" />
                  )}
                  {pkg.type === 'ugc' && (
                    <UgcPackageIcon size={28} color="#FFF" />
                  )}
                  {pkg.type === 'brand' && (
                    <BrandPackageIcon size={28} color="#FFF" />
                  )}
                </View>
                <View style={styles.packageDetails}>
                  <Text style={styles.packageName}>{pkg.name}</Text>
                  <Text style={styles.packageDesc}>{pkg.desc}</Text>
                </View>
                <Text style={styles.packagePriceLabel}>₹{pkg.price.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</Text>
              </View>
            ))}

            {/* Custom Package */}
            <View style={styles.packageCard}>
              <View style={styles.packageIconContainer}>
                <View style={styles.customIconBg}>
                  <Ionicons name="add" size={24} color="#FF6B2B" />
                </View>
              </View>
              <View style={styles.packageDetails}>
                <Text style={styles.packageName}>Custom package</Text>
                <Text style={styles.packageDesc}>Have something else in mind?</Text>
              </View>
              <View style={styles.requestQuoteBtn}>
                <Text style={styles.requestQuoteText}>Request Quote</Text>
              </View>
            </View>
          </View>
        </View>

        {/* ── LinkedIn Reviews ── */}
        <LinkedinReviews
          reviews={activeProfile.linkedin_reviews || []}
          editable={!publicUserId}
          ownerName={activeProfile.name || ''}
          onSave={handleSaveLinkedinReviews}
        />

        {/* ── Interest button (public profile only) ── */}
        {!!publicUserId && (
          <Pressable
            style={({ pressed }) => [
              styles.chatButton,
              interested && styles.chatButtonDone,
              pressed && !interested && styles.pressed,
            ]}
            onPress={handleInterested}
            disabled={interested || sendingInterest}
            accessibilityRole="button"
            accessibilityState={{ disabled: interested || sendingInterest, busy: sendingInterest }}
          >
            {sendingInterest ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <Text style={[styles.chatButtonText, interested && styles.chatButtonTextDone]}>
                {interested ? 'Interest sent' : 'Interested'}
              </Text>
            )}
          </Pressable>
        )}

        {/* ── Bottom Padding ── */}
        <View style={{ height: 40 }} />

      </View>
      </Animated.ScrollView>
      {/* ── Edit Instagram Modal ── */}
      <Modal visible={isEditInstagramVisible} transparent animationType="slide" onRequestClose={() => setIsEditInstagramVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Instagram Handle</Text>
              <Pressable onPress={() => setIsEditInstagramVisible(false)}>
                <Ionicons name="close" size={24} color="#FFF" />
              </Pressable>
            </View>
            <Text style={styles.modalSubtitle}>Enter your Instagram username to automatically sync followers, engagement, and views.</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. cristiano"
              placeholderTextColor="#666"
              value={editInstagramHandle}
              onChangeText={setEditInstagramHandle}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={Keyboard.dismiss}
            />
            <Pressable
              style={({ pressed }) => [styles.modalButton, pressed && styles.pressed, isUpdatingInstagram && { opacity: 0.5 }]}
              onPress={() => { Keyboard.dismiss(); handleUpdateInstagram(); }}
              disabled={isUpdatingInstagram}
            >
              {isUpdatingInstagram ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.modalButtonText}>Save & Sync</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>



      {/* ── Add Reel Modal ── */}
      <Modal visible={isAddReelVisible} transparent animationType="slide" onRequestClose={() => setIsAddReelVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Instagram Reel</Text>
              <Pressable onPress={() => setIsAddReelVisible(false)}>
                <Ionicons name="close" size={24} color="#FFF" />
              </Pressable>
            </View>
            <Text style={styles.modalSubtitle}>Paste the link to your Instagram Reel to showcase it on your profile.</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="https://www.instagram.com/reel/..."
              placeholderTextColor="#666"
              value={newReelUrl}
              onChangeText={setNewReelUrl}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={Keyboard.dismiss}
            />
            <Pressable
              style={({ pressed }) => [styles.modalButton, pressed && styles.pressed, !newReelUrl.trim() && { opacity: 0.5 }]}
              onPress={() => { Keyboard.dismiss(); handleAddReel(); }}
              disabled={!newReelUrl.trim()}
            >
              <Text style={styles.modalButtonText}>Add Reel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── Edit Worked With Modal ── */}
      <Modal visible={isEditWorkedWithVisible} transparent animationType="slide" onRequestClose={() => setIsEditWorkedWithVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Worked With</Text>
              <Pressable onPress={() => setIsEditWorkedWithVisible(false)}>
                <Ionicons name="close" size={24} color="#FFF" />
              </Pressable>
            </View>
            <Text style={styles.modalSubtitle}>Select the brands you have collaborated with.</Text>

            <View style={{ maxHeight: 280, width: '100%', marginBottom: 16 }}>
              <ScrollView contentContainerStyle={[styles.platformRow, { justifyContent: 'flex-start', gap: 8 }]}>
                {companyOptions.map((company) => {
                  const selected = draftWorkedWith.some(c => c.toLowerCase() === company.toLowerCase());
                  const logo = companyLogo(company);
                  return (
                    <Pressable
                      key={company}
                      onPress={() => toggleDraftCompany(company)}
                      style={[styles.platformChip, selected && styles.platformChipSelected]}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                    >
                      <View style={[styles.platformChipIcon, { backgroundColor: logo.bg }]}>
                        {logo.icon}
                      </View>
                      <Text style={styles.platformChipText}>{company}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            <View style={{ flexDirection: 'row', marginBottom: 16 }}>
              <TextInput
                style={[styles.modalInput, { flex: 1, marginBottom: 0 }]}
                placeholder="Another company"
                placeholderTextColor="#666"
                value={newWorkedWith}
                onChangeText={setNewWorkedWith}
                maxLength={60}
                returnKeyType="done"
                onSubmitEditing={() => { Keyboard.dismiss(); handleAddCustomCompany(); }}
              />
              <Pressable style={[styles.modalButton, { paddingHorizontal: 16, marginLeft: 10, marginBottom: 0, alignSelf: 'stretch', justifyContent: 'center', backgroundColor: '#222' }]} onPress={handleAddCustomCompany}>
                <Text style={styles.modalButtonText}>Add</Text>
              </Pressable>
            </View>

            <Pressable
              style={({ pressed }) => [styles.modalButton, pressed && styles.pressed, isSavingWorkedWith && { opacity: 0.6 }]}
              onPress={handleSaveWorkedWith}
              disabled={isSavingWorkedWith}
            >
              {isSavingWorkedWith
                ? <ActivityIndicator color="#FFF" />
                : <Text style={styles.modalButtonText}>Save</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── Edit Platforms Modal ── */}
      <Modal visible={isEditPlatformsVisible} transparent animationType="slide" onRequestClose={() => setIsEditPlatformsVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Available On</Text>
              <Pressable onPress={() => setIsEditPlatformsVisible(false)}>
                <Ionicons name="close" size={24} color="#FFF" />
              </Pressable>
            </View>
            <Text style={styles.modalSubtitle}>Select the platforms where brands can work with you.</Text>

            <View style={{ maxHeight: 320, width: '100%', marginBottom: 20 }}>
              <ScrollView contentContainerStyle={[styles.platformRow, { justifyContent: 'flex-start', gap: 8 }]}>
                {pickablePlatforms.map((key) => {
                  const selected = draftPlatforms.includes(key);
                  const platform = PLATFORMS_DB[key];
                  return (
                    <Pressable
                      key={key}
                      onPress={() => toggleDraftPlatform(key)}
                      style={[styles.platformChip, selected && styles.platformChipSelected]}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                    >
                      <View style={[styles.platformChipIcon, { backgroundColor: platform.bg }]}>
                        {platform.icon}
                      </View>
                      <Text style={styles.platformChipText}>{platform.label}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            <Pressable
              style={({ pressed }) => [styles.modalButton, pressed && styles.pressed, isSavingPlatforms && { opacity: 0.6 }]}
              onPress={handleSavePlatforms}
              disabled={isSavingPlatforms}
            >
              {isSavingPlatforms
                ? <ActivityIndicator color="#FFF" />
                : <Text style={styles.modalButtonText}>Save</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>

      <VerificationModal
        visible={isVerificationModalVisible}
        onClose={() => setIsVerificationModalVisible(false)}
        onVerified={async () => {
          try {
            await updateMyProfile({ verified: true });
            setActiveProfile({ ...activeProfile, verified: true });
            setIsVerificationModalVisible(false);
          } catch (e: any) {
            showAlert("Error", e.message || "Failed to verify profile.");
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111111',
  },
  center: {
    flex: 1,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
  },

  mainContentContainer: {
    backgroundColor: '#111111',
    borderTopLeftRadius: 40,
    borderTopRightRadius: 40,
    marginTop: -40,
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  progressContainer: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
    zIndex: 10,
    boxShadow: '0px 1px 2px rgba(0,0,0,0.8)',
    elevation: 3,
  },
  progressBar: {
    flex: 1,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.4)',
    borderRadius: 1,
  },
  progressBarActive: {
    backgroundColor: '#FFF',
  },
  avatarContainer: {
    alignSelf: 'center',
    marginTop: -45,
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 3,
    borderColor: '#111111',
    backgroundColor: '#333',
    overflow: 'hidden',
    marginBottom: 16,
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  avatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  name: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFF',
  },
  verifyButton: {
    backgroundColor: 'rgba(255, 107, 43, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginLeft: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 43, 0.3)',
  },
  verifyButtonText: {
    color: '#FF6B2B',
    fontSize: 12,
    fontWeight: '600',
  },
  instagramHandleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
  },
  instagramHandleText: {
    fontSize: 13,
    color: '#E1306C',
    fontWeight: '500',
  },
  niche: {
    fontSize: 14,
    color: '#DDD',
    fontWeight: '400',
    marginTop: 4,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 4,
  },
  locationText: {
    fontSize: 12,
    color: '#9A9A9A',
  },
  bio: {
    fontSize: 13,
    color: '#B5B5B5',
    lineHeight: 19,
    marginTop: 16,
    textAlign: 'center',
    paddingHorizontal: 10,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 32,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  statBox: {
    alignItems: 'center',
    flex: 1,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    height: 28,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  statVal: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFF',
    letterSpacing: -0.3,
    marginBottom: 2,
    fontVariant: ['tabular-nums'],
  },
  statLbl: {
    fontSize: 11,
    color: '#9A9A9A',
  },
  section: {
    marginBottom: 28,
  },
  sectionCentered: {
    marginBottom: 28,
    alignItems: 'center',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  smallSubtitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFF',
  },
  smallSubtitleCentered: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFF',
    marginBottom: 12,
  },
  platformRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
  },
  platformChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingLeft: 8,
    paddingRight: 12,
    borderRadius: 20,
    backgroundColor: '#222',
    borderWidth: 1,
    borderColor: '#222',
  },
  platformChipSelected: {
    borderColor: '#FF6B2B',
    backgroundColor: 'rgba(255,107,43,0.12)',
  },
  platformChipIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  platformChipText: {
    color: '#FFF',
    fontSize: 13,
  },
  platformCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dummyReel: {
    width: 100,
    height: 150,
    borderRadius: 12,
    backgroundColor: '#333',
    overflow: 'hidden',
  },
  reelViewsOverlay: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  reelViewsText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '600',
  },
  tabRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 24,
    gap: 12,
  },
  tabPill: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'transparent',
  },
  tabPillActive: {
    borderColor: '#FFF',
    backgroundColor: '#FFF',
  },
  tabPillText: {
    color: '#9A9A9A',
    fontSize: 12,
    fontWeight: '500',
  },
  tabPillTextActive: {
    color: '#111111',
    fontWeight: '600',
  },
  tabContent: {
    flex: 1,
  },
  bigSectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 16,
  },
  summaryGrid: {
    gap: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 12,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: '#1E1E1E',
    borderRadius: 12,
    padding: 16,
  },
  summaryCardLabel: {
    fontSize: 11,
    color: '#888',
    marginBottom: 8,
  },
  summaryCardValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFF',
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#888',
    marginBottom: 16,
  },
  ratesList: {
    gap: 16,
  },
  rateRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rateIconBox: {
    width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  rateLabel: {
    flex: 1, fontSize: 13, color: '#E0E0E0',
  },
  rateValue: {
    fontSize: 13, fontWeight: '600', color: '#FFF',
  },
  packagesTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFF',
  },
  packagesContainer: {
    gap: 12,
  },
  packageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#050505',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  packageIconContainer: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  storyIconBg: {
    width: 32,
    height: 32,
    backgroundColor: '#FFF',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  customIconBg: {
    width: 40,
    height: 40,
    backgroundColor: 'transparent',
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  packageDetails: {
    flex: 1,
  },
  packageName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
    marginBottom: 4,
  },
  packageDesc: {
    fontSize: 12,
    color: '#8A8A8A',
  },
  packagePriceLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FF6B2B',
  },
  requestQuoteBtn: {
    backgroundColor: '#FF6B2B',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  requestQuoteText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
  chatButtonDone: { backgroundColor: '#1E1E1E', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)' },
  chatButtonTextDone: { color: '#8A8A8A' },
  chatButton: {
    backgroundColor: '#FF6B2B',
    borderRadius: 12,
    paddingVertical: 16,
    width: '60%',
    alignSelf: 'center',
    alignItems: 'center',
    marginBottom: 60,
  },
  chatButtonText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '700',
  },
  addReelCard: {
    width: 100,
    height: 150,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  addReelIconBg: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  addReelText: {
    color: '#888',
    fontSize: 12,
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#111111',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    minHeight: 250,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFF',
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#AAA',
    marginBottom: 24,
    lineHeight: 20,
  },
  modalInput: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#FFF',
    fontSize: 14,
    marginBottom: 24,
  },
  modalButton: {
    backgroundColor: '#FF6B2B',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  modalButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.85 },
  skeletonLine: { height: 12, borderRadius: 6, backgroundColor: '#1E1E1E', marginBottom: 12 },
  errorTitle: { color: '#FFF', fontSize: 17, fontWeight: '600', marginTop: 16, marginBottom: 6, textAlign: 'center' },
  errorBody: { color: '#9A9A9A', fontSize: 13, lineHeight: 19, textAlign: 'center', marginBottom: 24 },
  retryButton: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 28 },
  retryButtonText: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  premiumBanner: { alignItems: 'center', paddingHorizontal: 32 },
  heartCircle: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  premiumTitle: { color: '#FFF', fontSize: 20, fontWeight: '700', marginBottom: 10 },
  premiumSubtitle: { color: '#FFF', fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  premiumBtn: { backgroundColor: '#FFF', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 24 },
  premiumBtnText: { color: '#000', fontSize: 14, fontWeight: '700' },
});