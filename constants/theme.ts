// MedsMinder — Instagram-inspired design system
//
// Core palette follows Instagram's UI:
//   - Pure white surfaces, hairline dividers, black text.
//   - IG blue (#0095F6) for primary actions (like "Follow").
//   - Magenta / pink (#E1306C) for story-ring accents.
//   - Minimal shadows — we rely on hairline borders instead.
//   - 8–12px border radii (IG uses rect + mild rounds), pill for avatars.

export const Colors = {
  primary: '#0095F6',             // IG action blue
  primaryDark: '#0077C2',
  primaryLight: '#E7F5FE',
  primaryPale: '#FFFFFF',

  accent: '#E1306C',              // IG magenta (story ring, notification dot)
  accentSoft: '#FCE6EE',

  gradientStops: ['#FEDA77', '#F58529', '#DD2A7B', '#8134AF', '#515BD4'],

  ink: '#000000',
  inkSoft: '#262626',              // IG primary text
  inkMuted: '#737373',              // IG secondary text
  inkLight: '#A8A8A8',              // IG tertiary / placeholders

  secondary: '#E1306C',
  secondaryLight: '#FCE6EE',

  surface: '#FFFFFF',
  background: '#FFFFFF',
  card: '#FFFFFF',

  text: '#262626',
  textSecondary: '#737373',
  textLight: '#A8A8A8',
  textOnPrimary: '#FFFFFF',
  textOnDark: '#FFFFFF',

  success: '#34C759',
  successLight: '#E4F9E9',
  warning: '#F5A623',
  warningLight: '#FFF4E1',
  danger: '#ED4956',                // IG "unfollow" red
  dangerLight: '#FCE6E8',
  dangerDark: '#C13037',

  medColors: [
    '#E1306C',
    '#F58529',
    '#FEDA77',
    '#34C759',
    '#0095F6',
    '#8134AF',
    '#DD2A7B',
  ],

  border: '#DBDBDB',                // IG hairline divider
  divider: '#EFEFEF',
  shadow: 'rgba(0, 0, 0, 0.05)',
  overlay: 'rgba(0, 0, 0, 0.5)',
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 14,
  lg: 20,
  xl: 28,
  xxl: 40,
};

export const BorderRadius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 100,
};

export const Shadow = {
  sm: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
    elevation: 8,
  },
};

export const Typography = {
  display: {
    fontSize: 28,
    fontWeight: '700' as const,
    letterSpacing: -0.4,
    lineHeight: 34,
  },
  h1: {
    fontSize: 22,
    fontWeight: '700' as const,
    letterSpacing: -0.3,
    lineHeight: 28,
  },
  h2: {
    fontSize: 18,
    fontWeight: '700' as const,
    letterSpacing: -0.2,
    lineHeight: 24,
  },
  h3: {
    fontSize: 16,
    fontWeight: '600' as const,
    letterSpacing: -0.1,
  },
  h4: {
    fontSize: 14,
    fontWeight: '600' as const,
  },
  body: { fontSize: 14, fontWeight: '400' as const, lineHeight: 20 },
  bodySmall: { fontSize: 13, fontWeight: '400' as const, lineHeight: 18 },
  caption: { fontSize: 12, fontWeight: '500' as const, letterSpacing: 0 },
  label: {
    fontSize: 11,
    fontWeight: '600' as const,
    letterSpacing: 0.4,
    textTransform: 'uppercase' as const,
  },
};

// Shorter animation durations for a snappier feel.
export const Motion = {
  fast: 140,
  base: 200,
  slow: 320,
};
