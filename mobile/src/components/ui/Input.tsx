import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { colors, radius, spacing, typography } from '../../theme';

/** A labelled text input with an inline error, styled once for the whole app. */
export interface InputProps extends TextInputProps {
  label: string;
  error?: string | undefined;
}

export function Input({ label, error, style, ...props }: InputProps) {
  const invalid = error !== undefined;

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.textMuted}
        style={[styles.input, invalid && styles.inputInvalid, style]}
        {...props}
      />
      {invalid ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.xs },
  label: { ...typography.subtitle, fontSize: 14 },
  input: {
    minHeight: 48,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text,
  },
  inputInvalid: { borderColor: colors.danger },
  error: { ...typography.muted, color: colors.danger },
});
