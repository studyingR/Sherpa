/** Ask Sherpa by typing (long-press the center button). Writes come back as intents to confirm. */
import type { ComponentRef } from 'react';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Send, X } from 'lucide-react-native';
import type { AgentMessage } from '@sherpa/shared';
import { API } from '@/api/hooks';
import { ApiError } from '@/api/client';
import { Text } from '@/components/Text';
import { IconButton, Row } from '@/components/ui';
import { handleUiAction } from '@/lib/navigation';
import { font, radius, size, space, touch, useColors } from '@/theme/tokens';

const EXAMPLES = ['Brief me on Harbor Logistics', 'Mark the Brightwater docs done', 'Delegate the Riverline AR aging to Priya', 'Documents due for Castell', 'Who should I call this week?'];

export default function Ask() {
  const c = useColors();
  const [msgs, setMsgs] = useState<AgentMessage[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);

  async function send(body: string) {
    const q = body.trim();
    if (!q) return;
    setText('');
    setBusy(true);
    setMsgs((m) => [...m, { id: `${Date.now()}`, speaker: 'RM', text: q, kind: 'TEXT', at: new Date().toISOString() }]);
    try {
      const turn = await API.ask(q);
      setMsgs((m) => [...m, ...turn.messages]);
      const nav = turn.actions.find((a) => a.type !== 'NAVIGATE' || a.route !== '/today');
      if (nav) setTimeout(() => handleUiAction(nav), 600);
    } catch (e) {
      setMsgs((m) => [...m, { id: `${Date.now()}e`, speaker: 'AGENT', text: e instanceof ApiError ? e.message : 'Something went wrong.', kind: 'TEXT', at: new Date().toISOString() }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.ground }} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Row style={{ justifyContent: 'space-between', paddingHorizontal: space.lg, paddingTop: space.sm }}>
          <Text variant="title" accessibilityRole="header">Ask Sherpa</Text>
          <IconButton accessibilityLabel="Close" onPress={() => router.back()} tone="muted">
            <X size={20} color={c.ink} />
          </IconButton>
        </Row>
        <ScrollView ref={scroll} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })} contentContainerStyle={{ padding: space.lg, gap: space.sm + 2, flexGrow: 1 }}>
          {!msgs.length ? (
            <View style={{ gap: space.sm }}>
              <Text variant="small" tone="inkMuted">Try one of these</Text>
              {EXAMPLES.map((e) => (
                <Pressable key={e} onPress={() => send(e)} accessibilityRole="button" accessibilityLabel={e} style={{ backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: radius.md, padding: space.md, minHeight: touch }}>
                  <Text variant="small">{e}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {msgs.map((m) => (
            <View key={m.id} style={{ alignSelf: m.speaker === 'AGENT' ? 'flex-start' : 'flex-end', maxWidth: '88%', backgroundColor: m.speaker === 'AGENT' ? c.surface : c.primary, borderColor: c.border, borderWidth: m.speaker === 'AGENT' ? 1 : 0, borderRadius: radius.lg, paddingHorizontal: space.md + 2, paddingVertical: space.sm + 2 }}>
              <Text variant="small" style={{ color: m.speaker === 'AGENT' ? c.ink : c.onPrimary, lineHeight: 22 }}>{m.text}</Text>
            </View>
          ))}
          {busy ? <Text variant="caption" tone="inkSubtle">Thinking</Text> : null}
        </ScrollView>
        <Row style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }} gap={space.sm}>
          <TextInput value={text} onChangeText={setText} onSubmitEditing={() => send(text)} autoFocus placeholder="Ask anything about your book" placeholderTextColor={c.inkSubtle} accessibilityLabel="Ask Sherpa" returnKeyType="send" style={{ flex: 1, minHeight: 48, backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, fontFamily: font.body, fontSize: size.lg, color: c.ink }} />
          <Pressable onPress={() => send(text)} accessibilityRole="button" accessibilityLabel="Send" style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
            <Send size={20} color={c.onPrimary} />
          </Pressable>
        </Row>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
