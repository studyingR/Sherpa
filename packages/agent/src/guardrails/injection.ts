/**
 * Prompt-injection defence for external text (news, emails, documents) — docs/05 §7, C-14.
 * Instruction-like sentences are stripped and the remainder is wrapped as quoted data.
 */
const INSTRUCTION_PATTERNS: RegExp[] = [
  /\bignore (?:all |any )?(?:previous|prior|above) (?:instructions|rules)\b/i,
  /\bdisregard (?:the )?(?:system|previous|above)\b/i,
  /\byou are now\b/i,
  /\bsystem prompt\b/i,
  /\b(?:approve|send|delete|transfer|wire)\b[^.]{0,40}\b(?:all|every|immediately|now)\b/i,
  /\bcall the (?:tool|function)\b/i,
  /\bact as\b/i,
];

export function sanitizeExternalText(text: string): { text: string; stripped: number } {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((s) => !INSTRUCTION_PATTERNS.some((re) => re.test(s)));
  return { text: kept.join(' ').trim(), stripped: sentences.length - kept.length };
}

export function wrapAsData(label: string, text: string): string {
  const { text: clean } = sanitizeExternalText(text);
  return `<external_data source="${label}">\n${clean.replace(/<\/?external_data[^>]*>/g, '')}\n</external_data>`;
}
