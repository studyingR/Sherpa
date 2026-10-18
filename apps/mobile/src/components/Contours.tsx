/**
 * Topographic contour rings — Sherpa's one signature visual. Organic closed paths around a center,
 * like a summit on a survey map. On the call screen they respond to state: they breathe with the RM's
 * voice level when listening, drift slowly while thinking, and pulse outward while Sherpa speaks.
 */
import { useEffect, useMemo, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

function ringPath(cx: number, cy: number, r: number, seed: number, wobble: number): string {
  const pts: [number, number][] = [];
  const n = 72;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const noise =
      Math.sin(a * 3 + seed) * 0.5 + Math.sin(a * 5 + seed * 1.7) * 0.3 + Math.sin(a * 2 - seed * 0.6) * 0.45;
    const rr = r * (1 + noise * wobble);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.86]);
  }
  // Smooth closed curve through the points (Catmull-Rom → cubic Bézier).
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${c1[0].toFixed(1)} ${c1[1].toFixed(1)}, ${c2[0].toFixed(1)} ${c2[1].toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return `${d} Z`;
}

export type ContourMode = 'idle' | 'listening' | 'thinking' | 'speaking';

export function Contours({
  size,
  rings = 9,
  color,
  mode = 'idle',
  level,
  opacity = 0.5,
  seed = 1.3,
}: {
  size: number;
  rings?: number;
  color: string;
  mode?: ContourMode;
  /** 0..1 voice level while listening. */
  level?: Animated.Value;
  opacity?: number;
  seed?: number;
}) {
  const paths = useMemo(() => {
    const c = size / 2;
    return Array.from({ length: rings }, (_, i) => ringPath(c, c, (size / 2) * (0.16 + (i / rings) * 0.8), seed + i * 0.35, 0.05 + i * 0.006));
  }, [size, rings, seed]);

  const rotate = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const reduceMotion = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((v) => (reduceMotion.current = v));
  }, []);

  useEffect(() => {
    rotate.stopAnimation();
    pulse.stopAnimation();
    if (reduceMotion.current) return;
    let anim: Animated.CompositeAnimation | null = null;
    if (mode === 'thinking') {
      anim = Animated.loop(Animated.timing(rotate, { toValue: 1, duration: 9000, easing: Easing.linear, useNativeDriver: true }));
    } else if (mode === 'speaking') {
      anim = Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 650, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 650, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]));
    }
    anim?.start();
    return () => anim?.stop();
  }, [mode, rotate, pulse]);

  const spin = rotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const breathe = level ? level.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) : 1;
  const speak = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });

  return (
    <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: size, height: size }}>
      <Animated.View style={{ width: size, height: size, transform: [{ rotate: spin }, { scale: mode === 'listening' ? breathe : mode === 'speaking' ? speak : 1 }] }}>
        <Svg width={size} height={size}>
          {paths.map((d, i) => (
            <Path key={i} d={d} fill="none" stroke={color} strokeOpacity={opacity * (1 - i / (rings * 1.25))} strokeWidth={i === 0 ? 1.6 : 1} />
          ))}
        </Svg>
      </Animated.View>
    </View>
  );
}
