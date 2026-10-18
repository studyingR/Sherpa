/**
 * F07 deal intake: chat (or voice) capture → review form with existing exposure → read-back required →
 * "Create draft in nCino" (draft for review, never submitted to credit).
 */
import type { ComponentRef } from 'react';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Mic, Send } from 'lucide-react-native';
import { DEAL_PRODUCT_LABEL, DealProduct, formatMoneyFull, type AgentMessage, type DealDraft } from '@sherpa/shared';
import { API, useOnline } from '@/api/hooks';
import { ApiError } from '@/api/client';
import { Text } from '@/components/Text';
import { toast } from '@/components/Toast';
import { ApprovalToggle, Badge, Button, Card, Chip, ErrorState, FactGrid, Field, IconButton, Row } from '@/components/ui';
import { t } from '@/i18n/en';
import { useFeature } from '@/store/session';
import { font, radius, size, space, useColors } from '@/theme/tokens';

const DEMO = 'They need a 2.5 million equipment loan to buy new CNC machines for the Newark expansion, five-year term, secured by the equipment, and they want to close by end of Q1. Jane Ruiz will guarantee.';

export default function NewDeal() {
  const c = useColors();
  const qc = useQueryClient();
  const online = useOnline();
  const pricingOn = useFeature('F12_PRICING_GUIDANCE');
  const { accountId, fromDebriefId } = useLocalSearchParams<{ accountId: string; fromDebriefId?: string }>();
  const [deal, setDeal] = useState<DealDraft | null>(null);
  const [msgs, setMsgs] = useState<AgentMessage[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [approveOpp, setApproveOpp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);

  useEffect(() => {
    API.startDeal(accountId, fromDebriefId).then((r) => {
      setDeal(r.draft);
      setMsgs([{ id: 'o', speaker: 'AGENT', text: r.opening, kind: 'TEXT', at: new Date().toISOString() }]);
    }).catch((e) => setError((e as Error).message));
  }, [accountId, fromDebriefId]);

  async function send(body: string) {
    if (!deal || !body.trim()) return;
    setText('');
    setBusy(true);
    try {
      const r = await API.dealChat(deal.id, body.trim());
      setMsgs((m) => [...m, ...r.messages]);
      setDeal(r.draft);
      if (r.writeResult) toast(r.writeResult.written.map((w) => w.label).join(' · '));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That did not send.');
    } finally {
      setBusy(false);
    }
  }

  async function patch(p: Parameters<typeof API.patchDeal>[1]) {
    if (!deal) return;
    setDeal(await API.patchDeal(deal.id, p));
  }

  async function create() {
    if (!deal) return;
    setBusy(true);
    setError(null);
    try {
      const intent = await API.dealIntent(deal.id);
      const r = await API.confirmIntent({ intentId: intent.id, channel: 'tap', approvals: { 'opp:deal': approveOpp } });
      toast(r.written.map((w) => w.label).join(' · '));
      setDeal(await API.deal(deal.id));
      qc.invalidateQueries({ queryKey: ['account'] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The draft was not created.');
    } finally {
      setBusy(false);
    }
  }

  const lastAgent = [...msgs].reverse().find((m) => m.speaker === 'AGENT')?.text ?? '';
  const suggestions = !deal ? [] : deal.awaitingReadBack ? ['Yes, that is right.'] : deal.readBackDone && deal.status !== 'DRAFT_CREATED' ? ['Create draft'] : msgs.length === 1 ? [DEMO] : /\?$/.test(lastAgent) ? ['Skip'] : [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.ground }} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Row style={{ paddingHorizontal: space.lg, paddingVertical: space.sm }} gap={space.md}>
          <IconButton accessibilityLabel="Back" onPress={() => router.back()} tone="muted">
            <ArrowLeft size={20} color={c.ink} />
          </IconButton>
          <View style={{ flex: 1 }}>
            <Text variant="heading" numberOfLines={1}>New deal · {deal?.accountName ?? ''}</Text>
            <Text variant="caption" tone="inkSubtle">{t.disclaimers.deal}</Text>
          </View>
          {deal ? (
            <IconButton accessibilityLabel="Talk instead" tone="muted" onPress={() => router.push(`/voice?mode=DEAL&draftId=${deal.id}`)}>
              <Mic size={18} color={c.ink} />
            </IconButton>
          ) : null}
        </Row>
        <ScrollView ref={scroll} contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {msgs.map((m) => (
            <View key={m.id} style={{ alignSelf: m.speaker === 'AGENT' ? 'flex-start' : 'flex-end', maxWidth: '88%', backgroundColor: m.speaker === 'AGENT' ? c.surface : c.primary, borderColor: c.border, borderWidth: m.speaker === 'AGENT' ? 1 : 0, borderRadius: radius.lg, padding: space.md }}>
              <Text variant="small" style={{ color: m.speaker === 'AGENT' ? c.ink : c.onPrimary }}>{m.text}</Text>
            </View>
          ))}
          {suggestions.map((s) => (
            <Pressable key={s} onPress={() => send(s)} accessibilityRole="button" accessibilityLabel={`Send: ${s}`} style={{ alignSelf: 'flex-end', backgroundColor: c.surfaceMuted, borderRadius: radius.md, padding: space.md, maxWidth: '88%' }}>
              <Text variant="caption">{s}</Text>
            </Pressable>
          ))}

          {deal ? (
            <Card style={{ gap: space.md }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text variant="bodyStrong">Request</Text>
                {deal.status === 'DRAFT_CREATED' ? <Badge label="Draft in nCino" tone="success" /> : deal.readBackDone ? <Badge label="Read back" tone="primary" /> : <Badge label="Read-back required" tone="warn" />}
              </Row>
              <Field label="Product">
                <Row style={{ flexWrap: 'wrap' }} gap={space.sm}>
                  {DealProduct.options.map((p) => <Chip key={p} label={DEAL_PRODUCT_LABEL[p]} selected={deal.product === p} onPress={() => patch({ product: p })} />)}
                </Row>
              </Field>
              {[
                ['Amount', deal.amount ? formatMoneyFull(deal.amount) : '', 'amount'],
                ['Term', deal.termMonths ? `${deal.termMonths} months` : '', 'termMonths'],
                ['Amortization', deal.amortizationMonths ? `${deal.amortizationMonths} months` : '', 'amortizationMonths'],
                ['Collateral', deal.collateral, 'collateral'],
                ['Purpose', deal.purpose, 'purpose'],
                ['Timing', deal.requestedTiming, 'requestedTiming'],
                ['Guarantors', deal.guarantors.join(', '), 'guarantors'],
              ].map(([label, value, key]) => (
                <Row key={key} style={{ justifyContent: 'space-between' }} align="flex-start">
                  <Text variant="small" tone="inkMuted" style={{ width: 110 }}>{label}</Text>
                  <Text variant="smallStrong" style={{ flex: 1, color: value ? c.ink : c.danger }}>{value || (deal.missingFields.includes(key) ? 'Needed' : '—')}</Text>
                </Row>
              ))}
              <Text variant="label" tone="inkSubtle">Existing exposure</Text>
              <FactGrid facts={deal.existingExposure} />
              {!deal.opportunityId && deal.status !== 'DRAFT_CREATED' ? <ApprovalToggle approved={approveOpp} onChange={setApproveOpp} label="Also create a Salesforce opportunity" /> : null}
              {pricingOn && deal.amount && deal.product ? <Button tone="secondary" small label="Pricing guidance (internal)" onPress={() => router.push(`/pricing/${deal.id}`)} /> : null}
              {error ? <ErrorState message={error} /> : null}
              {deal.status !== 'DRAFT_CREATED' ? (
                <>
                  <Button label="Create draft in nCino" loading={busy} disabled={!deal.readBackDone || deal.missingFields.length > 0 || !online} onPress={create} />
                  <Text variant="caption" tone="inkSubtle" align="center">{!deal.readBackDone ? 'Sherpa reads back the amount, term and collateral first.' : t.disclaimers.deal}</Text>
                </>
              ) : (
                <Text variant="smallStrong" tone="successInk">Draft {deal.ncinoDraftId} created for your review · not submitted to credit</Text>
              )}
            </Card>
          ) : null}
        </ScrollView>
        <Row style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }} gap={space.sm}>
          <TextInput value={text} onChangeText={setText} onSubmitEditing={() => send(text)} placeholder="Describe the request" placeholderTextColor={c.inkSubtle} accessibilityLabel="Describe the deal" style={{ flex: 1, minHeight: 48, backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, fontFamily: font.body, fontSize: size.lg, color: c.ink }} />
          <Pressable onPress={() => send(text)} disabled={busy} accessibilityRole="button" accessibilityLabel="Send" style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
            <Send size={20} color={c.onPrimary} />
          </Pressable>
        </Row>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
