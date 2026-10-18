/** Display helpers shared by server (facts, emails) and mobile. Plain JS, no Intl dependency. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function withCommas(n: number): string {
  const [int, frac] = Math.abs(n).toFixed(0).split('.');
  const s = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (n < 0 ? '-' : '') + s + (frac ? `.${frac}` : '');
}

/** $2,500,000 */
export function formatMoneyFull(n: number): string {
  return `$${withCommas(Math.round(n))}`;
}

/** $2.5M, $400K, $950 */
export function formatMoney(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1_000_000) return `${sign}$${trimZero((a / 1_000_000).toFixed(a >= 10_000_000 ? 1 : 2))}M`;
  if (a >= 1_000) return `${sign}$${trimZero((a / 1_000).toFixed(a >= 100_000 ? 0 : 1))}K`;
  return `${sign}$${a.toFixed(0)}`;
}

function trimZero(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

export function formatPct(n: number, digits = 0): string {
  return `${n.toFixed(digits)}%`;
}

/** Local-calendar YYYY-MM-DD for a Date. */
export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse YYYY-MM-DD as a local date (not UTC). Full ISO datetimes are parsed normally. */
export function parseDate(s: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(s);
}

/** Oct 17 */
export function formatShortDate(s: string | Date): string {
  const d = typeof s === 'string' ? parseDate(s) : s;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Fri, Oct 17 */
export function formatDayDate(s: string | Date): string {
  const d = typeof s === 'string' ? parseDate(s) : s;
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Friday, October 17 */
export function formatLongDate(s: string | Date): string {
  const d = typeof s === 'string' ? parseDate(s) : s;
  return `${DAYS_LONG[d.getDay()]}, ${MONTHS_LONG[d.getMonth()]} ${d.getDate()}`;
}

/** 2:00 PM */
export function formatTime(s: string | Date): string {
  const d = typeof s === 'string' ? new Date(s) : s;
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return m === 0 ? `${h}:00 ${ampm}` : `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function daysBetween(a: Date, b: Date): number {
  const ms = startOfDay(b).getTime() - startOfDay(a).getTime();
  return Math.round(ms / 86_400_000);
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

export const MONTH_NAMES_LONG = MONTHS_LONG;
export const DAY_NAMES_LONG = DAYS_LONG;
