import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { CatalogScreen } from '../screens/catalog/CatalogScreen';
import { ProductDetailScreen } from '../screens/catalog/ProductDetailScreen';
import { SaltSearchScreen } from '../screens/catalog/SaltSearchScreen';
import type { CatalogStackParamList } from './types';

/**
 * Browsing is a stack inside its tab: product detail and salt search are pushed
 * onto it, so the Back gesture returns to the list the buyer was looking at
 * instead of dropping them on a different tab.
 */
const Stack = createNativeStackNavigator<CatalogStackParamList>();

export function CatalogNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Catalog" component={CatalogScreen} options={{ title: 'Catalogue' }} />
      <Stack.Screen name="SaltSearch" component={SaltSearchScreen} options={{ title: 'Salt search' }} />
      <Stack.Screen
        name="ProductDetail"
        component={ProductDetailScreen}
        options={{ title: 'Product' }}
      />
    </Stack.Navigator>
  );
}
