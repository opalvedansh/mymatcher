import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  Pressable,
  SafeAreaView
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

interface Props {
  visible: boolean;
  onClose: () => void;
  profile: any; // BrandProfile | InfluencerProfile
  type: 'brand' | 'influencer';
}

export function PublicProfileModal({ visible, onClose, profile, type }: Props) {
  if (!profile) return null;

  const isBrand = type === 'brand';
  const name = profile.name || profile.company_name || 'Unknown';
  const rawUrl = isBrand ? (profile.cover_url ?? profile.logo_url) : (profile.photos?.[0] ?? profile.avatar_url);
  const avatarUrl = rawUrl && !rawUrl.startsWith('blob:') ? rawUrl : 'https://images.unsplash.com/photo-1611930022073-84af31bf7093?w=800&q=80';
  
  const bio = profile.bio || '';
  const location = profile.location || '';
  
  // Brand specific
  const budget = profile.budget_min ? `$${profile.budget_min / 1000}k+` : 'Negotiable';
  const campaignTypes = profile.campaign_types || [];
  const vibes = profile.vibes || [];
  
  // Influencer specific
  const followers = profile.instagram_followers ? (profile.instagram_followers / 1000).toFixed(1) + 'k' : '10k';
  const engagement = profile.engagement_rate ? profile.engagement_rate + '%' : '5%';
  const reach = '50k';
  const contentTypes = profile.content_types || [];
  
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalBg}>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.container}>
            {/* Header / Close button */}
            <Pressable style={styles.closeBtn} onPress={onClose}>
              <Ionicons name="close" size={28} color="#fff" />
            </Pressable>

            <ScrollView bounces={false} contentContainerStyle={{ paddingBottom: 60 }}>
              {/* Cover Image */}
              <View style={styles.coverContainer}>
                <Image source={{ uri: avatarUrl }} style={styles.coverImage} />
                <LinearGradient
                  colors={['rgba(0,0,0,0)', 'rgba(18,18,18,1)']}
                  style={styles.coverGradient}
                />
              </View>

              {/* Profile Info */}
              <View style={styles.infoContainer}>
                <View style={styles.nameRow}>
                  <Text style={styles.nameTxt}>{name}</Text>
                  <MaterialCommunityIcons name="check-decagram" size={20} color="#1DA1F2" style={{ marginLeft: 8 }} />
                </View>
                
                {location ? (
                  <View style={styles.locationRow}>
                    <Ionicons name="location-sharp" size={16} color="#aaa" />
                    <Text style={styles.locationTxt}>{location}</Text>
                  </View>
                ) : null}

                <Text style={styles.bioTxt}>{bio}</Text>

                {/* Stats Row */}
                <View style={styles.statsRow}>
                  {isBrand ? (
                    <>
                      <View style={styles.statCol}>
                        <Text style={styles.statVal}>{budget}</Text>
                        <Text style={styles.statLbl}>Budget</Text>
                      </View>
                      <View style={styles.statCol}>
                        <Text style={styles.statVal}>{vibes.length > 0 ? vibes[0] : 'Premium'}</Text>
                        <Text style={styles.statLbl}>Vibe</Text>
                      </View>
                      <View style={styles.statCol}>
                        <Text style={styles.statVal}>Active</Text>
                        <Text style={styles.statLbl}>Campaigns</Text>
                      </View>
                    </>
                  ) : (
                    <>
                      <View style={styles.statCol}>
                        <Text style={styles.statVal}>{followers}</Text>
                        <Text style={styles.statLbl}>Followers</Text>
                      </View>
                      <View style={styles.statCol}>
                        <Text style={styles.statVal}>{engagement}</Text>
                        <Text style={styles.statLbl}>Engagement</Text>
                      </View>
                      <View style={styles.statCol}>
                        <Text style={styles.statVal}>{reach}</Text>
                        <Text style={styles.statLbl}>Reach</Text>
                      </View>
                    </>
                  )}
                </View>

                {/* Tags Section */}
                {(campaignTypes.length > 0 || contentTypes.length > 0) && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{isBrand ? 'Looking for' : 'Creates'}</Text>
                    <View style={styles.tagsContainer}>
                      {(isBrand ? campaignTypes : contentTypes).map((t: string) => (
                        <View key={t} style={styles.pill}>
                          <Text style={styles.pillTxt}>{t}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

              </View>
            </ScrollView>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
  },
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: '#121212',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    marginTop: 40,
  },
  closeBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
    padding: 4,
  },
  coverContainer: {
    width: '100%',
    height: 400,
  },
  coverImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  coverGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 150,
  },
  infoContainer: {
    padding: 24,
    paddingTop: 0,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  nameTxt: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '700',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  locationTxt: {
    color: '#aaa',
    fontSize: 14,
    marginLeft: 4,
  },
  bioTxt: {
    color: '#ccc',
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 24,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
  },
  statCol: {
    alignItems: 'center',
  },
  statVal: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  statLbl: {
    color: '#888',
    fontSize: 12,
  },
  section: {
    marginTop: 16,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: '#1a1a1a',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#333',
  },
  pillTxt: {
    color: '#fff',
    fontSize: 11,
  },
});
