import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, FileText, Mic, Share2, Wallet } from 'lucide-react-native';
import { DOCUMENT_TYPE_LABEL, SPECIALTY_LABEL, formatMoney, formatShortDate, type AccountDetail } from '@sherpa/shared';
import { API } from '@/api/hooks';
import { HealthCard } from '@/features/health/HealthCard';
import { TalkingPointCard } from '@/features/insights/TalkingPointCard';
import { Text } from '@/components/Text';
import { Badge, Button, Card, EmptyState, ErrorState, FactGrid, IconButton, ListRow, LoadingCards, Screen, SectionLabel } from '@/components/ui';
import { t } from '@/i18n/en';
import { useFeature } from '@/store/session';
import { radius, space, touch, useColors } from '@/theme/tokens';

const TABS = ['Overview', 'Activity', 'Credit', 'Deposits', 'Referrals', 'Documents', 'Insights'] as const;
type Tab = (typeof TABS)[number];

function Section({ tab, d }: { tab: Tab; d: AccountDetail }) {
  const healthOn = useFeature('F13_HEALTH_SCORE');
  switch (tab) {
    case 'Overview':
      return (
        <>
          <Card padded={false} style={{ padding: space.sm }}><FactGrid facts={d.overview} /></Card>
          {d.upcomingMeeting ? (
            <Card padded={false}>
              <ListRow title={d.upcomingMeeting.subject} subtitle={`${formatShortDate(d.upcomingMeeting.start)} · brief ready`} onPress={() => router.push(`/brief/${d.upcomingMeeting!.id}`)} last />
            </Card>
          ) : null}
          <SectionLabel count={d.contacts.length}>Contacts</SectionLabel>
          <Card padded={false}>
            {d.contacts.map((ct, i) => (
              <ListRow key={ct.id} title={ct.name} subtitle={ct.title} meta={ct.isPrimary ? <View style={{ marginTop: 4 }}><Badge label="Primary" /></View> : undefined} last={i === d.contacts.length - 1} />
            ))}
          </Card>
          {d.alerts.length ? (
            <>
              <SectionLabel count={d.alerts.length}>Alerts</SectionLabel>
              <Card padded={false}>
                {d.alerts.map((a, i) => <ListRow key={a.id} accent={a.severity === 'CRITICAL' ? 'danger' : 'warn'} title={a.title} subtitle={a.suggestedAction} last={i === d.alerts.length - 1} />)}
              </Card>
            </>
          ) : null}
          {healthOn && d.health ? <HealthCard score={d.health} /> : null}
        </>
      );
    case 'Activity':
      return (
        <>
          <SectionLabel count={d.tasks.length}>Open tasks</SectionLabel>
          {d.tasks.length ? (
            <Card padded={false}>
              {d.tasks.map((tk, i) => <ListRow key={tk.id} accent={tk.clientCommitment ? 'commitment' : undefined} title={tk.subject} subtitle={`${tk.ownerName}${tk.dueDate ? ` · due ${formatShortDate(tk.dueDate)}` : ''}`} last={i === d.tasks.length - 1} />)}
            </Card>
          ) : <EmptyState title="No open tasks" />}
          <SectionLabel count={d.recentDebriefs.length}>Debriefs</SectionLabel>
          {d.recentDebriefs.length ? (
            <Card padded={false}>
              {d.recentDebriefs.map((x, i) => (
                <ListRow key={x.id} title={`${x.purpose} · ${formatShortDate(x.confirmedAt)}`} subtitle={x.summary} meta={x.complaint ? <View style={{ marginTop: 4 }}><Badge label="Complaint logged" tone="danger" /></View> : undefined} onPress={() => router.push(`/debrief/saved/${x.id}`)} last={i === d.recentDebriefs.length - 1} />
              ))}
            </Card>
          ) : <EmptyState title="No debriefs yet" />}
          <SectionLabel count={d.opportunities.length}>Open opportunities</SectionLabel>
          {d.opportunities.length ? (
            <Card padded={false}>
              {d.opportunities.map((o, i) => <ListRow key={o.id} title={o.name} subtitle={`${o.stage}${o.amount ? ` · ${formatMoney(o.amount)}` : ''}`} last={i === d.opportunities.length - 1} />)}
            </Card>
          ) : <EmptyState title="No open opportunities" />}
        </>
      );
    case 'Credit':
      return d.credit.length ? <Card padded={false} style={{ padding: space.sm }}><FactGrid facts={d.credit} /></Card> : <EmptyState title="No credit facilities" />;
    case 'Deposits':
      return d.deposits.length ? <Card padded={false} style={{ padding: space.sm }}><FactGrid facts={d.deposits} /></Card> : <ErrorState message="Deposit data is unavailable right now." />;
    case 'Referrals':
      return (
        <>
          {d.referrals.length ? (
            <Card padded={false}>
              {d.referrals.map((r, i) => (
                <ListRow key={r.id} title={SPECIALTY_LABEL[r.specialty]} subtitle={`${r.routedTo.queue} · ${formatShortDate(r.createdAt)}`} meta={<View style={{ marginTop: 4 }}><Badge label={r.status.replace('_', ' ').toLowerCase().replace(/^\w/, (m) => m.toUpperCase())} tone="primary" /></View>} last={i === d.referrals.length - 1} />
              ))}
            </Card>
          ) : <EmptyState title="No referrals yet" />}
          <Button tone="ghost" label="Refer to a specialist" onPress={() => router.push(`/referral/new?accountId=${d.account.id}`)} />
        </>
      );
    case 'Documents':
      return (
        <>
          {d.documents.length ? (
            <Card padded={false}>
              {d.documents.map((x, i) => <ListRow key={x.id} accent={x.daysOverdue ? 'danger' : undefined} title={`${DOCUMENT_TYPE_LABEL[x.type]}${x.period ? ` (${x.period})` : ''}`} subtitle={x.daysOverdue ? `${x.daysOverdue} days overdue` : `Due ${formatShortDate(x.dueDate)}`} last={i === d.documents.length - 1} />)}
            </Card>
          ) : <EmptyState title="Nothing outstanding" />}
          <Button tone="ghost" label="Chase documents" onPress={() => router.push(`/documents/${d.account.id}`)} />
        </>
      );
    case 'Insights':
      return (
        <>
          <Text variant="caption" tone="inkSubtle">{t.disclaimers.talkingPoints}</Text>
          {d.talkingPoints.length ? d.talkingPoints.map((tp) => <TalkingPointCard key={tp.id} tp={tp} />) : <EmptyState title="No suggestions right now" />}
          {healthOn && d.health ? <HealthCard score={d.health} /> : null}
        </>
      );
  }
}

export default function AccountScreen() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>('Overview');
  const q = useQuery({ queryKey: ['account', id], queryFn: () => API.account(id) });
  const dealOn = useFeature('F07_DEAL_INTAKE');
  const d = q.data;
  return (
    <Screen refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={c.primary} />}>
      <IconButton accessibilityLabel="Back" onPress={() => router.back()} tone="muted">
        <ArrowLeft size={20} color={c.ink} />
      </IconButton>
      {q.isLoading ? <LoadingCards /> : null}
      {q.isError ? <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} /> : null}
      {d ? (
        <>
          <View style={{ gap: 4 }}>
            <Text variant="display" accessibilityRole="header">{d.account.name}</Text>
            <Text variant="small" tone="inkMuted">{d.account.city}, {d.account.state} · {d.account.industry} · Tier {d.account.coverageTier}</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
            <Button small label="Brief" icon={<FileText size={16} color={c.onPrimary} />} onPress={() => router.push(d.upcomingMeeting ? `/brief/${d.upcomingMeeting.id}` : `/brief/account/${d.account.id}`)} />
            <Button small tone="secondary" label="Debrief" icon={<Mic size={16} color={c.ink} />} onPress={() => router.push(`/debrief/new?accountId=${d.account.id}`)} />
            {dealOn ? <Button small tone="secondary" label="New deal" icon={<Wallet size={16} color={c.ink} />} onPress={() => router.push(`/deal/new?accountId=${d.account.id}`)} /> : null}
            <Button small tone="secondary" label="Refer" icon={<Share2 size={16} color={c.ink} />} onPress={() => router.push(`/referral/new?accountId=${d.account.id}`)} />
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4 }} accessibilityRole="tablist">
            {TABS.map((x) => (
              <Pressable key={x} accessibilityRole="tab" accessibilityState={{ selected: tab === x }} accessibilityLabel={x} onPress={() => setTab(x)} style={{ minHeight: touch, paddingHorizontal: space.md, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: tab === x ? c.ink : 'transparent' }}>
                <Text variant="smallStrong" style={{ color: tab === x ? c.ground : c.inkMuted }}>{x}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Section tab={tab} d={d} />
        </>
      ) : null}
    </Screen>
  );
}
