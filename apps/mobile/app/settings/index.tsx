/** Settings: nudge cadence/channels, quiet hours, muted types, privacy mode, voice speed, reminder offset, phone PIN. */
import { useEffect, useState } from 'react';
import { Switch, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react-native';
import type { Preferences } from '@sherpa/shared';
import { API } from '@/api/hooks';
import { ApiError } from '@/api/client';
import { Text } from '@/components/Text';
import { toast } from '@/components/Toast';
import { Button, Card, Chip, ErrorState, Field, IconButton, LoadingCards, Row, Screen, SectionLabel, inputStyle } from '@/components/ui';
import { space, useColors } from '@/theme/tokens';

function SwitchRow({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const c = useColors();
  return (
    <Row style={{ justifyContent: 'space-between', minHeight: 48 }}>
      <View style={{ flex: 1 }}>
        <Text variant="small">{label}</Text>
        {hint ? <Text variant="caption" tone="inkSubtle">{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} trackColor={{ true: c.primary, false: c.border }} />
    </Row>
  );
}

export default function Settings() {
  const c = useColors();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['prefs'], queryFn: API.preferences });
  const [p, setP] = useState<Preferences | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (q.data) setP(q.data);
  }, [q.data]);

  async function save(next: Preferences) {
    setP(next);
    try {
      await API.savePreferences(next);
      qc.invalidateQueries({ queryKey: ['prefs'] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Settings did not save.');
    }
  }
  async function savePin() {
    try {
      await API.setPin(pin);
      setPin('');
      toast('Phone PIN saved');
      qc.invalidateQueries({ queryKey: ['prefs'] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The PIN did not save.');
    }
  }

  return (
    <Screen>
      <IconButton accessibilityLabel="Back" onPress={() => router.back()} tone="muted"><ArrowLeft size={20} color={c.ink} /></IconButton>
      <Text variant="title" accessibilityRole="header">Settings</Text>
      {!p ? <LoadingCards count={2} /> : (
        <>
          {error ? <ErrorState message={error} /> : null}
          <SectionLabel>Nudges</SectionLabel>
          <Card style={{ gap: space.md }}>
            <Field label="Morning agenda">
              <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
                {['07:00', '07:45', '08:30'].map((tm) => <Chip key={tm} label={tm} selected={p.morningAgendaTime === tm} onPress={() => save({ ...p, morningAgendaTime: tm })} />)}
              </Row>
            </Field>
            <Field label="Cadence">
              <Row gap={space.sm}>
                <Chip label="Morning only" selected={p.cadence === 'MORNING'} onPress={() => save({ ...p, cadence: 'MORNING' })} />
                <Chip label="Morning and afternoon" selected={p.cadence === 'MORNING_AFTERNOON'} onPress={() => save({ ...p, cadence: 'MORNING_AFTERNOON' })} />
              </Row>
            </Field>
            <SwitchRow label="Push notifications" value={p.channels.push} onChange={(v) => save({ ...p, channels: { ...p.channels, push: v } })} />
            <SwitchRow label="Quiet hours" hint={`${p.quietHours.start} to ${p.quietHours.end}. Held items still appear in-app.`} value={p.quietHours.enabled} onChange={(v) => save({ ...p, quietHours: { ...p.quietHours, enabled: v } })} />
            <Field label="Mute">
              <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
                {[['brief', 'Brief ready'], ['agenda', 'Agenda'], ['nudge', 'Nudges'], ['coverage', 'Coverage']].map(([k, label]) => (
                  <Chip key={k} label={label} selected={p.mutedTypes.includes(k)} onPress={() => save({ ...p, mutedTypes: p.mutedTypes.includes(k) ? p.mutedTypes.filter((x) => x !== k) : [...p.mutedTypes, k] })} />
                ))}
              </Row>
            </Field>
            <Field label="Brief reminder before meetings">
              <Row gap={space.sm}>
                {[15, 30, 60].map((m) => <Chip key={m} label={`${m} min`} selected={p.meetingReminderMinutes === m} onPress={() => save({ ...p, meetingReminderMinutes: m })} />)}
              </Row>
            </Field>
          </Card>

          <SectionLabel>Voice</SectionLabel>
          <Card style={{ gap: space.md }}>
            <SwitchRow label="Privacy mode" hint="Ask before reading balances or exposure aloud." value={p.privacyMode} onChange={(v) => save({ ...p, privacyMode: v })} />
            <Field label="Voice speed">
              <Row gap={space.sm}>
                {[0.9, 1, 1.15, 1.3].map((s) => <Chip key={s} label={`${s}x`} selected={p.voiceSpeed === s} onPress={() => save({ ...p, voiceSpeed: s })} />)}
              </Row>
            </Field>
          </Card>

          <SectionLabel>Phone channel</SectionLabel>
          <Card style={{ gap: space.md }}>
            <Text variant="small" tone="inkMuted">{p.phonePinSet ? 'A PIN is set. Calling in also works with push approval on this phone.' : 'Set a 6-digit PIN to use Sherpa by phone. Caller ID alone is never enough.'}</Text>
            <Row gap={space.sm}>
              <TextInput value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" secureTextEntry placeholder="6 digits" placeholderTextColor={c.inkSubtle} accessibilityLabel="Phone PIN" style={[inputStyle(c), { flex: 1 }]} />
              <Button small label="Save PIN" disabled={pin.length !== 6} onPress={savePin} />
            </Row>
          </Card>
        </>
      )}
    </Screen>
  );
}
