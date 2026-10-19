/**
 * Post-processing in code, not the LLM (docs/05 §5.1): dates, amounts, owners, quarters, attendees.
 */
import { randomUUID } from 'node:crypto';
import type { ContactUpdate, NextStep, OpportunityProposal } from '@sherpa/shared';
import { matchPerson, matchTeam, type DebriefContext } from './context';
import type { DebriefExtraction } from './schema';
import { resolveDueDate, resolveQuarter } from '../speech/dates';
import { findAmount } from '../speech/numbers';
import { canonicalProduct } from '../model/rules/debrief';
import { detectSensitive } from '../guardrails/sensitive';

export interface ResolvedOwner {
  ownerType: NextStep['ownerType'];
  ownerId?: string;
  ownerName: string;
}

export function resolveOwner(ownerName: string, ctx: DebriefContext): ResolvedOwner | null {
  const n = ownerName.trim();
  if (!n) return null;
  if (/^(rm|me|i|myself|you)$/i.test(n) || n.toLowerCase() === ctx.rm.name.toLowerCase()) {
    return { ownerType: 'RM', ownerId: ctx.rm.id, ownerName: ctx.rm.name };
  }
  const team = matchTeam(n);
  if (team) return { ownerType: 'TEAM', ownerName: team };
  const user = matchPerson(n, ctx.users);
  if (user) return user.id === ctx.rm.id ? { ownerType: 'RM', ownerId: user.id, ownerName: user.name } : { ownerType: 'USER', ownerId: user.id, ownerName: user.name };
  return null;
}

/** Step titles never carry sensitive personal detail (C-05): cut the clause that holds it. */
export function sanitizeTitle(title: string): string {
  if (!detectSensitive(title).flagged) return title;
  const cut = title.split(/\s+(?:for|during|because|while|due to|since|as)\s+/i)[0];
  return detectSensitive(cut).flagged ? 'Follow up' : cut;
}

export function toNextSteps(ex: DebriefExtraction, ctx: DebriefContext): NextStep[] {
  // "Send a term sheet" next to a single product opportunity becomes "Send equipment financing term sheet".
  const product = ex.opportunities.length === 1 ? canonicalProduct(ex.opportunities[0].product).toLowerCase() : null;
  const named = (t: string) => (product ? t.replace(/^(Send|Prepare|Draft) (?:a |the |them a |them the )?term sheet$/i, `$1 ${product} term sheet`) : t);
  return ex.nextSteps.map((s) => {
    const owner = resolveOwner(s.ownerName, ctx);
    return {
      id: randomUUID(),
      title: named(sanitizeTitle(s.title)),
      ownerType: owner?.ownerType ?? 'RM',
      ownerId: owner?.ownerId,
      // An unresolvable owner is kept as spoken so the RM can fix it on review; gap-fill asks about it.
      ownerName: owner?.ownerName ?? '',
      dueDate: resolveDueDate(s.dueDateText, ctx.meetingDate),
      clientCommitment: s.clientCommitment,
      include: true,
    };
  });
}

export function toOpportunities(ex: DebriefExtraction, ctx: DebriefContext): { opportunities: OpportunityProposal[]; ambiguousAmounts: string[] } {
  const ambiguousAmounts: string[] = [];
  const opportunities = ex.opportunities.map((raw): OpportunityProposal => {
    const o = { ...raw, product: canonicalProduct(raw.product) };
    const parsed = o.amountText ? findAmount(o.amountText) : null;
    if (parsed?.ambiguous) ambiguousAmounts.push(o.product);
    const existing = ctx.openOpportunities.find(
      (x) => x.product && x.product.toLowerCase() === o.product.toLowerCase(),
    );
    return {
      id: randomUUID(),
      product: o.product,
      amount: parsed?.value ?? null,
      closeQuarter: resolveQuarter(o.timingText, ctx.meetingDate),
      stage: 'Prospecting',
      isNew: !existing,
      ...(existing ? { existingOpportunityId: existing.id, changes: parsed?.value ? { amount: parsed.value } : {} } : {}),
      approved: false, // must be explicitly set true by the RM (C-02)
    };
  });
  return { opportunities, ambiguousAmounts };
}

export function toContactUpdates(ex: DebriefExtraction, ctx: DebriefContext): ContactUpdate[] {
  return ex.contactUpdates.map((c) => {
    const match = matchPerson(c.name, ctx.contacts);
    return { contactId: match?.id, name: match?.name ?? c.name, title: c.title || undefined, approved: false };
  });
}
