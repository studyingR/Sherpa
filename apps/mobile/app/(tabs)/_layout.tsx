import { Pressable, View } from 'react-native';
import { Tabs, router } from 'expo-router';
import type { ComponentProps } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bell, Briefcase, Mic, Sun, UserRound } from 'lucide-react-native';
import { Text } from '@/components/Text';
import { t } from '@/i18n/en';
import { font, space, touch, useColors } from '@/theme/tokens';
import { useSession } from '@/store/session';

type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const ICONS = { today: Sun, accounts: Briefcase, alerts: Bell, me: UserRound } as const;
const LABELS: Record<string, string> = { today: t.tabs.today, accounts: t.tabs.accounts, alerts: t.tabs.alerts, me: t.tabs.me };

/** Today · Accounts · Ask (large center mic) · Alerts · Me. Ask: tap = voice, long-press = chat. */
function TabBar({ state }: BottomTabBarProps) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const alertsOn = useSession((s) => s.features?.F06_WATCHLIST !== false);
  const routes = state.routes.filter((r) => r.name in ICONS && (r.name !== 'alerts' || alertsOn));
  const left = routes.slice(0, 2);
  const right = routes.slice(2);
  const item = (r: (typeof routes)[number]) => {
    const focused = state.routes[state.index]?.key === r.key;
    const Icon = ICONS[r.name as keyof typeof ICONS];
    return (
      <Pressable
        key={r.key}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={LABELS[r.name]}
        onPress={() => router.navigate(`/${r.name}` as never)}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: touch + 8, gap: 3 }}
      >
        <Icon size={22} color={focused ? c.primary : c.inkSubtle} strokeWidth={focused ? 2.3 : 1.8} />
        <Text variant="caption" style={{ color: focused ? c.primary : c.inkSubtle, fontFamily: focused ? font.bodySemibold : font.bodyMedium }}>{LABELS[r.name]}</Text>
      </Pressable>
    );
  };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderTopColor: c.border, borderTopWidth: 1, paddingBottom: insets.bottom, paddingTop: 6, paddingHorizontal: space.sm }}>
      {left.map(item)}
      <View style={{ width: 84, alignItems: 'center' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.tabs.ask}
          accessibilityHint="Tap to talk to Sherpa. Press and hold to type."
          onPress={() => router.push('/voice?mode=ASK')}
          onLongPress={() => router.push('/ask')}
          style={({ pressed }) => ({ width: 64, height: 64, borderRadius: 32, marginTop: -26, backgroundColor: pressed ? c.primaryPressed : c.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: c.ground })}
        >
          <Mic size={26} color={c.onPrimary} strokeWidth={2.2} />
        </Pressable>
      </View>
      {right.map(item)}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs tabBar={(p) => <TabBar {...p} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="today" />
      <Tabs.Screen name="accounts" />
      <Tabs.Screen name="alerts" />
      <Tabs.Screen name="me" />
    </Tabs>
  );
}
