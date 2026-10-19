import { useLocalSearchParams } from 'expo-router';
import { BriefView } from '@/features/brief/BriefView';

export default function MeetingBrief() {
  const { meetingId } = useLocalSearchParams<{ meetingId: string }>();
  return <BriefView meetingId={meetingId} />;
}
