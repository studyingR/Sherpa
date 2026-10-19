/**
 * F11 live listening (gated): consent sheet → persistent "Listening" indicator, pause/stop, captured items.
 * Mock mode: segments are typed. With an OpenAI key the same screen uses the voice gateway in LIVE mode.
 */
import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, Pause, Play, Square } from 'lucide-react-native';
import { API } from '@/api/hooks';
import { ApiError } from '@/api/client';
import { Contours } from '@/components/Contours';
import { Text } from '@/components/Text';
import { Button, Card, Chip, ErrorState, Row } from '@/components/ui';
import { useFeature } from '@/store/session';
import { font, radius, size, space, touch, useColors } from '@/theme/tokens';

const STATES = ['NJ', 'NY', 'PA', 'CA', 'FL', 'CT'];
const ALL_PARTY = ['CA', 'FL', 'IL', 'MD', 'MA', 'MT', 'NH', 'PA', 'WA'];
const STATEMENT = 'Everyone in this meeting agreed that Sherpa may transcribe it. No audio is stored.';

export default function Live() {
  const c = useColors();
  const enabled = useFeature('F11_LIVE_LISTENING');
  const { meetingId } = useLocalSearchParams<{ meetingId: string }>();
  const [jurisdiction, setJurisdiction] = useState('NJ');
  const [consent, setConsent] = useState(false);
  const [session, setSession] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [captured, setCaptured] = useState<{ nextSteps: string[]; flags: { flag: string; message: string }[] }>({ nextSteps: [], flags: [] });
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!enabled) return null; // invisible when the feature is off (F11-AC1)

  async function start() {
    setError(null);
    try {
      const r = await API.liveStart({ meetingId, jurisdiction, allPartyConsentConfirmed: consent, consentStatement: STATEMENT });
      setSession(r.sessionId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Listening could not start.');
    }
  }
  async function segment() {
    if (!session || !text.trim() || paused) return;
    const r = await API.liveSegment(session, text.trim());
    setCaptured(r.captured);
    setText('');
  }
  async function stop() {
    if (!session) return;
    const r = await API.liveStop(session);
    router.replace(`/debrief/review/${r.draftId}`);
  }

  if (!session) {
    const needsAll = ALL_PARTY.includes(jurisdiction);
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.ground, padding: space.lg, gap: space.lg }}>
        <Text variant="title" accessibilityRole="header">Before Sherpa listens</Text>
        <Text variant="small" tone="inkMuted">Confirm where the meeting is taking place. Some states require every participant to agree.</Text>
        <Row style={{ flexWrap: 'wrap' }} gap={space.sm}>
          {STATES.map((s) => <Chip key={s} label={s} selected={jurisdiction === s} onPress={() => setJurisdiction(s)} />)}
        </Row>
        {needsAll ? <Text variant="smallStrong" tone="warnInk">{jurisdiction} requires consent from everyone in the meeting.</Text> : null}
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: consent }} onPress={() => setConsent(!consent)} style={{ flexDirection: 'row', gap: space.md, alignItems: 'center', minHeight: touch }}>
          <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: consent ? c.primary : c.border, backgroundColor: consent ? c.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
            {consent ? <Check size={16} color={c.onPrimary} strokeWidth={3} /> : null}
          </View>
          <Text variant="small" style={{ flex: 1 }}>{STATEMENT}</Text>
        </Pressable>
        {error ? <ErrorState message={error} /> : null}
        <Button label="Start listening" disabled={needsAll && !consent} onPress={start} />
        <Button tone="ghost" label="Cancel" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.callBg }}>
      <View style={{ alignItems: 'center', paddingTop: space.xl, gap: space.md }}>
        <View style={{ width: 180, height: 180, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ position: 'absolute' }}><Contours size={200} color={c.callAccent} mode={paused ? 'idle' : 'thinking'} opacity={0.5} /></View>
          <View style={{ backgroundColor: paused ? c.callSurface : '#7E1D14', borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: space.sm }} accessibilityLiveRegion="polite">
            <Text variant="bodyStrong" tone="callInk">{paused ? 'Paused' : 'Listening'}</Text>
          </View>
        </View>
        <Row gap={space.md}>
          <Button small tone="onDark" label={paused ? 'Resume' : 'Pause'} icon={paused ? <Play size={16} color={c.callInk} /> : <Pause size={16} color={c.callInk} />} onPress={() => setPaused(!paused)} />
          <Button small tone="danger" label="Stop and review" icon={<Square size={14} color={c.dangerInk} />} onPress={stop} />
        </Row>
      </View>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.sm }}>
        <Text variant="label" tone="callInkMuted">Captured so far (only you see this)</Text>
        {captured.flags.map((f, i) => <Card key={`f${i}`} tone="danger"><Text variant="smallStrong" tone="dangerInk">{f.message}</Text></Card>)}
        {captured.nextSteps.map((s, i) => <Text key={i} variant="small" tone="callInk">• {s}</Text>)}
      </ScrollView>
      <Row style={{ padding: space.lg }} gap={space.sm}>
        <TextInput value={text} onChangeText={setText} onSubmitEditing={segment} placeholder="Add a transcript segment" placeholderTextColor={c.callInkMuted} accessibilityLabel="Transcript segment" style={{ flex: 1, minHeight: 48, backgroundColor: c.callSurface, color: c.callInk, borderRadius: radius.md, paddingHorizontal: space.md, fontFamily: font.body, fontSize: size.lg }} />
        <Button small tone="onDark" label="Add" onPress={segment} />
      </Row>
    </SafeAreaView>
  );
}
