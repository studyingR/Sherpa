/**
 * Extraction eval harness (docs/10 §3): runs scripted golden debriefs through the orchestrator and scores
 * the resulting drafts field by field.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { debriefTurn, newDebriefDraft, similarity, wordCount, type AgentModel, type DebriefContext } from '@sherpa/agent';
import type { DebriefDraft, Specialty } from '@sherpa/shared';

export interface GoldenStep {
  /** Sherpa's own suggestions (e.g. specialist intros) "may be added" (docs/07 G1): not required for recall. */
  optional?: boolean;
  title: string;
  owner: string;
  dueDate: string | null;
  clientCommitment: boolean;
}
export interface GoldenCase {
  id: string;
  title: string;
  ctx: { rm?: string; accountName: string; meetingSubject: string; attendees: { name: string; role: string; external: boolean; contactId?: string }[] };
  rmTurns: string[];
  expected: {
    purpose?: string;
    complaint?: boolean;
    mnpi?: boolean;
    sensitive?: boolean;
    summaryExcludes?: string;
    specialistInterest?: Specialty[];
    nextSteps?: GoldenStep[];
    noNextSteps?: boolean;
    opportunities?: { product: string; amount: number | null; closeQuarter?: string; approved?: boolean }[];
    missingIncludes?: string;
    gapQuestionIncludes?: string;
    saved?: boolean;
  };
}

export interface CaseRun {
  id: string;
  title: string;
  draft: DebriefDraft;
  agentLines: string[];
  readBacks: string[];
  saved: boolean;
  failures: string[];
}

export const TARGETS = {
  nextStepRecall: 0.95,
  nextStepPrecision: 0.9,
  dueDateAccuracy: 0.95,
  amountAccuracy: 1,
  complaintRecall: 1,
  complaintFalsePositiveRate: 0.05,
  mnpiRecall: 1,
  specialistF1: 0.9,
  gapQuestionsWithinLimit: 1,
  readBackWithinLimit: 1,
};
export type Metrics = Record<keyof typeof TARGETS, number>;

const MEETING_DATE = new Date(2026, 9, 19, 14, 0); // Monday — SEED_TODAY in tests
const USERS = [
  { id: 'u_maya', name: 'Maya Chen' },
  { id: 'u_devon', name: 'Devon Brooks' },
  { id: 'u_priya', name: 'Priya Shah' },
];

export function loadGolden(dir = fileURLToPath(new URL('../golden', import.meta.url)), only?: string): GoldenCase[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as GoldenCase)
    .filter((c) => !only || c.id === only)
    .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
}

function ctxFor(c: GoldenCase): DebriefContext {
  const rmName = c.ctx.rm ?? 'Maya Chen';
  const rm = USERS.find((u) => u.name === rmName)!;
  return {
    accountId: `ACCT-${c.id}`,
    accountName: c.ctx.accountName,
    rm,
    meetingDate: MEETING_DATE,
    meetingSubject: c.ctx.meetingSubject,
    attendees: [{ name: rm.name, userId: rm.id, external: false }, ...c.ctx.attendees],
    contacts: c.ctx.attendees.filter((a) => a.contactId).map((a) => ({ id: a.contactId!, name: a.name, title: a.role })),
    users: USERS,
    openOpportunities: [],
  };
}

export async function runCase(c: GoldenCase, model: AgentModel): Promise<CaseRun> {
  const ctx = ctxFor(c);
  let draft = newDebriefDraft({
    sessionId: `S-${c.id}`, rmId: ctx.rm.id, accountId: ctx.accountId, accountName: ctx.accountName, meetingId: `M-${c.id}`,
    meetingStart: MEETING_DATE.toISOString(), meetingType: 'IN_PERSON', meetingSubject: ctx.meetingSubject, attendees: ctx.attendees, now: MEETING_DATE, matched: true,
  });
  const agentLines: string[] = [];
  const readBacks: string[] = [];
  let saved = false;
  const say = async (text: string) => {
    const r = await debriefTurn({ draft, text, ctx, model, now: MEETING_DATE });
    draft = r.draft;
    for (const rep of r.replies) {
      agentLines.push(rep.text);
      if (rep.kind === 'READ_BACK') readBacks.push(rep.text);
    }
    if (r.action?.type === 'SAVE') saved = true;
  };
  for (const t of c.rmTurns) {
    if (saved) break;
    await say(t);
  }
  // Scripted turns exhausted mid-gap-fill: the RM says "skip" until Sherpa reads back.
  for (let i = 0; i < 5 && !saved && draft.flowState === 'GAP_FILL'; i++) await say('skip');

  const failures: string[] = [];
  const e = c.expected;
  if (e.purpose && draft.purpose !== e.purpose) failures.push(`purpose ${draft.purpose} ≠ ${e.purpose}`);
  if (e.complaint !== undefined && draft.flags.complaint.flagged !== e.complaint) failures.push(`complaint ${draft.flags.complaint.flagged}`);
  if (e.mnpi !== undefined && draft.flags.mnpi.flagged !== e.mnpi) failures.push(`mnpi ${draft.flags.mnpi.flagged}`);
  if (e.sensitive !== undefined && draft.flags.sensitive.flagged !== e.sensitive) failures.push(`sensitive ${draft.flags.sensitive.flagged}`);
  if (e.summaryExcludes && draft.summary.toLowerCase().includes(e.summaryExcludes)) failures.push(`summary contains "${e.summaryExcludes}"`);
  if (e.noNextSteps !== undefined && draft.noNextSteps !== e.noNextSteps) failures.push(`noNextSteps ${draft.noNextSteps}`);
  if (e.missingIncludes && !draft.missingFields.join(' ').includes(e.missingIncludes)) failures.push(`missingFields lacks ${e.missingIncludes}`);
  if (e.gapQuestionIncludes && !agentLines.some((l) => l.includes(e.gapQuestionIncludes!))) failures.push(`no gap question "${e.gapQuestionIncludes}"`);
  if (e.saved !== undefined && saved !== e.saved) failures.push(`saved ${saved}`);
  for (const o of e.opportunities ?? []) {
    const got = draft.opportunities.find((x) => x.product === o.product);
    if (!got) failures.push(`missing opportunity ${o.product}`);
    else {
      if (got.amount !== o.amount) failures.push(`${o.product} amount ${got.amount} ≠ ${o.amount}`);
      if (o.closeQuarter && got.closeQuarter !== o.closeQuarter) failures.push(`${o.product} quarter ${got.closeQuarter}`);
      if (o.approved !== undefined && got.approved !== o.approved) failures.push(`${o.product} approved ${got.approved}`);
    }
  }
  return { id: c.id, title: c.title, draft, agentLines, readBacks, saved, failures };
}

const STOP = new Set(['the', 'a', 'an', 'to', 'about', 'on', 'for', 'with', 'of', 'and', 'our', 'their', 'by']);
const tokens = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));

/**
 * Fuzzy title match (docs/10 §3: "fuzzy title ≥ 0.8 similarity"): bigram Dice ≥ 0.8, or every word of the
 * expected title appears in the extracted one ("Call Gus" ⊆ "Call Gus about the login issue").
 */
export function titleMatches(extracted: string, expected: string): boolean {
  if (similarity(extracted, expected) >= 0.8) return true;
  const got = new Set(tokens(extracted));
  const want = tokens(expected);
  return want.length > 0 && want.every((w) => got.has(w) || got.has(w.replace(/s$/, '')) || got.has(`${w}s`));
}

function ownerMatches(expected: string, step: DebriefDraft['nextSteps'][number]): boolean {
  if (expected === 'RM') return step.ownerType === 'RM';
  return step.ownerName.toLowerCase() === expected.toLowerCase();
}

export function score(cases: GoldenCase[], runs: CaseRun[]): { metrics: Metrics; perCase: { id: string; notes: string[] }[] } {
  let expSteps = 0, gotSteps = 0, matchedExp = 0, matchedGot = 0, dueTotal = 0, dueOk = 0;
  let amtTotal = 0, amtOk = 0, cPos = 0, cTp = 0, cNeg = 0, cFp = 0, mPos = 0, mTp = 0;
  let tp = 0, fp = 0, fn = 0, gapOk = 0, rbTotal = 0, rbOk = 0;
  const perCase: { id: string; notes: string[] }[] = [];

  for (const c of cases) {
    const r = runs.find((x) => x.id === c.id)!;
    const notes = [...r.failures];
    const e = c.expected;
    if (e.nextSteps) {
      // Precision measures extraction, so Sherpa's own suggestions only count when the golden expects them.
      const got = r.draft.nextSteps.filter((s) => s.include);
      const used = new Set<string>();
      for (const es of e.nextSteps) {
        const m = got.find((g) => !used.has(g.id) && titleMatches(g.title, es.title) && ownerMatches(es.owner, g));
        if (!es.optional || m) expSteps++;
        if (m) {
          used.add(m.id);
          matchedExp++;
          if (es.dueDate) {
            dueTotal++;
            if (m.dueDate === es.dueDate) dueOk++;
            else notes.push(`"${es.title}" due ${m.dueDate} ≠ ${es.dueDate}`);
          }
        } else if (!es.optional) notes.push(`missed step "${es.title}" (${es.owner})`);
      }
      const extracted = got.filter((g) => used.has(g.id) || !g.suggested);
      gotSteps += extracted.length;
      matchedGot += used.size;
      for (const g of extracted) if (!used.has(g.id)) notes.push(`extra step "${g.title}" (${g.ownerName})`);
    }
    for (const o of e.opportunities ?? []) {
      amtTotal++;
      const got = r.draft.opportunities.find((x) => x.product === o.product);
      if (got && got.amount === o.amount) amtOk++;
    }
    if (e.complaint === true) {
      cPos++;
      if (r.draft.flags.complaint.flagged) cTp++;
    }
    if (e.complaint === false) {
      cNeg++;
      if (r.draft.flags.complaint.flagged) cFp++;
    }
    if (e.mnpi === true) {
      mPos++;
      if (r.draft.flags.mnpi.flagged) mTp++;
    }
    if (e.specialistInterest) {
      const exp = new Set(e.specialistInterest);
      const got = new Set(r.draft.specialistInterest);
      for (const s of got) {
        if (exp.has(s)) tp++;
        else fp++;
      }
      for (const s of exp) if (!got.has(s)) fn++;
      if ([...got].some((s) => !exp.has(s)) || [...exp].some((s) => !got.has(s))) notes.push(`specialists ${[...got].join(',')}`);
    }
    if (r.draft.gapQuestionsAsked <= 3) gapOk++;
    for (const rb of r.readBacks) {
      rbTotal++;
      if (wordCount(rb) <= 110) rbOk++;
      else notes.push(`read-back ${wordCount(rb)} words`);
    }
    perCase.push({ id: c.id, notes });
  }
  const ratio = (a: number, b: number) => (b === 0 ? 1 : a / b);
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  return {
    metrics: {
      nextStepRecall: ratio(matchedExp, expSteps),
      nextStepPrecision: ratio(matchedGot, gotSteps),
      dueDateAccuracy: ratio(dueOk, dueTotal),
      amountAccuracy: ratio(amtOk, amtTotal),
      complaintRecall: ratio(cTp, cPos),
      complaintFalsePositiveRate: cNeg ? cFp / cNeg : 0,
      mnpiRecall: ratio(mTp, mPos),
      specialistF1: precision + recall ? (2 * precision * recall) / (precision + recall) : 1,
      gapQuestionsWithinLimit: ratio(gapOk, cases.length),
      readBackWithinLimit: ratio(rbOk, rbTotal),
    },
    perCase,
  };
}

export function meetsTargets(m: Metrics): { ok: boolean; misses: string[] } {
  const misses: string[] = [];
  for (const [k, target] of Object.entries(TARGETS) as [keyof Metrics, number][]) {
    const v = m[k];
    const pass = k === 'complaintFalsePositiveRate' ? v <= target : v >= target;
    if (!pass) misses.push(`${k}: ${v.toFixed(3)} (target ${k === 'complaintFalsePositiveRate' ? '≤' : '≥'} ${target})`);
  }
  return { ok: misses.length === 0, misses };
}

export function report(mode: string, model: string, cases: GoldenCase[], runs: CaseRun[], scored: ReturnType<typeof score>): string {
  const t = meetsTargets(scored.metrics);
  const lines = [
    `# Sherpa extraction eval — ${mode} mode`,
    '',
    `Model: \`${model}\` · Cases: ${cases.length} · Result: **${t.ok ? 'PASS' : 'FAIL'}**`,
    '',
    '| Metric | Value | Target |',
    '|---|---|---|',
    ...Object.entries(scored.metrics).map(([k, v]) => {
      const target = TARGETS[k as keyof Metrics];
      return `| ${k} | ${(v * 100).toFixed(1)}% | ${k === 'complaintFalsePositiveRate' ? '≤' : '≥'} ${(target * 100).toFixed(0)}% |`;
    }),
    '',
    '## Cases',
    '',
    '| Case | Title | Notes |',
    '|---|---|---|',
    ...scored.perCase.map((p) => `| ${p.id} | ${runs.find((r) => r.id === p.id)!.title} | ${p.notes.length ? p.notes.join('; ') : 'ok'} |`),
  ];
  if (!t.ok) lines.push('', '## Misses', '', ...t.misses.map((m) => `- ${m}`));
  return lines.join('\n') + '\n';
}
