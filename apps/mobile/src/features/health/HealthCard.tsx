/** F13 (gated): score ring, top 3 drivers with sources, 12-week trend, disclaimer. */
import { View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import type { HealthScore } from '@sherpa/shared';
import { Text } from '@/components/Text';
import { Card, Row, SourceTag } from '@/components/ui';
import { t } from '@/i18n/en';
import { space, useColors } from '@/theme/tokens';

export function HealthCard({ score }: { score: HealthScore }) {
  const c = useColors();
  const band = score.band === 'HEALTHY' ? { label: 'Healthy', color: c.primary } : score.band === 'WATCH' ? { label: 'Watch', color: c.warnInk } : { label: 'At risk', color: c.danger };
  const R = 30;
  const C = 2 * Math.PI * R;
  const hist = score.history ?? [];
  const pts = hist.map((h, i) => `${(i / Math.max(1, hist.length - 1)) * 120},${40 - (h.score / 100) * 40}`).join(' ');
  return (
    <Card style={{ gap: space.md }} >
      <Row gap={space.lg}>
        <View accessibilityLabel={`Health score ${score.score}, ${band.label}`}>
          <Svg width={76} height={76}>
            <Circle cx={38} cy={38} r={R} stroke={c.surfaceMuted} strokeWidth={7} fill="none" />
            <Circle cx={38} cy={38} r={R} stroke={band.color} strokeWidth={7} fill="none" strokeDasharray={`${(score.score / 100) * C} ${C}`} strokeLinecap="round" rotation={-90} origin="38,38" />
          </Svg>
          <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
            <Text variant="heading">{score.score}</Text>
          </View>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" tone="inkSubtle">Relationship health</Text>
          <Text variant="bodyStrong" style={{ color: band.color }}>{band.label}</Text>
          {hist.length > 1 ? (
            <Svg width={120} height={42} accessibilityLabel="12-week trend">
              <Polyline points={pts} fill="none" stroke={band.color} strokeWidth={2} />
            </Svg>
          ) : null}
        </View>
      </Row>
      {score.drivers.map((dv) => (
        <View key={dv.factor} style={{ gap: 2 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="smallStrong" style={{ flex: 1 }}>{dv.factor}</Text>
            <Text variant="smallStrong" tone={dv.impact < 0 ? 'dangerInk' : 'primary'}>{dv.impact > 0 ? `+${dv.impact}` : dv.impact}</Text>
          </Row>
          <Text variant="caption" tone="inkMuted">{dv.fact.label}: {dv.fact.display}</Text>
          <SourceTag source={dv.fact.source} asOf={dv.fact.asOf} />
        </View>
      ))}
      <Text variant="caption" tone="inkSubtle">{t.disclaimers.health}</Text>
    </Card>
  );
}
