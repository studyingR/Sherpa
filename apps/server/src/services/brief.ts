/**
 * F02 — Meeting brief. Reads run in parallel with a 2.5 s per-source timeout; every fact carries its
 * source and as-of date; missing sources are listed; spoken text is rendered from facts only (docs/02 §7.2).
 * Read-only: never writes to systems of record (F02-FR7).
 */
import { sanitizeExternalText, type SpeechItem } from '@sherpa/agent';
import {
  DOCUMENT_TYPE_LABEL,
  SOURCE_LABEL,
  daysBetween,
  formatMoney,
  formatPct,
  formatShortDate,
  formatTime,
  parseDate,
  type AskBriefResponse,
  type Brief,
  type BriefItem,
  type BriefSection,
  type Source,
  type SourcedFact,
} from '@sherpa/shared';
import type { UserContext } from '../auth/entitlements';
import { assertInBook } from '../auth/entitlements';
import type { Deps } from '../deps';
import { forbidden, notFound } from '../lib/errors';
import type { AlertService } from './alerts';
import { f, type BookService } from './book';
import type { DocumentService, HealthService, TalkingPointService } from './insights';

export const SOURCE_TIMEOUT_MS = 2500;
const CACHE_MS = 10 * 60 * 1000;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, rej) => (t = setTimeout(() => rej(new Error('timeout')), ms)))]);
  } finally {
    if (t) clearTimeout(t);
  }
}

export function createBriefService(d: Deps, book: BookService, alerts: AlertService, docs: DocumentService, talking: TalkingPointService, health: HealthService) {
  const { adapters, db, clock, model, flags } = d;

  async function assemble(ctx: UserContext, accountId: string, meetingId: string | null, opts: { useCache?: boolean } = {}): Promise<Brief> {
    flags.require('F02_BRIEF');
    assertInBook(ctx, accountId);
    const cacheKey = `${ctx.rmId}:${accountId}:${meetingId ?? ''}`;
    const now = clock.now();
    if (opts.useCache !== false) {
      const cached = await db.cachedBrief.findUnique({ where: { key: cacheKey } });
      if (cached && cached.expiresAt > now) return JSON.parse(cached.briefJson) as Brief;
    }

    const missing = new Set<Source>();
    const safe = <T>(source: Source, p: () => Promise<T>, fallback: T): Promise<T> =>
      withTimeout(p(), SOURCE_TIMEOUT_MS).catch(() => {
        missing.add(source);
        return fallback;
      });

    const a = await safe('SALESFORCE', () => book.account(ctx, accountId), null);
    if (!a) {
      if (!ctx.bookAccountIds.has(accountId)) throw forbidden();
      throw notFound('That account');
    }
    const meeting = meetingId ? await safe('CALENDAR', () => adapters.calendar.getMeeting(ctx, meetingId), null) : null;
    if (meetingId && meeting && meeting.accountId !== accountId) throw notFound('That meeting');

    const [contacts, activities, opps, tasks, loans, covenants, ticklers, deposits, news, profit, touch] = await Promise.all([
      safe('SALESFORCE', () => adapters.salesforce.getContacts(ctx, accountId), []),
      safe('SALESFORCE', () => adapters.salesforce.getActivities(ctx, accountId, 3), []),
      safe('SALESFORCE', () => adapters.salesforce.getOpenOpportunities(ctx, accountId), []),
      safe('SALESFORCE', () => adapters.salesforce.getTasks(ctx, { bookRmIds: ctx.bookRmIds, accountId, status: 'OPEN' }), []),
      safe('NCINO', () => adapters.ncino.getLoans(ctx, accountId), []),
      safe('NCINO', () => adapters.ncino.getCovenants(ctx, accountId), []),
      safe('NCINO', () => adapters.ncino.getTicklers(ctx, accountId), []),
      safe('CORE_DEPOSITS', () => book.depositSummary(ctx, accountId), null),
      safe('NEWS', () => adapters.news.getNews(ctx, accountId, 30), []),
      safe('PRECISION_LENDER', () => adapters.precisionLender.getRelationshipProfitability(ctx, accountId), null),
      safe('SALESFORCE', () => book.lastTouch(ctx, [accountId]), {} as Record<string, number | null>),
    ]);
    const utilization = loans.length ? await safe('ACBS', () => book.utilizationByFacility(ctx, loans), {}) : {};
    const today = clock.today();
    const nowIso = now.toISOString();

    const sections: BriefSection[] = [];
    const overview = book.overviewFacts(a, touch[accountId] ?? null, nowIso);
    if (profit) overview.push(f('pl.raroc', 'Relationship RAROC', profit.raroc, formatPct(profit.raroc, 1), 'PRECISION_LENDER', profit.asOf), f('pl.revenue', 'Revenue, last 12 months', profit.revenue12m, formatMoney(profit.revenue12m), 'PRECISION_LENDER', profit.asOf));
    sections.push({ id: 'overview', title: 'Overview', facts: overview });
    sections.push({ id: 'contacts', title: 'Contacts', facts: [], items: contacts.map((c) => ({ title: c.name, detail: c.title, source: 'SALESFORCE', asOf: nowIso, ref: c.id })) });
    sections.push({ id: 'touchpoints', title: 'Recent touchpoints', facts: [], items: activities.map((x) => ({ title: x.subject, detail: `${x.type.charAt(0)}${x.type.slice(1).toLowerCase()} · ${formatShortDate(x.date)}`, source: 'SALESFORCE', asOf: x.date })) });
    const commitments = tasks.filter((t) => t.clientCommitment);
    sections.push({ id: 'commitments', title: 'What we promised', facts: [], items: commitments.map((t) => ({ title: t.subject, detail: t.dueDate ? `Due ${formatShortDate(t.dueDate)}` : 'No due date', source: 'SALESFORCE', asOf: nowIso, ref: t.id })) });

    const credit = book.creditFacts(loans, today);
    for (const [fid, h] of Object.entries(utilization)) {
      if (h.length > 1) credit.push(f(`acbs.${fid}.trend`, 'Utilization 30 days ago', Math.round(h[Math.max(0, h.length - 7)].utilization), formatPct(h[Math.max(0, h.length - 7)].utilization), 'ACBS', h[Math.max(0, h.length - 7)].date));
    }
    sections.push({ id: 'credit', title: 'Credit', facts: credit, items: covenants.map((c) => ({ title: `${c.name} ${c.operator} ${c.threshold}`, detail: `Test due ${formatShortDate(c.testDueDate)}`, source: 'NCINO', asOf: nowIso })) });
    sections.push({ id: 'deposits', title: 'Deposits and treasury', facts: deposits?.facts ?? [] });
    sections.push({ id: 'opportunities', title: 'Open opportunities', facts: [], items: opps.map((o) => ({ title: o.name, detail: `${o.stage}${o.amount ? ` · ${formatMoney(o.amount)}` : ''}${o.closeDate ? ` · closes ${formatShortDate(o.closeDate)}` : ''}`, source: 'SALESFORCE', asOf: nowIso, ref: o.id })) });

    const alertList = flags.isActive('F06_WATCHLIST') ? await alerts.list(ctx, { accountId, status: 'open' }).catch(() => []) : [];
    if (flags.isActive('F06_WATCHLIST')) sections.push({ id: 'alerts', title: 'Alerts', facts: alertList.flatMap((x) => x.evidence), items: alertList.map((x) => ({ title: x.title, detail: x.suggestedAction, source: x.evidence[0]?.source ?? 'SHERPA', asOf: x.evidence[0]?.asOf ?? nowIso, ref: x.id })) });
    if (flags.isActive('F08_DOC_CHASE')) {
      const items = (await docs.itemsFor(ctx, accountId, a.name).catch(() => [])).filter((x) => x.status === 'OUTSTANDING');
      sections.push({ id: 'documents', title: 'Documents', facts: [], items: items.map((x) => ({ title: `${DOCUMENT_TYPE_LABEL[x.type]}${x.period ? ` (${x.period})` : ''}`, detail: x.daysOverdue ? `${x.daysOverdue} days overdue` : `Due ${formatShortDate(x.dueDate)}`, source: x.source, asOf: nowIso, ref: x.id })) });
    }
    if (flags.isActive('F09_TALKING_POINTS')) {
      const tps = await talking.forAccount(ctx, accountId).catch(() => []);
      sections.push({ id: 'talkingPoints', title: 'Talking points', facts: tps.flatMap((t) => t.evidence), items: tps.map((t) => ({ title: t.title, detail: `${t.rationale} Ask: ${t.question}`, source: t.evidence[0]?.source ?? 'SHERPA', asOf: t.evidence[0]?.asOf ?? nowIso, ref: t.id })) });
    }
    // News is external text: instructions are stripped and it is treated as data only (C-14).
    sections.push({ id: 'news', title: 'News, last 30 days', facts: [], items: news.map((n): BriefItem => ({ title: sanitizeExternalText(n.headline).text, detail: `${n.outlet} · ${sanitizeExternalText(n.summary).text}`, source: 'NEWS', asOf: n.publishedAt })) });
    if (flags.isActive('F13_HEALTH_SCORE')) {
      const h = await health.compute(ctx, accountId).catch(() => null);
      if (h) sections.push({ id: 'health', title: 'Relationship health', facts: [f('health.score', 'Health score', h.score, `${h.score} · ${h.band.replace('_', ' ').toLowerCase()}`, 'SHERPA', h.computedAt), ...h.drivers.map((x) => x.fact)] });
    }

    // ---------- spoken rendering (≤ 230 words), priorities: changed, due, promised, opportunities, risks
    const changed: SpeechItem[] = [];
    const due: SpeechItem[] = [];
    const risks: SpeechItem[] = [];
    for (const al of alertList) {
      if (al.rule === 'MATURITY_APPROACHING') continue; // spoken under "coming due" instead
      const item = { text: al.title, privateText: al.title.replace(/\$[\d.,]+[KMB]?/g, 'on your screen') };
      if (al.severity === 'CRITICAL') risks.push(item);
      else changed.push(item);
    }
    if (deposits && Math.abs(deposits.trendPct) >= 10) changed.push({ text: `Deposits are ${formatMoney(deposits.balance)}, ${deposits.trendPct > 0 ? 'up' : 'down'} ${Math.abs(Math.round(deposits.trendPct))}% on their 90-day average`, privateText: `Deposits are ${deposits.trendPct > 0 ? 'up' : 'down'} on their 90-day average; figures are on your screen` });
    for (const n of news.slice(0, 1)) changed.push({ text: `In the news: ${sanitizeExternalText(n.headline).text}` });
    for (const l of loans) {
      const days = daysBetween(today, parseDate(l.maturityDate));
      if (days >= 0 && days <= 180) due.push({ text: `The ${l.product.toLowerCase()} of ${formatMoney(l.commitment)} matures in ${days} days`, privateText: `The ${l.product.toLowerCase()} matures in ${days} days` });
    }
    for (const t of ticklers.filter((x) => x.status === 'OUTSTANDING').slice(0, 2)) {
      const od = daysBetween(parseDate(t.dueDate), today);
      due.push({ text: od > 0 ? `${DOCUMENT_TYPE_LABEL[t.type as keyof typeof DOCUMENT_TYPE_LABEL] ?? t.type} are ${od} days overdue` : `${DOCUMENT_TYPE_LABEL[t.type as keyof typeof DOCUMENT_TYPE_LABEL] ?? t.type} due ${formatShortDate(t.dueDate)}` });
    }
    const promised = commitments.map((t) => ({ text: `${t.subject}${t.dueDate ? `, due ${formatShortDate(t.dueDate)}` : ''}` }));
    const opportunities = opps.map((o) => ({ text: `${o.name.replace(`${a.name} – `, '')}${o.amount ? ` for ${formatMoney(o.amount)}` : ''}, ${o.stage.toLowerCase()}`, privateText: `${o.name.replace(`${a.name} – `, '')}, ${o.stage.toLowerCase()}` }));
    const missingLabels = [...missing].map((s) => `${SOURCE_LABEL[s]}`);
    const meetingLabel = meeting ? `your ${formatTime(meeting.start)} meeting` : null;
    const input = { accountName: a.name, meetingLabel, changed, due, promised, opportunities, risks, missing: missingLabels };
    const [spoken, spokenPrivate] = await Promise.all([model.writeBriefSpoken({ ...input, privacy: false }), model.writeBriefSpoken({ ...input, privacy: true })]);

    const brief: Brief = {
      meetingId,
      accountId,
      accountName: a.name,
      meeting: meeting ? { subject: meeting.subject, start: meeting.start, attendees: meeting.attendees.filter((x) => x.external).map((x) => x.name) } : null,
      generatedAt: nowIso,
      sections,
      missingSources: [...missing],
      spoken,
      spokenPrivate,
    };
    if (opts.useCache !== false && !missing.size) {
      await db.cachedBrief.upsert({ where: { key: cacheKey }, create: { key: cacheKey, briefJson: JSON.stringify(brief), expiresAt: new Date(now.getTime() + CACHE_MS) }, update: { briefJson: JSON.stringify(brief), expiresAt: new Date(now.getTime() + CACHE_MS) } });
    }
    return brief;
  }

  return {
    assemble,
    async forMeeting(ctx: UserContext, meetingId: string) {
      const m = await adapters.calendar.getMeeting(ctx, meetingId);
      if (!m || !m.accountId) throw notFound('That meeting');
      assertInBook(ctx, m.accountId);
      return assemble(ctx, m.accountId, meetingId);
    },
    /** F02-FR6: answers only from the assembled brief; otherwise "I don't have that." */
    async ask(ctx: UserContext, accountId: string, question: string): Promise<AskBriefResponse> {
      const brief = await assemble(ctx, accountId, null);
      const facts: SourcedFact[] = brief.sections.flatMap((s) => [
        ...s.facts,
        ...(s.items ?? []).map((it, i) => f(`${s.id}.item${i}`, `${s.title}: ${it.title}`, it.detail ?? it.title, it.detail ?? it.title, it.source, it.asOf)),
      ]);
      const r = await model.answerFromFacts(question, facts);
      return { answer: r.answer, facts: facts.filter((x) => r.factKeys.includes(x.key)) };
    },
    invalidate: (accountId: string) => db.cachedBrief.deleteMany({ where: { key: { contains: `:${accountId}:` } } }),
  };
}
export type BriefService = ReturnType<typeof createBriefService>;
