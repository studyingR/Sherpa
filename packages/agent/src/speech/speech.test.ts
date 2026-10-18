import { describe, expect, it } from 'vitest';
import { amountForReadBack, amountToWords, findAmount, wordsToNumber } from './numbers';
import { quarterEndDate, resolveDueDate, resolveQuarter, spokenDate, splitDatePhrase } from './dates';
import { maskFiguresForSpeech } from './privacy';

describe('amount parsing (docs/05 §5.1)', () => {
  it.each([
    ['need about two and a half million in equipment financing', 2_500_000],
    ['around four hundred thousand', 400_000],
    ['$2.5M line', 2_500_000],
    ['a 750k term loan', 750_000],
    ['$1,250,000 request', 1_250_000],
    ['half a million', 500_000],
    ['three million', 3_000_000],
  ])('%s → %d', (text, expected) => {
    expect(findAmount(text)?.value).toBe(expected);
  });

  it('marks "one point five" with no unit as ambiguous (G5)', () => {
    const r = findAmount('They want maybe one point five for a new line.');
    expect(r).toMatchObject({ value: null, ambiguous: true });
  });

  it('ignores percentages, quarters and small counts', () => {
    expect(findAmount('rates near 6.1% in Q1, 2 meetings')).toBeNull();
  });

  it('parses number words', () => {
    expect(wordsToNumber('two and a half')).toBe(2.5);
    expect(wordsToNumber('one point two five')).toBe(1.25);
    expect(wordsToNumber('four hundred')).toBe(400);
  });
});

describe('spoken amounts (F01-FR6)', () => {
  it('reads amounts in words and digits', () => {
    expect(amountToWords(2_500_000)).toBe('two point five million');
    expect(amountToWords(400_000)).toBe('four hundred thousand');
    expect(amountForReadBack(2_500_000)).toBe('two point five million — 2,500,000 dollars');
  });
});

describe('dates', () => {
  const monday = new Date(2026, 9, 19); // SEED_TODAY in tests
  it('resolves "by Friday" relative to the meeting date', () => {
    expect(resolveDueDate('by Friday', monday)).toBe('2026-10-23');
    expect(resolveDueDate('by Wednesday', monday)).toBe('2026-10-21');
  });
  it('moves weekend dates to Monday (business-day aware)', () => {
    expect(resolveDueDate('on Saturday', monday)).toBe('2026-10-26');
  });
  it('splits the date phrase from a clause', () => {
    expect(splitDatePhrase('send a term sheet by Friday')).toEqual({ rest: 'send a term sheet', dateText: 'by Friday' });
  });
  it('maps Q1 after an October meeting to next year', () => {
    expect(resolveQuarter('probably Q1', monday)).toBe('Q1 2027');
    expect(quarterEndDate('Q1 2027')).toBe('2027-03-31');
  });
  it('speaks dates in words', () => {
    expect(spokenDate('2026-09-25')).toBe('Friday, September twenty-fifth');
  });
});

describe('privacy mode (C-09)', () => {
  it('replaces figures with "on your screen"', () => {
    expect(maskFiguresForSpeech('Deposits are $4.1M and the line is $5,000,000.')).toBe('Deposits are on your screen and the line is on your screen.');
  });
});
