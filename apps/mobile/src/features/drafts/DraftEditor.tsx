/** Editable follow-up draft with guard banner; saves to Outlook drafts only (never sends, C-07). */
import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Mail, ShieldCheck, TriangleAlert } from 'lucide-react-native';
import type { FollowUpDraft, Recipient } from '@sherpa/shared';
import { API, useOnline } from '@/api/hooks';
import { ApiError } from '@/api/client';
import { Sheet } from '@/components/Sheet';
import { Text } from '@/components/Text';
import { toast } from '@/components/Toast';
import { Button, Card, Chip, ErrorState, Field, Row, inputStyle } from '@/components/ui';
import { t } from '@/i18n/en';
import { radius, space, useColors } from '@/theme/tokens';

export function GuardBanner({ d }: { d: FollowUpDraft }) {
  const c = useColors();
  const ok = d.guardResult.passed;
  return (
    <View accessibilityRole="summary" style={{ backgroundColor: ok ? c.primarySoft : c.warnBg, borderRadius: radius.md, padding: space.md, gap: space.xs }}>
      <Row>
        {ok ? <ShieldCheck size={18} color={c.successInk} /> : <TriangleAlert size={18} color={c.warnInk} />}
        <Text variant="smallStrong" style={{ color: ok ? c.successInk : c.warnInk, flex: 1 }}>{d.guardResult.message}</Text>
      </Row>
      {d.guardResult.removed.map((r, i) => (
        <Text key={i} variant="caption" tone="warnInk">Removed ({r.reason}): "{r.phrase}"</Text>
      ))}
    </View>
  );
}

export function DraftEditor({ draft, onChange }: { draft: FollowUpDraft; onChange: (d: FollowUpDraft) => void }) {
  const c = useColors();
  const qc = useQueryClient();
  const online = useOnline();
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<'to' | 'cc' | null>(null);
  const [options, setOptions] = useState<Recipient[]>([]);
  const saved = draft.status === 'SAVED_TO_MAILBOX';

  async function persist(): Promise<FollowUpDraft> {
    if (subject === draft.subject && body === draft.body) return draft;
    const d = await API.patchFollowUp(draft.id, { subject, body });
    onChange(d);
    setBody(d.body);
    return d;
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await persist();
      const intent = await API.draftIntent(draft.id);
      const r = await API.saveToMailbox(draft.id, { intentId: intent.id, channel: 'tap', approvals: {} });
      onChange({ ...draft, subject, body, status: 'SAVED_TO_MAILBOX', mailDraftId: r.mailDraftId });
      toast('In your Outlook drafts · not sent');
      qc.invalidateQueries({ queryKey: ['drafts'] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Outlook is not responding. Your draft is kept here.');
    } finally {
      setBusy(false);
    }
  }

  async function openPicker(which: 'to' | 'cc') {
    setPicker(which);
    setOptions(await API.draftRecipients(draft.id).catch(() => []));
  }
  async function toggleRecipient(r: Recipient) {
    const list = picker === 'to' ? draft.to : draft.cc;
    const next = list.some((x) => x.email === r.email) ? list.filter((x) => x.email !== r.email) : [...list, r];
    const d = await API.patchFollowUp(draft.id, picker === 'to' ? { to: next.map((x) => x.email) } : { cc: next.map((x) => x.email) });
    onChange(d);
  }

  return (
    <View style={{ gap: space.md }}>
      {draft.team ? <Text variant="label" tone="inkSubtle">To {draft.team}</Text> : null}
      <GuardBanner d={draft} />
      <Field label="To">
        <Row style={{ flexWrap: 'wrap' }} gap={space.sm}>
          {draft.to.map((r) => <Chip key={r.email} label={r.name} selected onPress={() => !saved && openPicker('to')} />)}
          {!saved ? <Button small tone="ghost" label="Change" onPress={() => openPicker('to')} /> : null}
        </Row>
      </Field>
      <Field label="Cc">
        <Row style={{ flexWrap: 'wrap' }} gap={space.sm}>
          {draft.cc.map((r) => <Chip key={r.email} label={r.name} selected onPress={() => !saved && openPicker('cc')} />)}
          {!saved ? <Button small tone="ghost" label="Add" onPress={() => openPicker('cc')} /> : null}
        </Row>
      </Field>
      <Field label="Subject">
        <TextInput value={subject} onChangeText={setSubject} editable={!saved} accessibilityLabel="Subject" style={inputStyle(c)} />
      </Field>
      <Field label="Message" hint="Edits are checked again before saving.">
        <TextInput value={body} onChangeText={setBody} onBlur={() => !saved && persist().catch(() => undefined)} editable={!saved} multiline accessibilityLabel="Message body" style={[inputStyle(c), { minHeight: 260, textAlignVertical: 'top', lineHeight: 22 }]} />
      </Field>
      {error ? <ErrorState message={error} /> : null}
      {saved ? (
        <Card tone="soft" style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
          <CheckCircle2 size={20} color={c.successInk} />
          <Text variant="smallStrong" tone="successInk">In your Outlook drafts · not sent</Text>
        </Card>
      ) : (
        <>
          <Button label="Save to Outlook drafts" icon={<Mail size={18} color={c.onPrimary} />} loading={busy} disabled={!online} onPress={save} />
          <Text variant="caption" tone="inkSubtle" align="center">{online ? 'Sherpa never sends email. You send it from Outlook.' : t.states.writesOffline}</Text>
        </>
      )}

      <Sheet visible={Boolean(picker)} onClose={() => setPicker(null)} title={picker === 'to' ? 'Recipients' : 'Cc'}>
        <Text variant="caption" tone="inkSubtle">Only Salesforce contacts for this account and bank colleagues.</Text>
        {options.map((r) => {
          const on = (picker === 'to' ? draft.to : draft.cc).some((x) => x.email === r.email);
          return <Chip key={r.email} label={`${r.name}${r.contactId ? ' · client' : ''}`} selected={on} onPress={() => toggleRecipient(r)} />;
        })}
      </Sheet>
    </View>
  );
}
