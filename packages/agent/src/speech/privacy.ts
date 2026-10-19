/** Privacy mode (F02-FR4, C-09): balances and exposure are not spoken unless the RM said yes this session. */
const MONEY = /\$\s?\d[\d,]*(?:\.\d+)?\s?(?:[kKmMbB]|million|thousand|billion)?\b/g;

export function maskFiguresForSpeech(text: string): string {
  return text.replace(MONEY, 'on your screen').replace(/(?:on your screen)(?:\s*(?:and|,)\s*on your screen)+/g, 'on your screen');
}

export const PRIVACY_PROMPT = 'Okay to read balances aloud?';
export const PRIVACY_DECLINED = 'Figures are on your screen.';
