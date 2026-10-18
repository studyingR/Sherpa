/** F01-FR11: exactly what was written and what was held; offers the recap (F03) and a referral (F05). */
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Check, CircleDashed, CircleCheck } from 'lucide-react-native';
import { firstName, formatTime, formatShortDate } from '@sherpa/shared';
import { API } from '@/api/hooks';
import { Text } from '@/components/Text';
import { Button, Card, ErrorState, LoadingCards, Row, Screen, SectionLabel } from '@/components/ui';
import { useFeature } from '@/store/session';
import { space, useColors } from '@/theme/tokens';

export default function Saved() {
  const c = useColors();
  const { debriefId } = useLocalSearchParams<{ debriefId: string }>();
  const q = useQuery({ queryKey: ['debrief', debriefId], queryFn: () => API.debrief(debriefId) });
  const draftsOn = useFeature('F03_DRAFTS');
  const referralsOn = useFeature('F05_REFERRALS');
  const d = q.data;
  return (
    <Screen edges={['top', 'bottom']}>
      {q.isLoading ? <LoadingCards /> : null}
      {q.isError ? <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} /> : null}
      {d ? (
        <>
          <View style={{ alignItems: 'flex-start', gap: space.md, marginTop: space.xl }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
              <Check size={30} color={c.onPrimary} strokeWidth={3} />
            </View>
            <Text variant="display" accessibilityRole="header">Saved to Salesforce</Text>
            <Text variant="small" tone="inkMuted">{d.accountName} · confirmed by {d.confirmedBy} at {formatTime(d.confirmedAt)}, {formatShortDate(d.confirmedAt)}</Text>
          </View>

          <SectionLabel count={d.written.length}>Written</SectionLabel>
          <Card style={{ gap: space.md }}>
            {d.written.map((w, i) => (
              <Row key={i} align="flex-start" gap={space.md}>
                <CircleCheck size={20} color={c.primary} />
                <View style={{ flex: 1 }}>
                  <Text variant="small">{w.label}</Text>
                  <Text variant="caption" tone="inkSubtle">{w.system}</Text>
                </View>
              </Row>
            ))}
          </Card>

          {d.held.length ? (
            <>
              <SectionLabel count={d.held.length}>Held</SectionLabel>
              <Card tone="warn" style={{ gap: space.md }}>
                {d.held.map((h, i) => (
                  <Row key={i} align="flex-start" gap={space.md}>
                    <CircleDashed size={20} color={c.warnInk} />
                    <View style={{ flex: 1 }}>
                      <Text variant="small" tone="warnInk">{h.label}</Text>
                      <Text variant="caption" tone="warnInk">{h.reason}</Text>
                    </View>
                  </Row>
                ))}
              </Card>
            </>
          ) : null}

          <View style={{ gap: space.sm, marginTop: space.md }}>
            {draftsOn && d.firstClientContact ? <Button label={`Draft recap email to ${firstName(d.firstClientContact.name)}`} onPress={() => router.push(`/drafts/${d.id}`)} /> : null}
            {referralsOn && d.draft.specialistInterest.length ? <Button tone="secondary" label="Refer to specialist" onPress={() => router.push(`/referral/new?debriefId=${d.id}&accountId=${d.accountId}`)} /> : null}
            <Button tone="ghost" label="Back to today" onPress={() => { router.dismissAll(); router.replace('/today'); }} />
          </View>
        </>
      ) : null}
    </Screen>
  );
}
