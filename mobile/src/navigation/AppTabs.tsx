import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { HomeScreen } from '../screens/home/HomeScreen';
import { OrdersScreen } from '../screens/orders/OrdersScreen';
import { ProfileScreen } from '../screens/account/ProfileScreen';
import type { AppTabParamList } from './types';

/**
 * The authenticated tab navigator.
 *
 * Catalogue, salt search and cart remain to be added. Orders are here now:
 * history and reorder use the same typed client and refresh path as the rest of
 * the app, so the first Phase 2 feature on a phone does not need a native module.
 */
const Tab = createBottomTabNavigator<AppTabParamList>();

export function AppTabs() {
  return (
    <Tab.Navigator>
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: 'Home' }} />
      <Tab.Screen name="Orders" component={OrdersScreen} options={{ title: 'Orders' }} />
      <Tab.Screen name="Account" component={ProfileScreen} options={{ title: 'Account' }} />
    </Tab.Navigator>
  );
}
