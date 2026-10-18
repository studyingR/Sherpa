/** F06 alerts: grouped by severity; acknowledge, snooze (7/30), create task (intent), dismiss with reason. */
import { useState } from 'react';
import { RefreshControl, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Alert, WriteIntent } from '@sherpa/shared';
import { API } from '@/api/hooks';
import { ApiError } from '@/api/client';
import { Sheet } from '@/components/Sheet';
import { Text } from '@/components/Text';
import { toast } from '@/components/Toast';
import { Badge, Button, Card, Chip, EmptyState, ErrorState, FactGrid, LoadingCards, Row, Screen, SectionLabel, inputStyle } from '@/components/ui';
import { space, useColors } from '@/theme/tokens';

const SEVERITY = { CRITICAL: { label: 'Critical', tone: 'danger' as const }, WARN: { label: 'Warning', tone: 'warn' as const }, INFO: { label: 'Info', tone: 'neutral' as const } };

function AlertCard({ a, onSnooze, onDismiss }: { a: Alert; onSnooze: (a: Alert) => void; onDismiss: (a: Alert) => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  async function act(action: 'ACK' | 'CREATE_TASK') {
    setBusy(action);
    try {
      const r = await API.alertAction(a.id, { action });
      if (action === 'CREATE_TASK') router.push(`/intent/${(r as WriteIntent).id}`);
      else toast('Acknowledged');
      qc.invalidateQueries({ queryKey: ['alerts'] });
      qc.invalidateQueries({ queryKey: ['today'] });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }
  return (
    <Card style={{ gap: space.md }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text variant="label" tone="inkSubtle">{a.accountName}</Text>
        <Row gap={6}>
          {a.status === 'ACKNOWLEDGED' ? <Badge label="Acknowledged" /> : null}
          {a.status === 'SNOOZED' && a.snoozeUntil ? <Badge label={`Snoozed to ${new Date(a.snoozeUntil).toLocaleDateString()}`} /> : null}
          <Badge {...SEVERITY[a.severity]} />
        </Row>
      </Row>
      <Text variant="bodyStrong">{a.title}</Text>
      <FactGrid facts={a.evidence} />
      <Text variant="small" tone="inkMuted">{a.suggestedAction}</Text>
      <Row style={{ flexWrap: 'wrap' }} gap={space.sm}>
        {a.status === 'OPEN' ? <Button small tone="secondary" label="Acknowledge" loading={busy === 'ACK'} onPress={() => act('ACK')} /> : null}
        {a.status !== 'SNOOZED' ? <Button small tone="secondary" label="Snooze" onPress={() => onSnooze(a)} /> : null}
        <Button small tone="secondary" label="Create task" loading={busy === 'CREATE_TASK'} onPress={() => act('CREATE_TASK')} />
        <Button small tone="ghost" label="Dismiss" onPress={() => onDismiss(a)} />
      </Row>
    </Card>
  );
}

export default function Alerts() {
  const c = useColors();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'open' | 'snoozed' | 'all'>('open');
  const q = useQuery({ queryKey: ['alerts', filter], queryFn: () => API.alerts(filter) });
  const [snooze, setSnooze] = useState<Alert | null>(null);
  const [dismiss, setDismiss] = useState<Alert | null>(null);
  const [reason, setReason] = useState('');

  async function doSnooze(days: 7 | 30) {
    if (!snooze) return;
    await API.alertAction(snooze.id, { action: 'SNOOZE', snoozeDays: days });
    setSnooze(null);
    toast(`Snoozed for ${days} days`);
    qc.invalidateQueries({ queryKey: ['alerts'] });
    qc.invalidateQueries({ queryKey: ['today'] });
  }
  async function doDismiss() {
    if (!dismiss) return;
    await API.alertAction(dismiss.id, { action: 'DISMISS', reason: reason || undefined });
    setDismiss(null);
    setReason('');
    toast('Dismissed');
    qc.invalidateQueries({ queryKey: ['alerts'] });
    qc.invalidateQueries({ queryKey: ['today'] });
  }

  const groups = (['CRITICAL', 'WARN', 'INFO'] as const).map((s) => ({ s, items: (q.data ?? []).filter((a) => a.severity === s) })).filter((g) => g.items.length);

  return (
    <Screen refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={c.primary} />}>
      <Text variant="display" accessibilityRole="header">Alerts</Text>
      <Row gap={space.sm}>
        <Chip label="Open" selected={filter === 'open'} onPress={() => setFilter('open')} />
        <Chip label="Snoozed" selected={filter === 'snoozed'} onPress={() => setFilter('snoozed')} />
        <Chip label="All" selected={filter === 'all'} onPress={() => setFilter('all')} />
      </Row>
      {q.isLoading ? <LoadingCards /> : null}
      {q.isError ? <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} /> : null}
      {q.data && !q.data.length ? <EmptyState title={filter === 'snoozed' ? 'Nothing snoozed' : 'No open alerts'} body="Sherpa checks your portfolio every night." /> : null}
      {groups.map((g) => (
        <View key={g.s} style={{ gap: space.md }}>
          <SectionLabel count={g.items.length}>{SEVERITY[g.s].label}</SectionLabel>
          {g.items.map((a) => <AlertCard key={a.id} a={a} onSnooze={setSnooze} onDismiss={setDismiss} />)}
        </View>
      ))}

      <Sheet visible={Boolean(snooze)} onClose={() => setSnooze(null)} title="Snooze alert">
        <Text variant="small" tone="inkMuted">It comes back automatically when the snooze ends.</Text>
        <Row gap={space.sm}>
          <Chip label="7 days" selected={false} onPress={() => doSnooze(7)} />
          <Chip label="30 days" selected={false} onPress={() => doSnooze(30)} />
        </Row>
      </Sheet>
      <Sheet visible={Boolean(dismiss)} onClose={() => setDismiss(null)} title="Dismiss alert">
        <TextInput value={reason} onChangeText={setReason} placeholder="Reason (optional)" placeholderTextColor={c.inkSubtle} accessibilityLabel="Reason for dismissing" style={inputStyle(c)} />
        <Button label="Dismiss" onPress={doDismiss} />
      </Sheet>
    </Screen>
  );
}
