import { describe, expect, it } from 'vitest';
import type { DebriefDraft } from '@sherpa/shared';
import { RuleModel } from '../model/rules';
import type { DebriefContext } from '../extraction/context';
import { MAX_GAP_QUESTIONS, debriefTurn, newDebriefDraft } from './debrief';
import { MAX_READBACK_WORDS, wordCount } from '../speech/readback';

const now = new Date(2026, 9, 19, 15, 30);
const ctx: DebriefContext = {
  accountId: 'A1',
  accountName: 'Acme Manufacturing',
  rm: { id: 'u_maya', name: 'Maya Chen' },
  meetingDate: new Date(2026, 9, 19, 14),
  meetingSubject: 'Acme Manufacturing annual review',
  attendees: [
    { name: 'Maya Chen', userId: 'u_maya', external: false },
    { name: 'Jane Ruiz', contactId: 'C1', role: 'CFO', external: true },
    { name: 'Tom Lee', contactId: 'C2', role: 'Controller', external: true },
  ],
  contacts: [
    { id: 'C1', name: 'Jane Ruiz', title: 'CFO' },
    { id: 'C2', name: 'Tom Lee', title: 'Controller' },
  ],
  users: [
    { id: 'u_maya', name: 'Maya Chen' },
    { id: 'u_priya', name: 'Priya Shah' },
  ],
  openOpportunities: [],
};

function fresh(): DebriefDraft {
  return newDebriefDraft({
    sessionId: 'S1', rmId: 'u_maya', accountId: 'A1', accountName: 'Acme Manufacturing', meetingId: 'M1',
    meetingStart: ctx.meetingDate.toISOString(), meetingType: 'IN_PERSON', meetingSubject: ctx.meetingSubject,
    attendees: ctx.attendees, now, matched: true,
  });
}

async function run(turns: string[]) {
  const model = new RuleModel();
  let draft = fresh();
  const log: { replies: string[]; action?: unknown }[] = [];
  for (const text of turns) {
    const r = await debriefTurn({ draft, text, ctx, model, now });
    draft = r.draft;
    log.push({ replies: r.replies.map((x) => x.text), action: r.action });
  }
  return { draft, log };
}

const G1 = [
  "Yes, that's the one.",
  "Good meeting. They're expanding the Newark plant and need about two and a half million in equipment financing, probably Q1. Jane complained that wires were delayed twice this month. They're starting to buy from a German supplier, so FX came up. I said I'd send a term sheet by Friday.",
  'Treasury services should call Jane by Wednesday.',
  'Yes.',
  'Confirm.',
];

describe('debrief state machine (F01)', () => {
  it('F01-AC1 G1 produces the golden draft', async () => {
    const { draft, log } = await run(G1);
    expect(draft.purpose).toBe('ANNUAL_REVIEW');
    expect(draft.flags.complaint.flagged).toBe(true);
    expect(draft.flags.mnpi.flagged).toBe(false);
    expect(draft.opportunities).toHaveLength(1);
    expect(draft.opportunities[0]).toMatchObject({ product: 'Equipment financing', amount: 2_500_000, closeQuarter: 'Q1 2027', approved: true });
    const titles = draft.nextSteps.map((s) => s.title);
    expect(titles).toEqual(['Send equipment financing term sheet', 'Call Jane about wire delays', 'Introduce FX specialist']);
    expect(draft.nextSteps[0]).toMatchObject({ ownerName: 'Maya Chen', dueDate: '2026-10-23', clientCommitment: true });
    expect(draft.nextSteps[1]).toMatchObject({ ownerType: 'TEAM', ownerName: 'Treasury Services', dueDate: '2026-10-21' });
    expect(draft.specialistInterest).toEqual(expect.arrayContaining(['FX', 'EQUIPMENT_FINANCE', 'TREASURY_MANAGEMENT']));
    expect(log[1].replies[0]).toBe("I'm logging that as a complaint, per policy.");
    expect(log[1].replies[1]).toMatch(/Who should follow up with Jane on the wire delays/);
    expect(log[4].action).toMatchObject({ type: 'SAVE', mode: 'CONFIRM' });
  });

  it('F01-AC3 G2 holds the opportunity when not approved', async () => {
    const { draft } = await run([...G1.slice(0, 3), 'Not yet, hold off.', 'Confirm.']);
    expect(draft.opportunities[0].approved).toBe(false);
  });

  it('F01-AC7 never asks more than 3 gap questions', async () => {
    const { draft } = await run([
      'Yes.',
      'They might want a new line, maybe one point five. Also I need to send something. Priya should look at it.',
      'skip',
      'skip',
      'skip',
    ]);
    expect(draft.gapQuestionsAsked).toBeLessThanOrEqual(MAX_GAP_QUESTIONS);
    expect(['APPROVE_OPPORTUNITY', 'CONFIRM']).toContain(draft.flowState);
  });

  it('G5 adds an ambiguous amount to missing fields and asks for it', async () => {
    const { draft, log } = await run(['Yes.', 'They want maybe one point five for a new line. I said I would send the term sheet by Friday.']);
    expect(draft.opportunities[0].amount).toBeNull();
    expect(draft.missingFields.join(' ')).toMatch(/opportunity.amount|How much/);
    expect(log[1].replies.join(' ')).toMatch(/how much is the line of credit/i);
  });

  it('G6 accepts "no next steps"', async () => {
    const { draft } = await run(['Yes.', 'Quick check-in, nothing to follow up.']);
    expect(draft.noNextSteps).toBe(true);
    expect(draft.nextSteps).toHaveLength(0);
    expect(draft.flowState).toBe('CONFIRM');
  });

  it('read-back stays under 110 words', async () => {
    const { log } = await run(G1.slice(0, 3));
    const readBack = log[2].replies.find((r) => r.startsWith("Here's what I have"))!;
    expect(wordCount(readBack)).toBeLessThanOrEqual(MAX_READBACK_WORDS);
  });

  it('"just save it" skips the read-back but not the opportunity approval (F01-FR9)', async () => {
    const { draft, log } = await run(['Yes.', "They need two million in equipment financing in Q2. I'll send the term sheet by Friday. Just save it."]);
    expect(log[1].action).toMatchObject({ type: 'SAVE', mode: 'JUST_SAVE' });
    expect(draft.opportunities[0].approved).toBe(false);
  });
});
