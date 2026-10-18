import { useState } from 'react';
import { router } from 'expo-router';
import { Check, CalendarClock, UserRoundPlus } from 'lucide-react-native';
import { addDays, formatDayDate, toIsoDate, type Task } from '@sherpa/shared';
import { API } from '@/api/hooks';
import { ApiError } from '@/api/client';
import { Sheet } from '@/components/Sheet';
import { Text } from '@/components/Text';
import { Button, Chip, ErrorState, Row } from '@/components/ui';
import { space, useColors } from '@/theme/tokens';

function nextWeekday(from: Date, weekday: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + ((weekday + 7 - d.getDay()) % 7 || 7));
  return d;
}

/** Complete / reschedule / delegate → a WriteIntent the RM confirms on the next sheet (F04-FR2). */
export function TaskActionSheet({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const c = useColors();
  const [mode, setMode] = useState<'menu' | 'move' | 'delegate'>('menu');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const today = new Date();
  const dates = [addDays(today, 1), nextWeekday(today, 4), nextWeekday(today, 1)];

  async function go(body: Parameters<typeof API.taskIntent>[1]) {
    if (!task) return;
    setBusy(true);
    setError(null);
    try {
      const intent = await API.taskIntent(task.id, body);
      close();
      router.push(`/intent/${intent.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }
  function close() {
    setMode('menu');
    setError(null);
    onClose();
  }

  return (
    <Sheet visible={Boolean(task)} onClose={close} title={task?.subject ?? ''}>
      {task?.accountName ? <Text variant="small" tone="inkMuted">{task.accountName} · {task.ownerName}</Text> : null}
      {error ? <ErrorState message={error} /> : null}
      {mode === 'menu' ? (
        <>
          <Button label="Mark done" icon={<Check size={18} color={c.onPrimary} />} loading={busy} onPress={() => go({ action: 'COMPLETE' })} />
          <Button tone="secondary" label="Move the due date" icon={<CalendarClock size={18} color={c.ink} />} onPress={() => setMode('move')} />
          <Button tone="secondary" label="Delegate" icon={<UserRoundPlus size={18} color={c.ink} />} onPress={() => setMode('delegate')} />
        </>
      ) : null}
      {mode === 'move' ? (
        <Row style={{ flexWrap: 'wrap' }} gap={space.sm}>
          {dates.map((d) => (
            <Chip key={d.toISOString()} label={formatDayDate(d)} selected={false} onPress={() => go({ action: 'RESCHEDULE', dueDate: toIsoDate(d) })} />
          ))}
        </Row>
      ) : null}
      {mode === 'delegate' ? (
        <Row style={{ flexWrap: 'wrap' }} gap={space.sm}>
          <Chip label="Priya Shah" selected={false} onPress={() => go({ action: 'DELEGATE', delegateTo: 'u_priya' })} />
          <Chip label="Devon Brooks" selected={false} onPress={() => go({ action: 'DELEGATE', delegateTo: 'u_devon' })} />
        </Row>
      ) : null}
      <Text variant="caption" tone="inkSubtle">Nothing is written until you confirm.</Text>
    </Sheet>
  );
}
