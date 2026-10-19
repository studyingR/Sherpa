/** F02 brief: sourced sections, missing sources, talking points (F09), spoken brief, grounded Q&A. */
import { useState } from 'react';
import { Pressable, RefreshControl, Switch, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown, ChevronUp, Play, Send } from 'lucide-react-native';
import { SOURCE_LABEL, formatTime, type AskBriefResponse, type Brief, type BriefSection } from '@sherpa/shared';
import { API, type Offline } from '@/api/hooks';
import { ApiError } from '@/api/client';
import { Text } from '@/components/Text';
import { Button, Card, ErrorState, FactGrid, IconButton, LoadingCards, Row, Screen, SourceTag } from '@/components/ui';
import { TalkingPointCard } from '@/features/insights/TalkingPointCard';
import { t } from '@/i18n/en';
import { font, radius, size, space, touch, useColors } from '@/theme/tokens';

function SectionCard({ s }: { s: BriefSection }) {
  const c = useColors();
  const [open, setOpen] = useState(['overview', 'commitments', 'alerts', 'credit'].includes(s.id));
  const count = s.facts.length + (s.items?.length ?? 0);
  if (s.id === 'talkingPoints') return null;
  return (
    <Card padded={false}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${s.title}, ${count} items`} onPress={() => setOpen(!open)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space.lg, minHeight: touch + 8 }}>
        <Text variant="bodyStrong">{s.title}</Text>
        <Row gap={space.sm}>
          <Text variant="caption" tone="inkSubtle">{count || 'None'}</Text>
          {open ? <ChevronUp size={18} color={c.inkSubtle} /> : <ChevronDown size={18} color={c.inkSubtle} />}
        </Row>
      </Pressable>
      {open && count ? (
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.md }}>
          {s.id !== 'alerts' ? <FactGrid facts={s.facts} /> : null}
          {(s.items ?? []).map((it, i) => (
            <View key={i} style={{ gap: 2, borderLeftWidth: 2, borderLeftColor: s.id === 'commitments' ? c.accentGold : c.border, paddingLeft: space.md }}>
              <Text variant="smallStrong">{it.title}</Text>
              {it.detail ? <Text variant="small" tone="inkMuted">{it.detail}</Text> : null}
              <SourceTag source={it.source} asOf={it.asOf} />
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

export function BriefView({ meetingId, accountId }: { meetingId?: string; accountId?: string }) {
  const c = useColors();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['brief', meetingId ?? accountId], queryFn: () => (meetingId ? API.briefMeeting(meetingId) : API.briefAccount(accountId!)) });
  const prefs = useQuery({ queryKey: ['prefs'], queryFn: API.preferences });
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<AskBriefResponse | null>(null);
  const [asking, setAsking] = useState(false);
  const b = q.data as Offline<Brief> | undefined;
  const tpSection = b?.sections.find((s) => s.id === 'talkingPoints');
  const account = useQuery({ queryKey: ['account', b?.accountId], queryFn: () => API.account(b!.accountId), enabled: Boolean(b && tpSection?.items?.length) });

  async function ask() {
    if (!b || !question.trim()) return;
    setAsking(true);
    try {
      setAnswer(await API.askBrief(b.accountId, question.trim()));
    } catch (e) {
      setAnswer({ answer: e instanceof ApiError ? e.message : "I don't have that.", facts: [] });
    } finally {
      setAsking(false);
    }
  }
  async function togglePrivacy(readAloud: boolean) {
    if (!prefs.data) return;
    await API.savePreferences({ ...prefs.data, privacyMode: !readAloud });
    qc.invalidateQueries({ queryKey: ['prefs'] });
  }

  return (
    <Screen refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={c.primary} />}>
      <IconButton accessibilityLabel="Back" onPress={() => router.back()} tone="muted">
        <ArrowLeft size={20} color={c.ink} />
      </IconButton>
      {q.isLoading ? <LoadingCards count={4} /> : null}
      {q.isError && !b ? <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} /> : null}
      {b ? (
        <>
          <View style={{ gap: 4 }}>
            <Text variant="caption" tone="inkSubtle">{b.meeting ? `${formatTime(b.meeting.start)} · ${b.meeting.subject}` : 'Account brief'}</Text>
            <Text variant="display" accessibilityRole="header">{b.accountName}</Text>
            {b.meeting?.attendees.length ? <Text variant="small" tone="inkMuted">With {b.meeting.attendees.join(', ')}</Text> : null}
          </View>
          {b.__offline ? <ErrorState message={t.states.offline} /> : null}
          {b.missingSources.length ? <ErrorState message={`${b.missingSources.map((s) => SOURCE_LABEL[s]).join(', ')} data unavailable right now. The rest of the brief is current.`} /> : null}

          <Card tone="dark" style={{ gap: space.md }}>
            <Text variant="label" tone="callInkMuted">What Sherpa will say</Text>
            <Text variant="small" tone="callInk" style={{ lineHeight: 22 }}>{prefs.data?.privacyMode === false ? b.spoken : b.spokenPrivate}</Text>
            <Row style={{ justifyContent: 'space-between' }}>
              <Button small label="Play brief" icon={<Play size={16} color={c.onPrimary} />} onPress={() => router.push(b.meetingId ? `/voice?mode=BRIEF&meetingId=${b.meetingId}` : `/voice?mode=BRIEF&accountId=${b.accountId}`)} />
              <Row gap={space.sm}>
                <Text variant="caption" tone="callInkMuted">Read figures aloud</Text>
                <Switch value={prefs.data?.privacyMode === false} onValueChange={togglePrivacy} accessibilityLabel="Read balances and exposure aloud" trackColor={{ true: c.callAccent, false: c.callSurface }} />
              </Row>
            </Row>
          </Card>

          {b.sections.map((s) => <SectionCard key={s.id} s={s} />)}

          {account.data?.talkingPoints.length ? (
            <View style={{ gap: space.md }}>
              <Text variant="label" tone="inkSubtle">Talking points</Text>
              <Text variant="caption" tone="inkSubtle">{t.disclaimers.talkingPoints}</Text>
              {account.data.talkingPoints.map((tp) => <TalkingPointCard key={tp.id} tp={tp} />)}
            </View>
          ) : null}

          <Card style={{ gap: space.md }}>
            <Text variant="bodyStrong">Ask a question</Text>
            <Row gap={space.sm}>
              <TextInput value={question} onChangeText={setQuestion} onSubmitEditing={ask} placeholder="When does their line mature?" placeholderTextColor={c.inkSubtle} accessibilityLabel="Ask a question about this account" returnKeyType="send" style={{ flex: 1, minHeight: 48, borderRadius: radius.sm, borderWidth: 1, borderColor: c.border, paddingHorizontal: space.md, fontFamily: font.body, fontSize: size.lg, color: c.ink }} />
              <IconButton accessibilityLabel="Ask" onPress={ask} tone="muted">
                <Send size={18} color={c.primary} />
              </IconButton>
            </Row>
            {asking ? <Text variant="caption" tone="inkSubtle">Checking the brief</Text> : null}
            {answer ? (
              <View style={{ gap: space.sm }}>
                <Text variant="small">{answer.answer}</Text>
                {answer.facts.map((f) => <SourceTag key={f.key} source={f.source} asOf={f.asOf} />)}
              </View>
            ) : null}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
