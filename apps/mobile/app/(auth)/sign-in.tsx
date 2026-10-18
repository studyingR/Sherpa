import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react-native';
import { API } from '@/api/hooks';
import { Contours } from '@/components/Contours';
import { Text } from '@/components/Text';
import { Card, ErrorState, Screen } from '@/components/ui';
import { t } from '@/i18n/en';
import { useSession } from '@/store/session';
import { radius, space, touch, useColors } from '@/theme/tokens';

export default function SignIn() {
  const c = useColors();
  const signIn = useSession((s) => s.signIn);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const personas = useQuery({ queryKey: ['personas'], queryFn: API.personas });

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
        <Text variant="small" tone="inkMuted">{t.signIn.subtitle}</Text>
      </View>

      {personas.isLoading ? <ActivityIndicator color={c.primary} /> : null}
      {personas.isError ? <ErrorState message={t.signIn.failed} onRetry={() => personas.refetch()} /> : null}
      {error ? <ErrorState message={error} /> : null}

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
    </Screen>
  );
}
