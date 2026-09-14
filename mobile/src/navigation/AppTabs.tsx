import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { HomeScreen } from '../screens/home/HomeScreen';
import { ProfileScreen } from '../screens/account/ProfileScreen';
import type { AppTabParamList } from './types';

/**
 * The authenticated tab navigator.
 *
 * Catalogue, salt search, cart and orders join these tabs with Phase 1; the two that
 * exist now are the ones a session needs — somewhere to land, and somewhere to sign
 * out from.
 */
const Tab = createBottomTabNavigator<AppTabParamList>();

export function AppTabs() {
  return (
    <Tab.Navigator>
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: 'Home' }} />
      <Tab.Screen name="Account" component={ProfileScreen} options={{ title: 'Account' }} />
    </Tab.Navigator>
  );
}
