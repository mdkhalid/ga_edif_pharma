import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';

import { Card, Screen } from '../../components/ui/Screen';
import { callAuthed } from '../../lib/api/client';
import { colors, spacing, typography } from '../../theme';

/**
 * Home.
 *
 * Fetches the profile through `callAuthed`, which refreshes and retries once on a
 * 401 — so a session whose access token expired while the app was backgrounded
 * recovers silently rather than showing an error the user cannot act on.
 */
export function HomeScreen() {
  const profile = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => callAuthed((auth) => auth.me()),
  });

  if (profile.isPending) {
    return (
      <Screen title="Home">
        <ActivityIndicator color={colors.brand700} />
      </Screen>
    );
  }

  if (profile.isError || profile.data === undefined) {
    return (
      <Screen title="Home">
        <Card>
          <Text style={styles.body}>We could not load your profile.</Text>
          <Text style={styles.muted}>
            This usually means the session has ended. Signing in again should fix it.
          </Text>
        </Card>
      </Screen>
    );
  }

  const user = profile.data;

  return (
    <Screen title={`Hello, ${user.fullName}`} subtitle={user.email ?? user.phone ?? undefined}>
      <Card>
        <Text style={styles.body}>Your account</Text>
        <Text style={styles.muted}>Status: {user.status}</Text>
        <Text style={styles.muted}>Roles: {user.roles.join(', ') || '—'}</Text>
      </Card>

      <Card>
        <Text style={styles.body}>What comes next</Text>
        <Text style={styles.muted}>
          Catalogue browsing, salt search, cart and order tracking arrive with Phase 1. This screen
          proves the Keychain-backed session, the API client and the silent token refresh all work
          end to end.
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { ...typography.subtitle, marginBottom: spacing.xs },
  muted: typography.muted,
});
