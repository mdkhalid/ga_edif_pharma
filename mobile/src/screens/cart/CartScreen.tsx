import { ApiError, createCartApi, createOrdersApi } from '@medichain/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text } from 'react-native';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card, Screen } from '../../components/ui/Screen';
import { callAuthedClient, idempotencyKey } from '../../lib/api/client';
import { apiErrorMessage } from '../../lib/api/message';
import { colors, spacing, typography } from '../../theme';

/**
 * Cart review and checkout (P12).
 *
 * The cart is read from the server, not from local state: unit price and stock
 * are recomputed on every change, so a price change between adding an item and
 * paying is reflected rather than silently honoured. Checkout deliberately
 * shows server errors verbatim — prescription, credit and stock gates all live
 * there, and a generic "order failed" would leave the buyer guessing.
 */
export function CartScreen() {
  const queryClient = useQueryClient();
  const [address, setAddress] = useState('');

  const cart = useQuery({
    queryKey: ['cart'],
    queryFn: () => callAuthedClient((client) => createCartApi(client).get()),
  });

  const update = useMutation({
    mutationFn: ({ productId, quantity }: { productId: string; quantity: number }) =>
      callAuthedClient((client) => createCartApi(client).updateQuantity(productId, quantity)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['cart'] });
    },
  });

  const remove = useMutation({
    mutationFn: (productId: string) =>
      callAuthedClient((client) => createCartApi(client).remove(productId)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['cart'] });
    },
  });

  const place = useMutation({
    mutationFn: (deliveryAddress: string) =>
      callAuthedClient((client) =>
        createOrdersApi(client).place({ deliveryAddress }, idempotencyKey()),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['cart'] });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });

  const lines = cart.data?.items ?? [];
  const canCheckout = address.trim() !== '' && lines.length > 0 && !place.isPending;

  return (
    <Screen title="Cart" subtitle="Prices and stock are checked again at checkout">
      {cart.isPending ? (
        <ActivityIndicator color={colors.brand700} />
      ) : cart.isError || cart.data === undefined ? (
        <Card>
          <Text style={styles.body}>
            {cart.error instanceof ApiError && cart.error.code === 'NOT_FOUND'
              ? 'Your cart is empty. Add a product from the catalogue to get started.'
              : apiErrorMessage(cart.error)}
          </Text>
        </Card>
      ) : (
        <>
          {lines.length === 0 ? (
            <Card>
              <Text style={styles.body}>Your cart is empty.</Text>
            </Card>
          ) : (
            <FlatList
              data={lines}
              keyExtractor={(line) => line.productId}
              scrollEnabled={false}
              renderItem={({ item }) => {
                const quantity = Number(item.quantity);
                return (
                  <Card>
                    <Text style={styles.subtitle}>{item.productName}</Text>
                    <Text style={styles.muted}>
                      ₹{item.unitPrice} each · {item.available} available
                    </Text>
                    <Text style={styles.total}>₹{item.lineTotal}</Text>
                    <Button
                      title="Remove"
                      variant="secondary"
                      loading={remove.isPending}
                      onPress={() => remove.mutate(item.productId)}
                    />
                    <Text style={styles.muted}>Quantity: {item.quantity}</Text>
                    <Button
                      title="Decrease"
                      variant="secondary"
                      disabled={update.isPending || !Number.isFinite(quantity) || quantity <= 1}
                      onPress={() =>
                        update.mutate({ productId: item.productId, quantity: quantity - 1 })
                      }
                    />
                    <Button
                      title="Increase"
                      variant="secondary"
                      loading={update.isPending}
                      disabled={!Number.isFinite(quantity)}
                      onPress={() =>
                        update.mutate({ productId: item.productId, quantity: quantity + 1 })
                      }
                    />
                  </Card>
                );
              }}
            />
          )}

          <Card>
            <Text style={styles.subtitle}>Total: ₹{cart.data.total}</Text>
            <Input
              label="Delivery address"
              value={address}
              onChangeText={setAddress}
              placeholder="Flat, street, city, PIN"
              multiline
            />
            <Button
              title={`Place order · ₹${cart.data.total}`}
              loading={place.isPending}
              disabled={!canCheckout}
              onPress={() => place.mutate(address.trim())}
            />
            {place.isError ? (
              <Text style={styles.error}>{apiErrorMessage(place.error)}</Text>
            ) : null}
            {place.isSuccess ? (
              <Text style={styles.success}>Order {place.data.id.slice(0, 8)} placed.</Text>
            ) : null}
          </Card>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: typography.body,
  subtitle: typography.subtitle,
  muted: { ...typography.muted, marginBottom: spacing.xs },
  total: { ...typography.body, fontWeight: '700', color: colors.brand700 },
  error: { ...typography.body, color: colors.danger },
  success: { ...typography.body, color: colors.success },
});
