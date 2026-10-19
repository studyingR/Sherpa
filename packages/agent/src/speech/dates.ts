import * as chrono from 'chrono-node';
import { DAY_NAMES_LONG, MONTH_NAMES_LONG, parseDate, toIsoDate } from '@sherpa/shared';
import { ordinalWord } from './numbers';

/**
 * "by Friday" → ISO date relative to the meeting date (docs/05 §5.1). Business-day aware: a date that
 * lands on a weekend moves to the following Monday. Returns null when no date is spoken.
 */
export function resolveDueDate(text: string, ref: Date): string | null {
  if (!text.trim()) return null;
  const cleaned = text
    .replace(/\bend of (the )?week\b/i, 'Friday')
    .replace(/\beow\b/i, 'Friday')
    .replace(/\beod\b/i, 'today')
    .replace(/\bcob\b/i, 'today');
  const results = chrono.parse(cleaned, ref, { forwardDate: true });
  if (!results.length) return null;
  const d = results[0].start.date();
  const day = d.getDay();
  if (day === 6) d.setDate(d.getDate() + 2);
  if (day === 0) d.setDate(d.getDate() + 1);
  return toIsoDate(d);
}

/** Pulls the due-date phrase out of a clause: "send a term sheet by Friday" → { rest: "send a term sheet", dateText: "by Friday" } */
export function splitDatePhrase(clause: string): { rest: string; dateText: string } {
  const re = /\b((?:by|before|on|no later than|until|next|this|end of|within)\s+(?:the\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month|quarter|tomorrow|today|\d{1,2}(?:st|nd|rd|th)?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{0,2}|(?:two|three|four|five|\d+)\s+(?:days|weeks|business days))(?:\s+(?:week|morning|afternoon))?|tomorrow|today|next week|end of (?:the )?week|eod|eow)\b/i;
  const m = clause.match(re);
  if (!m) return { rest: clause.trim(), dateText: '' };
  const rest = (clause.slice(0, m.index) + clause.slice((m.index ?? 0) + m[0].length)).replace(/\s{2,}/g, ' ').trim();
  return { rest: rest.replace(/[,\s]+$/, ''), dateText: m[0] };
}

/** "Q1", "first quarter", "early next year", "by year end" → "Q1 2027" (next occurrence after ref). */
export function resolveQuarter(text: string, ref: Date): string | null {
  const t = text.toLowerCase();
  const refQ = Math.floor(ref.getMonth() / 3) + 1;
  const refY = ref.getFullYear();
  let q: number | null = null;
  let year: number | null = null;
  const qm = t.match(/\bq([1-4])\b(?:\s*(?:of\s*)?(20\d\d))?/) ?? t.match(/\b(first|second|third|fourth)\s+quarter\b/);
  if (qm) {
    q = ['first', 'second', 'third', 'fourth'].includes(qm[1]) ? ['first', 'second', 'third', 'fourth'].indexOf(qm[1]) + 1 : Number(qm[1]);
    if (qm[2]) year = Number(qm[2]);
  } else if (/\bnext quarter\b/.test(t)) {
    q = (refQ % 4) + 1;
    year = refQ === 4 ? refY + 1 : refY;
  } else if (/\bthis quarter\b/.test(t)) {
    q = refQ;
    year = refY;
  } else if (/\b(year[- ]end|end of (the )?year|by december)\b/.test(t)) {
    q = 4;
    year = refY;
  } else if (/\b(early next year|beginning of next year|january|february|march)\b/.test(t)) {
    q = 1;
  } else if (/\b(spring|april|may|june)\b/.test(t)) {
    q = 2;
  } else if (/\b(summer|july|august|september)\b/.test(t)) {
    q = 3;
  } else if (/\b(fall|autumn|october|november|december)\b/.test(t)) {
    q = 4;
  } else if (/\bnext year\b/.test(t)) {
    q = 1;
    year = refY + 1;
  }
  if (!q) return null;
  if (!year) year = q > refQ ? refY : refY + 1; // "Q1" after an October meeting means next year's Q1
  return `Q${q} ${year}`;
}

/** "Q1 2027" → "2027-03-31" (CloseDate = end of quarter, docs/03 §3). */
export function quarterEndDate(closeQuarter: string): string | null {
  const m = closeQuarter.match(/^Q([1-4]) (\d{4})$/);
  if (!m) return null;
  const q = Number(m[1]);
  const y = Number(m[2]);
  const end = new Date(y, q * 3, 0);
  return toIsoDate(end);
}

/** "2026-10-23" → "Friday, October twenty-third" (docs/05 §8). */
export function spokenDate(iso: string): string {
  const d = parseDate(iso);
  return `${DAY_NAMES_LONG[d.getDay()]}, ${MONTH_NAMES_LONG[d.getMonth()]} ${ordinalWord(d.getDate())}`;
}

/** "Q1 2027" → "Q1" when the year is the obvious next one, else "Q1 2027". */
export function spokenQuarter(closeQuarter: string): string {
  return closeQuarter.replace(/^Q([1-4]) (\d{4})$/, 'Q$1 $2');
}
