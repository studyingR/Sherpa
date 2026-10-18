/** Voice sessions outside debriefs: Ask Sherpa, agenda (F04), spoken brief (F02), deal intake (F07). */
import { router, useLocalSearchParams } from 'expo-router';
import type { Mode } from '@sherpa/shared';
import { handleUiAction } from '@/lib/navigation';
import { CallScreen } from '@/voice/CallScreen';
import type { Line } from '@/voice/useVoiceSession';

const TITLES: Partial<Record<Mode, string>> = { ASK: 'Ask Sherpa', AGENDA: 'Your agenda', BRIEF: 'Meeting brief', DEAL: 'New deal' };

function askSuggestions(lines: Line[]): string[] {
  const last = [...lines].reverse().find((l) => l.speaker === 'AGENT')?.text ?? '';
  if (/balances aloud/i.test(last)) return ['Yes', 'No'];
  if (/Confirm to save/i.test(last)) return ['Confirm'];
  return ['Brief me on Harbor Logistics', 'Mark the Brightwater docs done', 'Push Castell to Thursday', "What's on my agenda?", 'Who should I call this week?'];
}

export default function Voice() {
  const { mode = 'ASK', meetingId, accountId, draftId } = useLocalSearchParams<{ mode?: Mode; meetingId?: string; accountId?: string; draftId?: string }>();
  return (
    <CallScreen
      mode={mode}
      title={TITLES[mode] ?? 'Sherpa'}
      meetingId={meetingId}
      accountId={accountId}
      draftId={draftId}
      onUiAction={(a) => {
        if (a.type === 'NAVIGATE' && a.route === '/today') return;
        router.back();
        handleUiAction(a);
      }}
      onEnd={() => router.back()}
      suggestions={mode === 'DEAL' ? undefined : askSuggestions}
    />
  );
}
