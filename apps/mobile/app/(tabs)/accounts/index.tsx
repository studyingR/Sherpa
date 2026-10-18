import { useState } from 'react';
import { RefreshControl, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react-native';
import { API } from '@/api/hooks';
import { Text } from '@/components/Text';
import { Badge, Card, Chip, EmptyState, ErrorState, ListRow, LoadingCards, Row, Screen } from '@/components/ui';
import { radius, space, useColors, font, size } from '@/theme/tokens';

export default function Accounts() {
  const c = useColors();
  const [query, setQuery] = useState('');
  const [segment, setSegment] = useState<string | undefined>();
  const q = useQuery({ queryKey: ['accounts', query, segment], queryFn: () => API.accounts(query || undefined, segment) });

  return (
    <Screen refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={c.primary} />}>
      <Text variant="display" accessibilityRole="header">Accounts</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingHorizontal: space.md }}>
        <Search size={18} color={c.inkSubtle} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search your book"
          placeholderTextColor={c.inkSubtle}
          accessibilityLabel="Search accounts"
          style={{ flex: 1, minHeight: 48, fontFamily: font.body, fontSize: size.lg, color: c.ink }}
          returnKeyType="search"
          autoCorrect={false}
        />
      </View>
      <Row gap={space.sm}>
        <Chip label="All" selected={!segment} onPress={() => setSegment(undefined)} />
        <Chip label="Commercial" selected={segment === 'COMMERCIAL'} onPress={() => setSegment('COMMERCIAL')} />
        <Chip label="Small Business" selected={segment === 'SMALL_BUSINESS'} onPress={() => setSegment('SMALL_BUSINESS')} />
      </Row>
      {q.isLoading ? <LoadingCards /> : null}
      {q.isError ? <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} /> : null}
      {q.data && !q.data.length ? <EmptyState title="No accounts match" body="Try a different name or city." /> : null}
      {q.data?.length ? (
        <Card padded={false}>
          {q.data.map((a, i) => (
            <ListRow
              key={a.id}
              title={a.name}
              subtitle={`${a.city}, ${a.state} · ${a.lastTouchDays === null ? 'No recent touch' : `Last touch ${a.lastTouchDays} days ago`}`}
              meta={a.openAlerts || a.documentsDue ? (
                <Row style={{ marginTop: 6 }}>
                  {a.openAlerts ? <Badge label={`${a.openAlerts} alert${a.openAlerts > 1 ? 's' : ''}`} tone="warn" /> : null}
                  {a.documentsDue ? <Badge label={`${a.documentsDue} doc${a.documentsDue > 1 ? 's' : ''} overdue`} tone="danger" /> : null}
                </Row>
              ) : undefined}
              onPress={() => router.push(`/accounts/${a.id}`)}
              last={i === q.data.length - 1}
            />
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
