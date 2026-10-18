import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';
import { radius, space, useColors } from '@/theme/tokens';
import { Text } from './Text';

const useToastStore = create<{ message: string | null; show(m: string): void; clear(): void }>((set) => ({
  message: null,
  show: (message) => set({ message }),
  clear: () => set({ message: null }),
}));

/** Success toasts state what was written ("3 tasks created"). */
export function toast(message: string) {
  useToastStore.getState().show(message);
  AccessibilityInfo.announceForAccessibility(message);
}

export function ToastHost() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { message, clear } = useToastStore();
  const y = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!message) return;
    Animated.timing(y, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    const t = setTimeout(() => Animated.timing(y, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => clear()), 2800);
    return () => clearTimeout(t);
  }, [message, y, clear]);
  if (!message) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: space.lg, right: space.lg, bottom: insets.bottom + 92 }}>
      <Animated.View style={{ opacity: y, transform: [{ translateY: y.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }], backgroundColor: c.callBg, borderRadius: radius.md, padding: space.md + 2 }}>
        <Text variant="smallStrong" tone="callInk">{message}</Text>
      </Animated.View>
    </View>
  );
}
