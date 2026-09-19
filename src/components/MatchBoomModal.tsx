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

interface MatchBoomModalProps {
  visible: boolean;
  meAvatar?: string | null;
  themAvatar?: string | null;
  onClose: () => void;
  onIntroduce: () => void;
}

export function MatchBoomModal({
  visible,
  meAvatar,
  themAvatar,
  onClose,
  onIntroduce,
}: MatchBoomModalProps) {
  const { width, height } = useWindowDimensions();
  
  // Animation values
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
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
    } else {
      scaleAnim.setValue(0);
      fadeAnim.setValue(0);
    }
  }, [visible]);

  if (!visible) return null;

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
            <View style={[styles.avatarWrapper, { zIndex: 1, marginRight: -25 }]}>
              <Image
                source={{ uri: meAvatar || 'https://picsum.photos/200' }}
                style={styles.avatar}
              />
            </View>
            <View style={[styles.avatarWrapper, { zIndex: 2 }]}>
              <Image
                source={{ uri: themAvatar || 'https://picsum.photos/201' }}
                style={styles.avatar}
              />
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
    marginBottom: 60,
  },
  subText: {
    color: '#FFF',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: -5,
  },
  boomText: {
    color: '#FFF',
    fontSize: 68,
    fontWeight: '900',
    letterSpacing: 2,
    textShadowColor: 'rgba(0,0,0,0.2)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 10,
    marginBottom: 40,
  },
  avatarsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarWrapper: {
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 4,
    borderColor: '#FFF',
    backgroundColor: '#FFF',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 15,
    elevation: 10,
  },
  avatar: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  bottomContainer: {
    position: 'absolute',
    bottom: 50,
    width: '100%',
    paddingHorizontal: 40,
    alignItems: 'center',
    zIndex: 10,
  },
  button: {
    backgroundColor: '#FFF',
    width: '100%',
    paddingVertical: 18,
    borderRadius: 30,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 5,
    marginBottom: 20,
  },
  buttonText: {
    color: '#888',
    fontSize: 16,
    fontWeight: '600',
  },
  closeButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  closeButtonText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 16,
    fontWeight: '700',
  },
});
