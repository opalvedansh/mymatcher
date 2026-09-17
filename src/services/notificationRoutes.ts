import type { Href } from 'expo-router';
import type { NotificationType } from '@/api/types';

/**
 * Where a notification opens, for push taps and inbox rows alike.
 * `role` is the onboarding role ('Brand' | 'Influencer').
 */
export function notificationHref(role: string | null | undefined, type: NotificationType | undefined, matchId?: string | null): Href {
  const group = role === 'Brand' ? '(brand-tabs)' : '(influencer-tabs)';
  if (type === 'new_like') return `/${group}/likes` as Href;
  if (type === 'new_message' && matchId) {
    return { pathname: `/${group}/messages`, params: { matchId } } as Href;
  }
  return `/${group}/messages` as Href;
}
