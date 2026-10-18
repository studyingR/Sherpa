/** Dark call screen (docs/06 §4): header, captions, flag bubbles, contour mic, Done talking / Type / End. */
import type { ComponentRef } from 'react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Keyboard, Mic, PhoneOff, Send, ShieldAlert, Square } from 'lucide-react-native';
import type { Mode, UiAction, VoiceState } from '@sherpa/shared';
import { Contours, type ContourMode } from '@/components/Contours';
import { Text } from '@/components/Text';
import { Button, Row } from '@/components/ui';
import { t } from '@/i18n/en';
import { font, radius, size, space, touch, useColors } from '@/theme/tokens';
import { useVoiceSession, type Line } from './useVoiceSession';

const STATE_LABEL: Record<VoiceState, string> = { CONNECTING: 'Connecting', LISTENING: 'Listening', THINKING: 'Thinking', SPEAKING: 'Speaking', IDLE: 'Ready', ENDED: 'Call ended' };

function Timer() {
  const [s, setS] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setS((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return <Text variant="caption" tone="callInkMuted">{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}</Text>;
}

export function Bubble({ line }: { line: Line }) {
  const c = useColors();
  if (line.speaker === 'FLAG') {
    return (
      <View accessibilityRole="alert" style={{ flexDirection: 'row', gap: space.sm, alignSelf: 'stretch', backgroundColor: '#3A1C19', borderColor: '#6B2A22', borderWidth: 1, borderRadius: radius.md, padding: space.md }}>
        <ShieldAlert size={18} color="#FFB4A8" />
        <Text variant="smallStrong" style={{ color: '#FFB4A8', flex: 1 }}>{line.text}</Text>
      </View>
    );
  }
  const agent = line.speaker === 'AGENT';
  const readBack = line.kind === 'READ_BACK';
  return (
    <View style={{ alignSelf: agent ? 'flex-start' : 'flex-end', maxWidth: '88%', backgroundColor: agent ? (readBack ? '#16302C' : c.callSurface) : c.callAccent, borderRadius: radius.lg, borderTopLeftRadius: agent ? 4 : radius.lg, borderTopRightRadius: agent ? radius.lg : 4, paddingHorizontal: space.md + 2, paddingVertical: space.sm + 2 }}>
      <Text variant="small" style={{ color: agent ? c.callInk : '#06231F', lineHeight: 22 }}>{line.text}</Text>
    </View>
  );
}

export interface CallScreenProps {
  mode: Mode;
  title: string;
  subtitle?: string;
  draftId?: string;
  meetingId?: string;
  accountId?: string;
  onUiAction: (a: UiAction) => void;
  onEnd: () => void;
  /** Demo helper shown only in mock voice mode: tappable "say this" replies. */
  suggestions?: (lines: Line[]) => string[];
  footer?: (s: ReturnType<typeof useVoiceSession>) => ReactNode;
}

export function CallScreen(p: CallScreenProps) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const v = useVoiceSession({ mode: p.mode, draftId: p.draftId, meetingId: p.meetingId, accountId: p.accountId, onUiAction: p.onUiAction });
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const contourMode: ContourMode = v.listening ? 'listening' : v.state === 'THINKING' ? 'thinking' : v.state === 'SPEAKING' ? 'speaking' : 'idle';
  const suggestions = v.voiceMode === 'mock' && p.suggestions ? p.suggestions(v.lines) : [];

  function micPress() {
    if (v.listening) v.stopListening(true);
    else v.startListening();
  }
  function submit() {
    v.sendText(text);
    setText('');
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.callBg, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <StatusBar style="light" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        {/* header */}
        <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.sm }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Row gap={space.sm}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: v.connected ? c.callAccent : c.callInkMuted }} />
              <Text variant="smallStrong" tone="callInk">Sherpa</Text>
              <Timer />
            </Row>
            <View style={{ backgroundColor: c.callSurface, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text variant="caption" tone="callInkMuted">{t.debrief.notStored}</Text>
            </View>
          </Row>
          <Text variant="title" tone="callInk" numberOfLines={1}>{p.title}</Text>
          {p.subtitle ? <Text variant="small" tone="callInkMuted">{p.subtitle}</Text> : null}
        </View>

        {/* transcript (captions) */}
        <ScrollView ref={scroll} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })} contentContainerStyle={{ padding: space.lg, gap: space.sm + 2 }} accessibilityLabel="Conversation">
          {v.lines.map((l) => <Bubble key={l.id} line={l} />)}
          {v.error ? <Text variant="caption" tone="callInkMuted" accessibilityRole="alert">{v.error}</Text> : null}
        </ScrollView>

        {suggestions.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm, alignItems: 'center' }}>
            <Text variant="caption" tone="callInkMuted" style={{ alignSelf: 'center' }}>Try saying</Text>
            {suggestions.map((s) => (
              <Pressable key={s} onPress={() => v.sendText(s)} accessibilityRole="button" accessibilityLabel={`Say: ${s}`} style={{ backgroundColor: c.callSurface, borderRadius: radius.pill, paddingHorizontal: space.md, minHeight: touch - 6, justifyContent: 'center', maxWidth: 280 }}>
                <Text variant="caption" tone="callInk" numberOfLines={1}>{s}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {p.footer?.(v)}

        {/* controls */}
        {typing ? (
          <Row style={{ paddingHorizontal: space.lg, paddingBottom: space.md }} gap={space.sm}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Type your reply"
              placeholderTextColor={c.callInkMuted}
              accessibilityLabel="Type your reply"
              onSubmitEditing={submit}
              returnKeyType="send"
              autoFocus
              multiline
              style={{ flex: 1, minHeight: 48, maxHeight: 120, backgroundColor: c.callSurface, color: c.callInk, borderRadius: radius.md, paddingHorizontal: space.md, paddingTop: 13, fontFamily: font.body, fontSize: size.lg }}
            />
            <Pressable onPress={submit} accessibilityRole="button" accessibilityLabel="Send" style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: c.callAccent, alignItems: 'center', justifyContent: 'center' }}>
              <Send size={20} color="#06231F" />
            </Pressable>
            <Pressable onPress={() => setTyping(false)} accessibilityRole="button" accessibilityLabel="Use voice" style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: c.callSurface, alignItems: 'center', justifyContent: 'center' }}>
              <Mic size={20} color={c.callInk} />
            </Pressable>
          </Row>
        ) : (
          <View style={{ alignItems: 'center', gap: space.md, paddingBottom: space.md }}>
            <View style={{ width: 220, height: 170, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ position: 'absolute' }}>
                <Contours size={250} color={c.callAccent} mode={contourMode} level={v.level} opacity={0.55} seed={1.9} />
              </View>
              <Pressable
                onPress={micPress}
                accessibilityRole="button"
                accessibilityLabel={v.listening ? 'Done talking' : 'Start talking'}
                accessibilityHint={`Sherpa is ${STATE_LABEL[v.state].toLowerCase()}`}
                style={({ pressed }) => ({ width: 88, height: 88, borderRadius: 44, backgroundColor: v.listening ? c.callAccent : c.callSurface, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}
              >
                {v.listening ? <Square size={28} color="#06231F" fill="#06231F" /> : <Mic size={32} color={c.callInk} />}
              </Pressable>
            </View>
            <Text variant="smallStrong" tone="callInk" accessibilityLiveRegion="polite">{v.listening ? 'Listening' : v.state === 'LISTENING' || v.state === 'IDLE' ? 'Tap the mic to talk' : STATE_LABEL[v.state]}</Text>
            <Row gap={space.sm}>
              {v.listening ? <Button small tone="onDark" label={t.debrief.doneTalking} onPress={() => v.stopListening(true)} /> : null}
              <Button small tone="onDark" label={t.debrief.typeInstead} icon={<Keyboard size={16} color={c.callInk} />} onPress={() => setTyping(true)} />
            </Row>
            <Pressable
              onPress={() => {
                v.end();
                p.onEnd();
              }}
              accessibilityRole="button"
              accessibilityLabel={t.debrief.endCall}
              style={{ flexDirection: 'row', gap: 6, alignItems: 'center', minHeight: touch }}
            >
              <PhoneOff size={16} color="#FFB4A8" />
              <Text variant="smallStrong" style={{ color: '#FFB4A8' }}>{p.mode === 'DEBRIEF' ? t.debrief.endCall : 'End'}</Text>
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}
