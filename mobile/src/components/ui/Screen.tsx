import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../../theme';

/**
 * A screen container.
 *
 * Uses `ScrollView` rather than `View` so a form does not clip its submit button
 * when the keyboard is up or the device is small — the most common layout bug in a
 * hand-rolled RN form.
 */
export function Screen({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      style={styles.root}
    >
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        {subtitle !== undefined ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      <View style={styles.body}>{children}</View>
    </ScrollView>
  );
}

/** A bordered surface, matching the web apps' `Card`. */
export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg, flexGrow: 1 },
  header: { gap: spacing.xs, paddingTop: spacing.md },
  title: typography.title,
  subtitle: typography.muted,
  body: { gap: spacing.lg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
});
