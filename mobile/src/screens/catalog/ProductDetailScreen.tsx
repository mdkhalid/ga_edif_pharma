import { createCartApi, createCatalogApi } from '@medichain/api-client';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card, Screen } from '../../components/ui/Screen';
import { callAuthedClient, idempotencyKey } from '../../lib/api/client';
import { parseQuantity } from '../../lib/cart';
import { apiErrorMessage } from '../../lib/api/message';
import type { CatalogStackParamList } from '../../navigation/types';
import { colors, typography } from '../../theme';

/**
 * Product detail and add-to-cart (P12).
 *
 * The idempotency key is generated here, once per attempt, just as it is for
 * registration and reorder: a double-tap on a slow connection must not add the
 * line twice. Price and stock are never computed here — the cart endpoint
 * re-reads both on every change, and the server remains authoritative.
 */
export function ProductDetailScreen() {
  const route = useRoute<RouteProp<CatalogStackParamList, 'ProductDetail'>>();
  const productId = route.params.productId;
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState('1');

  const product = useQuery({
    queryKey: ['catalog', 'detail', productId],
    queryFn: () => callAuthedClient((client) => createCatalogApi(client).getById(productId)),
  });

  const add = useMutation({
    mutationFn: (count: number) =>
      callAuthedClient((client) =>
        createCartApi(client).add({ productId, quantity: count }, idempotencyKey()),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['cart'] });
    },
  });

  const count = parseQuantity(quantity);

  return (
    <Screen title={product.data?.name ?? 'Product'} subtitle={product.data?.strength ?? undefined}>
      {product.isPending ? (
        <ActivityIndicator color={colors.brand700} />
      ) : product.isError || product.data === undefined ? (
        <Card>
          <Text style={styles.error}>{apiErrorMessage(product.error)}</Text>
        </Card>
      ) : (
        <>
          <Card>
            <Text style={typography.body}>Price: ₹{product.data.price}</Text>
            <Text style={typography.muted}>Schedule: {product.data.schedule}</Text>
            {product.data.schedule !== 'OTC' ? (
              <Text style={styles.notice}>
                Schedule H and above need a verified prescription before checkout.
              </Text>
            ) : null}
          </Card>

          <Input
            label="Quantity"
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="numeric"
            error={count === null ? 'Enter a quantity greater than zero.' : undefined}
          />
          <Button
            title="Add to cart"
            loading={add.isPending}
            disabled={count === null}
            onPress={() => {
              if (count !== null) add.mutate(count);
            }}
          />
          {add.isError ? <Text style={styles.error}>{apiErrorMessage(add.error)}</Text> : null}
          {add.isSuccess ? (
            <Text style={styles.success}>Added to your cart.</Text>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: { ...typography.body, color: colors.danger },
  notice: { ...typography.muted, color: colors.warning },
  success: { ...typography.body, color: colors.success },
});
