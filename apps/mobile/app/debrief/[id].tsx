/** F01 capture: voice call (default) or chat (?mode=chat). `id` is a draft id, or "new" to start/resume. */
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { StartDebriefResponse } from '@sherpa/shared';
import { API } from '@/api/hooks';
import { ApiError } from '@/api/client';
import { Text } from '@/components/Text';
import { Button, Card, ErrorState, Screen } from '@/components/ui';
import { ChatDebrief } from '@/features/debrief/ChatDebrief';
import { debriefSuggestions } from '@/features/debrief/script';
import { t } from '@/i18n/en';
import { space, useColors } from '@/theme/tokens';
import { CallScreen } from '@/voice/CallScreen';
import { handleUiAction } from '@/lib/navigation';

function Starter({ meetingId, accountId, chat }: { meetingId?: string; accountId?: string; chat: boolean }) {
  const c = useColors();
  const [res, setRes] = useState<StartDebriefResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(startOver?: boolean) {
    setError(null);
    try {
      const r = await API.startDebrief({ meetingId, accountId, channel: chat ? 'CHAT' : 'APP', startOver });
      if (r.resumeOf) setRes(r);
      else router.replace(`/debrief/${r.draftId}${chat ? '?mode=chat' : ''}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not start the debrief.');
    }
  }
  useEffect(() => {
    start();
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (res?.resumeOf) {
    return (
      <Screen edges={['top', 'bottom']}>
        <Card style={{ gap: space.md }}>
          <Text variant="heading">{t.debrief.resumeTitle}</Text>
          <Text variant="small" tone="inkMuted">Your {res.resumeOf.accountName} debrief has unsaved notes. Everything you said is still there.</Text>
          <Button label={t.debrief.resume} onPress={() => router.replace(`/debrief/${res.resumeOf!.draftId}${chat ? '?mode=chat' : ''}`)} />
          <Button tone="ghost" label={t.debrief.startOver} onPress={() => start(true)} />
        </Card>
      </Screen>
    );
  }
  return (
    <Screen edges={['top', 'bottom']} scroll={false} contentStyle={{ alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md }}>
      {error ? <ErrorState message={error} onRetry={() => start()} /> : <ActivityIndicator color={c.primary} />}
      {error ? <Button tone="ghost" label="Close" onPress={() => router.back()} /> : <Text variant="small" tone="inkMuted">Finding your meeting</Text>}
    </Screen>
  );
}

export default function DebriefCapture() {
  const { id, meetingId, accountId, mode } = useLocalSearchParams<{ id: string; meetingId?: string; accountId?: string; mode?: string }>();
  const chat = mode === 'chat';
  const [title, setTitle] = useState('Debrief');
  useEffect(() => {
    if (id !== 'new') API.draft(id).then((d) => setTitle(d.accountName || 'Debrief')).catch(() => undefined);
  }, [id]);

  if (id === 'new') return <Starter meetingId={meetingId} accountId={accountId} chat={chat} />;
  if (chat) return <ChatDebrief draftId={id} />;
  return (
    <View style={{ flex: 1 }}>
      <CallScreen
        mode="DEBRIEF"
        title={title}
        subtitle="Post-meeting debrief"
        draftId={id}
        onUiAction={handleUiAction}
        onEnd={() => router.back()}
        suggestions={debriefSuggestions}
        footer={(v) =>
          v.draft && 'flowState' in v.draft && ['APPROVE_OPPORTUNITY', 'CONFIRM'].includes(v.draft.flowState) ? (
            <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
              <Button tone="onDark" label={t.debrief.review} onPress={() => router.push(`/debrief/review/${id}`)} />
            </View>
          ) : null
        }
      />
    </View>
  );
}
