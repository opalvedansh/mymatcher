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
import { sz } from '@/theme/scale';

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
              <Ionicons name="close" size={sz(28)} color="#fff" />
            </Pressable>

            <ScrollView bounces={false} contentContainerStyle={{ paddingBottom: sz(60) }}>
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
                  <MaterialCommunityIcons name="check-decagram" size={sz(20)} color="#1DA1F2" style={{ marginLeft: sz(8) }} />
                </View>
                
                {location ? (
                  <View style={styles.locationRow}>
                    <Ionicons name="location-sharp" size={sz(16)} color="#aaa" />
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
    borderTopLeftRadius: sz(24),
    borderTopRightRadius: sz(24),
    overflow: 'hidden',
    marginTop: sz(40),
  },
  closeBtn: {
    position: 'absolute',
    top: sz(16),
    right: sz(16),
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: sz(20),
    padding: sz(4),
  },
  coverContainer: {
    width: '100%',
    height: sz(400),
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
    height: sz(150),
  },
  infoContainer: {
    padding: sz(24),
    paddingTop: 0,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: sz(8),
  },
  nameTxt: {
    color: '#fff',
    fontSize: sz(28),
    fontWeight: '700',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: sz(16),
  },
  locationTxt: {
    color: '#aaa',
    fontSize: sz(14),
    marginLeft: sz(4),
  },
  bioTxt: {
    color: '#ccc',
    fontSize: sz(16),
    lineHeight: sz(24),
    marginBottom: sz(24),
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#1a1a1a',
    borderRadius: sz(16),
    padding: sz(20),
    marginBottom: sz(24),
  },
  statCol: {
    alignItems: 'center',
  },
  statVal: {
    color: '#fff',
    fontSize: sz(20),
    fontWeight: '700',
    marginBottom: sz(4),
  },
  statLbl: {
    color: '#888',
    fontSize: sz(12),
  },
  section: {
    marginTop: sz(16),
  },
  sectionTitle: {
    color: '#fff',
    fontSize: sz(18),
    fontWeight: '600',
    marginBottom: sz(12),
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: sz(8),
  },
  pill: {
    paddingHorizontal: sz(12),
    paddingVertical: sz(5),
    backgroundColor: '#1a1a1a',
    borderRadius: sz(20),
    borderWidth: 1,
    borderColor: '#333',
  },
  pillTxt: {
    color: '#fff',
    fontSize: sz(11),
  },
});
