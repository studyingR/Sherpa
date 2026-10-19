/**
 * Demo helper for mock voice mode on a simulator (no speech recognition without an OpenAI key):
 * suggests the scripted G1 turns (docs/07 §8) based on Sherpa's last question.
 */
import type { Line } from '@/voice/useVoiceSession';

export const G1_NARRATIVE =
  "Good meeting. They're expanding the Newark plant and need about two and a half million in equipment financing, probably Q1. Jane complained that wires were delayed twice this month. They're starting to buy from a German supplier, so FX came up. I said I'd send a term sheet by Friday.";

export function debriefSuggestions(lines: { speaker: string; text: string }[] | Line[]): string[] {
  const last = [...lines].reverse().find((l) => l.speaker === 'AGENT')?.text ?? '';
  if (/Is that the one\?|Resume your/i.test(last)) return ["Yes, that's the one."];
  if (/tell me how it went/i.test(last)) return [G1_NARRATIVE];
  if (/Who should follow up with/i.test(last)) return ['Treasury services should call Jane by Wednesday.', 'Skip'];
  if (/Say yes to approve/i.test(last)) return ['Yes.', 'Not yet, hold off.'];
  if (/Say "confirm"/i.test(last)) return ['Confirm.', 'Move the term sheet to Monday.'];
  if (/draft the recap/i.test(last)) return ['Yes, draft it.'];
  if (/\?$/.test(last)) return ['Skip'];
  return [];
}
