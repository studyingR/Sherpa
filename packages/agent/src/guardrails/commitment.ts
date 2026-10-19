import type { GuardResult } from '@sherpa/shared';
import { splitSentences } from './text';

/**
 * Commitment-language guard (docs/05 §7, F03-FR4, C-06). Runs on every client-facing draft.
 * Any sentence implying approval, guaranteed terms, rates or pricing is removed, and the RM sees what was removed.
 */
const PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /\bpre-?approv\w*\b/i, reason: 'implies credit approval' },
  { re: /\bapprov(?:ed|al)\b/i, reason: 'implies credit approval' },
  { re: /\bguarantee[ds]?\b/i, reason: 'reads as a guarantee' },
  { re: /\bwe will (?:lend|finance|fund)\b/i, reason: 'commits the bank to lend' },
  { re: /\bcommit(?:ted|ting)? to\b/i, reason: 'reads as a commitment' },
  { re: /\block(?:ed)? in\b/i, reason: 'implies locked terms' },
  { re: /\d+(?:\.\d+)?\s?%/, reason: 'states a rate or percentage' },
  { re: /\b\d+\s?(?:bps|basis points)\b/i, reason: 'states pricing' },
  { re: /\bbasis points?\b/i, reason: 'states pricing' },
  { re: /\bSOFR\s*\+?/i, reason: 'states a rate index and spread' },
  { re: /\b(?:interest )?rate of\b/i, reason: 'states a rate' },
  { re: /\bpricing (?:of|at|will be)\b/i, reason: 'states pricing' },
];

export function findCommitmentPhrases(text: string): { phrase: string; reason: string }[] {
  const out: { phrase: string; reason: string }[] = [];
  for (const sentence of splitSentences(text.replace(/\n+/g, ' \n '))) {
    for (const p of PATTERNS) {
      if (p.re.test(sentence)) {
        out.push({ phrase: sentence.trim(), reason: p.reason });
        break;
      }
    }
  }
  return out;
}

/** Removes offending sentences line by line so paragraph structure survives. */
export function applyCommitmentGuard(body: string): { body: string; result: GuardResult } {
  const removed: { phrase: string; reason: string }[] = [];
  const lines = body.split('\n').map((line) => {
    if (!line.trim()) return line;
    const kept: string[] = [];
    for (const sentence of splitSentences(line)) {
      const hit = PATTERNS.find((p) => p.re.test(sentence));
      if (hit) removed.push({ phrase: sentence, reason: hit.reason });
      else kept.push(sentence);
    }
    return kept.join(' ');
  });
  const cleaned = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const n = removed.length;
  return {
    body: cleaned,
    result: {
      passed: n === 0,
      removed,
      message: n === 0 ? 'Commitment check passed' : `We removed ${n} phrase${n === 1 ? '' : 's'} that could read as commitments`,
    },
  };
}
