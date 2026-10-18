import { Stack } from 'expo-router';
import { useColors } from '@/theme/tokens';

export default function AccountsLayout() {
  const c = useColors();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.ground } }} />;
}
