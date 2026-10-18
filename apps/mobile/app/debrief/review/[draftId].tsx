/** F01 review card: edit, include/exclude, approve; nothing is written until the RM confirms. */
import { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarClock } from 'lucide-react-native';
import { PURPOSE_LABEL, SPECIALTY_LABEL, Specialty, addDays, formatDayDate, formatMoneyFull, formatShortDate, toIsoDate, type DebriefDraft, type DebriefDraftPatch, type NextStep } from '@sherpa/shared';
import { API, useOnline } from '@/api/hooks';
import { ApiError } from '@/api/client';
import { Sheet } from '@/components/Sheet';
import { Text } from '@/components/Text';
import { ApprovalToggle, Badge, Button, Card, CheckRow, Chip, ErrorState, FlagBanner, IconButton, LoadingCards, Row, Screen, SectionLabel, inputStyle } from '@/components/ui';
import { t } from '@/i18n/en';
import { space, useColors } from '@/theme/tokens';

export default function Review() {
  const c = useColors();
  const qc = useQueryClient();
  const online = useOnline();
  const { draftId } = useLocalSearchParams<{ draftId: string }>();
  const [draft, setDraft] = useState<DebriefDraft | null>(null);
  const [summary, setSummary] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editStep, setEditStep] = useState<NextStep | null>(null);

  useEffect(() => {
    API.draft(draftId).then((d) => {
      setDraft(d);
      setSummary(d.summary);
    }).catch((e) => setError((e as Error).message));
  }, [draftId]);

  async function patch(p: DebriefDraftPatch) {
    // Optimistic for approvals so the toggle responds instantly.
    if (p.opportunities) setDraft((d) => (d ? { ...d, opportunities: d.opportunities.map((o) => ({ ...o, ...(p.opportunities!.find((x) => x.id === o.id) ?? {}) })) } : d));
    try {
      const d = await API.patchDraft(draftId, p);
      setDraft(d);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That change did not save.');
    }
  }

  async function confirm() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      if (summary !== draft.summary) await API.patchDraft(draftId, { summary });
      // Approvals come from the server's copy so a toggle still in flight can't be lost.
      const latest = await API.draft(draftId);
      const intent = await API.debriefIntent(draftId);
      const approvals = Object.fromEntries([
        ...latest.opportunities.map((o) => [`opp:${o.id}`, o.approved]),
        ...latest.contactUpdates.map((cu) => [`contact:${cu.name}`, cu.approved]),
      ]);
      const r = await API.confirmDebrief({ intentId: intent.id, channel: 'tap', approvals });
      await Promise.all(['today', 'account', 'tasks'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      router.dismissAll();
      router.push(`/debrief/saved/${r.debriefId}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Salesforce isn't responding. Your draft is saved.");
    } finally {
      setSaving(false);
    }
  }

  if (!draft) return <Screen>{error ? <ErrorState message={error} /> : <LoadingCards />}</Screen>;
  const complaint = draft.flags.complaint;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.ground }} edges={['top']}>
      <Screen edges={[]}>
        <Row gap={space.md}>
          <IconButton accessibilityLabel="Back" onPress={() => router.back()} tone="muted">
            <ArrowLeft size={20} color={c.ink} />
          </IconButton>
          <View style={{ flex: 1 }}>
            <Text variant="caption" tone="inkSubtle">{PURPOSE_LABEL[draft.purpose]}{draft.meetingStart ? ` · ${formatShortDate(draft.meetingStart)}` : ''}</Text>
            <Text variant="title" accessibilityRole="header">{draft.accountName}</Text>
          </View>
        </Row>

        {complaint.flagged ? <FlagBanner locked title="Logged as a complaint, per policy" body={`${complaint.summary ?? ''} A complaint case will be routed when you save. This flag can't be removed.`} /> : null}
        {draft.flags.mnpi.flagged ? <FlagBanner tone="warn" title="Possible inside information" body="Flagged for compliance review. It won't appear in any email." /> : null}
        {draft.flags.sensitive.flagged ? (
          <Card tone="warn" style={{ gap: space.sm }}>
            <Text variant="smallStrong" tone="warnInk">Personal detail left out ({(draft.flags.sensitive.categories ?? []).join(', ')})</Text>
            <Text variant="small" tone="warnInk">Keep it only if it belongs in the record. Kept details go to compliance for review.</Text>
            <Chip label="Keep it in the record" selected={Boolean(draft.flags.sensitive.kept)} onPress={() => patch({ flags: { sensitive: { kept: !draft.flags.sensitive.kept } } })} />
          </Card>
        ) : null}

        <SectionLabel>Summary</SectionLabel>
        <TextInput value={summary} onChangeText={setSummary} onBlur={() => summary !== draft.summary && patch({ summary })} multiline accessibilityLabel="Summary" style={[inputStyle(c), { minHeight: 120, textAlignVertical: 'top' }]} />

        <SectionLabel count={draft.nextSteps.filter((s) => s.include).length}>Next steps → Salesforce tasks</SectionLabel>
        <Card style={{ paddingVertical: space.xs }}>
          {draft.nextSteps.length ? draft.nextSteps.map((s) => (
            <CheckRow
              key={s.id}
              checked={s.include}
              onToggle={() => patch({ nextSteps: [{ id: s.id, include: !s.include }] })}
              title={s.title}
              subtitle={`${s.ownerName || 'No owner'} · ${s.dueDate ? formatDayDate(s.dueDate) : 'No date'}`}
              badge={
                <Row style={{ marginTop: 4 }}>
                  {s.clientCommitment ? <Badge label={t.badges.commitment} tone="commitment" /> : null}
                  {s.suggested ? <Badge label="Suggested by Sherpa" /> : null}
                  <Button small tone="ghost" label="Edit" icon={<CalendarClock size={14} color={c.primary} />} onPress={() => setEditStep(s)} />
                </Row>
              }
            />
          )) : <Text variant="small" tone="inkMuted" style={{ paddingVertical: space.md }}>{draft.noNextSteps ? 'No next steps.' : 'No next steps captured.'}</Text>}
        </Card>

        {draft.opportunities.map((o) => (
          <Card key={o.id} style={{ gap: space.md }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text variant="label" tone="inkSubtle">{o.isNew ? 'New opportunity' : 'Opportunity update'}</Text>
              {!o.approved ? <Badge label={t.badges.needsOk} tone="warn" /> : null}
            </Row>
            <Text variant="heading">{o.product}</Text>
            <Text variant="small" tone="inkMuted">{o.amount ? formatMoneyFull(o.amount) : 'Amount not set'} · {o.closeQuarter ? `closing ${o.closeQuarter}` : 'no timing'} · Prospecting</Text>
            <ApprovalToggle approved={o.approved} onChange={(v) => patch({ opportunities: [{ id: o.id, approved: v }] })} label={`Approve creating this opportunity`} />
          </Card>
        ))}

        <SectionLabel>Specialist interest</SectionLabel>
        <Row style={{ flexWrap: 'wrap' }} gap={space.sm}>
          {Specialty.options.map((sp) => (
            <Chip key={sp} label={SPECIALTY_LABEL[sp]} selected={draft.specialistInterest.includes(sp)} onPress={() => patch({ specialistInterest: draft.specialistInterest.includes(sp) ? draft.specialistInterest.filter((x) => x !== sp) : [...draft.specialistInterest, sp] })} />
          ))}
        </Row>

        {draft.contactUpdates.length ? (
          <>
            <SectionLabel>Contact updates</SectionLabel>
            {draft.contactUpdates.map((cu) => (
              <ApprovalToggle key={cu.name} approved={cu.approved} onChange={(v) => patch({ contactUpdates: [{ name: cu.name, approved: v }] })} label={`Update ${cu.name}${cu.title ? ` to ${cu.title}` : ''}`} />
            ))}
          </>
        ) : null}

        {draft.missingFields.length ? <Text variant="caption" tone="inkSubtle">Still open: {draft.missingFields.join('; ')}</Text> : null}
        {error ? <ErrorState message={error} /> : null}
        <View style={{ height: 120 }} />
      </Screen>

      {/* sticky footer */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: c.surface, borderTopColor: c.border, borderTopWidth: 1, padding: space.lg, paddingBottom: space.xxl, gap: space.sm }}>
        <Button label={t.debrief.confirmCta} loading={saving} disabled={!online} onPress={confirm} />
        <Text variant="caption" tone="inkSubtle" align="center">{online ? t.debrief.nothingWritten : t.states.writesOffline}</Text>
      </View>

      <Sheet visible={Boolean(editStep)} onClose={() => setEditStep(null)} title="Edit next step">
        {editStep ? (
          <>
            <Text variant="bodyStrong">{editStep.title}</Text>
            <Text variant="label" tone="inkSubtle">Owner</Text>
            <Row style={{ flexWrap: 'wrap' }} gap={space.sm}>
              {['Maya Chen', 'Priya Shah', 'Treasury Services', 'Credit Admin', 'Portfolio Management'].map((o) => (
                <Chip key={o} label={o} selected={editStep.ownerName === o} onPress={async () => { await patch({ nextSteps: [{ id: editStep.id, ownerName: o }] }); setEditStep((s) => (s ? { ...s, ownerName: o } : s)); }} />
              ))}
            </Row>
            <Text variant="label" tone="inkSubtle">Due</Text>
            <Row style={{ flexWrap: 'wrap' }} gap={space.sm}>
              {[1, 2, 3, 5, 7, 14].map((n) => {
                const iso = toIsoDate(addDays(new Date(), n));
                return <Chip key={n} label={formatDayDate(iso)} selected={editStep.dueDate === iso} onPress={async () => { await patch({ nextSteps: [{ id: editStep.id, dueDate: iso }] }); setEditStep(null); }} />;
              })}
            </Row>
          </>
        ) : null}
      </Sheet>
    </SafeAreaView>
  );
}
