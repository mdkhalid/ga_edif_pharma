import { StyleSheet, Text } from 'react-native';

import { Button } from '../../components/ui/Button';
import { Card, Screen } from '../../components/ui/Screen';
import { useAuthStore } from '../../app/store/auth.store';
import { logout } from '../../lib/api/client';
import { spacing, typography } from '../../theme';

/**
 * Account.
 *
 * Sign-out clears the Keychain entry and the in-memory store; the root navigator then
 * swaps to the auth stack on its own, so there is no imperative navigation here
 * either. The server-side revoke is best effort — the local session is gone either
 * way, and a session that outlives its device is a server-side problem the token's
 * expiry already bounds.
 */
export function ProfileScreen() {
  const user = useAuthStore((state) => state.user);

  return (
    <Screen title="Account">
      <Card>
        <Text style={styles.label}>Name</Text>
        <Text style={styles.value}>{user?.fullName ?? '—'}</Text>

        <Text style={styles.label}>Email</Text>
        <Text style={styles.value}>{user?.email ?? '—'}</Text>

        <Text style={styles.label}>Roles</Text>
        <Text style={styles.value}>{user?.roles.join(', ') ?? '—'}</Text>
      </Card>

      <Button title="Sign out" variant="secondary" onPress={() => void logout()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { ...typography.muted, marginTop: spacing.sm },
  value: typography.body,
});
