/** F04 — Today view and spoken agenda. Commitments due today sort to the top (F04-AC3). */
import {
  addDays,
  firstName,
  formatTime,
  toIsoDate,
  type PendingDebrief,
  type Task,
  type TodayMeeting,
  type TodayView,
} from '@sherpa/shared';
import type { UserContext } from '../auth/entitlements';
import type { Deps } from '../deps';
import type { AlertService } from './alerts';
import type { CoverageService, DocumentService, HealthService } from './insights';

export const MAX_AGENDA_WORDS = 150; // ≈ 60 s (F04-FR5)

export function createTodayService(d: Deps, alerts: AlertService, docs: DocumentService, coverage: CoverageService, health: HealthService) {
  const { adapters, db, clock, flags } = d;

  async function view(ctx: UserContext): Promise<TodayView> {
    const now = clock.now();
    const today = clock.today();
    const hour = now.getHours();
    const greeting = `Good ${hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}, ${firstName(ctx.user.name)}`;
    const base = { greeting, date: toIsoDate(today) };
    if (!ctx.bookRmIds.length) {
      return { ...base, pendingDebriefs: [], meetings: [], commitmentsDue: [], overdueTasks: [], alerts: [], documentsDue: [], coverageSuggestions: [] };
    }

    const meetingsRaw = await adapters.calendar.listMeetings(ctx, { from: today, to: addDays(today, 1), ownerRmIds: ctx.bookRmIds });
    const accounts = await adapters.salesforce.listAccounts(ctx, { ownerRmIds: ctx.bookRmIds });
    const names = Object.fromEntries(accounts.map((a) => [a.id, a.name]));
    const drafts = await db.debriefDraft.findMany({ where: { userId: ctx.rmId, status: { in: ['CAPTURING', 'REVIEW'] } }, orderBy: { updatedAt: 'desc' } });

    const meetings: TodayMeeting[] = [];
    const pendingDebriefs: PendingDebrief[] = [];
    for (const m of meetingsRaw) {
      const full = await adapters.calendar.getMeeting(ctx, m.id);
      const external = m.attendees.some((a) => a.external);
      const ended = new Date(m.end) <= now;
      const debriefed = Boolean(full?.debriefId);
      meetings.push({
        ...m,
        accountName: m.accountId ? names[m.accountId] ?? null : null,
        briefStatus: external && m.accountId && flags.isActive('F02_BRIEF') ? 'READY' : external ? 'NOT_READY' : 'INTERNAL',
        ended,
        debriefed,
      });
      if (ended && external && !debriefed && m.accountId && flags.isActive('F01_DEBRIEF')) {
        pendingDebriefs.push({
          meetingId: m.id, accountId: m.accountId, accountName: names[m.accountId] ?? '', subject: m.subject, start: m.start, end: m.end,
          attendees: m.attendees.filter((a) => a.external).map((a) => a.name),
          resumeDraftId: drafts.find((x) => x.meetingId === m.id)?.id ?? null,
        });
      }
    }

    const tasks = await adapters.salesforce.getTasks(ctx, { bookRmIds: ctx.bookRmIds, status: 'OPEN' });
    const todayIso = toIsoDate(today);
    const horizon = toIsoDate(addDays(today, 3));
    const byDue = (a: Task, b: Task) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999');
    // Due today first, then overdue, then the next 3 days.
    const commitmentsDue = tasks
      .filter((t) => t.clientCommitment && t.dueDate && t.dueDate <= horizon)
      .sort((a, b) => Number(b.dueDate === todayIso) - Number(a.dueDate === todayIso) || byDue(a, b));
    const overdueTasks = tasks.filter((t) => !t.clientCommitment && t.dueDate && t.dueDate < todayIso).sort(byDue);

    const [alertList, documentsDue, cov, atRisk] = await Promise.all([
      flags.isActive('F06_WATCHLIST') ? alerts.list(ctx, { status: 'open' }) : Promise.resolve([]),
      flags.isActive('F08_DOC_CHASE') ? docs.dueSoon(ctx) : Promise.resolve([]),
      flags.isActive('F10_COVERAGE') ? coverage.plan(ctx) : Promise.resolve(null),
      flags.isActive('F13_HEALTH_SCORE') ? health.list(ctx, 'AT_RISK').catch(() => []) : Promise.resolve(undefined),
    ]);

    return {
      ...base,
      pendingDebriefs,
      meetings,
      commitmentsDue,
      overdueTasks,
      alerts: alertList.filter((a) => a.severity !== 'INFO'),
      documentsDue,
      coverageSuggestions: cov ? cov.plan.items.filter((i) => i.planStatus === 'SUGGESTED').slice(0, 3) : [],
      ...(atRisk ? { atRisk } : {}),
    };
  }

  function spokenAgenda(v: TodayView, now: Date): string {
    const parts: string[] = [`${v.greeting}.`];
    const upcoming = v.meetings.filter((m) => new Date(m.start) > now && m.briefStatus !== 'INTERNAL');
    if (upcoming.length) parts.push(`You have ${upcoming.length} client meeting${upcoming.length > 1 ? 's' : ''} coming up: ${upcoming.slice(0, 3).map((m) => `${m.accountName} at ${formatTime(m.start)}`).join(', ')}.`);
    if (v.pendingDebriefs.length) parts.push(`Your ${v.pendingDebriefs.map((p) => p.accountName).join(' and ')} debrief is still pending.`);
    if (v.commitmentsDue.length) {
      const first = v.commitmentsDue[0];
      parts.push(`${v.commitmentsDue.length} client commitment${v.commitmentsDue.length > 1 ? 's are' : ' is'} due soon, starting with: ${first.subject.charAt(0).toLowerCase()}${first.subject.slice(1)}.`);
    }
    if (v.overdueTasks.length) parts.push(`${v.overdueTasks.length} task${v.overdueTasks.length > 1 ? 's are' : ' is'} overdue.`);
    const critical = v.alerts.filter((a) => a.severity === 'CRITICAL');
    if (v.alerts.length) parts.push(`${v.alerts.length} alert${v.alerts.length > 1 ? 's need' : ' needs'} attention${critical.length ? `, including ${critical[0].accountName}: ${critical[0].title.charAt(0).toLowerCase()}${critical[0].title.slice(1)}` : ''}.`);
    if (v.documentsDue.some((x) => x.daysOverdue > 0)) parts.push(`Documents are overdue for ${[...new Set(v.documentsDue.filter((x) => x.daysOverdue > 0).map((x) => x.accountName))].join(' and ')}.`);
    let text = parts.join(' ');
    while (text.split(/\s+/).length > MAX_AGENDA_WORDS && parts.length > 2) {
      parts.pop();
      text = parts.join(' ');
    }
    return text;
  }

  return {
    view,
    async agenda(ctx: UserContext) {
      const v = await view(ctx);
      return { spoken: spokenAgenda(v, clock.now()), view: v };
    },
  };
}
export type TodayService = ReturnType<typeof createTodayService>;
