/** F12 pricing guidance (gated): screen only, no share/copy, disclaimer, approval state. Every view is audited. */
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react-native';
import { API } from '@/api/hooks';
import { Text } from '@/components/Text';
import { Card, ErrorState, FlagBanner, IconButton, LoadingCards, Row, Screen } from '@/components/ui';
import { useFeature } from '@/store/session';
import { radius, space, useColors } from '@/theme/tokens';

export default function Pricing() {
  const c = useColors();
  const enabled = useFeature('F12_PRICING_GUIDANCE');
  const { dealId } = useLocalSearchParams<{ dealId: string }>();
  const q = useQuery({ queryKey: ['pricing', dealId], queryFn: () => API.pricing(dealId), enabled });
  if (!enabled) return null;
  const g = q.data;
  const lo = 100;
  const hi = 400;
  return (
    <Screen>
      <IconButton accessibilityLabel="Back" onPress={() => router.back()} tone="muted"><ArrowLeft size={20} color={c.ink} /></IconButton>
      <Text variant="title" accessibilityRole="header">Pricing guidance</Text>
      {q.isLoading ? <LoadingCards count={2} /> : null}
      {q.isError ? <ErrorState message={(q.error as Error).message} /> : null}
      {g ? (
        <>
          <FlagBanner tone="warn" title="Internal only" body={g.disclaimer} />
          {g.requiresApproval ? <FlagBanner title="Requires pricing approval" body="This is outside your pricing authority. Nothing is routed automatically." /> : null}
          <Card style={{ gap: space.md }}>
            <Text variant="label" tone="inkSubtle">Indicative spread</Text>
            <Text variant="display">{g.spreadBpsRange[0]}–{g.spreadBpsRange[1]} bps</Text>
            <View style={{ height: 12, borderRadius: radius.pill, backgroundColor: c.surfaceMuted }} accessibilityLabel={`Range ${g.spreadBpsRange[0]} to ${g.spreadBpsRange[1]} basis points`}>
              <View style={{ position: 'absolute', left: `${((g.spreadBpsRange[0] - lo) / (hi - lo)) * 100}%`, width: `${((g.spreadBpsRange[1] - g.spreadBpsRange[0]) / (hi - lo)) * 100}%`, height: '100%', borderRadius: radius.pill, backgroundColor: c.primary }} />
            </View>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text variant="caption" tone="inkSubtle">{lo} bps</Text>
              <Text variant="caption" tone="inkSubtle">Target RAROC {g.targetRaroc}%</Text>
              <Text variant="caption" tone="inkSubtle">{hi} bps</Text>
            </Row>
            {g.feeRange ? <Text variant="small" tone="inkMuted">Fees {g.feeRange[0]}%–{g.feeRange[1]}%</Text> : null}
          </Card>
          <Card style={{ gap: space.sm }}>
            <Text variant="label" tone="inkSubtle">Drivers</Text>
            {g.drivers.map((d) => (
              <Row key={d.label} style={{ justifyContent: 'space-between' }}>
                <Text variant="small" style={{ flex: 1 }}>{d.label}</Text>
                <Text variant="smallStrong">{d.impactBps > 0 ? '+' : ''}{d.impactBps} bps</Text>
              </Row>
            ))}
          </Card>
          <Text variant="caption" tone="inkSubtle">Source: PrecisionLender. Not spoken aloud and never included in client emails.</Text>
        </>
      ) : null}
    </Screen>
  );
}
