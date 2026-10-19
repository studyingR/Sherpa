/**
 * F01-FR12 chat mode: the same debrief flow by typing (REST). Messages typed while offline are queued on the
 * phone and sent when the connection returns; saving to Salesforce never runs offline (M8).
 */
import type { ComponentRef } from 'react';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ArrowLeft, Send, ShieldAlert } from 'lucide-react-native';
import type { AgentMessage, DebriefDraft } from '@sherpa/shared';
import { API, useOnline } from '@/api/hooks';
import { ApiError } from '@/api/client';
import { Text } from '@/components/Text';
import { Button, IconButton, Row } from '@/components/ui';
import { handleUiAction } from '@/lib/navigation';
import { t } from '@/i18n/en';
import { font, radius, size, space, touch, useColors } from '@/theme/tokens';
import { debriefSuggestions } from './script';

const QUEUE = (id: string) => `sherpa.queue.${id}`;

export function ChatDebrief({ draftId }: { draftId: string }) {
  const c = useColors();
  const online = useOnline();
  const [messages, setMessages] = useState<(AgentMessage & { pending?: boolean; flag?: boolean })[]>([]);
  const [draft, setDraft] = useState<DebriefDraft | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);

  useEffect(() => {
    API.transcript(draftId).then(setMessages).catch((e) => setError((e as Error).message));
    API.draft(draftId).then(setDraft).catch(() => undefined);
  }, [draftId]);

  async function send(body: string) {
    const msg = body.trim();
    if (!msg) return;
    setText('');
    setError(null);
    if (!online) {
      const q = JSON.parse((await AsyncStorage.getItem(QUEUE(draftId))) ?? '[]') as string[];
      await AsyncStorage.setItem(QUEUE(draftId), JSON.stringify([...q, msg]));
      setMessages((m) => [...m, { id: `p${Date.now()}`, speaker: 'RM', text: msg, kind: 'TEXT', at: new Date().toISOString(), pending: true }]);
      return;
    }
    setBusy(true);
    setMessages((m) => [...m, { id: `l${Date.now()}`, speaker: 'RM', text: msg, kind: 'TEXT', at: new Date().toISOString() }]);
    try {
      const turn = await API.chat(draftId, msg);
      const agent = turn.messages.filter((x) => x.speaker === 'AGENT');
      setMessages((m) => [...m, ...agent.map((x) => ({ ...x, flag: x.kind === 'FLAG' }))]);
      if (turn.draft) setDraft(turn.draft);
      for (const a of turn.actions) if (a.type !== 'OPEN_REVIEW') handleUiAction(a);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That did not send. Your draft is saved.');
    } finally {
      setBusy(false);
    }
  }

  // Flush the offline queue when back online.
  useEffect(() => {
    if (!online) return;
    (async () => {
      const q = JSON.parse((await AsyncStorage.getItem(QUEUE(draftId))) ?? '[]') as string[];
      if (!q.length) return;
      await AsyncStorage.removeItem(QUEUE(draftId));
      setMessages((m) => m.filter((x) => !x.pending));
      for (const msg of q) await send(msg);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const suggestions = debriefSuggestions(messages);
  const reviewable = draft && ['APPROVE_OPPORTUNITY', 'CONFIRM'].includes(draft.flowState);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.ground }} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Row style={{ paddingHorizontal: space.lg, paddingVertical: space.sm }} gap={space.md}>
          <IconButton accessibilityLabel="Back" onPress={() => router.back()} tone="muted">
            <ArrowLeft size={20} color={c.ink} />
          </IconButton>
          <View style={{ flex: 1 }}>
            <Text variant="heading" numberOfLines={1}>{draft?.accountName || 'Debrief'}</Text>
            <Text variant="caption" tone="inkSubtle">Chat debrief · draft saves every message</Text>
          </View>
        </Row>
        {!online ? <Text variant="caption" tone="warnInk" style={{ paddingHorizontal: space.lg }}>{t.states.offline}</Text> : null}
        <ScrollView ref={scroll} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })} contentContainerStyle={{ padding: space.lg, gap: space.sm + 2 }}>
          {messages.map((m) =>
            m.flag ? (
              <View key={m.id} accessibilityRole="alert" style={{ flexDirection: 'row', gap: space.sm, backgroundColor: c.dangerBg, borderColor: c.dangerBorder, borderWidth: 1, borderRadius: radius.md, padding: space.md }}>
                <ShieldAlert size={18} color={c.dangerInk} />
                <Text variant="smallStrong" tone="dangerInk" style={{ flex: 1 }}>{m.text}</Text>
              </View>
            ) : (
              <View key={m.id} style={{ alignSelf: m.speaker === 'AGENT' ? 'flex-start' : 'flex-end', maxWidth: '88%', backgroundColor: m.speaker === 'AGENT' ? c.surface : c.primary, borderColor: c.border, borderWidth: m.speaker === 'AGENT' ? 1 : 0, borderRadius: radius.lg, paddingHorizontal: space.md + 2, paddingVertical: space.sm + 2, opacity: m.pending ? 0.6 : 1 }}>
                <Text variant="small" style={{ color: m.speaker === 'AGENT' ? c.ink : c.onPrimary, lineHeight: 22 }}>{m.text}</Text>
                {m.pending ? <Text variant="caption" style={{ color: c.onPrimary }}>Waiting to send</Text> : null}
              </View>
            ),
          )}
          {error ? <Text variant="small" tone="warnInk" accessibilityRole="alert">{error}</Text> : null}
        </ScrollView>
        {reviewable ? (
          <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
            <Button tone="secondary" label={t.debrief.review} onPress={() => router.push(`/debrief/review/${draftId}`)} />
          </View>
        ) : null}
        {suggestions.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm, alignItems: 'center' }}>
            {suggestions.map((s) => (
              <Pressable key={s} onPress={() => send(s)} accessibilityRole="button" accessibilityLabel={`Send: ${s}`} style={{ backgroundColor: c.surfaceMuted, borderRadius: radius.pill, paddingHorizontal: space.md, minHeight: touch - 6, justifyContent: 'center', maxWidth: 280 }}>
                <Text variant="caption" numberOfLines={1}>{s}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        <Row style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }} gap={space.sm}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Tell Sherpa how it went"
            placeholderTextColor={c.inkSubtle}
            accessibilityLabel="Message"
            multiline
            style={{ flex: 1, minHeight: 48, maxHeight: 140, backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, paddingTop: 13, fontFamily: font.body, fontSize: size.lg, color: c.ink }}
          />
          <Pressable onPress={() => send(text)} disabled={busy} accessibilityRole="button" accessibilityLabel="Send" style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.5 : 1 }}>
            <Send size={20} color={c.onPrimary} />
          </Pressable>
        </Row>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
