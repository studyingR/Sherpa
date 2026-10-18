/**
 * Design tokens (docs/06 §1). Values come from the prototype; replace them here if an official palette
 * arrives — components only read tokens. Dark mode (M8) maps the same token names to darker values.
 */
import { useColorScheme } from 'react-native';

export const lightColor = {
  ground: '#F5F4EF',
  surface: '#FFFFFF',
  surfaceMuted: '#EDEBE4',
  border: '#D9D6CC',
  ink: '#16202A',
  inkMuted: '#4A545E',
  inkSubtle: '#5B6570',
  primary: '#0F6E63',
  primaryPressed: '#0A4F47',
  primarySoft: '#DDF1EC',
  onPrimary: '#FFFFFF',
  callBg: '#101820',
  callSurface: '#1E2A34',
  callAccent: '#3FB8A4',
  callInk: '#EEF1F3',
  callInkMuted: '#9FB0BC',
  warnBg: '#FBEBD2',
  warnInk: '#7A4A00',
  dangerBg: '#FDF0EE',
  dangerBorder: '#F2C9C3',
  dangerInk: '#7E1D14',
  danger: '#A8261B',
  accentGold: '#F2C57C',
  commitment: '#B8862F',
  successInk: '#0A4F47',
  overlay: 'rgba(16,24,32,0.45)',
};

export type ColorTokens = typeof lightColor;

export const darkColor: ColorTokens = {
  ground: '#11171C',
  surface: '#1A2229',
  surfaceMuted: '#242E36',
  border: '#33404A',
  ink: '#EEF1F3',
  inkMuted: '#B4C0C9',
  inkSubtle: '#A3B0BA',
  primary: '#3FB8A4',
  primaryPressed: '#5CCBB8',
  primarySoft: '#173A35',
  onPrimary: '#0B1A17',
  callBg: '#0B1116',
  callSurface: '#18232C',
  callAccent: '#3FB8A4',
  callInk: '#EEF1F3',
  callInkMuted: '#9FB0BC',
  warnBg: '#3A2C12',
  warnInk: '#F5CF8E',
  dangerBg: '#3A1814',
  dangerBorder: '#6B2A22',
  dangerInk: '#FFB4A8',
  danger: '#FF8A7A',
  accentGold: '#F2C57C',
  commitment: '#E2B25A',
  successInk: '#8FE0D0',
  overlay: 'rgba(0,0,0,0.6)',
};

export const font = {
  display: 'Newsreader_600SemiBold',
  displayItalic: 'Newsreader_500Medium_Italic',
  body: 'Figtree_400Regular',
  bodyMedium: 'Figtree_500Medium',
  bodySemibold: 'Figtree_600SemiBold',
  bodyBold: 'Figtree_700Bold',
};

export const size = { xs: 11, sm: 13, md: 15, lg: 16, xl: 22, xxl: 32 };
export const radius = { sm: 12, md: 14, lg: 16, xl: 20, pill: 999 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 };
export const touch = 44; // minimum touch target (pt)

export function useColors(): ColorTokens {
  return useColorScheme() === 'dark' ? darkColor : lightColor;
}
