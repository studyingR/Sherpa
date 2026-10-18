/**
 * Deal intake (F07): collect fields (≤ 5 questions) → read back amount, term, collateral → RM confirms →
 * WriteIntent for an nCino DRAFT. Sherpa never submits to credit.
 */
import { DEAL_PRODUCT_LABEL, type DealDraft, type DealProduct } from '@sherpa/shared';
import type { AgentModel } from '../model/types';
import { amountForReadBack, findAmount, wordsToNumber } from '../speech/numbers';
import { isClearYes } from './debrief';
import type { Reply } from './debrief';

export const MAX_DEAL_QUESTIONS = 5;
export const DEAL_REQUIRED = ['product', 'amount', 'purpose', 'termMonths', 'collateral', 'requestedTiming'] as const;

const QUESTIONS: Record<(typeof DEAL_REQUIRED)[number], string> = {
  product: 'What type of credit is it: term loan, line of credit, equipment, real estate, or SBA?',
  amount: 'How much are they asking for?',
  purpose: "What's the money for?",
  termMonths: 'What term are they looking for?',
  collateral: "What's the collateral?",
  requestedTiming: 'When do they need it?',
};

export function parseTermMonths(text: string): number | null {
  const m = text.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|twenty-five|thirty)[- ](year|yr|month|mo)s?\b/i);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : wordsToNumber(m[1].replace('-', ' '));
  if (!n) return null;
  return /^(year|yr)/i.test(m[2]) ? n * 12 : n;
}

export function missingDealFields(d: DealDraft): string[] {
  return DEAL_REQUIRED.filter((f) => {
    const v = d[f];
    return v === null || v === '' || v === undefined;
  });
}

export async function applyDealText(draft: DealDraft, text: string, model: AgentModel, targetField?: string | null): Promise<void> {
  const ex = await model.extractDeal(text);
  if (ex.product) draft.product = ex.product as DealProduct;
  const amt = findAmount(ex.amountText || text);
  if (amt?.value && (ex.amountText || targetField === 'amount')) draft.amount = amt.value;
  if (ex.purpose) draft.purpose = ex.purpose;
  if (ex.useOfProceeds) draft.useOfProceeds = ex.useOfProceeds;
  const term = parseTermMonths(ex.termText || (targetField === 'termMonths' ? text : ''));
  if (term) draft.termMonths = term;
  const amort = parseTermMonths(ex.amortizationText);
  if (amort) draft.amortizationMonths = amort;
  if (ex.collateral) draft.collateral = ex.collateral;
  if (ex.requestedTiming) draft.requestedTiming = ex.requestedTiming;
  if (ex.guarantors.length) draft.guarantors = [...new Set([...draft.guarantors, ...ex.guarantors])];
  if (ex.knownRisks) draft.knownRisks = draft.knownRisks ? `${draft.knownRisks} ${ex.knownRisks}` : ex.knownRisks;

  // A targeted answer that the extractor didn't recognise is taken verbatim for free-text fields.
  if (targetField === 'purpose' && !draft.purpose) draft.purpose = text;
  if (targetField === 'collateral' && !draft.collateral) draft.collateral = text.replace(/^(?:it'?s|the collateral is)\s+/i, '');
  if (targetField === 'requestedTiming' && !draft.requestedTiming) draft.requestedTiming = text;
  if (!draft.useOfProceeds && draft.purpose) draft.useOfProceeds = draft.purpose;
  draft.missingFields = missingDealFields(draft);
}

export function dealReadBack(d: DealDraft): string {
  const product = d.product ? DEAL_PRODUCT_LABEL[d.product] : 'Credit request';
  const amount = d.amount ? amountForReadBack(d.amount) : 'no amount yet';
  const term = d.termMonths ? (d.termMonths % 12 === 0 ? `${d.termMonths / 12}-year term` : `${d.termMonths}-month term`) : 'no term yet';
  const collateral = d.collateral ? `secured by ${d.collateral}` : 'no collateral yet';
  return `${product} for ${amount}, ${term}, ${collateral}. Is that right?`;
}

export async function dealTurn(input: { draft: DealDraft; text: string; model: AgentModel }): Promise<{ draft: DealDraft; replies: Reply[]; action?: { type: 'CREATE_DRAFT'; utterance: string } }> {
  const draft: DealDraft = structuredClone(input.draft);
  const text = input.text.trim();
  const replies: Reply[] = [];
  const prevTarget = draft.pendingField;

  if (draft.awaitingReadBack) {
    if (isClearYes(text)) {
      draft.awaitingReadBack = false;
      draft.readBackDone = true;
      draft.status = 'READY';
      replies.push({ text: 'Say "create draft" to put this in nCino as a draft for your review. It will not be submitted to credit.', kind: 'QUESTION' });
      return { draft, replies };
    }
    draft.awaitingReadBack = false;
    draft.readBackDone = false;
    if (text.split(/\s+/).length > 2) await applyDealText(draft, text, input.model);
    else {
      replies.push({ text: 'What should I change?', kind: 'QUESTION' });
      return { draft, replies };
    }
  } else if (draft.readBackDone && /\b(create (?:the )?draft|confirm|save it|go ahead)\b/i.test(text)) {
    return { draft, replies, action: { type: 'CREATE_DRAFT', utterance: text } };
  } else {
    const target = draft.pendingField;
    if (target && /^(skip|pass|not sure|don'?t know)\b/i.test(text)) {
      draft.pendingField = null;
    } else {
      await applyDealText(draft, text, input.model, target);
    }
    // Any change after a read-back requires a fresh read-back (F07-AC2).
    draft.readBackDone = false;
  }

  const missing = missingDealFields(draft);
  draft.missingFields = missing;
  // A question the RM skipped or couldn't answer is not asked twice in a row.
  const askable = missing.filter((f) => f !== prevTarget);
  if (askable.length && draft.questionsAsked < MAX_DEAL_QUESTIONS) {
    const f = askable[0] as (typeof DEAL_REQUIRED)[number];
    draft.pendingField = f;
    draft.questionsAsked += 1;
    replies.push({ text: QUESTIONS[f], kind: 'QUESTION' });
    return { draft, replies };
  }
  draft.pendingField = null;
  draft.awaitingReadBack = true;
  replies.push({ text: dealReadBack(draft), kind: 'READ_BACK' });
  return { draft, replies };
}
