import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ThumbsDown, ThumbsUp } from 'lucide-react-native';
import type { TalkingPoint } from '@sherpa/shared';
import { API } from '@/api/hooks';
import { Text } from '@/components/Text';
import { Card, IconButton, Row, SourceTag } from '@/components/ui';
import { font, space, useColors } from '@/theme/tokens';

/** F09: rationale + evidence + suggested question; thumbs feedback is stored. */
export function TalkingPointCard({ tp }: { tp: TalkingPoint }) {
  const c = useColors();
  const qc = useQueryClient();
  const [fb, setFb] = useState(tp.feedback);
  const send = async (v: 'UP' | 'DOWN') => {
    setFb(v);
    await API.tpFeedback(tp.id, v).catch(() => setFb(tp.feedback));
    qc.invalidateQueries({ queryKey: ['account'] });
  };
  return (
    <Card style={{ gap: space.sm }}>
      <Text variant="bodyStrong">{tp.title}</Text>
      <Text variant="small" tone="inkMuted">{tp.rationale}</Text>
      <Text variant="small" style={{ fontFamily: font.displayItalic, fontSize: 17 }}>"{tp.question}"</Text>
      {tp.evidence.slice(0, 2).map((e) => (
        <SourceTag key={e.key} source={e.source} asOf={e.asOf} />
      ))}
      <Row>
        <IconButton accessibilityLabel="Helpful" onPress={() => send('UP')} tone={fb === 'UP' ? 'muted' : 'plain'}>
          <ThumbsUp size={18} color={fb === 'UP' ? c.primary : c.inkSubtle} />
        </IconButton>
        <IconButton accessibilityLabel="Not helpful" onPress={() => send('DOWN')} tone={fb === 'DOWN' ? 'muted' : 'plain'}>
          <ThumbsDown size={18} color={fb === 'DOWN' ? c.danger : c.inkSubtle} />
        </IconButton>
      </Row>
    </Card>
  );
}

