import { createCartApi, createOrdersApi } from '@medichain/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, FlatList, StyleSheet, Text } from 'react-native';

import { Button } from '../../components/ui/Button';
import { Card, Screen } from '../../components/ui/Screen';
import { callAuthedClient, idempotencyKey } from '../../lib/api/client';
import { colors, spacing, typography } from '../../theme';

/**
 * Order history and reorder (P12 slice).
 *
 * Reorder adds the previous order's lines to the organisation's cart using the
 * same idempotency-key helper registration uses: a double-tap must not double
 * the quantity. It does **not** place the order — the buyer still reviews the
 * cart, prices and prescription requirements before checkout.
 */
export function OrdersScreen() {
  const queryClient = useQueryClient();

  const orders = useQuery({
    queryKey: ['orders', 'list'],
    queryFn: () => callAuthedClient((client) => createOrdersApi(client).list({ pageSize: 25 })),
  });

  const reorder = useMutation({
    mutationFn: (orderId: string) =>
      callAuthedClient(async (client) => {
        const ordersApi = createOrdersApi(client);
        const cart = createCartApi(client);
        const detail = await ordersApi.getById(orderId);

        let added = 0;
        for (const line of detail.items) {
          const quantity = Number(line.quantity);
          if (!Number.isFinite(quantity) || quantity <= 0) continue;
          await cart.add({ productId: line.productId, quantity }, idempotencyKey());
          added += 1;
        }
        return added;
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['cart'] });
    },
  });

  return (
    <Screen title="Orders" subtitle="Past orders — tap Reorder to refill your cart">
      {reorder.isError ? (
        <Text style={styles.error}>Reorder failed. Check your connection and try again.</Text>
      ) : null}
      {reorder.isSuccess ? (
        <Text style={styles.notice}>
          {reorder.data === 0
            ? 'That order had no lines to reorder.'
            : `${reorder.data} line${reorder.data === 1 ? '' : 's'} added to your cart.`}
        </Text>
      ) : null}

      {orders.isPending ? (
        <ActivityIndicator color={colors.brand700} />
      ) : orders.isError || orders.data === undefined ? (
        <Card>
          <Text style={styles.body}>We could not load your orders.</Text>
          <Text style={styles.muted}>Signing in again should fix it.</Text>
        </Card>
      ) : orders.data.data.length === 0 ? (
        <Card>
          <Text style={styles.body}>No orders yet</Text>
          <Text style={styles.muted}>Orders you place will appear here.</Text>
        </Card>
      ) : (
        <FlatList
          data={orders.data.data}
          keyExtractor={(order) => order.id}
          scrollEnabled={false}
          renderItem={({ item }) => (
            <Card>
              <Text style={styles.body}>Order {item.id.slice(0, 8)}</Text>
              <Text style={styles.muted}>{new Date(item.createdAt).toLocaleDateString()}</Text>
              <Text style={styles.muted}>Status: {item.status}</Text>
              <Text style={styles.total}>₹{item.total}</Text>
              <Button
                title="Reorder"
                variant="secondary"
                loading={reorder.isPending}
                onPress={() => reorder.mutate(item.id)}
              />
            </Card>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { ...typography.subtitle },
  muted: typography.muted,
  total: { ...typography.subtitle, fontWeight: '700', marginBottom: spacing.xs },
  error: { color: colors.danger },
  notice: { color: colors.brand700 },
});
