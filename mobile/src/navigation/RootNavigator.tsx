import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useAuthStore } from '../app/store/auth.store';
import { colors, spacing } from '../theme';
import { AppTabs } from './AppTabs';
import { AuthNavigator } from './AuthNavigator';

/**
 * Chooses the navigator from the session state.
 *
 * The `unknown` branch matters: on launch the app has a refresh token in the
 * Keychain but has not exchanged it yet. Rendering the signed-out stack during that
 * window would show a sign-in form to a user who is in fact signed in — a visible
 * flash of the wrong screen on every cold start.
 */
export function RootNavigator() {
  const status = useAuthStore((state) => state.status);

  if (status === 'unknown') {
    return (
      <View style={styles.boot}>
        <ActivityIndicator size="large" color={colors.brand700} />
      </View>
    );
  }

  return status === 'authenticated' ? <AppTabs /> : <AuthNavigator />;
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    gap: spacing.lg,
  },
});
