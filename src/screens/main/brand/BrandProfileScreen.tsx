import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
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
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, FontAwesome6 } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';
import { getMyProfile, updateMyProfile, uploadImage, getProfileById, getMatches, getMatchStats, getMyResponsiveness, requestVerification, recordSwipe } from '@/api';
import { ApiError } from '@/api/client';
import { showAlert } from '@/components/ActionSheet';
import { openAccountMenu, openSafetyMenu } from '@/components/safetyMenu';
import { Avatar } from '@/components/ChatAvatar';
import { ReelsIcon } from '@/components/ReelsIcon';
import { StoriesIcon } from '@/components/StoriesIcon';
import { PostIcon } from '@/components/PostIcon';
import { MatchrLogo } from '@/components/MatchrLogo';
import { PremiumIcon, MinimalIcon, BoldIcon, AuthenticIcon, GenzIcon } from '@/components/VibeIcons';
import { TaskIcon, HeartBubbleIcon, UsersIcon, CashIcon, EventIcon } from '@/components/CampaignIcons';
import type { BrandProfile, MatchRecord, PaymentMode, Responsiveness } from '@/api/types';

const H = 20;
const PRIMARY = '#F05A28';
const BG = '#111111';
const CARD_BG = '#000000';
const BORDER = '#222222';
const DANGER = '#FF6B6B';
const MUTED = '#8A8A8A';
const MAX_BUDGET = 100000000; // 10 crore: past this the field is a typo, not a budget.
const MAX_DAYS = 365;
const MAX_DELIVERABLE = 99;
const IDLE_ICON = '#6B6B6B'; // #444 was unreadably dim against the card

// The fields draw their own focus border, so drop the browser's blue ring.
const webNoOutline = Platform.select({ web: { outlineStyle: 'none' } as any, default: undefined });

const onlyDigits = (text: string, maxLength: number) => text.replace(/[^0-9]/g, '').slice(0, maxLength);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatEndDate(days: number) {
  const end = new Date();
  end.setDate(end.getDate() + days);
  return `${end.getDate()} ${MONTHS[end.getMonth()]}`;
}

// Indian grouping (20,000 / 1,50,000) without depending on Intl being present.
function formatInr(value: number) {
  const digits = String(Math.trunc(Math.abs(value)));
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
}

const VIBE_ICONS: Record<string, React.FC<{ size?: number }>> = {
  Premium: PremiumIcon,
  Minimal: MinimalIcon,
  Bold: BoldIcon,
  Authentic: AuthenticIcon,
  Genz: GenzIcon,
};

const CAMPAIGN_ICONS: Record<string, React.FC<{ size?: number; color?: string }>> = {
  'Paid Collaboration': CashIcon,
  'Product Review': TaskIcon,
  'UGC Campaign': HeartBubbleIcon,
  'Brand Ambassador': UsersIcon,
  'Event Coverage': EventIcon,
};

// The choices a brand picks from on their own profile. Nothing in onboarding
// asks for either of these, so this screen is where they get set.
const CAMPAIGN_TYPES = Object.keys(CAMPAIGN_ICONS);
const VIBES = Object.keys(VIBE_ICONS);

/** The catalogue plus anything already saved that is not in it. */
const withSaved = (catalogue: string[], saved: string[]) => [
  ...catalogue,
  ...saved.filter((v) => !catalogue.includes(v)),
];

const MAX_SHOWN_MATCHES = 5;
const MAX_PAYMENT_DAYS = 90;

// The modes the profile knows how to name. The database rejects anything else.
const PAYMENT_MODES: { value: PaymentMode; label: string }[] = [
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'upi', label: 'UPI' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'paypal', label: 'PayPal' },
];
const paymentModeLabel = (mode?: PaymentMode | null) =>
  PAYMENT_MODES.find((m) => m.value === mode)?.label ?? null;

/** "Under an hour" reads better than "0.4 hours"; nothing here is rounded up. */
function formatReplyTime(seconds: number) {
  if (seconds < 60 * 60) return 'Under an hour';
  const hours = Math.round(seconds / 3600);
  if (hours < 24) return `About ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  const days = Math.round(seconds / 86400);
  return `About ${days} ${days === 1 ? 'day' : 'days'}`;
}

export function BrandProfileScreen({ publicUserId, onBack }: { publicUserId?: string, onBack?: () => void }) {
  const { width } = useWindowDimensions();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, signOut, deleteAccount } = useAuth();
  const [profile, setProfile] = useState<BrandProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit Modal State
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editBudgetMin, setEditBudgetMin] = useState('');
  const [editBudgetMax, setEditBudgetMax] = useState('');
  const [editDays, setEditDays] = useState('');
  const [editReels, setEditReels] = useState('');
  const [editStories, setEditStories] = useState('');
  const [editPosts, setEditPosts] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [focusedField, setFocusedField] = useState<'min' | 'max' | 'days' | 'reels' | 'stories' | 'posts' | 'payDays' | null>(null);
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [uploadingCampaign, setUploadingCampaign] = useState(false);
  const [savingPick, setSavingPick] = useState(false);
  // Expressing interest from a public profile is the same act as a right swipe.
  const [interested, setInterested] = useState(false);
  const [sendingInterest, setSendingInterest] = useState(false);

  // Payment terms live in the same sheet as budget and deliverables.
  const [editPaymentMode, setEditPaymentMode] = useState<PaymentMode | ''>('');
  const [editPaymentDays, setEditPaymentDays] = useState('');

  // Business verification: details go to an admin, who grants the badge.
  const [verifyVisible, setVerifyVisible] = useState(false);
  const [verifyName, setVerifyName] = useState('');
  const [verifyReg, setVerifyReg] = useState('');
  const [verifyFocused, setVerifyFocused] = useState<'name' | 'reg' | null>(null);
  const [verifySubmitting, setVerifySubmitting] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // Matched creators, own profile only: /api/matches always answers for the
  // signed-in user, so there is no way to show someone else's matches here.
  const [matches, setMatches] = useState<MatchRecord[] | null>(null);
  const [matchTotal, setMatchTotal] = useState(0);
  const [matchesLoading, setMatchesLoading] = useState(!publicUserId);
  const [matchesFailed, setMatchesFailed] = useState(false);

  // Reply speed, measured from this user's own chat history.
  const [responsiveness, setResponsiveness] = useState<Responsiveness | null>(null);
  const [responsivenessLoading, setResponsivenessLoading] = useState(!publicUserId);

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
  }, [publicUserId]);

  const loadMatches = useCallback(async () => {
    setMatchesLoading(true);
    setMatchesFailed(false);
    try {
      // The count is a nicety; a failing stats call must not hide real matches.
      const [listRes, stats] = await Promise.all([getMatches(), getMatchStats().catch(() => null)]);
      // The endpoint returns a page, but older builds returned a bare list.
      const list: MatchRecord[] = Array.isArray(listRes) ? listRes : (listRes?.data ?? []);
      setMatches(list);
      const total = Number(stats?.total_active);
      setMatchTotal(Number.isFinite(total) && total > 0 ? total : list.length);
    } catch (err) {
      console.warn('Failed to load matched creators', err);
      setMatchesFailed(true);
    } finally {
      setMatchesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (publicUserId) return;
    loadMatches();
  }, [publicUserId, loadMatches]);

  useEffect(() => {
    if (publicUserId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await getMyResponsiveness();
        if (!cancelled) setResponsiveness(res);
      } catch (err) {
        // 404 means this backend is older than the app — an app update can
        // reach phones before the server ships. The card just stays hidden.
        // Anything else is a real failure, but still not the brand's problem
        // to solve, so it stays in the log rather than on the screen.
        if (!(err instanceof ApiError && err.status === 404)) {
          console.warn('Failed to load reply times', err);
        }
      } finally {
        if (!cancelled) setResponsivenessLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [publicUserId]);

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

  // No stock-photo fallbacks: until the brand uploads its own images, show placeholders.
  const coverImage = isValidUrl(profile.logo_url) ? (profile.logo_url as string) : (isValidUrl(profile.cover_url) ? (profile.cover_url as string) : null);
  const logo = isValidUrl(profile.logo_url) ? (profile.logo_url as string) : null;
  const name = profile.name || 'Your Brand';
  const categoriesStr = (profile.categories || []).join(' · ') || 'Uncategorized';
  const location = profile.location || 'Location not set';
  const bio = profile.bio || 'Tell creators about your brand...';
  // Only the campaign types the brand actually picked. Categories are a
  // different thing and already sit under the brand name in the header.
  const lookingFor = profile.campaign_types ?? [];
  const platforms = profile.platforms || [];

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
  
  // No fallback list: showing all five as picked would claim the brand chose
  // them. On your own profile the unpicked ones stay visible but greyed, so
  // the row doubles as the picker; a visitor sees only what was picked.
  const vibes = profile.vibes ?? [];
  const campaignTypeChoices = publicUserId ? lookingFor : withSaved(CAMPAIGN_TYPES, lookingFor);
  const vibeChoices = publicUserId ? vibes : withSaved(VIBES, vibes);

  // What the brand asks for. A line is shown only if they asked for it.
  const deliverables = [
    { key: 'reels', count: profile.deliverable_reels ?? 0, Icon: ReelsIcon, one: 'Reel', many: 'Reels' },
    { key: 'stories', count: profile.deliverable_stories ?? 0, Icon: StoriesIcon, one: 'Story', many: 'Stories' },
    { key: 'posts', count: profile.deliverable_posts ?? 0, Icon: PostIcon, one: 'Post', many: 'Posts' },
  ].filter((d) => d.count > 0);
  const campaignPhotos = (profile.photos ?? []).filter(isValidUrl);

  const ratingCount = profile.rating_count ?? 0;
  const ratingAvgRaw = profile.rating_avg == null ? null : Number(profile.rating_avg);
  const ratingAvg = ratingAvgRaw != null && Number.isFinite(ratingAvgRaw) ? ratingAvgRaw : null;
  const verificationStatus = profile.verification_status ?? 'none';

  const shownMatches = (matches ?? []).slice(0, MAX_SHOWN_MATCHES);
  const extraMatches = matchTotal - shownMatches.length;

  // Empty stays empty: 0 means "not set", and the profile shows Negotiable / Dates TBD.
  const draftMin = editBudgetMin === '' ? 0 : parseInt(editBudgetMin, 10);
  const draftMax = editBudgetMax === '' ? 0 : parseInt(editBudgetMax, 10);
  const draftDays = editDays === '' ? 0 : parseInt(editDays, 10);
  const draftReels = editReels === '' ? 0 : parseInt(editReels, 10);
  const draftStories = editStories === '' ? 0 : parseInt(editStories, 10);
  const draftPosts = editPosts === '' ? 0 : parseInt(editPosts, 10);
  const draftPaymentDays = editPaymentDays === '' ? 0 : parseInt(editPaymentDays, 10);

  const budgetError =
    draftMax > 0 && draftMax < draftMin
      ? 'The maximum has to be at least the minimum.'
      : draftMax > MAX_BUDGET || draftMin > MAX_BUDGET
      ? 'That looks like a typo. Keep it under ₹10,00,00,000.'
      : null;
  const daysError = draftDays > MAX_DAYS ? `Keep the campaign to ${MAX_DAYS} days or fewer.` : null;
  const deliverablesError =
    draftReels > MAX_DELIVERABLE || draftStories > MAX_DELIVERABLE || draftPosts > MAX_DELIVERABLE
      ? `Ask for ${MAX_DELIVERABLE} or fewer of each.`
      : null;
  const paymentError =
    draftPaymentDays > MAX_PAYMENT_DAYS ? `Creators expect payment within ${MAX_PAYMENT_DAYS} days at most.` : null;
  const canSave = !budgetError && !daysError && !deliverablesError && !paymentError && !saving;

  // Hold the budget error back until they leave the fields, so it does not
  // flash red on the way to typing a valid number.
  const editingBudget = focusedField === 'min' || focusedField === 'max';
  const showBudgetError = !!budgetError && !editingBudget;

  const budgetPreview =
    draftMax > 0
      ? draftMin > 0
        ? `Creators see ₹${formatInr(draftMin)} to ₹${formatInr(draftMax)}`
        : `Creators see up to ₹${formatInr(draftMax)}`
      : draftMin > 0
      ? `The budget card reads “Negotiable” until you add a maximum. Your profile still shows ₹${formatInr(draftMin)} as the starting price.`
      : 'Leave both empty and creators see “Negotiable”.';

  const draftDeliverableTotal = draftReels + draftStories + draftPosts;
  const deliverablesPreview =
    draftDeliverableTotal > 0
      ? 'Creators see this list on your profile.'
      : 'Leave these empty and the deliverables card stays hidden.';

  const daysPreview =
    draftDays > 0 && draftDays <= MAX_DAYS
      ? `Counted from today, so this campaign ends ${formatEndDate(draftDays)}.`
      : 'Leave it empty and creators see “Dates TBD”.';

  const handleSaveBudget = async () => {
    if (!profile || !canSave) return;
    Keyboard.dismiss();
    setSaveError(null);
    setSaving(true);

    try {
      const res = await updateMyProfile({
        budget_min: draftMin,
        budget_max: draftMax,
        campaign_days: draftDays,
        deliverable_reels: draftReels,
        deliverable_stories: draftStories,
        deliverable_posts: draftPosts,
        payment_mode: editPaymentMode,
        payment_days: draftPaymentDays,
      });
      const data = (res as any).data || res;
      setProfile(data as BrandProfile);
      setEditModalVisible(false);
    } catch (err) {
      // Stay open with the typed values: Alert.alert does nothing on web.
      console.error('Failed to save budget:', err);
      setSaveError('Could not save. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  // One request at a time: two quick taps would otherwise race, and the
  // slower answer would overwrite the newer choice.
  const togglePick = async (field: 'campaign_types' | 'vibes', value: string) => {
    if (publicUserId || !profile || savingPick) return;
    const current: string[] = (profile[field] as string[] | undefined) ?? [];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];

    const previous = profile;
    setProfile({ ...profile, [field]: next });
    setSavingPick(true);
    try {
      const res = await updateMyProfile({ [field]: next });
      const data = (res as any).data || res;
      setProfile(data as BrandProfile);
    } catch (err) {
      console.error(`Failed to save ${field}:`, err);
      setProfile(previous);
      showAlert('Could not save', 'Check your connection and try again.');
    } finally {
      setSavingPick(false);
    }
  };

  const handleInterested = async () => {
    if (!publicUserId || interested || sendingInterest) return;
    setSendingInterest(true);
    try {
      const res = await recordSwipe(publicUserId, 'like');
      setInterested(true);
      if (res.matched) {
        showAlert('You matched', `You and ${profile?.name || 'this brand'} can talk now.`, [
          { text: 'Open chat', onPress: () => router.replace('/(influencer-tabs)/messages') },
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

  const canSubmitVerification =
    verifyName.trim().length >= 2 && verifyReg.trim().length >= 4 && !verifySubmitting;

  const openVerifyModal = () => {
    if (publicUserId || !profile) return;
    setVerifyName(profile.verification_business_name || profile.name || '');
    setVerifyReg('');
    setVerifyError(null);
    setVerifyFocused(null);
    setVerifyVisible(true);
  };

  const submitVerification = async () => {
    const businessName = verifyName.trim();
    const regNumber = verifyReg.trim();
    if (businessName.length < 2 || regNumber.length < 4 || verifySubmitting) return;
    Keyboard.dismiss();
    setVerifyError(null);
    setVerifySubmitting(true);
    try {
      const res = await requestVerification(businessName, regNumber);
      setProfile((prev) => (prev ? {
        ...prev,
        verification_status: res.verification_status,
        verification_business_name: res.verification_business_name,
        verification_note: null,
      } : prev));
      setVerifyVisible(false);
    } catch (err) {
      console.error('Verification request failed:', err);
      setVerifyError(
        err instanceof ApiError && err.status < 500
          ? err.message
          : 'Could not send that. Check your connection and try again.',
      );
    } finally {
      setVerifySubmitting(false);
    }
  };

  const openEditModal = () => {
    if (publicUserId) return;
    setEditBudgetMin(budgetMin ? String(budgetMin) : '');
    setEditBudgetMax(budgetMax ? String(budgetMax) : '');
    setEditDays(campaignDays ? String(campaignDays) : '');
    setEditReels(profile.deliverable_reels ? String(profile.deliverable_reels) : '');
    setEditStories(profile.deliverable_stories ? String(profile.deliverable_stories) : '');
    setEditPosts(profile.deliverable_posts ? String(profile.deliverable_posts) : '');
    setEditPaymentMode(profile.payment_mode ?? '');
    setEditPaymentDays(profile.payment_days ? String(profile.payment_days) : '');
    setSaveError(null);
    setFocusedField(null);
    setEditModalVisible(true);
  };

  const closeEditModal = () => {
    if (saving) return;
    Keyboard.dismiss();
    setEditModalVisible(false);
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
      Alert.alert('Update failed', 'Could not upload your logo. Please try again.');
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      {onBack && (
        <View style={{ position: 'absolute', top: insets.top + 8, left: 16, zIndex: 10 }}>
          <TouchableOpacity onPress={onBack} style={{ width: 40, height: 40, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, justifyContent: 'center', alignItems: 'center' }}>
            <Ionicons name="arrow-back" size={24} color="#FFF" />
          </TouchableOpacity>
        </View>
      )}
      <View style={{ position: 'absolute', top: insets.top + 8, right: 16, zIndex: 10 }}>
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
              : openAccountMenu({ signOut, deleteAccount, email: user?.email })
          }
          style={{ padding: 8, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, justifyContent: 'center', alignItems: 'center' }}
        >
          <Ionicons name={publicUserId ? 'ellipsis-horizontal' : 'settings-outline'} size={20} color="#FFF" />
        </Pressable>
      </View>
      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
        
        {/* ════ HERO COVER ════ */}
        <View style={s.heroWrapper}>
          <ImageBackground source={coverImage ? { uri: coverImage } : undefined} resizeMode="cover" style={s.coverBg}>
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
              {logo ? (
                <Image source={{ uri: logo }} style={s.brandLogoCircle} />
              ) : (
                <View style={[s.brandLogoCircle, s.logoPlaceholder]}>
                  <Ionicons name="business-outline" size={40} color="#777" />
                </View>
              )}
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
        {(campaignTypeChoices.length > 0) && (
          <View style={s.wideCard}>
            <Text style={s.cardTitle}>Campaign type</Text>
            <View style={s.campaignTypesRow}>
              {campaignTypeChoices.map((type: string) => {
                const IconComponent = CAMPAIGN_ICONS[type];
                const picked = lookingFor.includes(type);
                return (
                  <Pressable
                    key={type}
                    disabled={!!publicUserId}
                    onPress={() => togglePick('campaign_types', type)}
                    accessibilityRole={publicUserId ? undefined : 'checkbox'}
                    accessibilityState={{ checked: picked, disabled: savingPick }}
                    accessibilityLabel={type}
                    style={({ pressed }) => [s.campaignTypeCol, pressed && s.pressedSoft]}
                  >
                    {IconComponent ? (
                      <IconComponent size={24} color={picked ? PRIMARY : IDLE_ICON} />
                    ) : (
                      <Ionicons name="pricetag-outline" size={24} color={picked ? PRIMARY : IDLE_ICON} />
                    )}
                    {/* Two short lines keep all five in one row on a phone. */}
                    <Text style={[s.campaignTypeTxt, picked && s.campaignTypeTxtPicked]}>
                      {type.replace(' ', '\n')}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {!publicUserId && lookingFor.length === 0 && (
              <Text style={s.cardFootnote}>Tap the ones you run. Creators see only what you pick.</Text>
            )}
          </View>
        )}

        {/* ════ BRAND VIBE ════ */}
        {vibeChoices.length > 0 && (
          <>
            <View style={s.rowBetween}>
              <Text style={s.sectionTitleNoMargin}>Brand vibe</Text>
              {!publicUserId && (
                <Text style={s.sectionHint}>
                  {vibes.length > 0 ? `${vibes.length} chosen` : 'Tap to choose'}
                </Text>
              )}
            </View>
            {/* All of them fit on one line, so nothing hides off the edge. */}
            <View style={s.vibesRow}>
              {vibeChoices.map((v: string) => {
                const IconComponent = VIBE_ICONS[v];
                const picked = vibes.includes(v);
                return (
                  <Pressable
                    key={v}
                    disabled={!!publicUserId}
                    onPress={() => togglePick('vibes', v)}
                    accessibilityRole={publicUserId ? undefined : 'checkbox'}
                    accessibilityState={{ checked: picked, disabled: savingPick }}
                    accessibilityLabel={v}
                    style={({ pressed }) => [
                      s.vibeWrap,
                      picked ? s.vibeWrapPicked : s.vibeWrapIdle,
                      pressed && s.pressedSoft,
                    ]}
                  >
                    {IconComponent ? (
                      <IconComponent size={22} />
                    ) : (
                      <Ionicons name="star-outline" size={22} color={PRIMARY} />
                    )}
                    <Text
                      numberOfLines={1}
                      style={[s.vibeTxt, picked ? s.vibeTxtPicked : s.vibeTxtIdle]}
                    >
                      {v}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

        {/* ════ MATCHED CREATORS (own profile only) ════ */}
        {!publicUserId && (
          <>
            <View style={s.rowBetween}>
              <Text style={s.sectionTitleNoMargin}>Matched creators</Text>
              {shownMatches.length > 0 && (
                <Pressable
                  onPress={() => router.push('/(brand-tabs)/messages')}
                  accessibilityRole="link"
                  accessibilityLabel="See all matched creators in Messages"
                  style={({ pressed }) => pressed && s.pressedSoft}
                >
                  <Text style={s.viewAll}>View all</Text>
                </Pressable>
              )}
            </View>

            {matchesLoading ? (
              <View style={s.collabRow}>
                {[0, 1, 2].map((i) => (
                  <View key={i} style={[s.collabAvatar, s.collabSkeleton, { marginLeft: i === 0 ? 0 : -15 }]} />
                ))}
              </View>
            ) : matchesFailed ? (
              <View style={s.collabRow}>
                <Text style={s.collabNote}>Could not load your matches.</Text>
                <Pressable
                  onPress={loadMatches}
                  accessibilityRole="button"
                  accessibilityLabel="Retry loading matched creators"
                  style={({ pressed }) => [s.retryBtn, pressed && s.pressedSoft]}
                >
                  <Text style={s.retryTxt}>Retry</Text>
                </Pressable>
              </View>
            ) : shownMatches.length === 0 ? (
              <View style={s.collabRow}>
                <Text style={s.collabNote}>No matches yet. Creators you match with show up here.</Text>
              </View>
            ) : (
              <Pressable
                onPress={() => router.push('/(brand-tabs)/messages')}
                accessibilityRole="button"
                accessibilityLabel={`${matchTotal} matched ${matchTotal === 1 ? 'creator' : 'creators'}. Opens Messages.`}
                style={({ pressed }) => [s.collabRow, pressed && s.pressedSoft]}
              >
                {shownMatches.map((m, i) => (
                  <View key={m.match_id} style={[s.collabAvatarWrap, { marginLeft: i === 0 ? 0 : -15 }]}>
                    <Avatar uri={m.influencer_avatar} name={m.influencer_name || 'Creator'} size={50} />
                  </View>
                ))}
                {extraMatches > 0 && (
                  <View style={[s.collabMore, { marginLeft: -15 }]}>
                    <Text style={s.collabMoreTxt}>+{extraMatches}</Text>
                  </View>
                )}
              </Pressable>
            )}
          </>
        )}

        {/* ════ BRAND CAMPAIGN CAROUSEL ════ */}
        <View style={s.rowBetween}>
          <Text style={s.sectionTitleNoMargin}>Brand campaign</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: '#666', fontSize: 13 }}>{campaignPhotos.length}/6</Text>
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
                contentFit="cover"
              />
            ))}
            {campaignPhotos.length === 0 && (
              <View style={[s.carouselImg, s.carouselEmpty, { width: width - (H * 2) }]}>
                <Ionicons name="images-outline" size={40} color="#555" />
                <Text style={s.carouselEmptyTxt}>
                  {publicUserId ? 'No campaign photos yet' : 'Add photos of your brand campaigns'}
                </Text>
              </View>
            )}
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
        {deliverables.length > 0 ? (
          <TouchableOpacity
            style={[s.wideCard, { paddingVertical: 24 }]}
            activeOpacity={publicUserId ? 1 : 0.8}
            onPress={publicUserId ? undefined : openEditModal}
            accessibilityRole={publicUserId ? undefined : 'button'}
            accessibilityLabel={publicUserId ? undefined : 'Edit deliverables'}
          >
            <Text style={[s.cardTitle, { textAlign: 'center', marginBottom: 24 }]}>Deliverables</Text>
            <View style={s.delivRow}>
              {deliverables.map(({ key, count, Icon, one, many }) => (
                <View key={key} style={s.delivItem}>
                  <View style={s.delivIconWrap}>
                    <Icon size={28} />
                  </View>
                  <Text style={s.delivTxt}>{count} {count === 1 ? one : many}</Text>
                </View>
              ))}
            </View>
          </TouchableOpacity>
        ) : !publicUserId ? (
          <TouchableOpacity style={s.emptyCard} activeOpacity={0.8} onPress={openEditModal}>
            <Ionicons name="add-circle-outline" size={20} color={PRIMARY} />
            <Text style={s.emptyCardTxt}>Add the deliverables you ask for</Text>
          </TouchableOpacity>
        ) : null}

        {/* ════ BUDGET DETAIL ════ */}
        {(budgetMin > 0 || budgetMax > 0) && (
          <TouchableOpacity
            style={s.wideCard}
            activeOpacity={publicUserId ? 1 : 0.8}
            onPress={publicUserId ? undefined : openEditModal}
            accessibilityRole={publicUserId ? undefined : 'button'}
            accessibilityLabel={publicUserId ? undefined : 'Edit budget'}
          >
            <Text style={s.cardTitle}>Budget details</Text>
            <View style={s.splitRow}>
              <View style={s.splitLeft}>
                <Text style={s.splitLabel}>Starting from</Text>
                <Text style={s.budgetValue}>{budgetMin > 0 ? `₹${formatInr(budgetMin)}` : 'Negotiable'}</Text>
              </View>
              <View style={s.splitDivider} />
              <View style={s.splitRight}>
                {paymentModeLabel(profile.payment_mode) ? (
                  <>
                    <Text style={s.splitLabel}>Payment</Text>
                    <Text style={s.termsValue}>{paymentModeLabel(profile.payment_mode)}</Text>
                    <Text style={s.termsSub}>
                      {profile.payment_days ? `Within ${profile.payment_days} days` : 'Timing not stated'}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={s.splitLabel}>Up to</Text>
                    <Text style={s.budgetValue}>{budgetMax > 0 ? `₹${formatInr(budgetMax)}` : 'Negotiable'}</Text>
                  </>
                )}
              </View>
            </View>
            {paymentModeLabel(profile.payment_mode) && (
              <Text style={s.cardFootnote}>
                Terms stated by the brand. Matchr does not hold or release payment.
              </Text>
            )}
          </TouchableOpacity>
        )}

        {/* ════ REPLY SPEED (measured, own profile only) ════ */}
        {!publicUserId && !responsivenessLoading && responsiveness && (
          <View style={s.wideCard}>
            <View style={s.splitRow}>
              <View style={s.splitLeft}>
                <Text style={s.splitLabel}>You usually reply</Text>
                <Text style={s.responseValue}>
                  {responsiveness.median_reply_seconds != null
                    ? formatReplyTime(responsiveness.median_reply_seconds)
                    : 'Not enough replies yet'}
                </Text>
              </View>
              <View style={s.splitDivider} />
              <View style={[s.splitRight, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
                <View style={{ flex: 1 }}>
                  <Text style={s.splitLabel}>Reply rate</Text>
                  <Text style={s.responseValue}>
                    {responsiveness.response_rate != null ? `${responsiveness.response_rate}%` : '--'}
                  </Text>
                </View>
                <Ionicons name="flash" size={24} color={PRIMARY} />
              </View>
            </View>
            <Text style={s.cardFootnote}>
              {responsiveness.response_rate != null
                ? `From ${responsiveness.conversations} ${responsiveness.conversations === 1 ? 'conversation' : 'conversations'} creators started. Only you see this.`
                : `Shown once ${responsiveness.min_sample} creators have messaged you. ${responsiveness.conversations} so far.`}
            </Text>
          </View>
        )}

        {/* ════ BRAND RATING ════ */}
        {(ratingCount > 0 || !publicUserId) && (
          <View style={s.wideCard}>
            <Text style={s.cardTitle}>Brand rating</Text>
            {ratingCount > 0 ? (
              <>
                <View style={s.ratingScoreRow}>
                  <Ionicons name="star" size={20} color={PRIMARY} />
                  <Text style={s.ratingValue}>{ratingAvg?.toFixed(1)}</Text>
                  <Text style={s.ratingTotal}>/5</Text>
                </View>
                <Text style={s.splitLabel}>
                  From {ratingCount} {ratingCount === 1 ? 'creator' : 'creators'} who matched with this brand
                </Text>
              </>
            ) : (
              <Text style={s.emptyLine}>
                No ratings yet. Creators can rate you from your chat once you match.
              </Text>
            )}
          </View>
        )}

        {/* ════ VERIFICATION & SAFETY ════ */}
        {(profile.verified || !publicUserId) && (
          <View style={s.wideCard}>
            <Text style={s.cardTitle}>Verification and safety</Text>
            <View style={s.splitRow}>
              <View style={s.splitLeft}>
                {profile.verified ? (
                  <>
                    <View style={s.verifyHeadRow}>
                      <Ionicons name="shield-checkmark" size={18} color={PRIMARY} />
                      <Text style={s.verifyTitle}>Verified business</Text>
                    </View>
                    <Text style={s.verifySub}>
                      {profile.verification_business_name || 'Checked by Matchr'}
                    </Text>
                  </>
                ) : verificationStatus === 'pending' ? (
                  <>
                    <View style={s.verifyHeadRow}>
                      <Ionicons name="time-outline" size={18} color={MUTED} />
                      <Text style={s.verifyTitle}>Verification pending</Text>
                    </View>
                    <Text style={s.verifySub}>We are checking your details.</Text>
                  </>
                ) : (
                  <>
                    <View style={s.verifyHeadRow}>
                      <Ionicons name="shield-outline" size={18} color={MUTED} />
                      <Text style={s.verifyTitle}>Not verified</Text>
                    </View>
                    <Text style={s.verifySub}>
                      {verificationStatus === 'rejected'
                        ? profile.verification_note || 'We could not confirm those details.'
                        : 'Creators trust a verified business.'}
                    </Text>
                    <Pressable
                      onPress={openVerifyModal}
                      accessibilityRole="button"
                      accessibilityLabel="Get verified"
                      style={({ pressed }) => [s.verifyBtn, pressed && s.pressedSoft]}
                    >
                      <Text style={s.verifyBtnTxt}>
                        {verificationStatus === 'rejected' ? 'Try again' : 'Get verified'}
                      </Text>
                    </Pressable>
                  </>
                )}
              </View>
              <View style={s.splitDivider} />
              <View style={s.splitRight}>
                <View style={s.verifyHeadRow}>
                  <Ionicons name="lock-closed-outline" size={18} color={MUTED} />
                  <Text style={s.verifyTitle}>Your privacy</Text>
                </View>
                <Text style={s.verifySub}>
                  Your exact location and email stay hidden. Anyone can be blocked or reported.
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* A creator reached this from the swipe deck; the button is that same like. */}
        {publicUserId && (
          <Pressable
            style={({ pressed }) => [
              s.interestedBtn,
              interested && s.interestedBtnDone,
              pressed && !interested && s.pressedSoft,
            ]}
            onPress={handleInterested}
            disabled={interested || sendingInterest}
            accessibilityRole="button"
            accessibilityState={{ disabled: interested || sendingInterest, busy: sendingInterest }}
          >
            {sendingInterest ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <Text style={[s.interestedTxt, interested && s.interestedTxtDone]}>
                {interested ? 'Interest sent' : 'Interested'}
              </Text>
            )}
          </Pressable>
        )}

      </ScrollView>

      {/* ════ EDIT MODAL ════ */}
      <Modal visible={editModalVisible} animationType="slide" transparent onRequestClose={closeEditModal}>
        <View style={s.modalOverlay}>
          <Pressable
            style={s.modalBackdrop}
            onPress={closeEditModal}
            accessibilityLabel="Close campaign details"
          />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={s.modalSheetWrap}
          >
            <View style={s.modalContent}>
              <View style={s.grabber} />

              <View style={s.modalHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={s.modalTitle} accessibilityRole="header">Campaign details</Text>
                  <Text style={s.modalSubtitle}>Creators check this before they message you.</Text>
                </View>
                <Pressable
                  onPress={closeEditModal}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  // `focused` is real on react-native-web but missing from the typings.
                  style={(state: any) => [
                    s.modalClose,
                    webNoOutline,
                    state.focused && s.modalCloseFocused,
                    state.pressed && s.pressedSoft,
                  ]}
                >
                  <Ionicons name="close" size={20} color="#DDD" />
                </Pressable>
              </View>

              <ScrollView
                style={s.modalScroll}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <Text style={s.fieldGroupLabel}>Budget per collaboration</Text>
                <View
                  style={[
                    s.fieldGroup,
                    (focusedField === 'min' || focusedField === 'max') && s.fieldGroupFocused,
                    showBudgetError && s.fieldGroupError,
                  ]}
                >
                  <View style={[s.fieldRow, focusedField === 'min' && s.fieldRowFocused]}>
                    <Text style={s.fieldRowLabel}>Minimum</Text>
                    <View style={s.amountWrap}>
                      <Text style={s.currency}>₹</Text>
                      <TextInput
                        style={[s.amountInput, webNoOutline]}
                        keyboardType="number-pad"
                        inputMode="numeric"
                        placeholder="20000"
                        placeholderTextColor={MUTED}
                        value={editBudgetMin}
                        onChangeText={(t) => setEditBudgetMin(onlyDigits(t, 9))}
                        onFocus={() => setFocusedField('min')}
                        onBlur={() => setFocusedField(null)}
                        accessibilityLabel="Minimum budget in rupees"
                        returnKeyType="next"
                      />
                    </View>
                  </View>

                  <View style={s.fieldDivider} />

                  <View style={[s.fieldRow, focusedField === 'max' && s.fieldRowFocused]}>
                    <Text style={s.fieldRowLabel}>Maximum</Text>
                    <View style={s.amountWrap}>
                      <Text style={s.currency}>₹</Text>
                      <TextInput
                        style={[s.amountInput, webNoOutline]}
                        keyboardType="number-pad"
                        inputMode="numeric"
                        placeholder="50000"
                        placeholderTextColor={MUTED}
                        value={editBudgetMax}
                        onChangeText={(t) => setEditBudgetMax(onlyDigits(t, 9))}
                        onFocus={() => setFocusedField('max')}
                        onBlur={() => setFocusedField(null)}
                        accessibilityLabel="Maximum budget in rupees"
                        returnKeyType="next"
                      />
                    </View>
                  </View>
                </View>
                {showBudgetError ? (
                  <View style={s.helperRow}>
                    <Ionicons name="alert-circle" size={14} color={DANGER} />
                    <Text style={[s.helperText, s.helperTextInline]}>{budgetError}</Text>
                  </View>
                ) : (
                  <Text style={s.helperText}>{budgetPreview}</Text>
                )}

                <Text style={[s.fieldGroupLabel, { marginTop: 24 }]}>Campaign length</Text>
                <View
                  style={[
                    s.fieldGroup,
                    focusedField === 'days' && s.fieldGroupFocused,
                    !!daysError && s.fieldGroupError,
                  ]}
                >
                  <View style={[s.fieldRow, focusedField === 'days' && s.fieldRowFocused]}>
                    <Text style={s.fieldRowLabel}>Duration</Text>
                    <View style={s.amountWrap}>
                      <TextInput
                        style={[s.amountInput, s.daysInput, webNoOutline]}
                        keyboardType="number-pad"
                        inputMode="numeric"
                        placeholder="15"
                        placeholderTextColor={MUTED}
                        value={editDays}
                        onChangeText={(t) => setEditDays(onlyDigits(t, 3))}
                        onFocus={() => setFocusedField('days')}
                        onBlur={() => setFocusedField(null)}
                        accessibilityLabel="Campaign duration in days"
                        returnKeyType="done"
                        onSubmitEditing={Keyboard.dismiss}
                      />
                      <Text style={s.unit}>days</Text>
                    </View>
                  </View>
                </View>
                {daysError ? (
                  <View style={s.helperRow}>
                    <Ionicons name="alert-circle" size={14} color={DANGER} />
                    <Text style={[s.helperText, s.helperTextInline]}>{daysError}</Text>
                  </View>
                ) : (
                  <Text style={s.helperText}>{daysPreview}</Text>
                )}

                <Text style={[s.fieldGroupLabel, { marginTop: 24 }]}>Deliverables</Text>
                <View
                  style={[
                    s.fieldGroup,
                    (focusedField === 'reels' || focusedField === 'stories' || focusedField === 'posts') &&
                      s.fieldGroupFocused,
                    !!deliverablesError && s.fieldGroupError,
                  ]}
                >
                  {([
                    { key: 'reels' as const, label: 'Reels', value: editReels, set: setEditReels },
                    { key: 'stories' as const, label: 'Stories', value: editStories, set: setEditStories },
                    { key: 'posts' as const, label: 'Posts', value: editPosts, set: setEditPosts },
                  ]).map((field, i) => (
                    <React.Fragment key={field.key}>
                      {i > 0 && <View style={s.fieldDivider} />}
                      <View style={[s.fieldRow, focusedField === field.key && s.fieldRowFocused]}>
                        <Text style={s.fieldRowLabel}>{field.label}</Text>
                        <View style={s.amountWrap}>
                          <TextInput
                            style={[s.amountInput, s.daysInput, webNoOutline]}
                            keyboardType="number-pad"
                            inputMode="numeric"
                            placeholder="0"
                            placeholderTextColor={MUTED}
                            value={field.value}
                            onChangeText={(t) => field.set(onlyDigits(t, 2))}
                            onFocus={() => setFocusedField(field.key)}
                            onBlur={() => setFocusedField(null)}
                            accessibilityLabel={`Number of ${field.label.toLowerCase()} you ask for`}
                            returnKeyType="done"
                            onSubmitEditing={Keyboard.dismiss}
                          />
                        </View>
                      </View>
                    </React.Fragment>
                  ))}
                </View>
                {deliverablesError ? (
                  <View style={s.helperRow}>
                    <Ionicons name="alert-circle" size={14} color={DANGER} />
                    <Text style={[s.helperText, s.helperTextInline]}>{deliverablesError}</Text>
                  </View>
                ) : (
                  <Text style={s.helperText}>{deliverablesPreview}</Text>
                )}

                <Text style={[s.fieldGroupLabel, { marginTop: 24 }]}>How you pay</Text>
                <View style={s.modeRow}>
                  {PAYMENT_MODES.map((mode) => {
                    const on = editPaymentMode === mode.value;
                    return (
                      <Pressable
                        key={mode.value}
                        // Tapping the chosen one again clears the terms.
                        onPress={() => setEditPaymentMode(on ? '' : mode.value)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                        style={({ pressed }) => [s.modeChip, on && s.modeChipOn, pressed && s.pressedSoft]}
                      >
                        <Text style={[s.modeChipTxt, on && s.modeChipTxtOn]}>{mode.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <View
                  style={[
                    s.fieldGroup,
                    { marginTop: 10 },
                    focusedField === 'payDays' && s.fieldGroupFocused,
                    !!paymentError && s.fieldGroupError,
                  ]}
                >
                  <View style={[s.fieldRow, focusedField === 'payDays' && s.fieldRowFocused]}>
                    <Text style={s.fieldRowLabel}>Paid within</Text>
                    <View style={s.amountWrap}>
                      <TextInput
                        style={[s.amountInput, s.daysInput, webNoOutline]}
                        keyboardType="number-pad"
                        inputMode="numeric"
                        placeholder="7"
                        placeholderTextColor={MUTED}
                        value={editPaymentDays}
                        onChangeText={(t) => setEditPaymentDays(onlyDigits(t, 2))}
                        onFocus={() => setFocusedField('payDays')}
                        onBlur={() => setFocusedField(null)}
                        accessibilityLabel="Days until payment"
                        returnKeyType="done"
                        onSubmitEditing={Keyboard.dismiss}
                      />
                      <Text style={s.unit}>days</Text>
                    </View>
                  </View>
                </View>
                {paymentError ? (
                  <View style={s.helperRow}>
                    <Ionicons name="alert-circle" size={14} color={DANGER} />
                    <Text style={[s.helperText, s.helperTextInline]}>{paymentError}</Text>
                  </View>
                ) : (
                  <Text style={s.helperText}>
                    Shown to creators as your own terms. Matchr does not hold or release payment.
                  </Text>
                )}
              </ScrollView>

              {saveError && (
                <View style={s.saveErrorRow}>
                  <Ionicons name="cloud-offline-outline" size={16} color={DANGER} />
                  <Text style={s.saveErrorText}>{saveError}</Text>
                </View>
              )}

              <Pressable
                style={({ pressed }) => [
                  s.saveBtn,
                  !canSave && !saving && s.saveBtnDisabled,
                  pressed && canSave && s.pressedSoft,
                ]}
                onPress={handleSaveBudget}
                disabled={!canSave}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canSave, busy: saving }}
              >
                {saving ? (
                  <View style={s.savingRow}>
                    <ActivityIndicator color="#FFF" size="small" />
                    <Text style={s.saveBtnTxt}>Saving</Text>
                  </View>
                ) : (
                  <Text style={[s.saveBtnTxt, !canSave && s.saveBtnTxtDisabled]}>Save changes</Text>
                )}
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* ════ BUSINESS VERIFICATION ════ */}
      <Modal
        visible={verifyVisible}
        animationType="slide"
        transparent
        onRequestClose={() => !verifySubmitting && setVerifyVisible(false)}
      >
        <View style={s.modalOverlay}>
          <Pressable
            style={s.modalBackdrop}
            onPress={() => !verifySubmitting && setVerifyVisible(false)}
            accessibilityLabel="Close verification"
          />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={s.modalSheetWrap}
          >
            <View style={s.modalContent}>
              <View style={s.grabber} />

              <View style={s.modalHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={s.modalTitle} accessibilityRole="header">Get verified</Text>
                  <Text style={s.modalSubtitle}>
                    We check these against public business records. Usually within two working days.
                  </Text>
                </View>
                <Pressable
                  onPress={() => !verifySubmitting && setVerifyVisible(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  style={(state: any) => [
                    s.modalClose,
                    webNoOutline,
                    state.focused && s.modalCloseFocused,
                    state.pressed && s.pressedSoft,
                  ]}
                >
                  <Ionicons name="close" size={20} color="#DDD" />
                </Pressable>
              </View>

              <Text style={s.fieldGroupLabel}>Registered business name</Text>
              <View style={[s.fieldGroup, verifyFocused === 'name' && s.fieldGroupFocused]}>
                <View style={[s.fieldRow, s.fieldRowText, verifyFocused === 'name' && s.fieldRowFocused]}>
                  <TextInput
                    style={[s.textInput, webNoOutline]}
                    placeholder="As it appears on your registration"
                    placeholderTextColor={MUTED}
                    value={verifyName}
                    onChangeText={(t) => setVerifyName(t.slice(0, 120))}
                    onFocus={() => setVerifyFocused('name')}
                    onBlur={() => setVerifyFocused(null)}
                    accessibilityLabel="Registered business name"
                    returnKeyType="next"
                  />
                </View>
              </View>

              <Text style={[s.fieldGroupLabel, { marginTop: 20 }]}>GST or company number</Text>
              <View style={[s.fieldGroup, verifyFocused === 'reg' && s.fieldGroupFocused]}>
                <View style={[s.fieldRow, s.fieldRowText, verifyFocused === 'reg' && s.fieldRowFocused]}>
                  <TextInput
                    style={[s.textInput, webNoOutline]}
                    placeholder="29ABCDE1234F1Z5"
                    placeholderTextColor={MUTED}
                    value={verifyReg}
                    onChangeText={(t) => setVerifyReg(t.toUpperCase().slice(0, 40))}
                    onFocus={() => setVerifyFocused('reg')}
                    onBlur={() => setVerifyFocused(null)}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    accessibilityLabel="GST or company registration number"
                    returnKeyType="done"
                    onSubmitEditing={Keyboard.dismiss}
                  />
                </View>
              </View>
              <Text style={s.helperText}>
                Only Matchr sees this number. Creators see the business name once you are verified.
              </Text>

              {verifyError && (
                <View style={s.saveErrorRow}>
                  <Ionicons name="alert-circle" size={16} color={DANGER} />
                  <Text style={s.saveErrorText}>{verifyError}</Text>
                </View>
              )}

              <Pressable
                style={({ pressed }) => [
                  s.saveBtn,
                  !canSubmitVerification && !verifySubmitting && s.saveBtnDisabled,
                  pressed && canSubmitVerification && s.pressedSoft,
                ]}
                onPress={submitVerification}
                disabled={!canSubmitVerification}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canSubmitVerification, busy: verifySubmitting }}
              >
                {verifySubmitting ? (
                  <View style={s.savingRow}>
                    <ActivityIndicator color="#FFF" size="small" />
                    <Text style={s.saveBtnTxt}>Sending</Text>
                  </View>
                ) : (
                  <Text style={[s.saveBtnTxt, !canSubmitVerification && s.saveBtnTxtDisabled]}>
                    Send for review
                  </Text>
                )}
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </View>
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
  logoPlaceholder: { backgroundColor: '#2A2A2A', justifyContent: 'center', alignItems: 'center' },
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

  vibesRow: {
    flexDirection: 'row',
    marginHorizontal: H,
    marginBottom: 24,
    gap: 10,
  },
  vibeWrap: {
    flex: 1,
    maxWidth: 96,
    height: 78,
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
  },
  // Unpicked is a real, readable option, not a disabled one: no dimming.
  vibeWrapIdle: { backgroundColor: '#0E0E0E', borderColor: 'rgba(255,255,255,0.10)' },
  vibeWrapPicked: { backgroundColor: 'rgba(240,90,40,0.14)', borderColor: PRIMARY },
  vibeTxt: { fontSize: 11 },
  vibeTxtIdle: { color: '#9A9A9A', fontWeight: '500' },
  vibeTxtPicked: { color: '#FFF', fontWeight: '700' },

  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: H, marginBottom: 16 },
  viewAll: { color: PRIMARY, fontSize: 12, fontWeight: '600' },
  collabRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: H, marginBottom: 32, gap: 0 },
  collabAvatar: { width: 56, height: 56, borderRadius: 28, borderWidth: 3, borderColor: BG },
  // The ring around each avatar, so overlapping faces stay separated.
  collabAvatarWrap: {
    width: 56, height: 56, borderRadius: 28, borderWidth: 3, borderColor: BG,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  collabSkeleton: { backgroundColor: '#1E1E1E' },
  collabMore: {
    width: 56, height: 56, borderRadius: 28, borderWidth: 3, borderColor: BG,
    backgroundColor: '#1C1C1C', justifyContent: 'center', alignItems: 'center',
  },
  collabMoreTxt: { color: '#FFF', fontSize: 14, fontWeight: 'bold' },
  collabNote: { color: '#8A8A8A', fontSize: 13, lineHeight: 19, flexShrink: 1 },
  retryBtn: {
    marginLeft: 12, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)',
  },
  retryTxt: { color: '#FFF', fontSize: 13, fontWeight: '600' },

  carouselWrap: {
    height: 440, marginHorizontal: H, marginBottom: 24,
    borderRadius: 20, overflow: 'hidden', position: 'relative',
    backgroundColor: '#111',
  },
  carouselImg: { width: '100%', height: '100%' },
  carouselEmpty: { justifyContent: 'center', alignItems: 'center', gap: 12, backgroundColor: '#1C1C1C' },
  carouselEmptyTxt: { color: '#777', fontSize: 13 },
  dotsRow: { position: 'absolute', bottom: 16, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot:       { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.4)' },
  dotActive: { backgroundColor: '#FFF' },
  carouselArrow: { position: 'absolute', right: 12, top: '50%', marginTop: -14 },

  cardTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: 'bold', marginBottom: 20 },
  cardFootnote: { color: MUTED, fontSize: 12, lineHeight: 17, marginTop: 16 },
  sectionHint: { color: MUTED, fontSize: 12, fontWeight: '500' },

  emptyCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: CARD_BG, borderColor: BORDER, borderRadius: 16, borderWidth: 1,
    borderStyle: 'dashed',
    paddingVertical: 20, marginBottom: 16, marginHorizontal: H,
  },
  emptyCardTxt: { color: '#BDBDBD', fontSize: 14, fontWeight: '500' },

  campaignTypesRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  campaignTypeCol: { alignItems: 'center', flex: 1, paddingHorizontal: 2 },
  campaignTypeTxt: { color: MUTED, fontSize: 9, textAlign: 'center', marginTop: 8, lineHeight: 12 },
  campaignTypeTxtPicked: { color: '#FFF' },

  delivRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  delivItem: { alignItems: 'center', flex: 1 },
  delivIconWrap: { marginBottom: 12 },
  delivTxt: { color: '#BDBDBD', fontSize: 13, fontWeight: '500' },

  splitRow: { flexDirection: 'row', alignItems: 'center' },
  splitLeft: { flex: 1, paddingRight: 16 },
  splitRight: { flex: 1, paddingLeft: 16 },
  splitDivider: { width: 1, height: '80%', minHeight: 40, backgroundColor: '#222' },
  splitLabel: { color: '#8A8A8A', fontSize: 12, marginBottom: 6, lineHeight: 16 },
  budgetValue: { color: PRIMARY, fontSize: 22, fontWeight: '800' },
  responseValue: { color: '#FFF', fontSize: 17, fontWeight: '700' },

  termsValue: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  termsSub: { color: MUTED, fontSize: 12, marginTop: 4 },
  emptyLine: { color: MUTED, fontSize: 13, lineHeight: 19 },

  ratingScoreRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginBottom: 8 },
  ratingValue: { color: '#FFF', fontSize: 30, fontWeight: '800', lineHeight: 34 },
  ratingTotal: { color: MUTED, fontSize: 15, fontWeight: '500', marginBottom: 4 },

  verifyHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 6 },
  verifyTitle: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  verifySub: { color: MUTED, fontSize: 12.5, lineHeight: 18 },
  verifyBtn: {
    marginTop: 14,
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: PRIMARY,
  },
  verifyBtnTxt: { color: PRIMARY, fontSize: 13, fontWeight: '700' },

  modeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  modeChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: '#0C0C0C',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  modeChipOn: { backgroundColor: 'rgba(240,90,40,0.14)', borderColor: PRIMARY },
  modeChipTxt: { color: '#9A9A9A', fontSize: 13, fontWeight: '500' },
  modeChipTxtOn: { color: '#FFF', fontWeight: '700' },

  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.75)' },
  modalSheetWrap: { width: '100%', maxWidth: 520, alignSelf: 'center', maxHeight: '88%' },
  modalContent: {
    backgroundColor: '#141414',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 28,
    // flexShrink defaults to 0 in React Native (unlike CSS), so without this
    // the sheet grows to its full content height, ignores modalSheetWrap's
    // maxHeight and pushes "Save changes" off the bottom of the screen.
    // Shrinking here is what lets modalScroll absorb the overflow instead.
    flexShrink: 1,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignSelf: 'center',
    marginBottom: 18,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 22,
  },
  modalTitle: { color: '#FFF', fontSize: 21, fontWeight: '700', letterSpacing: -0.4 },
  modalSubtitle: { color: MUTED, fontSize: 13, lineHeight: 18, marginTop: 4 },
  modalClose: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#1F1F1F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseFocused: { borderWidth: 1, borderColor: PRIMARY },
  modalScroll: { flexGrow: 0, flexShrink: 1 },

  fieldGroupLabel: { color: '#FFF', fontSize: 14, fontWeight: '600', marginBottom: 10 },
  fieldGroup: {
    backgroundColor: '#0C0C0C',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  // The browser's own focus ring is off, so the group has to show focus itself.
  fieldGroupFocused: { borderColor: PRIMARY },
  fieldGroupError: { borderColor: DANGER },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    height: 56,
    gap: 12,
  },
  fieldRowFocused: { backgroundColor: '#151515' },
  fieldRowLabel: { color: '#CFCFCF', fontSize: 15 },
  fieldDivider: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.1)', marginLeft: 16 },
  amountWrap: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  currency: { color: MUTED, fontSize: 17 },
  amountInput: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'right',
    minWidth: 90,
    paddingVertical: 0,
    fontVariant: ['tabular-nums'],
  },
  daysInput: { minWidth: 48 },
  // A free-text row: the input fills the row instead of sitting right-aligned.
  fieldRowText: { justifyContent: 'flex-start' },
  textInput: { flex: 1, color: '#FFF', fontSize: 16, paddingVertical: 0 },
  unit: { color: MUTED, fontSize: 15, marginLeft: 6 },
  helperRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, paddingHorizontal: 4 },
  helperText: { color: MUTED, fontSize: 12.5, lineHeight: 17, marginTop: 10, paddingHorizontal: 4, flexShrink: 1 },
  // Inside helperRow the row already carries the spacing.
  helperTextInline: { marginTop: 0, paddingHorizontal: 0, color: DANGER },

  saveErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 18,
    paddingHorizontal: 4,
  },
  saveErrorText: { color: DANGER, fontSize: 13, flexShrink: 1 },

  saveBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 16,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
  },
  saveBtnDisabled: {
    backgroundColor: '#1E1E1E',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  savingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  saveBtnTxt: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  saveBtnTxtDisabled: { color: '#6F6F6F' },
  pressedSoft: { opacity: 0.85, transform: [{ scale: 0.98 }] },

  interestedBtn: {
    alignItems: 'center', backgroundColor: PRIMARY, borderRadius: 16,
    paddingVertical: 18, marginHorizontal: H, marginTop: 12, marginBottom: 16,
  },
  interestedTxt: { color: '#FFF', fontSize: 16, fontWeight: '800' },
  interestedBtnDone: { backgroundColor: '#1E1E1E', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)' },
  interestedTxtDone: { color: '#8A8A8A' },
});
