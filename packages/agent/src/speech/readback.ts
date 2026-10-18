import type { DebriefDraft, NextStep, OpportunityProposal } from '@sherpa/shared';
import { firstName } from '@sherpa/shared';
import { spokenDate } from './dates';
import { amountForReadBack, amountToWords } from './numbers';

export const MAX_READBACK_WORDS = 110; // ≈ 45 s (docs/05 §8)

export function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

export function spokenStep(s: NextStep, rmName: string): string {
  const when = s.dueDate ? ` by ${spokenDate(s.dueDate)}` : '';
  const title = lowerFirst(s.title).replace(/^(send|share|prepare|draft|review|introduce) (?!the |a |an |you|your|over )/, '$1 the ');
  if (s.ownerType === 'RM' || s.ownerName === rmName) return `you'll ${title}${when}`;
  if (s.ownerType === 'TEAM') return `${s.ownerName} will ${title}${when}`;
  return `${firstName(s.ownerName)} will ${title}${when}`;
}

export function spokenOpportunity(o: OpportunityProposal, withDigits: boolean): string {
  const amt = o.amount ? (withDigits ? amountForReadBack(o.amount) : `${amountToWords(o.amount)} dollars`) : 'amount not set';
  const q = o.closeQuarter ? `, closing ${o.closeQuarter.replace(/ \d{4}$/, '')}` : '';
  return `${o.product.toLowerCase()}, ${amt}${q}`;
}

export function approvalQuestion(o: OpportunityProposal): string {
  const verb = o.isNew ? 'Create' : 'Update';
  const amt = o.amount ? ` for ${amountToWords(o.amount)}` : '';
  const q = o.closeQuarter ? `, closing ${o.closeQuarter.replace(/ \d{4}$/, '')}` : '';
  return `${verb} the ${o.product.toLowerCase()} opportunity${amt}${q}? Say yes to approve.`;
}

/** Spoken read-back under 45 s: summary, next steps with owners and dates, opportunities (F01-FR6). */
export function buildReadBack(draft: DebriefDraft, rmName: string): string {
  const steps = draft.nextSteps.filter((s) => s.include);
  const firstSentence = draft.summary.split(/(?<=[.!?])\s+/)[0] ?? '';
  const summary = wordCount(firstSentence) <= 28 ? firstSentence : '';
  const stepText = steps.length
    ? `Next steps: ${steps.map((s) => spokenStep(s, rmName)).join('; ')}.`
    : draft.noNextSteps ? 'No next steps.' : '';
  const opps = draft.opportunities.length
    ? `Opportunity: ${draft.opportunities.map((o) => spokenOpportunity(o, true)).join('; ')}.`
    : '';
  const flags: string[] = [];
  if (draft.flags.complaint.flagged) flags.push(`I've logged the complaint${draft.flags.complaint.summary ? ` about ${draft.flags.complaint.summary.replace(/^Client raised /, '').replace(/\.$/, '')}` : ''}.`);
  if (draft.flags.mnpi.flagged) flags.push('The possible inside information is flagged for compliance.');

  let parts = ["Here's what I have.", summary, stepText, opps, ...flags].filter(Boolean);
  if (wordCount(parts.join(' ')) > MAX_READBACK_WORDS) parts = ["Here's what I have.", stepText, opps, ...flags].filter(Boolean);
  if (wordCount(parts.join(' ')) > MAX_READBACK_WORDS) {
    const short = `Next steps: ${steps.length} tasks, starting with ${steps[0] ? spokenStep(steps[0], rmName) : 'none'}.`;
    parts = ["Here's what I have.", short, opps, ...flags].filter(Boolean);
  }
  return parts.join(' ');
}
