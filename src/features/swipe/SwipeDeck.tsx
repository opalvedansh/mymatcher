import React, { memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { sz } from '@/theme/scale';
import { tapFeedback } from '@/utils/optionalModules';

export type SwipeDir = 'left' | 'right';
export type SwipeDeckHandle = { swipe: (dir: SwipeDir) => void };

type Props<T> = {
  /** Cards still to be swiped, top card first. */
  items: T[];
  keyOf: (item: T) => string;
  labelOf: (item: T) => string;
  /**
   * renderCard and the stamps must be stable (module-level or memoised), or
   * every parent render re-renders both cards.
   */
  renderCard: (item: T) => React.ReactNode;
  likeStamp: React.ReactNode;
  nopeStamp: React.ReactNode;
  onSwipe: (item: T, dir: SwipeDir) => void;
  onOpen?: (item: T) => void;
  ref?: React.Ref<SwipeDeckHandle>;
};

// Only the top two cards are mounted, so the rest don't load images yet.
const VISIBLE = 2;
const FLING_VELOCITY = 600;
const BACK_SCALE = 0.97;
const BACK_OFFSET = sz(6);
// Close to critically damped: settles back to centre without wobbling.
const SNAP_BACK = { damping: 24, stiffness: 260, mass: 1 };

/**
 * A Tinder-style card stack. Each card owns its own position, so the card that
 * was just swiped stays off-screen until React unmounts it (a shared position
 * reset to 0 used to flash it back in the centre for a frame). A UI-thread
 * `exiting` flag makes every swipe land exactly once, whether it came from a
 * drag, a fling or the Like/Pass buttons.
 */
export function SwipeDeck<T>({ items, keyOf, labelOf, renderCard, likeStamp, nopeStamp, onSwipe, onOpen, ref }: Props<T>) {
  // How far the top card has travelled; the card behind grows into place from it.
  const topX = useSharedValue(0);
  const exiting = useSharedValue(false);
  const flyRef = useRef<((dir: SwipeDir) => void) | null>(null);

  // Parents re-create these every render; cards read the latest through refs
  // so they stay memoised.
  const onSwipeRef = useRef(onSwipe);
  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onSwipeRef.current = onSwipe;
    onOpenRef.current = onOpen;
  });
  const commit = useCallback((item: T, dir: SwipeDir) => onSwipeRef.current(item, dir), []);
  const open = useCallback((item: T) => onOpenRef.current?.(item), []);

  useImperativeHandle(ref, () => ({ swipe: (dir) => flyRef.current?.(dir) }), []);

  return (
    <>
      {items
        .slice(0, VISIBLE)
        .map((item, offset) => (
          <SwipeCard
            key={keyOf(item)}
            item={item}
            isTop={offset === 0}
            label={labelOf(item)}
            renderCard={renderCard}
            likeStamp={likeStamp}
            nopeStamp={nopeStamp}
            topX={topX}
            exiting={exiting}
            flyRef={flyRef}
            onCommit={commit}
            onOpen={open}
          />
        ))
        .reverse()}
    </>
  );
}

type CardProps<T> = {
  item: T;
  isTop: boolean;
  label: string;
  renderCard: (item: T) => React.ReactNode;
  likeStamp: React.ReactNode;
  nopeStamp: React.ReactNode;
  topX: SharedValue<number>;
  exiting: SharedValue<boolean>;
  flyRef: React.RefObject<((dir: SwipeDir) => void) | null>;
  onCommit: (item: T, dir: SwipeDir) => void;
  onOpen: (item: T) => void;
};

function SwipeCardImpl<T>({
  item, isTop, label, renderCard, likeStamp, nopeStamp, topX, exiting, flyRef, onCommit, onOpen,
}: CardProps<T>) {
  const { width } = useWindowDimensions();
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  // Whether the drag is past the commit threshold, for a single haptic tick.
  const armed = useSharedValue(false);

  const threshold = width * 0.3;
  const offX = width * 1.5;

  // Mirror this card's travel so the card behind can scale up with it. When a
  // new card becomes the top one it starts at 0, which also resets the card
  // that just mounted behind it.
  useAnimatedReaction(
    () => tx.value,
    (x) => { if (isTop) topX.value = x; },
    [isTop],
  );

  const finish = useCallback((dir: SwipeDir) => onCommit(item, dir), [onCommit, item]);

  const fly = useCallback((dir: SwipeDir) => {
    if (exiting.value) return;
    exiting.value = true;
    tapFeedback('light');
    tx.value = withTiming(dir === 'right' ? offX : -offX, { duration: 280, easing: Easing.out(Easing.cubic) }, () => {
      runOnJS(finish)(dir);
    });
  }, [exiting, tx, offX, finish]);

  useEffect(() => {
    if (!isTop) return;
    // This card is the new top one: the previous card has left the stack.
    exiting.value = false;
    flyRef.current = fly;
    return () => {
      if (flyRef.current === fly) flyRef.current = null;
    };
  }, [isTop, fly, exiting, flyRef]);

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .enabled(isTop)
      .onUpdate((e) => {
        if (exiting.value) return;
        tx.value = e.translationX;
        ty.value = e.translationY;
        const past = Math.abs(e.translationX) > threshold;
        if (past !== armed.value) {
          armed.value = past;
          if (past) runOnJS(tapFeedback)('selection');
        }
      })
      .onEnd((e) => {
        if (exiting.value) return;
        armed.value = false;
        const right = (e.translationX > threshold && e.velocityX > -FLING_VELOCITY)
          || (e.velocityX > FLING_VELOCITY && e.translationX > 0);
        const left = (e.translationX < -threshold && e.velocityX < FLING_VELOCITY)
          || (e.velocityX < -FLING_VELOCITY && e.translationX < 0);

        if (right || left) {
          exiting.value = true;
          const dir: SwipeDir = right ? 'right' : 'left';
          const toX = right ? offX : -offX;
          // Keep the flick's momentum: a fast throw leaves fast, a slow drag glides.
          const speed = Math.max(Math.abs(e.velocityX), 1400);
          const duration = Math.min(Math.max((Math.abs(toX - tx.value) / speed) * 1000, 160), 320);
          tx.value = withTiming(toX, { duration, easing: Easing.out(Easing.quad) }, () => {
            runOnJS(finish)(dir);
          });
          ty.value = withTiming(ty.value + e.velocityY * (duration / 1000) * 0.5, { duration });
        } else {
          tx.value = withSpring(0, { ...SNAP_BACK, velocity: e.velocityX });
          ty.value = withSpring(0, { ...SNAP_BACK, velocity: e.velocityY });
        }
      });

    // Opening the profile is a Tap exclusive with the pan: a Pressable under the
    // pan still fired onPress when a swipe lifted off.
    const tap = Gesture.Tap()
      .enabled(isTop)
      .maxDistance(10)
      .runOnJS(true)
      .onEnd((_e, success) => {
        if (success && !exiting.value) onOpen(item);
      });

    return Gesture.Exclusive(pan, tap);
  }, [isTop, threshold, offX, finish, onOpen, item, exiting, tx, ty, armed]);

  const cardStyle = useAnimatedStyle(() => {
    if (isTop) {
      const rotate = interpolate(tx.value, [-width / 2, 0, width / 2], [-15, 0, 15], Extrapolation.CLAMP);
      return {
        transform: [{ translateX: tx.value }, { translateY: ty.value }, { rotate: `${rotate}deg` }],
      };
    }
    // The card behind grows into place as the top card leaves, so there is no
    // jump when it becomes the top card.
    const p = interpolate(Math.abs(topX.value), [0, width * 0.5], [0, 1], Extrapolation.CLAMP);
    return {
      transform: [{ translateY: BACK_OFFSET * (1 - p) }, { scale: BACK_SCALE + (1 - BACK_SCALE) * p }],
    };
  }, [isTop, width]);

  const likeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [20, 100], [0, 1], Extrapolation.CLAMP),
  }));
  const nopeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [-100, -20], [1, 0], Extrapolation.CLAMP),
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.card, { zIndex: isTop ? 10 : 1 }, cardStyle]}>
        <View
          style={styles.fill}
          accessible
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint="Swipe right to like, left to pass"
          onAccessibilityTap={() => isTop && onOpen(item)}
        >
          {renderCard(item)}
          {isTop && (
            <>
              <Animated.View style={[StyleSheet.absoluteFill, likeStyle]} pointerEvents="none">{likeStamp}</Animated.View>
              <Animated.View style={[StyleSheet.absoluteFill, nopeStyle]} pointerEvents="none">{nopeStamp}</Animated.View>
            </>
          )}
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

const SwipeCard = memo(SwipeCardImpl) as typeof SwipeCardImpl;

const styles = StyleSheet.create({
  card: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  fill: { flex: 1 },
});
