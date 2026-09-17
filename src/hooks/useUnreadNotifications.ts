import { useCallback, useEffect, useState } from 'react';
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

/** Unread inbox count for the bell badge. Refreshes on focus, on push, and every minute while focused. */
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
      refresh();
      const timer = setInterval(refresh, POLL_MS);
      return () => clearInterval(timer);
    }, [refresh]),
  );

  return count;
}
