/** Confirm sheet for any WriteIntent: shows exactly what will be written; approvals are explicit (rule 1). */
import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { API, useOnline } from '@/api/hooks';
import { ApiError } from '@/api/client';
import { Text } from '@/components/Text';
import { toast } from '@/components/Toast';
import { ApprovalToggle, Button, Card, ErrorState, LoadingCards, Screen } from '@/components/ui';
import { t } from '@/i18n/en';
import { space, useColors } from '@/theme/tokens';

export default function IntentConfirm() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const online = useOnline();
  const q = useQuery({ queryKey: ['intent', id], queryFn: () => API.intent(id) });
  const [approvals, setApprovals] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const r = await API.confirmIntent({ intentId: id, channel: 'tap', approvals });
      await Promise.all(['today', 'tasks', 'alerts', 'coverage', 'account'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      toast(r.written.length ? r.written.map((w) => w.label).join(' · ') : r.held.map((h) => `${h.label}: ${h.reason}`).join(' · '));
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That did not save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen edges={['bottom']}>
      {q.isLoading ? <LoadingCards count={1} /> : null}
      {q.isError ? <ErrorState message={(q.error as Error).message} /> : null}
      {q.data ? (
        <>
          <Text variant="heading" accessibilityRole="header">{q.data.summary}</Text>
          <Card style={{ gap: space.sm }}>
            <Text variant="label" tone="inkSubtle">What will be written</Text>
            {q.data.planned.map((p, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: space.sm }}>
                <Text variant="small" tone="inkSubtle" style={{ width: 92 }}>{p.system}</Text>
                <Text variant="small" style={{ flex: 1 }}>{p.label}</Text>
              </View>
            ))}
          </Card>
          {q.data.requiresApproval.map((a) => (
            <ApprovalToggle key={a.id} label={a.label} approved={Boolean(approvals[a.id])} onChange={(v) => setApprovals((s) => ({ ...s, [a.id]: v }))} />
          ))}
          {error ? <ErrorState message={error} /> : null}
          {!online ? <ErrorState message={t.states.writesOffline} /> : null}
          <Button label="Confirm" loading={busy} disabled={!online} onPress={confirm} />
          <Button tone="ghost" label="Cancel" onPress={() => router.back()} />
          <Text variant="caption" tone="inkSubtle" align="center" style={{ color: c.inkSubtle }}>{t.debrief.nothingWritten}</Text>
        </>
      ) : null}
    </Screen>
  );
}
