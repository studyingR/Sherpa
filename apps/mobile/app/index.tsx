import { Redirect } from 'expo-router';
import { useSession } from '@/store/session';

export default function Index() {
  const token = useSession((s) => s.token);
  return <Redirect href={token ? '/today' : '/sign-in'} />;
}
