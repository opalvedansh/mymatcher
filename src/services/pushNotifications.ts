import type { NotificationType } from '@/api/types';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import api from '@/api/client';

export type PushData = { type?: NotificationType; matchId?: string | null; /** Who mentioned you, for a story mention. */ authorId?: string | null };

// Expo push is native-only; the web app uses browser push (below) where available.
export const pushSupported = Platform.OS === 'ios' || Platform.OS === 'android';

// ─── Browser push (web app) ───────────────────────────────────────
// A service worker (public/sw.js) plus a VAPID subscription saved on the server.
const VAPID_PUBLIC_KEY = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY;
const SW_URL = `${process.env.EXPO_BASE_URL ?? ''}/sw.js`;

export const webPushSupported = Platform.OS === 'web' && !!VAPID_PUBLIC_KEY
  && typeof navigator !== 'undefined' && 'serviceWorker' in navigator
  && typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window;

/** The browser's notification permission, or null where browser push is unavailable. */
export function webPushPermission(): NotificationPermission | null {
  return webPushSupported ? Notification.permission : null;
}

function base64UrlToBytes(base64Url: string): Uint8Array {
  const base64 = (base64Url + '='.repeat((4 - (base64Url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

// Browsers only show the permission prompt from a user gesture, so `ask` is
// true only when called from a tap; sign-in just renews an existing grant.
async function registerWebPush(ask: boolean): Promise<void> {
  if (Notification.permission !== 'granted') {
    if (!ask || (await Notification.requestPermission()) !== 'granted') return;
  }
  const registration = await navigator.serviceWorker.register(SW_URL);
  const subscription = (await registration.pushManager.getSubscription())
    ?? (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(VAPID_PUBLIC_KEY!) as BufferSource,
    }));
  await api.put('/api/auth/web-push', subscription.toJSON());
}

/** Turns on browser notifications. Call from a button press. Resolves to the resulting permission. */
export async function enableWebPush(): Promise<NotificationPermission | null> {
  if (!webPushSupported) return null;
  try {
    await registerWebPush(true);
  } catch (err) {
    console.warn('[Push] Web push setup failed:', err);
  }
  return Notification.permission;
}

// A tap on a notification with no app tab open starts the app at /app/?push=…
// Read it before the router or the auth redirect replaces the URL.
let launchPush: PushData | null = null;
if (Platform.OS === 'web' && typeof window !== 'undefined') {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('push');
  if (raw) {
    try { launchPush = JSON.parse(raw); } catch { /* malformed link: ignore */ }
    params.delete('push');
    const query = params.toString();
    window.history.replaceState(window.history.state, '', window.location.pathname + (query ? `?${query}` : '') + window.location.hash);
  }
}

/**
 * Calls `open` for browser notification taps: the one that launched the app,
 * then each tap while a tab is open (relayed by the service worker).
 */
export function onWebPushOpen(open: (data: PushData) => void): () => void {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => {};
  let active = true;
  const launch = launchPush;
  launchPush = null;
  // Deferred like the native cold-start path, so it lands after the auth redirect to home.
  if (launch?.type) Promise.resolve().then(() => active && open(launch));
  const onMessage = (event: MessageEvent) => {
    if (event.data?.type === 'matchr-push-open' && event.data.data?.type) open(event.data.data);
  };
  navigator.serviceWorker.addEventListener('message', onMessage);
  return () => {
    active = false;
    navigator.serviceWorker.removeEventListener('message', onMessage);
  };
}

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
  if (webPushSupported) {
    await registerWebPush(false).catch((err) => console.warn('[Push] Web push renewal skipped:', err));
    return;
  }
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
  if (webPushSupported) {
    // The next account to sign in on this browser must not get this one's notifications.
    try {
      const registration = await navigator.serviceWorker.getRegistration(SW_URL);
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await api.delete(`/api/auth/web-push?endpoint=${encodeURIComponent(subscription.endpoint)}`);
        await subscription.unsubscribe();
      }
    } catch (err) {
      console.warn('[Push] Could not remove web push subscription:', err);
    }
    return;
  }
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
