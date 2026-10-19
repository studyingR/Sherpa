/** Design-system components (docs/06 §3). Every touchable has an accessible label and a 44pt target. */
import { useEffect, useRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type PressableProps,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { AlertTriangle, Check, ChevronRight, Lock, RotateCcw } from 'lucide-react-native';
import { SOURCE_LABEL, formatShortDate, type Source, type SourcedFact } from '@sherpa/shared';
import { font, radius, size, space, touch, useColors } from '@/theme/tokens';
import { Text } from './Text';

// ------------------------------------------------------------------ layout
export function Screen({ children, scroll = true, edges = ['top'], refreshControl, contentStyle, dark }: { children: ReactNode; scroll?: boolean; edges?: Edge[]; refreshControl?: ScrollViewProps['refreshControl']; contentStyle?: StyleProp<ViewStyle>; dark?: boolean }) {
  const c = useColors();
  const bg = dark ? c.callBg : c.ground;
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: bg }}>
      {scroll ? (
        <ScrollView refreshControl={refreshControl} contentContainerStyle={[{ padding: space.lg, paddingBottom: 120, gap: space.lg }, contentStyle]} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Row({ children, gap = space.sm, style, align = 'center' }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle>; align?: ViewStyle['alignItems'] }) {
  return <View style={[{ flexDirection: 'row', alignItems: align, gap }, style]}>{children}</View>;
}

export function Card({ children, style, tone = 'surface', padded = true }: { children: ReactNode; style?: StyleProp<ViewStyle>; tone?: 'surface' | 'dark' | 'soft' | 'danger' | 'warn'; padded?: boolean }) {
  const c = useColors();
  const bg = { surface: c.surface, dark: c.callBg, soft: c.primarySoft, danger: c.dangerBg, warn: c.warnBg }[tone];
  const border = { surface: c.border, dark: c.callBg, soft: c.primarySoft, danger: c.dangerBorder, warn: c.warnBg }[tone];
  return <View style={[{ backgroundColor: bg, borderColor: border, borderWidth: StyleSheet.hairlineWidth, borderRadius: tone === 'dark' ? radius.xl : radius.lg, padding: padded ? space.lg : 0, overflow: 'hidden' }, style]}>{children}</View>;
}

/** Sentence-case section label with an optional count and action. */
export function SectionLabel({ children, count, action }: { children: string; count?: number; action?: { label: string; onPress: () => void } }) {
  const c = useColors();
  return (
    <Row style={{ justifyContent: 'space-between', marginTop: space.xs }}>
      <Row gap={space.sm}>
        <Text variant="label" tone="inkSubtle" accessibilityRole="header">{children}</Text>
        {count !== undefined && count > 0 ? (
          <View style={{ backgroundColor: c.surfaceMuted, borderRadius: radius.pill, paddingHorizontal: 7, minWidth: 22, alignItems: 'center' }}>
            <Text variant="caption" tone="inkMuted">{count}</Text>
          </View>
        ) : null}
      </Row>
      {action ? (
        <Pressable onPress={action.onPress} accessibilityRole="button" accessibilityLabel={action.label} hitSlop={12} style={{ minHeight: touch, justifyContent: 'center' }}>
          <Text variant="smallStrong" tone="primary">{action.label}</Text>
        </Pressable>
      ) : null}
    </Row>
  );
}

// ------------------------------------------------------------------ buttons
interface BtnProps extends Omit<PressableProps, 'children'> {
  label: string;
  icon?: ReactNode;
  loading?: boolean;
  full?: boolean;
  tone?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'onDark';
  small?: boolean;
}

export function Button({ label, icon, loading, full, tone = 'primary', small, disabled, style, ...rest }: BtnProps) {
  const c = useColors();
  const palette = {
    primary: { bg: c.primary, pressed: c.primaryPressed, fg: c.onPrimary, border: c.primary },
    secondary: { bg: c.surfaceMuted, pressed: c.border, fg: c.ink, border: c.surfaceMuted },
    ghost: { bg: 'transparent', pressed: c.surfaceMuted, fg: c.primary, border: c.border },
    danger: { bg: c.dangerBg, pressed: c.dangerBorder, fg: c.dangerInk, border: c.dangerBorder },
    onDark: { bg: c.callSurface, pressed: '#2A3946', fg: c.callInk, border: c.callSurface },
  }[tone];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled || loading), busy: Boolean(loading) }}
      disabled={disabled || loading}
      style={(state) => [
        {
          minHeight: small ? touch : 52,
          paddingHorizontal: small ? space.md : space.xl,
          borderRadius: radius.md,
          backgroundColor: state.pressed ? palette.pressed : palette.bg,
          borderWidth: tone === 'ghost' ? 1 : 0,
          borderColor: palette.border,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: space.sm,
          opacity: disabled ? 0.45 : 1,
          alignSelf: full ? 'stretch' : 'auto',
        },
        typeof style === 'function' ? style(state) : style,
      ]}
      {...rest}
    >
      {loading ? <ActivityIndicator color={palette.fg} /> : icon}
      <Text variant={small ? 'smallStrong' : 'bodyStrong'} style={{ color: palette.fg }}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({ accessibilityLabel, onPress, children, tone = 'plain', size: s = touch }: { accessibilityLabel: string; onPress: () => void; children: ReactNode; tone?: 'plain' | 'muted' | 'onDark'; size?: number }) {
  const c = useColors();
  const bg = tone === 'muted' ? c.surfaceMuted : tone === 'onDark' ? c.callSurface : 'transparent';
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} hitSlop={8} style={({ pressed }) => ({ width: s, height: s, borderRadius: s / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: bg, opacity: pressed ? 0.6 : 1 })}>
      {children}
    </Pressable>
  );
}

// ------------------------------------------------------------------ badges, chips, tags
export type BadgeTone = 'neutral' | 'primary' | 'warn' | 'danger' | 'commitment' | 'success';
export function Badge({ label, tone = 'neutral' }: { label: string; tone?: BadgeTone }) {
  const c = useColors();
  const map = {
    neutral: [c.surfaceMuted, c.inkMuted],
    primary: [c.primarySoft, c.primaryPressed],
    warn: [c.warnBg, c.warnInk],
    danger: [c.dangerBg, c.dangerInk],
    commitment: [c.warnBg, c.warnInk],
    success: [c.primarySoft, c.successInk],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3, alignSelf: 'flex-start' }} accessibilityLabel={label}>
      <Text variant="caption" style={{ color: fg, fontFamily: font.bodySemibold }}>{label}</Text>
    </View>
  );
}

export function Chip({ label, selected, onPress, icon }: { label: string; selected: boolean; onPress: () => void; icon?: ReactNode }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: touch, paddingHorizontal: space.md + 2, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: selected ? c.primary : c.surfaceMuted, opacity: pressed ? 0.75 : 1,
      })}
    >
      {selected ? <Check size={15} color={c.onPrimary} strokeWidth={2.5} /> : icon}
      <Text variant="smallStrong" style={{ color: selected ? c.onPrimary : c.ink }}>{label}</Text>
    </Pressable>
  );
}

/** "nCino · as of Oct 17" (rule 6: every fact shows its source and as-of date). */
export function SourceTag({ source, asOf, onDark }: { source: Source; asOf: string; onDark?: boolean }) {
  return (
    <Text variant="caption" tone={onDark ? 'callInkMuted' : 'inkSubtle'} accessibilityLabel={`Source ${SOURCE_LABEL[source]}, as of ${formatShortDate(asOf)}`}>
      {SOURCE_LABEL[source]} · as of {formatShortDate(asOf)}
    </Text>
  );
}

export function FactGrid({ facts }: { facts: SourcedFact[] }) {
  const c = useColors();
  if (!facts.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -space.xs }}>
      {facts.map((f) => (
        <View key={f.key} style={{ width: '50%', padding: space.xs }}>
          <View style={{ backgroundColor: c.ground, borderRadius: radius.sm, padding: space.md, gap: 2, minHeight: 84 }}>
            <Text variant="caption" tone="inkMuted" numberOfLines={2}>{f.label}</Text>
            <Text variant="bodyStrong">{f.display}</Text>
            <SourceTag source={f.source} asOf={f.asOf} />
          </View>
        </View>
      ))}
    </View>
  );
}

// ------------------------------------------------------------------ rows
export function ListRow({ title, subtitle, meta, right, onPress, accent, accessibilityLabel, last }: { title: string; subtitle?: string; meta?: ReactNode; right?: ReactNode; onPress?: () => void; accent?: 'commitment' | 'danger' | 'warn'; accessibilityLabel?: string; last?: boolean }) {
  const c = useColors();
  const accentColor = accent === 'commitment' ? c.accentGold : accent === 'danger' ? c.danger : accent === 'warn' ? c.warnInk : 'transparent';
  const content = (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: space.md, paddingRight: space.lg, paddingLeft: space.lg, gap: space.md, minHeight: 56, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth, borderBottomColor: c.border }}>
      <View style={{ position: 'absolute', left: 0, top: 10, bottom: 10, width: 3, borderRadius: 2, backgroundColor: accentColor }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">{title}</Text>
        {subtitle ? <Text variant="small" tone="inkMuted">{subtitle}</Text> : null}
        {meta}
      </View>
      {right}
      {onPress ? <ChevronRight size={18} color={c.inkSubtle} /> : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? `${title}${subtitle ? `, ${subtitle}` : ''}`} style={({ pressed }) => ({ backgroundColor: pressed ? c.surfaceMuted : 'transparent' })}>
      {content}
    </Pressable>
  );
}

export function CheckRow({ checked, onToggle, title, subtitle, children, badge }: { checked: boolean; onToggle: () => void; title: string; subtitle?: string; children?: ReactNode; badge?: ReactNode }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', gap: space.md, paddingVertical: space.md, alignItems: 'flex-start' }}>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={`Include ${title}`} onPress={onToggle} hitSlop={10} style={{ width: touch, height: touch, alignItems: 'center', justifyContent: 'center', marginLeft: -8, marginTop: -8 }}>
        <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: checked ? c.primary : c.border, backgroundColor: checked ? c.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
          {checked ? <Check size={16} color={c.onPrimary} strokeWidth={3} /> : null}
        </View>
      </Pressable>
      <View style={{ flex: 1, gap: 3, opacity: checked ? 1 : 0.55 }}>
        <Text variant="bodyStrong" style={{ textDecorationLine: checked ? 'none' : 'line-through' }}>{title}</Text>
        {subtitle ? <Text variant="small" tone="inkMuted">{subtitle}</Text> : null}
        {badge}
        {children}
      </View>
    </View>
  );
}

/** Dashed until approved, filled once the RM says yes (C-02). */
export function ApprovalToggle({ approved, onChange, label }: { approved: boolean; onChange: (v: boolean) => void; label: string }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: approved }}
      accessibilityLabel={label}
      onPress={() => onChange(!approved)}
      style={({ pressed }) => ({
        minHeight: 52, borderRadius: radius.md, borderWidth: 1.5, borderStyle: approved ? 'solid' : 'dashed',
        borderColor: approved ? c.primary : c.inkSubtle, backgroundColor: approved ? c.primary : 'transparent',
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingHorizontal: space.lg, opacity: pressed ? 0.8 : 1,
      })}
    >
      {approved ? <Check size={18} color={c.onPrimary} strokeWidth={2.5} /> : null}
      <Text variant="bodyStrong" style={{ color: approved ? c.onPrimary : c.ink }}>{approved ? 'Approved' : label}</Text>
    </Pressable>
  );
}

export function FlagBanner({ title, body, locked, tone = 'danger' }: { title: string; body?: string; locked?: boolean; tone?: 'danger' | 'warn' }) {
  const c = useColors();
  const fg = tone === 'danger' ? c.dangerInk : c.warnInk;
  return (
    <View accessibilityRole="alert" accessibilityLabel={`${title}${locked ? ', locked' : ''}. ${body ?? ''}`} style={{ backgroundColor: tone === 'danger' ? c.dangerBg : c.warnBg, borderColor: tone === 'danger' ? c.dangerBorder : c.warnBg, borderWidth: 1, borderRadius: radius.md, padding: space.md, flexDirection: 'row', gap: space.md }}>
      {locked ? <Lock size={18} color={fg} style={{ marginTop: 2 }} /> : <AlertTriangle size={18} color={fg} style={{ marginTop: 2 }} />}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="smallStrong" style={{ color: fg }}>{title}</Text>
        {body ? <Text variant="small" style={{ color: fg }}>{body}</Text> : null}
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ states
export function Skeleton({ height = 18, width = '100%', style }: { height?: number; width?: number | `${number}%`; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  const pulse = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }), Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: true })]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View accessibilityLabel="Loading" style={[{ height, width, borderRadius: 8, backgroundColor: c.surfaceMuted, opacity: pulse }, style]} />;
}

export function LoadingCards({ count = 3 }: { count?: number }) {
  return (
    <View style={{ gap: space.md }} accessibilityLabel="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} style={{ gap: space.sm }}>
          <Skeleton width="55%" />
          <Skeleton width="85%" height={14} />
          <Skeleton width="40%" height={14} />
        </Card>
      ))}
    </View>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: { label: string; onPress: () => void } }) {
  return (
    <Card style={{ alignItems: 'flex-start', gap: space.sm }}>
      <Text variant="bodyStrong">{title}</Text>
      {body ? <Text variant="small" tone="inkMuted">{body}</Text> : null}
      {action ? <Button small tone="ghost" label={action.label} onPress={action.onPress} /> : null}
    </Card>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const c = useColors();
  return (
    <Card tone="warn" style={{ gap: space.sm }}>
      <Text variant="smallStrong" tone="warnInk" accessibilityRole="alert">{message}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel="Try again" style={{ flexDirection: 'row', gap: 6, alignItems: 'center', minHeight: touch }}>
          <RotateCcw size={16} color={c.warnInk} />
          <Text variant="smallStrong" tone="warnInk">Try again</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

export function Divider() {
  const c = useColors();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label" tone="inkSubtle">{label}</Text>
      {children}
      {hint ? <Text variant="caption" tone="inkSubtle">{hint}</Text> : null}
    </View>
  );
}

export const inputStyle = (c: ReturnType<typeof useColors>): StyleProp<import('react-native').TextStyle> => ({
  minHeight: 48, borderRadius: radius.sm, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, paddingHorizontal: space.md,
  paddingVertical: space.sm + 2, fontFamily: font.body, fontSize: size.lg, color: c.ink,
});
