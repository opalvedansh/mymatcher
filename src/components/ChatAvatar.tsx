import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';

/** Round avatar that falls back to the person's initial when there is no usable photo. */
export function Avatar({ uri, name, size }: { uri?: string | null; name: string; size: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);

  const box = { width: size, height: size, borderRadius: size / 2 };
  if (uri && !failed) {
    return <Image source={{ uri }} style={[box, styles.avatarImage]} onError={() => setFailed(true)} />;
  }
  return (
    <View style={[box, styles.avatarFallback]}>
      <Text style={[styles.avatarInitial, { fontSize: size * 0.38 }]}>{(name.trim()[0] || '?').toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatarImage: { backgroundColor: '#2A2A2A' },
  avatarFallback: { backgroundColor: '#2A2A2A', justifyContent: 'center', alignItems: 'center' },
  avatarInitial: { color: '#D0D0D0', fontWeight: '700' },
});
