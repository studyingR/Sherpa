import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import type { FollowUpDraft } from '@sherpa/shared';
import { API } from '@/api/hooks';
import { ApiError } from '@/api/client';
import { Text } from '@/components/Text';
import { EmptyState, ErrorState, IconButton, LoadingCards, Row, Screen } from '@/components/ui';
import { DraftEditor } from '@/features/drafts/DraftEditor';
import { radius, space, touch, useColors } from '@/theme/tokens';

export default function Drafts() {
  const c = useColors();
  const { debriefId } = useLocalSearchParams<{ debriefId: string }>();
  const [drafts, setDrafts] = useState<FollowUpDraft[] | null>(null);
  const [tab, setTab] = useState<'CLIENT' | 'INTERNAL'>('CLIENT');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    API.createDrafts(debriefId, ['CLIENT', 'INTERNAL']).then(setDrafts).catch((e) => setError(e instanceof ApiError ? e.message : 'Drafts could not be created.'));
  }, [debriefId]);

  const shown = (drafts ?? []).filter((d) => d.kind === tab);
  const update = (d: FollowUpDraft) => setDrafts((all) => (all ?? []).map((x) => (x.id === d.id ? d : x)));

  return (
    <Screen>
      <Row gap={space.md}>
        <IconButton accessibilityLabel="Back" onPress={() => router.back()} tone="muted">
          <ArrowLeft size={20} color={c.ink} />
        </IconButton>
        <Text variant="title" accessibilityRole="header">Follow-ups</Text>
      </Row>
      <View style={{ flexDirection: 'row', backgroundColor: c.surfaceMuted, borderRadius: radius.md, padding: 4 }} accessibilityRole="tablist">
        {(['CLIENT', 'INTERNAL'] as const).map((k) => (
          <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} onPress={() => setTab(k)} style={{ flex: 1, minHeight: touch, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: tab === k ? c.surface : 'transparent' }}>
            <Text variant="smallStrong" tone={tab === k ? 'ink' : 'inkMuted'}>{k === 'CLIENT' ? 'Client recap' : `Internal handoffs${drafts ? ` (${drafts.filter((d) => d.kind === 'INTERNAL').length})` : ''}`}</Text>
          </Pressable>
        ))}
      </View>
      {error ? <ErrorState message={error} /> : null}
      {!drafts && !error ? <LoadingCards count={2} /> : null}
      {drafts && !shown.length ? <EmptyState title={tab === 'CLIENT' ? 'No client recap' : 'No internal handoffs needed'} /> : null}
      {shown.map((d) => <DraftEditor key={d.id} draft={d} onChange={update} />)}
    </Screen>
  );
}
