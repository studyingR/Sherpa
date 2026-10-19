/** F08: outstanding items → select → draft one consolidated request (+ reminders); mark received. */
import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react-native';
import { DOCUMENT_TYPE_LABEL, SOURCE_LABEL, formatShortDate, type FollowUpDraft } from '@sherpa/shared';
import { API } from '@/api/hooks';
import { ApiError } from '@/api/client';
import { Text } from '@/components/Text';
import { toast } from '@/components/Toast';
import { Button, Card, CheckRow, Chip, EmptyState, ErrorState, IconButton, LoadingCards, Row, Screen, SectionLabel } from '@/components/ui';
import { DraftEditor } from '@/features/drafts/DraftEditor';
import { space, useColors } from '@/theme/tokens';

export default function Documents() {
  const c = useColors();
  const qc = useQueryClient();
  const { accountId } = useLocalSearchParams<{ accountId: string }>();
  const q = useQuery({ queryKey: ['documents', accountId], queryFn: () => API.documents(accountId) });
  const [selected, setSelected] = useState<string[] | null>(null);
  const [reminders, setReminders] = useState<number[]>([7, 14]);
  const [draft, setDraft] = useState<FollowUpDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const items = q.data ?? [];
  const sel = selected ?? items.filter((i) => i.daysOverdue > 0).map((i) => i.id);

  async function draftRequest() {
    setBusy(true);
    setError(null);
    try {
      setDraft(await API.documentRequest(accountId, sel, reminders));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The request could not be drafted.');
    } finally {
      setBusy(false);
    }
  }
  async function mark(id: string) {
    await API.markDocument(id, 'RECEIVED');
    toast('Marked received');
    qc.invalidateQueries({ queryKey: ['documents'] });
    qc.invalidateQueries({ queryKey: ['today'] });
  }

  return (
    <Screen>
      <Row gap={space.md}>
        <IconButton accessibilityLabel="Back" onPress={() => router.back()} tone="muted">
          <ArrowLeft size={20} color={c.ink} />
        </IconButton>
        <View>
          <Text variant="title" accessibilityRole="header">Documents</Text>
          <Text variant="small" tone="inkMuted">{items[0]?.accountName ?? ''}</Text>
        </View>
      </Row>
      {q.isLoading ? <LoadingCards /> : null}
      {q.isError ? <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} /> : null}
      {q.data && !items.length ? <EmptyState title="Nothing outstanding" body="All documents are in." /> : null}

      {items.length && !draft ? (
        <>
          <SectionLabel count={items.length}>Outstanding</SectionLabel>
          <Card style={{ paddingVertical: space.xs }}>
            {items.map((i) => (
              <CheckRow
                key={i.id}
                checked={sel.includes(i.id)}
                onToggle={() => setSelected(sel.includes(i.id) ? sel.filter((x) => x !== i.id) : [...sel, i.id])}
                title={`${DOCUMENT_TYPE_LABEL[i.type]}${i.period ? ` (${i.period})` : ''}`}
                subtitle={`${i.daysOverdue ? `${i.daysOverdue} days overdue` : `Due ${formatShortDate(i.dueDate)}`} · ${SOURCE_LABEL[i.source]}${i.lastRequestedAt ? ` · last asked ${formatShortDate(i.lastRequestedAt)}` : ''}`}
              >
                <Button small tone="ghost" label="Mark received" onPress={() => mark(i.id)} style={{ alignSelf: 'flex-start' }} />
              </CheckRow>
            ))}
          </Card>
          <SectionLabel>Reminder drafts</SectionLabel>
          <Row gap={space.sm}>
            {[7, 14].map((d) => <Chip key={d} label={`After ${d} days`} selected={reminders.includes(d)} onPress={() => setReminders(reminders.includes(d) ? reminders.filter((x) => x !== d) : [...reminders, d])} />)}
          </Row>
          <Text variant="caption" tone="inkSubtle">Reminders are saved as drafts for those dates. Nothing is sent.</Text>
          {error ? <ErrorState message={error} /> : null}
          <Button label="Draft request email" loading={busy} disabled={!sel.length} onPress={draftRequest} />
        </>
      ) : null}
      {draft ? <DraftEditor draft={draft} onChange={setDraft} /> : null}
    </Screen>
  );
}
