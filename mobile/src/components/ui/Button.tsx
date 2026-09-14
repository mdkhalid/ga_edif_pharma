import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
} from 'react-native';

import { colors, radius, spacing } from '../../theme';

/**
 * The app's button.
 *
 * A function component with explicit props rather than raw `Pressable` usage at each
 * call site, so the loading and disabled states — the two that are easy to get wrong
 * per screen — behave identically everywhere.
 */
export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  title: string;
  variant?: 'primary' | 'secondary';
  loading?: boolean;
}

export function Button({
  title,
  variant = 'primary',
  loading = false,
  disabled,
  ...props
}: ButtonProps) {
  const isDisabled = disabled === true || loading;
  const isPrimary = variant === 'primary';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        isPrimary ? styles.primary : styles.secondary,
        (pressed || isDisabled) && styles.dimmed,
      ]}
      {...props}
    >
      {loading ? <ActivityIndicator color={isPrimary ? colors.surface : colors.brand700} /> : null}
      <Text style={[styles.label, isPrimary ? styles.labelPrimary : styles.labelSecondary]}>
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 48,
    borderRadius: radius.control,
    paddingHorizontal: spacing.lg,
  },
  primary: { backgroundColor: colors.brand700 },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  dimmed: { opacity: 0.6 },
  label: { fontSize: 15, fontWeight: '600' },
  labelPrimary: { color: colors.surface },
  labelSecondary: { color: colors.text },
});
