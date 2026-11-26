import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../theme';

/**
 * One product in the catalogue or salt-search results.
 *
 * Both endpoints return a slightly different shape — browse has `status`, salt
 * search has `exact` — so the row takes only the fields it actually renders.
 * A shared row keeps the two screens from drifting in how they show price and
 * schedule, which is the part a buyer acts on.
 */
export interface ProductRowProps {
  readonly product: {
    readonly id: string;
    readonly name: string;
    readonly price: string;
    readonly schedule: string;
    readonly exact?: boolean;
  };
  readonly onPress: () => void;
}

export function ProductRow({ product, onPress }: ProductRowProps) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.card}>
      <Text style={styles.name}>{product.name}</Text>
      <View style={styles.meta}>
        <Text style={styles.price}>₹{product.price}</Text>
        {product.exact === true ? <Text style={styles.exact}>Exact match</Text> : null}
        {product.schedule !== 'OTC' ? (
          <Text style={styles.schedule}>Schedule {product.schedule} — prescription required</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  name: typography.subtitle,
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  price: { ...typography.body, fontWeight: '700', color: colors.brand700 },
  exact: { ...typography.muted, color: colors.success },
  schedule: { ...typography.muted, color: colors.warning },
});
