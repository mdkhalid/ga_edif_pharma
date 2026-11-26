import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { HomeScreen } from '../screens/home/HomeScreen';
import { CartScreen } from '../screens/cart/CartScreen';
import { OrdersScreen } from '../screens/orders/OrdersScreen';
import { ProfileScreen } from '../screens/account/ProfileScreen';
import { CatalogNavigator } from './CatalogNavigator';
import type { AppTabParamList } from './types';

/**
 * The authenticated tab navigator.
 *
 * Catalogue (with salt search and product detail as pushed screens), cart and
 * orders all use the typed client and the app's single-flight refresh path.
 * None of them needs a native module; push, barcode and prescription upload
 * still do.
 */
const Tab = createBottomTabNavigator<AppTabParamList>();

export function AppTabs() {
  return (
    <Tab.Navigator>
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: 'Home' }} />
      <Tab.Screen name="Catalog" component={CatalogNavigator} options={{ title: 'Catalog' }} />
      <Tab.Screen name="Cart" component={CartScreen} options={{ title: 'Cart' }} />
      <Tab.Screen name="Orders" component={OrdersScreen} options={{ title: 'Orders' }} />
      <Tab.Screen name="Account" component={ProfileScreen} options={{ title: 'Account' }} />
    </Tab.Navigator>
  );
}
