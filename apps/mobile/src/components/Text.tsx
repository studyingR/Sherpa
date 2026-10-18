import { Text as RNText, type TextProps, type TextStyle } from 'react-native';
import { font, size, useColors, type ColorTokens } from '@/theme/tokens';

type Variant = 'display' | 'title' | 'heading' | 'body' | 'bodyStrong' | 'small' | 'smallStrong' | 'caption' | 'label';
type Tone = keyof Pick<ColorTokens, 'ink' | 'inkMuted' | 'inkSubtle' | 'primary' | 'danger' | 'dangerInk' | 'warnInk' | 'callInk' | 'callInkMuted' | 'onPrimary' | 'successInk' | 'commitment'>;

const VARIANTS: Record<Variant, TextStyle> = {
  display: { fontFamily: font.display, fontSize: size.xxl, lineHeight: 38, letterSpacing: -0.4 },
  title: { fontFamily: font.display, fontSize: size.xl + 4, lineHeight: 32, letterSpacing: -0.2 },
  heading: { fontFamily: font.display, fontSize: size.xl, lineHeight: 28 },
  body: { fontFamily: font.body, fontSize: size.lg, lineHeight: 23 },
  bodyStrong: { fontFamily: font.bodySemibold, fontSize: size.lg, lineHeight: 23 },
  small: { fontFamily: font.body, fontSize: size.md, lineHeight: 21 },
  smallStrong: { fontFamily: font.bodySemibold, fontSize: size.md, lineHeight: 21 },
  caption: { fontFamily: font.bodyMedium, fontSize: size.sm, lineHeight: 18 },
  label: { fontFamily: font.bodySemibold, fontSize: size.sm, lineHeight: 18, letterSpacing: 0.1 },
};

export interface AppTextProps extends TextProps {
  variant?: Variant;
  tone?: Tone;
  align?: TextStyle['textAlign'];
}

/** Dynamic type up to 130% without clipping (docs/06 §6). */
export function Text({ variant = 'body', tone = 'ink', align, style, ...rest }: AppTextProps) {
  const c = useColors();
  return <RNText maxFontSizeMultiplier={1.3} {...rest} style={[VARIANTS[variant], { color: c[tone], textAlign: align }, style]} />;
}
