import { splitSentences } from './text';

/** Sensitive-attribute detector (docs/05 §7, C-05): prompt the RM to remove before save. */
const CATEGORIES: { category: string; re: RegExp }[] = [
  { category: 'health', re: /\b(medical|surgery|illness|ill\b|cancer|diagnos\w*|hospital\w*|chemo\w*|disease|health (?:issue|problem|scare)|sick leave|rehab|therapy|mental health)\b/i },
  { category: 'pregnancy', re: /\b(pregnan\w*|maternity|expecting a baby)\b/i },
  { category: 'disability', re: /\b(disabilit\w*|disabled|wheelchair)\b/i },
  { category: 'religion', re: /\b(religio\w*|church|mosque|synagogue|temple|christian|muslim|jewish|hindu)\b/i },
  { category: 'race or national origin', re: /\b(race|racial|ethnic\w*|immigra\w*|national origin|nationality)\b/i },
  { category: 'age', re: /\b(\d{2} years old|too old|elderly|his age|her age)\b/i },
  { category: 'sexual orientation', re: /\b(gay|lesbian|sexual orientation|transgender)\b/i },
  { category: 'marital status', re: /\b(divorc\w*|separated from (?:his|her) (?:wife|husband))\b/i },
];

export interface SensitiveResult {
  flagged: boolean;
  categories: string[];
  evidence?: string;
  sentences: string[];
}

export function detectSensitive(text: string): SensitiveResult {
  const categories = new Set<string>();
  const sentences: string[] = [];
  for (const sentence of splitSentences(text)) {
    let hit = false;
    for (const c of CATEGORIES) {
      if (c.re.test(sentence)) {
        categories.add(c.category);
        hit = true;
      }
    }
    if (hit) sentences.push(sentence);
  }
  return { flagged: categories.size > 0, categories: [...categories], evidence: sentences[0], sentences };
}
