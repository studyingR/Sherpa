/** F05: prefilled referral — specialty, contact, need, urgency, consent, routed queue preview, confirm. */
import { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Route } from 'lucide-react-native';
import { SPECIALTY_LABEL, Specialty, type RoutePreview } from '@sherpa/shared';
import { API, useOnline } from '@/api/hooks';
import { ApiError } from '@/api/client';
import { Text } from '@/components/Text';
import { toast } from '@/components/Toast';
import { Button, Card, Chip, ErrorState, Field, IconButton, Row, Screen, inputStyle } from '@/components/ui';
import { t } from '@/i18n/en';
import { radius, space, touch, useColors } from '@/theme/tokens';

export default function NewReferral() {
  const c = useColors();
  const qc = useQueryClient();
  const online = useOnline();
  const params = useLocalSearchParams<{ accountId?: string; debriefId?: string; specialty?: string }>();
  const account = useQuery({ queryKey: ['account', params.accountId], queryFn: () => API.account(params.accountId!), enabled: Boolean(params.accountId) });
  const [specialty, setSpecialty] = useState<Specialty | null>((params.specialty as Specialty) ?? null);
  const [contactId, setContactId] = useState<string | undefined>();
  const [need, setNeed] = useState('');
  const [urgency, setUrgency] = useState<'LOW' | 'NORMAL' | 'HIGH'>('NORMAL');
  const [consent, setConsent] = useState(false);
  const [route, setRoute] = useState<RoutePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params.debriefId) return;
    API.referralPrefill(params.debriefId).then((p) => {
      if (!specialty && p.specialty) setSpecialty(p.specialty);
      setNeed(p.needSummary);
      if (p.contactId) setContactId(p.contactId);
    }).catch(() => undefined);
    // prefill once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.debriefId]);

  useEffect(() => {
    if (!specialty || !params.accountId) return;
    API.referralRoute(params.accountId, specialty).then(setRoute).catch(() => setRoute(null));
  }, [specialty, params.accountId]);

  useEffect(() => {
    if (!contactId && account.data?.contacts[0]) setContactId(account.data.contacts.find((x) => x.isPrimary)?.id ?? account.data.contacts[0].id);
  }, [account.data, contactId]);

  async function submit() {
    if (!specialty || !params.accountId) return;
    setBusy(true);
    setError(null);
    try {
      const intent = await API.referralIntent({ accountId: params.accountId, specialty, contactId, needSummary: need, urgency, consentToShare: consent, debriefId: params.debriefId });
      const r = await API.confirmIntent({ intentId: intent.id, channel: 'tap', approvals: {} });
      toast(r.written.map((w) => w.label).join(' · '));
      qc.invalidateQueries({ queryKey: ['account'] });
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The referral did not save.');
    } finally {
      setBusy(false);
    }
  }

  const ready = Boolean(specialty && need.trim() && consent);
  return (
    <Screen>
      <Row gap={space.md}>
        <IconButton accessibilityLabel="Back" onPress={() => router.back()} tone="muted">
          <ArrowLeft size={20} color={c.ink} />
        </IconButton>
        <View>
          <Text variant="title" accessibilityRole="header">Specialist referral</Text>
          <Text variant="small" tone="inkMuted">{account.data?.account.name ?? ''}</Text>
        </View>
      </Row>

      <Field label="Specialty">
        <Row style={{ flexWrap: 'wrap' }} gap={space.sm}>
          {Specialty.options.map((s) => <Chip key={s} label={SPECIALTY_LABEL[s]} selected={specialty === s} onPress={() => setSpecialty(s)} />)}
        </Row>
      </Field>
      <Field label="Client contact">
        <Row style={{ flexWrap: 'wrap' }} gap={space.sm}>
          {(account.data?.contacts ?? []).map((ct) => <Chip key={ct.id} label={`${ct.name}, ${ct.title}`} selected={contactId === ct.id} onPress={() => setContactId(ct.id)} />)}
        </Row>
      </Field>
      <Field label="What the client needs">
        <TextInput value={need} onChangeText={setNeed} multiline placeholder="For example: paying a new German supplier in euros" placeholderTextColor={c.inkSubtle} accessibilityLabel="Need summary" style={[inputStyle(c), { minHeight: 96, textAlignVertical: 'top' }]} />
      </Field>
      <Field label="Urgency">
        <View style={{ flexDirection: 'row', backgroundColor: c.surfaceMuted, borderRadius: radius.md, padding: 4 }}>
          {(['LOW', 'NORMAL', 'HIGH'] as const).map((u) => (
            <Pressable key={u} accessibilityRole="radio" accessibilityState={{ selected: urgency === u }} accessibilityLabel={u.toLowerCase()} onPress={() => setUrgency(u)} style={{ flex: 1, minHeight: touch, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: urgency === u ? c.surface : 'transparent' }}>
              <Text variant="smallStrong" tone={urgency === u ? 'ink' : 'inkMuted'}>{u.charAt(0) + u.slice(1).toLowerCase()}</Text>
            </Pressable>
          ))}
        </View>
      </Field>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: consent }} accessibilityLabel="The client agreed to be contacted by a specialist" onPress={() => setConsent(!consent)} style={{ flexDirection: 'row', gap: space.md, alignItems: 'center', minHeight: touch }}>
        <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: consent ? c.primary : c.border, backgroundColor: consent ? c.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
          {consent ? <Check size={16} color={c.onPrimary} strokeWidth={3} /> : null}
        </View>
        <Text variant="small" style={{ flex: 1 }}>The client agreed to be contacted by a specialist</Text>
      </Pressable>

      {route ? (
        <Card tone="soft" style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
          <Route size={20} color={c.successInk} />
          <View style={{ flex: 1 }}>
            <Text variant="smallStrong" tone="successInk">Route to {route.queue}</Text>
            {route.fallback ? <Text variant="caption" tone="successInk">No routing rule matched; this goes to the default queue.</Text> : null}
          </View>
        </Card>
      ) : null}
      {error ? <ErrorState message={error} /> : null}
      <Button label={route ? `Route to ${route.queue}` : 'Send referral'} loading={busy} disabled={!ready || !online} onPress={submit} />
      <Text variant="caption" tone="inkSubtle" align="center">{online ? 'Creates a referral in Salesforce when you confirm.' : t.states.writesOffline}</Text>
    </Screen>
  );
}
