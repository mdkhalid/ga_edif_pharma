import { createCatalogApi } from '@medichain/api-client';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text } from 'react-native';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card, Screen } from '../../components/ui/Screen';
import { ProductRow } from '../../components/ProductRow';
import { callAuthedClient } from '../../lib/api/client';
import { apiErrorMessage } from '../../lib/api/message';
import type { CatalogStackParamList } from '../../navigation/types';
import { colors, typography } from '../../theme';

const PAGE_SIZE = 20;

/**
 * Catalogue browse (P12).
 *
 * Search is a substring match on the product name here — salt-combination
 * discovery is its own screen, because the server's salt engine uses a different
 * endpoint and a different result shape. Paging is explicit rather than
 * infinite: a "next page" button is easier to recover from on a flaky mobile
 * connection than an auto-fetching list.
 */
export function CatalogScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<CatalogStackParamList, 'Catalog'>>();
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const products = useQuery({
    queryKey: ['catalog', 'list', search, page],
    queryFn: () =>
      callAuthedClient((client) =>
        createCatalogApi(client).list({
          page,
          pageSize: PAGE_SIZE,
          ...(search === '' ? {} : { search }),
        }),
      ),
  });

  return (
    <Screen title="Catalogue" subtitle="Browse products or search by salt combination">
      <Input
        label="Product name"
        value={draft}
        onChangeText={setDraft}
        placeholder="e.g. Dolo"
        onSubmitEditing={() => {
          setPage(1);
          setSearch(draft.trim());
        }}
      />
      <Button
        title="Search products"
        variant="secondary"
        onPress={() => {
          setPage(1);
          setSearch(draft.trim());
        }}
      />
      <Button
        title="Search by salt combination"
        variant="secondary"
        onPress={() => navigation.navigate('SaltSearch')}
      />

      {products.isPending ? (
        <ActivityIndicator color={colors.brand700} />
      ) : products.isError || products.data === undefined ? (
        <Card>
          <Text style={styles.error}>{apiErrorMessage(products.error)}</Text>
        </Card>
      ) : products.data.data.length === 0 ? (
        <Card>
          <Text style={typography.body}>No products found</Text>
          <Text style={typography.muted}>Try a shorter name or a salt search.</Text>
        </Card>
      ) : (
        <>
          <Text style={typography.muted}>
            Page {products.data.meta.page} of {products.data.meta.totalPages} ·{' '}
            {products.data.meta.total} products
          </Text>
          <FlatList
            data={products.data.data}
            keyExtractor={(product) => product.id}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <ProductRow
                product={item}
                onPress={() => navigation.navigate('ProductDetail', { productId: item.id })}
              />
            )}
          />
          {products.data.meta.hasNext ? (
            <Button title="Next page" variant="secondary" onPress={() => setPage(page + 1)} />
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: { ...typography.body, color: colors.danger },
});
