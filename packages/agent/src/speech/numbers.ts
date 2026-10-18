/**
 * Amount parsing and spoken-number formatting (docs/05 §5.1 and §8).
 * Parsing is code, not LLM: "two and a half million" → 2_500_000.
 */

const ONES: Record<string, number> = {
  zero: 0, one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES: Record<string, number> = { thousand: 1_000, k: 1_000, million: 1_000_000, mm: 1_000_000, m: 1_000_000, mil: 1_000_000, billion: 1_000_000_000, bn: 1_000_000_000, b: 1_000_000_000 };
const DIGIT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

export interface ParsedAmount {
  value: number | null;
  /** True when a number was heard but its magnitude is unclear ("one point five" with no unit). */
  ambiguous: boolean;
  text: string;
}

const NUMBER_WORD = `(?:${[...Object.keys(ONES), ...Object.keys(TENS), 'hundred', 'and', 'half', 'quarter', 'point', 'a', 'an'].join('|')})`;
const SCALE_WORD = '(?:thousand|million|billion|mm|mil|bn|[kmb])';

/**
 * Finds the first money-like expression in text. Examples handled:
 * "$2.5M", "2.5 million", "two and a half million", "around four hundred thousand", "400k",
 * "a million", "half a million", "one point five" (ambiguous), "$750,000".
 */
export function findAmount(text: string): ParsedAmount | null {
  const t = text.toLowerCase().replace(/,(?=\d{3})/g, '');

  // Digits with optional scale: $2.5M, 2.5 million, 400k, $750000
  const digitRe = new RegExp(`\\$?\\s?(\\d+(?:\\.\\d+)?)\\s?(${SCALE_WORD})?\\b(?!\\s?%)`, 'g');
  let m: RegExpExecArray | null;
  while ((m = digitRe.exec(t))) {
    const n = parseFloat(m[1]);
    const scale = m[2] ? SCALES[m[2]] : 1;
    const hasDollar = m[0].includes('$');
    const value = n * scale;
    // Ignore bare small numbers that are clearly not money (dates, counts) unless prefixed with $.
    if (!m[2] && !hasDollar && value < 10_000) continue;
    if (/\b(q[1-4]|20\d\d)\b/.test(m[0])) continue;
    return { value: Math.round(value), ambiguous: false, text: m[0].trim() };
  }

  // Word numbers: "two and a half million", "half a million", "one point five"
  const wordRe = new RegExp(`\\b((?:${NUMBER_WORD}[\\s-]+)*${NUMBER_WORD})(?:[\\s-]+(${SCALE_WORD}))?\\b`, 'g');
  while ((m = wordRe.exec(t))) {
    const phrase = m[1].trim();
    const scaleWord = m[2];
    if (/^(a|an|and|point|half|quarter)$/.test(phrase) && !scaleWord) continue;
    const base = wordsToNumber(phrase);
    if (base === null) continue;
    if (scaleWord) {
      return { value: Math.round(base * SCALES[scaleWord]), ambiguous: false, text: `${phrase} ${scaleWord}` };
    }
    if (base >= 10_000) return { value: Math.round(base), ambiguous: false, text: phrase };
    // "one point five", "two fifty" with no unit: we heard a figure but cannot tell its scale.
    if (/point|hundred|half/.test(phrase) || base > 1) {
      if (/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/.test(phrase) && /point|half|hundred/.test(phrase)) {
        return { value: null, ambiguous: true, text: phrase };
      }
    }
  }
  return null;
}

/** Converts number words to a number. Supports "two and a half", "one point two five", "four hundred", "half a". */
export function wordsToNumber(phrase: string): number | null {
  const words = phrase.toLowerCase().replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  if (words[0] === 'half' && (words[1] === 'a' || words[1] === 'an')) return 0.5;

  const pointIdx = words.indexOf('point');
  if (pointIdx >= 0) {
    const intPart = wordsToNumber(words.slice(0, pointIdx).join(' ') || 'zero');
    const decWords = words.slice(pointIdx + 1);
    if (intPart === null || !decWords.length) return null;
    const digits = decWords.map((w) => DIGIT_WORDS.indexOf(w));
    if (digits.some((d) => d < 0)) return null;
    return parseFloat(`${intPart}.${digits.join('')}`);
  }

  let total = 0;
  let current = 0;
  let sawNumber = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === 'and') {
      // "two and a half" / "two and a quarter"
      if ((words[i + 1] === 'a' || words[i + 1] === 'an') && (words[i + 2] === 'half' || words[i + 2] === 'quarter')) {
        current += words[i + 2] === 'half' ? 0.5 : 0.25;
        i += 2;
      }
      continue;
    }
    if (w in ONES) {
      // "a one point two million", "a hundred": the article is not the number one.
      if ((w === 'a' || w === 'an') && (sawNumber || i < words.length - 1)) continue;
      current += ONES[w];
      sawNumber = true;
    } else if (w in TENS) {
      current += TENS[w];
      sawNumber = true;
    } else if (w === 'hundred') {
      current = (current || 1) * 100;
      sawNumber = true;
    } else if (w === 'half') {
      current += 0.5;
      sawNumber = true;
    } else if (w === 'quarter') {
      current += 0.25;
      sawNumber = true;
    } else {
      return null;
    }
  }
  total += current;
  return sawNumber ? total : null;
}

function under1000(n: number): string {
  const ones = Object.keys(ONES).filter((k) => !['a', 'an'].includes(k));
  const tens = Object.keys(TENS);
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h) parts.push(`${ones[h]} hundred`);
  if (r) {
    if (r < 20) parts.push(ones[r]);
    else parts.push(tens[Math.floor(r / 10) - 2] + (r % 10 ? `-${ones[r % 10]}` : ''));
  }
  return parts.join(' ') || 'zero';
}

/** 2500000 → "two point five million", 400000 → "four hundred thousand", 1250000 → "one point two five million". */
export function amountToWords(n: number): string {
  if (n >= 1_000_000) {
    const millions = n / 1_000_000;
    const [i, d] = String(Number(millions.toFixed(2))).split('.');
    const intWords = under1000(Number(i));
    if (!d) return `${intWords} million`;
    return `${intWords} point ${d.split('').map((c) => DIGIT_WORDS[Number(c)]).join(' ')} million`;
  }
  if (n >= 1_000) {
    const thousands = Math.floor(n / 1_000);
    const rest = n % 1_000;
    return `${under1000(thousands)} thousand${rest ? ` ${under1000(rest)}` : ''}`;
  }
  return under1000(Math.round(n));
}

/** F01-FR6: "two point five million — 2,500,000 dollars" */
export function amountForReadBack(n: number): string {
  const digits = Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${amountToWords(n)} — ${digits} dollars`;
}

const ORDINALS = [
  '', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh',
  'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth',
  'twentieth', 'twenty-first', 'twenty-second', 'twenty-third', 'twenty-fourth', 'twenty-fifth', 'twenty-sixth',
  'twenty-seventh', 'twenty-eighth', 'twenty-ninth', 'thirtieth', 'thirty-first',
];

export function ordinalWord(n: number): string {
  return ORDINALS[n] ?? String(n);
}
