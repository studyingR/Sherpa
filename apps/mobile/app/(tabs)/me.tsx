import { useState } from 'react';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, View } from 'react-native';
import { API } from '@/api/hooks';
import { clearCache } from '@/api/client';
import { signOutOfSupabase } from '@/lib/supabase';
import { Text } from '@/components/Text';
import { Badge, Button, Card, ErrorState, ListRow, Screen, SectionLabel } from '@/components/ui';
import { useFeature, useSession } from '@/store/session';
import { space, useColors } from '@/theme/tokens';

export default function Me() {
  const { user, signIn, signOut } = useSession();
  const qc = useQueryClient();
  const c = useColors();
  const coverageOn = useFeature('F10_COVERAGE');
  const profiles = useQuery({ queryKey: ['profiles', user?.id], queryFn: API.profiles, enabled: Boolean(user) });
  const [switching, setSwitching] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  if (!user) return null;
  const isLeader = user.role === 'LEADER';
  const isCompliance = user.role === 'COMPLIANCE';

  async function out() {
    await API.signOut().catch(() => undefined);
    await signOutOfSupabase();
    await clearCache();
    qc.clear();
    await signOut();
  }

  /** Swap to another granted profile: new session, fresh caches, back to Today. */
  async function switchTo(id: string) {
    setSwitching(id);
    setSwitchError(null);
    try {
      const r = await API.switchProfile(id);
      await clearCache();
      qc.clear();
      await signIn(r.token, r.user);
      router.replace('/');
    } catch {
      setSwitchError("Couldn't switch profiles. Try again.");
    } finally {
      setSwitching(null);
    }
  }

  return (
    <Screen>
      <View style={{ gap: 4 }}>
        <Text variant="display" accessibilityRole="header">{user.name}</Text>
        <Text variant="small" tone="inkMuted">{user.email}</Text>
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
          <Badge label={user.role === 'RM' ? 'Relationship manager' : user.role === 'ANALYST' ? 'Analyst' : user.role === 'LEADER' ? 'Market leader' : 'Compliance'} tone="primary" />
          {user.segment ? <Badge label={user.segment === 'COMMERCIAL' ? 'Commercial' : 'Small Business'} /> : null}
        </View>
      </View>

      <SectionLabel>Workspace</SectionLabel>
      <Card padded={false}>
        {coverageOn && !isCompliance ? <ListRow title={isLeader ? 'Team coverage' : 'Coverage plan'} subtitle={isLeader ? 'Coverage by RM, no client details' : 'Who to reach this week'} onPress={() => router.push('/coverage')} /> : null}
        {isCompliance ? <ListRow title="Review queue" subtitle="Complaints, MNPI and sensitive items" onPress={() => router.push('/compliance')} /> : null}
        <ListRow title="Notifications" subtitle="Everything Sherpa sent you" onPress={() => router.push('/notifications')} />
        <ListRow title="Settings" subtitle="Nudges, quiet hours, privacy, voice" onPress={() => router.push('/settings')} last />
      </Card>

      {(profiles.data?.length ?? 0) > 1 ? (
        <>
          <SectionLabel>Switch profile</SectionLabel>
          {switchError ? <ErrorState message={switchError} /> : null}
          <Card padded={false}>
            {profiles.data!.map((p, i, arr) => {
              const current = p.id === user.id;
              return (
                <ListRow
                  key={p.id}
                  title={p.name}
                  subtitle={p.description}
                  last={i === arr.length - 1}
                  accessibilityLabel={current ? `${p.name}, current profile` : `Switch to ${p.name}, ${p.description}`}
                  right={current ? <Badge label="Current" tone="primary" /> : switching === p.id ? <ActivityIndicator color={c.primary} /> : null}
                  onPress={current || switching ? undefined : () => void switchTo(p.id)}
                />
              );
            })}
          </Card>
        </>
      ) : null}

      <Card tone="soft" style={{ gap: space.xs }}>
        <Text variant="smallStrong" tone="successInk">Synthetic data only</Text>
        <Text variant="small" tone="inkMuted">This build uses fictional clients and figures. Do not enter real client information.</Text>
      </Card>

      <Button tone="ghost" label="Sign out" onPress={out} />
    </Screen>
  );
}
