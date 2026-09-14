import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { LoginScreen } from '../screens/auth/LoginScreen';
import { OtpScreen } from '../screens/auth/OtpScreen';
import { RegisterScreen } from '../screens/auth/RegisterScreen';
import type { AuthStackParamList } from './types';

/**
 * The unauthenticated stack.
 *
 * Kept as its own navigator rather than a set of conditional screens inside the tab
 * navigator, so the signed-out flow has no tab bar to escape into and no route that
 * expects a session.
 */
const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Login" component={LoginScreen} options={{ title: 'Sign in' }} />
      <Stack.Screen
        name="Register"
        component={RegisterScreen}
        options={{ title: 'Create account' }}
      />
      <Stack.Screen name="Otp" component={OtpScreen} options={{ title: 'Verify your email' }} />
    </Stack.Navigator>
  );
}
