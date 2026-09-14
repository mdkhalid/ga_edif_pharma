import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RootNavigator } from './navigation/RootNavigator';
import { bootstrapSession } from './lib/api/client';

/**
 * The app root.
 *
 * A module-level query client is correct here, unlike on the web: a native app is a
 * single user's process, so there is no second request to leak a cache into.
 *
 * `bootstrapSession` runs once on mount. It is what turns the refresh token in the
 * Keychain into a live session on cold start — without it, every launch would look
 * signed out to the app while the Keychain still held a usable token.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Mobile networks are slow and flaky; one retry is worth it, more is not.
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

export default function App() {
  useEffect(() => {
    void bootstrapSession();
  }, []);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <NavigationContainer>
          <StatusBar style="dark" />
          <RootNavigator />
        </NavigationContainer>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
