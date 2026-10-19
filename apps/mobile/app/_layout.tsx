import { useEffect } from 'react';
import { View, useColorScheme } from 'react-native';
import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { Newsreader_500Medium_Italic, Newsreader_600SemiBold } from '@expo-google-fonts/newsreader';
import { Figtree_400Regular, Figtree_500Medium, Figtree_600SemiBold, Figtree_700Bold } from '@expo-google-fonts/figtree';
import { API } from '@/api/hooks';
import { ApiError } from '@/api/client';
import { useSession } from '@/store/session';
import { useColors } from '@/theme/tokens';
import { registerForPush } from '@/lib/push';
import { ToastHost } from '@/components/Toast';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: (n, err) => !(err instanceof ApiError && err.status < 500 && err.status > 0) && n < 2 },
  },
});

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

function useAuthGate() {
  const { ready, token } = useSession();
  const segments = useSegments();
  useEffect(() => {
    if (!ready) return;
    const inAuth = segments[0] === '(auth)';
    if (!token && !inAuth) router.replace('/sign-in');
    if (token && inAuth) router.replace('/today');
  }, [ready, token, segments]);
}

/** Deep links from pushes: sherpa://brief/:meetingId, sherpa://debrief/new?meetingId=, sherpa://alerts/:id */
function usePushRouting() {
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const url = (r.notification.request.content.data as { url?: string } | undefined)?.url;
      if (url?.startsWith('sherpa://')) router.push(url.replace('sherpa://', '/') as never);
    });
    return () => sub.remove();
  }, []);
}

export default function RootLayout() {
  const c = useColors();
  const scheme = useColorScheme();
  const [loaded] = useFonts({ Newsreader_600SemiBold, Newsreader_500Medium_Italic, Figtree_400Regular, Figtree_500Medium, Figtree_600SemiBold, Figtree_700Bold });
  const { hydrate, token, setFeatures } = useSession();

  useEffect(() => {
    hydrate();
  }, [hydrate]);
  useEffect(() => {
    if (!token) return;
    API.features().then(setFeatures).catch(() => undefined);
    registerForPush().catch(() => undefined);
  }, [token, setFeatures]);
  useAuthGate();
  usePushRouting();

  if (!loaded) return <View style={{ flex: 1, backgroundColor: c.ground }} />;
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.ground } }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="(auth)/sign-in" />
          <Stack.Screen name="debrief/[id]" options={{ animation: 'slide_from_bottom', gestureEnabled: false, contentStyle: { backgroundColor: c.callBg } }} />
          <Stack.Screen name="voice" options={{ animation: 'slide_from_bottom', gestureEnabled: false, contentStyle: { backgroundColor: c.callBg } }} />
          <Stack.Screen name="live/[meetingId]" options={{ animation: 'slide_from_bottom', gestureEnabled: false, contentStyle: { backgroundColor: c.callBg } }} />
          <Stack.Screen name="ask" options={{ presentation: 'modal' }} />
          <Stack.Screen name="intent/[id]" options={{ presentation: 'formSheet', sheetAllowedDetents: [0.6, 0.95], sheetGrabberVisible: true }} />
        </Stack>
        <ToastHost />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
