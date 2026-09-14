import * as SecureStore from 'expo-secure-store';

/**
 * Device-backed secure storage for the refresh token.
 *
 * ## Why the Keychain / Keystore, and never AsyncStorage
 *
 * AsyncStorage is unencrypted plaintext on disk. On a rooted or jailbroken device —
 * or through a device backup, which is the far more common path — a token in
 * AsyncStorage is a full account compromise. `expo-secure-store` writes to the iOS
 * Keychain and the Android Keystore, which are backed by hardware where available.
 *
 * Only the **refresh** token lives here. The access token is held in memory for the
 * life of the process, so a stolen device backup yields a token that still has to be
 * exchanged before it is useful, and does not outlive a sign-out.
 */

const REFRESH_TOKEN_KEY = 'medichain.refreshToken';

export async function saveRefreshToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token, {
    // Readable only while the device is unlocked, and never synced to iCloud or an
    // Android backup. A backup that carries a live refresh token turns a restored
    // phone into a signed-in session for whoever restores it.
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
}

export async function clearRefreshToken(): Promise<void> {
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}
