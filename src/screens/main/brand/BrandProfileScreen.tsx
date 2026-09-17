import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  ImageBackground,
  useWindowDimensions,
  SafeAreaView,
  ActivityIndicator,
  Alert,
  Keyboard,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons, FontAwesome6 } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '@/contexts/AuthContext';
import { getMyProfile, updateMyProfile, uploadImage, getProfileById } from '@/api';
import { openAccountMenu, openSafetyMenu } from '@/components/safetyMenu';
import { ReelsIcon } from '@/components/ReelsIcon';
import { StoriesIcon } from '@/components/StoriesIcon';
import { PostIcon } from '@/components/PostIcon';
import { MatchrLogo } from '@/components/MatchrLogo';
import { PremiumIcon, MinimalIcon, BoldIcon, AuthenticIcon, GenzIcon } from '@/components/VibeIcons';
import { TaskIcon, HeartBubbleIcon, UsersIcon, CashIcon, EventIcon } from '@/components/CampaignIcons';
import type { BrandProfile } from '@/api/types';

const H = 20;
const PRIMARY = '#F05A28';
const BG = '#111111';
const CARD_BG = '#000000';
const BORDER = '#222222';

const CAMPAIGN_ICONS: Record<string, React.FC<{ size?: number; color?: string }>> = {
  'Paid Collaboration': CashIcon,
  'Product Review': TaskIcon,
  'UGC Campaign': HeartBubbleIcon,
  'Brand Ambassador': UsersIcon,
  'Event Coverage': EventIcon,
};

const VIBE_ICONS: Record<string, React.FC<{ size?: number }>> = {
  Premium: PremiumIcon,
  Minimal: MinimalIcon,
  Bold: BoldIcon,
  Authentic: AuthenticIcon,
  Genz: GenzIcon,
};

const MOCK_COLLABS = [
  'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&q=80',
  'https://images.unsplash.com/photo-1531123897727-8f129e1bf98c?w=150&q=80',
  'https://images.unsplash.com/photo-1520813792240-56fc4a3765a7?w=150&q=80',
  'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&q=80',
];

const MOCK_RATING_AVATARS = [
  'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&q=80',
  'https://images.unsplash.com/photo-1531123897727-8f129e1bf98c?w=150&q=80',
  'https://images.unsplash.com/photo-1520813792240-56fc4a3765a7?w=150&q=80',
  'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&q=80',
];

export function BrandProfileScreen({ publicUserId, onBack }: { publicUserId?: string, onBack?: () => void }) {
  const { width } = useWindowDimensions();
  const { signOut, deleteAccount } = useAuth();
  const [profile, setProfile] = useState<BrandProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit Modal State
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editBudgetMin, setEditBudgetMin] = useState('');
  const [editBudgetMax, setEditBudgetMax] = useState('');
  const [editDays, setEditDays] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeCampaignType, setActiveCampaignType] = useState('Paid Collaboration');
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [uploadingCampaign, setUploadingCampaign] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = publicUserId ? await getProfileById(publicUserId) : await getMyProfile();
        const data = (res as any).data || res;
        if (!cancelled) setProfile(data as BrandProfile);
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? 'Failed to load profile');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const MAX_CAMPAIGN_PHOTOS = 6;

  const handleAddCampaignPhoto = useCallback(async () => {
    if (publicUserId) return;
    try {
      const currentPhotos = profile?.photos ?? [];
      const remaining = MAX_CAMPAIGN_PHOTOS - currentPhotos.length;

      if (remaining <= 0) {
        Alert.alert('Limit reached', 'You can add up to 6 campaign photos.');
        return;
      }

      const permResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permResult.granted) {
        Alert.alert('Permission needed', 'Please allow access to your photo library.');
        return;
      }
      let result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        allowsEditing: false,
        quality: 1,
      });

      if (!result.canceled && result.assets?.length > 0) {
        const localUris = result.assets.map(a => a.uri);
        const newPhotosOptimistic = [...currentPhotos, ...localUris].slice(0, MAX_CAMPAIGN_PHOTOS);
        const previousProfile = profile;

        // Optimistic Update
        if (profile) {
          setProfile({ ...profile, photos: newPhotosOptimistic });
        }
        setUploadingCampaign(true);

        try {
          const uploadedUrls = await Promise.all(
            result.assets.map((asset) => uploadImage(asset.uri))
          );
          const newPhotos = [...currentPhotos, ...uploadedUrls].slice(0, MAX_CAMPAIGN_PHOTOS);
          const res = await updateMyProfile({ photos: newPhotos });
          const data = (res as any).data || res;
          setProfile(data as BrandProfile);
        } catch (err: any) {
          console.error('Failed to upload campaign photo:', err);
          if (previousProfile) setProfile(previousProfile);
          Alert.alert('Upload failed', 'Could not upload image. Reverted changes.');
        } finally {
          setUploadingCampaign(false);
        }
      }
    } catch (err: any) {
      console.error('Failed to pick campaign photo:', err);
    }
  }, [profile]);

  if (loading) {
    return (
      <SafeAreaView style={[s.safe, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </SafeAreaView>
    );
  }

  if (error || !profile) {
    return (
      <SafeAreaView style={[s.safe, { justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ color: '#FF3B30' }}>⚠️ {error || 'Profile not found'}</Text>
      </SafeAreaView>
    );
  }

  const isValidUrl = (url?: string | null) => {
    if (!url) return false;
    if (url.startsWith('blob:') || url.startsWith('file://')) return false;
    return true;
  };

  const coverImage = isValidUrl(profile.logo_url) ? (profile.logo_url as string) : (isValidUrl(profile.cover_url) ? (profile.cover_url as string) : 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=800&q=80');
  const logo = isValidUrl(profile.logo_url) ? (profile.logo_url as string) : 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&q=80';
  const name = profile.name || 'Your Brand';
  const categoriesStr = (profile.categories || []).join(' · ') || 'Uncategorized';
  const location = profile.location || 'Location not set';
  const bio = profile.bio || 'Tell creators about your brand...';
  // Show campaign_types if set, else fall back to categories, else nothing
  const lookingFor = profile.campaign_types?.length
    ? profile.campaign_types
    : profile.categories?.length
    ? profile.categories
    : [];
  const platforms = profile.platforms || [];
  
  // Use DB budget if exists, else fallback to mock for visuals
  const budgetMin = profile.budget_min || 0;
  const budgetMax = profile.budget_max || 0;
  const budgetStr = budgetMax > 0 ? `${budgetMin > 0 ? budgetMin/1000 + 'k-' : ''}${budgetMax/1000}k` : 'Negotiable';
  
  const campaignDays = profile.campaign_days || 0;
  const formatCampaignDates = (days: number) => {
    if (!days) return 'Dates TBD';
    const start = new Date();
    const end = new Date();
    end.setDate(start.getDate() + days);
    
    const formatDt = (d: Date) => {
      const day = d.getDate();
      const month = d.toLocaleString('default', { month: 'short' }).toLowerCase();
      return `${day}${month}`;
    };
    return `${formatDt(start)}-${formatDt(end)}`;
  };
  const campaignDatesStr = formatCampaignDates(campaignDays);
  
  const vibes = profile.vibes?.length ? profile.vibes : ['Premium', 'Minimal', 'Bold', 'Authentic', 'Genz'];
  const campaignPhotos = profile.photos?.length ? profile.photos : [coverImage];
  
  const campaignTypes = ['Paid Collaboration', 'Product Review', 'UGC Campaign', 'Brand Ambassador', 'Event Coverage'];

  const handleSaveBudget = async () => {
    if (!profile) return;
    Keyboard.dismiss();
    
    const bMin = parseInt(editBudgetMin) || 0;
    const bMax = parseInt(editBudgetMax) || 0;
    const days = parseInt(editDays) || 0;
    
    const previousProfile = profile;
    
    // Optimistic Update
    setProfile({
      ...profile,
      budget_min: bMin,
      budget_max: bMax,
      campaign_days: days
    });
    setEditModalVisible(false);
    
    try {
      const res = await updateMyProfile({
        budget_min: bMin,
        budget_max: bMax,
        campaign_days: days
      });
      const data = (res as any).data || res;
      setProfile(data as BrandProfile);
    } catch (err) {
      console.error('Failed to save budget:', err);
      setProfile(previousProfile);
      Alert.alert('Update failed', 'Could not save changes. Restoring previous state.');
    }
  };

  const openEditModal = () => {
    if (publicUserId) return;
    setEditBudgetMin(budgetMin ? String(budgetMin) : '');
    setEditBudgetMax(budgetMax ? String(budgetMax) : '');
    setEditDays(campaignDays ? String(campaignDays) : '');
    setEditModalVisible(true);
  };

  const handleChangeLogo = async () => {
    if (publicUserId) return;
    try {
      let result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      });

      if (!result.canceled && result.assets?.[0]?.uri) {
        const publicUrl = await uploadImage(result.assets[0].uri);
        const res = await updateMyProfile({ logo_url: publicUrl });
        const data = (res as any).data || res;
        setProfile(data as BrandProfile);
      }
    } catch (err) {
      console.error('Failed to update logo:', err);
    }
  };

  const handleAddCampaignPhotoInline = async () => {
    // handled by the useCallback above — this is just a stub
  };

  return (
    <SafeAreaView style={s.safe}>
      {onBack && (
        <View style={{ position: 'absolute', top: 50, left: 16, zIndex: 10 }}>
          <TouchableOpacity onPress={onBack} style={{ width: 40, height: 40, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, justifyContent: 'center', alignItems: 'center' }}>
            <Ionicons name="arrow-back" size={24} color="#FFF" />
          </TouchableOpacity>
        </View>
      )}
      <View style={{ position: 'absolute', top: 50, right: 16, zIndex: 10 }}>
        <Pressable
          accessibilityLabel={publicUserId ? 'Report or block' : 'Account options'}
          onPress={() =>
            publicUserId
              ? openSafetyMenu({
                  userId: publicUserId,
                  name: profile?.name || 'this brand',
                  target: { type: 'user', id: publicUserId },
                  onBlocked: onBack,
                })
              : openAccountMenu({ signOut, deleteAccount })
          }
          style={{ padding: 8, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, justifyContent: 'center', alignItems: 'center' }}
        >
          <Ionicons name={publicUserId ? 'ellipsis-horizontal' : 'settings-outline'} size={20} color="#FFF" />
        </Pressable>
      </View>
      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
        
        {/* ════ HERO COVER ════ */}
        <View style={s.heroWrapper}>
          <ImageBackground source={{ uri: coverImage }} resizeMode="cover" style={s.coverBg}>
            <LinearGradient
              start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
              colors={['rgba(17,17,17,0.7)', 'rgba(17,17,17,0)']}
              style={s.heroGradTop}
            />
            {/* Brand Logo Header */}
            <View style={s.headerRow}>
              <View style={{ marginRight: 10 }}>
                <MatchrLogo size={32} />
              </View>
              <Text style={s.matchrLabel}>Matchr</Text>
            </View>

            <LinearGradient
              start={{ x: 0, y: 1 }} end={{ x: 0, y: 0 }}
              colors={[BG, 'rgba(17,17,17,0)']}
              style={s.heroGradBottom}
            />
          </ImageBackground>
          
          {/* Circular Logo & Titles overlay */}
          <View style={s.heroContentRow}>
            <TouchableOpacity activeOpacity={0.8} onPress={handleChangeLogo}>
              <Image source={{ uri: logo }} style={s.brandLogoCircle} />
              {!publicUserId && (
                <View style={{ position: 'absolute', bottom: 0, right: 0, backgroundColor: '#FF6B2B', borderRadius: 12, padding: 4 }}>
                  <Ionicons name="camera" size={12} color="#FFF" />
                </View>
              )}
            </TouchableOpacity>
            <View style={s.heroTextContainer}>
              <Text style={s.heroName}>{name}</Text>
              <Text style={s.heroCats}>{categoriesStr}</Text>
              <View style={s.locationRow}>
                <Ionicons name="location-sharp" size={14} color="#FFF" />
                <Text style={s.locationTxt}>{location}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* ════ BIO ════ */}
        <Text style={s.bio}>{bio}</Text>

        {/* ════ LOOKING FOR ════ */}
        {lookingFor.length > 0 && (
          <>
            <Text style={s.sectionTitle}>Looking for</Text>
            <View style={s.tagsWrap}>
              {lookingFor.map((tag: string) => (
                <View key={tag} style={s.tagPill}>
                  <Text style={s.tagTxt}>{tag}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* ════ PLATFORMS ════ */}
        {platforms.length > 0 && (
          <>
            <Text style={s.sectionTitle}>Active Platforms</Text>
            <View style={s.tagsWrap}>
              {platforms.map((p: string) => {
                const iconMap: Record<string, string> = {
                  x: 'x-twitter',
                  facebook: 'facebook-f',
                  linkedin: 'linkedin-in',
                  reddit: 'reddit-alien'
                };
                return (
                  <View key={p} style={[s.tagPill, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
                    <FontAwesome6 name={iconMap[p] || p} size={14} color="#FFF" />
                    <Text style={s.tagTxt}>{p.charAt(0).toUpperCase() + p.slice(1)}</Text>
                  </View>
                );
              })}
            </View>
          </>
        )}

        {/* ════ CAMPAIGN BUDGET & PERIOD ════ */}
        <View style={s.twoCardRow}>
          <TouchableOpacity style={s.miniCard} activeOpacity={0.8} onPress={openEditModal}>
            <View style={s.miniCardHeaderRow}>
              <Ionicons name="wallet-outline" size={18} color={PRIMARY} />
              <Text style={s.miniCardLabel}>Campaign budget</Text>
            </View>
            <Text style={s.miniCardValue}>{budgetStr}</Text>
            <Text style={s.miniCardSub}>per collaboration</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.miniCard} activeOpacity={0.8} onPress={openEditModal}>
            <View style={s.miniCardHeaderRow}>
              <Ionicons name="calendar-outline" size={18} color={PRIMARY} />
              <Text style={s.miniCardLabel}>Campaign Period</Text>
            </View>
            <Text style={s.miniCardValue}>{campaignDatesStr}</Text>
            <Text style={s.miniCardSub}>{campaignDays ? `${campaignDays} days` : 'Not set'}</Text>
          </TouchableOpacity>
        </View>

        {/* ════ CAMPAIGN TYPE ════ */}
        <View style={s.wideCard}>
          <Text style={s.wideCardTitle}>Campaign Type</Text>
          <View style={s.campaignTypesRow}>
            {campaignTypes.map((type) => {
              const isActive = type === activeCampaignType;
              const IconComponent = CAMPAIGN_ICONS[type];
              return (
                <TouchableOpacity 
                  key={type} 
                  style={s.campaignTypeCol}
                  onPress={() => setActiveCampaignType(type)}
                  activeOpacity={0.7}
                >
                  {IconComponent ? (
                    <IconComponent size={24} color={isActive ? PRIMARY : '#444'} />
                  ) : (
                    <Ionicons name="star-outline" size={24} color={isActive ? PRIMARY : '#444'} />
                  )}
                  <Text style={[s.campaignTypeTxt, isActive && s.campaignTypeTxtActive]}>
                    {type.replace(' ', '\n')}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ════ BRAND VIBE ════ */}
        {vibes.length > 0 && (
          <>
            <Text style={s.sectionTitle}>Brand vibe</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.vibesRow} style={s.vibesScroll}>
              {vibes.map((v: string) => {
                const IconComponent = VIBE_ICONS[v];
                return (
                  <View key={v} style={s.vibeWrap}>
                    {IconComponent ? (
                      <IconComponent size={24} />
                    ) : (
                      <Ionicons name="star-outline" size={24} color={PRIMARY} />
                    )}
                    <Text style={s.vibeTxt}>{v}</Text>
                  </View>
                );
              })}
            </ScrollView>
          </>
        )}

        {/* ════ PREVIOUSLY COLLABORATED WITH ════ */}
        <View style={s.rowBetween}>
          <Text style={s.sectionTitleNoMargin}>Previously collaborated with</Text>
          <Text style={s.viewAll}>View all</Text>
        </View>
        <View style={s.collabRow}>
          {MOCK_COLLABS.map((img: string, i: number) => (
            <Image key={i} source={{ uri: img }} style={[s.collabAvatar, { marginLeft: i === 0 ? 0 : -15 }]} />
          ))}
          <View style={[s.collabMore, { marginLeft: -15 }]}>
            <Text style={s.collabMoreTxt}>+24</Text>
          </View>
        </View>

        {/* ════ BRAND CAMPAIGN CAROUSEL ════ */}
        <View style={s.rowBetween}>
          <Text style={s.sectionTitleNoMargin}>Brand campaign</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: '#666', fontSize: 13 }}>{campaignPhotos.filter(p => p !== coverImage).length}/6</Text>
            <TouchableOpacity
              onPress={handleAddCampaignPhoto}
              disabled={uploadingCampaign || (profile?.photos ?? []).length >= 6}
              style={[
                { padding: 6, borderRadius: 8, borderWidth: 1, borderColor: PRIMARY },
                ((profile?.photos ?? []).length >= 6) && { opacity: 0.4 },
              ]}
            >
              {uploadingCampaign
                ? <ActivityIndicator size="small" color={PRIMARY} />
                : <Ionicons name="add" size={20} color={PRIMARY} />
              }
            </TouchableOpacity>
          </View>
        </View>
        <View style={s.carouselWrap}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={(e) => {
              const x = e.nativeEvent.contentOffset.x;
              const w = e.nativeEvent.layoutMeasurement.width;
              if (w > 0) setActivePhotoIndex(Math.round(x / w));
            }}
          >
            {campaignPhotos.map((photoUrl, i) => (
              <Image 
                key={i} 
                source={{ uri: photoUrl }} 
                style={[s.carouselImg, { width: width - (H * 2) }]} 
                resizeMode="cover" 
              />
            ))}
          </ScrollView>
          
          {campaignPhotos.length > 1 && (
            <View style={s.dotsRow}>
              {campaignPhotos.map((_, i) => (
                <View key={i} style={[s.dot, i === activePhotoIndex && s.dotActive]} />
              ))}
            </View>
          )}
          {campaignPhotos.length > 1 && (
            <View style={s.carouselArrow}>
              <Ionicons name="chevron-forward" size={16} color="#FFF" />
            </View>
          )}
        </View>

        {/* ════ DELIVERABLES ════ */}
        <View style={[s.wideCard, { paddingVertical: 24 }]}>
          <Text style={[s.wideCardTitle, { textAlign: 'center', marginBottom: 24 }]}>Deliverables</Text>
          <View style={s.delivRow}>
            <View style={s.delivItem}>
              <View style={s.delivIconWrap}>
                <ReelsIcon size={28} />
              </View>
              <Text style={s.delivTxt}>1 Reels</Text>
            </View>
            <View style={s.delivItem}>
              <View style={s.delivIconWrap}>
                <StoriesIcon size={28} />
              </View>
              <Text style={s.delivTxt}>2 Stories</Text>
            </View>
            <View style={s.delivItem}>
              <View style={s.delivIconWrap}>
                <PostIcon size={28} />
              </View>
              <Text style={s.delivTxt}>1 Post</Text>
            </View>
          </View>
        </View>

        {/* ════ BUDGET DETAILS ════ */}
        <View style={s.wideCard}>
          <Text style={s.wideCardTitle}>Budget details</Text>
          <View style={s.splitRow}>
            <View style={s.splitLeft}>
              <Text style={s.splitLabel}>Starting from</Text>
              <Text style={s.budgetValue}>{budgetMin.toLocaleString()}/-</Text>
            </View>
            <View style={s.splitDivider} />
            <View style={s.splitRight}>
              <Text style={s.verifySub}>Payment Mode{'\n'}Bank Transfer{'\n'}Within 7 Days</Text>
              <Ionicons name="checkmark-circle" size={20} color="#773322" style={{ position: 'absolute', right: 0, top: '50%', marginTop: -10 }} />
            </View>
          </View>
        </View>

        
        {/* ════ RESPONSE TIME ════ */}
        <View style={[s.wideCard, s.responseCardOveride]}>
          <View style={s.splitRow}>
            <View style={s.splitLeft}>
              <Text style={s.splitLabel}>Usually Replies</Text>
              <Text style={s.responseValue}>Within 3 hours</Text>
            </View>
            <View style={s.splitDivider} />
            <View style={[s.splitRight, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
              <View>
                <Text style={s.splitLabel}>Response Rate</Text>
                <Text style={s.responseValue}>94%</Text>
              </View>
              <Ionicons name="flash" size={24} color={PRIMARY} />
            </View>
          </View>
        </View>

        {/* ════ BRAND RATING ════ */}
        <View style={s.wideCard}>
          <Text style={s.wideCardTitle}>Brand Rating</Text>
          <View style={s.ratingRowOuter}>
            <View style={s.ratingLeft}>
              <View style={s.ratingScoreRow}>
                <Ionicons name="star" size={20} color={PRIMARY} />
                <Text style={s.ratingValue}>4.5</Text>
                <Text style={s.ratingTotal}>/5</Text>
              </View>
              <Text style={s.splitLabel}>50+ creators{'\n'}recommend this brand</Text>
            </View>
            <View style={s.ratingAvatarRow}>
              {MOCK_RATING_AVATARS.map((img: string, i: number) => (
                <Image key={i} source={{ uri: img }} style={[s.collabAvatar, { marginLeft: i === 0 ? 0 : -15 }]} />
              ))}
            </View>
          </View>
        </View>

        {/* ════ VERIFICATION & SAFETY ════ */}
        <View style={s.wideCard}>
          <Text style={[s.wideCardTitle, { textAlign: 'center', marginBottom: 20 }]}>Verification & Safety</Text>
          <View style={s.splitRow}>
            <View style={s.splitLeftCenter}>
              <Text style={s.verifyTitle}>Verification Business</Text>
              <Text style={s.verifySub}>Official brand account</Text>
            </View>
            <View style={s.splitDivider} />
            <View style={s.splitRightCenter}>
              <Text style={s.verifyTitle}>Privacy Protected</Text>
              <Text style={s.verifySub}>Security</Text>
            </View>
          </View>
        </View>

        {/* ════ INTERESTED BTN ════ */}
        <TouchableOpacity style={s.interestedBtn} activeOpacity={0.8}>
          <Text style={s.interestedTxt}>Interested</Text>
        </TouchableOpacity>

      </ScrollView>

      {/* ════ EDIT MODAL ════ */}
      <Modal visible={editModalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView 
          style={s.modalOverlay} 
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={s.modalContent}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Edit Campaign Details</Text>
              <TouchableOpacity onPress={() => setEditModalVisible(false)}>
                <Ionicons name="close" size={24} color="#FFF" />
              </TouchableOpacity>
            </View>

            <View style={s.inputGroup}>
              <Text style={s.inputLabel}>Minimum Budget (INR)</Text>
              <TextInput
                style={s.textInput}
                keyboardType="numeric"
                placeholder="e.g. 20000"
                placeholderTextColor="#666"
                value={editBudgetMin}
                onChangeText={setEditBudgetMin}
                returnKeyType="next"
              />
            </View>

            <View style={s.inputGroup}>
              <Text style={s.inputLabel}>Maximum Budget (INR)</Text>
              <TextInput
                style={s.textInput}
                keyboardType="numeric"
                placeholder="e.g. 50000"
                placeholderTextColor="#666"
                value={editBudgetMax}
                onChangeText={setEditBudgetMax}
                returnKeyType="next"
              />
            </View>

            <View style={s.inputGroup}>
              <Text style={s.inputLabel}>Campaign Duration (Days)</Text>
              <TextInput
                style={s.textInput}
                keyboardType="numeric"
                placeholder="e.g. 15"
                placeholderTextColor="#666"
                value={editDays}
                onChangeText={setEditDays}
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
              />
            </View>

            <TouchableOpacity 
              style={[s.saveBtn, saving && { opacity: 0.7 }]} 
              onPress={handleSaveBudget}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={s.saveBtnTxt}>Save Changes</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: BG },
  scroll:        { flex: 1, backgroundColor: BG },
  scrollContent: { paddingBottom: 40 },

  heroWrapper: { position: 'relative', marginBottom: 24, height: 460 },
  coverBg:     { width: '100%', height: '100%' },

  heroGradTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 120 },
  heroGradBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 200 },

  headerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16, marginLeft: H },
  matchrLogoIcon: { width: 32, height: 32, backgroundColor: PRIMARY, borderRadius: 8, marginRight: 10 }, // Placeholder for logo
  matchrLabel: { color: '#FFFFFF', fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },

  heroContentRow: {
    position: 'absolute',
    bottom: -20,
    left: H,
    right: H,
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandLogoCircle: {
    width: 104, height: 104,
    borderRadius: 52,
    backgroundColor: '#FFF',
    borderWidth: 3,
    borderColor: BG,
    marginRight: 16,
  },
  heroTextContainer: { flex: 1, justifyContent: 'center' },
  heroName: { color: '#FCFCFC', fontSize: 26, fontWeight: '800', marginBottom: 2 },
  heroCats: { color: '#CCC', fontSize: 13, marginBottom: 4 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  locationTxt: { color: '#AAA', fontSize: 12, fontWeight: '500' },

  bio: { color: '#E0E0E0', fontSize: 13, lineHeight: 20, marginBottom: 24, marginHorizontal: H, marginTop: 40 },

  sectionTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: 'bold', marginBottom: 16, marginHorizontal: H },
  sectionTitleNoMargin: { color: '#FFFFFF', fontSize: 16, fontWeight: 'bold' },

  tagsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginHorizontal: H, marginBottom: 24 },
  tagPill: {
    borderColor: '#444', borderWidth: 1, borderRadius: 20,
    paddingVertical: 8, paddingHorizontal: 16,
  },
  tagTxt: { color: '#DDD', fontSize: 12 },

  twoCardRow: { flexDirection: 'row', marginHorizontal: H, marginBottom: 16, gap: 12 },
  miniCard: {
    flex: 1,
    backgroundColor: CARD_BG, borderColor: BORDER, borderRadius: 16, borderWidth: 1,
    paddingVertical: 18, paddingHorizontal: 16,
  },
  miniCardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  miniCardLabel: { color: '#888', fontSize: 11 },
  miniCardValue: { color: '#FFF', fontSize: 22, fontWeight: '800', marginBottom: 4 },
  miniCardSub:   { color: '#666', fontSize: 9 },

  wideCard: {
    backgroundColor: CARD_BG, borderColor: BORDER, borderRadius: 16, borderWidth: 1,
    paddingVertical: 20, paddingHorizontal: 20,
    marginBottom: 16, marginHorizontal: H,
  },
  wideCardTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: 'bold', marginBottom: 20 },

  campaignTypesRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  campaignTypeCol: { alignItems: 'center', flex: 1 },
  campaignTypeTxt: { color: '#555', fontSize: 9, textAlign: 'center', marginTop: 8, lineHeight: 12 },
  campaignTypeTxtActive: { color: '#FFF' },

  vibesScroll: { flexGrow: 0, marginBottom: 24 },
  vibesRow: { paddingLeft: H, paddingRight: H, gap: 16, alignItems: 'center' },
  vibeWrap: {
    width: 72, height: 76, borderRadius: 24,
    borderWidth: 1, borderColor: '#444',
    backgroundColor: '#000',
    justifyContent: 'center', alignItems: 'center',
    gap: 8,
  },
  vibeTxt: { color: '#FFF', fontSize: 11, fontWeight: '500' },

  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: H, marginBottom: 16 },
  viewAll: { color: PRIMARY, fontSize: 12, fontWeight: '600' },
  collabRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: H, marginBottom: 32 },
  collabAvatar: { width: 56, height: 56, borderRadius: 28, borderWidth: 3, borderColor: BG },
  collabMore: {
    width: 56, height: 56, borderRadius: 28, borderWidth: 3, borderColor: BG,
    backgroundColor: '#111', justifyContent: 'center', alignItems: 'center',
  },
  collabMoreTxt: { color: '#FFF', fontSize: 14, fontWeight: 'bold' },

  carouselWrap: {
    height: 440, marginHorizontal: H, marginBottom: 24,
    borderRadius: 20, overflow: 'hidden', position: 'relative',
    backgroundColor: '#111',
  },
  carouselImg: { width: '100%', height: '100%' },
  dotsRow: { position: 'absolute', bottom: 16, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot:       { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.4)' },
  dotActive: { backgroundColor: '#FFF' },
  carouselArrow: { position: 'absolute', right: 12, top: '50%', marginTop: -14 },

  delivRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  delivItem: { alignItems: 'center', flex: 1 },
  delivIconWrap: { marginBottom: 12 },
  delivTxt: { color: '#888', fontSize: 12, fontWeight: '500' },

  splitRow: { flexDirection: 'row', alignItems: 'center' },
  splitLeft: { flex: 1, paddingRight: 16 },
  splitRight: { flex: 1, paddingLeft: 16, position: 'relative' },
  splitLeftCenter: { flex: 1, alignItems: 'center' },
  splitRightCenter: { flex: 1, alignItems: 'center' },
  splitDivider: { width: 1, height: '80%', minHeight: 40, backgroundColor: '#222' },
  splitLabel: { color: '#888', fontSize: 11, marginBottom: 6, lineHeight: 16 },
  budgetValue: { color: PRIMARY, fontSize: 24, fontWeight: '800' },
  verifySub: { color: '#888', fontSize: 13, marginTop: 4 },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1A1A1A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
  inputGroup: { marginBottom: 16 },
  inputLabel: { color: '#AAA', fontSize: 13, marginBottom: 8 },
  textInput: {
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 12,
    color: '#FFF',
    padding: 14,
    fontSize: 16,
  },
  saveBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  saveBtnTxt: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },

  wideCardRowHalf: { flex: 1 },
  responseCardOveride: { marginTop: -16 }, // Just to use wideCard for response time if we wanted to remove the twoCardRow one. Actually let's hide the twoCardRow one.
  
  responseValue: { color: PRIMARY, fontSize: 18, fontWeight: '700' },

  ratingRowOuter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ratingLeft: { flex: 1 },
  ratingScoreRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  ratingValue: { color: '#FFF', fontSize: 28, fontWeight: '800' },
  ratingTotal: { color: '#666', fontSize: 16, fontWeight: '500', marginTop: 6 },
  ratingAvatarRow: { flexDirection: 'row', alignItems: 'center' },

  verifyTitle: { color: '#FFF', fontSize: 12, fontWeight: '700', textAlign: 'center', marginBottom: 4 },

  interestedBtn: {
    alignItems: 'center', backgroundColor: PRIMARY, borderRadius: 16,
    paddingVertical: 18, marginHorizontal: H, marginTop: 12, marginBottom: 16,
  },
  interestedTxt: { color: '#FFF', fontSize: 16, fontWeight: '800' },
});
