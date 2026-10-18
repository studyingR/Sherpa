import { splitSentences } from './text';

/**
 * Complaint detector, deterministic layer (docs/05 §7). Bias to recall: an LLM classifier result is OR'd in.
 * "she complimented the wire team" must not flag; "the rate was frustrating" must flag.
 */
const TRIGGERS: RegExp[] = [
  /\bcomplain(?:ed|s|ing|t|ts)?\b/i,
  /\bunhappy (?:with|about)\b/i,
  /\bnot happy (?:with|about)\b/i,
  /\bdissatisfied\b/i,
  /\bfrustrat(?:ed|ing|ion)\b/i,
  /\bupset (?:with|about)\b/i,
  /\bdelayed\b/i,
  /\berror(?:s)? on\b/i,
  /\bmistake(?:s)? on\b/i,
  /\bcharged (?:us |them |him |her )?(?:wrong|twice|incorrectly)\b/i,
  /\bovercharged\b/i,
  /\bwrong(?:ly)? charged\b/i,
  /\bescalat(?:e|ed|ing)\b/i,
  /\bfile a complaint\b/i,
  /\blost money because\b/i,
  /\bthreaten(?:ed|ing)? to (?:leave|move)\b/i,
  /\bpoor service\b/i,
];

const NEGATIONS: RegExp[] = [
  /\bno (?:complaints?|issues|problems|delays)\b/i,
  /\b(?:didn't|did not|never|wasn't|isn't|not) (?:complain|frustrated|delayed|upset|unhappy)\w*/i,
  /\bnothing to complain\b/i,
];

export interface ComplaintResult {
  flagged: boolean;
  summary?: string;
  evidence?: string;
  topic?: string;
}

export function detectComplaint(text: string): ComplaintResult {
  for (const sentence of splitSentences(text)) {
    const hit = TRIGGERS.find((re) => re.test(sentence));
    if (!hit) continue;
    // Negation only cancels when it covers the same trigger (e.g. "no delays"), not the whole sentence.
    const negated = NEGATIONS.some((n) => n.test(sentence)) && !/\bbut\b/i.test(sentence);
    if (negated) continue;
    const topic = complaintTopic(sentence);
    return {
      flagged: true,
      evidence: sentence,
      topic,
      summary: topic ? `Client raised ${topic}.` : 'Client expressed dissatisfaction with a bank service.',
    };
  }
  return { flagged: false };
}

/** "wires were delayed twice" → "wire delays"; "charged wrong on the analysis statement" → "a billing error". */
export function complaintTopic(sentence: string): string | undefined {
  const s = sentence.toLowerCase();
  const m = s.match(/\b([a-z]+?)s? (?:were|was|have been|has been|got|keep getting) (delayed|late|slow|wrong|rejected|returned)/);
  if (m) {
    const noun = m[1];
    const kind = m[2] === 'wrong' ? 'errors' : m[2] === 'rejected' || m[2] === 'returned' ? 'rejections' : 'delays';
    return `${noun} ${kind}`;
  }
  if (/\b(fee|fees|charge|charged|overcharged|billing)\b/.test(s)) return 'a fee or billing problem';
  if (/\brate\b/.test(s)) return 'concerns about their rate';
  if (/\bservice\b/.test(s)) return 'a service problem';
  return undefined;
}
