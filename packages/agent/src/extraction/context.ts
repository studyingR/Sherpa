import { INTERNAL_TEAMS, type Specialty } from '@sherpa/shared';

/** Everything extraction needs to resolve names, owners and dates. */
export interface DebriefContext {
  accountId: string;
  accountName: string;
  rm: { id: string; name: string };
  /** Meeting date — relative dates ("by Friday") resolve against this. */
  meetingDate: Date;
  meetingSubject: string | null;
  attendees: { name: string; contactId?: string; userId?: string; role?: string; external: boolean }[];
  contacts: { id: string; name: string; title: string }[];
  users: { id: string; name: string }[];
  openOpportunities: { id: string; name: string; product: string | null }[];
}

export const TEAM_ALIASES: { team: string; re: RegExp }[] = [
  { team: 'Treasury Services', re: /\b(treasury(?: services| management| team)?|tm team|cash management)\b/i },
  { team: 'Credit Admin', re: /\bcredit(?: admin(?:istration)?| team)\b/i },
  { team: 'Portfolio Management', re: /\bportfolio(?: management| team)?\b/i },
  { team: 'FX Desk', re: /\b(fx(?: desk| team)?|foreign exchange team)\b/i },
  { team: 'Wealth', re: /\bwealth(?: team| management)?\b/i },
  { team: 'SBA Desk', re: /\bsba(?: desk| team)\b/i },
  { team: 'Capital Markets', re: /\bcapital markets\b/i },
  { team: 'Equipment Finance', re: /\bequipment finance(?: team)?\b/i },
  { team: 'Merchant Services', re: /\bmerchant(?: services)?(?: team)?\b/i },
];

export const TEAM_SPECIALTY: Record<string, Specialty> = {
  'Treasury Services': 'TREASURY_MANAGEMENT',
  'FX Desk': 'FX',
  Wealth: 'WEALTH',
  'SBA Desk': 'SBA',
  'Capital Markets': 'CAPITAL_MARKETS',
  'Equipment Finance': 'EQUIPMENT_FINANCE',
  'Merchant Services': 'MERCHANT_SERVICES',
};

export const SPECIALTY_KEYWORDS: { specialty: Specialty; re: RegExp }[] = [
  { specialty: 'FX', re: /\b(fx|foreign exchange|foreign currency|german|european|euro|yen|peso|overseas supplier|foreign supplier|international (?:payments|wires|supplier)|hedg\w*|imports?|importing)\b/i },
  { specialty: 'EQUIPMENT_FINANCE', re: /\b(equipment financ\w*|equipment (?:loan|lease)|new (?:machines|machinery|trucks|fleet))\b/i },
  { specialty: 'TREASURY_MANAGEMENT', re: /\b(wires? (?:were|was|have been|are|keep) (?:being )?(?:delayed|slow|late|rejected|returned)|wire (?:issues|problems|volume|fraud)|ach (?:origination|issues|fraud)|treasury management|cash management|positive pay|lockbox|sweep|remote deposit)\b/i },
  { specialty: 'MERCHANT_SERVICES', re: /\b(card payments?|accept (?:credit )?cards|merchant services?|point of sale|pos system|card processing)\b/i },
  { specialty: 'SBA', re: /\bsba\b/i },
  { specialty: 'WEALTH', re: /\b(wealth|retirement plan|401\(?k\)?|estate planning|personal investments?|succession)\b/i },
  { specialty: 'CAPITAL_MARKETS', re: /\b(interest rate swap|swap|syndicat\w*|capital markets|bond issue|private placement)\b/i },
];

export function matchTeam(text: string): string | null {
  const t = INTERNAL_TEAMS.find((team) => team.toLowerCase() === text.trim().toLowerCase());
  if (t) return t;
  return TEAM_ALIASES.find((a) => a.re.test(text))?.team ?? null;
}

/** First-name or full-name match against a list. */
export function matchPerson<T extends { name: string }>(text: string, people: T[]): T | null {
  const t = text.trim().toLowerCase().replace(/^(dr\.?|mr\.?|ms\.?|mrs\.?)\s+/, '');
  if (!t) return null;
  const exact = people.find((p) => p.name.toLowerCase().replace(/^dr\.?\s+/, '') === t);
  if (exact) return exact;
  return (
    people.find((p) => {
      const parts = p.name.toLowerCase().replace(/^dr\.?\s+/, '').split(/\s+/);
      return parts[0] === t || parts[parts.length - 1] === t;
    }) ?? null
  );
}
