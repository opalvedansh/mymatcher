import React, { useState, useRef, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, SafeAreaView, ActivityIndicator, Image } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons, Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { uploadImage, uploadStory } from '@/api';

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
        <Text style={{ color: 'white', textAlign: 'center', marginBottom: 20 }}>
          We need your permission to show the camera
        </Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <Text style={{ color: 'white', fontWeight: '600' }}>Grant Permission</Text>
        </TouchableOpacity>
        <TouchableOpacity style={{ marginTop: 20 }} onPress={() => router.back()}>
          <Text style={{ color: 'white', fontSize: 16 }}>Cancel</Text>
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
              <Ionicons name="close" size={32} color="white" />
            </TouchableOpacity>
            
            <TouchableOpacity onPress={toggleFlash} style={styles.iconButton}>
              <Ionicons name={flash === 'on' ? "flash" : "flash-off"} size={26} color="white" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.iconButton}>
              <Ionicons name="settings-outline" size={26} color="white" />
            </TouchableOpacity>
          </View>

          {/* Side Toolbar */}
          <View style={styles.sideToolbar}>
            <TouchableOpacity style={styles.toolButton}>
              <Text style={{ color: 'white', fontSize: 20, fontWeight: 'bold' }}>Aa</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.toolButton}>
              <Ionicons name="infinite" size={26} color="white" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.toolButton}>
              <MaterialCommunityIcons name="view-grid-outline" size={26} color="white" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.toolButton}>
              <Feather name="stop-circle" size={26} color="white" />
            </TouchableOpacity>
          </View>

          {/* Bottom Bar */}
          <View style={styles.bottomBar}>
            {/* Gallery Picker Thumbnail */}
            <TouchableOpacity style={styles.galleryButton} onPress={handlePickImage}>
              <Image 
                source={{ uri: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100&q=80' }} 
                style={styles.galleryThumbnail} 
              />
            </TouchableOpacity>

            {/* Capture Button */}
            <View style={styles.captureButtonContainer}>
              <TouchableOpacity style={styles.captureButtonInner} onPress={handleCapture} disabled={isUploading}>
                {isUploading && <ActivityIndicator color="#000" size="large" />}
              </TouchableOpacity>
            </View>

            {/* Flip Camera */}
            <TouchableOpacity style={styles.flipButton} onPress={toggleCameraFacing}>
              <Ionicons name="camera-reverse-outline" size={30} color="white" />
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
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  iconButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.5,
    shadowRadius: 2,
  },
  sideToolbar: {
    position: 'absolute',
    left: 20,
    top: '30%',
    alignItems: 'center',
    gap: 24,
  },
  toolButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.5,
    shadowRadius: 2,
  },
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingBottom: 40,
  },
  galleryButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'white',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  galleryThumbnail: {
    width: '100%',
    height: '100%',
  },
  captureButtonContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureButtonInner: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
  },
  flipButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 22,
  },
  permissionButton: {
    backgroundColor: '#FF6B2B',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
});
