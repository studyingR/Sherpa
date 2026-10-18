/** Compliance review queue (docs/08 §3): complaint, MNPI and kept-sensitive items with minimal excerpts. */
import { useState } from 'react';
import { TextInput } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react-native';
import { formatShortDate, type ComplianceItem } from '@sherpa/shared';
import { API } from '@/api/hooks';
import { Sheet } from '@/components/Sheet';
import { Text } from '@/components/Text';
import { toast } from '@/components/Toast';
import { Badge, Button, Card, EmptyState, ErrorState, IconButton, LoadingCards, Row, Screen, inputStyle } from '@/components/ui';
import { space, useColors } from '@/theme/tokens';

const TYPE = { COMPLAINT: { label: 'Complaint', tone: 'danger' as const }, MNPI: { label: 'MNPI', tone: 'warn' as const }, SENSITIVE: { label: 'Sensitive', tone: 'neutral' as const } };

export default function Compliance() {
  const c = useColors();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['compliance'], queryFn: API.complianceQueue });
  const [item, setItem] = useState<ComplianceItem | null>(null);
  const [note, setNote] = useState('');
  return (
    <Screen>
      <IconButton accessibilityLabel="Back" onPress={() => router.back()} tone="muted"><ArrowLeft size={20} color={c.ink} /></IconButton>
      <Text variant="title" accessibilityRole="header">Review queue</Text>
      {q.isLoading ? <LoadingCards /> : null}
      {q.isError ? <ErrorState message={(q.error as Error).message} /> : null}
      {q.data && !q.data.length ? <EmptyState title="Queue is clear" body="Complaints, MNPI and kept sensitive details appear here when RMs save debriefs." /> : null}
      {q.data?.map((i) => (
        <Card key={i.id} style={{ gap: space.sm, opacity: i.status === 'RESOLVED' ? 0.6 : 1 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Badge {...TYPE[i.type]} />
            <Text variant="caption" tone="inkSubtle">{formatShortDate(i.createdAt)} · {i.rmName}</Text>
          </Row>
          <Text variant="bodyStrong">{i.accountName}</Text>
          <Text variant="small" tone="inkMuted">"{i.excerpt}"</Text>
          {i.caseId ? <Text variant="caption" tone="inkSubtle">Case {i.caseId}</Text> : null}
          {i.status === 'OPEN' ? <Button small tone="secondary" label="Resolve" onPress={() => setItem(i)} /> : <Text variant="caption" tone="successInk">Resolved: {i.resolverNote}</Text>}
        </Card>
      ))}
      <Sheet visible={Boolean(item)} onClose={() => setItem(null)} title="Resolve item">
        <TextInput value={note} onChangeText={setNote} placeholder="Resolution note" placeholderTextColor={c.inkSubtle} accessibilityLabel="Resolution note" multiline style={[inputStyle(c), { minHeight: 90 }]} />
        <Button label="Resolve" disabled={!note.trim()} onPress={async () => { await API.resolveCompliance(item!.id, note); setItem(null); setNote(''); toast('Resolved'); qc.invalidateQueries({ queryKey: ['compliance'] }); }} />
      </Sheet>
    </Screen>
  );
}
