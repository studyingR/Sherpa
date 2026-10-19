import { useLocalSearchParams } from 'expo-router';
import { BriefView } from '@/features/brief/BriefView';

export default function AccountBrief() {
  const { accountId } = useLocalSearchParams<{ accountId: string }>();
  return <BriefView accountId={accountId} />;
}
