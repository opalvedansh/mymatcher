import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Animated,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { sz } from '@/theme/scale';

interface MatchBoomModalProps {
  visible: boolean;
  meAvatar?: string | null;
  themAvatar?: string | null;
  themName?: string;
  onClose: () => void;
  onIntroduce: () => void;
}

export function MatchBoomModal({
  visible,
  meAvatar,
  themAvatar,
  themName,
  onClose,
  onIntroduce,
}: MatchBoomModalProps) {
  const { width, height } = useWindowDimensions();
  
  // Animation values
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Parents clear the match as they close us; hold on to what was shown so the
  // avatars don't change mid fade-out.
  const shown = useRef({ meAvatar, themAvatar, themName });
  if (visible) shown.current = { meAvatar, themAvatar, themName };

  useEffect(() => {
    if (visible) {
      scaleAnim.setValue(0);
      fadeAnim.setValue(0);
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 6,
          tension: 40,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, scaleAnim, fadeAnim]);

  // The Modal stays mounted so its fade-out can play when it closes.
  const RINGS = [1, 2, 3, 4, 5, 6];
  const maxRingSize = Math.max(width, height) * 1.5;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.container}>
        {/* Concentric rings background */}
        {RINGS.map((ring, index) => {
          const ringSize = (maxRingSize / RINGS.length) * (index + 1);
          return (
            <View
              key={ring}
              style={[
                styles.ring,
                {
                  width: ringSize,
                  height: ringSize,
                  borderRadius: ringSize / 2,
                  opacity: 0.15 - index * 0.02, // inner rings more opaque
                },
              ]}
            />
          );
        })}

        <Animated.View
          style={[
            styles.content,
            {
              opacity: fadeAnim,
              transform: [{ scale: scaleAnim }],
            },
          ]}
        >
          {/* Typography */}
          <Text style={styles.subText}>It's a</Text>
          <Text style={styles.boomText}>BOOM!</Text>

          {/* Avatars */}
          <View style={styles.avatarsContainer}>
            <View style={[styles.avatarWrapper, { zIndex: 1, marginRight: sz(-25) }]}>
              <Avatar uri={shown.current.meAvatar} />
            </View>
            <View style={[styles.avatarWrapper, { zIndex: 2 }]}>
              <Avatar uri={shown.current.themAvatar} initial={shown.current.themName} />
            </View>
          </View>
        </Animated.View>

        {/* Action Button */}
        <Animated.View
          style={[
            styles.bottomContainer,
            {
              opacity: fadeAnim,
              transform: [
                {
                  translateY: fadeAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [50, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <Pressable style={styles.button} onPress={onIntroduce}>
            <Text style={styles.buttonText}>Introduce yourself...</Text>
          </Pressable>
          <Pressable style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>Keep Swiping</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

// A missing photo shows an initial, never a stock stranger's face.
function Avatar({ uri, initial }: { uri?: string | null; initial?: string }) {
  if (uri) {
    return <Image source={{ uri }} style={styles.avatar} contentFit="cover" cachePolicy="memory-disk" transition={150} />;
  }
  return (
    <View style={[styles.avatar, styles.avatarFallback]}>
      <Text style={styles.avatarInitial}>{(initial?.trim().charAt(0) || '?').toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FF6B2B', // Vivid Orange
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  ring: {
    position: 'absolute',
    backgroundColor: 'transparent',
    borderWidth: 60,
    borderColor: '#FFF',
  },
  content: {
    alignItems: 'center',
    zIndex: 10,
    marginBottom: sz(60),
  },
  subText: {
    color: '#FFF',
    fontSize: sz(22),
    fontWeight: '800',
    marginBottom: sz(-5),
  },
  boomText: {
    color: '#FFF',
    fontSize: sz(68),
    fontWeight: '900',
    letterSpacing: sz(2),
    textShadowColor: 'rgba(0,0,0,0.2)',
    textShadowOffset: { width: 0, height: sz(4) },
    textShadowRadius: sz(10),
    marginBottom: sz(40),
  },
  avatarsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarWrapper: {
    width: sz(130),
    height: sz(130),
    borderRadius: sz(65),
    borderWidth: 4,
    borderColor: '#FFF',
    backgroundColor: '#FFF',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: sz(10) },
    shadowOpacity: 0.2,
    shadowRadius: sz(15),
    elevation: 10,
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  avatarFallback: {
    backgroundColor: '#2A2A2A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: '#FFF',
    fontSize: sz(48),
    fontWeight: '800',
  },
  bottomContainer: {
    position: 'absolute',
    bottom: sz(50),
    width: '100%',
    paddingHorizontal: sz(40),
    alignItems: 'center',
    zIndex: 10,
  },
  button: {
    backgroundColor: '#FFF',
    width: '100%',
    paddingVertical: sz(18),
    borderRadius: sz(30),
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: sz(5) },
    shadowOpacity: 0.15,
    shadowRadius: sz(10),
    elevation: 5,
    marginBottom: sz(20),
  },
  buttonText: {
    color: '#888',
    fontSize: sz(16),
    fontWeight: '600',
  },
  closeButton: {
    paddingVertical: sz(10),
    paddingHorizontal: sz(20),
  },
  closeButtonText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: sz(16),
    fontWeight: '700',
  },
});
