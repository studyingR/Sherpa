import { router } from 'expo-router';
import type { UiAction } from '@sherpa/shared';

/** UiAction lets the agent navigate the app (docs/04 §15). */
export function handleUiAction(a: UiAction) {
  if (a.type === 'OPEN_SAVED') router.replace(`/debrief/saved/${a.debriefId}`);
  else if (a.type === 'NAVIGATE') router.push(a.route as never);
  else if (a.type === 'OPEN_BRIEF') router.push(`/brief/${a.meetingId}`);
  else if (a.type === 'SHOW_INTENT') router.push(`/intent/${a.intentId}`);
  else if (a.type === 'OPEN_REVIEW') router.push(`/debrief/review/${a.draftId}`);
}
