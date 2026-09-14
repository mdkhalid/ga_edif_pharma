/**
 * Design tokens for the mobile app.
 *
 * The web apps get these from `@medichain/config/tailwind/theme.css`. React Native
 * cannot consume CSS, so the same values are restated here as TypeScript. They are
 * the *only* thing the platforms share visually, which is why they are grouped in
 * one file rather than sprinkled through components: when the brand ramp changes,
 * this is the one place a mobile change is needed.
 */
export const colors = {
  brand50: '#eefbf8',
  brand100: '#d4f4ec',
  brand500: '#14b8a6',
  brand700: '#0f766e',
  brand900: '#134e4a',

  success: '#16a34a',
  warning: '#d97706',
  danger: '#dc2626',

  text: '#0f172a',
  textMuted: '#64748b',
  border: '#e2e8f0',
  surface: '#ffffff',
  background: '#f1f5f9',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  control: 8,
  card: 12,
} as const;

export const typography = {
  title: { fontSize: 24, fontWeight: '600' as const, color: colors.text },
  subtitle: { fontSize: 16, fontWeight: '500' as const, color: colors.text },
  body: { fontSize: 15, color: colors.text },
  muted: { fontSize: 13, color: colors.textMuted },
} as const;
