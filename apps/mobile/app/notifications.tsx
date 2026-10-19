import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react-native';
import { formatShortDate, formatTime } from '@sherpa/shared';
import { API } from '@/api/hooks';
import { Text } from '@/components/Text';
import { Badge, Card, EmptyState, ErrorState, IconButton, ListRow, LoadingCards, Screen } from '@/components/ui';
import { useColors } from '@/theme/tokens';
import { View } from 'react-native';

/** Notification center: everything Sherpa pushed, including items held back by quiet hours (F04-AC2). */
export default function Notifications() {
  const c = useColors();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notifications'], queryFn: API.notifications });
  return (
    <Screen>
      <IconButton accessibilityLabel="Back" onPress={() => router.back()} tone="muted"><ArrowLeft size={20} color={c.ink} /></IconButton>
      <Text variant="title" accessibilityRole="header">Notifications</Text>
      {q.isLoading ? <LoadingCards /> : null}
      {q.isError ? <ErrorState message={(q.error as Error).message} /> : null}
      {q.data && !q.data.length ? <EmptyState title="Nothing yet" body="Brief-ready alerts, your morning agenda and nudges appear here." /> : null}
      {q.data?.length ? (
        <Card padded={false}>
          {q.data.map((n, i) => (
            <ListRow
              key={n.id}
              title={n.title}
              subtitle={`${n.body} · ${formatShortDate(n.createdAt)} ${formatTime(n.createdAt)}`}
              meta={n.suppressedReason ? <View style={{ marginTop: 4 }}><Badge label={`Not pushed: ${n.suppressedReason}`} /></View> : undefined}
              accent={n.readAt ? undefined : 'warn'}
              onPress={async () => {
                await API.markRead(n.id).catch(() => undefined);
                qc.invalidateQueries({ queryKey: ['notifications'] });
                if (n.deepLink?.startsWith('sherpa://')) router.push(n.deepLink.replace('sherpa://', '/') as never);
              }}
              last={i === q.data.length - 1}
            />
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
