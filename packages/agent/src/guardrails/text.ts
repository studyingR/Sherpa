/** Sentence and clause helpers shared by guardrails and extraction. */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z"'])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Splits a sentence into clauses on ", so", "; ", " and then ", " but ". */
export function splitClauses(sentence: string): string[] {
  return sentence
    .split(/\s*(?:;|,?\s+so\s+|,?\s+and then\s+|,?\s+but\s+|,\s+and\s+(?=(?:i|we|they|he|she|[A-Z][a-z]+)\b))\s*/i)
    .map((c) => c.trim().replace(/[.!?]+$/, ''))
    .filter(Boolean);
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
