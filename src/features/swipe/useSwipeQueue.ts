import { useCallback, useEffect, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { getFeed, recordSwipe } from '@/api';
import type { SwipeResponse } from '@/api/types';
import type { SwipeDir } from './SwipeDeck';

const PAGE_SIZE = 20;
// Fetch the next page while this many cards are still left. At ~250ms a swipe,
// three cards was under a second of runway and the deck flashed "that's
// everyone" before the page arrived.
const LOW_WATER = 8;
// How many upcoming card photos to pull into the cache ahead of the user.
const PREFETCH_AHEAD = 3;

type Profile = { user_id: string };

/**
 * The discovery feed as a queue of cards still to be swiped (top card first).
 * Swipes remove a card by id, so a failed swipe puts back only that card
 * instead of rewinding past the ones swiped after it.
 */
export function useSwipeQueue<T extends Profile>(photoOf: (p: T) => string | null) {
  const [deck, setDeck] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const cursorRef = useRef<{ score: number | null; id: string | null }>({ score: null, id: null });
  const seenRef = useRef(new Set<string>());
  const loadingMoreRef = useRef(false);
  // Bumped on every full reload so a page from before a refresh is dropped.
  const genRef = useRef(0);

  const loadFeed = useCallback(async () => {
    const gen = ++genRef.current;
    setLoading(true);
    setError(false);
    try {
      // No cursor on the first page; the server hands back the next one.
      const res = await getFeed(PAGE_SIZE);
      if (gen !== genRef.current) return;
      const page = res.data as unknown as T[];
      seenRef.current = new Set(page.map((p) => p.user_id));
      cursorRef.current = { score: res.next_cursor_score, id: res.next_cursor_id };
      setDeck(page);
    } catch (e) {
      console.warn('[API] getFeed failed:', e);
      if (gen === genRef.current) setError(true);
    } finally {
      if (gen === genRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => { loadFeed(); }, [loadFeed]);

  const loadMore = useCallback(async () => {
    const { score, id } = cursorRef.current;
    if (loadingMoreRef.current || !id) return;
    const gen = genRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const res = await getFeed(PAGE_SIZE, score ?? undefined, id);
      if (gen !== genRef.current) return;
      cursorRef.current = { score: res.next_cursor_score, id: res.next_cursor_id };
      const fresh = (res.data as unknown as T[]).filter((p) => !seenRef.current.has(p.user_id));
      fresh.forEach((p) => seenRef.current.add(p.user_id));
      if (fresh.length) setDeck((d) => [...d, ...fresh]);
    } catch {
      /* the next swipe retries */
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    if (!loading && !error && deck.length <= LOW_WATER) loadMore();
  }, [deck.length, loading, error, loadMore]);

  // Only two cards are mounted, so warm the photos of the next few; otherwise
  // every swipe reveals a card whose photo has not started downloading yet.
  const photoRef = useRef(photoOf);
  photoRef.current = photoOf;
  useEffect(() => {
    const urls = deck
      .slice(1, 1 + PREFETCH_AHEAD)
      .map((p) => photoRef.current(p))
      .filter((u): u is string => !!u);
    if (urls.length) Image.prefetch(urls, { cachePolicy: 'memory-disk' }).catch(() => {});
  }, [deck]);

  /** Removes the card and records the swipe; on failure the card goes back on top and this throws. */
  const commit = useCallback(async (item: T, dir: SwipeDir): Promise<SwipeResponse> => {
    const gen = genRef.current;
    setDeck((d) => d.filter((p) => p.user_id !== item.user_id));
    try {
      return await recordSwipe(item.user_id, dir === 'right' ? 'like' : 'reject');
    } catch (e) {
      if (gen === genRef.current) {
        setDeck((d) => (d.some((p) => p.user_id === item.user_id) ? d : [item, ...d]));
      }
      throw e;
    }
  }, []);

  return { deck, loading, error, loadingMore, loadFeed, commit };
}
