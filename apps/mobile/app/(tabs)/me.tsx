import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { View } from 'react-native';
import { API } from '@/api/hooks';
import { clearCache } from '@/api/client';
import { Text } from '@/components/Text';
import { Badge, Button, Card, ListRow, Screen, SectionLabel } from '@/components/ui';
import { useFeature, useSession } from '@/store/session';
import { space } from '@/theme/tokens';

export default function Me() {
  const { user, signOut } = useSession();
  const qc = useQueryClient();
  const coverageOn = useFeature('F10_COVERAGE');
  if (!user) return null;
  const isLeader = user.role === 'LEADER';
  const isCompliance = user.role === 'COMPLIANCE';

  async function out() {
    await API.signOut().catch(() => undefined);
    await clearCache();
    qc.clear();
    await signOut();
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

      <Card tone="soft" style={{ gap: space.xs }}>
        <Text variant="smallStrong" tone="successInk">Synthetic data only</Text>
        <Text variant="small" tone="inkMuted">This build uses fictional clients and figures. Do not enter real client information.</Text>
      </Card>

      <Button tone="ghost" label="Sign out" onPress={out} />
    </Screen>
  );
}
