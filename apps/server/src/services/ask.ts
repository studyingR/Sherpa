/** Global "Ask Sherpa" (docs/01 §5): routes a request to the right feature; writes come back as intents. */
import { randomUUID } from 'node:crypto';
import { assertToolAllowed, resolveDueDate } from '@sherpa/agent';
import {
  SPECIALTY_LABEL,
  formatLongDate,
  formatTime,
  type AgentMessage,
  type AgentTurn,
  type AskRequest,
  type Specialty,
  type UiAction,
} from '@sherpa/shared';
import type { UserContext } from '../auth/entitlements';
import type { Deps } from '../deps';
import { AppError } from '../lib/errors';
import type { BriefService } from './brief';
import type { DebriefService } from './debrief';
import type { AlertService } from './alerts';
import type { CoverageService, DocumentService, TalkingPointService } from './insights';
import type { TaskService } from './workflows';
import type { TodayService } from './today';

const SPECIALTY_WORDS: [RegExp, Specialty][] = [
  [/fx|foreign/i, 'FX'], [/treasury/i, 'TREASURY_MANAGEMENT'], [/wealth/i, 'WEALTH'], [/sba/i, 'SBA'],
  [/capital/i, 'CAPITAL_MARKETS'], [/equipment/i, 'EQUIPMENT_FINANCE'], [/merchant|card/i, 'MERCHANT_SERVICES'],
];

export function createAskService(d: Deps, s: { brief: BriefService; debriefs: DebriefService; today: TodayService; tasks: TaskService; alerts: AlertService; docs: DocumentService; coverage: CoverageService; talking: TalkingPointService }) {
  const { adapters, clock, model, flags, db } = d;

  const say = (text: string, kind: AgentMessage['kind'] = 'TEXT'): AgentMessage => ({ id: randomUUID(), speaker: 'AGENT', text, kind, at: clock.now().toISOString() });

  return {
    async handle(ctx: UserContext, req: AskRequest): Promise<AgentTurn> {
      if (!ctx.bookRmIds.length) return { messages: [say('I can help with your team view and the review queue from the Me tab.')], actions: [] };
      const accounts = await adapters.salesforce.listAccounts(ctx, { ownerRmIds: ctx.bookRmIds });
      const cmd = await model.parseAsk(req.text, { accountNames: accounts.map((a) => a.name) });
      const account = accounts.find((a) => a.name === cmd.accountText) ?? accounts.find((a) => a.id === req.context?.accountId) ?? accounts.find((a) => cmd.accountText && a.name.toLowerCase().includes(cmd.accountText.toLowerCase()));
      const actions: UiAction[] = [];
      const tool = (name: string) => assertToolAllowed(name, 'ASK', flags.resolved, 'RM');
      const unavailable = { messages: [say("I can't help with that here.")], actions: [] };

      switch (cmd.intent) {
        case 'BRIEF': {
          if (!flags.isActive('F02_BRIEF')) return unavailable;
          tool('assemble_brief');
          if (!account) return { messages: [say('Which client should I brief you on?', 'QUESTION')], actions };
          const now = clock.now();
          const upcoming = (await adapters.calendar.listMeetings(ctx, { from: now, to: new Date(now.getTime() + 7 * 86_400_000), ownerRmIds: ctx.bookRmIds })).find((m) => m.accountId === account.id);
          const b = await s.brief.assemble(ctx, account.id, upcoming?.id ?? null);
          actions.push(upcoming ? { type: 'OPEN_BRIEF', meetingId: upcoming.id } : { type: 'NAVIGATE', route: `/brief/account/${account.id}` });
          const user = await db.user.findUnique({ where: { id: ctx.rmId } });
          const privacy = user ? (JSON.parse(user.prefsJson) as { privacyMode?: boolean }).privacyMode !== false : true;
          return { messages: [say(privacy ? b.spokenPrivate : b.spoken)], actions };
        }
        case 'DEBRIEF': {
          if (!flags.isActive('F01_DEBRIEF')) return unavailable;
          const timeMatch = req.text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
          let meetingId: string | undefined;
          if (timeMatch) {
            const h = (Number(timeMatch[1]) % 12) + (/pm/i.test(timeMatch[3]) ? 12 : 0);
            const today = clock.today();
            const meetings = await adapters.calendar.listMeetings(ctx, { from: today, to: new Date(today.getTime() + 86_400_000), ownerRmIds: ctx.bookRmIds });
            meetingId = meetings.find((m) => new Date(m.start).getHours() === h)?.id;
          }
          const r = await s.debriefs.start(ctx, { channel: 'CHAT', meetingId, accountId: meetingId ? undefined : account?.id });
          actions.push({ type: 'NAVIGATE', route: `/debrief/${r.draftId}?mode=chat` });
          return { messages: [say(r.opening, 'QUESTION')], actions, draft: r.draft };
        }
        case 'AGENDA': {
          tool('get_agenda');
          const a = await s.today.agenda(ctx);
          return { messages: [say(a.spoken)], actions: [{ type: 'NAVIGATE', route: '/today' }] };
        }
        case 'TASK_COMPLETE':
        case 'TASK_RESCHEDULE':
        case 'TASK_DELEGATE': {
          tool('prepare_task_action');
          const task = await s.tasks.findByRef(ctx, `${cmd.taskRef} ${cmd.accountText}`);
          if (!task) return { messages: [say("I couldn't find that task. Which one did you mean?", 'QUESTION')], actions };
          if (cmd.intent === 'TASK_COMPLETE') {
            const intent = await s.tasks.intent(ctx, task.id, { action: 'COMPLETE' });
            return { messages: [say(`Mark "${task.subject}" done? Confirm to save to Salesforce.`, 'QUESTION')], actions: [{ type: 'SHOW_INTENT', intentId: intent.id }], intent };
          }
          if (cmd.intent === 'TASK_RESCHEDULE') {
            const due = resolveDueDate(cmd.newDueDateText, clock.now());
            if (!due) return { messages: [say('What date should I move it to?', 'QUESTION')], actions };
            const intent = await s.tasks.intent(ctx, task.id, { action: 'RESCHEDULE', dueDate: due });
            return { messages: [say(`Move "${task.subject}" to ${formatLongDate(due)}? Confirm to save.`, 'QUESTION')], actions: [{ type: 'SHOW_INTENT', intentId: intent.id }], intent };
          }
          try {
            const intent = await s.tasks.intent(ctx, task.id, { action: 'DELEGATE', delegateTo: cmd.delegateToName });
            return { messages: [say(`Delegate "${task.subject}" to ${cmd.delegateToName}? Confirm to save.`, 'QUESTION')], actions: [{ type: 'SHOW_INTENT', intentId: intent.id }], intent };
          } catch (e) {
            if (e instanceof AppError) return { messages: [say(e.message)], actions };
            throw e;
          }
        }
        case 'DRAFT_RECAP': {
          if (!flags.isActive('F03_DRAFTS')) return unavailable;
          tool('draft_follow_ups');
          const deb = await db.debrief.findFirst({ where: { userId: ctx.rmId, ...(account ? { accountId: account.id } : {}) }, orderBy: { confirmedAt: 'desc' } });
          if (!deb) return { messages: [say("I don't have a saved debrief to recap yet.")], actions };
          return { messages: [say('Opening the recap draft.')], actions: [{ type: 'NAVIGATE', route: `/drafts/${deb.id}` }] };
        }
        case 'REFERRAL': {
          if (!flags.isActive('F05_REFERRALS')) return unavailable;
          tool('prepare_referral');
          const specialty = SPECIALTY_WORDS.find(([re]) => re.test(cmd.specialty || req.text))?.[1];
          if (!account) return { messages: [say('Which client is the referral for?', 'QUESTION')], actions };
          actions.push({ type: 'NAVIGATE', route: `/referral/new?accountId=${account.id}${specialty ? `&specialty=${specialty}` : ''}` });
          return { messages: [say(`Starting a ${specialty ? SPECIALTY_LABEL[specialty] + ' ' : ''}referral for ${account.name}. Review it and confirm.`)], actions };
        }
        case 'NEW_DEAL': {
          if (!flags.isActive('F07_DEAL_INTAKE')) return unavailable;
          if (!account) return { messages: [say('Which client is the deal for?', 'QUESTION')], actions };
          return { messages: [say(`Starting deal intake for ${account.name}.`)], actions: [{ type: 'NAVIGATE', route: `/deal/new?accountId=${account.id}` }] };
        }
        case 'ALERTS': {
          if (!flags.isActive('F06_WATCHLIST')) return unavailable;
          tool('list_alerts');
          const list = (await s.alerts.list(ctx, { status: 'open' })).filter((x) => !account || x.accountId === account.id);
          const top = list.slice(0, 3).map((x) => `${x.accountName}: ${x.title}`).join('. ');
          return { messages: [say(list.length ? `${list.length} open alert${list.length > 1 ? 's' : ''}. ${top}.` : 'No open alerts.')], actions: [{ type: 'NAVIGATE', route: '/alerts' }] };
        }
        case 'DOCUMENTS': {
          if (!flags.isActive('F08_DOC_CHASE')) return unavailable;
          tool('list_outstanding_documents');
          const items = (await s.docs.list(ctx, account?.id)).filter((x) => x.status === 'OUTSTANDING');
          const overdue = items.filter((x) => x.daysOverdue > 0);
          return {
            messages: [say(items.length ? `${items.length} outstanding document${items.length > 1 ? 's' : ''}${overdue.length ? `, ${overdue.length} overdue` : ''}.` : 'Nothing outstanding.')],
            actions: account ? [{ type: 'NAVIGATE', route: `/documents/${account.id}` }] : [],
          };
        }
        case 'COVERAGE': {
          if (!flags.isActive('F10_COVERAGE')) return unavailable;
          tool('get_coverage_plan');
          const p = await s.coverage.plan(ctx);
          return { messages: [say(`This week, start with ${p.plan.items.slice(0, 3).map((i) => `${i.accountName} (${i.reasons[0]})`).join(', ')}.`)], actions: [{ type: 'NAVIGATE', route: '/coverage' }] };
        }
        case 'TALKING_POINTS': {
          if (!flags.isActive('F09_TALKING_POINTS')) return unavailable;
          if (!account) return { messages: [say('Which client?', 'QUESTION')], actions };
          const tps = await s.talking.forAccount(ctx, account.id);
          return { messages: [say(tps.length ? tps.slice(0, 3).map((t) => `${t.title}: ${t.question}`).join(' ') : "I don't have suggestions for this account yet.")], actions: [{ type: 'NAVIGATE', route: `/accounts/${account.id}` }] };
        }
        case 'PRICING': {
          // F12 is screen-only and gated; when inactive it doesn't exist.
          if (!flags.isActive('F12_PRICING_GUIDANCE')) return { messages: [say("I can't help with pricing.")], actions };
          return { messages: [say('Pricing guidance is on your screen only. Open a deal to see it.')], actions };
        }
        case 'HEALTH': {
          if (!flags.isActive('F13_HEALTH_SCORE')) return unavailable;
          return { messages: [say('Opening relationship health.')], actions: account ? [{ type: 'NAVIGATE', route: `/accounts/${account.id}` }] : [] };
        }
        case 'ACCOUNT_QUESTION': {
          if (!account || !flags.isActive('F02_BRIEF')) break;
          tool('assemble_brief');
          const r = await s.brief.ask(ctx, account.id, cmd.question || req.text);
          return { messages: [say(r.answer)], actions: [{ type: 'NAVIGATE', route: `/accounts/${account.id}` }] };
        }
      }
      const next = (await s.today.view(ctx)).meetings.find((m) => new Date(m.start) > clock.now() && m.accountName);
      return {
        messages: [say(`I can brief you, take a debrief, draft follow-ups, or update tasks.${next ? ` For example, "brief me on ${next.accountName}" before your ${formatTime(next.start)}.` : ''}`)],
        actions,
      };
    },
  };
}
export type AskService = ReturnType<typeof createAskService>;
