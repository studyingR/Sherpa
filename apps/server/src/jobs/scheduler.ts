/**
 * Scheduler (node-cron, docs/02 §7.3). One tick per minute evaluates every job against the app clock, so the
 * same logic is testable with a manual clock: brief-ready pushes 30 min before external meetings (F02-FR5),
 * morning agenda at the RM's time (F04-FR1), nightly alerts at 02:00 (F06-FR1), Monday coverage plan (F10-FR3).
 */
import cron from 'node-cron';
import { addDays, formatTime, toIsoDate } from '@sherpa/shared';
import { buildContext } from '../auth/entitlements';
import type { Deps } from '../deps';
import type { Services } from '../services';
import { readPrefs } from '../services/compliance';

export const BRIEF_LEAD_MINUTES = 30;

async function once(d: Deps, job: string, key: string, fn: () => Promise<void>) {
  const k = `${job}:${key}`;
  const done = await d.db.scheduledJobRun.findUnique({ where: { key: k } });
  if (done) return;
  await d.db.scheduledJobRun.create({ data: { id: k, job, key: k } });
  await fn();
}

export async function runTick(d: Deps, s: Services, now = d.clock.now()) {
  const rms = await d.db.user.findMany({ where: { role: 'RM' } });
  for (const u of rms) {
    const ctx = await buildContext(d.db, { id: u.id, name: u.name, email: u.email, role: 'RM', segment: u.segment as 'COMMERCIAL', region: u.region, teamId: u.teamId });
    const prefs = readPrefs(u.prefsJson);

    // Brief-ready push, 30 ± 1 min before meetings with external attendees.
    if (d.flags.isActive('F02_BRIEF')) {
      const lead = prefs.meetingReminderMinutes ?? BRIEF_LEAD_MINUTES;
      const from = new Date(now.getTime() + (lead - 1) * 60_000);
      const to = new Date(now.getTime() + (lead + 1) * 60_000);
      const meetings = await d.adapters.calendar.listMeetings(ctx, { from, to, ownerRmIds: [u.id] });
      for (const m of meetings.filter((x) => x.accountId && x.attendees.some((a) => a.external))) {
        const acct = await d.adapters.salesforce.getAccount(ctx, m.accountId!);
        await once(d, 'brief-ready', m.id, async () => {
          await s.brief.assemble(ctx, m.accountId!, m.id).catch(() => undefined);
          await s.notifications.notify(u.id, { type: 'brief', title: `${acct?.name ?? 'Your'} brief is ready`, body: `Meeting at ${formatTime(m.start)}. Tap to review.`, deepLink: `sherpa://brief/${m.id}`, dedupeKey: `brief:${m.id}` });
        });
      }
    }

    // Morning agenda at the RM's configured time (default 7:45).
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (d.flags.isActive('F04_NUDGES') && hhmm === prefs.morningAgendaTime) {
      await once(d, 'agenda', `${u.id}:${toIsoDate(now)}`, async () => {
        const a = await s.today.agenda(ctx);
        const urgent = a.view.alerts.filter((x) => x.severity !== 'INFO').length;
        await s.notifications.notify(u.id, { type: 'agenda', title: 'Your morning agenda', body: `${a.view.meetings.length} meetings, ${a.view.commitmentsDue.length} commitments due${urgent ? `, ${urgent} alerts` : ''}.`, deepLink: 'sherpa://today', dedupeKey: `agenda:${toIsoDate(now)}` });
      });
    }
    if (d.flags.isActive('F04_NUDGES') && prefs.cadence === 'MORNING_AFTERNOON' && hhmm === '13:30') {
      await once(d, 'afternoon', `${u.id}:${toIsoDate(now)}`, async () => {
        const v = await s.today.view(ctx);
        if (v.commitmentsDue.length) await s.notifications.notify(u.id, { type: 'nudge', title: 'Commitments due', body: `${v.commitmentsDue[0].subject}${v.commitmentsDue.length > 1 ? ` and ${v.commitmentsDue.length - 1} more` : ''}.`, deepLink: 'sherpa://today', dedupeKey: `afternoon:${toIsoDate(now)}` });
      });
    }

    // Nightly alerts at 02:00 local.
    if (d.flags.isActive('F06_WATCHLIST') && now.getHours() === 2 && now.getMinutes() < 5) {
      await once(d, 'alerts', `${u.id}:${toIsoDate(now)}`, async () => {
        await s.alerts.evaluateForRm(ctx, u.id);
      });
    }

    // Weekly coverage plan, Monday 07:00.
    if (d.flags.isActive('F10_COVERAGE') && now.getDay() === 1 && hhmm === '07:00') {
      await once(d, 'coverage', `${u.id}:${toIsoDate(now)}`, async () => {
        const p = await s.coverage.plan(ctx);
        await s.notifications.notify(u.id, { type: 'coverage', title: 'Your weekly coverage plan', body: `${p.plan.items.length} relationships to reach this week.`, deepLink: 'sherpa://coverage', dedupeKey: `coverage:${p.plan.weekOf}` });
      });
    }

    // Weekly health snapshots (F13-FR5) — Sunday night.
    if (d.flags.isActive('F13_HEALTH_SCORE') && now.getDay() === 0 && hhmm === '23:00') {
      await once(d, 'health', `${u.id}:${toIsoDate(now)}`, async () => {
        await s.health.list(ctx).catch(() => undefined);
      });
    }
  }
  void addDays;
}

export function startScheduler(d: Deps, s: Services) {
  const task = cron.schedule('* * * * *', () => {
    runTick(d, s).catch((err) => d.log.error({ err: String(err) }, 'scheduler tick failed'));
  });
  return () => task.stop();
}
