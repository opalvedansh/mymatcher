import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { getUnreadNotificationCount } from '@/api';
import { pushSupported } from '@/services/pushNotifications';

const POLL_MS = 60_000;
const listeners = new Set<() => void>();

/** Tells every mounted bell to re-fetch (e.g. after items are marked read). */
export function refreshUnreadNotifications() {
  listeners.forEach(listener => listener());
}

/**
 * Unread inbox count for the bell badge. Refreshes on focus, on push, on
 * returning to the app, and every minute while focused and in the foreground.
 */
export function useUnreadNotifications() {
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    getUnreadNotificationCount()
      .then(res => setCount(res.count ?? 0))
      .catch(() => {/* keep the last known count */});
  }, []);

  useEffect(() => {
    listeners.add(refresh);
    const sub = pushSupported ? Notifications.addNotificationReceivedListener(refresh) : null;
    return () => {
      listeners.delete(refresh);
      sub?.remove();
    };
  }, [refresh]);

  useFocusEffect(
    useCallback(() => {
      let timer: ReturnType<typeof setInterval> | null = null;
      const start = () => {
        refresh();
        if (!timer) timer = setInterval(refresh, POLL_MS);
      };
      const stop = () => {
        if (timer) clearInterval(timer);
        timer = null;
      };
      start();
      // Focus doesn't change when the app is backgrounded, so polling would
      // carry on there and the badge would be up to a minute stale on return.
      const sub = AppState.addEventListener('change', (state) => (state === 'active' ? start() : stop()));
      return () => {
        stop();
        sub.remove();
      };
    }, [refresh]),
  );

  return count;
}
