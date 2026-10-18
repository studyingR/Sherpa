/**
 * PiiScrubber (docs/02 §6, C-13): runs before every LLM call in openai mode. Emails, phone numbers and
 * account numbers become tokens; tokens are restored in the model output.
 */
export interface ScrubResult {
  text: string;
  restore: (s: string) => string;
  tokens: number;
}

const PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: 'EMAIL', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { kind: 'PHONE', re: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g },
  { kind: 'ACCOUNT', re: /\b\d{8,17}\b/g },
];

export function scrubPii(input: string): ScrubResult {
  const map = new Map<string, string>();
  const reverse = new Map<string, string>();
  let text = input;
  const counters: Record<string, number> = {};
  for (const { kind, re } of PATTERNS) {
    text = text.replace(re, (match) => {
      const existing = reverse.get(match);
      if (existing) return existing;
      counters[kind] = (counters[kind] ?? 0) + 1;
      const token = `[${kind}_${counters[kind]}]`;
      map.set(token, match);
      reverse.set(match, token);
      return token;
    });
  }
  return {
    text,
    tokens: map.size,
    restore: (s: string) => s.replace(/\[(EMAIL|PHONE|ACCOUNT)_\d+\]/g, (t) => map.get(t) ?? t),
  };
}
