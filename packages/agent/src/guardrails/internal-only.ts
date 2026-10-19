import type { GuardResult } from '@sherpa/shared';
import { splitSentences } from './text';

/**
 * Internal-only content must never reach a client email (F03-FR5, C-04). Client drafts are built from
 * client-safe fields by construction; this scan is the second line of defence.
 */
const INTERNAL: { re: RegExp; reason: string }[] = [
  { re: /\brisk (?:rating|grade)\b/i, reason: 'internal risk rating' },
  { re: /\bcomplain\w*\b/i, reason: 'complaint handling' },
  { re: /\b(?:frustrat|dissatisf|unhappy|escalat)\w*/i, reason: 'complaint handling' },
  { re: /\bMNPI\b|\bnon-?public\b|\boff the record\b|\bacqui(?:re|sition)\b/i, reason: 'non-public information' },
  { re: /\bwatch ?list\b|\bcovenant breach\b|\bbreach risk\b/i, reason: 'internal credit view' },
  { re: /\bhealth score\b|\battrition\b|\bat risk\b/i, reason: 'internal relationship score' },
  { re: /\bRAROC\b|\bspread\b|\bpricing guidance\b|\bpricing authority\b/i, reason: 'internal pricing' },
  { re: /\bcredit (?:committee|memo|view)\b|\binternal (?:note|view)s?\b/i, reason: 'internal credit view' },
  { re: /\bdowngrad\w*\b/i, reason: 'internal risk rating' },
];

export function scanInternalOnly(body: string): { body: string; removed: GuardResult['removed'] } {
  const removed: GuardResult['removed'] = [];
  const lines = body.split('\n').map((line) => {
    if (!line.trim()) return line;
    return splitSentences(line)
      .filter((s) => {
        const hit = INTERNAL.find((p) => p.re.test(s));
        if (hit) removed.push({ phrase: s, reason: hit.reason });
        return !hit;
      })
      .join(' ');
  });
  return { body: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), removed };
}
