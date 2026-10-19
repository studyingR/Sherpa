import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react-native';
import { API } from '@/api/hooks';
import { ApiError } from '@/api/client';
import { Contours } from '@/components/Contours';
import { Text } from '@/components/Text';
import { Card, ErrorState, Screen } from '@/components/ui';
import { GoogleSignInCancelled, signInWithGoogle, signOutOfSupabase, supabase } from '@/lib/supabase';
import { t } from '@/i18n/en';
import { useSession } from '@/store/session';
import { font, radius, size, space, touch, useColors } from '@/theme/tokens';

function GoogleMark() {
  return (
    <Svg width={20} height={20} viewBox="0 0 48 48" accessible={false}>
      <Path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <Path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <Path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <Path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </Svg>
  );
}

/** Google's standard light button: white, thin border, brand mark, "Continue with Google". */
function GoogleButton({ onPress, busy }: { onPress: () => void; busy: boolean }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel="Continue with Google"
      style={({ pressed }) => ({
        minHeight: 52, borderRadius: radius.md, borderWidth: 1, borderColor: '#747775', backgroundColor: pressed ? '#F2F2F2' : '#FFFFFF',
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, opacity: busy ? 0.7 : 1,
      })}
    >
      {busy ? <ActivityIndicator color={c.primary} /> : <GoogleMark />}
      <Text style={{ fontFamily: font.bodyMedium, fontSize: size.lg, color: '#1F1F1F' }}>Continue with Google</Text>
    </Pressable>
  );
}

export default function SignIn() {
  const c = useColors();
  const signIn = useSession((s) => s.signIn);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const config = useQuery({ queryKey: ['auth-config'], queryFn: API.authConfig });
  const showPersonas = config.data?.personas ?? false;
  const showGoogle = Boolean(config.data?.google && supabase);
  const personas = useQuery({ queryKey: ['personas'], queryFn: API.personas, enabled: showPersonas });

  async function choose(id: string) {
    setBusy(id);
    setError(null);
    try {
      const r = await API.signIn(id);
      await signIn(r.token, r.user);
    } catch {
      setError(t.signIn.failed);
    } finally {
      setBusy(null);
    }
  }

  async function google() {
    setBusy('google');
    setError(null);
    try {
      const accessToken = await signInWithGoogle();
      const r = await API.signInSupabase(accessToken);
      await signIn(r.token, r.user);
    } catch (e) {
      if (e instanceof GoogleSignInCancelled) return;
      // Not on the allowlist (or any failure): leave no half-signed-in Supabase session behind.
      await signOutOfSupabase();
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'Google sign-in failed. Try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ height: 210, marginHorizontal: -space.lg, marginTop: -space.lg, overflow: 'hidden', justifyContent: 'flex-end', padding: space.lg }}>
        <View style={{ position: 'absolute', right: -90, top: -70 }}>
          <Contours size={360} color={c.primary} opacity={0.45} seed={2.1} />
        </View>
        <Text variant="display">Sherpa</Text>
        <Text variant="small" tone="inkMuted" style={{ maxWidth: 280 }}>{t.tagline}</Text>
      </View>

      <View style={{ gap: space.xs }}>
        <Text variant="heading">{t.signIn.title}</Text>
        <Text variant="small" tone="inkMuted">{showGoogle ? 'Use your work Google account.' : t.signIn.subtitle}</Text>
      </View>

      {config.isLoading ? <ActivityIndicator color={c.primary} /> : null}
      {config.isError ? <ErrorState message={t.signIn.failed} onRetry={() => void config.refetch()} /> : null}
      {error ? <ErrorState message={error} /> : null}

      {showGoogle ? <GoogleButton onPress={google} busy={busy === 'google'} /> : null}

      {showPersonas ? (
        <>
          {showGoogle ? <Text variant="label" tone="inkSubtle" style={{ marginTop: space.md }}>Test profiles (development only)</Text> : null}
          {personas.isLoading ? <ActivityIndicator color={c.primary} /> : null}
          <Card padded={false}>
            {(personas.data ?? []).map((p, i, arr) => (
              <Pressable
                key={p.id}
                onPress={() => choose(p.id)}
                accessibilityRole="button"
                accessibilityLabel={`Sign in as ${p.name}, ${p.description}`}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, minHeight: touch + 20, backgroundColor: pressed ? c.surfaceMuted : 'transparent', borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: c.ground })}
              >
                <View style={{ width: 40, height: 40, borderRadius: radius.pill, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Text variant="smallStrong" tone="primary">{p.name.split(' ').map((x) => x[0]).join('')}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">{p.name}</Text>
                  <Text variant="small" tone="inkMuted">{p.description}</Text>
                </View>
                {busy === p.id ? <ActivityIndicator color={c.primary} /> : <ChevronRight size={18} color={c.inkSubtle} />}
              </Pressable>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
