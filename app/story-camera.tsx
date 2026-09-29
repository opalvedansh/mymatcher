import React, { useState, useRef, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons, Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { uploadImage, uploadStory } from '@/api';
import { showAlert } from '@/components/ActionSheet';
import { sz } from '@/theme/scale';

export default function StoryCameraScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<'front' | 'back'>('back');
  const [flash, setFlash] = useState<'on' | 'off' | 'auto'>('off');
  const [isUploading, setIsUploading] = useState(false);
  const cameraRef = useRef<any>(null);

  useEffect(() => {
    if (!permission?.granted && permission?.canAskAgain) {
      requestPermission();
    }
  }, [permission]);

  if (!permission) {
    return <View style={styles.container} />;
  }

  if (!permission.granted) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ color: 'white', textAlign: 'center', marginBottom: sz(20) }}>
          We need your permission to show the camera
        </Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <Text style={{ color: 'white', fontWeight: '600' }}>Grant Permission</Text>
        </TouchableOpacity>
        <TouchableOpacity style={{ marginTop: sz(20) }} onPress={() => router.back()}>
          <Text style={{ color: 'white', fontSize: sz(16) }}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function toggleCameraFacing() {
    setFacing(current => (current === 'back' ? 'front' : 'back'));
  }

  function toggleFlash() {
    setFlash(current => (current === 'off' ? 'on' : 'off'));
  }

  const handleCapture = async () => {
    if (!cameraRef.current || isUploading) return;
    
    try {
      setIsUploading(true);
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.5 });
      if (photo?.uri) {
        await uploadStory(await uploadImage(photo.uri));
        router.back();
      }
    } catch (err) {
      console.error('Failed to capture story', err);
      showAlert('Story not posted', 'Something went wrong while taking or uploading the photo. Please try again.');
    } finally {
      setIsUploading(false); // only needed if router.back() takes time or fails
    }
  };

  const handlePickImage = async () => {
    if (isUploading) return;
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.5,
    });
    
    if (!result.canceled && result.assets && result.assets.length > 0) {
      try {
        setIsUploading(true);
        await uploadStory(await uploadImage(result.assets[0].uri));
        router.back();
      } catch (err) {
        console.error('Failed to upload picked story', err);
        showAlert('Story not posted', 'Something went wrong while uploading. Please try again.');
        setIsUploading(false);
      }
    }
  };

  return (
    <View style={styles.container}>
      <CameraView style={styles.camera} facing={facing} flash={flash} ref={cameraRef}>
        <SafeAreaView style={styles.overlay}>
          {/* Top Bar */}
          <View style={styles.topBar}>
            <TouchableOpacity onPress={() => router.back()} style={styles.iconButton}>
              <Ionicons name="close" size={sz(32)} color="white" />
            </TouchableOpacity>
            
            <TouchableOpacity onPress={toggleFlash} style={styles.iconButton}>
              <Ionicons name={flash === 'on' ? "flash" : "flash-off"} size={sz(26)} color="white" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.iconButton}>
              <Ionicons name="settings-outline" size={sz(26)} color="white" />
            </TouchableOpacity>
          </View>

          {/* Side Toolbar */}
          <View style={styles.sideToolbar}>
            <TouchableOpacity style={styles.toolButton}>
              <Text style={{ color: 'white', fontSize: sz(20), fontWeight: 'bold' }}>Aa</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.toolButton}>
              <Ionicons name="infinite" size={sz(26)} color="white" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.toolButton}>
              <MaterialCommunityIcons name="view-grid-outline" size={sz(26)} color="white" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.toolButton}>
              <Feather name="stop-circle" size={sz(26)} color="white" />
            </TouchableOpacity>
          </View>

          {/* Bottom Bar */}
          <View style={styles.bottomBar}>
            {/* Gallery picker */}
            <TouchableOpacity
              style={styles.galleryButton}
              onPress={handlePickImage}
              disabled={isUploading}
              accessibilityRole="button"
              accessibilityLabel="Choose from library"
            >
              <Ionicons name="images-outline" size={sz(20)} color="white" />
            </TouchableOpacity>

            {/* Capture Button */}
            <View style={styles.captureButtonContainer}>
              <TouchableOpacity style={styles.captureButtonInner} onPress={handleCapture} disabled={isUploading}>
                {isUploading && <ActivityIndicator color="#000" size="large" />}
              </TouchableOpacity>
            </View>

            {/* Flip Camera */}
            <TouchableOpacity style={styles.flipButton} onPress={toggleCameraFacing}>
              <Ionicons name="camera-reverse-outline" size={sz(30)} color="white" />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </CameraView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'space-between',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: sz(20),
    paddingTop: sz(20),
  },
  iconButton: {
    width: sz(44),
    height: sz(44),
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.5,
    shadowRadius: sz(2),
  },
  sideToolbar: {
    position: 'absolute',
    left: sz(20),
    top: '30%',
    alignItems: 'center',
    gap: sz(24),
  },
  toolButton: {
    width: sz(40),
    height: sz(40),
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.5,
    shadowRadius: sz(2),
  },
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: sz(40),
    paddingBottom: sz(40),
  },
  galleryButton: {
    width: sz(40),
    height: sz(40),
    borderRadius: sz(8),
    borderWidth: 2,
    borderColor: 'white',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureButtonContainer: {
    width: sz(80),
    height: sz(80),
    borderRadius: sz(40),
    borderWidth: 4,
    borderColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureButtonInner: {
    width: sz(66),
    height: sz(66),
    borderRadius: sz(33),
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
  },
  flipButton: {
    width: sz(44),
    height: sz(44),
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: sz(22),
  },
  permissionButton: {
    backgroundColor: '#FF6B2B',
    paddingHorizontal: sz(24),
    paddingVertical: sz(14),
    borderRadius: sz(12),
  },
});
