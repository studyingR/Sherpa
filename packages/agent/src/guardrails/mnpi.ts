import { splitSentences } from './text';

/** Material non-public information detector, deterministic layer (docs/05 §7, C-04). */
const TRIGGERS: RegExp[] = [
  /\bacqui(?:re|res|ring|sition)\b/i,
  /\bmerg(?:er|e|ing)\b/i,
  /\bnot (?:yet )?public\b/i,
  /\bnothing'?s public\b/i,
  /\bnon-?public\b/i,
  /\bconfidential (?:deal|transaction|talks)\b/i,
  /\bIPO\b/,
  /\bgoing public\b/i,
  /\bearnings before\b/i,
  /\btender offer\b/i,
  /\boff the record\b/i,
  /\bbuyout\b/i,
];

export function detectMnpi(text: string): { flagged: boolean; evidence?: string } {
  for (const sentence of splitSentences(text)) {
    if (TRIGGERS.some((re) => re.test(sentence))) {
      // Public, already-announced events are not MNPI.
      if (/\b(announced|press release|publicly|public filing|was in the news)\b/i.test(sentence)) continue;
      return { flagged: true, evidence: sentence };
    }
  }
  return { flagged: false };
}
