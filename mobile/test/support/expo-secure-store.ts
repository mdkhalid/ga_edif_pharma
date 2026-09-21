/**
 * In-memory stand-in for `expo-secure-store`.
 *
 * `jest.config.js` maps the specifier `expo-secure-store` here, because the real
 * package is a native module: it writes to the iOS Keychain and the Android
 * Keystore, backed by hardware where available, and no Node process can provide
 * those. Substituting the *platform* is the honest thing to fake; everything above
 * it — `src/lib/storage/secure-store.ts` and the refresh logic in
 * `src/lib/api/client.ts` — is the real code under test, and the suite reads the
 * stored token back through `getRefreshToken`, not by reaching into this map.
 *
 * What it deliberately does NOT model: the real store survives a process restart,
 * is readable only while the device is unlocked, and is never synced to a backup.
 * The suite covers the persistence contract it can (a token written before a
 * simulated cold start is read back afterwards); the Keychain's own semantics are
 * the platform's to guarantee.
 */

const items = new Map<string, string>();

/** Mirrors the constant `secure-store.ts` passes as `keychainAccessible`. */
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 'whenUnlockedThisDeviceOnly';

export async function setItemAsync(key: string, value: string): Promise<void> {
  items.set(key, value);
}

export async function getItemAsync(key: string): Promise<string | null> {
  return items.get(key) ?? null;
}

export async function deleteItemAsync(key: string): Promise<void> {
  items.delete(key);
}

/**
 * Test-only helper — not part of the `expo-secure-store` surface.
 *
 * Every test needs a Keychain that starts empty, or a token from the previous test
 * makes a freshly cleared store look signed in.
 */
export function __resetKeychain(): void {
  items.clear();
}
