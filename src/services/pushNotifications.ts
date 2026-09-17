import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import api from '@/api/client';

export type PushData = { type?: 'new_match' | 'new_like' | 'new_message'; matchId?: string | null };

// Push is native-only; the web app still has the in-app inbox.
export const pushSupported = Platform.OS === 'ios' || Platform.OS === 'android';

let lastRegisteredToken: string | null = null;

if (pushSupported) {
  // Show banners for notifications that arrive while the app is open.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Asks for permission and saves this device's Expo push token for the signed-in user.
 * Never throws: a denied permission, a simulator or a network error just means no push.
 */
export async function registerForPush(): Promise<void> {
  if (!pushSupported) return;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== 'granted') return;

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    if (!token || token === lastRegisteredToken) return;

    await api.put('/api/auth/push-token', { token });
    lastRegisteredToken = token;
  } catch (err) {
    console.warn('[Push] Registration skipped:', err);
  }
}

/** Stops push to this device for the current user. Call before the session ends. */
export async function unregisterPush(): Promise<void> {
  if (!pushSupported || !lastRegisteredToken) return;
  try {
    await api.put('/api/auth/push-token', { token: null });
  } catch (err) {
    console.warn('[Push] Could not clear token:', err);
  } finally {
    lastRegisteredToken = null;
  }
}

/** Reads the routing data the server puts on each push. */
export function pushDataOf(response: Notifications.NotificationResponse | null | undefined): PushData | null {
  const data = response?.notification.request.content.data as PushData | undefined;
  return data?.type ? data : null;
}
