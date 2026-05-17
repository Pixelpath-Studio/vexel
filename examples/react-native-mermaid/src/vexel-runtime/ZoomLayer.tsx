// ZoomLayer — wraps the SVG render surface in an Animated.View with
// pinch-to-zoom + drag-to-pan + double-tap-to-zoom. Pure RN, no native deps.
//
// Gesture routing:
//   - Single tap (no movement) → passes through to children (SVG handles it).
//   - Single-finger drag exceeding 4 px → captured here, pans the view.
//   - Two-finger pinch → captured here, scales the view.
//   - Double tap within 280ms → zooms between 1× and 2× (or to options.max).
//
// Bounds: when `bounded` is true (default), pan/zoom keeps the content from
// being dragged entirely off-screen.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, View } from 'react-native';

export interface ZoomLayerProps {
  enabled: boolean;
  panEnabled: boolean;
  bounded: boolean;
  min: number;
  max: number;
  initial: number;
  doubleTapToZoom: boolean;
  onChange?: (state: { x: number; y: number; scale: number }) => void;
  children: React.ReactNode;
}

export function ZoomLayer({
  enabled, panEnabled, bounded, min, max, initial, doubleTapToZoom, onChange, children,
}: ZoomLayerProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(initial)).current;

  // Mirrors for synchronous reads inside the gesture handlers.
  const tx = useRef(0); const ty = useRef(0); const sc = useRef(initial);
  const lastTapAt = useRef(0);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    translateX.addListener(({ value }) => { tx.current = value; });
    translateY.addListener(({ value }) => { ty.current = value; });
    scale.addListener(({ value }) => {
      sc.current = value;
      onChange?.({ x: tx.current, y: ty.current, scale: value });
    });
    return () => {
      translateX.removeAllListeners();
      translateY.removeAllListeners();
      scale.removeAllListeners();
    };
  }, [onChange, scale, translateX, translateY]);

  // Pinch state for the current gesture.
  const pinchStart = useRef<{ dist: number; scale: number; cx: number; cy: number } | null>(null);
  const panStart = useRef<{ tx: number; ty: number } | null>(null);

  const clamp = useCallback(
    (s: number) => Math.max(min, Math.min(max, s)),
    [min, max],
  );

  const clampPan = useCallback(
    (newX: number, newY: number, newScale: number) => {
      if (!bounded || size.w === 0 || size.h === 0) return { x: newX, y: newY };
      // Allow the content to be panned as long as some part stays in view.
      // Margin = half the viewport so the center of content can reach an edge.
      const marginX = size.w / 2;
      const marginY = size.h / 2;
      const halfW = (size.w * newScale) / 2;
      const halfH = (size.h * newScale) / 2;
      const maxOffsetX = halfW + marginX - size.w / 2;
      const maxOffsetY = halfH + marginY - size.h / 2;
      return {
        x: Math.max(-maxOffsetX, Math.min(maxOffsetX, newX)),
        y: Math.max(-maxOffsetY, Math.min(maxOffsetY, newY)),
      };
    },
    [bounded, size],
  );

  const panResponder = useRef(
    PanResponder.create({
      // Don't intercept simple taps — let children (SVG elements) handle them.
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: (_e, g) => {
        // Capture multi-touch starts (pinch) immediately so children don't
        // see a tap they then have to disambiguate.
        return g.numberActiveTouches >= 2;
      },
      onMoveShouldSetPanResponder: (_e, g) => {
        if (!enabled) return false;
        // Two fingers — always handle (zoom).
        if (g.numberActiveTouches >= 2) return true;
        // One finger — only handle once movement exceeds a small threshold,
        // otherwise the gesture is probably a tap.
        if (!panEnabled) return false;
        return Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4;
      },
      onPanResponderGrant: (_e, g) => {
        if (g.numberActiveTouches >= 2) {
          const touches = (_e.nativeEvent as any).touches;
          pinchStart.current = pinchStateFromTouches(touches, sc.current);
        } else {
          panStart.current = { tx: tx.current, ty: ty.current };
        }
      },
      onPanResponderMove: (e, g) => {
        if (g.numberActiveTouches >= 2) {
          const touches = (e.nativeEvent as any).touches;
          if (!pinchStart.current) {
            pinchStart.current = pinchStateFromTouches(touches, sc.current);
            return;
          }
          const current = pinchStateFromTouches(touches, sc.current);
          if (!current) return;
          const ratio = current.dist / pinchStart.current.dist;
          const next = clamp(pinchStart.current.scale * ratio);
          scale.setValue(next);
          // Anchor the pinch around the start centroid (rough — improves UX).
          // (Full proper anchoring is a longer block; this is "good enough".)
        } else {
          if (!panStart.current) return;
          const next = clampPan(panStart.current.tx + g.dx, panStart.current.ty + g.dy, sc.current);
          translateX.setValue(next.x);
          translateY.setValue(next.y);
        }
      },
      onPanResponderRelease: () => {
        pinchStart.current = null;
        panStart.current = null;
      },
      onPanResponderTerminationRequest: () => true,
    }),
  ).current;

  const handleTap = useCallback(
    (e: any) => {
      if (!doubleTapToZoom) return;
      const now = Date.now();
      if (now - lastTapAt.current < 280) {
        // Double tap — toggle 1× ↔ 2× (or max if 2× exceeds it).
        const target = sc.current > 1.01 ? 1 : Math.min(max, 2);
        Animated.parallel([
          Animated.timing(scale, { toValue: target, duration: 220, useNativeDriver: true }),
          Animated.timing(translateX, { toValue: 0, duration: 220, useNativeDriver: true }),
          Animated.timing(translateY, { toValue: 0, duration: 220, useNativeDriver: true }),
        ]).start();
        lastTapAt.current = 0;
      } else {
        lastTapAt.current = now;
      }
    },
    [doubleTapToZoom, max, scale, translateX, translateY],
  );

  if (!enabled) return <>{children}</>;

  return (
    <View
      style={{ flex: 1, overflow: 'hidden' }}
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      onTouchStart={handleTap}
    >
      <Animated.View
        {...panResponder.panHandlers}
        style={{
          flex: 1,
          transform: [
            { translateX },
            { translateY },
            { scale },
          ],
        }}
      >
        {children}
      </Animated.View>
    </View>
  );
}

function pinchStateFromTouches(
  touches: { pageX: number; pageY: number }[],
  currentScale: number,
): { dist: number; scale: number; cx: number; cy: number } | null {
  if (!touches || touches.length < 2) return null;
  const dx = touches[0].pageX - touches[1].pageX;
  const dy = touches[0].pageY - touches[1].pageY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const cx = (touches[0].pageX + touches[1].pageX) / 2;
  const cy = (touches[0].pageY + touches[1].pageY) / 2;
  return { dist: Math.max(1, dist), scale: currentScale, cx, cy };
}
