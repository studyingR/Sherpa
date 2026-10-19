/**
 * Debrief state machine (docs/05 §4). Deterministic control flow; the model only extracts and classifies.
 * MATCH_MEETING → OPEN_FLOOR → (GAP_FILL ≤ 3) → READ_BACK → APPROVE_OPPORTUNITY → CONFIRM → SAVED.
 */
import { randomUUID } from 'node:crypto';
import {
  SPECIALTY_LABEL,
  firstName,
  type DebriefDraft,
  type FlagEvent,
  type Gap,
  type NextStep,
  type Purpose,
  type Specialty,
} from '@sherpa/shared';
import type { DebriefExtraction } from '../extraction/schema';
import { SPECIALTY_KEYWORDS, TEAM_SPECIALTY, type DebriefContext } from '../extraction/context';
import { toContactUpdates, toNextSteps, toOpportunities } from '../extraction/postprocess';
import { detectComplaint, detectMnpi, detectSensitive } from '../guardrails';
import type { AgentModel, FlagClassification } from '../model/types';
import { PRODUCTS, parseOwnerDateAnswer } from '../model/rules/debrief';
import { resolveDueDate, resolveQuarter, spokenDate } from '../speech/dates';
import { findAmount } from '../speech/numbers';
import { approvalQuestion, buildReadBack } from '../speech/readback';

export const MAX_GAP_QUESTIONS = 3;

export type ReplyKind = 'TEXT' | 'FLAG' | 'READ_BACK' | 'QUESTION' | 'RESULT';
export interface Reply {
  text: string;
  kind: ReplyKind;
}

export type DebriefAction =
  | { type: 'SAVE'; mode: 'CONFIRM' | 'JUST_SAVE'; utterance: string }
  | { type: 'REMATCH'; query: string }
  | { type: 'OPEN_DRAFTS' }
  | { type: 'OPEN_REFERRAL'; specialty?: Specialty }
  | { type: 'END' };

export interface DebriefTurnResult {
  draft: DebriefDraft;
  replies: Reply[];
  flags: FlagEvent[];
  action?: DebriefAction;
}

// ---------------------------------------------------------------- utterance classifiers
const YES = /^(?:yes|yeah|yep|yup|correct|right|sure|that'?s (?:it|the one|right|correct)|it was|ok(?:ay)?|go ahead)\b/i;
const NO = /^(?:no|nope|not (?:that|it|yet|really)|wrong|different|hold off|don'?t|do not|wait)\b/i;
const SKIP = /^(?:skip|pass|next|not sure|i don'?t know|no idea|leave it|move on)\b/i;
const CLEAR_YES = /^(?:yes|yeah|yep|yup|approve[d]?|create it|go ahead and create|yes,? (?:create|approve|go ahead)|do it)\b/i;
const NEGATION = /\b(?:not|don'?t|hold|wait|no|later|maybe)\b/i;
const CONFIRM = /\b(?:confirm(?:ed)?|save it|save that|save this|looks good,? save|that'?s right,? save)\b/i;
const JUST_SAVE = /\bjust save(?: it)?\b/i;
const KEEP_SENSITIVE = /\bkeep (?:it|that|the detail)\b/i;
const NONE = /^(?:none|nothing|no next steps|no follow[- ]?ups?|there aren'?t any|nope)\b/i;

export function isYes(t: string) {
  return YES.test(t.trim());
}
export function isClearYes(t: string) {
  const s = t.trim();
  return CLEAR_YES.test(s) && !NEGATION.test(s.replace(/^(?:yes|yeah|yep|yup)[,!.]?\s*/i, ''));
}

// ---------------------------------------------------------------- draft helpers
export function purposeFromSubject(subject: string | null): Purpose | null {
  const s = (subject ?? '').toLowerCase();
  if (/annual review/.test(s)) return 'ANNUAL_REVIEW';
  if (/renewal/.test(s)) return 'RENEWAL';
  if (/treasury/.test(s)) return 'TREASURY_REVIEW';
  if (/check-?in/.test(s)) return 'CHECK_IN';
  if (/new (?:credit|loan|deal)/.test(s)) return 'NEW_CREDIT';
  if (/issue|problem/.test(s)) return 'ISSUE_RESOLUTION';
  if (/financials|discussion|visit/.test(s)) return 'OTHER';
  return null;
}

export function newDebriefDraft(input: {
  sessionId: string;
  rmId: string;
  accountId: string;
  accountName: string;
  meetingId: string | null;
  meetingStart: string | null;
  meetingType: DebriefDraft['meetingType'];
  meetingSubject: string | null;
  attendees: DebriefDraft['attendees'];
  now: Date;
  matched: boolean;
}): DebriefDraft {
  const purpose = purposeFromSubject(input.meetingSubject);
  return {
    id: randomUUID(),
    sessionId: input.sessionId,
    rmId: input.rmId,
    accountId: input.accountId,
    accountName: input.accountName,
    meetingId: input.meetingId,
    meetingStart: input.meetingStart,
    meetingType: input.meetingType,
    purpose: purpose ?? 'OTHER',
    attendees: input.attendees,
    summary: '',
    clientNeeds: '',
    riskSignals: '',
    nextSteps: [],
    opportunities: [],
    specialistInterest: [],
    contactUpdates: [],
    flags: {
      complaint: { flagged: false, locked: true },
      mnpi: { flagged: false },
      sensitive: { flagged: false },
      risk: { flagged: false },
    },
    missingFields: purpose ? [] : ['purpose'],
    gapQuestionsAsked: 0,
    pendingGap: null,
    skippedGaps: [],
    pendingApprovalId: null,
    noNextSteps: false,
    status: 'CAPTURING',
    flowState: input.matched ? 'MATCH_MEETING' : 'MATCH_MEETING',
    updatedAt: input.now.toISOString(),
  };
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\b(the|a|an|to|about|on|for)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Dice coefficient on bigrams — used for dedupe here and fuzzy matching in evals. */
export function similarity(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  if (x === y) return 1;
  const grams = (s: string) => {
    const g = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) g.set(s.slice(i, i + 2), (g.get(s.slice(i, i + 2)) ?? 0) + 1);
    return g;
  };
  const gx = grams(x);
  const gy = grams(y);
  let overlap = 0;
  for (const [k, v] of gx) overlap += Math.min(v, gy.get(k) ?? 0);
  const total = Math.max(1, x.length - 1 + (y.length - 1));
  return (2 * overlap) / total;
}

function mergeText(a: string, b: string): string {
  if (!b.trim()) return a;
  if (!a.trim()) return b.trim();
  if (a.includes(b.trim())) return a;
  return `${a.trim()} ${b.trim()}`;
}

function mergeSteps(existing: NextStep[], incoming: NextStep[]): NextStep[] {
  const out = [...existing];
  for (const s of incoming) {
    const dup = out.find((e) => similarity(e.title, s.title) >= 0.8);
    if (dup) {
      if (!dup.ownerName && s.ownerName) Object.assign(dup, { ownerType: s.ownerType, ownerId: s.ownerId, ownerName: s.ownerName });
      if (!dup.dueDate && s.dueDate) dup.dueDate = s.dueDate;
      dup.clientCommitment = dup.clientCommitment || s.clientCommitment;
    } else {
      out.push(s);
    }
  }
  return out;
}

/** Applies guardrails to one RM utterance. Flags are the OR of the pattern layer and the model layer. */
const TRIVIAL = /^(?:yes|yeah|yep|yup|no|nope|skip|confirm(?:ed)?|ok(?:ay)?|sure|correct|right|not yet|go ahead|hold off|create it|approve[d]?)\b[\s,.!]*(?:\w+[\s,.!]*){0,3}$/i;
const NOT_FLAGGED: FlagClassification = { complaint: { flagged: false }, mnpi: { flagged: false }, sensitive: { flagged: false, categories: [] } };

async function applyGuardrails(draft: DebriefDraft, text: string, model: AgentModel): Promise<{ replies: Reply[]; flags: FlagEvent[] }> {
  const replies: Reply[] = [];
  const flags: FlagEvent[] = [];
  // The pattern layer runs on every utterance; the model layer is skipped for plain confirmations ("yes", "confirm").
  const cls = TRIVIAL.test(text.trim()) ? NOT_FLAGGED : await model.classifyFlags(text);
  const [pc, pm, ps] = [detectComplaint(text), detectMnpi(text), detectSensitive(text)];

  if ((pc.flagged || cls.complaint.flagged) && !draft.flags.complaint.flagged) {
    draft.flags.complaint = {
      flagged: true,
      locked: true,
      summary: pc.summary ?? cls.complaint.summary ?? 'Client expressed dissatisfaction.',
      evidence: pc.evidence ?? cls.complaint.evidence ?? text,
    };
    const msg = "I'm logging that as a complaint, per policy.";
    replies.push({ text: msg, kind: 'FLAG' });
    flags.push({ flag: 'COMPLAINT', message: 'Logged as a complaint, per policy' });
  }
  if ((pm.flagged || cls.mnpi.flagged) && !draft.flags.mnpi.flagged) {
    draft.flags.mnpi = { flagged: true, evidence: pm.evidence ?? cls.mnpi.evidence ?? text };
    replies.push({ text: "That may be inside information. I've flagged it for compliance review, and it won't go in any email.", kind: 'FLAG' });
    flags.push({ flag: 'MNPI', message: 'Flagged for compliance review: possible inside information' });
  }
  if (ps.flagged || cls.sensitive.flagged) {
    const categories = [...new Set([...(draft.flags.sensitive.categories ?? []), ...ps.categories, ...cls.sensitive.categories])];
    const wasFlagged = draft.flags.sensitive.flagged;
    draft.flags.sensitive = { ...draft.flags.sensitive, flagged: true, categories, evidence: draft.flags.sensitive.evidence ?? ps.evidence ?? text };
    if (!wasFlagged) {
      replies.push({
        text: `That includes personal ${categories[0] ?? 'sensitive'} information, so I've left it out of the notes. Say "keep it" if it belongs in the record.`,
        kind: 'FLAG',
      });
      flags.push({ flag: 'SENSITIVE', message: `Personal ${categories[0] ?? 'sensitive'} detail left out of the notes` });
    }
  }
  return { replies, flags };
}

/** Whatever the model wrote, sentences with sensitive personal detail stay out of the record (C-05). */
function withoutSensitive(text: string): string {
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !detectSensitive(sentence).flagged)
    .join(' ');
}

async function mergeNarrative(draft: DebriefDraft, text: string, ctx: DebriefContext, model: AgentModel, prefetched?: DebriefExtraction): Promise<void> {
  const raw = prefetched ?? (await model.extractDebrief(text, ctx));
  const ex = draft.flags.sensitive.kept ? raw : { ...raw, summary: withoutSensitive(raw.summary), clientNeeds: withoutSensitive(raw.clientNeeds), riskSignals: withoutSensitive(raw.riskSignals) };
  draft.summary = mergeText(draft.summary, ex.summary);
  draft.clientNeeds = mergeText(draft.clientNeeds, ex.clientNeeds);
  draft.riskSignals = mergeText(draft.riskSignals, ex.riskSignals);
  if (draft.riskSignals) draft.flags.risk = { flagged: true, summary: draft.riskSignals.split(/(?<=\.)\s/)[0] };
  draft.nextSteps = mergeSteps(draft.nextSteps, toNextSteps(ex, ctx));
  const { opportunities, ambiguousAmounts } = toOpportunities(ex, ctx);
  // Amounts are judged from the RM's own words, not a model's normalization ("one point five" stays ambiguous).
  for (const o of opportunities) {
    const re = PRODUCTS.find((p) => p.product === o.product)?.re;
    const sentence = re ? text.split(/(?<=[.!?])\s+/).find((x) => re.test(x)) : undefined;
    const heard = sentence ? findAmount(sentence) : null;
    if (heard?.ambiguous) {
      o.amount = null;
      if (!ambiguousAmounts.includes(o.product)) ambiguousAmounts.push(o.product);
    }
  }
  for (const o of opportunities) {
    const existing = draft.opportunities.find((x) => x.product === o.product);
    if (existing) {
      if (o.amount) existing.amount = o.amount;
      if (o.closeQuarter) existing.closeQuarter = o.closeQuarter;
    } else {
      draft.opportunities.push(o);
    }
  }
  for (const p of ambiguousAmounts) {
    const key = `opportunity.amount:${p}`;
    if (!draft.missingFields.includes(key)) draft.missingFields.push(key);
  }
  // Deterministic keyword detection is OR'd with the model (bias to recall, like the guardrails).
  const keywordSpecialties = SPECIALTY_KEYWORDS.filter((k) => k.re.test(text)).map((k) => k.specialty);
  draft.specialistInterest = [...new Set([...draft.specialistInterest, ...ex.specialistInterest, ...keywordSpecialties])];
  for (const cu of toContactUpdates(ex, ctx)) if (!draft.contactUpdates.some((c) => c.name === cu.name)) draft.contactUpdates.push(cu);
  if (draft.missingFields.includes('purpose') && ex.purpose !== 'OTHER') {
    draft.purpose = ex.purpose;
    draft.missingFields = draft.missingFields.filter((f) => f !== 'purpose');
  }
  draft.noNextSteps = draft.noNextSteps || ex.noNextSteps;
}

// ---------------------------------------------------------------- gaps (F01-FR4)
function complaintHandled(draft: DebriefDraft): boolean {
  if (!draft.flags.complaint.flagged) return true;
  const evidence = (draft.flags.complaint.evidence ?? '').toLowerCase();
  const names = draft.attendees.filter((a) => a.external).map((a) => firstName(a.name).toLowerCase());
  const complainant = names.find((n) => evidence.includes(n));
  return draft.nextSteps.some((s) => {
    const t = s.title.toLowerCase();
    if (s.suggested) return false;
    if (complainant && t.includes(complainant)) return true;
    if (/complain|issue|wire|fee|billing|resolve/.test(t)) return true;
    return s.ownerType === 'TEAM';
  });
}

function complaintSubject(draft: DebriefDraft): { who: string; topic: string } {
  const evidence = draft.flags.complaint.evidence ?? '';
  const who = draft.attendees.filter((a) => a.external).map((a) => firstName(a.name)).find((n) => evidence.includes(n)) ?? 'the client';
  const topic = (draft.flags.complaint.summary ?? '').replace(/^Client raised /, '').replace(/\.$/, '') || 'their concern';
  return { who, topic };
}

export function computeGaps(draft: DebriefDraft): Gap[] {
  const gaps: Gap[] = [];
  const skipped = new Set(draft.skippedGaps);
  const add = (g: Gap) => {
    if (!skipped.has(`${g.type}:${g.ref ?? ''}`)) gaps.push(g);
  };
  const spoken = draft.nextSteps.filter((s) => !s.suggested);

  // Priority 1: next-step owner/date
  if (!complaintHandled(draft)) {
    const { who, topic } = complaintSubject(draft);
    const about = topic === 'their concern' ? 'their concern' : `the ${topic}`;
    add({ type: 'COMPLAINT_FOLLOWUP', question: `Who should follow up with ${who} on ${about}, and by when?` });
  }
  if (!spoken.length && !draft.noNextSteps) add({ type: 'NO_STEPS', question: 'What are the next steps, and who owns them?' });
  for (const s of spoken) {
    if (!s.include) continue;
    const t = s.title.charAt(0).toLowerCase() + s.title.slice(1);
    if (!s.ownerName && !s.dueDate) add({ type: 'STEP_OWNER_DATE', ref: s.id, question: `Who will ${t}, and by when?` });
    else if (!s.ownerName) add({ type: 'STEP_OWNER', ref: s.id, question: `Who owns "${s.title}"?` });
    else if (!s.dueDate) add({ type: 'STEP_DATE', ref: s.id, question: `When should "${s.title}" be done?` });
  }
  // Priority 2: opportunity amount/timing
  for (const o of draft.opportunities) {
    const p = o.product.toLowerCase();
    if (o.amount === null) add({ type: 'OPP_AMOUNT', ref: o.id, question: `About how much is the ${p} for?` });
    else if (!o.closeQuarter) add({ type: 'OPP_TIMING', ref: o.id, question: `When do they expect to close the ${p}?` });
  }
  // Priority 3: purpose
  if (draft.missingFields.includes('purpose')) add({ type: 'PURPOSE', question: 'What was the main purpose of the meeting?' });
  return gaps;
}

function refreshMissing(draft: DebriefDraft): void {
  const keepPurpose = draft.missingFields.includes('purpose');
  // Amounts heard but ambiguous stay flagged until the RM gives a number (G5).
  const ambiguous = draft.missingFields.filter((f) => f.startsWith('opportunity.amount:') && draft.opportunities.some((o) => `opportunity.amount:${o.product}` === f && o.amount === null));
  draft.missingFields = [
    ...(keepPurpose ? ['purpose'] : []),
    ...ambiguous,
    ...computeGaps({ ...draft, skippedGaps: [] }).filter((g) => g.type !== 'PURPOSE').map((g) => g.question),
  ];
}

/** Specialist intros the RM didn't already cover (e.g. "Introduce FX specialist"). */
export function addSuggestedSteps(draft: DebriefDraft, rm: { id: string; name: string }): void {
  const kept = draft.nextSteps.filter((s) => !s.suggested);
  const covered = (sp: Specialty) => {
    if (sp === 'EQUIPMENT_FINANCE' && draft.opportunities.some((o) => /equipment/i.test(o.product))) return true;
    if (sp === 'SBA' && draft.opportunities.some((o) => /sba/i.test(o.product))) return true;
    return kept.some((s) => TEAM_SPECIALTY[s.ownerName] === sp || s.title.toLowerCase().includes(SPECIALTY_LABEL[sp].toLowerCase()));
  };
  const suggestions: NextStep[] = draft.specialistInterest.filter((sp) => !covered(sp)).map((sp) => {
    const prior = draft.nextSteps.find((s) => s.suggested && s.title === `Introduce ${SPECIALTY_LABEL[sp]} specialist`);
    return prior ?? {
      id: randomUUID(),
      title: `Introduce ${SPECIALTY_LABEL[sp]} specialist`,
      ownerType: 'RM',
      ownerId: rm.id,
      ownerName: rm.name,
      dueDate: null,
      clientCommitment: false,
      include: true,
      suggested: true,
    };
  });
  draft.nextSteps = [...kept, ...suggestions];
}

async function answerGap(draft: DebriefDraft, gap: Gap, text: string, ctx: DebriefContext, model: AgentModel): Promise<void> {
  const step = gap.ref ? draft.nextSteps.find((s) => s.id === gap.ref) : undefined;
  const opp = gap.ref ? draft.opportunities.find((o) => o.id === gap.ref) : undefined;
  switch (gap.type) {
    case 'COMPLAINT_FOLLOWUP':
    case 'NO_STEPS': {
      if (gap.type === 'NO_STEPS' && NONE.test(text.trim())) {
        draft.noNextSteps = true;
        return;
      }
      const ex = await model.extractDebrief(text, ctx);
      let steps = toNextSteps(ex, ctx);
      if (!steps.length && gap.type === 'COMPLAINT_FOLLOWUP') {
        const { who, topic } = complaintSubject(draft);
        const od = parseOwnerDateAnswer(text, ctx);
        steps = toNextSteps({ ...ex, nextSteps: [{ title: `Follow up with ${who} on ${topic}`, ownerName: od.ownerName ?? 'RM', dueDateText: od.dueDateText, clientCommitment: false }] }, ctx);
      }
      if (gap.type === 'COMPLAINT_FOLLOWUP') {
        const { topic } = complaintSubject(draft);
        steps = steps.map((s) => (/^(call|follow up with|reach out to|email|contact)\b/i.test(s.title) && !/\babout\b|\bon\b/i.test(s.title) && topic !== 'their concern' ? { ...s, title: `${s.title} about ${topic}` } : s));
      }
      draft.nextSteps = mergeSteps(draft.nextSteps, steps);
      draft.specialistInterest = [...new Set([...draft.specialistInterest, ...ex.specialistInterest])];
      return;
    }
    case 'STEP_OWNER':
    case 'STEP_DATE':
    case 'STEP_OWNER_DATE': {
      if (!step) return;
      const od = parseOwnerDateAnswer(text, ctx);
      if (od.ownerName) {
        const ownerSteps = toNextSteps({ ...(await model.extractDebrief('', ctx)), nextSteps: [{ title: step.title, ownerName: od.ownerName, dueDateText: '', clientCommitment: false }] }, ctx);
        const o = ownerSteps[0];
        Object.assign(step, { ownerType: o.ownerType, ownerId: o.ownerId, ownerName: o.ownerName });
      }
      const due = resolveDueDate(od.dueDateText || text, ctx.meetingDate);
      if (due) step.dueDate = due;
      return;
    }
    case 'OPP_AMOUNT': {
      if (!opp) return;
      let a = findAmount(text);
      if (a?.ambiguous && /million/i.test(text)) a = findAmount(`${a.text} million`);
      if (a?.value) {
        opp.amount = a.value;
        draft.missingFields = draft.missingFields.filter((f) => f !== `opportunity.amount:${opp.product}`);
      }
      const q = resolveQuarter(text, ctx.meetingDate);
      if (q && !opp.closeQuarter) opp.closeQuarter = q;
      return;
    }
    case 'OPP_TIMING': {
      if (!opp) return;
      const q = resolveQuarter(text, ctx.meetingDate);
      if (q) opp.closeQuarter = q;
      return;
    }
    case 'PURPOSE': {
      const ex = await model.extractDebrief(`Meeting purpose: ${text}`, { ...ctx, meetingSubject: text });
      draft.purpose = ex.purpose;
      draft.missingFields = draft.missingFields.filter((f) => f !== 'purpose');
      return;
    }
  }
}

/** Next step after capturing: ask a gap question (≤ 3) or read back. */
function advance(draft: DebriefDraft, ctx: DebriefContext, replies: Reply[]): void {
  const gaps = computeGaps(draft);
  if (gaps.length && draft.gapQuestionsAsked < MAX_GAP_QUESTIONS) {
    const g = gaps[0];
    draft.pendingGap = g;
    draft.gapQuestionsAsked += 1;
    draft.flowState = 'GAP_FILL';
    replies.push({ text: g.question, kind: 'QUESTION' });
    return;
  }
  draft.pendingGap = null;
  readBack(draft, ctx, replies);
}

function readBack(draft: DebriefDraft, ctx: DebriefContext, replies: Reply[]): void {
  addSuggestedSteps(draft, ctx.rm);
  refreshMissing(draft);
  draft.status = 'REVIEW';
  replies.push({ text: buildReadBack(draft, ctx.rm.name), kind: 'READ_BACK' });
  askNextApprovalOrConfirm(draft, replies);
}

function askNextApprovalOrConfirm(draft: DebriefDraft, replies: Reply[]): void {
  const pending = draft.opportunities.find((o) => !o.approved && o.amount !== null && !draft.skippedGaps.includes(`APPROVAL:${o.id}`));
  if (pending) {
    draft.pendingApprovalId = pending.id;
    draft.flowState = 'APPROVE_OPPORTUNITY';
    replies.push({ text: approvalQuestion(pending), kind: 'QUESTION' });
    return;
  }
  draft.pendingApprovalId = null;
  draft.flowState = 'CONFIRM';
  replies.push({ text: 'Say "confirm" to save to Salesforce, or tell me what to change.', kind: 'QUESTION' });
}

/** CONFIRM-state corrections: "make it three million", "move the term sheet to Monday", "drop the FX intro". */
async function applyCorrection(draft: DebriefDraft, text: string, ctx: DebriefContext, model: AgentModel): Promise<string[]> {
  const changes: string[] = [];
  const amount = findAmount(text);
  if (amount?.value && draft.opportunities.length && /\b(amount|make it|it'?s|should be|change|actually)\b/i.test(text)) {
    const o = draft.opportunities[0];
    o.amount = amount.value;
    o.approved = false; // a changed amount needs a fresh approval (C-02)
    draft.skippedGaps = draft.skippedGaps.filter((g) => g !== `APPROVAL:${o.id}`);
    changes.push(`the ${o.product.toLowerCase()} amount`);
  }
  const drop = text.match(/\b(?:drop|remove|delete|exclude|don'?t (?:create|include))\s+(?:the\s+)?(.+)$/i);
  if (drop) {
    const target = draft.nextSteps.map((s) => ({ s, score: similarity(s.title, drop[1]) })).sort((a, b) => b.score - a.score)[0];
    if (target && target.score > 0.3) {
      target.s.include = false;
      changes.push(`removed "${target.s.title}"`);
    }
  }
  const move = text.match(/\b(?:move|push|change|set)\s+(?:the\s+)?(.+?)\s+(?:to|for|until)\s+(.+)$/i);
  if (move && !drop) {
    const target = draft.nextSteps.map((s) => ({ s, score: similarity(s.title, move[1]) })).sort((a, b) => b.score - a.score)[0];
    const due = resolveDueDate(move[2], ctx.meetingDate);
    if (target && target.score > 0.25 && due) {
      target.s.dueDate = due;
      changes.push(`"${target.s.title}" now due ${spokenDate(due)}`);
    }
  }
  if (!changes.length) {
    const before = draft.nextSteps.length;
    await mergeNarrative(draft, text, ctx, model);
    if (draft.nextSteps.length > before) changes.push('added the new next step');
    else changes.push('updated the notes');
  }
  return changes;
}

// ---------------------------------------------------------------- entry points
export function openingLine(proposed: { accountName: string; startLabel: string; attendees: string[] } | null, resume?: { accountName: string }): string {
  if (resume) return `Resume your ${resume.accountName} debrief? Everything you said is still here. Say yes to continue.`;
  if (!proposed) return 'Which client meeting do you want to debrief?';
  const who = proposed.attendees.length ? ` with ${proposed.attendees.join(' and ')}` : '';
  return `Your ${proposed.startLabel} was ${proposed.accountName}${who}. Is that the one?`;
}

export async function debriefTurn(input: {
  draft: DebriefDraft;
  text: string;
  ctx: DebriefContext;
  model: AgentModel;
  now: Date;
  /** Voice only: speak something right away on long narratives while extraction runs (first audio ≤ 1.5 s). */
  onEarlyReply?: (r: Reply) => void;
}): Promise<DebriefTurnResult> {
  const draft: DebriefDraft = structuredClone(input.draft);
  const { ctx, model } = input;
  const text = input.text.trim();
  const replies: Reply[] = [];
  const flags: FlagEvent[] = [];
  let action: DebriefAction | undefined;
  const finish = (): DebriefTurnResult => {
    draft.updatedAt = input.now.toISOString();
    return { draft, replies, flags, action };
  };

  const narrative = ['OPEN_FLOOR', 'MATCH_MEETING'].includes(draft.flowState) && text.split(/\s+/).length > 12;
  let earlyComplaint = false;
  if (input.onEarlyReply && narrative) {
    earlyComplaint = detectComplaint(text).flagged && !draft.flags.complaint.flagged;
    input.onEarlyReply(earlyComplaint ? { text: "I'm logging that as a complaint, per policy.", kind: 'FLAG' } : { text: 'Got it.', kind: 'TEXT' });
  }

  // Guardrails run on every RM utterance, in every state (F01-FR5). Extraction runs alongside on narratives.
  const extraction = narrative && draft.flowState === 'OPEN_FLOOR' ? model.extractDebrief(text, ctx) : null;
  const g = await applyGuardrails(draft, text, model);
  replies.push(...g.replies.filter((r) => !(earlyComplaint && r.kind === 'FLAG' && r.text.startsWith("I'm logging that as a complaint"))));
  flags.push(...g.flags);
  const prefetched = extraction ? await extraction : undefined;

  if (KEEP_SENSITIVE.test(text) && draft.flags.sensitive.flagged) {
    draft.flags.sensitive.kept = true;
    if (draft.flags.sensitive.evidence) draft.summary = mergeText(draft.summary, draft.flags.sensitive.evidence);
    replies.push({ text: "Okay, I'll keep it in the record. It will go to compliance for review.", kind: 'TEXT' });
    return finish();
  }

  switch (draft.flowState) {
    case 'MATCH_MEETING': {
      if (isYes(text) && text.split(/\s+/).length <= 8) {
        draft.flowState = 'OPEN_FLOOR';
        replies.push({ text: 'Go ahead, tell me how it went.', kind: 'TEXT' });
        return finish();
      }
      if (NO.test(text) || text.split(/\s+/).length <= 6) {
        action = { type: 'REMATCH', query: text };
        return finish();
      }
      // RM skipped confirmation and started talking: treat as confirmed and capture what they said.
      draft.flowState = 'OPEN_FLOOR';
    }
    // falls through
    case 'OPEN_FLOOR': {
      await mergeNarrative(draft, text, ctx, model, prefetched);
      if (JUST_SAVE.test(text)) {
        addSuggestedSteps(draft, ctx.rm);
        refreshMissing(draft);
        action = { type: 'SAVE', mode: 'JUST_SAVE', utterance: text };
        return finish();
      }
      advance(draft, ctx, replies);
      return finish();
    }
    case 'GAP_FILL': {
      const gap = draft.pendingGap;
      if (JUST_SAVE.test(text)) {
        addSuggestedSteps(draft, ctx.rm);
        refreshMissing(draft);
        action = { type: 'SAVE', mode: 'JUST_SAVE', utterance: text };
        return finish();
      }
      if (gap) {
        if (SKIP.test(text)) draft.skippedGaps.push(`${gap.type}:${gap.ref ?? ''}`);
        else await answerGap(draft, gap, text, ctx, model);
        // An unanswerable gap is not asked twice.
        if (computeGaps(draft).some((x) => x.type === gap.type && x.ref === gap.ref)) draft.skippedGaps.push(`${gap.type}:${gap.ref ?? ''}`);
      }
      advance(draft, ctx, replies);
      return finish();
    }
    case 'READ_BACK':
    case 'APPROVE_OPPORTUNITY': {
      const opp = draft.opportunities.find((o) => o.id === draft.pendingApprovalId);
      if (JUST_SAVE.test(text)) {
        action = { type: 'SAVE', mode: 'JUST_SAVE', utterance: text };
        return finish();
      }
      if (opp) {
        // Only a clear yes counts; anything else = not approved (docs/05 §4).
        opp.approved = isClearYes(text);
        draft.skippedGaps.push(`APPROVAL:${opp.id}`);
        replies.push({ text: opp.approved ? 'Approved.' : "Okay, I'll hold the opportunity. It won't be created.", kind: 'TEXT' });
      }
      askNextApprovalOrConfirm(draft, replies);
      return finish();
    }
    case 'CONFIRM': {
      if (JUST_SAVE.test(text)) {
        action = { type: 'SAVE', mode: 'JUST_SAVE', utterance: text };
        return finish();
      }
      if (CONFIRM.test(text) || /^yes\b.*\bsave\b/i.test(text)) {
        action = { type: 'SAVE', mode: 'CONFIRM', utterance: text };
        return finish();
      }
      const changes = await applyCorrection(draft, text, ctx, model);
      addSuggestedSteps(draft, ctx.rm);
      refreshMissing(draft);
      replies.push({ text: `Updated: ${changes.join('; ')}.`, kind: 'TEXT' });
      askNextApprovalOrConfirm(draft, replies);
      return finish();
    }
    case 'SAVED': {
      if (/\brefer/i.test(text)) action = { type: 'OPEN_REFERRAL', specialty: draft.specialistInterest[0] };
      else if (isYes(text) || /\b(recap|draft|email)\b/i.test(text)) action = { type: 'OPEN_DRAFTS' };
      else {
        action = { type: 'END' };
        replies.push({ text: 'Okay. Your debrief is saved.', kind: 'TEXT' });
      }
      return finish();
    }
  }
  return finish();
}
