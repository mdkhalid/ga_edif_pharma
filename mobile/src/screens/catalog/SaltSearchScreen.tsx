import { createSearchApi } from '@medichain/api-client';
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
 * Salt-combination search (P12).
 *
 * The query is sent to the server unchanged — normalising it here would guess at
 * a rule the salt engine owns. The client only renders the result and says when
 * the match was exact, which is the one distinction a pharmacist needs to see.
 */
export function SaltSearchScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<CatalogStackParamList, 'SaltSearch'>>();
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  const results = useQuery({
    queryKey: ['salt-search', query, page],
    enabled: query !== '',
    queryFn: () =>
      callAuthedClient((client) =>
        createSearchApi(client).products({ q: query, page, pageSize: PAGE_SIZE }),
      ),
  });

  return (
    <Screen title="Salt search" subtitle="Find products by their salts, not their brand">
      <Input
        label="Salts"
        value={draft}
        onChangeText={setDraft}
        placeholder="Paracetamol + Cetirizine"
        onSubmitEditing={() => {
          setPage(1);
          setQuery(draft.trim());
        }}
      />
      <Button
        title="Search salts"
        onPress={() => {
          setPage(1);
          setQuery(draft.trim());
        }}
      />

      {query === '' ? (
        <Card>
          <Text style={typography.body}>Try “Paracetamol” or “Paracetamol + Cetirizine”.</Text>
          <Text style={typography.muted}>A typo such as “Parasetamol” still finds it.</Text>
        </Card>
      ) : results.isPending ? (
        <ActivityIndicator color={colors.brand700} />
      ) : results.isError || results.data === undefined ? (
        <Card>
          <Text style={styles.error}>{apiErrorMessage(results.error)}</Text>
        </Card>
      ) : results.data.data.length === 0 ? (
        <Card>
          <Text style={typography.body}>No products matched those salts.</Text>
        </Card>
      ) : (
        <>
          <Text style={typography.muted}>
            {results.data.meta.total} result{results.data.meta.total === 1 ? '' : 's'}
          </Text>
          <FlatList
            data={results.data.data}
            keyExtractor={(product) => product.id}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <ProductRow
                product={item}
                onPress={() => navigation.navigate('ProductDetail', { productId: item.id })}
              />
            )}
          />
          {results.data.meta.hasNext ? (
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
