import { useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Bell, Mic, Play } from 'lucide-react-native';
import { daysBetween, formatLongDate, formatShortDate, formatTime, parseDate, toIsoDate, DOCUMENT_TYPE_LABEL, type Task, type TodayView } from '@sherpa/shared';
import { API, type Offline } from '@/api/hooks';
import { Contours } from '@/components/Contours';
import { Text } from '@/components/Text';
import { Badge, Button, Card, EmptyState, ErrorState, IconButton, ListRow, LoadingCards, Row, Screen, SectionLabel } from '@/components/ui';
import { TaskActionSheet } from '@/features/tasks/TaskActionSheet';
import { t } from '@/i18n/en';
import { space, useColors } from '@/theme/tokens';
import { useFeature } from '@/store/session';

function dueLabel(task: Task, todayIso: string): { label: string; tone: 'danger' | 'warn' | 'neutral' } {
  if (!task.dueDate) return { label: 'No date', tone: 'neutral' };
  if (task.dueDate === todayIso) return { label: t.badges.dueToday, tone: 'warn' };
  const d = daysBetween(parseDate(task.dueDate), parseDate(todayIso));
  if (d > 0) return { label: `${d} day${d > 1 ? 's' : ''} late`, tone: 'danger' };
  return { label: `Due ${formatShortDate(task.dueDate)}`, tone: 'neutral' };
}

function PendingDebriefCard({ p }: { p: TodayView['pendingDebriefs'][number] }) {
  const c = useColors();
  return (
    <Card tone="dark" style={{ gap: space.md, minHeight: 200 }}>
      <View style={{ position: 'absolute', right: -70, top: -60 }}>
        <Contours size={300} color={c.callAccent} opacity={0.35} seed={0.7} />
      </View>
      <Text variant="label" tone="callInkMuted">{t.today.pendingDebrief}</Text>
      <View style={{ gap: 2 }}>
        <Text variant="title" tone="callInk">{p.accountName}</Text>
        <Text variant="small" tone="callInkMuted">{formatTime(p.start)} · {p.attendees.join(', ')}</Text>
      </View>
      <Row gap={space.sm} style={{ marginTop: space.xs }}>
        <Button
          label={p.resumeDraftId ? 'Resume debrief' : t.today.callToDebrief}
          icon={<Mic size={18} color={c.onPrimary} />}
          onPress={() => router.push(p.resumeDraftId ? `/debrief/${p.resumeDraftId}` : `/debrief/new?meetingId=${p.meetingId}`)}
          style={{ flex: 1 }}
        />
        <Button tone="onDark" small label={t.today.typeInstead} onPress={() => router.push(p.resumeDraftId ? `/debrief/${p.resumeDraftId}?mode=chat` : `/debrief/new?meetingId=${p.meetingId}&mode=chat`)} />
      </Row>
    </Card>
  );
}

export default function Today() {
  const c = useColors();
  const q = useQuery({ queryKey: ['today'], queryFn: API.today });
  const [taskSheet, setTaskSheet] = useState<Task | null>(null);
  const coverageOn = useFeature('F10_COVERAGE');
  const v = q.data as Offline<TodayView> | undefined;
  const todayIso = v?.date ?? toIsoDate(new Date());

  return (
    <Screen refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={c.primary} />}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="caption" tone="inkSubtle">{v ? formatLongDate(v.date) : ' '}</Text>
          <Text variant="display" accessibilityRole="header">{v?.greeting ?? 'Today'}</Text>
        </View>
        <IconButton accessibilityLabel="Notifications" onPress={() => router.push('/notifications')} tone="muted">
          <Bell size={20} color={c.ink} />
        </IconButton>
      </Row>

      {v?.__offline ? <ErrorState message={t.states.offline} /> : null}
      {q.isLoading ? <LoadingCards /> : null}
      {q.isError && !v ? <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} /> : null}

      {v ? (
        <>
          <Button tone="ghost" small label={t.today.playAgenda} icon={<Play size={16} color={c.primary} />} onPress={() => router.push('/voice?mode=AGENDA')} style={{ alignSelf: 'flex-start' }} />

          {v.pendingDebriefs.map((p) => <PendingDebriefCard key={p.meetingId} p={p} />)}

          {v.commitmentsDue.length ? (
            <View style={{ gap: space.sm }}>
              <SectionLabel count={v.commitmentsDue.length}>{t.today.commitments}</SectionLabel>
              <Card padded={false}>
                {v.commitmentsDue.map((task, i) => {
                  const due = dueLabel(task, todayIso);
                  return (
                    <ListRow
                      key={task.id}
                      accent="commitment"
                      title={task.subject}
                      subtitle={task.accountName ?? undefined}
                      meta={<Row style={{ marginTop: 6 }}><Badge label={t.badges.commitment} tone="commitment" /><Badge label={due.label} tone={due.tone} /></Row>}
                      onPress={() => setTaskSheet(task)}
                      last={i === v.commitmentsDue.length - 1}
                    />
                  );
                })}
              </Card>
            </View>
          ) : null}

          <View style={{ gap: space.sm }}>
            <SectionLabel count={v.meetings.length}>{t.today.meetings}</SectionLabel>
            {v.meetings.length ? (
              <Card padded={false}>
                {v.meetings.map((m, i) => {
                  const past = m.ended;
                  const badge = m.debriefed ? <Badge label={t.badges.done} tone="success" /> : m.briefStatus === 'READY' && !past ? <Badge label={t.badges.briefReady} tone="primary" /> : m.briefStatus === 'INTERNAL' ? <Badge label={t.badges.internal} /> : null;
                  return (
                    <ListRow
                      key={m.id}
                      title={m.accountName ?? m.subject}
                      subtitle={`${formatTime(m.start)} · ${m.accountName ? m.subject : m.location ?? ''}`}
                      meta={badge ? <View style={{ marginTop: 6 }}>{badge}</View> : undefined}
                      onPress={m.accountId && m.briefStatus === 'READY' ? () => router.push(`/brief/${m.id}`) : undefined}
                      accessibilityLabel={`${m.accountName ?? m.subject} at ${formatTime(m.start)}. Open brief.`}
                      last={i === v.meetings.length - 1}
                    />
                  );
                })}
              </Card>
            ) : (
              <EmptyState title="No meetings today" />
            )}
          </View>

          {v.overdueTasks.length ? (
            <View style={{ gap: space.sm }}>
              <SectionLabel count={v.overdueTasks.length}>{t.today.overdue}</SectionLabel>
              <Card padded={false}>
                {v.overdueTasks.map((task, i) => (
                  <ListRow key={task.id} title={task.subject} subtitle={`${task.accountName ?? ''} · ${task.ownerName}`} meta={<View style={{ marginTop: 6 }}><Badge {...dueLabel(task, todayIso)} /></View>} onPress={() => setTaskSheet(task)} last={i === v.overdueTasks.length - 1} />
                ))}
              </Card>
            </View>
          ) : null}

          {v.alerts.length ? (
            <View style={{ gap: space.sm }}>
              <SectionLabel count={v.alerts.length} action={{ label: 'All alerts', onPress: () => router.push('/alerts') }}>{t.today.alerts}</SectionLabel>
              <Card padded={false}>
                {v.alerts.slice(0, 4).map((a, i, arr) => (
                  <ListRow key={a.id} accent={a.severity === 'CRITICAL' ? 'danger' : 'warn'} title={a.accountName} subtitle={a.title} onPress={() => router.push(`/alerts?focus=${a.id}`)} last={i === arr.length - 1} />
                ))}
              </Card>
            </View>
          ) : null}

          {v.documentsDue.length ? (
            <View style={{ gap: space.sm }}>
              <SectionLabel count={v.documentsDue.length}>{t.today.documents}</SectionLabel>
              <Card padded={false}>
                {v.documentsDue.slice(0, 4).map((d, i, arr) => (
                  <ListRow key={d.id} title={`${d.accountName}: ${DOCUMENT_TYPE_LABEL[d.type]}${d.period ? ` (${d.period})` : ''}`} subtitle={d.daysOverdue ? `${d.daysOverdue} days overdue` : `Due ${formatShortDate(d.dueDate)}`} accent={d.daysOverdue ? 'danger' : undefined} onPress={() => router.push(`/documents/${d.accountId}`)} last={i === arr.length - 1} />
                ))}
              </Card>
            </View>
          ) : null}

          {coverageOn && v.coverageSuggestions.length ? (
            <View style={{ gap: space.sm }}>
              <SectionLabel action={{ label: t.today.seePlan, onPress: () => router.push('/coverage') }}>{t.today.coverage}</SectionLabel>
              <Card padded={false}>
                {v.coverageSuggestions.map((cv, i, arr) => (
                  <ListRow key={cv.accountId} title={cv.accountName} subtitle={cv.reasons.join(' · ')} onPress={() => router.push(`/accounts/${cv.accountId}`)} last={i === arr.length - 1} />
                ))}
              </Card>
            </View>
          ) : null}

          {v.atRisk?.length ? (
            <View style={{ gap: space.sm }}>
              <SectionLabel>{t.today.atRisk}</SectionLabel>
              <Card padded={false}>
                {v.atRisk.map((h, i, arr) => (
                  <ListRow key={h.accountId} title={h.accountName} subtitle={`Health ${h.score} · ${h.drivers[0]?.factor ?? ''}`} accent="danger" onPress={() => router.push(`/accounts/${h.accountId}`)} last={i === arr.length - 1} />
                ))}
              </Card>
            </View>
          ) : null}

          {!v.pendingDebriefs.length && !v.commitmentsDue.length && !v.alerts.length && !v.overdueTasks.length ? <EmptyState title={t.today.nothing} /> : null}
        </>
      ) : null}

      <TaskActionSheet task={taskSheet} onClose={() => setTaskSheet(null)} />
    </Screen>
  );
}
